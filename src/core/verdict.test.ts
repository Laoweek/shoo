import { describe, expect, it } from 'vitest';
import type { ExactStageOutcome } from './rules';
import type { Rule, Settings } from './types';
import {
  deriveChoiceAnswer,
  deriveKeepAnswers,
  deriveNoulAnswers,
  finalVerdict,
  needsThumbnailPass,
  P_KEEP_THRESHOLD,
  removeCutoff,
  STRENGTH_PRESETS,
  type TextModelResult,
  type ThumbModelResult,
} from './verdict';

const rule = (over: Partial<Rule>): Rule => ({
  id: `id-${over.ref}`,
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

describe('removeCutoff', () => {
  it.each<[Settings['strength'], number, number]>([
    [{ preset: 'cautious', custom: 0.1 }, 0.9, 0.85],
    [{ preset: 'balanced', custom: 0.1 }, 0.75, 0.6],
    [{ preset: 'eager', custom: 0.1 }, 0.55, 0.35],
    [{ preset: 'custom', custom: 0.42 }, 0.4, 0.4],
    [{ preset: 'custom', custom: 0.43 }, 0.45, 0.45],
    [{ preset: 'custom', custom: 0.7 }, 0.7, 0.7],
    [{ preset: 'custom', custom: 0 }, 0.05, 0.05],
    [{ preset: 'custom', custom: 1 }, 0.95, 0.95],
    [{ preset: 'custom', custom: NaN }, 0.75, 0.6],
  ])('%j -> text %s, thumbnail %s', (strength, text, thumbnail) => {
    expect(removeCutoff(strength, 'text')).toBe(text);
    expect(removeCutoff(strength, 'thumbnail')).toBe(thumbnail);
  });

  it('exposes the presets', () => {
    expect(STRENGTH_PRESETS).toEqual({
      cautious: { text: 0.9, thumbnail: 0.85 },
      balanced: { text: 0.75, thumbnail: 0.6 },
      eager: { text: 0.55, thumbnail: 0.35 },
    });
  });
});

describe('deriveChoiceAnswer (decision-engine.md §2.3)', () => {
  it.each<[string, Parameters<typeof deriveChoiceAnswer>[0], ReturnType<typeof deriveChoiceAnswer>]>([
    [
      'probabilities: 1 - keep, argmax ref',
      { choice: 'R1', probabilities: { keep: 0.06, R1: 0.91, R2: 0.01, R3: 0.02 }, confidence: 0.88 },
      { pRemove: 1 - 0.06, ref: 'R1' },
    ],
    ['argmax ignores the choice field', { choice: 'keep', probabilities: { keep: 0.5, R1: 0.2, R2: 0.3 } }, { pRemove: 0.5, ref: 'R2' }],
    ['ties go to the first option', { probabilities: { keep: 0.2, R1: 0.4, R2: 0.4 } }, { pRemove: 0.8, ref: 'R1' }],
    ['no rule options', { probabilities: { keep: 1 } }, { pRemove: 0 }],
    ['invalid rule probabilities are skipped', { probabilities: { keep: 0.5, R1: 2, R2: 0.1 } }, { pRemove: 0.5, ref: 'R2' }],
    ['missing keep probability', { choice: 'R1', probabilities: { R1: 1 }, confidence: 0.9 }, null],
    ['keep probability out of range', { probabilities: { keep: 1.5, R1: 0 } }, null],
    ['no probabilities, rule choice', { choice: 'R2', confidence: 0.7 }, { pRemove: 0.7, ref: 'R2' }],
    ['no probabilities, keep choice', { choice: 'keep', confidence: 0.9 }, { pRemove: 1 - 0.9 }],
    ['no probabilities, no confidence', { choice: 'R2' }, null],
    ['no probabilities, no choice', { confidence: 0.4 }, null],
  ])('%s', (_, answer, expected) => {
    const out = deriveChoiceAnswer(answer);
    if (expected === null) expect(out).toBeNull();
    else {
      expect(out?.ref).toBe(expected.ref);
      expect(out?.pRemove).toBeCloseTo(expected.pRemove, 10);
    }
  });
});

describe('deriveNoulAnswers (decision-engine.md §2.4)', () => {
  it.each<[Record<string, number>, ReturnType<typeof deriveNoulAnswers>]>([
    [{ R1: 0.2, R2: 0.9, R3: 0.4 }, { pRemove: 0.9, ref: 'R2' }],
    [{ R1: 0, R2: 0 }, { pRemove: 0, ref: 'R1' }],
    [{ R1: NaN, R2: 0.3 }, { pRemove: 0.3, ref: 'R2' }],
    [{}, { pRemove: 0 }],
  ])('%j', (input, expected) => {
    expect(deriveNoulAnswers(input)).toEqual(expected);
  });
});

describe('deriveKeepAnswers (§2.3 step 1, one noul per Topic Keep rule)', () => {
  it.each<[Record<string, number>, ReturnType<typeof deriveKeepAnswers>]>([
    [{ K1: 0.1, K2: 0.94 }, { pKeep: 0.94, keepRef: 'K2' }],
    [{ K1: 0.5, K2: 0.5 }, { pKeep: 0.5, keepRef: 'K1' }],
    [{ K1: -1 }, { pKeep: 0 }],
    [{}, { pKeep: 0 }],
  ])('%j', (input, expected) => {
    expect(deriveKeepAnswers(input)).toEqual(expected);
  });
});

describe('needsThumbnailPass', () => {
  const text = (over: Partial<TextModelResult>): TextModelResult => ({ pRemove: 0.1, ref: 'R1', model: 'm', ...over });
  it.each<[string, TextModelResult | undefined, boolean, boolean]>([
    ['no Topic rules at all', undefined, false, true],
    ['Topic rules, stage 6 not answered yet', undefined, true, false],
    ['stage 6 matched no Rule', text({ pRemove: 0.2, pKeep: 0.1 }), true, true],
    ['remove ref matched (≥ 0.5)', text({ pRemove: 0.5 }), true, false],
    ['remove ref matched below the Cautious cutoff still counts', text({ pRemove: 0.7 }), true, false],
    ['high P(remove) without a ref is no match', text({ pRemove: 0.9, ref: undefined }), true, true],
    ['Topic Keep matched', text({ pRemove: 0.1, pKeep: P_KEEP_THRESHOLD, keepRef: 'K1' }), true, false],
    ['keepRef alone below the keep threshold is no match', text({ pRemove: 0.1, pKeep: 0.2, keepRef: 'K1' }), true, true],
  ])('%s', (_, t, hasTopicRules, expected) => {
    expect(needsThumbnailPass(t, hasTopicRules)).toBe(expected);
  });
});

describe('finalVerdict priority', () => {
  const k1 = rule({ ref: 'K1', polarity: 'keep', kind: 'keyword', text: 'tutorial' });
  const k2 = rule({ ref: 'K2', polarity: 'keep', text: 'Programming tutorials' });
  const k3 = rule({ ref: 'K3', polarity: 'keep', text: 'Science' });
  const r1 = rule({ ref: 'R1', text: 'Reaction videos' });
  const r2 = rule({ ref: 'R2', kind: 'thumbnail', text: 'Shocked faces' });
  const ban = rule({ ref: 'R3', kind: 'channel', params: { channelName: 'Drama' } });
  const kw = rule({ ref: 'R4', kind: 'keyword', text: 'crypto' });
  const balanced: Settings['strength'] = { preset: 'balanced', custom: 0.6 };

  const byRef = (rules: Rule[]) => new Map(rules.map((r) => [r.ref, r]));
  const call = (over: {
    exact?: ExactStageOutcome;
    text?: TextModelResult;
    thumb?: ThumbModelResult;
    keepRules?: Rule[];
    rules?: Rule[];
    strength?: Settings['strength'];
  }) =>
    finalVerdict({
      videoId: 'v1',
      exact: over.exact ?? { kind: 'none' },
      text: over.text,
      thumb: over.thumb,
      keepRules: over.keepRules ?? [],
      rulesByRef: byRef(over.rules ?? []),
      strength: over.strength ?? balanced,
      rulesVersion: 'rv',
      now: 42,
    });
  const base = { videoId: 'v1', rulesVersion: 'rv', at: 42 };
  const textResult = (over: Partial<TextModelResult>): TextModelResult => ({ pRemove: 0, model: 'm', ...over });

  it('an exact Keep rule keeps', () => {
    expect(call({ exact: { kind: 'keep', source: 'keepRule', rule: k1 } })).toEqual({
      ...base,
      outcome: 'keep',
      source: 'keepRule',
      ruleId: k1.id,
      ruleRef: 'K1',
    });
  });

  it('an Exception keeps without a Rule', () => {
    expect(call({ exact: { kind: 'keep', source: 'exception' } })).toEqual({ ...base, outcome: 'keep', source: 'exception' });
  });

  it('a Topic Keep rule beats an Exact remove (keep-only answer)', () => {
    const v = call({
      exact: { kind: 'remove', rule: kw, nativeAction: 'notInterested' },
      text: textResult({ pKeep: 0.8 }),
      keepRules: [k3, k2],
      rules: [k2, k3, kw],
    });
    expect(v).toEqual({ ...base, outcome: 'keep', source: 'keepRule', ruleId: k2.id, ruleRef: 'K2', rescuedFrom: kw.id });
  });

  it('a Topic Keep rule beats a Banned channel and uses keepRef when it names a Rule', () => {
    const v = call({
      exact: { kind: 'remove', rule: ban, nativeAction: 'dontRecommendChannel' },
      text: textResult({ pKeep: 0.5, keepRef: 'K3' }),
      keepRules: [k2, k3],
      rules: [k2, k3, ban],
    });
    expect(v).toMatchObject({ outcome: 'keep', source: 'keepRule', ruleRef: 'K3' });
  });

  it('a Topic Keep answer without a known Rule falls back to the first Topic Keep, or none', () => {
    const t = textResult({ pKeep: 0.9, keepRef: 'K99' });
    expect(call({ text: t, keepRules: [k1, k3, k2], rules: [k2, k3] })).toMatchObject({ ruleRef: 'K2' });
    expect(call({ text: t })).toEqual({ ...base, outcome: 'keep', source: 'keepRule' });
  });

  it('the Exact remove stands when the Topic Keep answer is below threshold', () => {
    const v = call({
      exact: { kind: 'remove', rule: ban, nativeAction: 'dontRecommendChannel' },
      text: textResult({ pKeep: 0.49 }),
      keepRules: [k2],
      rules: [k2, ban],
    });
    expect(v).toEqual({ ...base, outcome: 'remove', source: 'exact', nativeAction: 'dontRecommendChannel', ruleId: ban.id, ruleRef: 'R3' });
  });

  it('an Exact remove is held undecided when a Topic Keep rule exists but could not be asked', () => {
    expect(call({ exact: { kind: 'remove', rule: kw, nativeAction: 'notInterested' }, keepRules: [k2], rules: [k2, kw] })).toBeUndefined();
  });

  it('an Exact remove is final without enabled Topic Keep rules', () => {
    const disabledKeep = { ...k2, enabled: false };
    const v = call({ exact: { kind: 'remove', rule: kw, nativeAction: 'notInterested' }, keepRules: [k1, disabledKeep] });
    expect(v).toMatchObject({ outcome: 'remove', source: 'exact', ruleRef: 'R4' });
  });

  it('keeps without asking the model when no model Rules are enabled', () => {
    expect(call({ rules: [kw, { ...r1, enabled: false }] })).toEqual({ ...base, outcome: 'keep', source: 'exact' });
  });

  it('keeps without asking the model when only Topic Keep rules are enabled, since nothing could remove the Tile', () => {
    expect(call({ keepRules: [k2], rules: [k2, kw] })).toEqual({ ...base, outcome: 'keep', source: 'exact' });
  });

  it('a Topic rule at the cutoff removes with Not interested', () => {
    const v = call({ text: textResult({ pRemove: 0.75, ref: 'R1' }), rules: [r1] });
    expect(v).toEqual({ ...base, outcome: 'remove', source: 'model', probability: 0.75, nativeAction: 'notInterested', ruleId: r1.id, ruleRef: 'R1' });
  });

  it.each<[Settings['strength'], number, 'keep' | 'remove']>([
    [{ preset: 'cautious', custom: 0 }, 0.9, 'remove'],
    [{ preset: 'cautious', custom: 0 }, 0.8999, 'keep'],
    [{ preset: 'balanced', custom: 0 }, 0.75, 'remove'],
    [{ preset: 'balanced', custom: 0 }, 0.7499, 'keep'],
    [{ preset: 'eager', custom: 0 }, 0.55, 'remove'],
    [{ preset: 'eager', custom: 0 }, 0.5499, 'keep'],
    [{ preset: 'custom', custom: 0.2 }, 0.2, 'remove'],
  ])('text: strength %j at P(remove) %s -> %s', (strength, p, outcome) => {
    expect(call({ text: textResult({ pRemove: p, ref: 'R1' }), rules: [r1], strength })?.outcome).toBe(outcome);
  });

  it.each<[Settings['strength'], number, 'keep' | 'remove']>([
    [{ preset: 'cautious', custom: 0 }, 0.85, 'remove'],
    [{ preset: 'cautious', custom: 0 }, 0.8499, 'keep'],
    [{ preset: 'balanced', custom: 0 }, 0.6, 'remove'],
    [{ preset: 'balanced', custom: 0 }, 0.5999, 'keep'],
    [{ preset: 'eager', custom: 0 }, 0.35, 'remove'],
    [{ preset: 'eager', custom: 0 }, 0.3499, 'keep'],
    [{ preset: 'custom', custom: 0.2 }, 0.2, 'remove'],
  ])('thumbnail: strength %j at P(remove) %s -> %s', (strength, p, outcome) => {
    expect(call({ thumb: { p, ref: 'R2', model: 'img' }, rules: [r2], strength })?.outcome).toBe(outcome);
  });

  it('the same P(remove) can keep on text and remove on a thumbnail (per-pass cutoffs)', () => {
    expect(call({ text: textResult({ pRemove: 0.6, ref: 'R1' }), rules: [r1] })?.outcome).toBe('keep');
    expect(call({ thumb: { p: 0.6, ref: 'R2', model: 'img' }, rules: [r2] })?.outcome).toBe('remove');
  });

  it('attributes a model remove to an unknown ref by ref only', () => {
    expect(call({ text: textResult({ pRemove: 0.9, ref: 'R9' }), rules: [r1] })).toMatchObject({ ruleRef: 'R9' });
    expect(call({ text: textResult({ pRemove: 0.9, ref: 'R9' }), rules: [r1] })?.ruleId).toBeUndefined();
  });

  it('a Topic rule keep returns a plain model keep with P(remove)', () => {
    expect(call({ text: textResult({ pRemove: 0.3, ref: 'R1' }), rules: [r1] })).toEqual({ ...base, outcome: 'keep', source: 'model', probability: 0.3 });
  });

  it('is undecided while Topic rules have no text answer', () => {
    expect(call({ rules: [r1] })).toBeUndefined();
    expect(call({ keepRules: [k2], rules: [k2, r2] })).toBeUndefined();
  });

  it('a Thumbnail rule removes when stage 6 matched no Rule', () => {
    const v = call({ text: textResult({ pRemove: 0.2, ref: 'R1' }), thumb: { p: 0.7, ref: 'R2', model: 'img' }, rules: [r1, r2] });
    expect(v).toEqual({ ...base, outcome: 'remove', source: 'modelThumbnail', probability: 0.7, nativeAction: 'notInterested', ruleId: r2.id, ruleRef: 'R2' });
  });

  it('a Thumbnail rule alone (no Topic rules) decides from the thumbnail pass', () => {
    expect(call({ thumb: { p: 0.1, ref: 'R2', model: 'img' }, rules: [r2] })).toEqual({ ...base, outcome: 'keep', source: 'model', probability: 0.1 });
    expect(call({ rules: [r2] })).toBeUndefined();
  });

  it('is undecided while a needed thumbnail pass has no answer', () => {
    expect(call({ text: textResult({ pRemove: 0.2, ref: 'R1' }), rules: [r1, r2] })).toBeUndefined();
  });

  it('skips the thumbnail pass when stage 6 matched a Rule', () => {
    // P(remove) 0.7 matched R1 but stays under the Cautious cutoff: keep, no thumbnail needed.
    const v = call({ text: textResult({ pRemove: 0.7, ref: 'R1' }), rules: [r1, r2], strength: { preset: 'cautious', custom: 0 } });
    expect(v).toEqual({ ...base, outcome: 'keep', source: 'model', probability: 0.7 });
  });

  it('a thumbnail below the cutoff keeps', () => {
    const v = call({ text: textResult({ pRemove: 0.2, ref: 'R1' }), thumb: { p: 0.59, ref: 'R2', model: 'img' }, rules: [r1, r2] });
    expect(v).toMatchObject({ outcome: 'keep', source: 'model', probability: 0.2 });
  });

  it('a thumbnail answer without a ref never removes', () => {
    const v = call({ thumb: { p: 0.99, model: 'img' }, rules: [r2] });
    expect(v).toMatchObject({ outcome: 'keep', source: 'model', probability: 0.99 });
  });

  describe('Rescues (rescuedFrom)', () => {
    it('an exact Keep rule names the Exact remove it beat, and only that', () => {
      expect(call({ exact: { kind: 'keep', source: 'keepRule', rule: k1, rescuedFrom: ban } })).toEqual({
        ...base,
        outcome: 'keep',
        source: 'keepRule',
        ruleId: k1.id,
        ruleRef: 'K1',
        rescuedFrom: ban.id,
      });
      // Topic rules are not consulted for exact keeps, even with a text answer that would remove.
      const v = call({ exact: { kind: 'keep', source: 'keepRule', rule: k1 }, text: textResult({ pRemove: 0.99, ref: 'R1' }), rules: [r1] });
      expect(v).not.toHaveProperty('rescuedFrom');
    });

    it('a Topic Keep rule beating a Banned channel (keep-only answer) names it', () => {
      const v = call({ exact: { kind: 'remove', rule: ban, nativeAction: 'dontRecommendChannel' }, text: textResult({ pKeep: 0.9, keepOnly: true }), keepRules: [k2], rules: [k2, ban] });
      expect(v).toMatchObject({ outcome: 'keep', source: 'keepRule', ruleId: k2.id, rescuedFrom: ban.id });
    });

    it('a Topic Keep rule names the Topic rule whose P(remove) reaches the text cutoff', () => {
      const text = textResult({ pRemove: 0.75, ref: 'R1', pKeep: 0.8, keepRef: 'K2' });
      expect(call({ text, keepRules: [k2], rules: [k2, r1] })).toEqual({ ...base, outcome: 'keep', source: 'keepRule', ruleId: k2.id, ruleRef: 'K2', rescuedFrom: r1.id });
    });

    it('a Topic Keep rule is no Rescue below the text cutoff of the current Filtering strength', () => {
      const text = textResult({ pRemove: 0.8, ref: 'R1', pKeep: 0.8, keepRef: 'K2' });
      const cautious = call({ text, keepRules: [k2], rules: [k2, r1], strength: { preset: 'cautious', custom: 0 } });
      expect(cautious).toEqual({ ...base, outcome: 'keep', source: 'keepRule', ruleId: k2.id, ruleRef: 'K2' });
      expect(call({ text, keepRules: [k2], rules: [k2, r1] })).toMatchObject({ rescuedFrom: r1.id });
    });

    it('a Topic Keep rule is no Rescue without a remove ref or from a Thumbnail rule', () => {
      const noRef = call({ text: textResult({ pRemove: 0.95, pKeep: 0.8, keepRef: 'K2' }), keepRules: [k2], rules: [k2, r1] });
      expect(noRef).not.toHaveProperty('rescuedFrom');
      const thumb = call({ text: textResult({ pRemove: 0.1, ref: 'R1', pKeep: 0.8, keepRef: 'K2' }), thumb: { p: 0.99, ref: 'R2', model: 'img' }, keepRules: [k2], rules: [k2, r1, r2] });
      expect(thumb).toMatchObject({ outcome: 'keep', source: 'keepRule' });
      expect(thumb).not.toHaveProperty('rescuedFrom');
    });

    it('an Exception and a plain model keep are never Rescues', () => {
      expect(call({ exact: { kind: 'keep', source: 'exception' } })).not.toHaveProperty('rescuedFrom');
      expect(call({ text: textResult({ pRemove: 0.3, ref: 'R1' }), rules: [r1] })).not.toHaveProperty('rescuedFrom');
    });
  });
});
