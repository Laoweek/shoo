import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { Rule, RuleOp } from '~/core/types';
import type { AreaLike, Areas } from './areas';
import { getArchive, queryActivity } from './local';
import { readEnabled, readSettings } from './read';
import { DEFAULT_SETTINGS, SCHEMA, needsMigration, runMigrations } from './schema';
import { parseSync, toCompactRule } from './sync';
import { makeRule, rng } from './testing/fixtures';
import { createMemoryArea, syncQuota } from './testing/quota-storage';
import { createWriter } from './writer';

const T0 = 1_760_000_000_000;

function memoryAreas(): Areas & { sync: ReturnType<typeof syncQuota> } {
  return { sync: syncQuota(createMemoryArea()), local: createMemoryArea(), session: createMemoryArea() };
}

const topic = (text: string): RuleOp => ({ op: 'add', rule: { polarity: 'remove', kind: 'topic', text, enabled: true, origin: 'user' } });
const keep = (text: string): RuleOp => ({ op: 'add', rule: { polarity: 'keep', kind: 'topic', text, enabled: true, origin: 'user' } });
const file = (rules: unknown[], exceptions: unknown[] = []) => ({ format: 'shoo-rules', version: 1, exportedAt: '2026-10-09T21:00:00Z', rules, exceptions });

beforeEach(() => fakeBrowser.reset());

describe('migrations', () => {
  it('run from an empty store and record schema bookkeeping in local:meta and sync:meta', async () => {
    const areas = { sync: fakeBrowser.storage.sync, local: fakeBrowser.storage.local, session: fakeBrowser.storage.session } as unknown as Areas;
    expect(await needsMigration(areas)).toBe(true);
    await runMigrations(areas);
    expect(await needsMigration(areas)).toBe(false);
    expect(await areas.local.get('meta')).toEqual({ meta: { schema: SCHEMA } });
    expect(await areas.sync.get('meta')).toEqual({ meta: { schema: SCHEMA, nextR: 1, nextK: 1, nextColour: 1 } });
    expect(await readSettings(areas)).toEqual(DEFAULT_SETTINGS);
    expect(await readEnabled(areas.local)).toBe(true);
    // Running again changes nothing.
    await runMigrations(areas);
    expect(await areas.local.get(null)).toEqual({ meta: { schema: SCHEMA }, settings: DEFAULT_SETTINGS });
  });

  it('keep ref counters another device already wrote, and leave a newer schema alone', async () => {
    const areas = memoryAreas();
    await areas.sync.set({ meta: { schema: SCHEMA, nextR: 9, nextK: 4, nextColour: 3 } });
    await areas.local.set({ meta: { schema: SCHEMA + 1 } });
    await runMigrations(areas);
    expect(await areas.sync.get('meta')).toEqual({ meta: { schema: SCHEMA, nextR: 9, nextK: 4, nextColour: 3 } });
    expect(await areas.local.get('meta')).toEqual({ meta: { schema: SCHEMA + 1 } });
    expect(await areas.local.get('settings')).toEqual({});
  });

  it('preserves a Rule with an unknown kind untouched while other Rules change', async () => {
    const areas = memoryAreas();
    const future = { ...toCompactRule(makeRule(rng(1), 1)), k: 'futureKind', zz: 1 };
    await areas.sync.set({ 'rules:b0': { [future.i]: future } });
    const writer = createWriter({ areas, now: () => T0 });
    const res = await writer.mutateRules([topic('crypto')]);
    if (!('rules' in res)) throw new Error('add failed');
    expect(res.rules.find((r) => r.id === future.i)?.kind).toBe('futureKind');
    await writer.flush();
    const stored = Object.values(await areas.sync.get(null)).flatMap((b) => Object.values(b as object));
    expect(stored).toContainEqual(future);
  });
});

describe('serialized writer', () => {
  it('concurrent mutateRules calls never duplicate refs or lose updates', async () => {
    const areas = memoryAreas();
    let t = T0;
    const writer = createWriter({ areas, now: () => ++t });
    const results = await Promise.all([
      ...Array.from({ length: 15 }, (_, i) => writer.mutateRules([topic(`popup ${i}`)])),
      ...Array.from({ length: 15 }, (_, i) => writer.mutateRules([topic(`settings ${i}`), keep(`keep ${i}`)])),
    ]);
    expect(results.every((r) => 'rules' in r)).toBe(true);
    const rules = await writer.getRules();
    expect(rules).toHaveLength(45);
    expect(new Set(rules.map((r) => r.ref)).size).toBe(45);
    expect(rules.filter((r) => r.polarity === 'remove').map((r) => r.ref).sort()).toEqual(Array.from({ length: 30 }, (_, i) => `R${i + 1}`).sort());
    expect(rules.filter((r) => r.polarity === 'keep').every((r) => r.colour === undefined)).toBe(true);

    // Concurrent edits to one Rule both land.
    const id = rules[0]!.id;
    await Promise.all([
      writer.mutateRules([{ op: 'update', id, patch: { text: 'new text' } }]),
      writer.mutateRules([{ op: 'update', id, patch: { enabled: false } }]),
      writer.updateSettings({ dailyCap: 100 }),
      writer.updateSettings({ mode: 'auto' }),
    ]);
    expect((await writer.getRules()).find((r) => r.id === id)).toMatchObject({ text: 'new text', enabled: false });
    expect(await writer.getSettings()).toMatchObject({ dailyCap: 100, mode: 'auto', generation: 2 });

    // And a fresh background reading storage sees the same.
    await writer.flush();
    expect(await createWriter({ areas, now: () => t }).getRules()).toEqual(await writer.getRules());
  });

  it('validates every op and applies all or none', async () => {
    const writer = createWriter({ areas: memoryAreas(), now: () => T0 });
    const bad = await writer.mutateRules([topic('fine'), { op: 'add', rule: { polarity: 'keep', kind: 'thumbnail', text: 'x', enabled: true, origin: 'user' } }]);
    expect(bad).toEqual({ error: 'invalidInput', detail: '1:thumbnailKeep' });
    expect(await writer.getRules()).toEqual([]);
    expect(await writer.mutateRules([{ op: 'add', rule: { polarity: 'remove', kind: 'regex', text: 'a+', enabled: true, origin: 'user' } }])).toEqual({
      error: 'invalidInput',
      detail: '0:regexDisabled',
    });
    expect(await writer.mutateRules([{ op: 'update', id: 'missing', patch: { text: 'x' } }])).toEqual({ error: 'invalidInput', detail: '0:notFound' });
  });

  it('deletes as tombstones that keep their ref, so refs are never reused', async () => {
    let t = T0;
    const writer = createWriter({ areas: memoryAreas(), now: () => ++t });
    const res = await writer.mutateRules([topic('a'), topic('b')]);
    if (!('rules' in res)) throw new Error('add failed');
    await writer.mutateRules([{ op: 'delete', id: res.rules[1]!.id }]);
    const next = await writer.mutateRules([topic('c')]);
    if (!('rules' in next)) throw new Error('add failed');
    expect(next.rules.map((r) => r.ref)).toEqual(['R1', 'R3']);
  });

  it('updateSettings bumps generation and keeps locked Surfaces off', async () => {
    const writer = createWriter({ areas: memoryAreas(), now: () => T0 });
    const s = await writer.updateSettings({ generation: 99, surfaces: { ...DEFAULT_SETTINGS.surfaces, search: true, home: false } });
    expect(s.generation).toBe(1);
    expect(s.surfaces).toMatchObject({ home: false, search: false });
  });
});

describe('private windows (REQ-ACTV-3)', () => {
  it('write nothing to local or sync for an incognito sender', async () => {
    const areas = memoryAreas();
    const writer = createWriter({ areas, now: () => T0 });
    await writer.init();
    await writer.flush();
    const local = JSON.stringify(await areas.local.get(null));
    const sync = JSON.stringify(await areas.sync.get(null));
    const syncWrites = areas.sync.writes;
    const ctx = { incognitoTabId: 7 };

    await writer.addException({ videoId: 'privatevid1', title: 'Kept in private', channelName: 'Chan' }, ctx);
    await writer.recordActivity([{ id: 'e1', kind: 'removed', at: T0, videoId: 'privatevid1' }], ctx);
    await writer.bumpCounters('2025-10-09', { judged: 16, requests: 1, costUsd: 0.001 }, ctx);
    await writer.recordRuleHits([{ ruleId: 'r1', at: T0 }], ctx);
    await writer.putVerdicts([{ videoId: 'privatevid1', rulesVersion: 'v1', text: { pRemove: 0.9, model: 'm' }, at: T0 }], ctx);
    await writer.updateEscalation((all) => ({ ...all, chan: { judged: { '2025-10-09': ['privatevid1'] }, topicRemoved: {} } }), ctx);
    await writer.removeException('somethingel', ctx);
    await writer.flush();

    expect(JSON.stringify(await areas.local.get(null))).toBe(local);
    expect(JSON.stringify(await areas.sync.get(null))).toBe(sync);
    expect(areas.sync.writes).toBe(syncWrites);

    // The session keeps Keep and the Daily cap working for the window.
    expect((await writer.getExceptions(ctx)).map((x) => x.videoId)).toEqual(['privatevid1']);
    expect(await writer.getExceptions()).toEqual([]);
    expect((await writer.getDayCounters('2025-10-09')).judged).toBe(16);
    expect(Object.keys(await areas.session.get(null)).sort()).toEqual(['private:7:exceptions', 'private:counters:2025-10-09']);
  });
});

describe('export and import (REQ-RULE-9)', () => {
  it('rejects malformed files whole', async () => {
    const areas = memoryAreas();
    const writer = createWriter({ areas, now: () => T0 });
    for (const [f, detail] of [
      [null, 'notAnObject'],
      ['{}', 'notAnObject'],
      [{ format: 'other', version: 1, rules: [], exceptions: [] }, 'format'],
      [{ format: 'shoo-rules', version: 2, rules: [], exceptions: [] }, 'version'],
      [{ format: 'shoo-rules', version: 1, rules: {} }, 'missingLists'],
    ] as const) {
      expect(await writer.importData(f, 'merge', false)).toEqual({ error: 'invalidInput', detail });
    }
    expect(await writer.getRules()).toEqual([]);
  });

  it('skips unsafe regex and malformed entries and lists them in the preview', async () => {
    const writer = createWriter({ areas: memoryAreas(), now: () => T0 });
    const good = makeRule(rng(1), 1);
    const unsafe = { ...makeRule(rng(2), 2), polarity: 'remove', kind: 'regex', text: '(a+)+$', colour: 'c2' };
    const lookbehind = { ...makeRule(rng(3), 3), polarity: 'remove', kind: 'regex', text: '(?<=x)y', colour: 'c3' };
    const badRef = { ...makeRule(rng(4), 4), polarity: 'remove', ref: 'K4' };
    const res = await writer.importData(file([good, unsafe, lookbehind, badRef, 'nope'], [{ videoId: 'short', title: 't', at: 1 }]), 'merge', false);
    expect(res).toEqual({
      preview: { add: 1, update: 0, renumber: 0, invalid: ['rules[1]: regex.nestedQuantifier', 'rules[2]: regex.lookaround', 'rules[3]: ref', 'rules[4]: notAnObject', 'exceptions[0]: videoId'] },
    });
    expect((await writer.getRules()).map((r) => r.id)).toEqual([good.id]);
  });

  it('dry run previews without writing, merge adds, updates newer and renumbers collisions', async () => {
    const areas = memoryAreas();
    let t = T0;
    const writer = createWriter({ areas, now: () => ++t });
    const res = await writer.mutateRules([topic('mine one'), topic('mine two')]);
    if (!('rules' in res)) throw new Error('add failed');
    await writer.flush();
    await writer.whenIdle();
    const before = JSON.stringify([await areas.local.get(null), await areas.sync.get(null)]);

    const mine = res.rules[0]!;
    const updated: Rule = { ...mine, text: 'updated by import', updatedAt: mine.updatedAt + 100 };
    const stale: Rule = { ...res.rules[1]!, text: 'older copy', updatedAt: 1 };
    const colliding: Rule = { ...makeRule(rng(8), 1), polarity: 'remove', kind: 'topic', ref: 'R1', colour: 'c1', createdAt: T0 + 50, updatedAt: T0 + 50 };
    const f = file([updated, stale, colliding], [{ videoId: 'importedv01', title: 'Imported keep', at: T0 }]);

    const preview = await writer.importData(f, 'merge', true);
    expect(preview).toEqual({ preview: { add: 1, update: 1, renumber: 1, invalid: [] } });
    expect(JSON.stringify([await areas.local.get(null), await areas.sync.get(null)])).toBe(before);

    expect(await writer.importData(f, 'merge', false)).toEqual(preview);
    const rules = await writer.getRules();
    expect(rules.map((r) => [r.text, r.ref])).toEqual([
      ['updated by import', 'R1'],
      ['mine two', 'R2'],
      [colliding.text, 'R3'],
    ]);
    const events = await queryActivity(areas.local, { kinds: ['renumbered'] });
    expect(events).toMatchObject([{ ruleId: colliding.id, detail: 'R1 -> R3' }]);
    expect((await writer.getExceptions()).map((x) => x.videoId)).toEqual(['importedv01']);
  });

  it('replace removes Rules missing from the file and replaces Exceptions', async () => {
    let t = T0;
    const writer = createWriter({ areas: memoryAreas(), now: () => ++t });
    await writer.mutateRules([topic('old')]);
    await writer.addException({ videoId: 'oldkeep0001', title: 'old' });
    const incoming = { ...makeRule(rng(9), 5), polarity: 'remove', kind: 'topic', ref: 'R5', colour: 'c5' };
    const res = await writer.importData(file([incoming], [{ videoId: 'newkeep0001', title: 'new', at: T0 }]), 'replace', false);
    expect(res).toEqual({ preview: { add: 1, update: 0, renumber: 0, invalid: [], remove: { rules: 1, exceptions: 1 } } });
    expect((await writer.getRules()).map((r) => r.ref)).toEqual(['R5']);
    expect((await writer.getExceptions()).map((x) => x.videoId)).toEqual(['newkeep0001']);
    const next = await writer.mutateRules([topic('after')]);
    if (!('rules' in next)) throw new Error('add failed');
    expect(next.rules.find((r) => r.text === 'after')?.ref).toBe('R6');
  });

  it('exports Rules without tombstones and every Exception, never settings, key or Activity', async () => {
    const areas = memoryAreas();
    let t = T0;
    const writer = createWriter({ areas, now: () => ++t });
    const res = await writer.mutateRules([topic('a'), topic('b')]);
    if (!('rules' in res)) throw new Error('add failed');
    await writer.mutateRules([{ op: 'delete', id: res.rules[0]!.id }]);
    await writer.addException({ videoId: 'keepme00001', title: 'k' });
    await writer.recordActivity([{ id: 'e', kind: 'kept', at: T0 }]);
    await areas.local.set({ 'secret:openrouterKey': { key: 'sk-or-test', source: 'pasted', connectedAt: T0 } });
    const out = await writer.exportData();
    expect(out).toMatchObject({ format: 'shoo-rules', version: 1, exportedAt: expect.any(String) });
    expect(Object.keys(out).sort()).toEqual(['exceptions', 'exportedAt', 'format', 'rules', 'version']);
    expect(out.rules.map((r) => r.text)).toEqual(['b']);
    expect(out.exceptions.map((x) => x.videoId)).toEqual(['keepme00001']);
    expect(JSON.stringify(out)).not.toContain('sk-or-test');

    // Round trip into an empty profile.
    const other = createWriter({ areas: memoryAreas(), now: () => ++t });
    expect(await other.importData(JSON.parse(JSON.stringify(out)), 'merge', false)).toEqual({ preview: { add: 1, update: 0, renumber: 0, invalid: [] } });
    expect((await other.exportData()).rules.map((r) => [r.id, r.ref, r.text])).toEqual(out.rules.map((r) => [r.id, r.ref, r.text]));
  });
});

describe('Rule name (REQ-RULE-11)', () => {
  const named = (text: string, name: unknown): RuleOp => ({ op: 'add', rule: { polarity: 'remove', kind: 'topic', text, enabled: true, origin: 'starter', name: name as string } });

  it('add and update carry the name trimmed, a blank name is no name, over 40 characters is refused', async () => {
    const areas = memoryAreas();
    let t = T0;
    const writer = createWriter({ areas, now: () => ++t });
    const res = await writer.mutateRules([named('Celebrity gossip and drama', '  Gossip  '), named('Crypto hype', '   ')]);
    if (!('rules' in res)) throw new Error(JSON.stringify(res));
    const [gossip, crypto] = res.rules;
    expect(gossip).toMatchObject({ name: 'Gossip', origin: 'starter' });
    expect(crypto).not.toHaveProperty('name');
    expect(await writer.mutateRules([named('x', 'n'.repeat(41))])).toEqual({ error: 'invalidInput', detail: '0:nameTooLong' });
    expect(await writer.mutateRules([{ op: 'update', id: gossip!.id, patch: { name: ` ${'n'.repeat(41)} ` } }])).toEqual({ error: 'invalidInput', detail: '0:nameTooLong' });

    // A rename, an edit that leaves the name alone, and clearing it with an empty string.
    await writer.mutateRules([{ op: 'update', id: crypto!.id, patch: { name: ' Crypto ' } }]);
    await writer.mutateRules([{ op: 'update', id: gossip!.id, patch: { text: 'Celebrity gossip', enabled: false } }]);
    let rules = await writer.getRules();
    expect(rules.map((r) => [r.text, r.name])).toEqual([
      ['Celebrity gossip', 'Gossip'],
      ['Crypto hype', 'Crypto'],
    ]);
    await writer.mutateRules([{ op: 'update', id: gossip!.id, patch: { name: '' } }]);
    rules = await writer.getRules();
    expect(rules[0]).not.toHaveProperty('name');

    // The name reaches storage.sync, and a fresh background reads it back.
    await writer.flush();
    const stored = Object.values(await areas.sync.get(null)).flatMap((b) => Object.values(b as object));
    expect(stored).toContainEqual(expect.objectContaining({ i: crypto!.id, n: 'Crypto' }));
    expect(await createWriter({ areas, now: () => ++t }).getRules()).toEqual(rules);
  });

  it('a name over 40 characters synced from elsewhere never blocks switching the Rule off or editing its text', async () => {
    const areas = memoryAreas();
    const long = 'n'.repeat(50);
    const synced: Rule = { ...makeRule(rng(1), 1), polarity: 'remove', kind: 'topic', ref: 'R1', text: 'Celebrity gossip and drama', enabled: true, name: long };
    await areas.sync.set({ 'rules:b0': { [synced.id]: toCompactRule(synced) } });
    let t = T0;
    const writer = createWriter({ areas, now: () => ++t });
    expect(await writer.mutateRules([{ op: 'update', id: synced.id, patch: { enabled: false } }])).toHaveProperty('rules');
    expect(await writer.mutateRules([{ op: 'update', id: synced.id, patch: { text: 'Celebrity gossip' } }])).toHaveProperty('rules');
    // Only a patch that sets the name is checked.
    expect(await writer.mutateRules([{ op: 'update', id: synced.id, patch: { name: 'n'.repeat(41) } }])).toEqual({ error: 'invalidInput', detail: '0:nameTooLong' });
    expect(await writer.getRules()).toMatchObject([{ text: 'Celebrity gossip', enabled: false, name: long }]);
  });

  it('export writes the name, import reads it trimmed and skips a Rule whose name is not a short string', async () => {
    let t = T0;
    const writer = createWriter({ areas: memoryAreas(), now: () => ++t });
    await writer.mutateRules([named('Celebrity gossip and drama', 'Gossip')]);
    const out = await writer.exportData();
    expect(out.rules[0]).toMatchObject({ name: 'Gossip' });

    const base = { ...makeRule(rng(1), 1), polarity: 'remove', kind: 'topic', ref: 'R1', colour: 'c1' };
    const rule = (n: number, name: unknown) => ({ ...base, id: `imported-${n}`, ref: `R${n}`, name });
    const f = file([rule(1, ' Spaced '), rule(2, 'n'.repeat(41)), rule(3, 7), rule(4, '  '), rule(5, undefined), rule(6, 'n'.repeat(40))]);
    const other = createWriter({ areas: memoryAreas(), now: () => ++t });
    expect(await other.importData(f, 'merge', false)).toEqual({ preview: { add: 4, update: 0, renumber: 0, invalid: ['rules[1]: nameTooLong', 'rules[2]: name'] } });
    const rules = await other.getRules();
    expect(rules.map((r) => [r.ref, r.name])).toEqual([
      ['R1', 'Spaced'],
      ['R4', undefined],
      ['R5', undefined],
      ['R6', 'n'.repeat(40)],
    ]);
    expect(rules.filter((r) => 'name' in r).map((r) => r.ref)).toEqual(['R1', 'R6']);
  });

  it('skipSubscribed is kept through sync, export and import, cleared when switched off, and refused on a Keep rule', async () => {
    const areas = memoryAreas();
    let t = T0;
    const writer = createWriter({ areas, now: () => ++t });
    const res = await writer.mutateRules([{ op: 'add', rule: { polarity: 'remove', kind: 'topic', text: 'Reaction videos', enabled: true, origin: 'user', skipSubscribed: true } }]);
    if (!('rules' in res)) throw new Error(JSON.stringify(res));
    const id = res.rules[0]!.id;
    expect(await writer.mutateRules([{ op: 'add', rule: { polarity: 'keep', kind: 'topic', text: 'Tutorials', enabled: true, origin: 'user', skipSubscribed: true } }])).toEqual({
      error: 'invalidInput',
      detail: '0:skipSubscribedKeep',
    });

    await writer.flush();
    expect(await createWriter({ areas, now: () => ++t }).getRules()).toMatchObject([{ id, skipSubscribed: true }]);
    const exported = (await writer.exportData()).rules[0]!;
    const other = createWriter({ areas: memoryAreas(), now: () => ++t });
    await other.importData(file([exported, { ...exported, id: 'imported-2', ref: 'R2', skipSubscribed: 'yes' }]), 'merge', false);
    expect((await other.getRules()).map((r) => [r.ref, r.skipSubscribed])).toEqual([['R1', true]]);

    await writer.mutateRules([{ op: 'update', id, patch: { skipSubscribed: false } }]);
    expect((await writer.getRules())[0]).not.toHaveProperty('skipSubscribed');
  });
});

describe('reset and retention', () => {
  it('resetAll erases Rules, Exceptions, key, Activity and caches, keeping ref counters and the sync floor', async () => {
    const areas = memoryAreas();
    let t = T0;
    const writer = createWriter({ areas, now: () => ++t });
    await writer.mutateRules([topic('a'), topic('b')]);
    await writer.addException({ videoId: 'keepme00001', title: 'k' });
    await writer.recordActivity([{ id: 'e', kind: 'kept', at: T0 }]);
    await writer.updateSettings({ mode: 'auto' });
    await areas.local.set({ 'secret:openrouterKey': { key: 'sk-or-test', source: 'pasted', connectedAt: T0 } });
    await areas.session.set({ removalTabs: {} });

    await writer.resetAll();
    await writer.whenIdle();
    expect(await writer.getRules()).toEqual([]);
    expect(await writer.getExceptions()).toEqual([]);
    expect(Object.keys(await areas.local.get(null)).sort()).toEqual(['meta', 'settings', 'syncFloor']);
    expect(await areas.session.get(null)).toEqual({});
    expect(await writer.getSettings()).toEqual({ ...DEFAULT_SETTINGS, generation: 2 });
    const snapshot = parseSync(await areas.sync.get(null));
    expect([...snapshot.rules.values()].every((r) => r.deletedAt !== undefined)).toBe(true);
    const next = await writer.mutateRules([topic('fresh')]);
    if (!('rules' in next)) throw new Error('add failed');
    expect(next.rules[0]!.ref).toBe('R3');
  });

  it('runRetention purges Rule tombstones older than 30 days', async () => {
    const areas = memoryAreas();
    const clock = { t: T0 };
    const writer = createWriter({ areas, now: () => clock.t });
    const res = await writer.mutateRules([topic('a')]);
    if (!('rules' in res)) throw new Error('add failed');
    await writer.mutateRules([{ op: 'delete', id: res.rules[0]!.id }]);
    clock.t = T0 + 31 * 24 * 3600 * 1000;
    await writer.runRetention();
    await writer.flush();
    expect(parseSync(await areas.sync.get(null)).rules.size).toBe(0);
  });

  it('archived Exceptions are found by getExceptions and removeException clears both places', async () => {
    const areas = memoryAreas();
    let t = T0;
    const writer = createWriter({ areas, now: () => ++t });
    for (let i = 0; i < 155; i++) await writer.addException({ videoId: `vid${String(i).padStart(8, '0')}`, title: `video ${i}` });
    expect(await getArchive(areas.local)).toHaveLength(5);
    await writer.removeException('vid00000000');
    expect(await getArchive(areas.local)).toHaveLength(4);
    expect((await writer.getExceptions()).some((x) => x.videoId === 'vid00000000')).toBe(false);
  });
});

describe('fakeBrowser areas', () => {
  it('the writer works against the real fake browser storage', async () => {
    const writer = createWriter({ now: () => T0 });
    const res = await writer.mutateRules([topic('crypto')]);
    expect('rules' in res).toBe(true);
    await writer.flush();
    expect(Object.keys(await (fakeBrowser.storage.sync as unknown as AreaLike).get(null)).some((k) => k.startsWith('rules:b'))).toBe(true);
    writer.dispose();
  });
});
