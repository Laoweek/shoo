import { describe, expect, it } from 'vitest';
import { MAX_QUESTIONS_PER_REQUEST } from '~/core/budget';
import {
  buildKeepOnlyRequest,
  buildTextRequest,
  buildThumbnailRequest,
  CHOICE_TASK,
  classifyResponse,
  deriveTextResults,
  deriveThumbResult,
  FALLBACK_MODELS,
  formatDuration,
  KEEP_CRITERION,
  providerFor,
  shapeSummary,
  textBatchSizeFor,
  validateResponse,
  type BuiltRequest,
} from './decisions';
import { parseApiError } from './net';
import { exception, fixture, privateDataIn, rule, tile, tilesFromFixture } from './testing';

// The Rules and Exception behind the request text-choice-16.json, recorded in the Decisions API smoke test.
const R1 = rule('R1', 'Reaction videos, where someone watches and reacts to other content');
const R2 = rule('R2', 'Crypto, day trading, or get-rich-quick finance');
const R3 = rule('R3', 'Celebrity gossip and drama');
const K2 = rule('K2', 'Programming tutorials');
const K5 = rule('K5', 'Woodworking and furniture making');
const EXC = exception('excvideo001', 'Vocal coach reacts to classic rock songs', 'Vocal Coach Ana', 5);
const RULES = [R1, R2, R3, K2, K5];
const RECORDED_CHOICE_TASK =
  'Which rule in viewer_does_not_want does this recommended YouTube video match? Choose keep if it matches none. Videos similar to viewer_kept_anyway should be kept.';
const RECORDED_KEEP_CRITERION = 'Matches none of the rules';
const T16 = tilesFromFixture(fixture('text-choice-16')).map((t, i) => ({ ...t, channelId: `UCchan${i}`, channelHandle: `@handle${i}` }));
const FORBIDDEN = [...T16.flatMap((t) => [t.videoId, t.channelId!, t.channelHandle!]), EXC.videoId];

const built: BuiltRequest[] = [];
const track = (b: BuiltRequest) => (built.push(b), b);

describe('buildTextRequest', () => {
  it('reproduces the recorded smoke-test request (16 Tiles, 3 Topic rules, 2 Topic Keep rules, 1 Exception)', () => {
    const b = track(buildTextRequest(RULES, [EXC], T16));
    // The smoke test recorded request shape 1. Shape 2 changed only the choice task and the keep criterion wording.
    const recorded = JSON.stringify(fixture('text-choice-16').request.body)
      .replaceAll(JSON.stringify(RECORDED_CHOICE_TASK), JSON.stringify(CHOICE_TASK))
      .replaceAll(JSON.stringify(RECORDED_KEEP_CRITERION), JSON.stringify(KEEP_CRITERION));
    expect(b.body).toEqual(JSON.parse(recorded));
    expect(Object.keys(b.body.questions)).toHaveLength(48);
    expect(b.questions.get('t01_K2')).toEqual({ kind: 'keep', tile: 0, ref: 'K2' });
    expect(b.tiles[15]!.videoId).toBe(T16[15]!.videoId);
  });

  it('matches the snapshot for 0, 1 and 16 Tiles, with and without Topic Keep rules and Exceptions', () => {
    expect(track(buildTextRequest(RULES, [EXC], [])).body).toMatchSnapshot('0 tiles');
    expect(track(buildTextRequest([R1, R2], [], T16.slice(0, 1))).body).toMatchSnapshot('1 tile, no keep, no exceptions');
    expect(track(buildTextRequest([R1, R2, K2], [EXC], T16.slice(0, 1))).body).toMatchSnapshot('1 tile, keep and exception');
    expect(track(buildTextRequest([R1, R2, R3], [], T16)).body).toMatchSnapshot('16 tiles, no keep, no exceptions');
  });

  it("names a Bilibili Tile's Site in its tasks and Surface, and leaves YouTube's calibrated words alone", () => {
    const bili = tile('BV1FIXTURE01', 'Fixture title', { surface: 'bilibiliHome', channelName: 'Up', durationSec: 69 });
    const b = buildTextRequest([R1, K2], [], [T16[0]!, bili]);
    const q = b.body.questions as Record<string, any>;
    expect(q.t01.instructions.task).toBe(CHOICE_TASK);
    expect(q.t02.instructions.task).toBe(CHOICE_TASK.replace('recommended YouTube video', 'recommended Bilibili video'));
    expect(q.t02_K2.instructions.task).toMatch(/^Does this recommended Bilibili video match this rule: /);
    expect(q.t02.instructions.video).toEqual({ title: 'Fixture title', channel: 'Up', duration: '1:09', surface: 'home page' });
  });

  it('gives Tiles with an exact remove pending only their Keep questions', () => {
    const b = track(buildTextRequest(RULES, [EXC], T16.slice(0, 3), { keepOnly: new Set([T16[1]!.videoId]) }));
    expect(Object.keys(b.body.questions)).toEqual(['t01', 't01_K2', 't01_K5', 't02_K2', 't02_K5', 't03', 't03_K2', 't03_K5']);
    expect(b.keepOnly).toEqual([false, true, false]);
    expect(b.body).toMatchSnapshot();
  });

  it('builds the noul framing variant with the Rule text inline', () => {
    const b = track(buildTextRequest(RULES, [EXC], T16.slice(0, 2), { framing: 'noul' }));
    expect(Object.keys(b.body.questions)).toEqual(['t01_R1', 't01_R2', 't01_R3', 't01_K2', 't01_K5', 't02_R1', 't02_R2', 't02_R3', 't02_K2', 't02_K5']);
    expect(b.body.questions.t01_R2).toEqual({
      type: 'noul',
      instructions: { task: 'Does this recommended YouTube video match this rule: Crypto, day trading, or get-rich-quick finance?', video: expect.any(Object) },
    });
    expect(b.body).toMatchSnapshot();
  });

  it('sends only Topic Keep questions and no remove state when there are no remove Topic rules', () => {
    const b = track(buildTextRequest([K2, rule('R9', 'kw', { kind: 'keyword' })], [EXC], T16.slice(0, 2)));
    expect(b.body.state).toEqual({ viewer_always_wants: { K2: 'Programming tutorials' } });
    expect(Object.keys(b.body.questions)).toEqual(['t01_K2', 't02_K2']);
  });

  it('ignores disabled, deleted, Exact and Thumbnail rules', () => {
    const b = track(
      buildTextRequest(
        [R1, rule('R4', 'off', { enabled: false }), rule('R5', 'gone', { deletedAt: 3 }), rule('R6', 'kw', { kind: 'keyword' }), rule('R7', 'thumb', { kind: 'thumbnail' })],
        [],
        T16.slice(0, 1),
      ),
    );
    expect(b.body.state).toEqual({ viewer_does_not_want: { R1: R1.text } });
  });

  it('uses the truncated Rule text from the state budget in the criteria too', () => {
    const long = rule('R4', 'x'.repeat(8000));
    const b = track(buildTextRequest([R1, long], [], T16.slice(0, 1)));
    expect(b.fit!.truncatedRefs).toEqual(['R4']);
    const choice = b.body.questions.t01 as { criteria: Record<string, string> };
    expect(choice.criteria.R4).toHaveLength(160);
    expect(long.text).toHaveLength(8000);
  });
});

describe('buildKeepOnlyRequest', () => {
  it('matches the recorded keep-only request shape', () => {
    const rec = fixture('keep-only');
    const byTitle = new Map(T16.map((t) => [t.title, t]));
    const tiles = [...new Set(Object.values<any>(rec.request.body.questions).map((q) => q.instructions.video.title as string))].map((title) => byTitle.get(title)!);
    const b = track(buildKeepOnlyRequest([R1, K2, K5], tiles));
    expect(b.body.state).toEqual(rec.request.body.state);
    expect(b.body.provider).toEqual(rec.request.body.provider);
    // The smoke test used the Tiles' positions in the 16-Tile batch, a request built here numbers its own Tiles.
    expect(Object.values(b.body.questions)).toEqual(Object.values(rec.request.body.questions));
    expect(b.body).toMatchSnapshot();
  });
});

describe('buildThumbnailRequest', () => {
  it('puts title, channel and the image in state and one noul per Thumbnail rule', () => {
    const rec = fixture('thumbnail');
    const thumbs = [
      rule('R4', 'Shocked faces, red arrows or circled objects', { kind: 'thumbnail' }),
      rule('R7', 'A person pointing at the camera', { kind: 'thumbnail' }),
      rule('R8', 'A man singing or dancing', { kind: 'thumbnail' }),
    ];
    const t = tile('thumbvid001', '80s pop singer performs his biggest hit live', { channelName: 'Retro Music Vault', channelId: 'UCretro' });
    const b = track(buildThumbnailRequest([...thumbs, R1], t, 'data:image/jpeg;base64,AAAA'));
    expect(b.body.questions).toEqual(rec.request.body.questions);
    expect(b.body.state).toEqual([...rec.request.body.state.slice(0, 2), { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } }]);
    // Every request carries data_collection: 'deny', as in the §4 example.
    expect(b.body.provider).toEqual({ ...rec.request.body.provider, data_collection: 'deny' });
    expect(b.body).toMatchSnapshot();
  });
});

describe('every built request', () => {
  it('pins one provider with allow_fallbacks false and never carries a video id, channel id, handle or URL', () => {
    expect(built.length).toBeGreaterThan(8);
    for (const b of built) expect(b.body.provider).toEqual({ order: ['cloudflare'], allow_fallbacks: false, data_collection: 'deny' });
    expect(privateDataIn(built.map((b) => b.body), [...FORBIDDEN, 'thumbvid001', 'UCretro'])).toEqual([]);
  });
});

describe('providerFor and fallback pins', () => {
  it('pins each fallback model to its own lowercase provider tag', () => {
    expect(providerFor(FALLBACK_MODELS.text)).toEqual({ order: ['typesafe'], allow_fallbacks: false, data_collection: 'deny' });
    expect(providerFor(FALLBACK_MODELS.image)).toEqual({ order: ['openai'], allow_fallbacks: false, data_collection: 'deny' });
    expect(providerFor('perplexity/pplx-decider-v1.1-27b').order).toEqual(['perplexity']);
  });
});

describe('textBatchSizeFor', () => {
  it('follows min(16, floor(64 / (1 + topicKeepRules))) and never exceeds 64 questions', () => {
    expect(textBatchSizeFor('choice', 3, 0)).toBe(16);
    expect(textBatchSizeFor('choice', 3, 3)).toBe(16);
    expect(textBatchSizeFor('choice', 3, 5)).toBe(10);
    for (let k = 0; k <= 63; k++) expect(textBatchSizeFor('choice', 3, k) * (1 + k)).toBeLessThanOrEqual(MAX_QUESTIONS_PER_REQUEST);
    expect(textBatchSizeFor('noul', 5, 1)).toBe(10);
  });

  it('formats durations as YouTube shows them', () => {
    expect(formatDuration(1122)).toBe('18:42');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3725)).toBe('1:02:05');
  });
});

describe('validateResponse', () => {
  const text = () => buildTextRequest(RULES, [EXC], T16);

  it('accepts the recorded text, keep-only, thumbnail and Perplexity (full-precision) responses', () => {
    expect(validateResponse(fixture('text-choice-16').response.body, text().questions).ok).toBe(true);
    const keep = fixture('keep-only');
    const keepQs = new Map(Object.keys(keep.request.body.questions).map((id) => [id, { kind: 'keep' as const, tile: 0, ref: id.slice(4) }]));
    expect(validateResponse(keep.response.body, keepQs).ok).toBe(true);
    const thumb = fixture('thumbnail');
    const thumbQs = new Map(['R4', 'R7', 'R8'].map((r) => [r, { kind: 'thumb' as const, tile: 0, ref: r }]));
    expect(validateResponse(thumb.response.body, thumbQs).ok).toBe(true);
    const pplx = fixture('fallback-perplexity-text');
    const qs = new Map(
      Object.entries<any>(pplx.request.body.questions).map(([id, q]) => [
        id,
        q.type === 'choice' ? { kind: 'choice' as const, tile: 0, options: Object.keys(q.criteria) } : { kind: 'keep' as const, tile: 0, ref: 'K' },
      ]),
    );
    expect(validateResponse(pplx.response.body, qs).ok).toBe(true);
  });

  const mutate = (fn: (body: any) => void) => {
    const body = fixture('text-choice-16').response.body;
    fn(body);
    return validateResponse(body, text().questions);
  };

  it('rejects a missing answer, a choice outside the options, bad probability sums, malformed nouls and missing usage', () => {
    expect(mutate((b) => delete b.answers.t07)).toMatchObject({ ok: false, problem: 'missingAnswer:t07' });
    expect(mutate((b) => (b.answers.t01.choice = 'R9'))).toMatchObject({ ok: false, problem: 'choiceNotOption:t01' });
    expect(mutate((b) => (b.answers.t01.probabilities.keep = 0.5))).toMatchObject({ ok: false, problem: 'probabilitiesSum:t01' });
    expect(mutate((b) => {
      b.answers.t01.probabilities.R9 = b.answers.t01.probabilities.R1;
      delete b.answers.t01.probabilities.R1;
    })).toMatchObject({ ok: false, problem: 'probabilitiesKeys:t01' });
    expect(mutate((b) => (b.answers.t01_K2.noul = 1.2))).toMatchObject({ ok: false, problem: 'noulRange:t01_K2' });
    expect(mutate((b) => (b.answers.t01_K2.noul = '0.4'))).toMatchObject({ ok: false, problem: 'noulRange:t01_K2' });
    expect(mutate((b) => delete b.usage.input_tokens)).toMatchObject({ ok: false, problem: 'usageMissing' });
    expect(mutate((b) => (b.answers = []))).toMatchObject({ ok: false, problem: 'answersMissing' });
    expect(mutate((b) => {
      delete b.answers.t02.probabilities;
      delete b.answers.t02.confidence;
    })).toMatchObject({ ok: false, problem: 'choiceUnusable:t02' });
  });

  it('accepts extra answers, a missing probabilities object with confidence, sums within 0.02 and non-zero output_tokens', () => {
    expect(mutate((b) => (b.answers.t99 = { type: 'noul', noul: 2 })).ok).toBe(true);
    expect(mutate((b) => delete b.answers.t02.probabilities).ok).toBe(true);
    expect(mutate((b) => (b.answers.t01.probabilities.keep += 0.015)).ok).toBe(true);
    expect(mutate((b) => (b.usage.output_tokens = 48)).ok).toBe(true);
  });

  it('summarizes a changed shape with keys only, no content', () => {
    const r = mutate((b) => (b.answers.t01 = { verdict: 'remove', title: 'Reacting to the WORST cooking fails of 2026' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.shape).toContain('t01:{verdict,title}');
    expect(r.shape).not.toContain('Reacting');
    expect(shapeSummary({ a: [1, 2], b: 'secret' })).toBe('{a:[2],b}');
  });
});

describe('derivation', () => {
  it('derives P(remove), the argmax ref and the Topic Keep match from the recorded response', () => {
    const b = buildTextRequest(RULES, [EXC], T16);
    const res = fixture('text-choice-16').response.body;
    const out = deriveTextResults(b, res.answers, 'cloudflare/clef-flash');
    const t01 = out.get(T16[0]!.videoId)!;
    expect(t01.ref).toBe('R1');
    expect(t01.pRemove).toBeCloseTo(1 - res.answers.t01.probabilities.keep, 10);
    expect(t01.pKeep).toBe(Math.max(res.answers.t01_K2.noul, res.answers.t01_K5.noul));
    const rust = out.get(T16[4]!.videoId)!; // "Rust ownership in 10 minutes"
    expect(rust.keepRef).toBe('K2');
    expect(rust.pKeep).toBeGreaterThanOrEqual(0.5);
    expect(rust.model).toBe('cloudflare/clef-flash');
  });

  it('marks keep-only results and derives the thumbnail p and ref', () => {
    const b = buildKeepOnlyRequest([K2, K5], T16.slice(4, 5));
    const r = deriveTextResults(b, { t01_K2: { noul: 0.96 }, t01_K5: { noul: 0.01 } }, 'm').get(T16[4]!.videoId)!;
    expect(r).toEqual({ pRemove: 0, pKeep: 0.96, keepRef: 'K2', keepOnly: true, model: 'm' });

    const rec = fixture('thumbnail');
    const thumbs = ['R4', 'R7', 'R8'].map((ref) => rule(ref, ref, { kind: 'thumbnail' }));
    const tb = buildThumbnailRequest(thumbs, tile('thumbvid001', 't'), 'data:image/jpeg;base64,AA');
    expect(deriveThumbResult(tb, rec.response.body.answers, 'cloudflare/clef-flash')).toEqual({ p: 0.9431, ref: 'R8', model: 'cloudflare/clef-flash' });
  });
});

describe('classifyResponse on recorded and hand-written error bodies', () => {
  const classify = (name: string, pass: 'text' | 'thumbnail' = 'text', waitMs?: number) => {
    const f = fixture(name);
    return classifyResponse(f.response.status, parseApiError(f.response.status, f.response.body), waitMs, pass, f.request.body?.model ?? 'cloudflare/clef-flash');
  };

  it('maps each status to the §5.3 action', () => {
    expect(classify('error-400-unknown-model')).toEqual({ kind: 'fallback', reason: 'modelError' });
    expect(classify('error-400-bad-shape')).toEqual({ kind: 'fail', reason: 'apiShapeChanged', countsAsFailure: true });
    expect(classify('error-401')).toEqual({ kind: 'fail', reason: 'keyRejected', countsAsFailure: false });
    expect(classify('fallback-jev-text-403-region')).toEqual({ kind: 'fallback', reason: 'modelError' });
    expect(classify('fallback-luna-thumbnail-403-region', 'thumbnail')).toEqual({ kind: 'fallback', reason: 'modelError' });
    expect(classify('error-404-pinned-provider-mismatch')).toEqual({ kind: 'fallback', reason: 'modelError' });
    expect(classify('error-422-too-many-questions')).toEqual({ kind: 'fail', reason: 'modelError', countsAsFailure: true });
    expect(classify('error-422-image-too-large', 'thumbnail')).toMatchObject({ kind: 'fail', keepTile: true, countsAsFailure: false });
    expect(classify('error-402-credits')).toEqual({ kind: 'fail', reason: 'creditsExhausted', countsAsFailure: false });
    expect(classify('error-402-key-limit')).toEqual({ kind: 'fail', reason: 'creditsExhausted', countsAsFailure: false });
    expect(classify('error-402-in-flight', 'text', 2000)).toMatchObject({ kind: 'retrySame', waitMs: 2000 });
    expect(classify('error-413')).toMatchObject({ kind: 'fail', split: true, countsAsFailure: false });
    expect(classify('error-413', 'thumbnail')).toMatchObject({ kind: 'fail', keepTile: true });
    expect(classify('error-429', 'text', 1000)).toMatchObject({ kind: 'retrySame', waitMs: 1000 });
    expect(classify('error-429', 'text', 6000)).toEqual({ kind: 'fallback', reason: 'rateLimited' });
    expect(classifyResponse(403, { status: 403, message: 'Forbidden' }, undefined, 'text', 'm')).toMatchObject({ kind: 'fail', reason: 'keyRejected' });
    expect(classifyResponse(503, undefined, undefined, 'text', 'm')).toEqual({ kind: 'fallback', reason: 'modelError' });
    expect(classifyResponse(0, undefined, undefined, 'text', 'm')).toEqual({ kind: 'fallback', reason: 'modelError' });
  });

  it('keeps only paths from a schema error and drops user_id', () => {
    const f = fixture('error-400-bad-shape');
    const e = parseApiError(400, f.response.body);
    expect(e.schemaPaths).toEqual(['questions.t01.criteria']);
    expect(JSON.stringify(e)).not.toContain('user_id');
    expect(JSON.stringify(parseApiError(404, fixture('error-404-pinned-provider-mismatch').response.body))).not.toContain('REDACTED');
  });
});
