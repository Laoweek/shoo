import { describe, expect, it } from 'vitest';
import { compileExact } from './exact';
import {
  activeRules,
  allocateColour,
  allocateRef,
  createRule,
  exampleOn,
  INITIAL_COUNTERS,
  isBannedChannel,
  isTopicKeep,
  parseRef,
  resolveRefCollisions,
  rulesOn,
  ruleSite,
  runExactStages,
  sortByRef,
  trimName,
  validateRuleInput,
  type RefCounters,
} from './rules';
import type { Exception, Rule, TileFacts } from './types';

const rule = (over: Partial<Rule>): Rule => ({
  id: 'id',
  ref: 'R1',
  polarity: 'remove',
  kind: 'topic',
  text: 'text',
  enabled: true,
  origin: 'user',
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

const tile = (over: Partial<TileFacts> = {}): TileFacts => ({
  videoId: 'vid',
  surface: 'home',
  title: 'Crypto drama explained',
  channelName: 'Drama Daily',
  isShort: false,
  isLive: false,
  isUpcoming: false,
  isMembersOnly: false,
  ...over,
});

describe('parseRef', () => {
  it.each([
    ['R12', { letter: 'R', n: 12 }],
    ['K3', { letter: 'K', n: 3 }],
    ['X1', undefined],
    ['R', undefined],
    ['r1', undefined],
  ])('%s', (ref, expected) => {
    expect(parseRef(ref)).toEqual(expected);
  });
});

describe('allocateRef', () => {
  it('starts at 1 and advances the counter per letter', () => {
    const a = allocateRef([], 'remove', INITIAL_COUNTERS);
    expect(a).toEqual({ ref: 'R1', counters: { nextR: 2, nextK: 1, nextColour: 1 } });
    const k = allocateRef([], 'keep', a.counters);
    expect(k).toEqual({ ref: 'K1', counters: { nextR: 2, nextK: 2, nextColour: 1 } });
  });

  it('never reuses a ref after deletion, with or without the tombstone', () => {
    const counters: RefCounters = { nextR: 4, nextK: 1, nextColour: 4 };
    const rules = [rule({ ref: 'R1' }), rule({ ref: 'R2' }), rule({ ref: 'R3', deletedAt: 10 })];
    expect(allocateRef(rules, 'remove', counters).ref).toBe('R4');
    // Tombstone purged after 30 days: the counter still remembers R3.
    expect(allocateRef(rules.slice(0, 2), 'remove', counters).ref).toBe('R4');
  });

  it('jumps past refs in use that the counter has not seen (sync from another device)', () => {
    const rules = [rule({ ref: 'R9' }), rule({ ref: 'K5', polarity: 'keep' }), rule({ ref: 'bogus' })];
    expect(allocateRef(rules, 'remove', INITIAL_COUNTERS)).toEqual({ ref: 'R10', counters: { nextR: 11, nextK: 1, nextColour: 1 } });
    expect(allocateRef(rules, 'keep', INITIAL_COUNTERS).ref).toBe('K6');
  });
});

describe('allocateColour', () => {
  it('cycles c1..c10', () => {
    let counters = INITIAL_COUNTERS;
    const seen: string[] = [];
    for (let i = 0; i < 12; i++) {
      const next = allocateColour(counters);
      seen.push(next.colour);
      counters = next.counters;
    }
    expect(seen).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c1', 'c2']);
  });

  it.each([0, 11, NaN, -3])('recovers from a corrupt counter %s', (n) => {
    expect(allocateColour({ ...INITIAL_COUNTERS, nextColour: n })).toEqual({
      colour: 'c1',
      counters: { ...INITIAL_COUNTERS, nextColour: 2 },
    });
  });
});

describe('createRule', () => {
  const input = { polarity: 'remove' as const, kind: 'topic' as const, text: 'Reaction videos', enabled: true, origin: 'user' as const };

  it('gives remove Rules a ref and a colour', () => {
    const { rule: r, counters } = createRule(input, [], INITIAL_COUNTERS, 1000, 'fixed-id');
    expect(r).toEqual({ ...input, id: 'fixed-id', ref: 'R1', colour: 'c1', createdAt: 1000, updatedAt: 1000 });
    expect(counters).toEqual({ nextR: 2, nextK: 1, nextColour: 2 });
  });

  it('gives Keep rules a K ref and no colour, and a random id by default', () => {
    const { rule: r, counters } = createRule({ ...input, polarity: 'keep' }, [], INITIAL_COUNTERS, 5);
    expect(r.ref).toBe('K1');
    expect('colour' in r).toBe(false);
    expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(counters).toEqual({ nextR: 1, nextK: 2, nextColour: 1 });
  });

  it('keeps colours stable when Rules are deleted', () => {
    let counters = INITIAL_COUNTERS;
    const made: Rule[] = [];
    for (let i = 0; i < 3; i++) {
      const out = createRule(input, made, counters, i);
      made.push(out.rule);
      counters = out.counters;
    }
    made[1] = { ...made[1]!, deletedAt: 9 };
    const next = createRule(input, made, counters, 10);
    expect(next.rule.ref).toBe('R4');
    expect(next.rule.colour).toBe('c4');
  });
});

describe('validateRuleInput', () => {
  type Input = Parameters<typeof validateRuleInput>[0];
  const ok = (over: Partial<Input>, regexEnabled?: boolean) => validateRuleInput({ polarity: 'remove', kind: 'topic', text: 'x', ...over }, regexEnabled);

  it.each<[string, Partial<Input>, boolean | undefined, string | null]>([
    ['topic', {}, undefined, null],
    ['topic keep', { polarity: 'keep' }, undefined, null],
    ['thumbnail keep', { kind: 'thumbnail', polarity: 'keep' }, undefined, 'thumbnailKeep'],
    ['artist channel keep', { kind: 'artistChannel', polarity: 'keep' }, undefined, null],
    ['artist channel remove', { kind: 'artistChannel', polarity: 'remove' }, undefined, 'artistChannelRemove'],
    ['unknown kind', { kind: 'upcoming' as never }, undefined, 'unknownKind'],
    ['blank text', { text: '  \n ' }, undefined, 'emptyText'],
    ['500 characters', { text: 'a'.repeat(500) }, undefined, null],
    ['501 characters', { text: 'a'.repeat(501) }, undefined, 'textTooLong'],
    ['40-character name', { name: 'n'.repeat(40) }, undefined, null],
    ['41-character name', { name: 'n'.repeat(41) }, undefined, 'nameTooLong'],
    ['channel with name', { kind: 'channel', params: { channelName: 'Jake' } }, undefined, null],
    ['channel without name', { kind: 'channel' }, undefined, 'channelNameRequired'],
    ['channel with blank name', { kind: 'channel', params: { channelName: ' ' } }, undefined, 'channelNameRequired'],
    ['duration min only', { kind: 'duration', params: { minSeconds: 0 } }, undefined, null],
    ['duration max only', { kind: 'duration', params: { maxSeconds: 60 } }, undefined, null],
    ['duration min = max', { kind: 'duration', params: { minSeconds: 60, maxSeconds: 60 } }, undefined, null],
    ['duration without bounds', { kind: 'duration', params: {} }, undefined, 'durationBounds'],
    ['duration min > max', { kind: 'duration', params: { minSeconds: 61, maxSeconds: 60 } }, undefined, 'durationBounds'],
    ['duration negative', { kind: 'duration', params: { minSeconds: -1 } }, undefined, 'durationBounds'],
    ['duration NaN', { kind: 'duration', params: { maxSeconds: NaN } }, undefined, 'durationBounds'],
    ['views min only', { kind: 'views', params: { minViews: 0 } }, undefined, null],
    ['views max only', { kind: 'views', params: { maxViews: 10_000 } }, undefined, null],
    ['views without bounds', { kind: 'views', params: {} }, undefined, 'viewsBounds'],
    ['views min > max', { kind: 'views', params: { minViews: 10_001, maxViews: 10_000 } }, undefined, 'viewsBounds'],
    ['views negative', { kind: 'views', params: { maxViews: -1 } }, undefined, 'viewsBounds'],
    ['views NaN', { kind: 'views', params: { minViews: NaN } }, undefined, 'viewsBounds'],
    ['keyword', { kind: 'keyword', text: 'asmr' }, undefined, null],
    ['pattern', { kind: 'pattern', text: 'top * list' }, undefined, null],
    ['regex safe', { kind: 'regex', text: '^\\[?live\\]?' }, true, null],
    ['regex safe, flag unknown (import)', { kind: 'regex', text: '^live' }, undefined, null],
    ['regex while switched off', { kind: 'regex', text: '^live' }, false, 'regexDisabled'],
    ['regex unsafe', { kind: 'regex', text: '(a+)+' }, true, 'regex.nestedQuantifier'],
    ['regex too long', { kind: 'regex', text: 'a'.repeat(201) }, true, 'regex.tooLong'],
  ])('%s', (_, over, regexEnabled, reason) => {
    expect(ok(over, regexEnabled)).toEqual(reason === null ? { ok: true } : { ok: false, reason });
  });
});

describe('trimName', () => {
  it('trims the Rule name and drops a blank one, so no Rule stores an empty name', () => {
    expect(trimName(rule({ name: '  Gossip  ' })).name).toBe('Gossip');
    expect('name' in trimName(rule({ name: ' \n ' }))).toBe(false);
    expect('name' in trimName(rule({ name: undefined }))).toBe(false);
    expect(trimName(rule({}))).toEqual(rule({}));
  });
});

describe('resolveRefCollisions', () => {
  it('renumbers the later-created Rule and records the change', () => {
    const a = rule({ id: 'a', ref: 'R3', createdAt: 100 });
    const b = rule({ id: 'b', ref: 'R3', createdAt: 200 });
    const c = rule({ id: 'c', ref: 'R1', createdAt: 50 });
    const input = [b, c, a];
    const out = resolveRefCollisions(input, { nextR: 4, nextK: 1, nextColour: 4 }, 999);
    expect(out.renumbered).toEqual([{ ruleId: 'b', from: 'R3', to: 'R4' }]);
    expect(out.rules.map((r) => [r.id, r.ref])).toEqual([
      ['b', 'R4'],
      ['c', 'R1'],
      ['a', 'R3'],
    ]);
    expect(out.rules[0]!.updatedAt).toBe(999);
    expect(out.counters.nextR).toBe(5);
    expect(input[0]!.ref).toBe('R3'); // not mutated
  });

  it('breaks three-way createdAt ties by id', () => {
    const tied = ['m', 'z', 'a'].map((id) => rule({ id, ref: 'R1', createdAt: 1 }));
    expect(resolveRefCollisions(tied, INITIAL_COUNTERS).renumbered.map((r) => r.ruleId)).toEqual(['m', 'z']);
  });

  it('breaks createdAt ties by id and leaves updatedAt alone without now', () => {
    const x = rule({ id: 'x', ref: 'K2', polarity: 'keep', createdAt: 7, updatedAt: 1 });
    const y = rule({ id: 'y', ref: 'K2', polarity: 'keep', createdAt: 7, updatedAt: 1 });
    const out = resolveRefCollisions([y, x], INITIAL_COUNTERS);
    expect(out.renumbered).toEqual([{ ruleId: 'y', from: 'K2', to: 'K3' }]);
    expect(out.rules.find((r) => r.id === 'y')?.updatedAt).toBe(1);
  });

  it('handles several collisions without creating new ones, counting tombstones as in use', () => {
    const rules = [
      rule({ id: 'a', ref: 'R1', createdAt: 1 }),
      rule({ id: 'b', ref: 'R1', createdAt: 2 }),
      rule({ id: 'c', ref: 'R1', createdAt: 3 }),
      rule({ id: 'd', ref: 'R2', createdAt: 1 }),
      rule({ id: 'e', ref: 'R2', createdAt: 2 }),
      rule({ id: 'f', ref: 'R7', createdAt: 1, deletedAt: 5 }),
    ];
    const out = resolveRefCollisions(rules, INITIAL_COUNTERS);
    expect(out.renumbered.map((r) => `${r.ruleId}:${r.from}->${r.to}`)).toEqual(['b:R1->R8', 'c:R1->R9', 'e:R2->R10']);
    expect(new Set(out.rules.map((r) => r.ref)).size).toBe(rules.length);
  });

  it('is a no-op without collisions', () => {
    const rules = [rule({ id: 'a', ref: 'R1' }), rule({ id: 'b', ref: 'K1', polarity: 'keep' })];
    expect(resolveRefCollisions(rules, INITIAL_COUNTERS)).toEqual({ rules, counters: INITIAL_COUNTERS, renumbered: [] });
  });
});

describe('Rule predicates and ordering', () => {
  it('identifies Banned channels and Topic Keep rules', () => {
    expect(isBannedChannel(rule({ kind: 'channel' }))).toBe(true);
    expect(isBannedChannel(rule({ kind: 'channel', polarity: 'keep' }))).toBe(false);
    expect(isBannedChannel(rule({ kind: 'keyword' }))).toBe(false);
    expect(isTopicKeep(rule({ polarity: 'keep' }))).toBe(true);
    expect(isTopicKeep(rule({}))).toBe(false);
    expect(isTopicKeep(rule({ kind: 'keyword', polarity: 'keep' }))).toBe(false);
  });

  it('keeps only enabled, non-deleted Rules', () => {
    const rules = [rule({ id: 'a' }), rule({ id: 'b', enabled: false }), rule({ id: 'c', deletedAt: 1 })];
    expect(activeRules(rules).map((r) => r.id)).toEqual(['a']);
  });

  it('sorts K before R, numerically, unparseable refs last', () => {
    const refs = ['R10', 'zz', 'R2', 'K3', 'K1', 'aa', 'R2'].map((ref, i) => rule({ ref, id: `id${6 - i}` }));
    expect(sortByRef(refs).map((r) => `${r.ref}/${r.id}`)).toEqual(['K1/id2', 'K3/id3', 'R2/id0', 'R2/id4', 'R10/id6', 'aa/id1', 'zz/id5']);
    const same = rule({ ref: 'R1', id: 'same' });
    expect(sortByRef([same, { ...same }])).toHaveLength(2);
  });
});

describe('Site-only rules', () => {
  it('reads the Site of a channel Rule saved before Sites from its YouTube handle or channel id', () => {
    const byHandle = rule({ kind: 'channel', text: 'Foo', params: { channelName: 'Foo', handle: 'foo' } });
    const byId = rule({ id: 'id2', kind: 'channel', text: 'Foo', params: { channelName: 'Foo', channelId: 'UCxxxxxxxxxxxxxxxxxxxxxx' } });
    const byName = rule({ id: 'id3', kind: 'channel', text: 'Foo', params: { channelName: 'Foo' } });
    expect([byHandle, byId, byName].map(ruleSite)).toEqual(['youtube', 'youtube', undefined]);
    expect(rulesOn([byHandle, byId, byName], 'bilibili')).toEqual([byName]);
    const compiled = compileExact([byHandle], false);
    expect(runExactStages(tile({ videoId: 'BV1FIXTURE01', surface: 'bilibiliHome', channelName: 'Foo', channelId: '10000001' }), compileExact(rulesOn([byHandle], 'bilibili'), false), () => false).kind).toBe('none');
    expect(runExactStages(tile({ channelName: 'Foo', channelHandle: '@foo' }), compiled, () => false).kind).toBe('remove');
  });

  it('keeps a views Rule on YouTube, the only Site whose Tiles carry a view count', () => {
    const views = rule({ kind: 'views', text: 'Under 1k views', params: { maxViews: 1000 }, site: 'bilibili' });
    expect(ruleSite(views)).toBe('youtube');
    expect(rulesOn([views], 'bilibili')).toEqual([]);
    expect(rulesOn([views], 'youtube')).toEqual([views]);
  });
});

describe('exampleOn', () => {
  const topic = rule({ id: 'topic' });
  const bilibiliTopic = rule({ id: 'bili', ref: 'R2', site: 'bilibili' });
  const disabled = rule({ id: 'off', ref: 'R3', enabled: false });
  const deleted = rule({ id: 'gone', ref: 'R4', deletedAt: 5 });
  const banned = rule({ id: 'ban', ref: 'R5', kind: 'channel', params: { channelName: 'Jake' } });
  const exact = rule({ id: 'kw', ref: 'R6', kind: 'keyword', text: 'giveaway' });
  const thumb = rule({ id: 'th', ref: 'R7', kind: 'thumbnail' });
  const keptFrom = (ruleId?: string): Exception => ({ videoId: `v-${ruleId}`, title: 't', at: 1, ...(ruleId ? { ruleId } : {}) });

  it('shows the model only Exceptions kept from an enabled remove Topic rule on the Site', () => {
    const keep = exampleOn([topic, bilibiliTopic, disabled, deleted, banned, exact, thumb], 'youtube');
    const shown = [undefined, 'topic', 'bili', 'off', 'gone', 'ban', 'kw', 'th', 'unknown'].filter((id) => keep(keptFrom(id)));
    expect(shown).toEqual(['topic']);
    expect(exampleOn([topic, bilibiliTopic], 'bilibili')(keptFrom('bili'))).toBe(true);
  });
});

describe('runExactStages: Keep rule -> Exception -> Banned channel -> other Exact', () => {
  const keep = rule({ id: 'keep', ref: 'K1', polarity: 'keep', kind: 'keyword', text: 'explained' });
  const banned = rule({ id: 'ban', ref: 'R1', kind: 'channel', params: { channelName: 'Drama Daily' } });
  const kw = rule({ id: 'kw', ref: 'R2', kind: 'keyword', text: 'crypto' });
  const compiled = compileExact([keep, banned, kw], false);
  const none = () => false;

  it('an exact Keep rule beats everything, including an Exception, and is no Rescue then', () => {
    expect(runExactStages(tile(), compiled, (id) => id === 'vid')).toEqual({ kind: 'keep', source: 'keepRule', rule: keep });
  });

  it('an exact Keep rule is a Rescue from the Banned channel, else the other Exact rule, it beat', () => {
    expect(runExactStages(tile(), compiled, none)).toEqual({ kind: 'keep', source: 'keepRule', rule: keep, rescuedFrom: banned });
    expect(runExactStages(tile({ channelName: 'Other' }), compiled, none)).toEqual({ kind: 'keep', source: 'keepRule', rule: keep, rescuedFrom: kw });
  });

  it('an exact Keep rule is no Rescue when no Banned channel or other Exact rule matches', () => {
    expect(runExactStages(tile({ title: 'Rust explained', channelName: 'Other' }), compiled, none)).toEqual({ kind: 'keep', source: 'keepRule', rule: keep });
  });

  it('an Exception beats a Banned channel', () => {
    const t = tile({ title: 'Crypto drama' });
    expect(runExactStages(t, compiled, (id) => id === 'vid')).toEqual({ kind: 'keep', source: 'exception' });
  });

  it('a Banned channel beats other Exact rules and uses Don’t recommend channel', () => {
    expect(runExactStages(tile({ title: 'Crypto drama' }), compiled, none)).toEqual({
      kind: 'remove',
      rule: banned,
      nativeAction: 'dontRecommendChannel',
    });
  });

  it('a Banned channel on the Shorts shelf is downgraded to Not interested', () => {
    expect(runExactStages(tile({ title: 'x', surface: 'shortsShelf' }), compiled, none)).toEqual({
      kind: 'remove',
      rule: banned,
      nativeAction: 'notInterested',
    });
  });

  it('other Exact rules use Not interested', () => {
    expect(runExactStages(tile({ title: 'Crypto drama', channelName: 'Other' }), compiled, none)).toEqual({
      kind: 'remove',
      rule: kw,
      nativeAction: 'notInterested',
    });
  });

  it('hands off when nothing matched', () => {
    expect(runExactStages(tile({ title: 'Rust', channelName: 'Other' }), compiled, none)).toEqual({ kind: 'none' });
  });
});
