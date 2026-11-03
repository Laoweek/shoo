// Rule helpers shared by Settings, the popup and onboarding: labels, ordering, Starter rules and the
// RuleOp builders. Labels follow CONTEXT.md (docs/spec/ui-design.md Section 9).
import { channelKey } from '~/core/channel';
import { formatCount, parseCount } from '~/core/count';
import { isBannedChannel, sortByRef } from '~/core/rules';
import type { Polarity, Rule, RuleKind, RuleOp, RuleParams } from '~/core/types';
import { t } from '~/i18n';
import { hitsThisWeek, type RuleStats } from '~/store/local';

/** Kinds offered when adding a Rule, in picker order. Pending-fixture kinds are never offered. */
export function offeredKinds(polarity: Polarity, regexEnabled: boolean): RuleKind[] {
  const kinds: RuleKind[] =
    polarity === 'remove'
      ? ['topic', 'thumbnail', 'channel', 'keyword', 'pattern', 'duration', 'views', 'short', 'live']
      : ['topic', 'channel', 'artistChannel', 'keyword', 'pattern', 'duration', 'views', 'short', 'live'];
  if (regexEnabled) kinds.splice(kinds.indexOf('duration'), 0, 'regex');
  return kinds;
}

export const needsModel = (kind: RuleKind): boolean => kind === 'topic' || kind === 'thumbnail';

export function kindLabel(kind: RuleKind, polarity: Polarity): string {
  switch (kind) {
    case 'topic':
      return t('rules.kind.topic');
    case 'thumbnail':
      return t('rules.kind.thumbnail');
    case 'channel':
      return polarity === 'keep' ? t('keep.kind.channel') : t('rules.kind.channel');
    case 'keyword':
      return t('rules.kind.keyword');
    case 'pattern':
      return t('rules.kind.pattern');
    case 'regex':
      return t('rules.kind.regex');
    case 'duration':
      return t('rules.kind.duration');
    case 'views':
      return t('rules.kind.views');
    case 'short':
      return t('rules.kind.short');
    case 'live':
      return t('rules.kind.live');
    case 'membersOnly':
      return t('rules.kind.membersOnly');
    case 'artistChannel':
      return t('rules.kind.artistChannel');
  }
}

/**
 * Activity order for the Rules table: switched-off Rules sink, then most hits this week, then most hits
 * all time, then ref order so ties stay stable.
 */
export function sortByActivity(rules: Rule[], stats: RuleStats, now: number): Rule[] {
  const refOrder = new Map(sortByRef(rules).map((r, i) => [r.id, i]));
  return [...rules].sort(
    (a, b) =>
      Number(b.enabled) - Number(a.enabled) ||
      hitsThisWeek(stats[b.id], now) - hitsThisWeek(stats[a.id], now) ||
      (stats[b.id]?.total ?? 0) - (stats[a.id]?.total ?? 0) ||
      refOrder.get(a.id)! - refOrder.get(b.id)!,
  );
}

export const byId = (rules: Rule[] | undefined): Map<string, Rule> => new Map((rules ?? []).map((r) => [r.id, r]));

/** The Banned channel Rule for a channel name, if any. */
export function bannedRuleFor(rules: Rule[], channelName: string): Rule | undefined {
  const key = channelKey(channelName);
  return rules.find((r) => isBannedChannel(r) && r.deletedAt === undefined && channelKey(r.params?.channelName ?? r.text) === key);
}

/** Display text for a Rule's channel. */
export const channelOf = (r: Rule): string => r.params?.channelName ?? r.text;

// ---------------------------------------------------------------------------------------------------
// Starter rules (REQ-ONB-1 and the Rules empty state)

export const STARTERS = [
  { id: 'reaction', kind: 'topic' },
  { id: 'clickbait', kind: 'topic' },
  { id: 'crypto', kind: 'topic' },
  { id: 'gossip', kind: 'topic' },
  { id: 'shorts', kind: 'short' },
] as const satisfies readonly { id: string; kind: RuleKind }[];
export type Starter = (typeof STARTERS)[number];

/** The chip's short label. */
export const starterLabel = (s: Starter): string => t(`starter.${s.id}.label`);
/** The Rule text the Decision model reads: a full sentence for Topic starters. */
export const starterText = (s: Starter): string => t(`starter.${s.id}.text`);

/** A Starter rule takes its chip label as its Rule name (REQ-RULE-11). */
export function starterOp(s: Starter): RuleOp {
  return { op: 'add', rule: { polarity: 'remove', kind: s.kind, text: starterText(s), name: starterLabel(s), enabled: true, origin: 'starter' } };
}

// ---------------------------------------------------------------------------------------------------
// New Rules

export interface Draft {
  kind: RuleKind;
  text: string;
  /** Optional Rule name, as typed. Not offered for channel Rules, whose text is the channel name. */
  name?: string;
  /** Duration bounds in whole minutes, as typed. */
  minMinutes?: string;
  maxMinutes?: string;
  /** View count bounds, as typed: `10000`, `10,000`, `10k` or `1.5m`. */
  minViews?: string;
  maxViews?: string;
}

const minutes = (s: string | undefined): number | undefined => {
  if (s === undefined || s.trim() === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 60) : NaN;
};

const views = (s: string | undefined): number | undefined => {
  if (s === undefined || s.trim() === '') return undefined;
  return parseCount(s) ?? NaN;
};

/** Builds the add op for a draft, or undefined when the draft is incomplete. */
export function addOp(polarity: Polarity, d: Draft): RuleOp | undefined {
  const text = d.text.trim();
  const base = { polarity, kind: d.kind, enabled: true, origin: 'user' as const };
  let params: RuleParams | undefined;
  let finalText = text;
  switch (d.kind) {
    case 'channel':
      if (!text) return undefined;
      params = { channelName: text };
      break;
    case 'duration': {
      const min = minutes(d.minMinutes);
      const max = minutes(d.maxMinutes);
      if (Number.isNaN(min) || Number.isNaN(max) || (min === undefined && max === undefined)) return undefined;
      if (min !== undefined && max !== undefined && min > max) return undefined;
      params = { ...(min === undefined ? {} : { minSeconds: min }), ...(max === undefined ? {} : { maxSeconds: max }) };
      finalText = text || durationText(params);
      break;
    }
    case 'views': {
      const min = views(d.minViews);
      const max = views(d.maxViews);
      if (Number.isNaN(min) || Number.isNaN(max) || (min === undefined && max === undefined)) return undefined;
      if (min !== undefined && max !== undefined && min > max) return undefined;
      params = { ...(min === undefined ? {} : { minViews: min }), ...(max === undefined ? {} : { maxViews: max }) };
      finalText = text || viewsText(params);
      break;
    }
    case 'short':
      finalText = text || t('starter.shorts.text');
      break;
    case 'live':
      finalText = text || t('rules.text.live');
      break;
    case 'artistChannel':
      finalText = text || t('rules.text.artistChannel');
      break;
    default:
      if (!text) return undefined;
  }
  const name = hasName(d.kind) ? d.name?.trim() : undefined;
  return { op: 'add', rule: { ...base, text: finalText, ...(name ? { name } : {}), ...(params ? { params } : {}) } };
}

/** Channel Rules have no Rule name: their text is the channel name. */
export const hasName = (kind: RuleKind): boolean => kind !== 'channel';

/** Renames a Rule. An empty name clears it, so Shoo shows the Rule's text again. */
export function namePatch(rule: Rule, name: string): RuleOp {
  return { op: 'update', id: rule.id, patch: { name: name.trim() } };
}

/** "Shorter than 2 min", "Longer than 60 min" or "Between 2 and 60 min". */
export function durationText(p: RuleParams): string {
  const min = p.minSeconds === undefined ? undefined : String(Math.round(p.minSeconds / 60));
  const max = p.maxSeconds === undefined ? undefined : String(Math.round(p.maxSeconds / 60));
  if (min !== undefined && max !== undefined) return t('rules.duration.between', { min, max });
  if (max !== undefined) return t('rules.duration.shorter', { max });
  return t('rules.duration.longer', { min: min ?? '0' });
}

/** "Fewer than 1k views", "More than 1m views" or "Between 1k and 1m views". */
export function viewsText(p: RuleParams): string {
  const min = p.minViews === undefined ? undefined : formatCount(p.minViews);
  const max = p.maxViews === undefined ? undefined : formatCount(p.maxViews);
  if (min !== undefined && max !== undefined) return t('rules.views.between', { min, max });
  if (max !== undefined) return t('rules.views.fewer', { max });
  return t('rules.views.more', { min: min ?? '0' });
}

/** Text edits on channel Rules keep params.channelName in step with the visible name. */
export function textPatch(rule: Rule, text: string): RuleOp {
  if (rule.kind === 'channel') return { op: 'update', id: rule.id, patch: { text, params: { ...rule.params, channelName: text } } };
  return { op: 'update', id: rule.id, patch: { text } };
}

/** The Rule the background just created for an add op: same kind and text, newest first. */
export function findAdded(rules: Rule[], op: RuleOp): Rule | undefined {
  if (op.op !== 'add') return undefined;
  return rules
    .filter((r) => r.kind === op.rule.kind && r.text === op.rule.text && r.polarity === op.rule.polarity && r.deletedAt === undefined)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
}

// ---------------------------------------------------------------------------------------------------
// Soft hints while typing a remove Topic or Thumbnail rule (REQ-RULE-12, docs/spec/decision-engine.md Section 13).
// English patterns only. They never block saving.

export type RuleHint = 'order' | 'negation';

const ORDER_WORDS = new Set(['no', "don't", 'hide', 'remove', 'block', 'stop', 'never', 'avoid']);
const NEGATION_WORDS = new Set(['not', 'except', 'unless', 'excluding']);

/** Whole words, with hyphenated words kept whole so "No-code" and "not-for-profit" stay topics. */
const words = (text: string): string[] =>
  text
    .replace(/\u2019/g, "'")
    .split(/[^\p{L}\p{N}'-]+/u)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ''))
    .filter(Boolean);

/**
 * Hints for a Rule's text: 'order' when it starts with an order ("No …", "Don't …", "Do not …", "Hide …",
 * "Remove …", "Block …", "Stop …", "Never …", "Avoid …"), 'negation' when it says "not", "except",
 * "unless" or "excluding" (which covers "but not").
 */
export function ruleHints(text: string): RuleHint[] {
  const raw = words(text);
  const w = raw.map((x) => x.toLowerCase());
  // Part of a name ("No Man's Sky", "Don't Starve", "Not Just Bikes"): capitalised inside the text, or followed by a
  // capitalised word at the start.
  const capital = (x?: string) => !!x && x[0] !== x[0]!.toLowerCase();
  const inName = (i: number) => (i > 0 ? capital(raw[i]) : capital(raw[1]));
  const doNot = w[0] === 'do' && w[1] === 'not' && !capital(raw[1]);
  const hints: RuleHint[] = [];
  if (doNot || (ORDER_WORDS.has(w[0] ?? '') && !inName(0))) hints.push('order');
  // The "not" of a leading "Do not" is the order, not a negation.
  if (w.some((x, i) => i >= (doNot ? 2 : 0) && NEGATION_WORDS.has(x) && !inName(i))) hints.push('negation');
  return hints;
}

/** Hints apply to remove Topic and Thumbnail rules, the ones a model reads as a description. */
export const takesHints = (polarity: Polarity, kind: RuleKind): boolean => polarity === 'remove' && (kind === 'topic' || kind === 'thumbnail');

/** Soft limit for Rule text in the editor, with the counter shown from 150 (decision-engine.md Section 3). */
export const SOFT_TEXT_LIMIT = 200;
export const COUNTER_FROM = 150;
