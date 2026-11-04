import { describe, expect, it } from 'vitest';
import { answerVersions, exactVersion, fnv1a32, fnv1a64, keepQuestionId, newId, questionId, rulesVersion, type RulesVersionInputs } from './ids';
import type { Rule } from './types';

const rule = (over: Partial<Rule>): Rule => ({
  id: 'id-1',
  ref: 'R1',
  polarity: 'remove',
  kind: 'topic',
  text: 'Reaction videos',
  enabled: true,
  origin: 'user',
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe('FNV-1a', () => {
  it('matches the published 32-bit and 64-bit test vectors', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
    expect(fnv1a64('')).toBe('cbf29ce484222325');
    expect(fnv1a64('a')).toBe('af63dc4c8601ec8c');
    expect(fnv1a64('foobar')).toBe('85944171f73967e8');
  });

  it('hashes UTF-8 bytes', () => {
    expect(fnv1a64('é')).not.toBe(fnv1a64('e'));
    expect(fnv1a64('x')).toHaveLength(16);
  });
});

describe('question ids', () => {
  it('maps 0-based indexes to t01..t99', () => {
    expect(questionId(0)).toBe('t01');
    expect(questionId(15)).toBe('t16');
    expect(questionId(98)).toBe('t99');
    expect(keepQuestionId(0, 'K2')).toBe('t01_K2');
    expect(keepQuestionId(15, 'K10')).toBe('t16_K10');
  });

  it.each([-1, 99, 1.5, NaN])('rejects %s', (i) => {
    expect(() => questionId(i)).toThrow(RangeError);
  });
});

describe('rulesVersion', () => {
  const base: RulesVersionInputs = {
    rules: [rule({}), rule({ id: 'k', ref: 'K1', polarity: 'keep', text: 'Programming tutorials' })],
    models: { text: 'cloudflare/clef-flash', image: 'cloudflare/clef-flash' },
    textFraming: 'choice',
    requestShapeVersion: 1,
    thumbnailShapeVersion: 1,
    engine: 'openrouter',
  };
  const v = rulesVersion(base);

  it('is stable and independent of Rule order', () => {
    expect(rulesVersion({ ...base, rules: [...base.rules].reverse() })).toBe(v);
    expect(v).toMatch(/^[0-9a-f]{16}$/);
  });

  it.each<[string, Partial<RulesVersionInputs>]>([
    ['Topic rule text', { rules: [rule({ text: 'Other' }), base.rules[1]!] }],
    ['Topic Keep rule removed', { rules: [rule({})] }],
    ['thumbnail rule added', { rules: [...base.rules, rule({ id: 't', ref: 'R2', kind: 'thumbnail', text: 'Faces' })] }],
    ['text model', { models: { text: 'typesafe/jev-1.13', image: 'cloudflare/clef-flash' } }],
    ['image model', { models: { text: 'cloudflare/clef-flash', image: 'x/y' } }],
    ['framing', { textFraming: 'noul' }],
    ['a Topic rule limited to one Site', { rules: [rule({ site: 'bilibili' }), base.rules[1]!] }],
    ['request shape', { requestShapeVersion: 2 }],
    ['thumbnail shape', { thumbnailShapeVersion: 2 }],
    ['custom engine', { engine: 'custom', customEndpoint: { baseUrl: 'https://llm.example', model: 'm' } }],
  ])('changes with %s', (_, patch) => {
    expect(rulesVersion({ ...base, ...patch })).not.toBe(v);
  });

  it.each<[string, Partial<RulesVersionInputs>]>([
    ['an Exact rule', { rules: [...base.rules, rule({ id: 'e', ref: 'R9', kind: 'keyword', text: 'asmr' })] }],
    ['a disabled Topic rule', { rules: [...base.rules, rule({ id: 'd', ref: 'R9', enabled: false })] }],
    ['a deleted Topic rule', { rules: [...base.rules, rule({ id: 'd', ref: 'R9', deletedAt: 5 })] }],
    ['a custom endpoint while engine is openrouter', { customEndpoint: { baseUrl: 'https://llm.example', model: 'm' } }],
    ['an unrelated Rule field', { rules: [rule({ updatedAt: 99, colour: 'c4' }), base.rules[1]!] }],
    ['a Rule name, so a rename never re-judges (REQ-RULE-11)', { rules: [rule({ name: 'Reactions' }), { ...base.rules[1]!, name: 'Code' }] }],
  ])('ignores %s', (_, patch) => {
    expect(rulesVersion({ ...base, ...patch })).toBe(v);
  });

  it("changes a custom endpoint's version with the chat prompt version, and no other engine's", () => {
    const custom: RulesVersionInputs = { ...base, engine: 'custom', customEndpoint: { baseUrl: 'https://llm.example', model: 'm' }, chatPromptVersion: 1 };
    expect(rulesVersion({ ...custom, chatPromptVersion: 2 })).not.toBe(rulesVersion(custom));
    expect(rulesVersion({ ...base, chatPromptVersion: 2 })).toBe(v);
  });

  it('treats identical Rule tuples deterministically', () => {
    const dup = { ...base, rules: [rule({}), rule({ id: 'id-2' })] };
    expect(rulesVersion(dup)).toBe(rulesVersion({ ...dup, rules: [...dup.rules].reverse() }));
  });
});

describe('answerVersions', () => {
  const base: RulesVersionInputs = {
    rules: [rule({}), rule({ id: 'k', ref: 'K1', polarity: 'keep', text: 'Programming tutorials' }), rule({ id: 't', ref: 'R2', kind: 'thumbnail', text: 'Faces' })],
    models: { text: 'cloudflare/clef-flash', image: 'cloudflare/clef-flash' },
    textFraming: 'choice',
    requestShapeVersion: 1,
    thumbnailShapeVersion: 1,
    engine: 'openrouter',
  };
  const v = answerVersions(base);
  const [topic, keep, thumb] = base.rules as [Rule, Rule, Rule];

  it.each<[string, Partial<RulesVersionInputs>, 'text' | 'thumb']>([
    ['a Topic rule edit', { rules: [{ ...topic, text: 'Other' }, keep, thumb] }, 'text'],
    ['a Topic Keep rule removed', { rules: [topic, thumb] }, 'text'],
    ['the text model', { models: { text: 'typesafe/jev-1.13', image: 'cloudflare/clef-flash' } }, 'text'],
    ['the request shape', { requestShapeVersion: 2 }, 'text'],
    ['a Thumbnail rule edit', { rules: [topic, keep, { ...thumb, text: 'Arrows' }] }, 'thumb'],
    ['the image model', { models: { text: 'cloudflare/clef-flash', image: 'x/y' } }, 'thumb'],
    ['the thumbnail shape', { thumbnailShapeVersion: 2 }, 'thumb'],
  ])('changes one answer version and keeps the other on %s', (_, patch, part) => {
    const next = answerVersions({ ...base, ...patch });
    expect(next[part]).not.toBe(v[part]);
    expect(next[part === 'text' ? 'thumb' : 'text']).toBe(v[part === 'text' ? 'thumb' : 'text']);
  });

  it('changes both with the direct endpoint in use', () => {
    const next = answerVersions({ ...base, engine: 'direct', direct: { provider: 'cloudflare', baseUrl: 'https://x', model: 'm' } });
    expect(next.text).not.toBe(v.text);
    expect(next.thumb).not.toBe(v.thumb);
  });
});

describe('exactVersion', () => {
  const rules = [
    rule({ id: 'a', ref: 'R1', kind: 'keyword', text: 'asmr' }),
    rule({ id: 'b', ref: 'R2', kind: 'duration', text: 'Long', params: { minSeconds: 60, maxSeconds: 600 } }),
  ];
  const v = exactVersion(rules, false);

  it('is order independent, also for params', () => {
    const swapped = [rules[1]!, { ...rules[0]!, params: { maxSeconds: undefined } }];
    expect(exactVersion(swapped, false)).toBe(v);
    const reordered = [{ ...rules[1]!, params: { maxSeconds: 600, minSeconds: 60 } }, rules[0]!];
    expect(exactVersion(reordered, false)).toBe(v);
  });

  it('changes with regexEnabled, params, refs and enabled state, not with Topic rules', () => {
    expect(exactVersion(rules, true)).not.toBe(v);
    expect(exactVersion([rules[0]!, { ...rules[1]!, params: { minSeconds: 61, maxSeconds: 600 } }], false)).not.toBe(v);
    expect(exactVersion([{ ...rules[0]!, ref: 'R7' }, rules[1]!], false)).not.toBe(v);
    expect(exactVersion([{ ...rules[0]!, enabled: false }, rules[1]!], false)).not.toBe(v);
    expect(exactVersion([...rules, rule({ id: 'z', ref: 'R3' })], false)).toBe(v);
    expect(exactVersion([{ ...rules[0]!, name: 'ASMR' }, rules[1]!], false)).toBe(v);
  });

  it('changes when a Rule starts skipping Subscribed channels, so the compiled matchers are rebuilt', () => {
    expect(exactVersion([{ ...rules[0]!, skipSubscribed: true }, rules[1]!], false)).not.toBe(v);
    expect(exactVersion([{ ...rules[0]!, skipSubscribed: false }, rules[1]!], false)).toBe(v);
  });
});

describe('newId', () => {
  it('returns distinct UUIDs', () => {
    const a = newId();
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(newId()).not.toBe(a);
  });
});
