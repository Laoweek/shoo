import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { Exception, Rule } from '~/core/types';
import type { AreaLike } from './areas';
import { queryActivity } from './local';
import { EXC_REMOVED_MAX, mergeExceptions, mergeRemovals, mergeRules, TOMBSTONE_TTL_MS } from './sync';
import { makeDevice, type Device } from './testing/fixtures';
import { createMemoryArea, syncQuota, type QuotaArea } from './testing/quota-storage';

const T0 = 1_760_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const topic = (text: string) => ({ op: 'add' as const, rule: { polarity: 'remove' as const, kind: 'topic' as const, text, enabled: true, origin: 'user' as const } });

/** Runs debounce timers and onChanged merges on every device until nothing is left to do. */
async function settle(devices: Device[]): Promise<void> {
  for (let i = 0; i < 30; i++) {
    await vi.runAllTimersAsync();
    for (const d of devices) await d.writer.whenIdle();
  }
}

const strip = (rules: Rule[]) => JSON.stringify(rules);

beforeEach(() => {
  fakeBrowser.reset();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('two devices sharing storage.sync', () => {
  let shared: QuotaArea;
  let a: Device;
  let b: Device;

  beforeEach(async () => {
    shared = syncQuota(fakeBrowser.storage.sync as unknown as AreaLike);
    a = makeDevice(shared, T0);
    b = makeDevice(shared, T0);
    await a.writer.init();
    await b.writer.init();
  });

  it('converge on the same Rule edited on both, with no write-back loop', async () => {
    const created = await a.writer.mutateRules([topic('crypto trading')]);
    if (!('rules' in created)) throw new Error('add failed');
    const id = created.rules[0]!.id;
    await settle([a, b]);
    expect((await b.writer.getRules()).map((r) => r.id)).toEqual([id]);

    // Both edit the same Rule before either has synced. B's edit is later, so B wins everywhere.
    a.clock.t = T0 + 1000;
    b.clock.t = T0 + 2000;
    await a.writer.mutateRules([{ op: 'update', id, patch: { text: 'edited on A', enabled: false } }]);
    await b.writer.mutateRules([{ op: 'update', id, patch: { text: 'edited on B' } }]);
    await settle([a, b]);

    const ra = await a.writer.getRules();
    const rb = await b.writer.getRules();
    expect(strip(ra)).toEqual(strip(rb));
    expect(ra[0]).toMatchObject({ id, text: 'edited on B', enabled: true, updatedAt: T0 + 2000 });

    // Quiescent: more timers and merges write nothing.
    const writes = shared.writes;
    await settle([a, b]);
    expect(shared.writes).toBe(writes);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a delete on one device reaches the other and is not resurrected', async () => {
    const created = await a.writer.mutateRules([topic('drama'), topic('gossip')]);
    if (!('rules' in created)) throw new Error('add failed');
    await settle([a, b]);
    a.clock.t = T0 + 5000;
    await a.writer.mutateRules([{ op: 'delete', id: created.rules[0]!.id }]);
    await settle([a, b]);
    expect((await b.writer.getRules()).map((r) => r.text)).toEqual(['gossip']);
    expect((await a.writer.getRules()).map((r) => r.text)).toEqual(['gossip']);
    const writes = shared.writes;
    await settle([a, b]);
    expect(shared.writes).toBe(writes);
  });

  it('a ref collision renumbers the later Rule and records a renumbered Activity event', async () => {
    // Both devices add R1 while neither has seen the other's write.
    a.clock.t = T0 + 1000;
    b.clock.t = T0 + 2000;
    const fromA = await a.writer.mutateRules([topic('added on A')]);
    const fromB = await b.writer.mutateRules([topic('added on B')]);
    if (!('rules' in fromA) || !('rules' in fromB)) throw new Error('add failed');
    expect(fromA.rules[0]!.ref).toBe('R1');
    expect(fromB.rules[0]!.ref).toBe('R1');
    await settle([a, b]);

    const ra = await a.writer.getRules();
    const rb = await b.writer.getRules();
    expect(strip(ra)).toEqual(strip(rb));
    expect(ra.map((r) => [r.text, r.ref])).toEqual([
      ['added on A', 'R1'],
      ['added on B', 'R2'],
    ]);

    const events = [...(await queryActivity(a.areas.local, { kinds: ['renumbered'] })), ...(await queryActivity(b.areas.local, { kinds: ['renumbered'] }))];
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]).toMatchObject({ kind: 'renumbered', ruleId: fromB.rules[0]!.id, detail: 'R1 -> R2' });

    // The next new Rule on either device never reuses a ref.
    const next = await a.writer.mutateRules([topic('third')]);
    if (!('rules' in next)) throw new Error('add failed');
    expect(next.rules.map((r) => r.ref)).toEqual(['R1', 'R2', 'R3']);
    const writes = shared.writes;
    await settle([a, b]);
    await settle([a, b]);
    expect(shared.writes).toBeGreaterThan(writes);
    const after = shared.writes;
    await settle([a, b]);
    expect(shared.writes).toBe(after);
  });

  it('a rename on one device wins over an older text edit on the other, like any edit (REQ-RULE-11)', async () => {
    const created = await a.writer.mutateRules([topic('celebrity gossip')]);
    if (!('rules' in created)) throw new Error('add failed');
    const id = created.rules[0]!.id;
    await settle([a, b]);
    a.clock.t = T0 + 1000;
    b.clock.t = T0 + 2000;
    await a.writer.mutateRules([{ op: 'update', id, patch: { text: 'edited on A' } }]);
    await b.writer.mutateRules([{ op: 'update', id, patch: { name: 'Gossip' } }]);
    await settle([a, b]);
    const ra = await a.writer.getRules();
    expect(strip(ra)).toEqual(strip(await b.writer.getRules()));
    expect(ra[0]).toMatchObject({ id, text: 'celebrity gossip', name: 'Gossip', updatedAt: T0 + 2000 });
    const writes = shared.writes;
    await settle([a, b]);
    expect(shared.writes).toBe(writes);
  });

  it('Exceptions added on both devices are both kept, a removal propagates', async () => {
    a.clock.t = T0 + 1000;
    b.clock.t = T0 + 1500;
    await a.writer.addException({ videoId: 'aaaaaaaaaaa', title: 'kept on A' });
    await settle([a, b]);
    await b.writer.addException({ videoId: 'bbbbbbbbbbb', title: 'kept on B' });
    await settle([a, b]);
    const ids = async (d: Device) => (await d.writer.getExceptions()).map((x) => x.videoId).sort();
    expect(await ids(a)).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb']);
    expect(await ids(b)).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb']);

    await b.writer.removeException('aaaaaaaaaaa');
    await settle([a, b]);
    expect(await ids(a)).toEqual(['bbbbbbbbbbb']);
    expect(await ids(b)).toEqual(['bbbbbbbbbbb']);
  });
});

describe('merge functions', () => {
  const rule = (over: Partial<Rule>): Rule => ({ id: 'x', ref: 'R1', polarity: 'remove', kind: 'topic', text: 't', enabled: true, origin: 'user', createdAt: 1, updatedAt: 1, ...over });

  it('higher updatedAt wins, ties are broken the same way on both sides', () => {
    const ours = new Map([['x', rule({ text: 'ours', updatedAt: 5 })]]);
    const theirs = new Map([['x', rule({ text: 'theirs', updatedAt: 5 })]]);
    const ab = mergeRules(ours, theirs, 10).get('x')!.rule;
    const ba = mergeRules(theirs, ours, 10).get('x')!.rule;
    expect(ab).toEqual(ba);
    // Rules that differ only in their name break the tie the same way too.
    const named = new Map([['x', rule({ name: 'Ours', updatedAt: 5 })]]);
    const other = new Map([['x', rule({ name: 'Theirs', updatedAt: 5 })]]);
    expect(mergeRules(named, other, 10).get('x')!.rule).toEqual(mergeRules(other, named, 10).get('x')!.rule);
  });

  it('purges tombstones after 30 days, a day early when only one side still has it', () => {
    const now = T0;
    const old = rule({ id: 'old', deletedAt: now - TOMBSTONE_TTL_MS - 1, updatedAt: now - TOMBSTONE_TTL_MS - 1 });
    const borderline = rule({ id: 'edge', deletedAt: now - TOMBSTONE_TTL_MS + DAY / 2, updatedAt: now - TOMBSTONE_TTL_MS + DAY / 2 });
    const fresh = rule({ id: 'fresh', deletedAt: now - DAY, updatedAt: now - DAY });
    const merged = mergeRules(new Map([[old.id, old], [borderline.id, borderline], [fresh.id, fresh]]), new Map([[fresh.id, fresh]]), now);
    expect([...merged.keys()]).toEqual(['fresh']);
  });

  it('Exception merge keeps unconfirmed local adds, applies removal records, archives evictions', () => {
    const x = (videoId: string, at: number): Exception => ({ videoId, title: videoId, at });
    const ours = new Map([['kept', x('kept', 5)], ['deleted', x('deleted', 9)], ['evicted', x('evicted', 1)], ['localAdd', x('localAdd', 20)], ['reKept', x('reKept', 30)]]);
    const theirs = new Map([['kept', x('kept', 5)], ['remoteAdd', x('remoteAdd', 21)], ['staleCopy', x('staleCopy', 3)]]);
    const removed = { deleted: 10, staleCopy: 4, reKept: 25 };
    const { merged, archive } = mergeExceptions(ours, theirs, removed, new Set(['localAdd']));
    expect(merged.map((e) => e.videoId).sort()).toEqual(['kept', 'localAdd', 'remoteAdd']);
    expect(archive.map((e) => e.videoId).sort()).toEqual(['evicted', 'reKept']);
  });

  it('removal records merge deterministically and keep the 40 newest', () => {
    const a = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`a${i}`, i]));
    const b = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`b${i}`, i + 0.5]));
    expect(mergeRemovals(a, b)).toEqual(mergeRemovals(b, a));
    expect(Object.keys(mergeRemovals(a, b))).toHaveLength(EXC_REMOVED_MAX);
  });
});

describe('device with its own memory sync area', () => {
  it('replaying onChanged from a memory area also converges', async () => {
    const shared = syncQuota(createMemoryArea());
    const a = makeDevice(shared, T0);
    const b = makeDevice(shared, T0 + 10);
    await a.writer.mutateRules([topic('one')]);
    await b.writer.mutateRules([topic('two')]);
    await settle([a, b]);
    expect(strip(await a.writer.getRules())).toEqual(strip(await b.writer.getRules()));
    expect((await a.writer.getRules()).map((r) => r.ref).sort()).toEqual(['R1', 'R2']);
    const writes = shared.writes;
    await settle([a, b]);
    expect(shared.writes).toBe(writes);
  });
});

describe('Rule changes from another device notify this background (onRulesChanged)', () => {
  const view = (rules: Rule[]) => rules.map((r) => `${r.text}|${r.name ?? ''}|${r.enabled}`);

  it('a clean add, text edit, rename, switch-off and delete each notify once, and own echoes never do', async () => {
    const shared = syncQuota(createMemoryArea());
    const seenA: string[][] = [];
    const seenB: string[][] = [];
    const a = makeDevice(shared, T0, { onRulesChanged: (rules) => seenA.push(view(rules)) });
    const b = makeDevice(shared, T0, { onRulesChanged: (rules) => seenB.push(view(rules)) });
    await a.writer.init();
    await b.writer.init();
    const created = await a.writer.mutateRules([topic('drama')]);
    if (!('rules' in created)) throw new Error('add failed');
    const id = created.rules[0]!.id;
    await settle([a, b]);
    const edits: Partial<Pick<Rule, 'text' | 'name' | 'enabled'>>[] = [{ text: 'celebrity drama' }, { name: 'Drama' }, { enabled: false }];
    for (const patch of edits) {
      await a.writer.mutateRules([{ op: 'update', id, patch }]);
      await settle([a, b]);
    }
    await a.writer.mutateRules([{ op: 'delete', id }]);
    await settle([a, b]);
    expect(seenB).toEqual([['drama||true'], ['celebrity drama||true'], ['celebrity drama|Drama|true'], ['celebrity drama|Drama|false'], []]);
    expect(seenA).toEqual([]);
  });

  it('a sync event without a Rule change does not notify, even when this device writes back', async () => {
    const shared = syncQuota(createMemoryArea());
    const seen: Rule[][] = [];
    const a = makeDevice(shared, T0);
    const b = makeDevice(shared, T0, { onRulesChanged: (rules) => seen.push(rules) });
    await a.writer.init();
    await b.writer.init();
    await a.writer.mutateRules([topic('drama')]);
    await settle([a, b]);
    const before = seen.length;
    // B's Keep has not synced yet when A's lands, so B's merge differs from storage and writes both back.
    await b.writer.addException({ videoId: 'bbbbbbbbbbb', title: 'kept on B' });
    await a.writer.addException({ videoId: 'aaaaaaaaaaa', title: 'kept on A' });
    await a.writer.flush();
    await b.writer.whenIdle();
    await settle([a, b]);
    expect((await b.writer.getExceptions()).map((x) => x.videoId).sort()).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb']);
    expect(seen).toHaveLength(before);
  });

  it('a change that starts a stopped background is compared with what sync held before it', async () => {
    const shared = syncQuota(createMemoryArea());
    const a = makeDevice(shared, T0);
    await a.writer.init();
    // Each device below is stopped until A's next write starts it, so its first load already holds that write.
    const stopped = () => {
      const seen: string[][] = [];
      return { device: makeDevice(shared, T0, { onRulesChanged: (rules) => seen.push(view(rules)) }), seen };
    };
    const b = stopped();
    // The first Rule creates its bucket key.
    const created = await a.writer.mutateRules([topic('drama')]);
    if (!('rules' in created)) throw new Error('add failed');
    await settle([a, b.device]);
    const c = stopped();
    await a.writer.mutateRules([{ op: 'update', id: created.rules[0]!.id, patch: { text: 'celebrity drama' } }]);
    await settle([a, b.device, c.device]);
    // A Keep changes no Rule.
    const d = stopped();
    await a.writer.addException({ videoId: 'aaaaaaaaaaa', title: 'kept on A' });
    await settle([a, b.device, c.device, d.device]);
    expect(b.seen).toEqual([['drama||true'], ['celebrity drama||true']]);
    expect(c.seen).toEqual([['celebrity drama||true']]);
    expect(d.seen).toEqual([]);
  });
});
