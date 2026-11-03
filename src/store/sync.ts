// Rules, Keep rules, Banned channels and the newest Exceptions in storage.sync. Source of truth:
// docs/spec/architecture.md Section 8 ("storage.sync"), REQ-RULE-6, REQ-RULE-10.
import { fnv1a32 } from '~/core/ids';
import { INITIAL_COUNTERS, resolveRefCollisions, type RefCounters } from '~/core/rules';
import type { ColourCode, Exception, Polarity, Rule, RuleKind, RuleParams } from '~/core/types';
import { channelKey } from '~/core/channel';
import { getDefined, isRateLimitError, isRecord, itemBytes, type AreaLike } from './areas';
import { withQuotaRetry } from './local';
import { META_KEY, SCHEMA, type SyncMeta } from './schema';

export const RULE_BUCKETS = 8;
export const RULE_BUCKET_BYTES = 7680; // 7.5 KB, key included. 8 buckets = 60 KB
export const EXC_BUCKETS = 4;
export const EXC_BUCKET_BYTES = 6400; // 4 buckets = 25 KB
export const EXC_SYNC_MAX = 150;
export const EXC_TITLE_MAX = 80;
export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Clock skew allowance: a tombstone the other side already purged is dropped this much early. */
export const TOMBSTONE_SKEW_MS = 24 * 60 * 60 * 1000;
export const SYNC_DEBOUNCE_MS = 1000;
export const RATE_LIMIT_BACKOFF_MS = [5_000, 15_000, 60_000] as const;

export const ruleBucketKey = (i: number) => `rules:b${i}`;
export const excBucketKey = (i: number) => `exc:b${i}`;
const RULE_KEY_RE = /^rules:b\d+$/;
const EXC_KEY_RE = /^exc:b\d+$/;

/** Whether a sync key belongs to Shoo's synced data (for onChanged filtering). */
export const isSyncDataKey = (key: string): boolean => key === META_KEY || RULE_KEY_RE.test(key) || EXC_KEY_RE.test(key);

/**
 * `sync:meta` with its optional fields. `excRemoved`: recent single Exception removals as videoId -> removedAt, so
 * a deletion is not mistaken for an eviction on other devices. `excEpoch`: raised by Reset and a replace
 * import, every synced Exception carries the epoch it was written in (`ep`), and one from an older epoch
 * is gone. `rulesClearedAt`: set by Reset and a replace import, a Rule whose `updatedAt` is not after it is
 * gone. Both survive any number of removals in a few bytes, and both only ever grow.
 */
export interface StoredSyncMeta extends SyncMeta {
  excRemoved?: Record<string, number>;
  excEpoch?: number;
  rulesClearedAt?: number;
}

/** What is gone in bulk: Exceptions from an epoch below `excEpoch`, Rules not updated after `rulesClearedAt`. */
export interface ClearFloor {
  excEpoch: number;
  rulesClearedAt: number;
}

const floorOf = (m: StoredSyncMeta): ClearFloor => ({ excEpoch: m.excEpoch ?? 0, rulesClearedAt: m.rulesClearedAt ?? 0 });

// ---------------------------------------------------------------------------------------------------
// Compact mapping (keys exactly as in Section 8)

export interface CompactRule {
  i: string;
  r: string;
  p: Polarity;
  k: RuleKind;
  t: string;
  /** Rule name (REQ-RULE-11). Older versions keep it as an unknown field. */
  n?: string;
  pa?: RuleParams;
  c?: ColourCode;
  /** skipSubscribed (REQ-RULE-14), only when set. Older versions keep it as an unknown field. */
  ss?: 1;
  /** `e` and `o` are left out of tombstones. */
  e?: boolean;
  o?: Rule['origin'];
  ca: number;
  ua: number;
  da?: number;
}

export interface CompactException {
  v: string;
  t: string;
  cn?: string;
  ck?: string;
  ri?: string;
  a: number;
  /** The `excEpoch` it was written in, omitted for 0. */
  ep?: number;
}

const RULE_FIELDS = new Set(['i', 'r', 'p', 'k', 't', 'n', 'pa', 'c', 'ss', 'e', 'o', 'ca', 'ua', 'da']);

/** Unknown compact fields written by a newer Shoo, kept so a rewrite here does not drop them. */
export type RuleExtras = Record<string, unknown>;

/**
 * A tombstone keeps only what merging and ref allocation need, so it is always smaller than the live Rule
 * it replaces: deleting a Rule always shrinks what storage.sync holds, even over its budget.
 */
export function toCompactRule(r: Rule, extras?: RuleExtras): CompactRule {
  if (r.deletedAt !== undefined) return { i: r.id, r: r.ref, p: r.polarity, k: r.kind, t: '', ca: r.createdAt, ua: r.updatedAt, da: r.deletedAt };
  const c: CompactRule = { ...(extras as object), i: r.id, r: r.ref, p: r.polarity, k: r.kind, t: r.text, e: r.enabled, o: r.origin, ca: r.createdAt, ua: r.updatedAt };
  if (r.name) c.n = r.name;
  if (r.params && Object.keys(r.params).length > 0) c.pa = r.params;
  if (r.colour) c.c = r.colour;
  if (r.skipSubscribed) c.ss = 1;
  return c;
}

/** The tombstone of `r` deleted at `at`, exactly as storage.sync holds it. */
export const tombstone = (r: Rule, at: number): Rule => fromCompactRule(toCompactRule({ ...r, updatedAt: at, deletedAt: at }))!.rule;

/** Undefined for a corrupt entry. Unknown `kind` values pass through untouched (Section 8). */
export function fromCompactRule(raw: unknown): { rule: Rule; extras?: RuleExtras } | undefined {
  if (!isRecord(raw)) return undefined;
  const { i, r, p, k, t, n, pa, c, ss, e, o, ca, ua, da } = raw;
  if (typeof i !== 'string' || typeof r !== 'string' || typeof p !== 'string' || typeof k !== 'string' || typeof t !== 'string') return undefined;
  if (typeof ca !== 'number' || typeof ua !== 'number') return undefined;
  const rule: Rule = {
    id: i,
    ref: r,
    polarity: p as Polarity,
    kind: k as RuleKind,
    text: t,
    enabled: e === true,
    origin: (typeof o === 'string' ? o : 'user') as Rule['origin'],
    createdAt: ca,
    updatedAt: ua,
  };
  if (typeof n === 'string') rule.name = n;
  if (isRecord(pa)) rule.params = pa as RuleParams;
  if (typeof c === 'string') rule.colour = c as ColourCode;
  if (ss === 1) rule.skipSubscribed = true;
  if (typeof da === 'number') rule.deletedAt = da;
  const extraEntries = Object.entries(raw).filter(([key]) => !RULE_FIELDS.has(key));
  return extraEntries.length > 0 ? { rule, extras: Object.fromEntries(extraEntries) } : { rule };
}

/**
 * Titles are truncated to 80 characters. `ck` is stored only when it is not `channelKey(cn)`, and the
 * reader derives it back, so an Exception with a channel name always reads with its ChannelKey.
 */
export function toCompactException(x: Exception, epoch = 0): CompactException {
  const c: CompactException = { v: x.videoId, t: truncate(x.title, EXC_TITLE_MAX), a: x.at };
  if (x.channelName) c.cn = x.channelName;
  if (x.channelKey && (!x.channelName || x.channelKey !== channelKey(x.channelName))) c.ck = x.channelKey;
  if (x.ruleId) c.ri = x.ruleId;
  if (epoch > 0) c.ep = epoch;
  return c;
}

/** Cuts to `max` UTF-16 units without leaving half a surrogate pair. */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

export function fromCompactException(raw: unknown): Exception | undefined {
  if (!isRecord(raw)) return undefined;
  const { v, t, cn, ck, ri, a } = raw;
  if (typeof v !== 'string' || typeof t !== 'string' || typeof a !== 'number') return undefined;
  const x: Exception = { videoId: v, title: t, at: a };
  if (typeof cn === 'string') x.channelName = cn;
  if (typeof ck === 'string') x.channelKey = ck;
  else if (typeof cn === 'string') x.channelKey = channelKey(cn);
  if (typeof ri === 'string') x.ruleId = ri;
  return x;
}

// ---------------------------------------------------------------------------------------------------
// Packing

export type Buckets = Record<string, Record<string, unknown>>;

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Places each Rule in bucket `fnv1a32(id) % 8`, or the next bucket with room (linear probing), so no
 * bucket exceeds 7.5 KB including its key. Deterministic for a given set. Null when a Rule fits nowhere.
 */
export function packRules(rules: Rule[], extras: Map<string, RuleExtras> = new Map()): Buckets | null {
  const buckets: Record<string, CompactRule>[] = Array.from({ length: RULE_BUCKETS }, () => ({}));
  const sizes = buckets.map((_, i) => itemBytes(ruleBucketKey(i), {}));
  for (const rule of [...rules].sort((a, b) => byText(a.id, b.id))) {
    const compact = toCompactRule(rule, extras.get(rule.id));
    // Adding one entry to a non-empty object costs its key, the colon, the value and one comma.
    const entryBytes = itemBytes(JSON.stringify(rule.id), compact) + 2;
    const home = fnv1a32(rule.id) % RULE_BUCKETS;
    let placed = false;
    for (let step = 0; step < RULE_BUCKETS && !placed; step++) {
      const b = (home + step) % RULE_BUCKETS;
      if (sizes[b]! + entryBytes <= RULE_BUCKET_BYTES) {
        buckets[b]![rule.id] = compact;
        sizes[b] = sizes[b]! + entryBytes;
        placed = true;
      }
    }
    if (!placed) return null;
  }
  return Object.fromEntries(buckets.map((b, i) => [ruleBucketKey(i), b]).filter(([, b]) => Object.keys(b as object).length > 0));
}

const newestFirst = (a: Exception, b: Exception) => b.at - a.at || byText(a.videoId, b.videoId);

/**
 * Keeps the newest Exceptions in sync: at most 150, each bucket within 6,400 B (25 KB in all). The rest
 * is returned as `overflow` for `local:exceptions:archive`.
 */
export function packExceptions(exceptions: Exception[], epoch = 0): { buckets: Buckets; synced: Exception[]; overflow: Exception[] } {
  const buckets: Record<string, CompactException>[] = Array.from({ length: EXC_BUCKETS }, () => ({}));
  const sizes = buckets.map((_, i) => itemBytes(excBucketKey(i), {}));
  const synced: Exception[] = [];
  const overflow: Exception[] = [];
  for (const x of [...exceptions].sort(newestFirst)) {
    const compact = toCompactException(x, epoch);
    const entryBytes = itemBytes(JSON.stringify(x.videoId), compact) + 2;
    const home = fnv1a32(x.videoId) % EXC_BUCKETS;
    let placed = false;
    for (let step = 0; step < EXC_BUCKETS && !placed && synced.length < EXC_SYNC_MAX; step++) {
      const b = (home + step) % EXC_BUCKETS;
      if (sizes[b]! + entryBytes <= EXC_BUCKET_BYTES) {
        buckets[b]![x.videoId] = compact;
        sizes[b] = sizes[b]! + entryBytes;
        placed = true;
      }
    }
    if (placed) synced.push(fromCompactException(compact)!);
    else overflow.push(x);
  }
  const out = Object.fromEntries(buckets.map((b, i) => [excBucketKey(i), b]).filter(([, b]) => Object.keys(b as object).length > 0));
  return { buckets: out, synced, overflow };
}

// ---------------------------------------------------------------------------------------------------
// Reading and merging

export interface SyncSnapshot {
  rules: Map<string, Rule>;
  extras: Map<string, RuleExtras>;
  exceptions: Map<string, Exception>;
  /** The `ep` each Exception was written in (0 when absent). */
  excEpochs: Map<string, number>;
  meta: StoredSyncMeta;
}

/**
 * Merges every `rules:b*` and `exc:b*` key, so no index is needed (Section 8). With a `floor`, Rules and
 * Exceptions that a Reset or replace import removed are left out.
 */
export function parseSync(raw: Record<string, unknown>, floor?: ClearFloor): SyncSnapshot {
  const rules = new Map<string, Rule>();
  const extras = new Map<string, RuleExtras>();
  const exceptions = new Map<string, Exception>();
  const excEpochs = new Map<string, number>();
  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    if (RULE_KEY_RE.test(key)) {
      for (const entry of Object.values(value)) {
        const parsed = fromCompactRule(entry);
        if (!parsed || (floor && parsed.rule.updatedAt <= floor.rulesClearedAt)) continue;
        const existing = rules.get(parsed.rule.id);
        if (existing && !newerRule(parsed.rule, existing)) continue;
        rules.set(parsed.rule.id, parsed.rule);
        if (parsed.extras) extras.set(parsed.rule.id, parsed.extras);
        else extras.delete(parsed.rule.id);
      }
    } else if (EXC_KEY_RE.test(key)) {
      for (const entry of Object.values(value)) {
        const x = fromCompactException(entry);
        const ep = isRecord(entry) && typeof entry.ep === 'number' ? entry.ep : 0;
        if (!x || (floor && ep < floor.excEpoch)) continue;
        const prev = exceptions.get(x.videoId);
        if (!prev || newerException(x, prev)) {
          exceptions.set(x.videoId, x);
          excEpochs.set(x.videoId, ep);
        }
      }
    }
  }
  return { rules, extras, exceptions, excEpochs, meta: parseMeta(raw[META_KEY]) };
}

function parseMeta(raw: unknown): StoredSyncMeta {
  const m = isRecord(raw) ? raw : {};
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const meta: StoredSyncMeta = {
    ...m,
    schema: num(m.schema, SCHEMA),
    nextR: num(m.nextR, INITIAL_COUNTERS.nextR),
    nextK: num(m.nextK, INITIAL_COUNTERS.nextK),
    nextColour: num(m.nextColour, INITIAL_COUNTERS.nextColour),
  };
  if (isRecord(m.excRemoved)) meta.excRemoved = mergeRemovals(m.excRemoved as Record<string, number>);
  else delete meta.excRemoved;
  for (const k of ['excEpoch', 'rulesClearedAt'] as const) {
    if (num(m[k], 0) > 0) meta[k] = num(m[k], 0);
    else delete meta[k];
  }
  return meta;
}

const canonRule = (r: Rule) => JSON.stringify(toCompactRule(r));

/** The live Rules in a canonical form, the same for the same Rules in any order. */
export const liveKey = (rules: Iterable<Rule>): string => [...rules].filter((r) => r.deletedAt === undefined).map(canonRule).sort().join('\n');

/** Per id the higher `updatedAt` wins. Ties are broken by the compact JSON, the same on every device. */
export function newerRule(a: Rule, b: Rule): boolean {
  return a.updatedAt > b.updatedAt || (a.updatedAt === b.updatedAt && canonRule(a) > canonRule(b));
}

const newerException = (a: Exception, b: Exception) =>
  a.at > b.at || (a.at === b.at && JSON.stringify(toCompactException(a)) > JSON.stringify(toCompactException(b)));

/**
 * Deterministic Rule merge: per id the newer one wins, tombstones older than 30 days are purged. A
 * tombstone only `ours` still holds is purged a day early, since the other side already dropped it.
 */
export function mergeRules(ours: Map<string, Rule>, theirs: Map<string, Rule>, now: number): Map<string, { rule: Rule; from: 'ours' | 'theirs' }> {
  const out = new Map<string, { rule: Rule; from: 'ours' | 'theirs' }>();
  for (const [id, t] of theirs) out.set(id, { rule: t, from: 'theirs' });
  for (const [id, o] of ours) {
    const t = out.get(id);
    if (!t || newerRule(o, t.rule)) out.set(id, { rule: o, from: 'ours' });
  }
  for (const [id, { rule, from }] of out) {
    if (rule.deletedAt === undefined) continue;
    const age = now - rule.deletedAt;
    if (age > TOMBSTONE_TTL_MS || (from === 'ours' && !theirs.has(id) && age > TOMBSTONE_TTL_MS - TOMBSTONE_SKEW_MS)) out.delete(id);
  }
  return out;
}

/** Removal records kept in `sync:meta.excRemoved` (newest first), about 1.2 KB. */
export const EXC_REMOVED_MAX = 40;

/** Union of removal records, newest per videoId, capped to the 40 newest. Deterministic on every device. */
export function mergeRemovals(...sources: (Record<string, number> | undefined)[]): Record<string, number> {
  const all: Record<string, number> = {};
  for (const src of sources) {
    for (const [v, at] of Object.entries(src ?? {})) {
      if (typeof at !== 'number') continue;
      const prev = all[v];
      if (prev === undefined || !(prev >= at)) all[v] = at;
    }
  }
  const kept = Object.entries(all)
    .sort(([va, a], [vb, b]) => b - a || byText(va, vb))
    .slice(0, EXC_REMOVED_MAX);
  return Object.fromEntries(kept);
}

/**
 * Exception merge. Exceptions have no tombstones, so deletions travel as removal records
 * (`sync:meta.excRemoved`): a removal applies to an Exception that is not newer than it. An Exception
 * this device holds that vanished from `theirs` without a removal record was evicted by another
 * device's packing, so it moves to the local archive. Unconfirmed local adds (`pendingAdds`) are kept.
 */
export function mergeExceptions(
  ours: Map<string, Exception>,
  theirs: Map<string, Exception>,
  removed: Record<string, number>,
  pendingAdds: Set<string>,
): { merged: Exception[]; archive: Exception[] } {
  const isRemoved = (x: Exception) => removed[x.videoId] !== undefined && removed[x.videoId]! >= x.at;
  const merged = new Map<string, Exception>();
  const archive: Exception[] = [];
  for (const [v, t] of theirs) {
    const o = ours.get(v);
    const pick = o && newerException(o, t) ? o : t;
    if (!isRemoved(pick)) merged.set(v, pick);
  }
  for (const [v, o] of ours) {
    if (theirs.has(v) || isRemoved(o)) continue;
    if (pendingAdds.has(v)) merged.set(v, o);
    else archive.push(o);
  }
  return { merged: [...merged.values()], archive };
}

// ---------------------------------------------------------------------------------------------------
// SyncStore: the background's in-memory view, written back with a debounce

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const defaultTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/**
 * Local writes not yet seen in storage.sync, persisted in `local:syncOutbox`. Chrome resolves each sync
 * item by last write wins and the background can stop at any time, so memory alone could lose an edit
 * (a pending debounce, a rate-limit back-off, or a bucket another device overwrote). The outbox is merged
 * as "ours" on every load and merge, and an entry leaves it once storage.sync holds it or something newer.
 */
export interface SyncOutbox {
  rules: Record<string, Rule>;
  added: Record<string, Exception>;
  removed: Record<string, number>;
  counters?: RefCounters;
  /** The epoch `added` and `removed` belong to, or a raised epoch storage.sync has not confirmed yet. */
  excEpoch?: number;
  /** A Rule watermark storage.sync has not confirmed yet. */
  rulesClearedAt?: number;
}

export const OUTBOX_KEY = 'syncOutbox';
/**
 * The highest `excEpoch` and `rulesClearedAt` this device has seen, kept in storage.local (and spared by
 * Reset), so a restart can repair a `sync:meta` that a stale device overwrote.
 */
export const FLOOR_KEY = 'syncFloor';
/** A new `excEpoch` is at least the seconds since 2025-01-01, so two devices that reset apart never pick the same one. */
const EPOCH_ORIGIN_S = 1_735_689_600;
const emptyOutbox = (): SyncOutbox => ({ rules: {}, added: {}, removed: {} });
/** A copy to change before it is persisted, so memory only changes once the save succeeded. */
const copyOutbox = (o: SyncOutbox): SyncOutbox => ({ ...o, rules: { ...o.rules }, added: { ...o.added }, removed: { ...o.removed } });

export interface SyncStoreDeps {
  sync: AreaLike;
  /** Where the outbox is persisted. Without it the outbox lives in memory only. */
  local?: AreaLike;
  now: () => number;
  debounceMs?: number;
  timers?: Timers;
  /** Runs a flush exclusively with other mutations (the writer's queue). */
  runExclusive?: (fn: () => Promise<unknown>) => Promise<unknown>;
  onError?: (e: unknown) => void;
}

export interface RemoteMergeResult {
  changed: boolean;
  renumbered: { ruleId: string; from: string; to: string }[];
  /** Exceptions evicted from sync (by another device or by packing) for the local archive. */
  archive: Exception[];
  /** Removal records: archived Exceptions not newer than these are deleted too. */
  removed: Record<string, number>;
  /** The current Exception epoch: an archive from an older epoch is emptied. */
  excEpoch: number;
}

export interface CommitRulesOptions {
  /**
   * The commit only deletes. It is applied even over the budget: the oldest earlier tombstones are purged
   * until the set fits, and if it still does not, Rule buckets wait (`overQuota`) while the outbox keeps it.
   */
  shrinkOnly?: boolean;
  /** Reset or replace import: every Rule not updated after this is gone on every device. */
  clearedAt?: number;
}

export class SyncStore {
  private rules = new Map<string, Rule>();
  private extras = new Map<string, RuleExtras>();
  private exceptions = new Map<string, Exception>();
  private meta: StoredSyncMeta = { schema: SCHEMA, ...INITIAL_COUNTERS };
  private outbox: SyncOutbox = emptyOutbox();
  /** JSON of every Shoo key as last read from or written to storage.sync. */
  private stored: Record<string, string> = {};
  private timer: unknown;
  private backoff = 0;
  private savedFloor: ClearFloor = { excEpoch: 0, rulesClearedAt: 0 };
  /** True when the merged Rules do not fit: Rule buckets are not written until Rules are removed. */
  overQuota = false;

  constructor(private readonly deps: SyncStoreDeps) {}

  /** Reads the outbox and storage.sync and adopts them, purging and renumbering as a merge would. */
  async load(): Promise<RemoteMergeResult> {
    if (this.deps.local) {
      const raw = await getDefined(this.deps.local, OUTBOX_KEY);
      const o = raw[OUTBOX_KEY];
      if (isRecord(o)) this.outbox = { ...emptyOutbox(), ...(o as Partial<SyncOutbox>) };
      // The outbox's adds belong to its epoch, and a pending Reset must not be forgotten.
      const { excEpoch, rulesClearedAt } = this.outbox;
      if (excEpoch !== undefined) this.meta.excEpoch = excEpoch;
      if (rulesClearedAt !== undefined) this.meta.rulesClearedAt = rulesClearedAt;
      const f = (await getDefined(this.deps.local, FLOOR_KEY))[FLOOR_KEY];
      if (isRecord(f)) {
        this.savedFloor = floorOf(parseMeta(f));
        for (const k of ['excEpoch', 'rulesClearedAt'] as const) {
          if (this.savedFloor[k] > (this.meta[k] ?? 0)) this.meta[k] = this.savedFloor[k];
        }
      }
    }
    return this.mergeRemote();
  }

  allRules(): Rule[] {
    return [...this.rules.values()];
  }

  liveRules(): Rule[] {
    return this.allRules().filter((r) => r.deletedAt === undefined);
  }

  counters(): RefCounters {
    return { nextR: this.meta.nextR, nextK: this.meta.nextK, nextColour: this.meta.nextColour };
  }

  syncedExceptions(): Exception[] {
    return [...this.exceptions.values()].sort(newestFirst);
  }

  /** The current Exception epoch (raised by Reset and a replace import). */
  excEpoch(): number {
    return this.meta.excEpoch ?? 0;
  }

  /** A timestamp for a Rule write: `now`, or just after the Rule watermark when the clock is behind it. */
  ruleTime(now: number): number {
    return Math.max(now, (this.meta.rulesClearedAt ?? 0) + 1);
  }

  /** The earliest `at` an Exception for `videoId` can have without a removal record deleting it. */
  exceptionFloor(videoId: string): number {
    return (this.meta.excRemoved?.[videoId] ?? -1) + 1;
  }

  /** Whether `rules` would fit the sync budget. */
  fits(rules: Rule[]): boolean {
    return packRules(rules, this.extras) !== null;
  }

  /**
   * Replaces the Rule set (tombstones included). False, with nothing changed, when it does not fit, unless
   * `shrinkOnly`. Memory changes only after the outbox is persisted.
   */
  async commitRules(rules: Rule[], counters: RefCounters, opts: CommitRulesOptions = {}): Promise<boolean> {
    let kept = rules;
    if (!this.fits(kept)) {
      if (!opts.shrinkOnly) return false;
      kept = this.purgeOldTombstones(kept);
    }
    const next = new Map(kept.map((r) => [r.id, r]));
    const box = copyOutbox(this.outbox);
    for (const r of kept) {
      const prev = this.rules.get(r.id);
      if (!prev || canonRule(prev) !== canonRule(r)) box.rules[r.id] = r;
    }
    for (const id of Object.keys(box.rules)) if (!next.has(id)) delete box.rules[id];
    box.counters = counters;
    const clearedAt = opts.clearedAt === undefined ? this.meta.rulesClearedAt : Math.max(opts.clearedAt, this.meta.rulesClearedAt ?? 0);
    if (opts.clearedAt !== undefined) box.rulesClearedAt = clearedAt;
    await this.saveOutbox(box);

    this.outbox = box;
    this.rules = next;
    for (const id of [...this.extras.keys()]) if (!this.rules.has(id)) this.extras.delete(id);
    this.meta = { ...this.meta, ...counters };
    if (clearedAt !== undefined) this.meta.rulesClearedAt = clearedAt;
    this.overQuota = !this.fits(kept);
    await this.saveFloor();
    this.schedule();
    return true;
  }

  /**
   * Drops tombstones storage.sync already holds (written and seen by running devices), oldest first, until
   * the set fits or none is left. A tombstone still in the outbox is never dropped: it is the only copy of
   * that delete.
   */
  private purgeOldTombstones(rules: Rule[]): Rule[] {
    const old = rules
      .filter((r) => r.deletedAt !== undefined && this.rules.get(r.id)?.deletedAt !== undefined && !(r.id in this.outbox.rules))
      .sort((a, b) => a.deletedAt! - b.deletedAt! || byText(a.id, b.id));
    const dropped = new Set<string>();
    let kept = rules;
    for (const r of old) {
      dropped.add(r.id);
      kept = rules.filter((x) => !dropped.has(x.id));
      if (this.fits(kept)) break;
    }
    return kept;
  }

  /**
   * Replaces the synced Exceptions with the newest of `candidates` that fit, and records `removedIds` as
   * deletions for other devices. With `newEpoch` (Reset, replace import) every Exception from before is
   * gone on every device, archives included, however many there were. Returns the rest for the local
   * archive. Memory changes only after the outbox is persisted.
   */
  async commitExceptions(candidates: Exception[], removedIds: string[] = [], opts: { newEpoch?: boolean } = {}): Promise<Exception[]> {
    const at = this.deps.now();
    const epoch = opts.newEpoch ? Math.max(this.excEpoch() + 1, Math.floor(at / 1000) - EPOCH_ORIGIN_S) : this.excEpoch();
    const { synced, overflow } = packExceptions(candidates, epoch);
    const placed = new Map(synced.map((x) => [x.videoId, x]));
    const box = copyOutbox(this.outbox);
    if (opts.newEpoch) {
      box.added = {};
      box.removed = {};
    }
    for (const x of placed.values()) {
      const prev = this.exceptions.get(x.videoId);
      if (opts.newEpoch || !prev || prev.at !== x.at) box.added[x.videoId] = x;
    }
    const removals: Record<string, number> = {};
    for (const v of removedIds) {
      if (placed.has(v)) continue;
      // Never older than the Exception it removes, even when that came from a device whose clock is ahead.
      const removedAt = Math.max(at, this.exceptions.get(v)?.at ?? at);
      removals[v] = removedAt;
      box.removed[v] = removedAt;
      delete box.added[v];
    }
    // Only the newest records fit in sync:meta. Older ones could never be confirmed.
    box.removed = mergeRemovals(box.removed);
    for (const v of Object.keys(box.added)) if (!placed.has(v)) delete box.added[v];
    if (epoch > 0 && (opts.newEpoch || Object.keys(box.added).length + Object.keys(box.removed).length > 0)) box.excEpoch = epoch;
    await this.saveOutbox(box);

    this.outbox = box;
    this.exceptions = placed;
    this.meta = { ...this.meta, excRemoved: mergeRemovals(opts.newEpoch ? undefined : this.meta.excRemoved, removals) };
    if (epoch > 0) this.meta.excEpoch = epoch;
    await this.saveFloor();
    this.schedule();
    return overflow;
  }

  /** Writes the outbox to storage.local, evicting Activity and then the Verdict cache on a quota error. */
  private async saveOutbox(o: SyncOutbox): Promise<void> {
    const local = this.deps.local;
    if (!local) return;
    const empty =
      Object.keys(o.rules).length + Object.keys(o.added).length + Object.keys(o.removed).length === 0 &&
      !o.counters &&
      o.excEpoch === undefined &&
      o.rulesClearedAt === undefined;
    await withQuotaRetry(local, () => (empty ? local.remove(OUTBOX_KEY) : local.set({ [OUTBOX_KEY]: o })));
  }

  /** Records a raised `excEpoch` or `rulesClearedAt` in storage.local. */
  private async saveFloor(): Promise<void> {
    const local = this.deps.local;
    const floor = floorOf(this.meta);
    if (!local || (floor.excEpoch <= this.savedFloor.excEpoch && floor.rulesClearedAt <= this.savedFloor.rulesClearedAt)) return;
    await withQuotaRetry(local, () => local.set({ [FLOOR_KEY]: floor }));
    this.savedFloor = floor;
  }

  /**
   * Merges what storage.sync holds now (another device's write, or our own echo) with memory and the
   * outbox. Writes back only when the merged state differs from storage, so two devices never ping-pong.
   */
  async mergeRemote(previous: Record<string, unknown> = {}): Promise<RemoteMergeResult> {
    const raw = await getDefined(this.deps.sync, null);
    const box = this.outbox;
    const boxBefore = JSON.stringify(box);
    // Everything stored, removed entries included, to compare against at the end.
    const stored = parseSync(raw);
    // The highest Reset seen anywhere wins: memory, storage (meta or an Exception's `ep`), the overwritten
    // value, or the outbox.
    const metas = [this.meta, stored.meta, parseMeta(previous[META_KEY])];
    const floor: ClearFloor = {
      excEpoch: Math.max(box.excEpoch ?? 0, ...metas.map((m) => m.excEpoch ?? 0), ...stored.excEpochs.values(), ...parseSync(previous).excEpochs.values()),
      rulesClearedAt: Math.max(box.rulesClearedAt ?? 0, ...metas.map((m) => m.rulesClearedAt ?? 0)),
    };
    const theirs = parseSync(raw, floor);
    // `previous` holds the `oldValue`s of an onChanged event. When another device's write replaced a
    // bucket wholesale (last write wins per item), they are the only copy of what was overwritten.
    const prev = parseSync(previous, floor);
    const now = this.deps.now();

    const oursRules = new Map(this.rules);
    for (const r of [...prev.rules.values(), ...Object.values(box.rules)]) {
      const cur = oursRules.get(r.id);
      if (!cur || newerRule(r, cur)) oursRules.set(r.id, r);
    }
    const mergedRules = mergeRules(oursRules, theirs.rules, now);
    for (const [id, m] of mergedRules) if (m.rule.updatedAt <= floor.rulesClearedAt) mergedRules.delete(id);
    const counters: RefCounters = {
      nextR: Math.max(this.meta.nextR, theirs.meta.nextR, prev.meta.nextR, box.counters?.nextR ?? 0),
      nextK: Math.max(this.meta.nextK, theirs.meta.nextK, prev.meta.nextK, box.counters?.nextK ?? 0),
      nextColour: Math.max(this.meta.nextColour, theirs.meta.nextColour, prev.meta.nextColour, box.counters?.nextColour ?? 0),
    };
    const resolved = resolveRefCollisions([...mergedRules.values()].map((m) => m.rule), counters, Math.max(now, floor.rulesClearedAt + 1));
    const extras = new Map<string, RuleExtras>();
    for (const [id, m] of mergedRules) {
      const e = m.from === 'theirs' ? theirs.extras.get(id) : (this.extras.get(id) ?? prev.extras.get(id));
      if (e) extras.set(id, e);
    }

    // Exceptions and removal records from an older epoch are gone: dropped, never archived.
    const current = (m: StoredSyncMeta) => (m.excEpoch ?? 0) === floor.excEpoch;
    if ((box.excEpoch ?? 0) < floor.excEpoch) {
      box.added = {};
      box.removed = {};
    }
    const removed = mergeRemovals(
      current(this.meta) ? this.meta.excRemoved : undefined,
      current(theirs.meta) ? theirs.meta.excRemoved : undefined,
      current(prev.meta) ? prev.meta.excRemoved : undefined,
      box.removed,
    );
    const oursExc = current(this.meta) ? new Map(this.exceptions) : new Map<string, Exception>();
    for (const x of prev.exceptions.values()) if (!oursExc.has(x.videoId)) oursExc.set(x.videoId, x);
    for (const x of Object.values(box.added)) {
      const cur = oursExc.get(x.videoId);
      if (!cur || newerException(x, cur)) oursExc.set(x.videoId, x);
    }
    const { merged: mergedExc, archive } = mergeExceptions(oursExc, theirs.exceptions, removed, new Set(Object.keys(box.added)));

    this.stored = Object.fromEntries(Object.entries(raw).filter(([k]) => isSyncDataKey(k)).map(([k, v]) => [k, JSON.stringify(v)]));
    this.rules = new Map(resolved.rules.map((r) => [r.id, r]));
    this.extras = extras;
    // Unknown meta fields: the remote copy wins, it is the freshest.
    this.meta = { ...this.meta, ...theirs.meta, ...resolved.counters, schema: Math.max(this.meta.schema, theirs.meta.schema), excRemoved: removed };
    if (Object.keys(removed).length === 0) delete this.meta.excRemoved;
    for (const k of ['excEpoch', 'rulesClearedAt'] as const) {
      if (floor[k] > 0) this.meta[k] = floor[k];
      else delete this.meta[k];
    }
    const { synced, overflow } = packExceptions(mergedExc, floor.excEpoch);
    this.exceptions = new Map(synced.map((x) => [x.videoId, x]));

    // Renumbered Rules are local writes too.
    for (const { ruleId } of resolved.renumbered) box.rules[ruleId] = this.rules.get(ruleId)!;
    this.confirmOutbox(theirs);
    if (JSON.stringify(box) !== boxBefore) await this.saveOutbox(box);
    await this.saveFloor();

    // Logical comparison against everything stored, removed entries included, not bucket layout: a
    // device never rewrites data it agrees with, and does rewrite what a stale device wrote back.
    const merged = canonState(this.rules, this.extras, this.exceptions.values(), () => floor.excEpoch, this.meta);
    const inStorage = canonState(stored.rules, stored.extras, stored.exceptions.values(), (v) => stored.excEpochs.get(v) ?? 0, stored.meta);
    const changed = merged !== inStorage;
    if (changed) this.schedule();
    return { changed, renumbered: resolved.renumbered, archive: [...archive, ...overflow], removed, excEpoch: floor.excEpoch };
  }

  /** Drops outbox entries that storage.sync now holds (or something newer), or that no longer apply. */
  private confirmOutbox(theirs: SyncSnapshot): void {
    const box = this.outbox;
    for (const [id, r] of Object.entries(box.rules)) {
      const t = theirs.rules.get(id);
      const current = this.rules.get(id);
      if (!current || (t && !newerRule(current, t))) delete box.rules[id];
      else if (canonRule(current) !== canonRule(r)) box.rules[id] = current;
    }
    for (const [v, x] of Object.entries(box.added)) {
      const t = theirs.exceptions.get(v);
      if (!this.exceptions.has(v) || (t && t.at >= x.at)) delete box.added[v];
    }
    for (const [v, at] of Object.entries(box.removed)) if ((theirs.meta.excRemoved?.[v] ?? -1) >= at) delete box.removed[v];
    const c = box.counters;
    if (c && theirs.meta.nextR >= c.nextR && theirs.meta.nextK >= c.nextK && theirs.meta.nextColour >= c.nextColour) delete box.counters;
    if (box.rulesClearedAt !== undefined && (theirs.meta.rulesClearedAt ?? 0) >= box.rulesClearedAt) delete box.rulesClearedAt;
    const entries = Object.keys(box.added).length + Object.keys(box.removed).length;
    if (box.excEpoch !== undefined && entries === 0 && (theirs.meta.excEpoch ?? 0) >= box.excEpoch) delete box.excEpoch;
  }

  /** The items to set and keys to remove so storage matches memory. Rule buckets are skipped when over quota. */
  private pendingWrites(): { set: Record<string, unknown>; remove: string[]; json: Record<string, string> } {
    const rules = packRules(this.allRules(), this.extras);
    this.overQuota = rules === null;
    const exc = packExceptions([...this.exceptions.values()], this.excEpoch()).buckets;
    const next: Record<string, unknown> = { ...(rules ?? {}), ...exc, [META_KEY]: this.metaForStorage() };
    const json = Object.fromEntries(Object.entries(next).map(([k, v]) => [k, JSON.stringify(v)]));
    const set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(next)) if (this.stored[k] !== json[k]) set[k] = v;
    const keepRuleKeys = rules === null;
    const remove = Object.keys(this.stored).filter((k) => k !== META_KEY && !(k in next) && !(keepRuleKeys && RULE_KEY_RE.test(k)));
    return { set, remove, json };
  }

  private metaForStorage(): StoredSyncMeta {
    const { schema, nextR, nextK, nextColour, excRemoved, excEpoch, rulesClearedAt, ...rest } = this.meta;
    const meta: StoredSyncMeta = { ...rest, schema, nextR, nextK, nextColour };
    if (excRemoved && Object.keys(excRemoved).length > 0) meta.excRemoved = excRemoved;
    if (excEpoch) meta.excEpoch = excEpoch;
    if (rulesClearedAt) meta.rulesClearedAt = rulesClearedAt;
    return meta;
  }

  /** Debounced write (1 s by default). */
  schedule(delay = this.deps.debounceMs ?? SYNC_DEBOUNCE_MS): void {
    const timers = this.deps.timers ?? defaultTimers;
    if (this.timer !== undefined) timers.clear(this.timer);
    this.timer = timers.set(() => {
      this.timer = undefined;
      const run = this.deps.runExclusive ?? ((fn) => fn());
      void run(() => this.flush()).catch((e) => this.deps.onError?.(e));
    }, delay);
  }

  /**
   * Writes only the buckets whose JSON changed. True when storage.sync now holds everything. False when a
   * rate limit deferred the write (the outbox keeps the change and a retry is scheduled) or Rules are over
   * the budget.
   */
  async flush(): Promise<boolean> {
    const timers = this.deps.timers ?? defaultTimers;
    if (this.timer !== undefined) {
      timers.clear(this.timer);
      this.timer = undefined;
    }
    const pending = this.pendingWrites();
    try {
      if (Object.keys(pending.set).length > 0) await this.deps.sync.set(pending.set);
      if (pending.remove.length > 0) await this.deps.sync.remove(pending.remove);
    } catch (e) {
      if (isRateLimitError(e)) {
        const delay = RATE_LIMIT_BACKOFF_MS[Math.min(this.backoff, RATE_LIMIT_BACKOFF_MS.length - 1)]!;
        this.backoff++;
        this.schedule(delay);
        return false;
      }
      throw e;
    }
    this.backoff = 0;
    for (const k of Object.keys(pending.set)) this.stored[k] = pending.json[k]!;
    for (const k of pending.remove) delete this.stored[k];
    return !this.overQuota;
  }

  /** Unconfirmed local writes (tests, diagnostics). */
  pendingOutbox(): SyncOutbox {
    return this.outbox;
  }

  dispose(): void {
    if (this.timer !== undefined) (this.deps.timers ?? defaultTimers).clear(this.timer);
    this.timer = undefined;
  }
}

function canonState(rules: Map<string, Rule>, extras: Map<string, RuleExtras>, exceptions: Iterable<Exception>, epochOf: (videoId: string) => number, meta: StoredSyncMeta): string {
  const r = [...rules.values()].sort((a, b) => byText(a.id, b.id)).map((x) => toCompactRule(x, extras.get(x.id)));
  const e = [...exceptions].sort((a, b) => byText(a.videoId, b.videoId)).map((x) => toCompactException(x, epochOf(x.videoId)));
  return JSON.stringify([r, e, meta.schema, meta.nextR, meta.nextK, meta.nextColour, mergeRemovals(meta.excRemoved), meta.excEpoch ?? 0, meta.rulesClearedAt ?? 0]);
}

/** Read-only helper for pages: every Rule and synced Exception in storage.sync right now, minus what a Reset removed. */
export async function readSync(sync: AreaLike): Promise<SyncSnapshot> {
  const raw = await getDefined(sync, null);
  return parseSync(raw, floorOf(parseMeta(raw[META_KEY])));
}
