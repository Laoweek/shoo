// A Decision provider reached directly (decision-engine.md §12): one adapter per provider over the same
// request builders. Asserts the address, headers, body (no OpenRouter routing object, the thumbnail where
// the endpoint reads it), the answer unwrapped, no fallback chain, and the local check's error strings.
import { describe, expect, it, vi } from 'vitest';
import { directProvider, type DirectProviderId } from '~/core/providers';
import type { DirectEndpoint } from '~/core/types';
import { buildTextRequest, buildThumbnailRequest, directTarget, FALLBACK_MODELS, sendDecisions, testDirect, validateResponse } from './decisions';
import { LOCAL_REQUEST_TIMEOUT_MS, parseApiError, REQUEST_TIMEOUT_MS } from './net';
import { answerer, rule, scriptedFetch, tile, type Scripted } from './testing';

const ACCOUNT = '0123456789abcdef0123456789abcdef';
const IMAGE = 'data:image/jpeg;base64,/9j/AAAA';

function endpoint(id: DirectProviderId, over: Partial<DirectEndpoint> = {}): DirectEndpoint {
  const p = directProvider(id)!;
  return { provider: id, baseUrl: p.baseUrl.replace('{account}', ACCOUNT), model: p.model || 'clef-flash', ...over };
}

const TEXT = (model: string) => buildTextRequest([rule('R1', 'Reaction videos'), rule('K1', 'Cooking')], [], [tile('aaaaaaaaaaa', 'Reacting to cooking fails')], { model });
const THUMB = (model: string) => buildThumbnailRequest([rule('R4', 'Shocked faces', { kind: 'thumbnail' })], tile('aaaaaaaaaaa', 'Title', { channelName: 'Chan' }), IMAGE, { model });

async function send(e: DirectEndpoint, key: string, pass: 'text' | 'thumbnail', script: (Scripted | ((r: any) => Scripted))[]) {
  const target = directTarget(e)!;
  const { fetch, requests } = scriptedFetch({ [target.url]: script });
  const built = pass === 'text' ? TEXT(e.model) : THUMB(e.model);
  const result = await sendDecisions({ fetch, sleep: vi.fn(async () => {}), now: () => 0 }, key, built.body, pass, pass === 'text' ? FALLBACK_MODELS.text : FALLBACK_MODELS.image, target);
  return { result, requests, built, target };
}

describe('direct endpoints: address, headers and body', () => {
  it.each([
    ['cloudflare', `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/@cf/cloudflare/clef-flash`, 'clef-flash'],
    ['typesafe', 'https://api.typesafe.ai/v1/systemone', 'jev-1.13.0'],
    ['perplexity', 'https://api.perplexity.ai/v1/decisions', 'pplx-decider-v1.1-27b'],
  ] as const)('%s: POSTs the text pass to its own address with Bearer, no provider object, the plain model ID', async (id, url, model) => {
    const { requests, result } = await send(endpoint(id), 'sk-direct', 'text', [answerer({})]);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe(url);
    expect(requests[0]!.init!.headers).toEqual({ Authorization: 'Bearer sk-direct', 'Content-Type': 'application/json' });
    expect(requests[0]!.init!.credentials).toBe('omit');
    expect(requests[0]!.init!.redirect).toBe('error');
    expect(Object.keys(requests[0]!.body).sort()).toEqual(['model', 'questions', 'state']);
    expect(requests[0]!.body.model).toBe(model);
    expect(result).toMatchObject({ ok: true, model, fallback: false, requests: 1 });
  });

  it.each(['ollama', 'llamacpp', 'lmstudio'] as const)('%s: no Authorization header with an empty key, and the longer local timeout', async (id) => {
    const { requests, target } = await send(endpoint(id), '', 'text', [answerer({})]);
    expect(requests[0]!.url).toBe(`${directProvider(id)!.baseUrl}/systemone`);
    expect(requests[0]!.init!.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(target.timeoutMs).toBe(LOCAL_REQUEST_TIMEOUT_MS);
  });

  it('cloud endpoints keep the 8 s timeout', () => {
    expect(directTarget(endpoint('cloudflare'))!.timeoutMs).toBe(REQUEST_TIMEOUT_MS);
    expect(directTarget(endpoint('perplexity'))!.timeoutMs).toBe(REQUEST_TIMEOUT_MS);
  });

  it('keeps the questions exactly as the OpenRouter builder made them', async () => {
    const { requests, built } = await send(endpoint('typesafe'), 'k', 'text', [answerer({})]);
    expect(requests[0]!.body.questions).toEqual(built.body.questions);
    expect(requests[0]!.body.state).toEqual(built.body.state);
  });

  it.each([
    // Perplexity reads OpenRouter's format: the image stays an item of the state array.
    ['perplexity', { state: ['Title: Title', 'Channel: Chan', { type: 'image_url', image_url: { url: IMAGE } }] }],
    // Cloudflare, llama.cpp and LM Studio: a top-level images array of data URLs.
    ['cloudflare', { state: ['Title: Title', 'Channel: Chan'], images: [IMAGE] }],
    ['llamacpp', { state: ['Title: Title', 'Channel: Chan'], images: [IMAGE] }],
    ['lmstudio', { state: ['Title: Title', 'Channel: Chan'], images: [IMAGE] }],
    // Ollama: raw base64, it refuses data URLs.
    ['ollama', { state: ['Title: Title', 'Channel: Chan'], images: ['/9j/AAAA'] }],
  ] as const)('%s: puts the thumbnail where the endpoint reads it', async (id, expected) => {
    const { requests } = await send(endpoint(id, { model: 'clef-flash' }), 'k', 'thumbnail', [answerer({})]);
    expect(requests[0]!.body).toMatchObject(expected);
    expect(requests[0]!.body.provider).toBeUndefined();
  });

  it("unwraps Cloudflare's { result, success } envelope", async () => {
    const wrap = (r: any): Scripted => {
      const inner = answerer({})(r);
      return { status: 200, body: { result: inner.body, success: true, errors: [], messages: [] } };
    };
    const { result, built } = await send(endpoint('cloudflare'), 'k', 'text', [wrap]);
    expect(result.ok).toBe(true);
    expect(result.ok && validateResponse(result.json, built.questions).ok).toBe(true);
  });
});

describe('direct endpoints: no OpenRouter fallback chain', () => {
  it.each([
    ['503', { status: 503 }],
    ['404 (model not there)', { status: 404, body: { error: 'model "clef-flash" not found' } }],
    ['network error', { status: 0, throws: true }],
  ] as [string, Scripted][])('%s fails once, counts one model failure and never tries the fallback model', async (_n, first) => {
    const { result, requests } = await send(endpoint('typesafe'), 'k', 'text', [first]);
    expect(requests).toHaveLength(1);
    expect(result).toMatchObject({ ok: false, reason: 'modelError', countsAsFailure: true, requests: 1 });
  });

  it('401 and 403 report the key (or Ollama origin) as refused, without counting a failure', async () => {
    for (const status of [401, 403]) {
      const { result } = await send(endpoint('ollama'), '', 'text', [{ status }]);
      expect(result).toMatchObject({ ok: false, reason: 'keyRejected', countsAsFailure: false, status });
    }
  });

  it('a 403 that reads like a region block is still a refusal off OpenRouter, never a counted failure', async () => {
    const { result } = await send(endpoint('perplexity'), 'k', 'text', [{ status: 403, body: { error: { message: 'This model is not available in your region.', code: 403 } } }]);
    expect(result).toMatchObject({ ok: false, reason: 'keyRejected', countsAsFailure: false });
  });

  it("reads Cloudflare's errors array for the log", () => {
    const body = { errors: [{ message: 'AiError: too many questions', code: 5012 }], success: false, result: null };
    expect(parseApiError(422, body)).toMatchObject({ status: 422, code: 5012, message: 'AiError: too many questions' });
  });
});

describe('testDirect (local check before consent)', () => {
  const run = async (script: (Scripted | ((r: any) => Scripted))[]) => {
    const e = endpoint('ollama');
    const { fetch, requests } = scriptedFetch({ [directTarget(e)!.url]: script });
    let t = 0;
    const result = await testDirect({ fetch, sleep: async () => {}, now: () => (t += 5) }, e, '');
    return { result, requests };
  };

  it('asks one synthetic title against one synthetic Rule and passes on a valid answer', async () => {
    const { result, requests } = await run([answerer({})]);
    expect(result).toEqual({ ok: true, latencyMs: 5 });
    expect(requests).toHaveLength(1);
    expect(JSON.stringify(requests[0]!.body)).toContain('How sourdough fermentation works');
    expect(requests[0]!.init!.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it.each([
    ['network', { status: 0, throws: true }],
    ['keyRejected', { status: 403 }],
    ['http404', { status: 404 }],
    ['http500', { status: 500 }],
  ] as [string, Scripted][])('reports %s', async (error, answer) => {
    expect((await run([answer])).result).toEqual({ ok: false, error });
  });

  it('reports an answer of the wrong shape by its problem', async () => {
    expect((await run([{ status: 200, body: { answers: {}, usage: { input_tokens: 1 } } }])).result).toEqual({ ok: false, error: 'missingAnswer:t01' });
  });
});
