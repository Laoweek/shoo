// storage.local: settings, Verdict cache, Activity, counters, stats, Escalation, runtime, model list,
// Subscribed channels, Exception archive. Source of truth: docs/spec/architecture.md Section 8
// ("storage.local"), docs/spec/decision-engine.md Sections 1.2 (Verdict cache record) and 8.3 (accounting).
import { dayKey, pruneEscalation, type EscalationRecord } from '~/core/escalation';
import { fnv1a32 } from '~/core/ids';
import { siteOfVideo, videoSite } from '~/core/sites';
import type { FailureState } from '~/core/runtime';
import type { SubscribedChannels } from '~/core/subscriptions';
import type { ActivityEvent, ActivityKind, Exception, Settings, SiteId } from '~/core/types';
import type { TextModelResult, ThumbModelResult } from '~/core/verdict';
import { getDefined, getOne, isQuotaError, isRecord, itemBytes, type AreaLike } from './areas';
import { SETTINGS_KEY, withDefaults } from './schema';

const DAY_MS = 24 * 60 * 60 * 1000;
export const RETENTION_DAYS = 30;

/** First local day kept by retention: today and the 29 days before it. */
export function retentionStart(now: number): string {
  const d = new Date(now);
  d.setDate(d.getDate() - (RETENTION_DAYS - 1));
  return dayKey(d.getTime());
}

export const VIDEO_BUCKETS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'];

/**
 * 64 buckets by the first character of a YouTube videoId ([A-Za-z0-9_-]). Every Bilibili id starts with 'BV', so
 * those spread over the same 64 buckets by hash instead of crowding into 'B'.
 */
export function videoBucket(videoId: string): string {
  if (videoSite(videoId) === 'bilibili') return VIDEO_BUCKETS[fnv1a32(videoId) % VIDEO_BUCKETS.length]!;
  const c = videoId.charAt(0);
  return /^[A-Za-z0-9_-]$/.test(c) ? c : '_';
}

// ---------------------------------------------------------------------------------------------------
// Quota errors: evict Activity (oldest days), then Verdict cache (oldest entries), retrying once each

export type QuotaStage = 'activity' | 'verdicts';

/**
 * Runs a write. On a quota error it evicts the oldest half of the Activity days and retries once, then
 * the oldest half of the Verdict cache and retries once more. `onEvict` reports each stage (tests, logs).
 */
export async function withQuotaRetry<T>(local: AreaLike, op: () => Promise<T>, onEvict?: (stage: QuotaStage) => void): Promise<T> {
  try {
    return await op();
  } catch (e) {
    if (!isQuotaError(e)) throw e;
  }
  if (await evictOldestActivity(local, 0.5)) {
    onEvict?.('activity');
    try {
      return await op();
    } catch (e) {
      if (!isQuotaError(e)) throw e;
    }
  }
  await evictOldestVerdicts(local, 0.5);
  onEvict?.('verdicts');
  return op();
}

// ---------------------------------------------------------------------------------------------------
// Settings

export async function getSettings(local: AreaLike): Promise<Settings> {
  return withDefaults(await getOne<unknown>(local, SETTINGS_KEY));
}

export async function setSettings(local: AreaLike, settings: Settings): Promise<void> {
  await withQuotaRetry(local, () => local.set({ [SETTINGS_KEY]: settings }));
}

// ---------------------------------------------------------------------------------------------------
// Verdict cache (decision-engine.md Section 1.2)

export interface VerdictCacheRecord {
  text?: TextModelResult;
  thumb?: ThumbModelResult;
  rulesVersion: string;
  at: number; // epoch ms of the newest write
}

export const VERDICT_BUCKET_MAX = 320;
const verdictKey = (bucket: string) => `verdicts:${bucket}`;

type VerdictBucket = Record<string, VerdictCacheRecord>;

/** Records for these videos whose `rulesVersion` matches. Misses and stale records are left out. */
export async function getVerdicts(local: AreaLike, videoIds: string[], rulesVersion: string): Promise<Map<string, VerdictCacheRecord>> {
  const keys = [...new Set(videoIds.map((v) => verdictKey(videoBucket(v))))];
  const raw = keys.length > 0 ? await getDefined(local, keys) : {};
  const out = new Map<string, VerdictCacheRecord>();
  for (const v of videoIds) {
    const bucket = raw[verdictKey(videoBucket(v))];
    const rec = isRecord(bucket) ? (bucket[v] as VerdictCacheRecord | undefined) : undefined;
    if (rec && rec.rulesVersion === rulesVersion) out.set(v, rec);
  }
  return out;
}

export async function getVerdict(local: AreaLike, videoId: string, rulesVersion: string): Promise<VerdictCacheRecord | undefined> {
  return (await getVerdicts(local, [videoId], rulesVersion)).get(videoId);
}

export interface VerdictPut {
  videoId: string;
  rulesVersion: string;
  text?: TextModelResult;
  thumb?: ThumbModelResult;
  at: number;
}

/**
 * Stores model results. A record with the same `rulesVersion` is merged (text and thumb kept side by
 * side), any other is replaced. Each bucket keeps its 320 newest records by `at`.
 */
export async function putVerdicts(local: AreaLike, puts: VerdictPut[]): Promise<void> {
  if (puts.length === 0) return;
  await withQuotaRetry(local, async () => {
    const keys = [...new Set(puts.map((p) => verdictKey(videoBucket(p.videoId))))];
    const raw = await getDefined(local, keys);
    const buckets: Record<string, VerdictBucket> = {};
    for (const k of keys) buckets[k] = isRecord(raw[k]) ? { ...(raw[k] as VerdictBucket) } : {};
    for (const p of puts) {
      const bucket = buckets[verdictKey(videoBucket(p.videoId))]!;
      const prev = bucket[p.videoId];
      const base: Partial<VerdictCacheRecord> = prev && prev.rulesVersion === p.rulesVersion ? prev : {};
      const next: VerdictCacheRecord = { ...base, rulesVersion: p.rulesVersion, at: p.at };
      if (p.text) next.text = p.text;
      if (p.thumb) next.thumb = p.thumb;
      bucket[p.videoId] = next;
    }
    for (const k of keys) buckets[k] = capBucket(buckets[k]!, VERDICT_BUCKET_MAX);
    await local.set(buckets);
  });
}

function capBucket(bucket: VerdictBucket, max: number): VerdictBucket {
  const entries = Object.entries(bucket);
  if (entries.length <= max) return bucket;
  entries.sort(([, a], [, b]) => b.at - a.at);
  return Object.fromEntries(entries.slice(0, max));
}

/** Drops the oldest `fraction` of records in every Verdict cache bucket. */
export async function evictOldestVerdicts(local: AreaLike, fraction: number): Promise<void> {
  const keys = VIDEO_BUCKETS.map(verdictKey);
  const raw = await getDefined(local, keys);
  const next: Record<string, VerdictBucket> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!isRecord(v)) continue;
    const n = Object.keys(v).length;
    next[k] = capBucket(v as VerdictBucket, Math.floor(n * (1 - fraction)));
  }
  if (Object.keys(next).length > 0) await local.set(next);
}

// ---------------------------------------------------------------------------------------------------
// Activity: pages of ≤ 200 events per local day, ≤ 3 MB in all, 30 days

export const ACTIVITY_PAGE_MAX = 200;
export const ACTIVITY_MAX_BYTES = 3 * 1024 * 1024;
export const ACTIVITY_TITLE_MAX = 120;
export const ACTIVITY_INDEX_KEY = 'activity:index';
export const activityPageKey = (day: string, n: number) => `activity:${day}:${n}`;

/** `days` is the page count per day (Section 8), `bytes` each day's size for the cap (absent from older indexes). */
export interface ActivityIndex {
  days: Record<string, number>;
  bytes?: Record<string, number>;
}

async function getIndex(local: AreaLike): Promise<ActivityIndex> {
  const raw = await getOne<unknown>(local, ACTIVITY_INDEX_KEY);
  if (!isRecord(raw) || !isRecord(raw.days)) return { days: {}, bytes: {} };
  return { days: { ...(raw.days as Record<string, number>) }, bytes: { ...((isRecord(raw.bytes) ? raw.bytes : {}) as Record<string, number>) } };
}

const pageKeys = (day: string, pages: number) => Array.from({ length: pages }, (_, n) => activityPageKey(day, n));
const totalBytes = (index: ActivityIndex) => Object.values(index.bytes ?? {}).reduce((s, n) => s + n, 0);

/** Appends events to their day's last page, opening new pages at 200, then enforces the 3 MB cap. */
export async function appendActivity(local: AreaLike, events: ActivityEvent[]): Promise<void> {
  if (events.length === 0) return;
  await withQuotaRetry(local, async () => {
    const index = await getIndex(local);
    const byDay = new Map<string, ActivityEvent[]>();
    for (const e of events) {
      const ev = e.title !== undefined && e.title.length > ACTIVITY_TITLE_MAX ? { ...e, title: e.title.slice(0, ACTIVITY_TITLE_MAX) } : e;
      const day = dayKey(ev.at);
      byDay.set(day, [...(byDay.get(day) ?? []), ev]);
    }
    const writes: Record<string, unknown> = {};
    for (const [day, list] of byDay) {
      let pages = index.days[day] ?? 0;
      let n = Math.max(pages - 1, 0);
      const key = activityPageKey(day, n);
      let page = pages > 0 ? ((await getOne<ActivityEvent[]>(local, key)) ?? []) : [];
      let bytes = (index.bytes ?? {})[day] ?? 0;
      bytes -= pages > 0 ? itemBytes(key, page) : 0;
      for (const ev of list) {
        if (page.length >= ACTIVITY_PAGE_MAX) {
          writes[activityPageKey(day, n)] = page;
          bytes += itemBytes(activityPageKey(day, n), page);
          n++;
          page = [];
        }
        page = [...page, ev];
      }
      writes[activityPageKey(day, n)] = page;
      bytes += itemBytes(activityPageKey(day, n), page);
      pages = n + 1;
      index.days[day] = pages;
      index.bytes = { ...index.bytes, [day]: bytes };
    }
    const drop = daysOverCap(index);
    for (const day of drop) {
      for (const k of pageKeys(day, index.days[day] ?? 0)) delete writes[k];
    }
    await local.set({ ...writes, [ACTIVITY_INDEX_KEY]: withoutDays(index, drop) });
    if (drop.length > 0) await local.remove(drop.flatMap((d) => pageKeys(d, index.days[d] ?? 0)));
  });
}

/** Oldest days to drop so the total stays within 3 MB. The newest day is never dropped. */
function daysOverCap(index: ActivityIndex): string[] {
  const days = Object.keys(index.days).sort();
  const drop: string[] = [];
  let total = totalBytes(index);
  while (total > ACTIVITY_MAX_BYTES && days.length > 1) {
    const day = days.shift()!;
    total -= (index.bytes ?? {})[day] ?? 0;
    drop.push(day);
  }
  return drop;
}

function withoutDays(index: ActivityIndex, drop: string[]): ActivityIndex {
  const days = { ...index.days };
  const bytes = { ...index.bytes };
  for (const d of drop) {
    delete days[d];
    delete bytes[d];
  }
  return { days, bytes };
}

/** Deletes Activity days (all their pages). */
export async function dropActivityDays(local: AreaLike, drop: string[]): Promise<void> {
  if (drop.length === 0) return;
  const index = await getIndex(local);
  await local.remove(drop.flatMap((d) => pageKeys(d, index.days[d] ?? 0)));
  await local.set({ [ACTIVITY_INDEX_KEY]: withoutDays(index, drop) });
}

/** Drops the oldest `fraction` of Activity days (at least one). False when there is no Activity. */
export async function evictOldestActivity(local: AreaLike, fraction: number): Promise<boolean> {
  const index = await getIndex(local);
  const days = Object.keys(index.days).sort();
  if (days.length === 0) return false;
  await dropActivityDays(local, days.slice(0, Math.max(1, Math.floor(days.length * fraction))));
  return true;
}

export interface ActivityQuery {
  fromDay?: string; // inclusive, 'YYYY-MM-DD'
  toDay?: string; // inclusive
  kinds?: ActivityKind[];
  ruleId?: string;
  batchId?: string;
  videoId?: string;
  /** Events about a video on this Site. */
  site?: SiteId;
  /** Case-insensitive match on title, channel name and detail. */
  text?: string;
  limit?: number;
}

/** Matching events, newest first. */
export async function queryActivity(local: AreaLike, q: ActivityQuery = {}): Promise<ActivityEvent[]> {
  const index = await getIndex(local);
  const days = Object.keys(index.days).filter((d) => (!q.fromDay || d >= q.fromDay) && (!q.toDay || d <= q.toDay));
  const keys = days.flatMap((d) => pageKeys(d, index.days[d] ?? 0));
  if (keys.length === 0) return [];
  const raw = await getDefined(local, keys);
  const needle = q.text?.trim().toLocaleLowerCase();
  const out: ActivityEvent[] = [];
  for (const page of Object.values(raw)) {
    if (!Array.isArray(page)) continue;
    for (const e of page as ActivityEvent[]) {
      if (q.kinds && !q.kinds.includes(e.kind)) continue;
      if (q.ruleId && e.ruleId !== q.ruleId) continue;
      if (q.batchId && e.batchId !== q.batchId) continue;
      if (q.videoId && e.videoId !== q.videoId) continue;
      if (q.site && siteOfVideo(e) !== q.site) continue;
      if (needle && ![e.title, e.channelName, e.detail].some((s) => s?.toLocaleLowerCase().includes(needle))) continue;
      out.push(e);
    }
  }
  out.sort((a, b) => b.at - a.at);
  return q.limit === undefined ? out : out.slice(0, q.limit);
}

/** Sets `seenAt` on these events (Activity rows stay lit until seen). Searches newest days first. */
export async function markActivitySeen(local: AreaLike, ids: string[], at: number): Promise<void> {
  const remaining = new Set(ids);
  if (remaining.size === 0) return;
  const index = await getIndex(local);
  for (const day of Object.keys(index.days).sort().reverse()) {
    const keys = pageKeys(day, index.days[day] ?? 0);
    const raw = await getDefined(local, keys);
    const writes: Record<string, ActivityEvent[]> = {};
    let delta = 0;
    for (const [k, page] of Object.entries(raw)) {
      if (!Array.isArray(page)) continue;
      let changed = false;
      const next = (page as ActivityEvent[]).map((e) => {
        if (!remaining.has(e.id)) return e;
        remaining.delete(e.id);
        if (e.seenAt !== undefined) return e;
        changed = true;
        return { ...e, seenAt: at };
      });
      if (changed) {
        writes[k] = next;
        delta += itemBytes(k, next) - itemBytes(k, page);
      }
    }
    if (Object.keys(writes).length > 0) {
      const bytes = { ...index.bytes, [day]: ((index.bytes ?? {})[day] ?? 0) + delta };
      index.bytes = bytes;
      await withQuotaRetry(local, () => local.set({ ...writes, [ACTIVITY_INDEX_KEY]: index }));
    }
    if (remaining.size === 0) return;
  }
}

export async function getActivityIndex(local: AreaLike): Promise<ActivityIndex> {
  return getIndex(local);
}

// ---------------------------------------------------------------------------------------------------
// Daily counters (decision-engine.md Section 8.3)

export interface DayCounters {
  judged: number;
  removed: number;
  requests: number;
  costUsd: number;
}

export const EMPTY_COUNTERS: DayCounters = { judged: 0, removed: 0, requests: 0, costUsd: 0 };
export const countersKey = (day: string) => `counters:${day}`;

export function addCounters(a: DayCounters, delta: Partial<DayCounters>): DayCounters {
  return {
    judged: a.judged + (delta.judged ?? 0),
    removed: a.removed + (delta.removed ?? 0),
    requests: a.requests + (delta.requests ?? 0),
    costUsd: a.costUsd + (delta.costUsd ?? 0),
  };
}

export async function getCounters(area: AreaLike, day: string, key = countersKey(day)): Promise<DayCounters> {
  return { ...EMPTY_COUNTERS, ...(await getOne<DayCounters>(area, key)) };
}

export async function bumpCounters(local: AreaLike, day: string, delta: Partial<DayCounters>): Promise<DayCounters> {
  return withQuotaRetry(local, async () => {
    const next = addCounters(await getCounters(local, day), delta);
    await local.set({ [countersKey(day)]: next });
    return next;
  });
}

// ---------------------------------------------------------------------------------------------------
// Rule stats (local only, never synced)

export interface RuleStat {
  days: Record<string, number>;
  total: number;
  lastHitAt: number;
}
export type RuleStats = Record<string, RuleStat>;
export const RULE_STATS_KEY = 'ruleStats';

export async function getRuleStats(local: AreaLike): Promise<RuleStats> {
  return (await getOne<RuleStats>(local, RULE_STATS_KEY)) ?? {};
}

export async function recordRuleHits(local: AreaLike, hits: { ruleId: string; at: number; n?: number }[]): Promise<void> {
  if (hits.length === 0) return;
  await withQuotaRetry(local, async () => {
    const stats = await getRuleStats(local);
    for (const h of hits) {
      const n = h.n ?? 1;
      const day = dayKey(h.at);
      const s = stats[h.ruleId] ?? { days: {}, total: 0, lastHitAt: 0 };
      stats[h.ruleId] = { days: { ...s.days, [day]: (s.days[day] ?? 0) + n }, total: s.total + n, lastHitAt: Math.max(s.lastHitAt, h.at) };
    }
    await local.set({ [RULE_STATS_KEY]: stats });
  });
}

/** Hits over today and the 6 local days before it. */
export function hitsThisWeek(stat: RuleStat | undefined, now: number): number {
  if (!stat) return 0;
  const d = new Date(now);
  d.setDate(d.getDate() - 6);
  const start = dayKey(d.getTime());
  return Object.entries(stat.days).reduce((sum, [day, n]) => (day >= start ? sum + n : sum), 0);
}

// ---------------------------------------------------------------------------------------------------
// Escalation, runtime, model list

export const ESCALATION_KEY = 'escalation';
export type EscalationStore = Record<string, EscalationRecord>;

export async function getEscalation(local: AreaLike): Promise<EscalationStore> {
  return (await getOne<EscalationStore>(local, ESCALATION_KEY)) ?? {};
}

export async function updateEscalation(local: AreaLike, fn: (all: EscalationStore) => EscalationStore): Promise<EscalationStore> {
  return withQuotaRetry(local, async () => {
    const next = fn(await getEscalation(local));
    await local.set({ [ESCALATION_KEY]: next });
    return next;
  });
}

export const RUNTIME_KEY = 'runtime';
export const DEFAULT_RUNTIME: FailureState = { failures: { model: 0, nativeAction: 0, markup: 0 }, tripped: {} };

export async function getRuntime(local: AreaLike): Promise<FailureState> {
  const raw = await getOne<FailureState>(local, RUNTIME_KEY);
  // Spread `raw` first so fields the background keeps next to the counters (keyRejected, creditsExhausted) survive.
  return raw ? { ...raw, failures: { ...DEFAULT_RUNTIME.failures, ...raw.failures }, tripped: { ...raw.tripped } } : DEFAULT_RUNTIME;
}

export async function setRuntime(local: AreaLike, state: FailureState): Promise<void> {
  await withQuotaRetry(local, () => local.set({ [RUNTIME_KEY]: state }));
}

export const MODELS_KEY = 'models';
export const MODELS_TTL_MS = DAY_MS;

/** Same shape as `ModelInfo` in messaging/protocol.ts (store imports only core/). */
export interface CachedModel {
  id: string;
  images: boolean;
  pricePerMInput: number;
}
export interface ModelsCache {
  models: CachedModel[];
  fetchedAt: number;
}

/** The cached model list, or undefined when there is none or it is older than 24 h. */
export async function getModelsCache(local: AreaLike, now: number): Promise<ModelsCache | undefined> {
  const c = await getOne<ModelsCache>(local, MODELS_KEY);
  return c && now - c.fetchedAt < MODELS_TTL_MS ? c : undefined;
}

export async function setModelsCache(local: AreaLike, cache: ModelsCache): Promise<void> {
  await withQuotaRetry(local, () => local.set({ [MODELS_KEY]: cache }));
}

// ---------------------------------------------------------------------------------------------------
// Subscribed channels (REQ-RULE-14): channel keys only, read while a Rule skips Subscribed channels

export const SUBSCRIPTIONS_KEY = 'subscriptions';

export interface StoredSubscriptions {
  /** The last list read, with when it was read. */
  list?: SubscribedChannels & { readAt: number };
  /** The last attempt to read it, and the failed attempts in a row since the last read. */
  triedAt: number;
  failures: number;
}

export const getSubscriptions = (local: AreaLike): Promise<StoredSubscriptions | undefined> => getOne<StoredSubscriptions>(local, SUBSCRIPTIONS_KEY);

export async function setSubscriptions(local: AreaLike, value: StoredSubscriptions): Promise<void> {
  await withQuotaRetry(local, () => local.set({ [SUBSCRIPTIONS_KEY]: value }));
}

// ---------------------------------------------------------------------------------------------------
// Exception archive: Exceptions beyond the synced ones, ≤ 5,000, oldest dropped

export const ARCHIVE_MAX = 5000;
export const archiveKey = (bucket: string) => `exceptions:archive:${bucket}`;
const ARCHIVE_KEYS = VIDEO_BUCKETS.map(archiveKey);
/** The sync `excEpoch` the archive belongs to. An archive from an older epoch was removed by a Reset or replace import. */
export const ARCHIVE_EPOCH_KEY = 'exceptions:epoch';
type ArchiveBucket = Record<string, Exception>;

/** Archived Exceptions. Empty when the archive is older than `epoch` (a Reset elsewhere not yet applied here). */
export async function getArchive(local: AreaLike, epoch = 0): Promise<Exception[]> {
  const raw = await getDefined(local, [...ARCHIVE_KEYS, ARCHIVE_EPOCH_KEY]);
  if (archiveEpoch(raw) < epoch) return [];
  return ARCHIVE_KEYS.flatMap((k) => (isRecord(raw[k]) ? (Object.values(raw[k]) as Exception[]) : []));
}

const archiveEpoch = (raw: Record<string, unknown>): number => (typeof raw[ARCHIVE_EPOCH_KEY] === 'number' ? raw[ARCHIVE_EPOCH_KEY] : 0);

/**
 * Adds Exceptions to the archive, removes `removeIds` and every entry not newer than its `removedAt`
 * record, then keeps the 5,000 newest. Writes only the buckets that changed. With an `epoch` above the
 * archive's own, everything archived before is dropped first.
 */
export async function updateArchive(local: AreaLike, add: Exception[], removeIds: string[] = [], removedAt: Record<string, number> = {}, epoch?: number): Promise<void> {
  if (add.length === 0 && removeIds.length === 0 && Object.keys(removedAt).length === 0 && epoch === undefined) return;
  await withQuotaRetry(local, async () => {
    const raw = await getDefined(local, [...ARCHIVE_KEYS, ARCHIVE_EPOCH_KEY]);
    const all = new Map<string, Exception>();
    const stale = epoch !== undefined && archiveEpoch(raw) < epoch;
    if (!stale) {
      for (const k of ARCHIVE_KEYS) {
        const bucket = raw[k];
        if (!isRecord(bucket)) continue;
        for (const x of Object.values(bucket) as Exception[]) all.set(x.videoId, x);
      }
    }
    for (const x of add) {
      const prev = all.get(x.videoId);
      if (!prev || x.at >= prev.at) all.set(x.videoId, x);
    }
    for (const id of removeIds) all.delete(id);
    for (const [id, at] of Object.entries(removedAt)) if ((all.get(id)?.at ?? Infinity) <= at) all.delete(id);
    const kept = [...all.values()].sort((a, b) => b.at - a.at).slice(0, ARCHIVE_MAX);
    const buckets: Record<string, ArchiveBucket> = {};
    for (const x of kept) (buckets[archiveKey(videoBucket(x.videoId))] ??= {})[x.videoId] = x;
    const set: Record<string, unknown> = {};
    const remove: string[] = [];
    for (const k of ARCHIVE_KEYS) {
      const next = buckets[k];
      if (!next) {
        if (k in raw) remove.push(k);
      } else if (JSON.stringify(next) !== JSON.stringify(raw[k])) set[k] = next;
    }
    if (stale && kept.length > 0) set[ARCHIVE_EPOCH_KEY] = epoch;
    if (Object.keys(set).length > 0) await local.set(set);
    if (remove.length > 0) await local.remove(remove);
  });
}

// ---------------------------------------------------------------------------------------------------
// Retention (alarm `shoo:retention`, daily)

/**
 * Deletes Activity days, counters days, ruleStats days and Escalation days older than 30 days. Rule
 * totals and `lastHitAt` stay. Escalation records with nothing left and no "Not now" are dropped.
 */
export async function pruneRetention(local: AreaLike, now: number): Promise<void> {
  const start = retentionStart(now);
  const index = await getIndex(local);
  await dropActivityDays(
    local,
    Object.keys(index.days).filter((d) => d < start),
  );

  const all = await getDefined(local, null);
  const oldCounters = Object.keys(all).filter((k) => k.startsWith('counters:') && k.slice('counters:'.length) < start);
  if (oldCounters.length > 0) await local.remove(oldCounters);

  const stats = (all[RULE_STATS_KEY] as RuleStats | undefined) ?? {};
  const prunedStats: RuleStats = {};
  for (const [id, s] of Object.entries(stats)) {
    prunedStats[id] = { ...s, days: Object.fromEntries(Object.entries(s.days).filter(([d]) => d >= start)) };
  }

  const esc = (all[ESCALATION_KEY] as EscalationStore | undefined) ?? {};
  const prunedEsc: EscalationStore = {};
  for (const [key, rec] of Object.entries(esc)) {
    const p = pruneEscalation(rec, now);
    const empty = Object.keys(p.judged).length === 0 && Object.keys(p.topicRemoved).length === 0;
    if (!empty || p.dismissedAt !== undefined) prunedEsc[key] = p;
  }
  await local.set({ [RULE_STATS_KEY]: prunedStats, [ESCALATION_KEY]: prunedEsc });
}
