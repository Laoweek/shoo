// storage.local: settings, Verdict cache, Activity, counters, stats, Escalation, runtime, model list,
// Subscribed channels, Exception archive. Source of truth: docs/spec/architecture.md Section 8
// ("storage.local"), docs/spec/decision-engine.md Sections 1.2 (Verdict cache record) and 8.3 (accounting).
import { channelKey } from '~/core/channel';
import { dayKey, pruneEscalation, type EscalationRecord } from '~/core/escalation';
import { fnv1a32 } from '~/core/ids';
import { siteOfVideo, videoSite } from '~/core/sites';
import type { FailureState } from '~/core/runtime';
import type { SubscribedChannels } from '~/core/subscriptions';
import type { ActivityEvent, ActivityKind, Exception, Settings, SiteId } from '~/core/types';
import type { TextModelResult, ThumbModelResult } from '~/core/verdict';
import { getDefined, getOne, isQuotaError, isRecord, itemBytes, stableJson, type AreaLike } from './areas';
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
// Verdict cache (decision-engine.md Section 1.2): 1,024 small buckets by hash, so a batch reads and rewrites a few
// KB, in a compact layout, each record kept at most 30 days

/** A cached answer with `v`, the answer version it was asked under (answerVersions in core/ids.ts). */
type Versioned<T> = T & { v?: string };

export interface VerdictCacheRecord {
  text?: Versioned<TextModelResult>;
  thumb?: Versioned<ThumbModelResult>;
  rulesVersion: string;
  at: number; // epoch ms of the newest write
}

export const VERDICT_BUCKETS = 1024;
export const VERDICT_BUCKET_MAX = 20;
export const verdictKey = (videoId: string) => `vc:${fnv1a32(videoId) % VERDICT_BUCKETS}`;
const VERDICT_KEYS = Array.from({ length: VERDICT_BUCKETS }, (_, n) => `vc:${n}`);
/** The 64 buckets of Shoo 0.2.0, deleted when the writer starts. */
const LEGACY_VERDICT_KEYS = VIDEO_BUCKETS.map((b) => `verdicts:${b}`);

/**
 * A bucket as stored: the versions and models its records name, listed once, and each record as
 * `{ v: version index, a: at, t?: text, h?: thumb }`. A result's fields go under short names, and its model and its
 * own answer version `v`, when it has one, become indexes into those lists.
 */
interface StoredVerdictBucket {
  v: string[];
  m: string[];
  r: Record<string, { v: number; a: number; t?: Record<string, unknown>; h?: Record<string, unknown> }>;
}

type Records = Map<string, VerdictCacheRecord>;

const SHORT: Record<string, string> = { pRemove: 'p', ref: 'r', pKeep: 'k', keepRef: 'kr', keepOnly: 'o', model: 'm' };
const TEXT_LONG: Record<string, string> = { p: 'pRemove', r: 'ref', k: 'pKeep', kr: 'keepRef', o: 'keepOnly', m: 'model' };
const THUMB_LONG: Record<string, string> = { r: 'ref', m: 'model' };

/** A result with its fields renamed through `names` (others keep their name), its model and version mapped. */
function renamed(result: object, names: Record<string, string>, model: (x: never) => unknown, version: (x: never) => unknown): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(result).map(([k, x]) => {
      const name = names[k] ?? k;
      return [name, name === 'm' || name === 'model' ? model(x as never) : name === 'v' ? version(x as never) : x];
    }),
  );
}

function decodeBucket(raw: unknown): Records {
  const out: Records = new Map();
  if (!isRecord(raw) || !Array.isArray(raw.v) || !Array.isArray(raw.m) || !isRecord(raw.r)) return out;
  const { v: versions, m: models, r } = raw as unknown as StoredVerdictBucket;
  const model = (i: number) => models[i];
  const version = (i: number) => versions[i];
  for (const [videoId, c] of Object.entries(r)) {
    const rec: VerdictCacheRecord = { rulesVersion: versions[c.v]!, at: c.a };
    if (c.t) rec.text = renamed(c.t, TEXT_LONG, model, version) as unknown as Versioned<TextModelResult>;
    if (c.h) rec.thumb = renamed(c.h, THUMB_LONG, model, version) as unknown as Versioned<ThumbModelResult>;
    out.set(videoId, rec);
  }
  return out;
}

function encodeBucket(records: Records): StoredVerdictBucket {
  const out: StoredVerdictBucket = { v: [], m: [], r: {} };
  const indexIn = (list: string[], s: string) => {
    if (!list.includes(s)) list.push(s);
    return list.indexOf(s);
  };
  const model = (s: string) => indexIn(out.m, s);
  const version = (s: string) => indexIn(out.v, s);
  for (const [videoId, { rulesVersion, at, text, thumb }] of records) {
    const c: StoredVerdictBucket['r'][string] = { v: version(rulesVersion), a: at };
    if (text) c.t = renamed(text, SHORT, model, version);
    if (thumb) c.h = renamed(thumb, SHORT, model, version);
    out.r[videoId] = c;
  }
  return out;
}

/** First epoch ms the Verdict cache keeps: the start of the first day retention keeps. */
function verdictCutoff(now: number): number {
  const d = new Date(now);
  d.setDate(d.getDate() - (RETENTION_DAYS - 1));
  return d.setHours(0, 0, 0, 0);
}

/** The newest `max` records written since `cutoff`. */
function keepNewest(records: Records, max: number, cutoff: number): Records {
  const fresh = [...records].filter(([, rec]) => rec.at >= cutoff);
  if (fresh.length > max) fresh.sort(([, a], [, b]) => b.at - a.at).splice(max);
  return new Map(fresh);
}

/** Records for these videos whose `rulesVersion` matches and that are not past 30 days. Misses and stale records are left out. */
export async function getVerdicts(local: AreaLike, videoIds: string[], rulesVersion: string, now: number): Promise<Map<string, VerdictCacheRecord>> {
  const keys = [...new Set(videoIds.map(verdictKey))];
  const raw = keys.length > 0 ? await getDefined(local, keys) : {};
  const buckets = new Map(keys.map((k) => [k, decodeBucket(raw[k])]));
  const cutoff = verdictCutoff(now);
  const out = new Map<string, VerdictCacheRecord>();
  for (const v of videoIds) {
    const rec = buckets.get(verdictKey(v))!.get(v);
    if (rec && rec.rulesVersion === rulesVersion && rec.at >= cutoff) out.set(v, rec);
  }
  return out;
}

export async function getVerdict(local: AreaLike, videoId: string, rulesVersion: string, now: number): Promise<VerdictCacheRecord | undefined> {
  return (await getVerdicts(local, [videoId], rulesVersion, now)).get(videoId);
}

export interface VerdictPut {
  videoId: string;
  rulesVersion: string;
  text?: Versioned<TextModelResult>;
  thumb?: Versioned<ThumbModelResult>;
  at: number;
}

/**
 * Stores model results. A record with the same `rulesVersion` is merged (text and thumb kept side by side), any
 * other is replaced. Each bucket keeps its 20 newest records by `at`, and none older than 30 days.
 */
export async function putVerdicts(local: AreaLike, puts: VerdictPut[]): Promise<void> {
  if (puts.length === 0) return;
  const cutoff = verdictCutoff(Math.max(...puts.map((p) => p.at)));
  await withQuotaRetry(local, async () => {
    const keys = [...new Set(puts.map((p) => verdictKey(p.videoId)))];
    const raw = await getDefined(local, keys);
    const buckets = new Map(keys.map((k) => [k, decodeBucket(raw[k])]));
    for (const p of puts) {
      const bucket = buckets.get(verdictKey(p.videoId))!;
      const prev = bucket.get(p.videoId);
      const base: Partial<VerdictCacheRecord> = prev && prev.rulesVersion === p.rulesVersion ? prev : {};
      const next: VerdictCacheRecord = { ...base, rulesVersion: p.rulesVersion, at: p.at };
      if (p.text) next.text = p.text;
      if (p.thumb) next.thumb = p.thumb;
      bucket.set(p.videoId, next);
    }
    const writes: Record<string, StoredVerdictBucket> = {};
    for (const [k, records] of buckets) writes[k] = encodeBucket(keepNewest(records, VERDICT_BUCKET_MAX, cutoff));
    await local.set(writes);
  });
}

/** Drops the oldest `fraction` of the Verdict cache's records. */
export async function evictOldestVerdicts(local: AreaLike, fraction: number): Promise<void> {
  const raw = await getDefined(local, VERDICT_KEYS);
  const buckets = new Map(Object.entries(raw).map(([k, v]) => [k, decodeBucket(v)]));
  const all = [...buckets.values()].flatMap((records) => [...records]).sort(([, a], [, b]) => a.at - b.at);
  const oldest = new Set(all.slice(0, Math.floor(all.length * fraction)).map(([videoId]) => videoId));
  await writeVerdictBuckets(local, buckets, (records) => new Map([...records].filter(([videoId]) => !oldest.has(videoId))));
}

/** Rewrites the buckets `keep` changes, and removes those it empties. */
async function writeVerdictBuckets(local: AreaLike, buckets: Map<string, Records>, keep: (records: Records) => Records): Promise<void> {
  const set: Record<string, StoredVerdictBucket> = {};
  const remove: string[] = [];
  for (const [k, records] of buckets) {
    const kept = keep(records);
    if (kept.size === records.size) continue;
    if (kept.size === 0) remove.push(k);
    else set[k] = encodeBucket(kept);
  }
  if (Object.keys(set).length > 0) await local.set(set);
  if (remove.length > 0) await local.remove(remove);
}

/**
 * Deletes the Verdict cache of Shoo 0.2.0 (64 `verdicts:<char>` buckets). Its records were asked under one version
 * for all answers, so none would match the answer versions they are looked up by now, and they could only miss.
 */
export async function removeLegacyVerdicts(local: AreaLike): Promise<void> {
  await local.remove(LEGACY_VERDICT_KEYS);
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
      const ev = capFields(e);
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
      let open = itemBytes(key, page);
      for (const ev of list) {
        // The cap drops older days first, and a day's own events past it are not recorded.
        const size = itemBytes('', ev) + 1;
        if (bytes + open + size > ACTIVITY_MAX_BYTES) break;
        if (page.length >= ACTIVITY_PAGE_MAX) {
          writes[activityPageKey(day, n)] = page;
          bytes += itemBytes(activityPageKey(day, n), page);
          n++;
          page = [];
          open = itemBytes(activityPageKey(day, n), page);
        }
        page = [...page, ev];
        open += size;
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

/** An event with its title and channel name cut to 120 characters, and the channel key taken from the cut name. */
function capFields(e: ActivityEvent): ActivityEvent {
  const out = { ...e };
  if (e.title && e.title.length > ACTIVITY_TITLE_MAX) out.title = e.title.slice(0, ACTIVITY_TITLE_MAX);
  if (e.channelName && e.channelName.length > ACTIVITY_TITLE_MAX) {
    out.channelName = e.channelName.slice(0, ACTIVITY_TITLE_MAX);
    if (e.channelKey) out.channelKey = channelKey(out.channelName);
  }
  return out;
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

/**
 * Matching events, newest first. With a `limit`, days are read newest first and reading stops once a whole day
 * brings the matches to the limit.
 */
export async function queryActivity(local: AreaLike, q: ActivityQuery = {}): Promise<ActivityEvent[]> {
  const index = await getIndex(local);
  const days = Object.keys(index.days)
    .filter((d) => (!q.fromDay || d >= q.fromDay) && (!q.toDay || d <= q.toDay))
    .sort()
    .reverse();
  const needle = q.text?.trim().toLocaleLowerCase();
  const matches = (e: ActivityEvent) =>
    (!q.kinds || q.kinds.includes(e.kind)) &&
    (!q.ruleId || e.ruleId === q.ruleId) &&
    (!q.batchId || e.batchId === q.batchId) &&
    (!q.videoId || e.videoId === q.videoId) &&
    (!q.site || siteOfVideo(e) === q.site) &&
    (!needle || [e.title, e.channelName, e.detail].some((s) => s?.toLocaleLowerCase().includes(needle)));
  // Without a limit every day is needed, so they are read in one call.
  const reads = q.limit === undefined ? [days] : days.map((d) => [d]);
  const out: ActivityEvent[] = [];
  for (const group of reads) {
    const keys = group.flatMap((d) => pageKeys(d, index.days[d] ?? 0));
    if (keys.length === 0) continue;
    for (const page of Object.values(await getDefined(local, keys))) {
      if (Array.isArray(page)) out.push(...(page as ActivityEvent[]).filter(matches));
    }
    if (q.limit !== undefined && out.length >= q.limit) break;
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
// Escalation: each channel's state in one key, the videos judged on a day in one key per day, so a batch
// reads and writes only today's key

export const ESCALATION_KEY = 'escalation';
export const escalationDayKey = (day: string) => `escalation:${day}`;
/** Set once a day's judged videos reached ESCALATION_DAY_MAX_BYTES and a video went uncounted. */
export const escalationFullKey = (day: string) => `escalation:${day}:full`;
/** A day's judged videos stop growing past this size, so 30 days stay within about 3 MB whatever the Tiles say. */
export const ESCALATION_DAY_MAX_BYTES = 100 * 1024;
/** Size of the channel records. Past it the records whose last Topic removal is oldest go first. */
export const ESCALATION_RECORDS_MAX_BYTES = 512 * 1024;

/** A channel's state without its judged videos, which live in the day keys. */
export type EscalationMeta = Omit<EscalationRecord, 'judged'>;
export type EscalationMetaStore = Record<string, EscalationMeta>;
/** Full records, judged videos of the 30-day window included. */
export type EscalationStore = Record<string, EscalationRecord>;
/** Records stored before the day keys also hold their judged videos. */
type StoredMeta = EscalationMeta & Partial<Pick<EscalationRecord, 'judged'>>;

export async function getEscalationMeta(local: AreaLike): Promise<Record<string, StoredMeta>> {
  return (await getOne<Record<string, StoredMeta>>(local, ESCALATION_KEY)) ?? {};
}

/**
 * Full records with the videos judged in the 30-day window. With `pick`, only the channel records it accepts,
 * and the day keys are not read when it accepts none. Without it, also channels that have only judged videos.
 */
export async function getEscalation(local: AreaLike, now: number, pick?: (key: string, meta: EscalationMeta) => boolean): Promise<EscalationStore> {
  const out: EscalationStore = {};
  for (const [key, { judged, ...rec }] of Object.entries(await getEscalationMeta(local))) {
    if (!pick || pick(key, rec)) out[key] = { ...rec, judged: { ...judged } };
  }
  if (pick && Object.keys(out).length === 0) return out;
  const days = Array.from({ length: RETENTION_DAYS }, (_, i) => {
    const d = new Date(now);
    return dayKey(d.setDate(d.getDate() - i));
  });
  const shards = await getDefined(local, days.map(escalationDayKey));
  for (const day of days) {
    for (const [key, ids] of Object.entries((shards[escalationDayKey(day)] ?? {}) as Record<string, string[]>)) {
      if (pick && !out[key]) continue;
      const rec = (out[key] ??= { judged: {}, topicRemoved: {} });
      rec.judged[day] = [...new Set([...(rec.judged[day] ?? []), ...ids])];
    }
  }
  return out;
}

/** Bytes a value adds inside a JSON object or array, separator included. */
const jsonBytes = (v: unknown) => itemBytes('', v) + 1;

/** A judged Tile's channel (its Escalation key) and video. */
export interface JudgedTile {
  key: string;
  videoId: string;
}

/**
 * Counts each Tile's video once on `day` for its channel, at most ESCALATION_DAY_MAX_BYTES a day. The first video
 * left out marks the day full (`escalationFullKey`). Reads and writes only that day's keys, and writes nothing
 * when every video was already counted.
 */
export async function recordEscalationJudged(local: AreaLike, day: string, tiles: JudgedTile[]): Promise<void> {
  if (tiles.length === 0) return;
  await withQuotaRetry(local, async () => {
    const shardKey = escalationDayKey(day);
    const fullKey = escalationFullKey(day);
    const stored = await local.get([shardKey, fullKey]);
    const shard = { ...(stored[shardKey] as Record<string, string[]> | undefined) };
    let bytes = itemBytes(shardKey, shard);
    let changed = false;
    let cut = false;
    for (const { key, videoId } of tiles) {
      const ids = shard[key];
      if (ids?.includes(videoId)) continue;
      const added = ids ? jsonBytes(videoId) : jsonBytes(key) + jsonBytes([videoId]);
      if (bytes + added > ESCALATION_DAY_MAX_BYTES) {
        cut = true;
        continue;
      }
      shard[key] = [...(ids ?? []), videoId];
      bytes += added;
      changed = true;
    }
    const writes: Record<string, unknown> = {};
    if (changed) writes[shardKey] = shard;
    if (cut && stored[fullKey] !== true) writes[fullKey] = true;
    if (Object.keys(writes).length > 0) await local.set(writes);
  });
}

/** Whether `day` left judged videos uncounted. Its Topic removals then go uncounted too, so no share rests on a cut count. */
export async function escalationDayFull(local: AreaLike, day: string): Promise<boolean> {
  return (await getOne<boolean>(local, escalationFullKey(day))) === true;
}

/** Drops the records whose last Topic removal is oldest until the store fits, keeping pending suggestions and "Not now". */
function capMeta(all: EscalationMetaStore): EscalationMetaStore {
  let bytes = itemBytes(ESCALATION_KEY, all);
  if (bytes <= ESCALATION_RECORDS_MAX_BYTES) return all;
  const last = (rec: EscalationMeta) => Object.keys(rec.topicRemoved).sort().pop() ?? '';
  const out = { ...all };
  for (const [key, rec] of Object.entries(all).sort(([, a], [, b]) => last(a).localeCompare(last(b)))) {
    if (bytes <= ESCALATION_RECORDS_MAX_BYTES) break;
    if (rec.suggestedAt !== undefined || rec.dismissedAt !== undefined) continue;
    delete out[key];
    bytes -= jsonBytes(key) + jsonBytes(rec);
  }
  return out;
}

/** Read-modify-write of the channel records. Returning `all` unchanged writes nothing. */
export async function updateEscalation(local: AreaLike, fn: (all: EscalationMetaStore) => EscalationMetaStore): Promise<EscalationMetaStore> {
  return withQuotaRetry(local, async () => {
    const all = await getEscalationMeta(local);
    const next = fn(all);
    if (next === all) return all;
    const capped = capMeta(next);
    await local.set({ [ESCALATION_KEY]: capped });
    return capped;
  });
}

/** Deletes every Escalation count and record (Escalation turned Off). */
export async function clearEscalation(local: AreaLike): Promise<void> {
  await local.remove(Object.keys(await local.get(null)).filter((k) => /^escalation(:|$)/.test(k)));
}

/**
 * Moves judged videos stored inside the channel records (before the day keys) into the day keys, merged with
 * what those hold, then drops them from the records, with any record left with no Topic removal. A run cut short
 * before the records are rewritten repeats safely.
 */
export async function splitEscalationDays(local: AreaLike): Promise<void> {
  const meta = await getEscalationMeta(local);
  if (!Object.values(meta).some((rec) => rec.judged)) return;
  const byDay: Record<string, JudgedTile[]> = {};
  for (const [key, rec] of Object.entries(meta)) {
    for (const [day, ids] of Object.entries(rec.judged ?? {})) for (const videoId of ids) (byDay[day] ??= []).push({ key, videoId });
  }
  for (const [day, tiles] of Object.entries(byDay)) await recordEscalationJudged(local, day, tiles);
  const next: EscalationMetaStore = {};
  for (const [key, { judged: _judged, ...rec }] of Object.entries(meta)) if (Object.keys(rec.topicRemoved).length > 0) next[key] = rec;
  await withQuotaRetry(local, () => local.set({ [ESCALATION_KEY]: next }));
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
/**
 * How many Exceptions the archive holds and when the newest was kept, so the Settings index can count them and the
 * judge can pick recent kept examples without reading the archive. Absent means empty. An archive from before it
 * gets it when the writer starts.
 */
export const ARCHIVE_SUMMARY_KEY = 'exceptions:summary';
type ArchiveBucket = Record<string, Exception>;

/** Archived Exceptions. Empty when the archive is older than `epoch` (a Reset elsewhere not yet applied here). */
export async function getArchive(local: AreaLike, epoch = 0): Promise<Exception[]> {
  const raw = await getDefined(local, [...ARCHIVE_KEYS, ARCHIVE_EPOCH_KEY]);
  if (archiveEpoch(raw) < epoch) return [];
  return ARCHIVE_KEYS.flatMap((k) => (isRecord(raw[k]) ? (Object.values(raw[k]) as Exception[]) : []));
}

const archiveEpoch = (raw: Record<string, unknown>): number => (typeof raw[ARCHIVE_EPOCH_KEY] === 'number' ? raw[ARCHIVE_EPOCH_KEY] : 0);

/** Archived Exceptions for these videos, reading only the buckets they fall in. Empty like `getArchive` for an older epoch. */
export async function getArchived(local: AreaLike, videoIds: string[], epoch = 0): Promise<Exception[]> {
  if (videoIds.length === 0) return [];
  const keys = [...new Set(videoIds.map((v) => archiveKey(videoBucket(v))))];
  const raw = await getDefined(local, [...keys, ARCHIVE_EPOCH_KEY]);
  if (archiveEpoch(raw) < epoch) return [];
  return videoIds.flatMap((v) => {
    const bucket = raw[archiveKey(videoBucket(v))];
    const x = isRecord(bucket) ? (bucket[v] as Exception | undefined) : undefined;
    return x ? [x] : [];
  });
}

export interface ArchiveSummary {
  count: number;
  /** The newest archived Exception's `at`, 0 when there is none. */
  newestAt: number;
}

const EMPTY_SUMMARY: ArchiveSummary = { count: 0, newestAt: 0 };

/** How many Exceptions the archive holds and the newest one's `at`, without reading them. */
export async function getArchiveSummary(local: AreaLike, epoch = 0): Promise<ArchiveSummary> {
  const raw = await getDefined(local, [ARCHIVE_SUMMARY_KEY, ARCHIVE_EPOCH_KEY]);
  return archiveEpoch(raw) < epoch ? EMPTY_SUMMARY : archiveSummary(raw);
}

const archiveSummary = (raw: Record<string, unknown>): ArchiveSummary => {
  const s = raw[ARCHIVE_SUMMARY_KEY];
  return isRecord(s) && typeof s.count === 'number' && typeof s.newestAt === 'number' ? { count: s.count, newestAt: s.newestAt } : EMPTY_SUMMARY;
};

/**
 * Adds Exceptions to the archive, removes `removeIds` and every entry not newer than its `removedAt`
 * record, then keeps the 5,000 newest. Writes only the buckets that changed. With an `epoch` above the
 * archive's own, everything archived before is dropped first.
 */
export async function updateArchive(local: AreaLike, add: Exception[], removeIds: string[] = [], removedAt: Record<string, number> = {}, epoch?: number): Promise<void> {
  if (add.length === 0 && removeIds.length === 0 && Object.keys(removedAt).length === 0 && epoch === undefined) return;
  await withQuotaRetry(local, async () => {
    const raw = await getDefined(local, [...ARCHIVE_KEYS, ARCHIVE_EPOCH_KEY, ARCHIVE_SUMMARY_KEY]);
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
      } else if (stableJson(next) !== stableJson(raw[k])) set[k] = next;
    }
    if (stale && kept.length > 0) set[ARCHIVE_EPOCH_KEY] = epoch;
    const summary: ArchiveSummary = { count: kept.length, newestAt: kept[0]?.at ?? 0 };
    const stored = archiveSummary(raw);
    if (stored.count !== summary.count || stored.newestAt !== summary.newestAt) set[ARCHIVE_SUMMARY_KEY] = summary;
    if (Object.keys(set).length > 0) await local.set(set);
    if (remove.length > 0) await local.remove(remove);
  });
}

// ---------------------------------------------------------------------------------------------------
// Retention (alarm `shoo:retention`, daily)

/**
 * Deletes Activity days, counters days, ruleStats days, Verdict cache records and Escalation days older than 30
 * days. Rule totals and `lastHitAt` stay. Escalation records with nothing left are dropped, "Not now" or not.
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

  const verdictBuckets = new Map(Object.entries(all).flatMap(([k, v]) => (k.startsWith('vc:') ? [[k, decodeBucket(v)] as const] : [])));
  const cutoff = verdictCutoff(now);
  await writeVerdictBuckets(local, verdictBuckets, (records) => keepNewest(records, Infinity, cutoff));

  const oldEscalationDays = Object.keys(all).filter((k) => k.startsWith('escalation:') && k.slice('escalation:'.length) < start);
  if (oldEscalationDays.length > 0) await local.remove(oldEscalationDays);
  const prunedEsc: Record<string, StoredMeta> = {};
  for (const [key, rec] of Object.entries((all[ESCALATION_KEY] ?? {}) as Record<string, StoredMeta>)) {
    const { judged, ...pruned } = pruneEscalation({ judged: {}, ...rec }, now);
    // A record with no removal left cannot qualify, and its "Not now" holds nothing back: 3 more removals are needed either way.
    if (Object.keys(pruned.topicRemoved).length > 0 || Object.keys(judged).length > 0) prunedEsc[key] = rec.judged ? { ...pruned, judged } : pruned;
  }
  await local.set({ [RULE_STATS_KEY]: prunedStats, [ESCALATION_KEY]: prunedEsc });
}
