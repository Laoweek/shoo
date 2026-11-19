import { describe, expect, it } from 'vitest';
import { checkKey, createKeyUsage, KEY_URL } from './key';
import { createModelCatalog, MODELS_TTL_MS, MODELS_URL, parseModels, type ModelsCache } from './models';
import { scriptedFetch, type Scripted } from './testing';

const CATALOG = {
  data: [
    { id: 'cloudflare/clef-flash', architecture: { input_modalities: ['text', 'image'], modality: 'text+image->decisions' }, pricing: { prompt: '0.00000009' } },
    { id: 'liquid/d1', architecture: { input_modalities: ['text'] }, pricing: { prompt: '0.00000004' } },
    { id: 42 },
  ],
};

describe('model catalogue', () => {
  it('reads image capability from architecture.input_modalities and price from pricing.prompt', () => {
    expect(parseModels(CATALOG)).toEqual([
      { id: 'cloudflare/clef-flash', images: true, pricePerMInput: expect.closeTo(0.09, 10) },
      { id: 'liquid/d1', images: false, pricePerMInput: expect.closeTo(0.04, 10) },
    ]);
    expect(parseModels({ models: [] })).toBeUndefined();
  });

  it('caches the list for 24 hours, refreshes on request and serves a stale list when offline', async () => {
    let now = 1000;
    let stored: ModelsCache | undefined;
    const script: Scripted[] = [{ status: 200, body: CATALOG }, { status: 200, body: CATALOG }, { status: 0, throws: true }];
    const { fetch, requests } = scriptedFetch({ [MODELS_URL]: script });
    const catalog = createModelCatalog({ fetch, now: () => now, getCache: async () => stored, setCache: async (c) => void (stored = c) });

    const first = await catalog.list();
    expect(first).toMatchObject({ fetchedAt: 1000 });
    expect(requests[0]!.url).toBe('https://openrouter.ai/api/v1/models?output_modalities=decisions');
    expect(requests[0]!.init!.headers).toEqual({ 'X-OpenRouter-Title': 'Shoo' });
    now += MODELS_TTL_MS - 1;
    await catalog.list();
    expect(requests).toHaveLength(1);
    await catalog.list({ refresh: true });
    expect(requests).toHaveLength(2);
    now += MODELS_TTL_MS;
    expect(await catalog.list()).toBe(stored);
    expect(requests).toHaveLength(3);
    expect(await catalog.priceFor('cloudflare/clef-flash')).toBeCloseTo(9e-8, 15);
    expect(await catalog.priceFor('unknown/model')).toBeUndefined();
    // After a background restart the price comes from the stored list without a fetch.
    const restarted = createModelCatalog({ fetch, now: () => now, getCache: async () => stored, setCache: async () => {} });
    expect(await restarted.priceFor('liquid/d1')).toBeCloseTo(4e-8, 15);
    expect(requests).toHaveLength(3);
  });

  it('reports offline with no cache', async () => {
    const { fetch } = scriptedFetch({ [MODELS_URL]: [{ status: 0, throws: true }] });
    const catalog = createModelCatalog({ fetch, now: () => 0, getCache: async () => undefined, setCache: async () => {} });
    expect(await catalog.list()).toEqual({ error: 'offline' });
  });
});

describe('GET /api/v1/key', () => {
  const KEY_BODY = { data: { label: 'sk-or-v1-abc...123', usage: 0.15, usage_daily: 0.02, limit: 10, limit_remaining: 9.85, user_id: 'x' } };

  it('returns label, usage and limits on 200, keyRejected on 401, offline on a network error', async () => {
    const { fetch, requests } = scriptedFetch({ [KEY_URL]: [{ status: 200, body: KEY_BODY }, { status: 401, body: { error: { code: 401, message: 'User not found.' } } }, { status: 0, throws: true }] });
    expect(await checkKey(fetch, 'sk-test')).toEqual({ ok: true, info: { label: 'sk-or-v1-abc...123', usage: 0.15, usageDaily: 0.02, limit: 10, limitRemaining: 9.85 } });
    expect(requests[0]!.init!.headers).toEqual({ Authorization: 'Bearer sk-test', 'X-OpenRouter-Title': 'Shoo' });
    expect(await checkKey(fetch, 'bad')).toEqual({ ok: false, error: 'keyRejected' });
    expect(await checkKey(fetch, 'sk-test')).toEqual({ ok: false, error: 'offline' });
  });

  it('refreshes key usage at most every 10 minutes per key', async () => {
    let now = 0;
    const ok: Scripted = { status: 200, body: { data: { usage: 1, limit: null, limit_remaining: null } } };
    const { fetch, requests } = scriptedFetch({ [KEY_URL]: [ok, ok, ok] });
    const usage = createKeyUsage({ fetch, now: () => now });
    expect(await usage.get('k1')).toEqual({ ok: true, info: { usage: 1, limit: null, limitRemaining: null } });
    now += 9 * 60 * 1000;
    await usage.get('k1');
    expect(requests).toHaveLength(1);
    await usage.get('k2');
    expect(requests).toHaveLength(2);
    usage.clear();
    await usage.get('k2');
    expect(requests).toHaveLength(3);
  });
});
