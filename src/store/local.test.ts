import { describe, expect, it } from 'vitest';
import { channelKey } from '~/core/channel';
import { dayKey } from '~/core/escalation';
import type { ActivityEvent, Exception } from '~/core/types';
import {
  ACTIVITY_MAX_BYTES,
  ARCHIVE_MAX,
  ESCALATION_DAY_MAX_BYTES,
  ESCALATION_KEY,
  ESCALATION_RECORDS_MAX_BYTES,
  VERDICT_BUCKET_MAX,
  VERDICT_BUCKETS,
  appendActivity,
  bumpCounters,
  getActivityIndex,
  getArchive,
  getCounters,
  escalationDayKey,
  getEscalation,
  getEscalationMeta,
  getModelsCache,
  getRuleStats,
  getVerdict,
  getVerdicts,
  hitsThisWeek,
  markActivitySeen,
  pruneRetention,
  putVerdicts,
  queryActivity,
  recordEscalationJudged,
  recordRuleHits,
  setModelsCache,
  splitEscalationDays,
  updateArchive,
  updateEscalation,
  verdictKey,
  videoBucket,
  VIDEO_BUCKETS,
  withQuotaRetry,
} from './local';
import { DEFAULT_SETTINGS, withDefaults } from './schema';
import { itemBytes } from './areas';
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
  /** `n` YouTube-like ids that all fall in the same bucket. */
  const sameBucket = (n: number) => {
    const ids: string[] = [];
    for (let i = 0; ids.length < n; i++) {
      const id = `A${String(i).padStart(10, '0')}`;
      if (verdictKey(id) === verdictKey('A0000000000')) ids.push(id);
    }
    return ids;
  };

  it('returns a record only for a matching rulesVersion and merges text and thumb', async () => {
    const local = createMemoryArea();
    await putVerdicts(local, [{ videoId: 'abcdefghijk', rulesVersion: 'v1', text: { pRemove: 0.2, model: 'm1' }, at: T0 }]);
    await putVerdicts(local, [{ videoId: 'abcdefghijk', rulesVersion: 'v1', thumb: { p: 0.9, ref: 'R2', model: 'm1' }, at: T0 + 1 }]);
    expect(await getVerdict(local, 'abcdefghijk', 'v1', T0)).toEqual({ text: { pRemove: 0.2, model: 'm1' }, thumb: { p: 0.9, ref: 'R2', model: 'm1' }, rulesVersion: 'v1', at: T0 + 1 });
    expect(await getVerdict(local, 'abcdefghijk', 'v2', T0)).toBeUndefined();
    await putVerdicts(local, [{ videoId: 'abcdefghijk', rulesVersion: 'v2', text: { pRemove: 0.7, model: 'm2' }, at: T0 + 2 }]);
    expect(await getVerdict(local, 'abcdefghijk', 'v2', T0)).toEqual({ text: { pRemove: 0.7, model: 'm2' }, rulesVersion: 'v2', at: T0 + 2 });
    expect(Object.keys(await local.get(null))).toEqual([verdictKey('abcdefghijk')]);
  });

  it('reads back every field of a model result, its own answer version included', async () => {
    const local = createMemoryArea();
    const full = {
      text: { pRemove: 0.123456789, ref: 'R12', pKeep: 0.98765, keepRef: 'K3', model: 'cloudflare/clef-flash', keepOnly: true as const, v: 'textversion0001' },
      thumb: { p: 0.5, ref: 'R4', model: 'openai/gpt-5-nano', v: 'thumbversion001' },
    };
    await putVerdicts(local, [{ videoId: 'BV1xx411c7mD', rulesVersion: 'rv', ...full, at: T0 }]);
    expect(await getVerdict(local, 'BV1xx411c7mD', 'rv', T0)).toEqual({ ...full, rulesVersion: 'rv', at: T0 });
  });

  it('keeps at most 20 records per bucket, evicting the oldest', async () => {
    const local = createMemoryArea();
    const ids = sameBucket(VERDICT_BUCKET_MAX + 5);
    const puts = ids.map((videoId, i) => ({ videoId, rulesVersion: 'v', text: { pRemove: 0.5, model: 'm' }, at: T0 + i }));
    await putVerdicts(local, puts.slice(0, 10));
    await putVerdicts(local, puts.slice(10));
    expect([...(await getVerdicts(local, ids, 'v', T0)).keys()]).toEqual(ids.slice(5));
  });

  it('reads a few KB for a batch of 16 from a full cache', async () => {
    const local = createMemoryArea();
    const all = Array.from({ length: VERDICT_BUCKETS * VERDICT_BUCKET_MAX }, (_, i) => `v${String(i).padStart(10, '0')}`);
    const text = { pRemove: 0.8765432101234567, ref: 'R3', pKeep: 0.0123456789012345, keepRef: 'K1', model: 'cloudflare/clef-flash' };
    await putVerdicts(local, all.map((videoId, i) => ({ videoId, rulesVersion: '0123456789abcdef', text, at: T0 + i })));
    let read = 0;
    const get = local.get.bind(local);
    local.get = async (keys) => {
      const out = await get(keys);
      read += Object.entries(out).reduce((sum, [k, v]) => sum + itemBytes(k, v), 0);
      return out;
    };
    expect((await getVerdicts(local, all.slice(-16), '0123456789abcdef', T0)).size).toBe(16);
    expect(read).toBeLessThan(48 * 1024);
    // About half the bytes of the same records stored whole (legacy layout).
    const whole = itemBytes('', Object.fromEntries(all.map((v, i) => [v, { text, rulesVersion: '0123456789abcdef', at: T0 + i }])));
    expect((await local.getBytesInUse!(null)) / whole).toBeLessThan(0.6);
  });

  it('keeps records 30 days: older ones miss and retention deletes them', async () => {
    const local = createMemoryArea();
    const text = { pRemove: 0.5, model: 'm' };
    await putVerdicts(local, [
      { videoId: 'oldvideo001', rulesVersion: 'v', text, at: T0 - 31 * DAY },
      { videoId: 'newvideo001', rulesVersion: 'v', text, at: T0 - 29 * DAY },
    ]);
    expect([...(await getVerdicts(local, ['oldvideo001', 'newvideo001'], 'v', T0)).keys()]).toEqual(['newvideo001']);
    await pruneRetention(local, T0);
    const stored = Object.entries(await local.get(null)).filter(([k]) => k.startsWith('vc:'));
    expect(JSON.stringify(stored)).not.toContain('oldvideo001');
    expect(JSON.stringify(stored)).toContain('newvideo001');
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

  it('with a limit reads days newest first and stops once a whole day reaches it', async () => {
    const local = createMemoryArea();
    await appendActivity(local, [event(1, T0 - 2 * DAY), event(2, T0 - DAY), event(3, T0), event(4, T0 + 1)]);
    const read: string[] = [];
    const get = local.get.bind(local);
    local.get = (keys) => {
      read.push(...(Array.isArray(keys) ? keys : [String(keys)]));
      return get(keys);
    };
    expect((await queryActivity(local, { limit: 2 })).map((e) => e.id)).toEqual(['e4', 'e3']);
    expect(read.filter((k) => k !== 'activity:index')).toEqual([`activity:${dayKey(T0)}:0`]);
    expect((await queryActivity(local, { limit: 3 })).map((e) => e.id)).toEqual(['e4', 'e3', 'e2']);
  });

  it('files an escalated event recorded before Sites under YouTube', async () => {
    const local = createMemoryArea();
    const escalated = event(1, T0, { kind: 'escalated', videoId: undefined, channelName: 'Hustle Daily' });
    await appendActivity(local, [escalated]);
    expect((await queryActivity(local, { site: 'youtube' })).map((e) => e.id)).toEqual(['e1']);
    expect(await queryActivity(local, { site: 'bilibili' })).toEqual([]);
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
    await putVerdicts(inner, verdictIds.map((videoId, i) => ({ videoId, rulesVersion: 'v', text: { pRemove: 0.5, model: 'cloudflare/clef-flash' }, at: T0 + i })));
    return inner;
  }
  const verdictIds = Array.from({ length: 100 }, (_, i) => `B${String(i).padStart(10, '0')}`);
  const verdictCount = async (inner: ReturnType<typeof createMemoryArea>) => (await getVerdicts(inner, verdictIds, 'v', T0)).size;

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
    const verdictBytes = await inner.getBytesInUse!(Object.keys(await inner.get(null)).filter((k) => k.startsWith('vc:')));
    const size = 20_000 + oldestTwo + Math.floor(verdictBytes / 4);
    const stages: string[] = [];
    await withQuotaRetry(local, () => local.set({ big: 'x'.repeat(size) }), (s) => stages.push(s));
    expect(stages).toEqual(['activity', 'verdicts']);
    expect(await verdictCount(inner)).toBe(50);
    // The newest Verdicts survive.
    expect(await getVerdict(inner, 'B0000000099', 'v', T0)).toBeDefined();
    expect(await getVerdict(inner, 'B0000000000', 'v', T0)).toBeUndefined();
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
    expect(Object.keys(await local.get(null)).filter((k) => k.startsWith('exceptions:archive:'))).toHaveLength(64);
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
      gone: { topicRemoved: { [dayKey(old)]: 1 } },
      dismissed: { topicRemoved: { [dayKey(old)]: 2 }, dismissedAt: old, removalsAtDismiss: 2 },
      live: { topicRemoved: { [dayKey(old)]: 1, [dayKey(T0)]: 1 }, dismissedAt: old, removalsAtDismiss: 2 },
    }));
    await recordEscalationJudged(local, dayKey(old), [{ key: 'gone', videoId: 'v1' }]);
    await recordEscalationJudged(local, dayKey(T0), [{ key: 'live', videoId: 'v2' }]);
    await pruneRetention(local, T0);

    expect((await queryActivity(local)).map((e) => e.id)).toEqual(['e3', 'e2']);
    expect(Object.keys(await local.get(null)).filter((k) => k.startsWith('counters:'))).toEqual([`counters:${dayKey(recent)}`]);
    expect((await getRuleStats(local)).r).toEqual({ days: { [dayKey(T0)]: 1 }, total: 2, lastHitAt: T0 });
    expect(Object.keys(await local.get(null)).filter((k) => k.startsWith('escalation:'))).toEqual([escalationDayKey(dayKey(T0))]);
    // A "Not now" with no removal left in the window is dropped. One with removals left keeps holding the channel back.
    const esc = await getEscalation(local, T0);
    expect(Object.keys(esc)).toEqual(['live']);
    expect(esc.live).toMatchObject({ judged: { [dayKey(T0)]: ['v2'] }, topicRemoved: { [dayKey(T0)]: 1 }, dismissedAt: old, removalsAtDismiss: 1 });
  });
});

describe('Activity limits', () => {
  it('keeps a single day within the 3 MB cap, and cuts channel names like titles', async () => {
    const local = createMemoryArea();
    const long = 'c'.repeat(1000);
    for (let round = 0; round < 8; round++) {
      const events = Array.from({ length: 1000 }, (_, i) => event(round * 1000 + i, T0 + i, { title: 't'.repeat(1000), channelName: long, channelKey: channelKey(long) }));
      await appendActivity(local, events);
    }
    const stored = Object.entries(await local.get(null)).filter(([k]) => /^activity:\d/.test(k));
    expect(stored.reduce((sum, [k, v]) => sum + itemBytes(k, v), 0)).toBeLessThanOrEqual(ACTIVITY_MAX_BYTES);
    const [newest] = await queryActivity(local, { limit: 1 });
    expect(newest).toMatchObject({ channelName: 'c'.repeat(120), channelKey: channelKey('c'.repeat(120)) });
  });
});

describe('Escalation store', () => {
  const today = dayKey(T0);
  const writtenKeys = (local: ReturnType<typeof createMemoryArea>) => {
    const keys: string[][] = [];
    const set = local.set.bind(local);
    local.set = async (items) => {
      keys.push(Object.keys(items));
      await set(items);
    };
    return keys;
  };

  it("a batch writes only today's judged key and creates no channel record, and writes nothing when its Tiles were already counted", async () => {
    const local = createMemoryArea();
    await updateEscalation(local, () => ({ chan: { topicRemoved: { [today]: 1 }, name: 'Chan' } }));
    await recordEscalationJudged(local, dayKey(T0 - DAY), [{ key: 'chan', videoId: 'v0' }]);
    const writes = writtenKeys(local);
    await recordEscalationJudged(local, today, [{ key: 'chan', videoId: 'v1' }, { key: 'other', videoId: 'v2' }]);
    await recordEscalationJudged(local, today, [{ key: 'chan', videoId: 'v1' }, { key: 'other', videoId: 'v2' }]);
    expect(writes).toEqual([[escalationDayKey(today)]]);
    expect((await getEscalation(local, T0)).chan).toEqual({ judged: { [today]: ['v1'], [dayKey(T0 - DAY)]: ['v0'] }, topicRemoved: { [today]: 1 }, name: 'Chan' });
    expect(Object.keys(await getEscalationMeta(local))).toEqual(['chan']);
  });

  it('stops counting a day past its size limit, however many channels the Tiles name', async () => {
    const local = createMemoryArea();
    const hostile = Array.from({ length: 200 }, (_, i) => ({ key: `${'x'.repeat(990)}${i}`, videoId: `v${i}` }));
    for (let i = 0; i < hostile.length; i += 16) await recordEscalationJudged(local, today, hostile.slice(i, i + 16));
    const key = escalationDayKey(today);
    const bytes = itemBytes(key, (await local.get(key))[key]);
    expect(bytes).toBeLessThanOrEqual(ESCALATION_DAY_MAX_BYTES);
    expect(bytes).toBeGreaterThan(ESCALATION_DAY_MAX_BYTES - 2000);
  });

  it('keeps the channel records within their limit, dropping the oldest last removal but never a suggestion or a "Not now"', async () => {
    const local = createMemoryArea();
    const name = 'x'.repeat(990);
    const day = (i: number) => dayKey(T0 - (i % 30) * DAY);
    await updateEscalation(local, () => ({
      suggested: { topicRemoved: { [dayKey(T0 - 29 * DAY)]: 3 }, suggestedAt: T0 },
      dismissed: { topicRemoved: { [dayKey(T0 - 29 * DAY)]: 3 }, dismissedAt: T0, removalsAtDismiss: 3 },
    }));
    const many = Object.fromEntries(Array.from({ length: 700 }, (_, i) => [`c${i}`, { topicRemoved: { [day(i)]: 1 }, name }]));
    await updateEscalation(local, (all) => ({ ...all, ...many }));
    const meta = await getEscalationMeta(local);
    expect(itemBytes(ESCALATION_KEY, meta)).toBeLessThanOrEqual(ESCALATION_RECORDS_MAX_BYTES);
    expect(meta).toHaveProperty('suggested');
    expect(meta).toHaveProperty('dismissed');
    expect(meta).toHaveProperty('c0'); // removal today
    expect(meta).not.toHaveProperty('c29'); // removal 29 days ago
  });

  it('moves judged videos stored inside the channel records into day keys, keeping what the day keys already hold', async () => {
    const local = createMemoryArea();
    const legacy = {
      chan: { judged: { [today]: ['v1', 'v2'], [dayKey(T0 - DAY)]: ['v0'] }, topicRemoved: { [today]: 2 }, name: 'Chan', site: 'youtube' },
      onlyJudged: { judged: { [today]: ['v3'] }, topicRemoved: {}, name: 'Only' },
    };
    // A run cut short after writing today's key, and a video counted in the day key since.
    await local.set({ [ESCALATION_KEY]: legacy, [escalationDayKey(today)]: { chan: ['v1', 'v9'] } });
    await splitEscalationDays(local);
    await splitEscalationDays(local);
    expect(await getEscalationMeta(local)).toEqual({ chan: { topicRemoved: { [today]: 2 }, name: 'Chan', site: 'youtube' } });
    const esc = await getEscalation(local, T0);
    expect(esc.chan!.judged).toEqual({ [today]: ['v1', 'v9', 'v2'], [dayKey(T0 - DAY)]: ['v0'] });
    expect(esc.onlyJudged!.judged).toEqual({ [today]: ['v3'] });
  });
});

describe('videoBucket', () => {
  it("spreads Bilibili ids over the 64 buckets instead of crowding them into 'B', and keeps YouTube ids by first character", () => {
    expect(videoBucket('dQw4w9WgXcQ')).toBe('d');
    const buckets = new Set(Array.from({ length: 200 }, (_, i) => videoBucket(`BV1${String(i).padStart(9, '0')}`)));
    expect(buckets.size).toBeGreaterThan(40);
    expect([...buckets].every((b) => VIDEO_BUCKETS.includes(b))).toBe(true);
  });
});

describe('withDefaults', () => {
  it("gives settings stored before Bilibili existed its Surfaces' defaults and keeps the user's own switches", () => {
    const stored = { ...DEFAULT_SETTINGS, surfaces: { home: false, watchSidebar: true, shortsShelf: true, search: false, channel: false, endScreen: false } };
    expect(withDefaults(stored).surfaces).toEqual({ ...DEFAULT_SETTINGS.surfaces, home: false });
  });
});
