// Regression tests for store defects: lost writes, Exceptions across devices, import, Reset, storage quotas
// and device clocks out of step.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { RuleOp } from '~/core/types';
import type { AreaLike, Areas } from './areas';
import { getArchive, getRuntime, queryActivity } from './local';
import { parseImportedException, parseImportedRule } from './import';
import { parseSync, readSync, SyncStore, toCompactRule } from './sync';
import { makeDevice, makeRule, rng, type Device } from './testing/fixtures';
import { createMemoryArea, syncQuota, withQuota } from './testing/quota-storage';
import { createWriter } from './writer';

const T0 = 1_760_000_000_000;
const topic = (text: string): RuleOp => ({ op: 'add', rule: { polarity: 'remove', kind: 'topic', text, enabled: true, origin: 'user' } });

async function settle(devices: Device[]): Promise<void> {
  for (let i = 0; i < 30; i++) {
    await vi.runAllTimersAsync();
    for (const d of devices) await d.writer.whenIdle();
  }
}

beforeEach(() => {
  fakeBrowser.reset();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('lost writes', () => {
  it('a Rule in a bucket another device overwrote (last write wins) comes back after a background restart', async () => {
    const inner = createMemoryArea();
    const shared = syncQuota(inner);
    const b = makeDevice(shared, T0);
    const res = await b.writer.mutateRules([topic('added on B')]);
    if (!('rules' in res)) throw new Error('add failed');
    await settle([b]);
    const staleBuckets = Object.fromEntries(Object.keys(await inner.get(null)).filter((k) => k.startsWith('rules:')).map((k) => [k, {}]));

    // B's background stops. A new one starts (listener registered at creation), then A's stale bucket lands.
    b.writer.dispose();
    const restarted = createWriter({ areas: b.areas, now: () => T0 + 10 });
    await inner.set(staleBuckets);
    await vi.runAllTimersAsync();
    await restarted.whenIdle();
    await vi.runAllTimersAsync();
    await restarted.whenIdle();
    expect((await restarted.getRules()).map((r) => r.text)).toEqual(['added on B']);
    expect([...parseSync(await inner.get(null)).rules.values()].map((r) => r.text)).toEqual(['added on B']);
  });

  it('an edit waiting for the debounce survives the background stopping (outbox)', async () => {
    const areas: Areas = { sync: syncQuota(createMemoryArea()), local: createMemoryArea(), session: createMemoryArea() };
    const writer = createWriter({ areas, now: () => T0 });
    await writer.mutateRules([topic('not yet flushed')]);
    writer.dispose(); // the timer dies with the worker
    const restarted = createWriter({ areas, now: () => T0 + 5 });
    expect((await restarted.getRules()).map((r) => r.text)).toEqual(['not yet flushed']);
    await vi.runAllTimersAsync();
    await restarted.whenIdle();
    expect([...parseSync(await areas.sync.get(null)).rules.values()]).toHaveLength(1);
    await restarted.whenIdle();
    expect(await areas.local.get('syncOutbox')).toEqual({});
  });

  it('a failed init is retried by the next call instead of poisoning the writer', async () => {
    const inner = createMemoryArea();
    let fail = true;
    const flaky: AreaLike = { ...inner, get: (k) => (fail ? ((fail = false), Promise.reject(new Error('transient'))) : inner.get(k)) };
    const writer = createWriter({ areas: { sync: flaky, local: createMemoryArea(), session: createMemoryArea() }, now: () => T0 });
    await expect(writer.mutateRules([topic('a')])).rejects.toThrow('transient');
    expect('rules' in (await writer.mutateRules([topic('b')]))).toBe(true);
  });
});

describe('Exception removals across devices', () => {
  it('a replace import on one device does not leave the old Exceptions on another', async () => {
    const shared = syncQuota(createMemoryArea());
    const a = makeDevice(shared, T0);
    const b = makeDevice(shared, T0);
    for (let i = 0; i < 5; i++) await a.writer.addException({ videoId: `old${String(i).padStart(8, '0')}`, title: 'old' });
    await settle([a, b]);
    expect(await b.writer.getExceptions()).toHaveLength(5);
    a.clock.t = T0 + 1000;
    const fresh = Array.from({ length: 200 }, (_, i) => ({ videoId: `new${String(i).padStart(8, '0')}`, title: 'new', at: T0 + 100 + i }));
    await a.writer.importData({ format: 'shoo-rules', version: 1, exportedAt: 'x', rules: [], exceptions: fresh }, 'replace', false);
    await settle([a, b]);
    const onB = (await b.writer.getExceptions()).map((x) => x.videoId);
    expect(onB.some((v) => v.startsWith('old'))).toBe(false);
    expect(onB).toHaveLength(150); // the 50 oldest went to A's own archive, which never syncs
  });

  it('removing an Exception another device archived removes it from that archive too', async () => {
    const shared = syncQuota(createMemoryArea());
    const a = makeDevice(shared, T0);
    const b = makeDevice(shared, T0);
    let t = T0;
    a.clock.t = ++t;
    await a.writer.addException({ videoId: 'target00001', title: 'v' });
    await settle([a, b]);
    for (let i = 0; i < 150; i++) {
      a.clock.t = ++t;
      await a.writer.addException({ videoId: `fill${String(i).padStart(7, '0')}`, title: 'f' });
    }
    await settle([a, b]);
    expect((await getArchive(b.areas.local)).map((x) => x.videoId)).toContain('target00001');
    a.clock.t = ++t;
    await a.writer.addException({ videoId: 'target00001', title: 'v again' });
    a.clock.t = ++t;
    await a.writer.removeException('target00001');
    await settle([a, b]);
    expect((await b.writer.getExceptions()).some((x) => x.videoId === 'target00001')).toBe(false);
    expect((await a.writer.getExceptions()).some((x) => x.videoId === 'target00001')).toBe(false);
  });
});

describe('import and privacy', () => {
  it('a merge import of an old backup does not revive a Rule deleted since', async () => {
    let t = T0;
    const writer = createWriter({ areas: { sync: syncQuota(createMemoryArea()), local: createMemoryArea(), session: createMemoryArea() }, now: () => ++t });
    const res = await writer.mutateRules([topic('drama')]);
    if (!('rules' in res)) throw new Error('add failed');
    const backup = await writer.exportData();
    await writer.mutateRules([{ op: 'delete', id: res.rules[0]!.id }]);
    expect(await writer.importData(backup, 'merge', false)).toEqual({ preview: { add: 0, update: 0, renumber: 0, invalid: [] } });
    expect(await writer.getRules()).toEqual([]);
  });

  it('rejects non-canonical or huge refs and timestamps far in the future', () => {
    const r = makeRule(rng(1), 1);
    const R = r.polarity === 'remove' ? 'R' : 'K';
    expect(parseImportedRule({ ...r, ref: `${R}01` }, T0)).toBe('ref');
    expect(parseImportedRule({ ...r, ref: `${R}99999999999999999999` }, T0)).toBe('ref');
    expect(parseImportedRule({ ...r, updatedAt: T0 + 2 * 86_400_000 }, T0)).toBe('timestamps');
    expect(parseImportedException({ videoId: 'abcdefghijk', title: 't', at: T0 + 2 * 86_400_000 }, T0)).toBe('at');
  });

  it('imports a views Rule with its bounds, and skips one without any', () => {
    const r = { ...makeRule(rng(2), 1), kind: 'views', text: 'Fewer than 1k views', params: { maxViews: 1000 } };
    expect(parseImportedRule(r, T0)).toMatchObject({ kind: 'views', params: { maxViews: 1000 } });
    expect(parseImportedRule({ ...r, params: {} }, T0)).toBe('viewsBounds');
  });

  it('updateRuntime writes nothing for a private-window sender', async () => {
    const local = createMemoryArea();
    const writer = createWriter({ areas: { sync: createMemoryArea(), local, session: createMemoryArea() }, now: () => T0 });
    await writer.init();
    const before = JSON.stringify(await local.get(null));
    await writer.updateRuntime((s) => ({ ...s, failures: { ...s.failures, markup: 3 } }), { incognitoTabId: 1 });
    expect(JSON.stringify(await local.get(null))).toBe(before);
    expect((await getRuntime(local)).failures.markup).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------
// Reset, quotas and import across the store modules

const rateLimited = () => new Error('This request exceeds the MAX_WRITE_OPERATIONS_PER_MINUTE quota.');
/** Timers that never fire: the background stops before the debounce or back-off ends. */
const frozenTimers = { set: () => 1, clear: () => {} };
const liveIn = (raw: Record<string, unknown>) => [...parseSync(raw).rules.values()].filter((r) => r.deletedAt === undefined);
const vid = (prefix: string, i: number) => `${prefix}${String(i).padStart(11 - prefix.length, '0')}`;

/** Adds Rules until every bucket is full (the next add returns syncQuota). */
async function fillRules(d: Device): Promise<number> {
  let n = 0;
  for (const [text, batch] of [['x'.repeat(150), 10], ['y'.repeat(150), 1], ['z', 1]] as const) {
    for (;;) {
      d.clock.t++;
      const res = await d.writer.mutateRules(Array.from({ length: batch }, () => topic(text)));
      if ('error' in res) break;
      n += batch;
    }
  }
  return n;
}

describe('Reset and replace import remove every Exception on every device', () => {
  it('Reset with 200 Exceptions leaves none on either device, and a stale write cannot bring them back', async () => {
    const inner = createMemoryArea();
    const shared = syncQuota(inner);
    const a = makeDevice(shared, T0);
    const b = makeDevice(shared, T0);
    await a.writer.init();
    await b.writer.init();
    for (let i = 0; i < 150; i++) {
      a.clock.t++;
      await a.writer.addException({ videoId: vid('old', i), title: `old ${i}` });
    }
    await settle([a, b]);
    for (let i = 150; i < 200; i++) {
      a.clock.t++;
      await a.writer.addException({ videoId: vid('old', i), title: `old ${i}` });
    }
    await settle([a, b]);
    expect(await a.writer.getExceptions()).toHaveLength(200);
    expect(await b.writer.getExceptions()).toHaveLength(200); // 150 synced, 50 in B's own archive
    const stale = Object.fromEntries(Object.entries(await inner.get(null)).filter(([k]) => k.startsWith('exc:') || k === 'meta'));

    a.clock.t += 1000;
    await a.writer.resetAll();
    await settle([a, b]);
    for (const d of [a, b]) {
      expect(await d.writer.getExceptions()).toEqual([]);
      expect(await getArchive(d.areas.local)).toEqual([]);
      expect((await d.areas.local.get('syncOutbox')).syncOutbox).toBeUndefined();
    }
    expect(parseSync(await inner.get(null)).exceptions.size).toBe(0);

    // A device that never saw the Reset writes its old Exception buckets and meta back.
    await inner.set(stale);
    await settle([a, b]);
    for (const d of [a, b]) {
      expect(await d.writer.getExceptions()).toEqual([]);
      expect(await getArchive(d.areas.local)).toEqual([]);
    }
    expect(Object.keys(await inner.get(null)).filter((k) => k.startsWith('exc:'))).toEqual([]);

    // Exceptions kept after the Reset still sync both ways.
    b.clock.t = a.clock.t + 10;
    await b.writer.addException({ videoId: vid('new', 1), title: 'kept after reset' });
    await settle([a, b]);
    expect((await a.writer.getExceptions()).map((x) => x.videoId)).toEqual([vid('new', 1)]);
  });

  it('a replace import drops every old Exception on the other device, archive included', async () => {
    const shared = syncQuota(createMemoryArea());
    const a = makeDevice(shared, T0);
    const b = makeDevice(shared, T0);
    await a.writer.init();
    await b.writer.init();
    for (let i = 0; i < 150; i++) {
      a.clock.t++;
      await a.writer.addException({ videoId: vid('old', i), title: 'old' });
    }
    await settle([a, b]);
    for (let i = 150; i < 200; i++) {
      a.clock.t++;
      await a.writer.addException({ videoId: vid('old', i), title: 'old' });
    }
    await settle([a, b]);
    expect(await getArchive(b.areas.local)).toHaveLength(50);
    a.clock.t += 1000;
    const fresh = Array.from({ length: 10 }, (_, i) => ({ videoId: vid('new', i), title: 'new', at: T0 + i }));
    await a.writer.importData({ format: 'shoo-rules', version: 1, exportedAt: 'x', rules: [], exceptions: fresh }, 'replace', false);
    await settle([a, b]);
    for (const d of [a, b]) {
      const xs = await d.writer.getExceptions();
      expect(xs.map((x) => x.videoId).sort()).toEqual(fresh.map((x) => x.videoId));
      expect(xs.find((x) => x.videoId === vid('new', 3))?.at).toBe(T0 + 3); // kept dates survive
    }
  });
});

describe('Reset with full Rule buckets', () => {
  it('removes every Rule on both devices and after a restart, and refs are not reused', async () => {
    const shared = syncQuota(createMemoryArea());
    const a = makeDevice(shared, T0);
    const b = makeDevice(shared, T0);
    await b.writer.init();
    const n = await fillRules(a);
    await settle([a, b]);
    expect(await b.writer.getRules()).toHaveLength(n);
    a.clock.t += 10;
    await a.writer.resetAll();
    await settle([a, b]);
    expect(await a.writer.getRules()).toEqual([]);
    expect(await b.writer.getRules()).toEqual([]);
    expect(liveIn(await shared.get(null))).toEqual([]);
    const restarted = createWriter({ areas: b.areas, now: () => a.clock.t });
    expect(await restarted.getRules()).toEqual([]);
    a.clock.t++;
    const next = await a.writer.mutateRules([topic('fresh')]);
    if (!('rules' in next)) throw new Error('add failed');
    expect(next.rules.map((r) => r.ref)).toEqual([`R${n + 1}`]);
    await settle([a, b]);
    expect((await b.writer.getRules()).map((r) => r.text)).toEqual(['fresh']);
  });
});

describe('Reset during a sync rate limit', () => {
  it('keeps the unsent Reset in the outbox, so Rules do not come back after a restart', async () => {
    const clock = { t: T0 };
    const inner = createMemoryArea();
    let limited = false;
    const base = syncQuota(inner);
    const sync: AreaLike = {
      ...base,
      set: (items) => (limited ? Promise.reject(rateLimited()) : base.set(items)),
      remove: (keys) => (limited ? Promise.reject(rateLimited()) : base.remove(keys)),
    };
    const areas: Areas = { sync, local: createMemoryArea(), session: createMemoryArea() };
    const w = createWriter({ areas, now: () => clock.t, timers: frozenTimers });
    for (const text of ['a', 'b', 'c']) {
      clock.t++;
      await w.mutateRules([topic(text)]);
    }
    await w.addException({ videoId: vid('keep', 1), title: 'k' });
    await w.flush();
    expect(liveIn(await inner.get(null))).toHaveLength(3);

    limited = true;
    clock.t += 100;
    expect(await w.resetAll()).toEqual({ syncPending: true });
    expect((await areas.local.get('syncOutbox')).syncOutbox).toBeDefined();
    expect(await w.getRules()).toEqual([]);
    w.dispose();

    limited = false;
    const restarted = createWriter({ areas, now: () => clock.t, timers: frozenTimers });
    expect(await restarted.getRules()).toEqual([]);
    expect(await restarted.getExceptions()).toEqual([]);
    expect(await restarted.flush()).toBe(true);
    expect(liveIn(await inner.get(null))).toEqual([]);
    expect(parseSync(await inner.get(null)).exceptions.size).toBe(0);
  });
});

describe('deletes over the sync budget', () => {
  it.each([
    ['dated after the deletes (a clock ahead)', T0 + 50_000],
    ['dated before the deletes', T0 - 100_000],
  ])('a merged Rule set over the budget can be shrunk by deleting, and syncs once it fits, other Rules %s', async (_label, extraAt) => {
    const inner = createMemoryArea();
    const shared = syncQuota(inner);
    const a = makeDevice(shared, T0);
    await a.writer.init();
    for (let i = 0; i < 120; i += 20) {
      a.clock.t++;
      const res = await a.writer.mutateRules(Array.from({ length: 20 }, (_, j) => topic(`rule ${i + j} ${'x'.repeat(200)}`)));
      if ('error' in res) throw new Error('fill failed');
    }
    await settle([a]);
    // Another device's Rules land in a key this device does not write (a last-write-wins merge leftover).
    const rand = rng(11);
    const extra: Record<string, unknown> = {};
    for (let i = 0; i < 80; i++) {
      const r = makeRule(rand, 500 + i, 100, extraAt);
      extra[r.id] = toCompactRule(r);
    }
    await inner.set({ 'rules:b9': extra });
    // B holds the same over-budget set in memory.
    const b = makeDevice(shared, a.clock.t);
    await b.writer.init();
    await settle([a, b]);
    const live = await a.writer.getRules();
    expect(live).toHaveLength(200);
    const theirs = live.filter((r) => r.id in extra);

    a.clock.t += 10;
    expect(await a.writer.mutateRules([topic('one more')])).toEqual({ error: 'syncQuota', detail: 'rules' });
    const one = await a.writer.mutateRules([{ op: 'delete', id: theirs[0]!.id }]);
    expect('rules' in one && one.rules).toHaveLength(199);
    a.clock.t += 10;
    const rest = await a.writer.mutateRules(theirs.slice(1).map((r) => ({ op: 'delete' as const, id: r.id })));
    expect('rules' in rest && rest.rules).toHaveLength(120);
    // Tombstones still take room: the set syncs once enough is deleted, without any delete being refused.
    a.clock.t += 10;
    const mine = live.filter((r) => !(r.id in extra));
    const more = await a.writer.mutateRules(mine.slice(0, 30).map((r) => ({ op: 'delete' as const, id: r.id })));
    expect('rules' in more && more.rules).toHaveLength(90);
    b.clock.t = a.clock.t;
    await settle([a, b]);
    const stored = await inner.get(null);
    const expected = mine.slice(30).map((r) => r.id).sort();
    expect(liveIn(stored).map((r) => r.id).sort()).toEqual(expected);
    expect((await a.writer.getRules()).map((r) => r.id).sort()).toEqual(expected);
    expect((await b.writer.getRules()).map((r) => r.id).sort()).toEqual(expected);
    expect(stored['rules:b9']).toBeUndefined();
  });

  it('stores tombstones without text, params or colour, so a delete never grows the set', () => {
    const r = { ...makeRule(rng(3), 7, 200), params: { channelName: 'Some channel' }, colour: 'c7' as const };
    const compact = toCompactRule({ ...r, deletedAt: T0, updatedAt: T0 });
    expect(compact).toEqual({ i: r.id, r: r.ref, p: r.polarity, k: r.kind, t: '', ca: r.createdAt, ua: T0, da: T0 });
    expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(toCompactRule({ ...r, text: 'a' })).length);
  });
});

describe('outbox writes near the storage.local quota', () => {
  it('a failed outbox save changes nothing, and the change never reaches sync later', async () => {
    const limits: { quotaBytes?: number } = {};
    const local = withQuota(createMemoryArea(), limits);
    const sync = syncQuota(createMemoryArea());
    const writer = createWriter({ areas: { sync, local, session: createMemoryArea() }, now: () => T0 });
    await writer.init();
    limits.quotaBytes = (await local.getBytesInUse(null)) + 50;
    await expect(writer.mutateRules([topic('x'.repeat(300))])).rejects.toThrow(/QUOTA_BYTES/);
    expect(await writer.getRules()).toEqual([]);
    await expect(writer.addException({ videoId: vid('keep', 1), title: 't'.repeat(80) })).rejects.toThrow(/QUOTA_BYTES/);
    expect(await writer.getExceptions()).toEqual([]);
    limits.quotaBytes = undefined;
    await writer.updateSettings({ mode: 'auto' });
    await writer.flush();
    expect(liveIn(await sync.get(null))).toEqual([]);
    expect(parseSync(await sync.get(null)).exceptions.size).toBe(0);
  });

  it('evicts Activity and retries the outbox save', async () => {
    const limits: { quotaBytes?: number } = {};
    const local = withQuota(createMemoryArea(), limits);
    const writer = createWriter({ areas: { sync: syncQuota(createMemoryArea()), local, session: createMemoryArea() }, now: () => T0 });
    await writer.init();
    const day = 24 * 3600 * 1000;
    for (const at of [T0 - 2 * day, T0 - day]) await writer.recordActivity(Array.from({ length: 20 }, (_, i) => ({ id: `e${at}${i}`, kind: 'kept' as const, at, title: 'w'.repeat(100) })));
    limits.quotaBytes = (await local.getBytesInUse(null)) + 50;
    const res = await writer.mutateRules([topic('x'.repeat(300))]);
    expect('rules' in res && res.rules.map((r) => r.text)).toEqual(['x'.repeat(300)]);
    expect((await queryActivity(local)).length).toBeLessThan(40);
  });
});

describe('import: dry runs, replace and merge across devices', () => {
  const importFile = (rules: unknown[], exceptions: unknown[] = []) => ({ format: 'shoo-rules', version: 1, exportedAt: 'x', rules, exceptions });

  it('the dry run runs the same quota check as the import and reports it', async () => {
    const writer = createWriter({ areas: { sync: syncQuota(createMemoryArea()), local: createMemoryArea(), session: createMemoryArea() }, now: () => T0 + 1e7 });
    const rand = rng(4);
    const big = importFile(Array.from({ length: 300 }, (_, i) => ({ ...makeRule(rand, i + 1, 200), polarity: 'remove', kind: 'topic', ref: `R${i + 1}`, colour: 'c1', params: undefined })));
    const dry = await writer.importData(big, 'merge', true);
    expect('preview' in dry && dry.preview.syncQuota).toBe(true);
    expect(await writer.importData(big, 'merge', false)).toEqual({ error: 'invalidInput', detail: 'syncQuota' });
    const small = await writer.importData(importFile([]), 'merge', true);
    expect('preview' in small && small.preview.syncQuota).toBeUndefined();
  });

  it('a replace dry run previews what Replace adds, updates and removes', async () => {
    let t = T0;
    const writer = createWriter({ areas: { sync: syncQuota(createMemoryArea()), local: createMemoryArea(), session: createMemoryArea() }, now: () => ++t });
    const res = await writer.mutateRules([topic('one'), topic('two')]);
    if (!('rules' in res)) throw new Error('add failed');
    await writer.addException({ videoId: vid('keep', 1), title: 'k1' });
    await writer.addException({ videoId: vid('keep', 2), title: 'k2' });
    const older = { ...res.rules[0]!, text: 'older copy', updatedAt: 1 };
    const incoming = { ...makeRule(rng(9), 3), polarity: 'remove', kind: 'topic', ref: 'R3', colour: 'c3', params: undefined };
    const f = importFile([older, incoming], [{ videoId: vid('keep', 2), title: 'k2', at: T0 }, { videoId: vid('keep', 3), title: 'k3', at: T0 }]);
    expect(await writer.importData(f, 'merge', true)).toEqual({ preview: { add: 1, update: 0, renumber: 0, invalid: [] } });
    expect(await writer.importData(f, 'replace', true)).toEqual({ preview: { add: 1, update: 1, renumber: 0, invalid: [], remove: { rules: 1, exceptions: 1 } } });
    expect(await writer.importData(f, 'replace', false)).toEqual({ preview: { add: 1, update: 1, renumber: 0, invalid: [], remove: { rules: 1, exceptions: 1 } } });
    expect((await writer.getRules()).map((r) => r.text)).toEqual(['older copy', incoming.text]);
    expect((await writer.getExceptions()).map((x) => x.videoId).sort()).toEqual([vid('keep', 2), vid('keep', 3)]);
  });

  it('Rules renumbered by a replace import survive the echo on both devices', async () => {
    const shared = syncQuota(createMemoryArea());
    const a = makeDevice(shared, T0);
    const b = makeDevice(shared, T0);
    await b.writer.init();
    a.clock.t++;
    await a.writer.mutateRules([topic('old')]);
    await settle([a, b]);
    a.clock.t += 100;
    const one = { ...makeRule(rng(5), 1), polarity: 'remove', kind: 'topic', ref: 'R1', colour: 'c1', params: undefined, createdAt: T0 };
    const two = { ...makeRule(rng(6), 1), polarity: 'remove', kind: 'topic', ref: 'R1', colour: 'c2', params: undefined, createdAt: T0 + 1 };
    expect(await a.writer.importData(importFile([one, two]), 'replace', false)).toMatchObject({ preview: { add: 2, renumber: 1 } });
    await settle([a, b]);
    for (const d of [a, b]) expect((await d.writer.getRules()).map((r) => r.id).sort()).toEqual([one.id, two.id].sort());
  });

  it('a removed Exception imported again from an older backup stays, on both devices', async () => {
    const shared = syncQuota(createMemoryArea());
    const a = makeDevice(shared, T0);
    const b = makeDevice(shared, T0);
    await a.writer.init();
    await b.writer.init();
    a.clock.t++;
    await a.writer.addException({ videoId: vid('keep', 1), title: 'k' });
    const backup = await a.writer.exportData();
    a.clock.t += 100;
    await a.writer.removeException(vid('keep', 1));
    await settle([a, b]);
    a.clock.t += 100;
    await a.writer.importData(JSON.parse(JSON.stringify(backup)), 'merge', false);
    await settle([a, b]);
    expect((await a.writer.getExceptions()).map((x) => x.videoId)).toEqual([vid('keep', 1)]);
    expect((await b.writer.getExceptions()).map((x) => x.videoId)).toEqual([vid('keep', 1)]);
  });

  it('a backup merged in after a Reset comes back whole, on both devices', async () => {
    const shared = syncQuota(createMemoryArea());
    const a = makeDevice(shared, T0);
    const b = makeDevice(shared, T0);
    await b.writer.init();
    a.clock.t++;
    await a.writer.mutateRules([topic('drama'), topic('crypto')]);
    for (let i = 0; i < 60; i++) {
      a.clock.t++;
      await a.writer.addException({ videoId: vid('keep', i), title: 'k' });
    }
    const backup = JSON.parse(JSON.stringify(await a.writer.exportData()));
    await settle([a, b]);
    a.clock.t += 100;
    await a.writer.resetAll();
    await settle([a, b]);
    a.clock.t += 100;
    await a.writer.importData(backup, 'merge', false);
    await settle([a, b]);
    for (const d of [a, b]) {
      expect((await d.writer.getRules()).map((r) => r.text)).toEqual(['drama', 'crypto']);
      expect(await d.writer.getExceptions()).toHaveLength(60);
    }
  });
});

describe('clocks ahead, stale epochs and outbox limits', () => {
  const HOUR = 3_600_000;

  it('a Rule last written by a device whose clock is 1 h ahead can still be deleted', async () => {
    const shared = syncQuota(createMemoryArea());
    const fast = makeDevice(shared, T0 + HOUR);
    const b = makeDevice(shared, T0);
    await b.writer.init();
    const res = await fast.writer.mutateRules([topic('from a fast clock')]);
    if (!('rules' in res)) throw new Error('add failed');
    await settle([fast, b]);
    b.clock.t += 60_000;
    expect(await b.writer.mutateRules([{ op: 'delete', id: res.rules[0]!.id }])).toEqual({ rules: [] });
    await settle([fast, b]);
    expect(await b.writer.getRules()).toEqual([]);
    expect(await fast.writer.getRules()).toEqual([]);
  });

  it('an Exception kept on a device whose clock is 1 h ahead can still be removed', async () => {
    const shared = syncQuota(createMemoryArea());
    const fast = makeDevice(shared, T0 + HOUR);
    const b = makeDevice(shared, T0);
    await b.writer.init();
    await fast.writer.addException({ videoId: vid('keep', 1), title: 't' });
    await settle([fast, b]);
    b.clock.t += 60_000;
    await b.writer.removeException(vid('keep', 1));
    await settle([fast, b]);
    expect(await b.writer.getExceptions()).toEqual([]);
    expect(await fast.writer.getExceptions()).toEqual([]);
  });

  it('a Reset on a device that missed an earlier Reset still removes the Exceptions kept since', async () => {
    const server = createMemoryArea();
    const a = makeDevice(syncQuota(server), T0);
    await a.writer.init();
    // B goes offline with its own copy of storage.sync.
    const offline = createMemoryArea();
    await offline.set(await server.get(null));
    const b = makeDevice(syncQuota(offline), T0);
    await b.writer.init();
    a.clock.t += 1000;
    await a.writer.resetAll();
    a.clock.t += 1000;
    await a.writer.addException({ videoId: vid('aaa', 1), title: 'kept after the first Reset' });
    await settle([a]);
    b.clock.t = a.clock.t + 60_000;
    await b.writer.resetAll();
    await settle([a, b]);
    b.writer.dispose();
    // B comes back online: its later writes win per key.
    await server.set(await offline.get(null));
    await settle([a]);
    expect(await a.writer.getExceptions()).toEqual([]);
  });

  it('an Exception from a newer epoch than a stale sync:meta keeps its epoch', async () => {
    const sync = createMemoryArea();
    await sync.set({ meta: { schema: 1, nextR: 1, nextK: 1, nextColour: 1, excEpoch: 1 }, 'exc:b0': { abcdefghijk: { v: 'abcdefghijk', t: 't', a: T0, ep: 2 } } });
    const store = new SyncStore({ sync, now: () => T0 + 10, timers: frozenTimers });
    await store.load();
    await store.flush();
    const entries = Object.values(await sync.get(null)).flatMap((b) => Object.values(b as object)) as { v?: string; ep?: number }[];
    expect(entries.find((e) => e.v === 'abcdefghijk')?.ep).toBe(2);
    expect(((await sync.get('meta')).meta as { excEpoch: number }).excEpoch).toBe(2);
  });

  it('a device that reset repairs a sync:meta that a stale device overwrote while it was stopped', async () => {
    const inner = createMemoryArea();
    const shared = syncQuota(inner);
    const a = makeDevice(shared, T0);
    a.clock.t++;
    await a.writer.mutateRules([topic('one'), topic('two')]);
    await a.writer.addException({ videoId: vid('keep', 1), title: 'k' });
    await settle([a]);
    const stale = await inner.get(null);
    a.clock.t += 1000;
    await a.writer.resetAll();
    await settle([a]);
    a.writer.dispose();
    await inner.set(stale);
    const restarted = createWriter({ areas: a.areas, now: () => a.clock.t + 10 });
    expect(await restarted.getRules()).toEqual([]);
    expect(await restarted.getExceptions()).toEqual([]);
    await restarted.flush();
    expect(liveIn(await inner.get(null))).toEqual([]);
    expect(Object.keys(await inner.get(null)).filter((k) => k.startsWith('exc:'))).toEqual([]);
    expect((await readSync(inner)).meta.rulesClearedAt).toBeGreaterThan(T0);
  });

  it('more than 40 removals before a confirmation do not stay in the outbox', async () => {
    const shared = syncQuota(createMemoryArea());
    const a = makeDevice(shared, T0);
    await a.writer.init();
    for (let i = 0; i < 45; i++) {
      a.clock.t++;
      await a.writer.addException({ videoId: vid('k', i), title: 't' });
    }
    await settle([a]);
    for (let i = 0; i < 45; i++) {
      a.clock.t++;
      await a.writer.removeException(vid('k', i));
    }
    await settle([a]);
    expect((await a.areas.local.get('syncOutbox')).syncOutbox).toBeUndefined();
  });

  it('outbox adds dropped by a newer epoch are dropped from storage.local too', async () => {
    const sync = createMemoryArea();
    const local = createMemoryArea();
    await sync.set({ meta: { schema: 1, nextR: 1, nextK: 1, nextColour: 1, excEpoch: 1 } });
    await local.set({ syncOutbox: { rules: {}, added: { abcdefghijk: { videoId: 'abcdefghijk', title: 't', at: T0 } }, removed: {} } });
    const store = new SyncStore({ sync, local, now: () => T0 + 10, timers: frozenTimers });
    await store.load();
    expect(store.pendingOutbox().added).toEqual({});
    expect((await local.get('syncOutbox')).syncOutbox).toBeUndefined();
  });
});
