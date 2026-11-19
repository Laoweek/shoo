// Rule model, refs, colours and pipeline stages 1-4. Source of truth: docs/spec/architecture.md
// Sections 5 and 8 ("Refs"), docs/spec/requirements.md §4, docs/spec/ui-design.md "Rule colour codes".
import { channelIdSite } from './channel';
import type { CompiledExact } from './exact';
import { newId } from './ids';
import { validateRegex } from './regex';
import { SITE_IDS } from './sites';
import { RULE_KINDS, type ColourCode, type Exception, type NativeAction, type Polarity, type Rule, type RuleKind, type RuleParams, type SiteId, type TileFacts } from './types';

export const REF_RE = /^([RK])(\d+)$/;

export function parseRef(ref: string): { letter: 'R' | 'K'; n: number } | undefined {
  const m = REF_RE.exec(ref);
  return m ? { letter: m[1] as 'R' | 'K', n: Number(m[2]) } : undefined;
}

/** Next numbers to hand out (start at 1). `nextColour` is a 1-based index into c1..c10. Stored in `sync:meta`. */
export interface RefCounters {
  nextR: number;
  nextK: number;
  nextColour: number;
}

export const INITIAL_COUNTERS: RefCounters = { nextR: 1, nextK: 1, nextColour: 1 };

/** Code unit order, the same on every device (unlike localeCompare). */
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const letterFor = (polarity: Polarity): 'R' | 'K' => (polarity === 'remove' ? 'R' : 'K');

/**
 * Allocates the next ref for a polarity: max(next counter, highest number in use + 1). Tombstoned Rules
 * count as in use, and the counter outlives purged tombstones, so a ref is never reused (REQ-RULE-6).
 */
export function allocateRef(rules: Rule[], polarity: Polarity, counters: RefCounters): { ref: string; counters: RefCounters } {
  const letter = letterFor(polarity);
  let highest = 0;
  for (const r of rules) {
    const parsed = parseRef(r.ref);
    if (parsed?.letter === letter) highest = Math.max(highest, parsed.n);
  }
  const key = letter === 'R' ? 'nextR' : 'nextK';
  const n = Math.max(counters[key], highest + 1);
  return { ref: `${letter}${n}`, counters: { ...counters, [key]: n + 1 } };
}

export const COLOUR_COUNT = 10;

/** Hands out c1..c10 in order, then repeats. Colours are stored with the Rule and never recomputed. */
export function allocateColour(counters: RefCounters): { colour: ColourCode; counters: RefCounters } {
  const raw = Math.trunc(counters.nextColour);
  const index = raw >= 1 && raw <= COLOUR_COUNT ? raw : 1;
  return {
    colour: `c${index}` as ColourCode,
    counters: { ...counters, nextColour: (index % COLOUR_COUNT) + 1 },
  };
}

/** Builds a new Rule with a fresh ref, and a colour for remove Rules only (Keep rules get none). */
export function createRule(
  input: Omit<Rule, 'id' | 'ref' | 'colour' | 'createdAt' | 'updatedAt'>,
  existing: Rule[],
  counters: RefCounters,
  now: number,
  id?: string,
): { rule: Rule; counters: RefCounters } {
  const refd = allocateRef(existing, input.polarity, counters);
  let next = refd.counters;
  const rule: Rule = { ...input, id: id ?? newId(), ref: refd.ref, createdAt: now, updatedAt: now };
  if (input.polarity === 'remove') {
    const coloured = allocateColour(next);
    rule.colour = coloured.colour;
    next = coloured.counters;
  }
  return { rule, counters: next };
}

export const RULE_TEXT_MAX = 500;
/** Rule name length limit (REQ-RULE-11), in UTF-16 units like `maxLength`. */
export const RULE_NAME_MAX = 40;

/** The Rule with its name trimmed, and without one when it is blank, so no Rule stores an empty name. */
export function trimName<T extends { name?: string }>(rule: T): T {
  const { name, ...rest } = rule;
  const trimmed = name?.trim();
  return (trimmed ? { ...rest, name: trimmed } : rest) as T;
}

/**
 * Validates a Rule before it is saved or imported. Reasons: 'unknownKind', 'unknownSite', 'thumbnailKeep',
 * 'artistChannelRemove', 'skipSubscribedKeep' (a Keep rule with `skipSubscribed`), 'emptyText', 'textTooLong'
 * (over 500 characters), 'nameTooLong' (over 40), 'channelNameRequired', 'durationBounds', 'viewsBounds',
 * 'regexDisabled' (only when `regexEnabled` is false), or 'regex.<RegexCheck reason>'.
 */
export function validateRuleInput(
  input: { polarity: Polarity; kind: RuleKind; text: string; name?: string; params?: RuleParams; skipSubscribed?: boolean; site?: SiteId },
  regexEnabled?: boolean,
): { ok: true } | { ok: false; reason: string } {
  const fail = (reason: string) => ({ ok: false as const, reason });
  if (!RULE_KINDS.includes(input.kind)) return fail('unknownKind');
  if (input.site !== undefined && !SITE_IDS.includes(input.site)) return fail('unknownSite');
  if (input.kind === 'thumbnail' && input.polarity === 'keep') return fail('thumbnailKeep');
  if (input.kind === 'artistChannel' && input.polarity === 'remove') return fail('artistChannelRemove');
  if (input.skipSubscribed && input.polarity === 'keep') return fail('skipSubscribedKeep');
  if (!input.text.trim()) return fail('emptyText');
  if (input.text.length > RULE_TEXT_MAX) return fail('textTooLong');
  if ((input.name?.length ?? 0) > RULE_NAME_MAX) return fail('nameTooLong');
  const p = input.params ?? {};
  if (input.kind === 'channel' && !p.channelName?.trim()) return fail('channelNameRequired');
  if (input.kind === 'duration') {
    const { minSeconds: min, maxSeconds: max } = p;
    const okBound = (v: number | undefined) => v === undefined || (Number.isFinite(v) && v >= 0);
    if ((min === undefined && max === undefined) || !okBound(min) || !okBound(max) || (min ?? 0) > (max ?? Infinity)) {
      return fail('durationBounds');
    }
  }
  if (input.kind === 'views') {
    const { minViews: min, maxViews: max } = p;
    const okBound = (v: number | undefined) => v === undefined || (Number.isFinite(v) && v >= 0);
    if ((min === undefined && max === undefined) || !okBound(min) || !okBound(max) || (min ?? 0) > (max ?? Infinity)) {
      return fail('viewsBounds');
    }
  }
  if (input.kind === 'regex') {
    if (regexEnabled === false) return fail('regexDisabled');
    const check = validateRegex(input.text);
    if (!check.ok) return fail(`regex.${check.reason}`);
  }
  return { ok: true };
}

/**
 * After a sync merge or import, gives every Rule that shares a ref with an earlier-created Rule the next
 * free ref (later `createdAt` is renumbered, ties broken by id). Tombstones keep their refs and count as
 * in use. Pass `now` to stamp `updatedAt` on renumbered Rules so the change syncs. Inputs are not mutated.
 */
export function resolveRefCollisions(
  rules: Rule[],
  counters: RefCounters,
  now?: number,
): { rules: Rule[]; counters: RefCounters; renumbered: { ruleId: string; from: string; to: string }[] } {
  const groups = new Map<string, Rule[]>();
  for (const r of rules) groups.set(r.ref, [...(groups.get(r.ref) ?? []), r]);

  let next = counters;
  const current = [...rules];
  const renumbered: { ruleId: string; from: string; to: string }[] = [];
  const refs = [...groups.keys()].sort();
  for (const ref of refs) {
    const group = groups.get(ref)!;
    if (group.length < 2) continue;
    const [, ...later] = [...group].sort((a, b) => a.createdAt - b.createdAt || compareText(a.id, b.id));
    for (const r of later) {
      const allocated = allocateRef(current, r.polarity, next);
      next = allocated.counters;
      const moved: Rule = { ...r, ref: allocated.ref, ...(now === undefined ? {} : { updatedAt: now }) };
      current[current.indexOf(r)] = moved;
      renumbered.push({ ruleId: r.id, from: ref, to: allocated.ref });
    }
  }
  return { rules: current, counters: next, renumbered };
}

/** Banned channel = a remove Rule of kind channel, acted on with Don't recommend channel. */
export const isBannedChannel = (r: Rule): boolean => r.kind === 'channel' && r.polarity === 'remove';
export const isTopicKeep = (r: Rule): boolean => r.kind === 'topic' && r.polarity === 'keep';
export const activeRules = (rules: Rule[]): Rule[] => rules.filter((r) => r.enabled && r.deletedAt === undefined);

/**
 * Kinds that match a format only one Site shows: Bilibili Tiles are never Shorts, live, members-only or from an Artist
 * channel. Views is YouTube's too, because only YouTube's extractor reads a view count.
 */
const KIND_SITE: Partial<Record<RuleKind, SiteId>> = {
  views: 'youtube',
  short: 'youtube',
  live: 'youtube',
  membersOnly: 'youtube',
  artistChannel: 'youtube',
};

/**
 * The one Site a Rule works on, or undefined for every Site: its kind's, else the one stored, else for a channel Rule
 * the Site its handle or id belongs to.
 */
export const ruleSite = (r: Pick<Rule, 'kind' | 'site' | 'params'>): SiteId | undefined =>
  KIND_SITE[r.kind] ?? r.site ?? (r.kind === 'channel' ? channelIdSite(r.params) : undefined);

/**
 * Whether the user can choose where a Rule works: not for a kind bound to one Site, nor for a channel Rule that knows
 * its channel's handle or id, which exist on one Site only.
 */
export const siteChoosable = (r: Pick<Rule, 'kind' | 'params'>): boolean =>
  KIND_SITE[r.kind] === undefined && !(r.kind === 'channel' && channelIdSite(r.params) !== undefined);

/** The Rules that work on a Site, the only ones its Tiles are judged against (ADR 0012). */
export const rulesOn = (rules: Rule[], site: SiteId): Rule[] => rules.filter((r) => (ruleSite(r) ?? site) === site);

/**
 * Which Exceptions a Site's requests may show the model as kept examples: only those kept from an enabled remove
 * Topic rule that works on that Site, the one kind of Rule `viewer_kept_anyway` speaks to. An Exception from a Banned
 * channel, an Exact or Thumbnail rule, a disabled or deleted Rule, or with no Rule stays on the device, because it
 * tells the model nothing about its questions and is often the only time that title would leave it.
 */
export function exampleOn(rules: Rule[], site: SiteId): (x: Exception) => boolean {
  const topic = new Set(activeRules(rulesOn(rules, site)).filter((r) => r.kind === 'topic' && r.polarity === 'remove').map((r) => r.id));
  return (x) => x.ruleId !== undefined && topic.has(x.ruleId);
}

/** Sorted copy: K refs before R refs, then by number. Unparseable refs last, then by ref text and id. */
export function sortByRef(rules: Rule[]): Rule[] {
  const key = (r: Rule) => {
    const p = parseRef(r.ref);
    return p ? [0, p.letter === 'K' ? 0 : 1, p.n] : [1, 0, 0];
  };
  return [...rules].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return ka[i]! - kb[i]!;
    return compareText(a.ref, b.ref) || compareText(a.id, b.id);
  });
}

export type ExactStageOutcome =
  | { kind: 'keep'; source: 'keepRule' | 'exception'; rule?: Rule; rescuedFrom?: Rule }
  | { kind: 'remove'; rule: Rule; nativeAction: NativeAction }
  | { kind: 'none' };

/**
 * Pipeline stages 1-4 (architecture.md Section 5): exact Keep rule, then Exception, then Banned channel
 * (Don't recommend channel), then other Exact rules (Not interested). Shorts shelf Tiles never get
 * Don't recommend channel: a Banned channel match there is downgraded to Not interested.
 * An exact Keep rule's keep is a Rescue (`rescuedFrom`) when stages 2-4 would have removed the Tile: no
 * Exception, and a Banned channel or other Exact rule matches. Topic rules are not consulted.
 * `subscribed`: the Tile is from a Subscribed channel, so remove Rules with `skipSubscribed` do not apply.
 */
export function runExactStages(
  t: TileFacts,
  compiled: CompiledExact,
  hasException: (videoId: string) => boolean,
  subscribed = false,
): ExactStageOutcome {
  const keep = compiled.matchKeep(t);
  if (keep) {
    const beaten = compiled.matchBanned(t, subscribed) ?? compiled.matchRemove(t, subscribed);
    return beaten && !hasException(t.videoId)
      ? { kind: 'keep', source: 'keepRule', rule: keep, rescuedFrom: beaten }
      : { kind: 'keep', source: 'keepRule', rule: keep };
  }
  if (hasException(t.videoId)) return { kind: 'keep', source: 'exception' };
  const banned = compiled.matchBanned(t, subscribed);
  if (banned) {
    return { kind: 'remove', rule: banned, nativeAction: t.surface === 'shortsShelf' ? 'notInterested' : 'dontRecommendChannel' };
  }
  const remove = compiled.matchRemove(t, subscribed);
  if (remove) return { kind: 'remove', rule: remove, nativeAction: 'notInterested' };
  return { kind: 'none' };
}
