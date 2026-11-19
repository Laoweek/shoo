import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { FetchLike } from '~/engine/net';
import { CONSENT_VERSION } from '~/store/schema';
import { getCustomKey, getDirectKey, getOpenRouterKey, setCustomKey, setDirectKey, setOpenRouterKey } from '~/store/secret';
import { fakeOpenRouter, harness, T0 } from '../testing';

beforeEach(() => fakeBrowser.reset());

/** OpenRouter's key check through fakeOpenRouter, the model list answered here. Records every URL. */
function openRouter() {
  const inner = fakeOpenRouter();
  const urls: string[] = [];
  const fetch: FetchLike = async (input, init) => {
    urls.push(String(input));
    if (String(input).startsWith('https://openrouter.ai/api/v1/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'cloudflare/clef-flash', architecture: { input_modalities: ['text', 'image'] }, pricing: { prompt: '0.00000002' } }] }), { status: 200 });
    }
    return inner.fetch(input, init);
  };
  return { fetch, urls };
}

describe('nothing goes to OpenRouter before consent', () => {
  it('getKeyUsage, listModels and setKey send no request without consent, then ask OpenRouter once it is given', async () => {
    const net = openRouter();
    const h = harness({ fetch: net.fetch });
    await setOpenRouterKey({ key: 'sk-or-v1-test', source: 'oauth', label: 'Shoo', connectedAt: T0 }, h.areas.local);

    expect(await h.call('getKeyUsage', undefined)).toEqual({ label: 'Shoo', source: 'oauth', connectedAt: T0 });
    expect(await h.call('listModels', {})).toEqual({ error: 'noConsent' });
    expect(await h.call('setKey', { key: 'sk-or-v1-pasted' })).toEqual({ ok: true });
    expect(await getOpenRouterKey(h.areas.local)).toMatchObject({ key: 'sk-or-v1-pasted', source: 'pasted' });
    expect(net.urls).toEqual([]);

    await h.call('giveConsent', { version: CONSENT_VERSION });
    expect(await h.call('getKeyUsage', undefined)).toMatchObject({ usage: 0.5, limit: null });
    expect(await h.call('listModels', {})).toMatchObject({ models: [{ id: 'cloudflare/clef-flash', images: true }] });
    expect(net.urls).toEqual(['https://openrouter.ai/api/v1/key', 'https://openrouter.ai/api/v1/models?output_modalities=decisions']);
  });

  it('sends nothing after consent is withdrawn or the Firefox data collection permission is revoked', async () => {
    const net = openRouter();
    const h = harness({ fetch: net.fetch });
    await h.connect();
    await h.call('withdrawConsent', undefined);
    await h.call('getKeyUsage', undefined);
    await h.call('giveConsent', { version: CONSENT_VERSION });
    h.perms.dataCollection = false;
    await h.call('getKeyUsage', undefined);
    await h.call('listModels', { refresh: true });
    expect(net.urls).toEqual([]);
  });

  it('serves the stored model list without consent', async () => {
    const net = openRouter();
    const h = harness({ fetch: net.fetch });
    const cached = { models: [{ id: 'cloudflare/clef-flash', images: true, pricePerMInput: 0.02 }], fetchedAt: T0 - 7 * 86_400_000 };
    await h.areas.local.set({ models: cached });
    expect(await h.call('listModels', { refresh: true })).toEqual(cached);
    expect(net.urls).toEqual([]);
  });
});

describe('keys of a Decision provider reached directly and of the custom endpoint', () => {
  it('lists which keys are stored and forgets each one, leaving the others', async () => {
    const h = harness();
    await setOpenRouterKey({ key: 'sk-or-v1-test', source: 'pasted', connectedAt: T0 }, h.areas.local);
    await setDirectKey({ key: 'pplx-test' }, h.areas.local);
    await setCustomKey({ key: '' }, h.areas.local);
    expect(await h.call('getStoredKeys', undefined)).toEqual({ direct: true, custom: false });

    await setCustomKey({ key: 'sk-custom' }, h.areas.local);
    await h.call('forgetKey', { endpoint: 'direct' });
    expect(await getDirectKey(h.areas.local)).toBeUndefined();
    expect(await getCustomKey(h.areas.local)).toEqual({ key: 'sk-custom' });
    await h.call('forgetKey', { endpoint: 'custom' });
    expect(await getCustomKey(h.areas.local)).toBeUndefined();
    expect(await getOpenRouterKey(h.areas.local)).toBeDefined();
    expect(await h.call('getStoredKeys', undefined)).toEqual({ direct: false, custom: false });
  });

  it('a forgotten key leaves its endpoint without a key', async () => {
    const h = harness();
    await h.call('setCustomEndpoint', { baseUrl: 'https://llm.example.com/v1', model: 'm', key: 'k' });
    await h.call('giveConsent', { version: CONSENT_VERSION, customHost: 'llm.example.com' });
    expect((await h.call('getRuntimeState', undefined)).reason).toBe('ok');
    await h.call('forgetKey', { endpoint: 'custom' });
    expect((await h.call('getRuntimeState', undefined)).reason).toBe('noKey');
  });
});

describe('custom endpoint addresses', () => {
  it('refuses plain http away from this computer, like the form', async () => {
    const h = harness();
    expect(await h.call('setCustomEndpoint', { baseUrl: 'http://llm.example.com/v1', model: 'm', key: 'k' })).toEqual({ ok: false, error: 'invalidInput' });
    expect(await h.call('setCustomEndpoint', { baseUrl: 'http://localhost:11434/v1', model: 'm' })).toEqual({ ok: true });
  });

  it('tests only an endpoint on this computer, never one online', async () => {
    const urls: string[] = [];
    const h = harness({
      fetch: async (input) => {
        urls.push(String(input));
        throw new TypeError('Failed to fetch');
      },
    });
    expect(await h.call('testCustomEndpoint', { baseUrl: 'https://llm.example.com/v1', model: 'm', key: 'k' })).toEqual({ ok: false, error: 'invalidInput' });
    expect(urls).toEqual([]);
    await h.call('testCustomEndpoint', { baseUrl: 'http://localhost:11434/v1', model: 'm' });
    expect(urls).toEqual(['http://localhost:11434/v1/chat/completions']);
  });
});
