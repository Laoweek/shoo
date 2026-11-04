// Hashing and identifiers. Source of truth: docs/spec/architecture.md Section 9 (rulesVersion, exactVersion)
// and docs/spec/decision-engine.md Section 2.2 (short question ids).
import { EXACT_KINDS, MODEL_KINDS, type Rule } from './types';

const encoder = new TextEncoder();

/** FNV-1a over the UTF-8 bytes of `s`, as an unsigned 32-bit integer. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (const byte of encoder.encode(s)) {
    h ^= byte;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const FNV64_OFFSET = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

/** FNV-1a 64-bit over the UTF-8 bytes of `s`, as 16 lowercase hex characters. */
export function fnv1a64(s: string): string {
  let h = FNV64_OFFSET;
  for (const byte of encoder.encode(s)) {
    h ^= BigInt(byte);
    h = (h * FNV64_PRIME) & MASK64;
  }
  return h.toString(16).padStart(16, '0');
}

const MAX_QUESTIONS = 99;

/** Short Tile id for a request: 0 -> 't01', 15 -> 't16'. Never a videoId (REQ-PRIV-1). */
export function questionId(i: number): string {
  if (!Number.isInteger(i) || i < 0 || i >= MAX_QUESTIONS) throw new RangeError(`questionId index out of range: ${i}`);
  return `t${String(i + 1).padStart(2, '0')}`;
}

/** The question for one Tile and one Topic Keep rule (decision-engine.md §2.2): (0, 'K2') -> 't01_K2'. */
export function keepQuestionId(i: number, keepRef: string): string {
  return `${questionId(i)}_${keepRef}`;
}

export interface RulesVersionInputs {
  rules: Rule[];
  models: { text: string; image: string };
  textFraming: string;
  requestShapeVersion: number;
  engine: 'openrouter' | 'direct' | 'custom';
  direct?: { provider: string; baseUrl: string; model: string };
  customEndpoint?: { baseUrl: string; model: string };
}

const isLive = (r: Rule) => r.enabled && r.deletedAt === undefined;

/** A Site-only rule's tuple ends with its Site. Rules for every Site keep the tuple they had before Sites. */
const withSite = (r: Rule, tuple: string[]): string[] => (r.site ? [...tuple, r.site] : tuple);

function compareTuples(a: readonly string[], b: readonly string[]): number {
  const ka = JSON.stringify(a);
  const kb = JSON.stringify(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/**
 * Everything that changes what the model is asked (architecture.md Section 9): enabled, non-deleted
 * Topic and Thumbnail Rules (remove and Topic Keep) as sorted [ref, polarity, kind, text, site?], both model
 * slugs, the text framing, the request shape version, and the direct or custom endpoint only when it is in use.
 * The parts are hashed as one JSON array so field boundaries cannot collide.
 */
export function rulesVersion(i: RulesVersionInputs): string {
  const tuples = i.rules
    .filter((r) => isLive(r) && MODEL_KINDS.includes(r.kind))
    .map((r) => withSite(r, [r.ref, r.polarity, r.kind, r.text]))
    .sort(compareTuples);
  const custom = i.engine === 'custom' && i.customEndpoint ? [i.customEndpoint.baseUrl, i.customEndpoint.model] : null;
  const parts: unknown[] = [tuples, i.models.text, i.models.image, i.textFraming, i.requestShapeVersion, custom];
  // Appended only when in use, so the rulesVersion of OpenRouter and custom endpoint users is unchanged.
  if (i.engine === 'direct' && i.direct) parts.push([i.direct.provider, i.direct.baseUrl, i.direct.model]);
  return fnv1a64(JSON.stringify(parts));
}

function sortedParams(r: Rule): [string, unknown][] {
  return Object.entries(r.params ?? {})
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1));
}

/**
 * Key for the compiled Exact matchers (architecture.md Section 9): every enabled, non-deleted Exact rule
 * (keep and remove) with the fields matching depends on, `skipSubscribed` included, plus `regexEnabled`.
 */
export function exactVersion(rules: Rule[], regexEnabled: boolean): string {
  const tuples = rules
    .filter((r) => isLive(r) && EXACT_KINDS.includes(r.kind))
    // skipSubscribed and site are appended only when set, so the exactVersion of Rules without them is unchanged.
    .map((r) => withSite(r, [r.id, r.ref, r.polarity, r.kind, r.text, JSON.stringify(sortedParams(r)), ...(r.skipSubscribed ? ['skipSubscribed'] : [])]))
    .sort(compareTuples);
  return fnv1a64(JSON.stringify([tuples, regexEnabled]));
}

/**
 * The Verdict cache key for a Tile from a Subscribed channel (architecture.md Section 9): such a Tile is asked
 * without the model Rules that skip Subscribed channels, so its answers are kept apart. `skippedRefs` are the
 * refs left out. With none, the key is `rulesVersion` itself.
 */
export function cacheVersion(rulesVersion: string, skippedRefs: readonly string[]): string {
  if (skippedRefs.length === 0) return rulesVersion;
  return fnv1a64(JSON.stringify([rulesVersion, [...skippedRefs].sort()]));
}

/** Random UUID for a new Rule or Activity event. */
export function newId(): string {
  return globalThis.crypto.randomUUID();
}
