import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { fnv1a32 } from '~/core/ids';
import type { Rule, RuleOp } from '~/core/types';
import { itemBytes, type AreaLike, type Areas } from './areas';
import { getArchive } from './local';
import { readExceptions, readRules } from './read';
import {
  EXC_BUCKET_BYTES,
  RULE_BUCKET_BYTES,
  RULE_BUCKETS,
  fromCompactException,
  fromCompactRule,
  packRules,
  parseSync,
  toCompactException,
  toCompactRule,
  tombstone,
} from './sync';
import { makeException, makeRule, rng } from './testing/fixtures';
import { createMemoryArea, syncQuota, type QuotaArea } from './testing/quota-storage';
import { createWriter } from './writer';

const T0 = 1_760_000_000_000;
const BUDGET = 90 * 1024;

function fakeAreas(sync: QuotaArea): Areas {
  return { sync, local: fakeBrowser.storage.local as unknown as AreaLike, session: fakeBrowser.storage.session as unknown as AreaLike };
}

const addOp = (r: Rule): RuleOp => ({
  op: 'add',
  rule: { polarity: r.polarity, kind: r.kind, text: r.text, enabled: r.enabled, origin: r.origin, ...(r.params && { params: r.params }), ...(r.name && { name: r.name }) },
});

const exportFile = (rules: Rule[], exceptions: unknown[]) => ({ format: 'shoo-rules', version: 1, exportedAt: '2026-10-09T21:00:00Z', rules, exceptions });

beforeEach(() => fakeBrowser.reset());
afterEach(() => vi.useRealTimers());

describe('compact mapping', () => {
  it('round-trips a Rule with the Section 8 keys, and a tombstone as its minimal form', () => {
    const rule = makeRule(rng(3), 7);
    const compact = toCompactRule(rule);
    expect(Object.keys(compact).every((k) => ['i', 'r', 'p', 'k', 't', 'pa', 'c', 'e', 'o', 'ca', 'ua', 'da'].includes(k))).toBe(true);
    expect(fromCompactRule(JSON.parse(JSON.stringify(compact)))?.rule).toEqual(rule);
    const deleted = toCompactRule({ ...rule, deletedAt: T0, updatedAt: T0 });
    expect(fromCompactRule(JSON.parse(JSON.stringify(deleted)))?.rule).toEqual(tombstone(rule, T0));
  });

  it('keeps unknown kinds and unknown fields from a newer Shoo', () => {
    const raw = { ...toCompactRule(makeRule(rng(4), 1)), k: 'futureKind', zz: { a: 1 } };
    const parsed = fromCompactRule(raw)!;
    expect(parsed.rule.kind).toBe('futureKind');
    expect(toCompactRule(parsed.rule, parsed.extras)).toEqual(raw);
  });

  it('stores the Rule name as `n`, drops it from tombstones, and keeps it beside unknown fields', () => {
    const rule = { ...makeRule(rng(5), 2), name: 'Gossip' };
    const compact = toCompactRule(rule);
    expect(compact).toMatchObject({ n: 'Gossip', t: rule.text });
    expect(fromCompactRule(JSON.parse(JSON.stringify(compact)))).toEqual({ rule });
    expect(toCompactRule({ ...rule, deletedAt: T0, updatedAt: T0 })).not.toHaveProperty('n');
    expect(tombstone(rule, T0)).not.toHaveProperty('name');
    // A newer Shoo's field rides along with the name, and a nameless Rule writes no `n`.
    const future = { ...compact, zz: 1 };
    const parsed = fromCompactRule(future)!;
    expect(parsed.extras).toEqual({ zz: 1 });
    expect(toCompactRule(parsed.rule, parsed.extras)).toEqual(future);
    expect(toCompactRule(makeRule(rng(5), 2))).not.toHaveProperty('n');
  });

  it('an older Shoo keeps the name it does not know through a rewrite (as an unknown field)', () => {
    // What an older Shoo's reader sees: `n` is not among its keys, so it is an extra it writes back.
    const named = toCompactRule({ ...makeRule(rng(6), 3), name: 'Crypto' });
    const { n, ...known } = named;
    const edited = toCompactRule({ ...fromCompactRule(known)!.rule, text: 'edited on an older Shoo', updatedAt: T0 }, { n });
    expect(fromCompactRule(edited)!.rule).toMatchObject({ name: 'Crypto', text: 'edited on an older Shoo' });
  });

  it('round-trips an Exception, truncating the title to 80 characters and deriving the ChannelKey', () => {
    const x = { videoId: 'dQw4w9WgXcQ', title: 'x'.repeat(120), channelName: 'Some  Channel', channelKey: 'some channel', ruleId: 'r1', at: T0 };
    const compact = toCompactException(x);
    expect(compact).toEqual({ v: 'dQw4w9WgXcQ', t: 'x'.repeat(80), cn: 'Some  Channel', ri: 'r1', a: T0 });
    expect(fromCompactException(compact)).toEqual({ ...x, title: 'x'.repeat(80) });
  });
});

describe('sync budget (quota-enforcing fake around fakeBrowser storage.sync)', () => {
  // The second run gives every Rule a Rule name of the full 40 characters (REQ-RULE-11), the worst case.
  it.each([
    ['', 0],
    [', every Rule named with 40 characters,', 40],
  ])('150 Rules%s plus 150 synced Exceptions round-trip with getBytesInUse ≤ 90 KB', async (_, nameLength) => {
    const sync = syncQuota(fakeBrowser.storage.sync as unknown as AreaLike);
    let t = T0;
    const writer = createWriter({ areas: fakeAreas(sync), now: () => ++t });
    await writer.init();
    const rand = rng(1);
    const source = Array.from({ length: 150 }, (_, i) => makeRule(rand, i + 1, 200));
    const res = await writer.mutateRules(source.map((r, i) => addOp(nameLength ? { ...r, name: `${i} `.padEnd(nameLength, 'n') } : r)));
    if (!('rules' in res)) throw new Error(JSON.stringify(res));
    expect(res.rules).toHaveLength(150);
    if (nameLength) expect(res.rules.every((r) => r.name?.length === nameLength)).toBe(true);
    const ruleIds = res.rules.map((r) => r.id);
    const added = [];
    for (let i = 0; i < 150; i++) added.push(await writer.addException(makeException(rand, 0, ruleIds)));
    await writer.flush();

    const bytes = await sync.getBytesInUse(null);
    const ruleBytes = await sync.getBytesInUse(Array.from({ length: RULE_BUCKETS }, (_, i) => `rules:b${i}`));
    console.info(`150 Rules${nameLength ? ` named with ${nameLength} characters` : ''} + 150 Exceptions: ${bytes} B in storage.sync, Rule buckets ${ruleBytes} B`);
    expect(bytes).toBeLessThanOrEqual(BUDGET);

    const areas = { sync, local: fakeBrowser.storage.local as unknown as AreaLike };
    expect(await readRules(areas)).toEqual(res.rules);
    const exceptions = await readExceptions(areas);
    expect(exceptions).toHaveLength(150);
    expect(exceptions.map((x) => x.videoId).sort()).toEqual(added.map((x) => x.videoId).sort());
    expect(await getArchive(areas.local)).toHaveLength(0);

    // A fresh background (worker restart) loads the same state.
    const again = createWriter({ areas: fakeAreas(sync), now: () => ++t });
    expect(await again.getRules()).toEqual(res.rules);
    expect((await again.getExceptions()).map((x) => x.videoId).sort()).toEqual(added.map((x) => x.videoId).sort());
  });

  it('moves the 151st and older Exceptions to local:exceptions:archive (2,000 archived)', async () => {
    const sync = syncQuota(fakeBrowser.storage.sync as unknown as AreaLike);
    let t = T0 + 10_000_000;
    const writer = createWriter({ areas: fakeAreas(sync), now: () => ++t });
    const rand = rng(2);
    const rules = Array.from({ length: 150 }, (_, i) => makeRule(rand, i + 1, 200));
    const exceptions = Array.from({ length: 2150 }, (_, i) => makeException(rand, T0 + i, rules.map((r) => r.id)));
    const res = await writer.importData(exportFile(rules, exceptions), 'merge', false);
    expect(res).toEqual({ preview: { add: 150, update: 0, renumber: 0, invalid: [] } });
    await writer.flush();

    const local = fakeBrowser.storage.local as unknown as AreaLike;
    const synced = [...parseSync(await sync.get(null)).exceptions.values()];
    const archive = await getArchive(local);
    expect(synced).toHaveLength(150);
    expect(archive).toHaveLength(2000);
    const newest150 = [...exceptions].sort((a, b) => b.at - a.at).slice(0, 150).map((x) => x.videoId).sort();
    expect(synced.map((x) => x.videoId).sort()).toEqual(newest150);
    expect(await sync.getBytesInUse(null)).toBeLessThanOrEqual(BUDGET);
    expect(Object.keys(await local.get(null)).filter((k) => k.startsWith('exceptions:archive:')).length).toBeLessThanOrEqual(64);

    // One more Keep: it is synced, the oldest synced one moves to the archive.
    const oldestSynced = [...synced].sort((a, b) => a.at - b.at)[0]!;
    t = T0 + 1e9;
    const x = await writer.addException({ videoId: 'NEWvideo_01', title: 'A brand new kept video' });
    await writer.flush();
    const syncedAfter = parseSync(await sync.get(null)).exceptions;
    expect(syncedAfter.has(x.videoId)).toBe(true);
    expect(syncedAfter.has(oldestSynced.videoId)).toBe(false);
    const archiveAfter = await getArchive(local);
    expect(archiveAfter).toHaveLength(2001);
    expect(archiveAfter.some((a) => a.videoId === oldestSynced.videoId)).toBe(true);
    expect(await writer.getExceptions()).toHaveLength(2151);
  });

  it('spills Rules whose home bucket is full into the next bucket, and readers merge every bucket', async () => {
    const rand = rng(5);
    const rules: Rule[] = [];
    for (let n = 1; rules.length < 40; n++) {
      const r = makeRule(rand, rules.length + 1, 200);
      r.text = r.text.padEnd(200, 'x');
      if (fnv1a32(r.id) % RULE_BUCKETS === 3) rules.push(r);
      if (n > 100_000) throw new Error('no ids');
    }
    const buckets = packRules(rules)!;
    expect(Object.keys(buckets).length).toBeGreaterThan(1);
    expect(Object.keys(buckets['rules:b3']!).length).toBeGreaterThan(0);
    expect(Object.keys(buckets['rules:b4']!).length).toBeGreaterThan(0);
    for (const [k, v] of Object.entries(buckets)) expect(itemBytes(k, v)).toBeLessThanOrEqual(RULE_BUCKET_BYTES);

    const sync = syncQuota(fakeBrowser.storage.sync as unknown as AreaLike);
    const writer = createWriter({ areas: fakeAreas(sync), now: () => T0 + 1e6 });
    await writer.importData(exportFile(rules, []), 'merge', false);
    await writer.flush();
    const stored = await sync.get(null);
    expect(Object.keys(stored).filter((k) => k.startsWith('rules:b')).sort()).toEqual(Object.keys(buckets).sort());
    expect((await readRules({ sync, local: fakeBrowser.storage.local as unknown as AreaLike })).map((r) => r.id).sort()).toEqual(rules.map((r) => r.id).sort());
  });

  it('returns syncQuota and changes nothing when every bucket is full', async () => {
    const sync = syncQuota(fakeBrowser.storage.sync as unknown as AreaLike);
    let t = T0;
    const writer = createWriter({ areas: fakeAreas(sync), now: () => ++t });
    const long = (i: number): RuleOp => ({ op: 'add', rule: { polarity: 'remove', kind: 'topic', text: `${i} `.padEnd(500, 'long rule text '), enabled: true, origin: 'user' } });
    let count = 0;
    let last: Awaited<ReturnType<typeof writer.mutateRules>> | undefined;
    for (let i = 0; i < 200; i++) {
      last = await writer.mutateRules([long(i)]);
      if ('error' in last) break;
      count++;
    }
    expect(last).toEqual({ error: 'syncQuota', detail: 'rules' });
    expect(count).toBeGreaterThan(50);
    expect(await writer.getRules()).toHaveLength(count);
    await writer.flush(); // the fake throws if any item or the total were over quota
    expect(await sync.getBytesInUse(null)).toBeLessThanOrEqual(BUDGET);
  });

  it('keeps worst-case Exceptions (80-character titles, channel, ruleId) within 25 KB of exception buckets', async () => {
    const sync = syncQuota(createMemoryArea());
    let t = T0;
    const writer = createWriter({ areas: { sync, local: createMemoryArea(), session: createMemoryArea() }, now: () => ++t });
    for (let i = 0; i < 160; i++) await writer.addException({ videoId: `v${String(i).padStart(10, '0')}`, title: 'T'.repeat(80), channelName: 'C'.repeat(25), ruleId: '9b2d2c4e-1f6a-4c1e-9a43-3b7f3c2d1e0f' });
    await writer.flush();
    const keys = Object.keys(await sync.get(null)).filter((k) => k.startsWith('exc:'));
    let total = 0;
    for (const k of keys) {
      const b = await sync.getBytesInUse(k);
      expect(b).toBeLessThanOrEqual(EXC_BUCKET_BYTES);
      total += b;
    }
    expect(total).toBeLessThanOrEqual(25 * 1024);
  });
});

describe('sync writes', () => {
  it('debounces 1 s and writes only the buckets whose JSON changed', async () => {
    vi.useFakeTimers();
    const sync = syncQuota(createMemoryArea());
    let t = T0;
    const writer = createWriter({ areas: { sync, local: createMemoryArea(), session: createMemoryArea() }, now: () => ++t });
    await writer.init();
    const writesAfterInit = sync.writes;
    const rand = rng(9);
    const rules = Array.from({ length: 20 }, (_, i) => makeRule(rand, i + 1));
    const res = await writer.mutateRules(rules.slice(0, 10).map(addOp));
    await vi.advanceTimersByTimeAsync(500);
    await writer.mutateRules(rules.slice(10).map(addOp));
    await vi.advanceTimersByTimeAsync(999);
    expect(sync.writes).toBe(writesAfterInit);
    await vi.advanceTimersByTimeAsync(1);
    await writer.whenIdle();
    expect(sync.writes).toBe(writesAfterInit + 1);

    // Editing one Rule rewrites only its bucket (meta unchanged).
    if (!('rules' in res)) throw new Error('mutate failed');
    const target = res.rules[0]!;
    await writer.mutateRules([{ op: 'update', id: target.id, patch: { text: 'edited text' } }]);
    await vi.advanceTimersByTimeAsync(1000);
    await writer.whenIdle();
    expect(sync.log.at(-1)).toHaveLength(1);
    const key = sync.log.at(-1)![0]!;
    expect(Object.keys(((await sync.get(key))[key] as object) ?? {})).toContain(target.id);
  });

  it('backs off on rate-limit errors and writes later', async () => {
    vi.useFakeTimers();
    const inner = createMemoryArea();
    let failures = 2;
    const flaky: AreaLike = {
      ...inner,
      async set(items) {
        if (Object.keys(items).some((k) => k.startsWith('rules:')) && failures-- > 0) throw new Error('This request exceeds the MAX_WRITE_OPERATIONS_PER_MINUTE quota.');
        return inner.set(items);
      },
    };
    const errors: unknown[] = [];
    const writer = createWriter({ areas: { sync: flaky, local: createMemoryArea(), session: createMemoryArea() }, now: () => T0, onError: (e) => errors.push(e) });
    await writer.mutateRules([{ op: 'add', rule: { polarity: 'remove', kind: 'topic', text: 'crypto', enabled: true, origin: 'user' } }]);
    await vi.advanceTimersByTimeAsync(1000); // first try: rate limited
    await vi.advanceTimersByTimeAsync(5000); // second try after 5 s: rate limited
    expect(Object.keys(await inner.get(null)).some((k) => k.startsWith('rules:'))).toBe(false);
    await vi.advanceTimersByTimeAsync(15_000); // third try after 15 s: written
    await writer.whenIdle();
    expect(Object.keys(await inner.get(null)).some((k) => k.startsWith('rules:'))).toBe(true);
    expect(errors).toEqual([]);
  });
});
