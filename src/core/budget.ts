// State token budget for the text pass. Source of truth: docs/spec/decision-engine.md Sections 2.2 and 3.
import { activeRules, sortByRef } from './rules';
import type { Exception, Rule } from './types';

/** Estimated tokens the `state` object may use. Cloudflare reads about 2,000 and drops the rest silently. */
export const STATE_TOKEN_BUDGET = 1800;
export const MAX_KEPT_EXAMPLES = 10;
export const TRUNCATED_RULE_CHARS = 160;

/** Workers AI rejects more than 64 questions per request (decision-engine.md §2.2 and §5.3). */
export const MAX_QUESTIONS_PER_REQUEST = 64;
export const MAX_TILES_PER_BATCH = 16;

/**
 * Tiles per text request with the choice framing: one choice question plus one noul per Topic Keep rule
 * per Tile, so min(16, floor(64 / (1 + topicKeepRules))). Never below 1. With more than 63 Topic Keep
 * rules engine/judge.ts splits the Keep rules across requests.
 */
export function textBatchSize(topicKeepRules: number): number {
  return Math.max(1, Math.min(MAX_TILES_PER_BATCH, Math.floor(MAX_QUESTIONS_PER_REQUEST / (1 + Math.max(0, topicKeepRules)))));
}

/**
 * Conservative token estimate of the JSON: a quarter token per ASCII character, as English measured, and one per
 * other UTF-16 unit. A Chinese character is at most about one token, so counting it as a quarter would let a
 * Chinese state pass Cloudflare's reading limit unseen.
 */
export function estimateTokens(obj: unknown): number {
  const json = JSON.stringify(obj);
  let ascii = 0;
  for (let i = 0; i < json.length; i++) if (json.charCodeAt(i) < 0x80) ascii++;
  return Math.ceil(ascii / 4 + (json.length - ascii));
}

/**
 * The most of a title and a channel name a request carries. Real ones are far shorter (YouTube allows 100
 * characters for a title, Bilibili 80), so this only bounds what a hostile page can put in a request.
 */
export const PROMPT_TITLE_MAX = 300;
export const PROMPT_CHANNEL_MAX = 100;

/** The first `max` code points of `s`, so a cut never splits a surrogate pair. */
export function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return Array.from(s).slice(0, max).join('');
}

export interface ModelState {
  viewer_does_not_want: Record<string, string>;
  viewer_always_wants?: Record<string, string>;
  viewer_kept_anyway?: string[];
}

const exampleText = (e: Exception) => {
  const title = clip(e.title, PROMPT_TITLE_MAX);
  return e.channelName ? `${title} (channel: ${clip(e.channelName, PROMPT_CHANNEL_MAX)})` : title;
};

/**
 * Builds the `state` object for a text request and fits it into STATE_TOKEN_BUDGET. Uses enabled,
 * non-deleted Rules in ref order and the 10 most recent Exceptions (newest first). When over budget:
 * drop Exceptions oldest first, down to none, then truncate the longest Rule texts to 160 characters
 * (longest first) and report their refs. Stored Rules are never changed. Empty optional keys are omitted.
 * The result can still exceed the budget when even truncated Rules do not fit. Callers compare
 * `usedTokens` with `budget`.
 */
export function fitState(
  removeTopicRules: Rule[],
  keepTopicRules: Rule[],
  exceptions: Exception[],
): {
  state: ModelState;
  droppedExceptions: number;
  truncatedRefs: string[];
  usedTokens: number;
  budget: number;
} {
  const texts = new Map<string, string>();
  const remove = sortByRef(activeRules(removeTopicRules));
  const keep = sortByRef(activeRules(keepTopicRules));
  for (const r of [...remove, ...keep]) texts.set(r.ref, r.text);
  const examples = [...exceptions]
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_KEPT_EXAMPLES)
    .map(exampleText);

  const build = (): ModelState => {
    const state: ModelState = { viewer_does_not_want: Object.fromEntries(remove.map((r) => [r.ref, texts.get(r.ref)!])) };
    if (keep.length) state.viewer_always_wants = Object.fromEntries(keep.map((r) => [r.ref, texts.get(r.ref)!]));
    if (examples.length) state.viewer_kept_anyway = [...examples];
    return state;
  };

  let state = build();
  let droppedExceptions = 0;
  while (estimateTokens(state) > STATE_TOKEN_BUDGET && examples.length) {
    examples.pop();
    droppedExceptions++;
    state = build();
  }

  const truncatedRefs: string[] = [];
  const longFirst = [...texts.entries()]
    .map(([ref, text]) => ({ ref, chars: Array.from(text) }))
    .filter((t) => t.chars.length > TRUNCATED_RULE_CHARS)
    .sort((a, b) => b.chars.length - a.chars.length);
  for (const { ref, chars } of longFirst) {
    if (estimateTokens(state) <= STATE_TOKEN_BUDGET) break;
    texts.set(ref, chars.slice(0, TRUNCATED_RULE_CHARS).join(''));
    truncatedRefs.push(ref);
    state = build();
  }

  return { state, droppedExceptions, truncatedRefs, usedTokens: estimateTokens(state), budget: STATE_TOKEN_BUDGET };
}
