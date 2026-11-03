// Filtering strength, answer derivation and the final Verdict. Source of truth: docs/spec/decision-engine.md
// Sections 1, 2.3 and 2.4, docs/spec/requirements.md §4 (REQ-RULE-5) and §7.
import { activeRules, isTopicKeep, sortByRef, type ExactStageOutcome } from './rules';
import type { Rule, Settings, Verdict } from './types';

/**
 * P(remove) cutoffs per preset and pass. clef-flash scores Tiles' text high and thumbnails low, so each pass
 * has its own presets (docs/spec/decision-engine.md Section 2.3).
 */
export const STRENGTH_PRESETS = {
  cautious: { text: 0.9, thumbnail: 0.85 },
  balanced: { text: 0.75, thumbnail: 0.6 },
  eager: { text: 0.55, thumbnail: 0.35 },
} as const;
export type ModelPass = 'text' | 'thumbnail';
export const CUSTOM_CUTOFF_MIN = 0.05;
export const CUSTOM_CUTOFF_MAX = 0.95;

/**
 * P(remove) at or above which a Topic rule (`text`) or Thumbnail rule (`thumbnail`) removes a Tile. The
 * custom value applies to both passes, clamped to [0.05, 0.95] and snapped to 0.05 steps. A non-finite
 * custom value falls back to Balanced.
 */
export function removeCutoff(strength: Settings['strength'], pass: ModelPass): number {
  if (strength.preset !== 'custom') return STRENGTH_PRESETS[strength.preset][pass];
  if (!Number.isFinite(strength.custom)) return STRENGTH_PRESETS.balanced[pass];
  const clamped = Math.min(CUSTOM_CUTOFF_MAX, Math.max(CUSTOM_CUTOFF_MIN, strength.custom));
  return Math.round(clamped * 20) / 20;
}

/** A Topic Keep noul at or above this protects the Tile (decision-engine.md §2.3 step 1). */
export const P_KEEP_THRESHOLD = 0.5;

/**
 * Stage 6 "matched a Rule" for the thumbnail gate when the remove ref's P(remove) is at least this.
 * Independent of Filtering strength on purpose: changing strength must never trigger new model calls.
 */
export const STAGE6_MATCH_THRESHOLD = 0.5;

/** Text pass result as stored in the Verdict cache (decision-engine.md §1.2). */
export interface TextModelResult {
  pRemove: number;
  ref?: string;
  pKeep?: number;
  keepRef?: string;
  model: string;
  /** Only the Topic Keep questions were asked (exact remove pending), so pRemove is not an answer. */
  keepOnly?: true;
}

/** Thumbnail pass result as stored in the Verdict cache (decision-engine.md §1.2). */
export interface ThumbModelResult {
  p: number;
  ref?: string;
  model: string;
}

const isProbability = (v: unknown): v is number => typeof v === 'number' && v >= 0 && v <= 1;

/**
 * decision-engine.md §2.3 steps 2-4. With `probabilities`: P(remove) = 1 - probabilities.keep and ref =
 * argmax over the rule options (first one wins a tie). Without: confidence of the chosen option. Null when
 * the answer cannot be used (no valid keep probability, or no choice and confidence).
 */
export function deriveChoiceAnswer(answer: {
  choice?: string;
  probabilities?: Record<string, number>;
  confidence?: number;
}): { pRemove: number; ref?: string } | null {
  const probs = answer.probabilities;
  if (probs) {
    if (!isProbability(probs.keep)) return null;
    let ref: string | undefined;
    let best = -Infinity;
    for (const [key, p] of Object.entries(probs)) {
      if (key !== 'keep' && isProbability(p) && p > best) {
        best = p;
        ref = key;
      }
    }
    return ref === undefined ? { pRemove: 1 - probs.keep } : { pRemove: 1 - probs.keep, ref };
  }
  if (typeof answer.choice !== 'string' || !isProbability(answer.confidence)) return null;
  if (answer.choice === 'keep') return { pRemove: 1 - answer.confidence };
  return { pRemove: answer.confidence, ref: answer.choice };
}

/** Noul framing (§2.4): P(remove) = max over the Tile's rule questions, ref = argmax. Invalid values are ignored. */
export function deriveNoulAnswers(pByRef: Record<string, number>): { pRemove: number; ref?: string } {
  let ref: string | undefined;
  let best = 0;
  for (const [key, p] of Object.entries(pByRef)) {
    if (isProbability(p) && (ref === undefined || p > best)) {
      best = p;
      ref = key;
    }
  }
  return ref === undefined ? { pRemove: 0 } : { pRemove: best, ref };
}

/**
 * Topic Keep answers (§2.3 step 1): one noul per Tile and Topic Keep rule, keyed by keepRef.
 * pKeep = max, keepRef = argmax (first wins a tie). Invalid values are ignored. Without any valid
 * answer, pKeep is 0 and keepRef is absent.
 */
export function deriveKeepAnswers(pByKeepRef: Record<string, number>): { pKeep: number; keepRef?: string } {
  const { pRemove, ref } = deriveNoulAnswers(pByKeepRef);
  return ref === undefined ? { pKeep: pRemove } : { pKeep: pRemove, keepRef: ref };
}

/**
 * Whether stage 7 (Thumbnail rules) should run for a Tile, given its stage 6 result. Call it only
 * when an enabled Thumbnail rule exists.
 * - No Topic rules or Topic Keep rules: true (there was nothing to judge in stage 6).
 * - Topic rules exist but no text result yet: false (stage 6 must answer first).
 * - Otherwise true only when stage 6 matched no Rule at all: no keep match (pKeep ≥ P_KEEP_THRESHOLD)
 *   and no remove match (a remove `ref` with pRemove ≥ STAGE6_MATCH_THRESHOLD).
 */
export function needsThumbnailPass(text: TextModelResult | undefined, hasTopicRules: boolean): boolean {
  if (!hasTopicRules) return true;
  if (!text) return false;
  if (text.pKeep !== undefined && text.pKeep >= P_KEEP_THRESHOLD) return false;
  return !(text.ref !== undefined && text.pRemove >= STAGE6_MATCH_THRESHOLD);
}

/**
 * Combines stages 1-7 into the final Verdict, applying Filtering strength at read time. In order:
 * 1. Exact Keep rule or Exception (`exact.kind === 'keep'`) -> keep with that source, and `rescuedFrom`
 *    from `exact.rescuedFrom`.
 * 2. Topic Keep: `text.pKeep ≥ P_KEEP_THRESHOLD` -> keep, source 'keepRule'. Beats every remove,
 *    including an Exact remove and a Banned channel. ruleRef is `text.keepRef` (the argmax Keep rule from
 *    `deriveKeepAnswers`) when it names a known Rule, else the first enabled Topic Keep rule by ref order.
 *    A Rescue names the remove it beat in `rescuedFrom`: the pending Exact remove or Banned channel, else
 *    the text pass remove `ref` when its pRemove reaches `removeCutoff(strength, 'text')`. The thumbnail
 *    pass never runs for these Tiles, so a Thumbnail rule is never named.
 * 3. Exact remove -> remove with its source 'exact' and nativeAction. When an enabled Topic Keep rule exists
 *    and no keep answer (`text.pKeep`) is available, returns undefined (held undecided, keepCheckUnavailable).
 * 4. No enabled remove Topic rule or Thumbnail rule -> keep, source 'exact' (no Rule matched, no model needed).
 *    Topic Keep rules alone never hold the Tile: with nothing that could remove it, their answer cannot change the keep.
 * 5. Text pass: a remove `ref` with `pRemove ≥ removeCutoff(strength, 'text')` -> remove, source 'model', Not interested.
 * 6. Thumbnail pass: a `ref` with `p ≥ removeCutoff(strength, 'thumbnail')` -> remove, source 'modelThumbnail', Not interested.
 * 7. Returns undefined when a needed pass has no result yet: Topic rules exist and `text` is missing, or a
 *    Thumbnail rule exists, `needsThumbnailPass` is true and `thumb` is missing.
 * 8. Otherwise keep, source 'model', no ruleRef, probability = the text P(remove), else the thumbnail one.
 *
 * `keepRules` are the Keep rules (Topic Keep ones are picked out here). `rulesByRef` maps the refs of all
 * current Rules to Rules and is used to attribute model Verdicts and to see which model kinds are enabled.
 */
export function finalVerdict(args: {
  videoId: string;
  exact: ExactStageOutcome;
  text?: TextModelResult;
  thumb?: ThumbModelResult;
  keepRules: Rule[];
  rulesByRef: Map<string, Rule>;
  strength: Settings['strength'];
  rulesVersion: string;
  now: number;
}): Verdict | undefined {
  const { exact, text, thumb, rulesByRef } = args;
  const base = { videoId: args.videoId, rulesVersion: args.rulesVersion, at: args.now };
  const attribution = (rule: Rule | undefined, ref?: string) =>
    rule ? { ruleId: rule.id, ruleRef: rule.ref } : ref === undefined ? {} : { ruleRef: ref };

  const rescue = (beaten: Rule | undefined) => (beaten ? { rescuedFrom: beaten.id } : {});

  if (exact.kind === 'keep') return { ...base, outcome: 'keep', source: exact.source, ...attribution(exact.rule), ...rescue(exact.rescuedFrom) };

  const topicKeeps = sortByRef(activeRules(args.keepRules).filter(isTopicKeep));
  if (text?.pKeep !== undefined && text.pKeep >= P_KEEP_THRESHOLD) {
    const named = text.keepRef === undefined ? undefined : rulesByRef.get(text.keepRef);
    const beaten =
      exact.kind === 'remove'
        ? exact.rule
        : text.ref !== undefined && text.pRemove >= removeCutoff(args.strength, 'text')
          ? rulesByRef.get(text.ref)
          : undefined;
    return { ...base, outcome: 'keep', source: 'keepRule', ...attribution(named ?? topicKeeps[0]), ...rescue(beaten) };
  }

  if (exact.kind === 'remove') {
    if (topicKeeps.length > 0 && text?.pKeep === undefined) return undefined;
    return { ...base, outcome: 'remove', source: 'exact', nativeAction: exact.nativeAction, ...attribution(exact.rule) };
  }

  const live = activeRules([...rulesByRef.values()]);
  const hasTopicRemove = live.some((r) => r.kind === 'topic' && r.polarity === 'remove');
  const hasThumb = live.some((r) => r.kind === 'thumbnail' && r.polarity === 'remove');
  const hasTopicRules = hasTopicRemove || topicKeeps.length > 0;
  if (!hasTopicRemove && !hasThumb) return { ...base, outcome: 'keep', source: 'exact' };

  if (text?.ref !== undefined && text.pRemove >= removeCutoff(args.strength, 'text')) {
    return {
      ...base,
      outcome: 'remove',
      source: 'model',
      probability: text.pRemove,
      nativeAction: 'notInterested',
      ...attribution(rulesByRef.get(text.ref), text.ref),
    };
  }
  if (thumb?.ref !== undefined && thumb.p >= removeCutoff(args.strength, 'thumbnail')) {
    return {
      ...base,
      outcome: 'remove',
      source: 'modelThumbnail',
      probability: thumb.p,
      nativeAction: 'notInterested',
      ...attribution(rulesByRef.get(thumb.ref), thumb.ref),
    };
  }

  if (hasTopicRules && !text) return undefined;
  if (hasThumb && !thumb && needsThumbnailPass(text, hasTopicRules)) return undefined;

  // Reaching here means text exists whenever Topic rules do, and thumb exists otherwise.
  return { ...base, outcome: 'keep', source: 'model', probability: text ? text.pRemove : thumb!.p };
}
