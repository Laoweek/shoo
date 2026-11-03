import { describe, expect, it } from 'vitest';
import { MAX_QUESTIONS_PER_REQUEST } from './budget';
import { cloudflareAccount, directProvider, directUrl, DIRECT_PROVIDERS, readsImages, topicRuleLimit } from './providers';

const ACCOUNT = '0123456789abcdef0123456789abcdef';

describe('direct Decision providers (decision-engine.md §12)', () => {
  it('accepts every request Shoo sends: each documented question limit is at least 64', () => {
    for (const p of DIRECT_PROVIDERS) expect(p.maxQuestions, p.id).toBeGreaterThanOrEqual(MAX_QUESTIONS_PER_REQUEST);
  });

  it('records each documented choice option limit, so Ollama takes 25 Topic rules and the others 254', () => {
    expect(Object.fromEntries(DIRECT_PROVIDERS.map((p) => [p.id, topicRuleLimit(p)]))).toEqual({
      cloudflare: 254,
      typesafe: 254,
      perplexity: 254,
      ollama: 25,
      llamacpp: 254,
      lmstudio: 254,
    });
  });

  it('builds each POST address from the base URL and model', () => {
    const at = (id: string, base?: string, model?: string) => {
      const p = directProvider(id)!;
      return directUrl(p, base ?? p.baseUrl, model ?? p.model);
    };
    expect(at('cloudflare', directProvider('cloudflare')!.baseUrl.replace('{account}', ACCOUNT))).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/@cf/cloudflare/clef-flash`,
    );
    expect(at('typesafe')).toBe('https://api.typesafe.ai/v1/systemone');
    expect(at('perplexity')).toBe('https://api.perplexity.ai/v1/decisions');
    expect(at('ollama')).toBe('http://localhost:11434/v1/systemone');
    expect(at('llamacpp')).toBe('http://localhost:9931/v1/systemone');
    expect(at('lmstudio', 'http://127.0.0.1:1234/v1/', 'x')).toBe('http://127.0.0.1:1234/v1/systemone');
  });

  it('cloud providers are https, local ones are on this computer with no key needed', () => {
    for (const p of DIRECT_PROVIDERS) {
      const url = new URL(p.baseUrl.replace('{account}', ACCOUNT));
      if (p.local) expect(url.hostname).toBe('localhost');
      else expect(url.protocol).toBe('https:');
      expect(p.price).toBeGreaterThanOrEqual(0);
    }
  });

  it('sends thumbnails only where the endpoint reads them: TypeSafe never, locally only to Clef', () => {
    expect(readsImages(directProvider('cloudflare')!, 'clef-flash')).toBe(true);
    expect(readsImages(directProvider('perplexity')!, 'pplx-decider-v1.1-27b')).toBe(true);
    expect(readsImages(directProvider('typesafe')!, 'jev-1.13.0')).toBe(false);
    expect(readsImages(directProvider('ollama')!, 'clef-flash')).toBe(true);
    expect(readsImages(directProvider('ollama')!, 'tev1')).toBe(false);
    expect(readsImages(directProvider('lmstudio')!, 'cloudflare/clef-flash-q8')).toBe(true);
  });

  it('reads the Cloudflare account ID back from a saved base URL', () => {
    expect(cloudflareAccount(directProvider('cloudflare')!.baseUrl.replace('{account}', ACCOUNT))).toBe(ACCOUNT);
    expect(cloudflareAccount('https://api.typesafe.ai/v1')).toBe('');
  });
});
