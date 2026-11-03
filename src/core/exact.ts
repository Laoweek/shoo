// Exact rule matching. Source of truth: docs/spec/requirements.md "Exact rule semantics" and
// docs/spec/architecture.md Sections 5, 9 and 13. Compiled once per exactVersion in the background.
import { channelKey, channelsMatch, ruleChannelIdentity, tileChannelIdentity } from './channel';
import { exactVersion } from './ids';
import { compileSafeRegex, validateRegex } from './regex';
import { isBannedChannel, sortByRef } from './rules';
import { EXACT_KINDS, type Rule, type TileFacts } from './types';

/** NFKC, casefolded, trimmed, whitespace collapsed. The same normalization as ChannelKey. */
export function normalizeText(s: string): string {
  return channelKey(s);
}

export const REGEX_TITLE_CAP = 300;

/**
 * Wildcard matcher for pattern Rules: `*` matches any run (including none), `?` exactly one character
 * (code point). Unanchored: the pattern may match anywhere in the title. Every other character is
 * literal. Hand-written, so there is no regex injection and matching stays O(pattern × title).
 * The pattern is normalized like the title.
 */
export function patternToMatcher(pattern: string): (normTitle: string) => boolean {
  const p = Array.from(`*${normalizeText(pattern)}*`.replace(/\*+/g, '*'));
  return (normTitle) => {
    const t = Array.from(normTitle);
    let pi = 0;
    let ti = 0;
    let star = 0; // p[0] is always '*', so there is always a star to backtrack to
    let mark = 0;
    while (ti < t.length) {
      if (p[pi] === '*') {
        star = pi++;
        mark = ti;
      } else if (p[pi] === '?' || p[pi] === t[ti]) {
        pi++;
        ti++;
      } else {
        pi = star + 1;
        ti = ++mark;
      }
    }
    while (p[pi] === '*') pi++;
    return pi === p.length;
  };
}

type Matcher = (t: TileFacts) => boolean;
type Compiled = { ok: true; match: Matcher } | { ok: false; reason: string };

/** Title kinds never match a Tile that shows no title (unknown field = no match). */
function onTitle(test: (normTitle: string) => boolean): Matcher {
  return (t) => {
    const title = normalizeText(t.title);
    return title !== '' && test(title);
  };
}

function compileRule(rule: Rule, regexEnabled: boolean): Compiled {
  const p = rule.params ?? {};
  switch (rule.kind) {
    case 'channel': {
      const id = ruleChannelIdentity(rule);
      if (!id) return { ok: false, reason: 'noChannel' };
      return {
        ok: true,
        match: (t) => {
          const tile = tileChannelIdentity(t);
          return tile !== undefined && channelsMatch(id, tile);
        },
      };
    }
    case 'keyword': {
      const kw = normalizeText(rule.text);
      if (!kw) return { ok: false, reason: 'empty' };
      return { ok: true, match: onTitle((title) => title.includes(kw)) };
    }
    case 'pattern': {
      if (!normalizeText(rule.text)) return { ok: false, reason: 'empty' };
      return { ok: true, match: onTitle(patternToMatcher(rule.text)) };
    }
    case 'regex': {
      if (!regexEnabled) return { ok: false, reason: 'regexDisabled' };
      if (!rule.text.trim()) return { ok: false, reason: 'empty' };
      const check = validateRegex(rule.text);
      if (!check.ok) return { ok: false, reason: check.reason };
      const re = compileSafeRegex(rule.text)!;
      return { ok: true, match: onTitle((title) => re.test(title.slice(0, REGEX_TITLE_CAP))) };
    }
    case 'duration': {
      const min = p.minSeconds ?? 0;
      const max = p.maxSeconds ?? Infinity;
      if ((p.minSeconds === undefined && p.maxSeconds === undefined) || !(min >= 0 && min <= max)) {
        return { ok: false, reason: 'durationBounds' };
      }
      return { ok: true, match: (t) => t.durationSec !== undefined && t.durationSec >= min && t.durationSec <= max };
    }
    case 'views': {
      const min = p.minViews ?? 0;
      const max = p.maxViews ?? Infinity;
      if ((p.minViews === undefined && p.maxViews === undefined) || !(min >= 0 && min <= max)) {
        return { ok: false, reason: 'viewsBounds' };
      }
      return { ok: true, match: (t) => t.viewCount !== undefined && t.viewCount >= min && t.viewCount <= max };
    }
    case 'short':
      return { ok: true, match: (t) => t.isShort };
    case 'live':
      return { ok: true, match: (t) => t.isLive };
    case 'membersOnly':
      return { ok: true, match: (t) => t.isMembersOnly };
    case 'artistChannel':
      // Keep only. Synced Rules skip validateRuleInput, so a remove one must never compile into a Removal.
      if (rule.polarity !== 'keep') return { ok: false, reason: 'artistChannelRemove' };
      return { ok: true, match: (t) => t.isArtistChannel === true };
    default:
      // Model kinds, and kinds from a newer Shoo on another device, are not Exact rules here.
      return { ok: false, reason: 'notExact' };
  }
}

/**
 * Whether one Rule matches one Tile, ignoring `enabled` and `deletedAt` (for tests and Try a title).
 * Model kinds, unknown kinds and invalid Rules never match.
 */
export function matchesRule(rule: Rule, t: TileFacts, regexEnabled: boolean): boolean {
  const c = compileRule(rule, regexEnabled);
  return c.ok && c.match(t);
}

export interface CompiledExact {
  version: string;
  keepRules: Rule[];
  bannedChannels: Rule[];
  removeRules: Rule[];
  invalid: { ruleId: string; reason: string }[];
  matchKeep(t: TileFacts): Rule | undefined;
  /** `subscribed`: the Tile is from a Subscribed channel, so Rules with `skipSubscribed` are passed over. */
  matchBanned(t: TileFacts, subscribed?: boolean): Rule | undefined;
  matchRemove(t: TileFacts, subscribed?: boolean): Rule | undefined;
}

/**
 * Compiles every enabled, non-deleted Exact rule. Unknown kinds (from newer devices) are skipped as
 * disabled. Rules that cannot run land in `invalid` with a reason ('regexDisabled', a RegexCheck reason,
 * 'noChannel', 'empty', 'durationBounds', 'viewsBounds', 'artistChannelRemove') and never match. Each list is
 * in ref order and each matcher returns the first match in that order.
 */
export function compileExact(rules: Rule[], regexEnabled: boolean): CompiledExact {
  const keepRules: Rule[] = [];
  const bannedChannels: Rule[] = [];
  const removeRules: Rule[] = [];
  const invalid: { ruleId: string; reason: string }[] = [];
  const matchers = new Map<string, Matcher>();

  for (const rule of sortByRef(rules)) {
    if (!rule.enabled || rule.deletedAt !== undefined || !EXACT_KINDS.includes(rule.kind)) continue;
    const c = compileRule(rule, regexEnabled);
    if (!c.ok) {
      invalid.push({ ruleId: rule.id, reason: c.reason });
      continue;
    }
    matchers.set(rule.id, c.match);
    if (rule.polarity === 'keep') keepRules.push(rule);
    else if (isBannedChannel(rule)) bannedChannels.push(rule);
    else removeRules.push(rule);
  }

  const first =
    (list: Rule[]) =>
    (t: TileFacts, subscribed = false) =>
      list.find((r) => !(subscribed && r.skipSubscribed) && matchers.get(r.id)!(t));
  return {
    version: exactVersion(rules, regexEnabled),
    keepRules,
    bannedChannels,
    removeRules,
    invalid,
    matchKeep: first(keepRules),
    matchBanned: first(bannedChannels),
    matchRemove: first(removeRules),
  };
}
