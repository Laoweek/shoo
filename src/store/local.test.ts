import { describe, expect, it } from 'vitest';
import { dayKey } from '~/core/escalation';
import type { ActivityEvent, Exception } from '~/core/types';
import {
  ACTIVITY_MAX_BYTES,
  ARCHIVE_MAX,
  VERDICT_BUCKET_MAX,
  appendActivity,
  bumpCounters,
  getActivityIndex,
  getArchive,
  getCounters,
  getEscalation,
  getModelsCache,
  getRuleStats,
  getVerdict,
  getVerdicts,
  hitsThisWeek,
  markActivitySeen,
  pruneRetention,
  putVerdicts,
  queryActivity,
  recordRuleHits,
  setModelsCache,
  updateArchive,
  updateEscalation,
  withQuotaRetry,
} from './local';
import { createMemoryArea, withQuota } from './testing/quota-storage';

const T0 = new Date(2026, 9, 10, 12, 0, 0).getTime(); // local noon, 2026-10-10
const DAY = 24 * 60 * 60 * 1000;

const event = (i: number, at: number, over: Partial<ActivityEvent> = {}): ActivityEvent => ({
  id: `e${i}`,
  kind: 'removed',
  at,
  videoId: `video${String(i).padStart(6, '0')}`,
  title: `Some removed video number ${i}`,
  channelName: 'Channel',
  ruleId: 'rule-1',
  batchId: `b${Math.floor(i / 16)}`,
  ...over,
});

describe('Verdict cache', () => {
  it('returns a record only for a matching rulesVersion and merges text and thumb', async () => {
    const local = createMemoryArea();
    await putVerdicts(local, [{ videoId: 'abcdefghijk', rulesVersion: 'v1', text: { pRemove: 0.2, model: 'm1' }, at: 1 }]);
    await putVerdicts(local, [{ videoId: 'abcdefghijk', rulesVersion: 'v1', thumb: { p: 0.9, ref: 'R2', model: 'm1' }, at: 2 }]);
    expect(await getVerdict(local, 'abcdefghijk', 'v1')).toEqual({ text: { pRemove: 0.2, model: 'm1' }, thumb: { p: 0.9, ref: 'R2', model: 'm1' }, rulesVersion: 'v1', at: 2 });
    expect(await getVerdict(local, 'abcdefghijk', 'v2')).toBeUndefined();
    await putVerdicts(local, [{ videoId: 'abcdefghijk', rulesVersion: 'v2', text: { pRemove: 0.7, model: 'm2' }, at: 3 }]);
    expect(await getVerdict(local, 'abcdefghijk', 'v2')).toEqual({ text: { pRemove: 0.7, model: 'm2' }, rulesVersion: 'v2', at: 3 });
    expect(Object.keys(await local.get(null))).toEqual(['verdicts:a']);
  });

  it('keeps at most 320 records per bucket, evicting the oldest', async () => {
    const local = createMemoryArea();
    const puts = Array.from({ length: VERDICT_BUCKET_MAX + 30 }, (_, i) => ({ videoId: `A${String(i).padStart(10, '0')}`, rulesVersion: 'v', text: { pRemove: 0.5, model: 'm' }, at: i }));
    await putVerdicts(local, puts.slice(0, 200));
    await putVerdicts(local, puts.slice(200));
    const bucket = (await local.get('verdicts:A'))['verdicts:A'] as Record<string, unknown>;
    expect(Object.keys(bucket)).toHaveLength(VERDICT_BUCKET_MAX);
    expect((await getVerdicts(local, [puts[0]!.videoId, puts.at(-1)!.videoId], 'v')).size).toBe(1);
  });
});

describe('Activity', () => {
  it('pages 200 events per day, indexes them and queries by day, kind, Rule, batch and text', async () => {
    const local = createMemoryArea();
    const today = Array.from({ length: 450 }, (_, i) => event(i, T0 + i));
    const yesterday = [event(1000, T0 - DAY, { kind: 'wouldRemove', ruleId: 'rule-2', title: 'Celebrity GOSSIP today' })];
    await appendActivity(local, today.slice(0, 120));
    await appendActivity(local, [...today.slice(120), ...yesterday]);
    const index = await getActivityIndex(local);
    expect(index.days).toEqual({ [dayKey(T0)]: 3, [dayKey(T0 - DAY)]: 1 });
    const page = (n: number) => local.get(`activity:${dayKey(T0)}:${n}`).then((r) => (r[`activity:${dayKey(T0)}:${n}`] as unknown[]).length);
    expect([await page(0), await page(1), await page(2)]).toEqual([200, 200, 50]);

    expect(await queryActivity(local)).toHaveLength(451);
    expect((await queryActivity(local, { limit: 2 })).map((e) => e.id)).toEqual(['e449', 'e448']);
    expect((await queryActivity(local, { fromDay: dayKey(T0) })).length).toBe(450);
    expect((await queryActivity(local, { kinds: ['wouldRemove'] })).map((e) => e.id)).toEqual(['e1000']);
    expect((await queryActivity(local, { ruleId: 'rule-2' })).map((e) => e.id)).toEqual(['e1000']);
    expect((await queryActivity(local, { batchId: 'b1' })).length).toBe(16);
    expect((await queryActivity(local, { text: 'gossip' })).map((e) => e.id)).toEqual(['e1000']);
  });

  it('truncates titles to 120 characters and marks rows seen', async () => {
    const local = createMemoryArea();
    await appendActivity(local, [event(1, T0, { title: 'x'.repeat(200) }), event(2, T0 - DAY)]);
    await markActivitySeen(local, ['e1', 'e2'], T0 + 5);
    const all = await queryActivity(local);
    expect(all.map((e) => [e.id, e.title?.length, e.seenAt])).toEqual([
      ['e1', 120, T0 + 5],
      ['e2', 'Some removed video number 2'.length, T0 + 5],
    ]);
  });

  it('drops the oldest day when Activity goes over 3 MB', async () => {
    const local = createMemoryArea();
    const padding = 'p'.repeat(1000);
    const perDay = 900; // ~1.1 MB per day, 4 days > 3 MB
    for (let d = 3; d >= 0; d--) {
      await appendActivity(local, Array.from({ length: perDay }, (_, i) => event(d * 10_000 + i, T0 - d * DAY + i, { detail: padding })));
    }
    const index = await getActivityIndex(local);
    const total = Object.values(index.bytes ?? {}).reduce((s, n) => s + n, 0);
    expect(total).toBeLessThanOrEqual(ACTIVITY_MAX_BYTES);
    expect(Object.keys(index.days)).not.toContain(dayKey(T0 - 3 * DAY));
    expect(Object.keys(index.days)).toContain(dayKey(T0));
    expect(Object.keys(await local.get(null)).some((k) => k.startsWith(`activity:${dayKey(T0 - 3 * DAY)}`))).toBe(false);
    // The index's byte count matches what is stored.
    const stored = await local.getBytesInUse!(Object.keys(await local.get(null)).filter((k) => k.startsWith('activity:') && k !== 'activity:index'));
    expect(total).toBe(stored);
  });
});

describe('quota errors', () => {
  async function filled() {
    const inner = createMemoryArea();
    for (let d = 4; d >= 1; d--) await appendActivity(inner, Array.from({ length: 100 }, (_, i) => event(d * 1000 + i, T0 - d * DAY + i, { detail: 'd'.repeat(200) })));
    await putVerdicts(inner, Array.from({ length: 100 }, (_, i) => ({ videoId: `B${String(i).padStart(10, '0')}`, rulesVersion: 'v', text: { pRemove: 0.5, model: 'cloudflare/clef-flash' }, at: i })));
    return inner;
  }
  const verdictCount = async (inner: ReturnType<typeof createMemoryArea>) => Object.keys(((await inner.get('verdicts:B'))['verdicts:B'] as object) ?? {}).length;

  it('evict Activity (oldest days) before the Verdict cache, then retry once', async () => {
    const inner = await filled();
    const used = await inner.getBytesInUse!(null);
    const local = withQuota(inner, { quotaBytes: used + 20_000 });
    const stages: string[] = [];
    await withQuotaRetry(local, () => local.set({ big: 'x'.repeat(40_000) }), (s) => stages.push(s));
    expect(stages).toEqual(['activity']);
    expect(Object.keys((await getActivityIndex(inner)).days).sort()).toEqual([dayKey(T0 - 2 * DAY), dayKey(T0 - DAY)]);
    expect(await verdictCount(inner)).toBe(100);
    expect((await inner.get('big')).big).toBeDefined();
  });

  it('evict the Verdict cache when evicting Activity was not enough', async () => {
    const inner = await filled();
    const used = await inner.getBytesInUse!(null);
    const local = withQuota(inner, { quotaBytes: used + 20_000 });
    // Bigger than what dropping the two oldest Activity days frees, smaller than that plus half the Verdicts.
    const index = await getActivityIndex(inner);
    const oldestTwo = Object.keys(index.days).sort().slice(0, 2).reduce((s, d) => s + (index.bytes?.[d] ?? 0), 0);
    const verdictBytes = await inner.getBytesInUse!('verdicts:B');
    const size = 20_000 + oldestTwo + Math.floor(verdictBytes / 4);
    const stages: string[] = [];
    await withQuotaRetry(local, () => local.set({ big: 'x'.repeat(size) }), (s) => stages.push(s));
    expect(stages).toEqual(['activity', 'verdicts']);
    expect(await verdictCount(inner)).toBe(50);
    // The newest Verdicts survive.
    expect(await getVerdict(inner, 'B0000000099', 'v')).toBeDefined();
    expect(await getVerdict(inner, 'B0000000000', 'v')).toBeUndefined();
  });

  it('a normal store write recovers from a quota error by evicting Activity', async () => {
    const inner = await filled();
    const local = withQuota(inner, { quotaBytes: (await inner.getBytesInUse!(null)) + 50 });
    await bumpCounters(local, '2026-10-10', { judged: 3 });
    expect(await getCounters(local, '2026-10-10')).toMatchObject({ judged: 3 });
    expect(Object.keys((await getActivityIndex(inner)).days)).toHaveLength(2);
  });

  it('other errors are not swallowed', async () => {
    const local = createMemoryArea();
    await expect(withQuotaRetry(local, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  });
});

describe('counters, stats, escalation, models, archive, retention', () => {
  it('counters add up per day', async () => {
    const local = createMemoryArea();
    await bumpCounters(local, '2026-10-10', { judged: 16, requests: 1, costUsd: 0.0004 });
    await bumpCounters(local, '2026-10-10', { judged: 4, removed: 2, requests: 1, costUsd: 0.0001 });
    expect(await getCounters(local, '2026-10-10')).toEqual({ judged: 20, removed: 2, requests: 2, costUsd: 0.0005 });
    expect(await getCounters(local, '2026-10-11')).toEqual({ judged: 0, removed: 0, requests: 0, costUsd: 0 });
  });

  it('rule stats keep days, total, lastHitAt and hits this week', async () => {
    const local = createMemoryArea();
    await recordRuleHits(local, [
      { ruleId: 'r1', at: T0 },
      { ruleId: 'r1', at: T0 - 8 * DAY, n: 3 },
      { ruleId: 'r2', at: T0 - DAY },
    ]);
    const stats = await getRuleStats(local);
    expect(stats.r1).toMatchObject({ total: 4, lastHitAt: T0 });
    expect(hitsThisWeek(stats.r1, T0)).toBe(1);
    expect(hitsThisWeek(stats.r2, T0)).toBe(1);
    expect(hitsThisWeek(undefined, T0)).toBe(0);
  });

  it('model list is cached for 24 hours', async () => {
    const local = createMemoryArea();
    await setModelsCache(local, { models: [{ id: 'cloudflare/clef-flash', images: true, pricePerMInput: 0.1 }], fetchedAt: T0 });
    expect(await getModelsCache(local, T0 + DAY - 1)).toBeDefined();
    expect(await getModelsCache(local, T0 + DAY)).toBeUndefined();
  });

  it('archive keeps the 5,000 newest Exceptions in 64 buckets', async () => {
    const local = createMemoryArea();
    const ids = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
    const xs: Exception[] = Array.from({ length: ARCHIVE_MAX + 100 }, (_, i) => ({ videoId: `${ids[i % 64]}${String(i).padStart(10, '0')}`, title: `t${i}`, at: i }));
    await updateArchive(local, xs);
    const archive = await getArchive(local);
    expect(archive).toHaveLength(ARCHIVE_MAX);
    expect(Math.min(...archive.map((x) => x.at))).toBe(100);
    expect(Object.keys(await local.get(null))).toHaveLength(64);
  });

  it('retention prunes Activity, counters, ruleStats days and Escalation days older than 30 days', async () => {
    const local = createMemoryArea();
    const old = T0 - 31 * DAY;
    const recent = T0 - 29 * DAY;
    await appendActivity(local, [event(1, old), event(2, recent), event(3, T0)]);
    await bumpCounters(local, dayKey(old), { judged: 1 });
    await bumpCounters(local, dayKey(recent), { judged: 1 });
    await recordRuleHits(local, [{ ruleId: 'r', at: old }, { ruleId: 'r', at: T0 }]);
    await updateEscalation(local, () => ({
      gone: { judged: { [dayKey(old)]: ['v1'] }, topicRemoved: { [dayKey(old)]: 1 } },
      dismissed: { judged: {}, topicRemoved: { [dayKey(old)]: 2 }, dismissedAt: old, removalsAtDismiss: 2 },
      live: { judged: { [dayKey(T0)]: ['v2'] }, topicRemoved: {} },
    }));
    await pruneRetention(local, T0);

    expect((await queryActivity(local)).map((e) => e.id)).toEqual(['e3', 'e2']);
    expect(Object.keys(await local.get(null)).filter((k) => k.startsWith('counters:'))).toEqual([`counters:${dayKey(recent)}`]);
    expect((await getRuleStats(local)).r).toEqual({ days: { [dayKey(T0)]: 1 }, total: 2, lastHitAt: T0 });
    const esc = await getEscalation(local);
    expect(Object.keys(esc).sort()).toEqual(['dismissed', 'live']);
    expect(esc.dismissed).toMatchObject({ topicRemoved: {}, removalsAtDismiss: 0 });
  });
});
