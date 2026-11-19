// Network policy and fallback chain (decision-engine.md §5.2, §5.3): a scripted fake fetch per error class,
// asserting the exact request sequence, the provider pin on each fallback request and the result.
import { describe, expect, it, vi } from 'vitest';
import { buildTextRequest, buildThumbnailRequest, DECISIONS_URL, FALLBACK_MODELS, sendDecisions, type EngineLog, type Pass } from './decisions';
import { fixture, fromFixture, rule, scriptedFetch, tile, type Scripted } from './testing';

const TEXT = buildTextRequest([rule('R1', 'Reaction videos')], [], [tile('aaaaaaaaaaa', 'Reacting to cooking fails')]).body;
const THUMB = buildThumbnailRequest([rule('R4', 'Shocked faces', { kind: 'thumbnail' })], tile('aaaaaaaaaaa', 'x'), 'data:image/jpeg;base64,AA').body;
const OK: Scripted = { status: 200, body: { answers: {}, usage: { input_tokens: 1 } } };
const status = (s: number, headers: Record<string, string> = {}): Scripted => ({ status: s, body: { error: { message: 'x', code: s } }, headers: { 'content-type': 'application/json', ...headers } });

async function run(script: Scripted[], pass: Pass = 'text', opts: { timeoutMs?: number; fetch?: typeof fetch } = {}) {
  const { fetch, requests } = scriptedFetch({ [DECISIONS_URL]: script });
  const sleep = vi.fn(async () => {});
  const logs: EngineLog[] = [];
  const result = await sendDecisions(
    { fetch: opts.fetch ?? fetch, sleep, now: () => 0, timeoutMs: opts.timeoutMs, log: (e) => logs.push(e) },
    'sk-test',
    pass === 'text' ? TEXT : THUMB,
    pass,
    pass === 'text' ? FALLBACK_MODELS.text : FALLBACK_MODELS.image,
  );
  const sent = requests.map((r) => ({ model: r.body.model, order: r.body.provider.order, allow: r.body.provider.allow_fallbacks, dc: r.body.provider.data_collection }));
  return { result, sent, sleep, logs, requests };
}

const primary = { model: 'cloudflare/clef-flash', order: ['cloudflare'], allow: false, dc: 'deny' };
const textFallback = { model: 'typesafe/jev-1.13', order: ['typesafe'], allow: false, dc: 'deny' };
const imageFallback = { model: 'openai/gpt-6-luna-decisions', order: ['openai'], allow: false, dc: 'deny' };

describe('sendDecisions fallback chain', () => {
  it('sends only Authorization, Content-Type and X-OpenRouter-Title, without cookies', async () => {
    const { requests } = await run([OK]);
    expect(requests[0]!.init!.headers).toEqual({ Authorization: 'Bearer sk-test', 'Content-Type': 'application/json', 'X-OpenRouter-Title': 'Shoo' });
    expect(requests[0]!.init!.credentials).toBe('omit');
    expect(requests[0]!.init!.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ['5xx', status(502)],
    ['408', status(408)],
    ['network error', { status: 0, throws: true }],
    ['400 naming the model', fromFixture(fixture('error-400-unknown-model'))],
    ['403 region block', fromFixture(fixture('fallback-jev-text-403-region'))],
    ['404 no endpoints', fromFixture(fixture('error-404-pinned-provider-mismatch'))],
    ['429 without Retry-After', status(429)],
    ['429 with Retry-After over 5 s', status(429, { 'retry-after': '30' })],
  ] as [string, Scripted][])('%s falls back once to the pinned fallback model', async (_name, first) => {
    const { result, sent, sleep } = await run([first, OK]);
    expect(sent).toEqual([primary, textFallback]);
    expect(result).toMatchObject({ ok: true, model: FALLBACK_MODELS.text, fallback: true, requests: 2 });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('times out after the configured limit with an AbortController and falls back', async () => {
    let calls = 0;
    const hanging = ((_url: string, init?: RequestInit) => {
      calls++;
      if (calls === 2) return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
      return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    }) as typeof fetch;
    const { result } = await run([], 'text', { timeoutMs: 5, fetch: hanging });
    expect(calls).toBe(2);
    expect(result).toMatchObject({ ok: true, model: FALLBACK_MODELS.text });
  });

  it('times out a response whose body never finishes and falls back', async () => {
    let calls = 0;
    const stalled = (async () => {
      calls++;
      if (calls === 2) return new Response(JSON.stringify({}), { status: 200 });
      return new Response(new ReadableStream({ start: () => {} }), { status: 200 });
    }) as typeof fetch;
    const { result } = await run([], 'text', { timeoutMs: 5, fetch: stalled });
    expect(calls).toBe(2);
    expect(result).toMatchObject({ ok: true, model: FALLBACK_MODELS.text });
  });

  it('reads Retry-After as an HTTP date', async () => {
    const { fetch } = scriptedFetch({ [DECISIONS_URL]: [status(429, { 'retry-after': new Date(3000).toUTCString() }), OK] });
    const sleep = vi.fn(async () => {});
    await sendDecisions({ fetch, sleep, now: () => 1000 }, 'k', TEXT, 'text', FALLBACK_MODELS.text);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('counts one model failure when the fallback is region-blocked too (recorded from an unsupported country)', async () => {
    const { result, sent } = await run([status(503), fromFixture(fixture('fallback-jev-text-403-region'))]);
    expect(sent).toEqual([primary, textFallback]);
    expect(result).toEqual({ ok: false, reason: 'modelError', countsAsFailure: true, requests: 2, status: 403 });
  });

  it('never reports a region block as a rejected key, on either model', async () => {
    const { result } = await run([fromFixture(fixture('fallback-jev-text-403-region')), fromFixture(fixture('fallback-jev-text-403-region'))]);
    expect(result).toMatchObject({ ok: false, reason: 'modelError', countsAsFailure: true });
  });

  it('429 with Retry-After ≤ 5 s waits and retries the same model once', async () => {
    const { result, sent, sleep } = await run([fromFixture(fixture('error-429')), OK]);
    expect(sent).toEqual([primary, primary]);
    expect(sleep).toHaveBeenCalledWith(1000);
    expect(result).toMatchObject({ ok: true, model: 'cloudflare/clef-flash', fallback: false, requests: 2 });
  });

  it('429 again after the retry falls back, and a rate-limited fallback ends as rateLimited', async () => {
    const r429 = fromFixture(fixture('error-429'));
    const { result, sent, sleep } = await run([r429, r429, status(429)]);
    expect(sent).toEqual([primary, primary, textFallback]);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: false, reason: 'rateLimited', countsAsFailure: true, requests: 3, status: 429 });
  });

  it('402 in-flight budget waits Retry-After and retries the same model once, then fails without fallback', async () => {
    const inflight = fromFixture(fixture('error-402-in-flight'));
    const ok = await run([inflight, OK]);
    expect(ok.sent).toEqual([primary, primary]);
    expect(ok.sleep).toHaveBeenCalledWith(2000);
    expect(ok.result).toMatchObject({ ok: true });
    const twice = await run([inflight, inflight]);
    expect(twice.sent).toEqual([primary, primary]);
    expect(twice.result).toEqual({ ok: false, reason: 'rateLimited', countsAsFailure: true, requests: 2, status: 402 });
  });

  it.each([
    ['400 schema error', fromFixture(fixture('error-400-bad-shape')), { reason: 'apiShapeChanged', countsAsFailure: true }],
    ['401', fromFixture(fixture('error-401')), { reason: 'keyRejected', countsAsFailure: false }],
    ['403 other', status(403), { reason: 'keyRejected', countsAsFailure: false }],
    ['402 credits', fromFixture(fixture('error-402-credits')), { reason: 'creditsExhausted', countsAsFailure: false }],
    ['402 key limit', fromFixture(fixture('error-402-key-limit')), { reason: 'creditsExhausted', countsAsFailure: false }],
    ['422 too many questions', fromFixture(fixture('error-422-too-many-questions')), { reason: 'modelError', countsAsFailure: true }],
    ['413 (text: split the batch)', fromFixture(fixture('error-413')), { reason: 'modelError', countsAsFailure: false, split: true }],
  ] as [string, Scripted, object][])('%s on a text request: no fallback', async (_name, first, expected) => {
    const { result, sent } = await run([first]);
    expect(sent).toEqual([primary]);
    expect(result).toEqual({ ok: false, requests: 1, status: first.status, ...expected });
  });

  it.each([
    ['413', fromFixture(fixture('error-413'))],
    ['422 image too large', fromFixture(fixture('error-422-image-too-large'))],
  ] as [string, Scripted][])('%s on a thumbnail request keeps the Tile without fallback', async (_name, first) => {
    const { result, sent } = await run([first], 'thumbnail');
    expect(sent).toEqual([primary]);
    expect(result).toEqual({ ok: false, reason: 'modelError', countsAsFailure: false, keepTile: true, requests: 1, status: first.status });
  });

  it('thumbnail falls back to the image-capable model pinned to openai', async () => {
    const { result, sent } = await run([status(500), fromFixture(fixture('fallback-luna-thumbnail-403-region'))], 'thumbnail');
    expect(sent).toEqual([primary, imageFallback]);
    expect(result).toMatchObject({ ok: false, reason: 'modelError', countsAsFailure: true });
  });

  it('does not fall back to the same model', async () => {
    const { fetch, requests } = scriptedFetch({ [DECISIONS_URL]: [status(500)] });
    const r = await sendDecisions({ fetch, sleep: async () => {}, now: () => 0 }, 'k', { ...TEXT, model: FALLBACK_MODELS.text }, 'text', FALLBACK_MODELS.text);
    expect(requests).toHaveLength(1);
    expect(r).toMatchObject({ ok: false, countsAsFailure: true });
  });

  it('logs status, code and a trimmed message, never the error body or user_id', async () => {
    const { logs } = await run([fromFixture(fixture('error-404-pinned-provider-mismatch')), fromFixture(fixture('error-400-bad-shape'))]);
    expect(logs).toEqual([
      { event: 'decisionsError', model: 'cloudflare/clef-flash', status: 404, code: 404, message: 'No endpoints found for cloudflare/clef-flash.' },
      { event: 'decisionsError', model: FALLBACK_MODELS.text, status: 400, code: 400, schemaPaths: ['questions.t01.criteria'] },
    ]);
    expect(JSON.stringify(logs)).not.toMatch(/user_id|REDACTED|sk-test/);
  });
});
