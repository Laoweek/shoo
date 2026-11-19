// Keeps the calibration harness honest: its default request builders must produce exactly the body that
// src/engine/decisions.ts sends, and the dataset files must stay consistent. No network.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import type { TileFacts } from '../../src/core/types';
import {
  buildTextRequest,
  buildThumbnailRequest,
  CHOICE_TASK,
  KEEP_CRITERION,
  keepTask,
  providerFor,
  ruleTask,
  textBatchSizeFor,
  THUMBNAIL_KEEP_CRITERION,
  THUMBNAIL_TASK,
  validateResponse,
} from '../../src/engine/decisions';
import { rule } from '../../src/engine/testing';

// A variable specifier keeps tsc from resolving the untyped .mjs module.
const LIB = './lib.mjs';
const lib = await import(LIB);

const data = (p: string) => JSON.parse(readFileSync(resolve(__dirname, '../../test/calibration', p), 'utf8'));
interface CalTile { id: string; title: string; channel: string | null; durationSec: number | null; surface: TileFacts['surface']; isShort: boolean; hardNegative: string | null; lang: string }
const tiles: CalTile[] = data('tiles.json');
const rules = data('rules.json');
const labels = data('labels.json');

const toFacts = (t: CalTile): TileFacts => ({
  videoId: t.id,
  surface: t.surface,
  title: t.title,
  ...(t.channel ? { channelName: t.channel } : {}),
  ...(t.durationSec != null ? { durationSec: t.durationSec } : {}),
  isShort: t.isShort,
  isLive: false,
  isUpcoming: false,
  isMembersOnly: false,
});
const srcRules = (texts: Record<string, string>, over = {}) => Object.entries(texts).map(([ref, text]) => rule(ref, text, over));

/** The AUTHOR_TAGS object literal in src/engine/decisions.ts, which the module does not export. */
function srcAuthorTags(): Record<string, string> {
  const path = resolve(__dirname, '../../src/engine/decisions.ts');
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest);
  let literal: ts.ObjectLiteralExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'AUTHOR_TAGS' && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      literal = node.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!literal) throw new Error('AUTHOR_TAGS not found in src/engine/decisions.ts');
  const tags: Record<string, string> = {};
  for (const prop of literal.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isStringLiteral(prop.initializer)) throw new Error(`Unexpected AUTHOR_TAGS entry: ${prop.getText(source)}`);
    const name = ts.isStringLiteral(prop.name) || ts.isIdentifier(prop.name) ? prop.name.text : prop.name.getText(source);
    tags[name] = prop.initializer.text;
  }
  return tags;
}

describe('calibration request builders mirror src/engine/decisions.ts', () => {
  it('uses the shipped wording', () => {
    expect(lib.CHOICE_TASK).toBe(CHOICE_TASK);
    expect(lib.CHOICE_TASKS.shipped).toBe(CHOICE_TASK);
    expect(lib.KEEP_CRITERION).toBe(KEEP_CRITERION);
    expect(lib.fillRule(lib.NOUL_TASKS.shipped, 'True crime')).toBe(ruleTask('True crime'));
    expect(lib.fillRule(lib.KEEP_TASKS.shipped, 'True crime')).toBe(keepTask('True crime'));
    expect(lib.keepTask('True crime')).toBe(keepTask('True crime'));
    expect([lib.THUMBNAIL_TASK, lib.THUMBNAIL_KEEP_CRITERION]).toEqual([THUMBNAIL_TASK, THUMBNAIL_KEEP_CRITERION]);
  });

  it.each(['cloudflare/clef-flash', 'typesafe/jev-1.13', 'openai/gpt-6-luna-decisions', 'microsoft/microsoft-decision-1', 'nace-ai/drex-v1.5', 'togethercomputer/m', 'jaredpalmer/kev-4b', '~typesafe/jev-latest'])(
    'pins %s like the shipped providerFor',
    (model) => {
      expect(lib.providerFor(model)).toEqual(providerFor(model));
    },
  );

  it('lists the same AUTHOR_TAGS as src', () => {
    expect(lib.AUTHOR_TAGS).toEqual(srcAuthorTags());
  });

  it('keeps the earlier wording and shapes as variants', () => {
    expect(lib.KEEP_TASKS.plain).toBe(lib.NOUL_TASKS.shipped);
  });

  it.each([
    ['B with Keep rules C', 'B', true],
    ['B without Keep rules', 'B', false],
    ['A without Keep rules', 'A', false],
  ])('builds the shipped choice body for %s', (_name, set, withKeep) => {
    const batch = tiles.slice(0, 16);
    const keep = withKeep ? rules.C.keep : {};
    const src = buildTextRequest([...srcRules(rules[set].remove), ...srcRules(keep)], [], batch.map(toFacts));
    const ours = lib.buildTextRequest(rules[set].remove, batch, { keepRules: keep });
    expect(ours.body).toEqual(src.body);
    expect(JSON.stringify(ours.body)).toBe(JSON.stringify(src.body)); // same key order too
  });

  it('builds the noul fallback body like src', () => {
    const batch = tiles.slice(0, 4);
    const src = buildTextRequest([...srcRules(rules.B.remove), ...srcRules(rules.C.keep)], [], batch.map(toFacts), { framing: 'noul' });
    const ours = lib.buildTextRequest(rules.B.remove, batch, { framing: 'noul', keepRules: rules.C.keep });
    expect(JSON.stringify(ours.body)).toBe(JSON.stringify(src.body));
  });

  it('rejects exactly the responses the shipped validator rejects', () => {
    const batch = tiles.slice(0, 2);
    const remove = { R1: 'a', R2: 'b' };
    const src = buildTextRequest([...srcRules(remove), ...srcRules({ K1: 'k' })], [], batch.map(toFacts));
    const ours = lib.buildTextRequest(remove, batch, { keepRules: { K1: 'k' } });
    const ok = { t01: { choice: 'R1', probabilities: { keep: 0.1, R1: 0.8, R2: 0.1 } }, t01_K1: { noul: 0.2 }, t02: { choice: 'keep', confidence: 0.9 }, t02_K1: { noul: 0.6 } };
    const usage = { input_tokens: 100, cost: 0.00001 };
    const cases: unknown[] = [
      { answers: ok, usage },
      { answers: ok },
      { answers: { ...ok, t01: { choice: 'R9', probabilities: { keep: 0.1, R1: 0.8, R2: 0.1 } } }, usage },
      { answers: { ...ok, t01: { choice: 'R1', probabilities: { keep: 0.1, R1: 0.5, R11: 0.4 } } }, usage },
      { answers: { ...ok, t01: { choice: 'R1', probabilities: { keep: 0.1, R1: 0.5, R2: 0.1 } } }, usage },
      { answers: { ...ok, t01: { choice: 'R1', probabilities: { R1: 0.9, R2: 0.1 } } }, usage },
      { answers: { ...ok, t02: { choice: 'keep' } }, usage },
      { answers: { ...ok, t02_K1: { noul: 1.2 } }, usage },
      { answers: { t01: ok.t01 }, usage },
      null,
    ];
    for (const body of cases) expect(lib.validateAnswers(ours.specs, body) === null).toBe(validateResponse(body, src.questions).ok);
  });

  it('budget guard counts attempts without usage.cost and stops at the cap', () => {
    const b = new lib.Budget(0.001, 4e-8);
    let sent = 0;
    for (let i = 0; i < 100; i++) {
      const est = b.estimate(14_000);
      if (!b.reserve(est)) break;
      sent++;
      b.settle(est, undefined, 14_000, i % 2 ? 5_800 : undefined); // no cost field: tokens x price, else the estimate
    }
    expect(sent).toBeLessThan(10);
    expect(b.spent).toBeLessThanOrEqual(0.001);
    expect(() => new lib.Budget(0.001, Number.NaN)).toThrow(/price/);
  });

  it('builds the shipped thumbnail body', () => {
    const t = tiles.find((x) => x.channel)!;
    const src = buildThumbnailRequest(srcRules(rules.D.remove, { kind: 'thumbnail' }), toFacts(t), 'data:image/jpeg;base64,AAAA');
    const ours = lib.buildThumbnailRequest(rules.D.remove, t, 'data:image/jpeg;base64,AAAA');
    expect(JSON.stringify(ours.body)).toBe(JSON.stringify(src.body));
  });

  it('uses the shipped batch sizes', () => {
    for (const keepRules of [0, 1, 2, 3, 5]) {
      expect(lib.batchSizeFor({ framing: 'choice', removeRules: 10, keepRules })).toBe(textBatchSizeFor('choice', 10, keepRules));
      expect(lib.batchSizeFor({ framing: 'noul', removeRules: 10, keepRules })).toBe(textBatchSizeFor('noul', 10, keepRules));
    }
    expect(() => lib.batchSizeFor({ framing: 'choice', removeRules: 10, keepRules: 2, requested: 32 })).toThrow(/64 questions/);
  });

  it('decodes answers like src/core/verdict.ts', () => {
    const { specs } = lib.buildTextRequest({ R1: 'a', R2: 'b' }, tiles.slice(0, 2), { keepRules: { K1: 'k' } });
    const out = lib.decodeAnswers(specs, 2, {
      t01: { type: 'choice', choice: 'R2', probabilities: { keep: 0.1, R1: 0.3, R2: 0.6 } },
      t01_K1: { type: 'noul', noul: 0.7 },
      t02: { type: 'choice', choice: 'keep', confidence: 0.8 },
    });
    expect(out[0]).toMatchObject({ pRemove: 0.9, ref: 'R2', pKeep: 0.7, keepRef: 'K1' });
    expect(out[1]).toMatchObject({ pRemove: 0.2, ref: null, viaConfidence: true, invalid: 'missing:t02_K1' });
  });
});

describe('calibration dataset', () => {
  it('has at least 500 Tiles with unique ids and no URLs', () => {
    expect(tiles.length).toBeGreaterThanOrEqual(500);
    expect(new Set(tiles.map((t) => t.id)).size).toBe(tiles.length);
    const urlLike = /https?:\/\/|youtube\.com|youtu\.be|watch\?v=/i;
    expect(tiles.filter((t) => urlLike.test(`${t.title} ${t.channel ?? ''}`)).map((t) => t.id)).toEqual([]);
    for (const t of tiles) if (t.isShort) expect(t.channel).toBeNull();
  });

  it('labels every Tile with known refs', () => {
    const ids = new Set(tiles.map((t) => t.id));
    expect(labels.labels.map((l: { id: string }) => l.id).sort()).toEqual([...ids].sort());
    const refsB = new Set(Object.keys(rules.B.remove)), refsA = new Set(Object.keys(rules.A.remove)), refsC = new Set(Object.keys(rules.C.keep));
    expect(Object.keys(rules.E.remove)).toEqual(Object.keys(rules.A.remove));
    for (const l of labels.labels) {
      for (const r of l.removeAll) expect(refsB).toContain(r);
      for (const r of l.A.removeAll) expect(refsA).toContain(r);
      for (const r of l.E.removeAll) expect(refsA).toContain(r);
      for (const r of l.keepAll) expect(refsC).toContain(r);
      if (l.ambiguous) expect(l.remove).toBeNull();
    }
  });
});
