// OAuth PKCE with a fake identity API and a fake fetch. Sign-in has not been tried live, so these tests pin the
// documented flow only: real browser behaviour (redirect acceptance, cancel messages, gesture rules) is untested.
import { describe, expect, it, vi } from 'vitest';
import { authUrl, base64url, challengeFor, connectOpenRouter, createPkce, exchangeHeadlessCode, EXCHANGE_URL, startHeadless, type OAuthDeps, type PkceSession } from './oauth';
import { scriptedFetch, type Scripted } from './testing';

const REDIRECT = 'https://abcdefghijklmnop.chromiumapp.org/openrouter';
const counter = () => {
  let n = 0;
  return (len: number) => Uint8Array.from({ length: len }, () => n++ % 256);
};

function setup(opts: { launch?: (url: string) => Promise<string | undefined>; exchange?: Scripted[]; identity?: false }) {
  let session: PkceSession | undefined;
  const { fetch, requests } = scriptedFetch({ [EXCHANGE_URL]: opts.exchange ?? [] });
  const launched: string[] = [];
  const deps: OAuthDeps = {
    fetch,
    now: () => 5,
    random: counter(),
    session: { get: async () => session, set: async (s) => void (session = s) },
    ...(opts.identity === false
      ? {}
      : {
          identity: {
            getRedirectURL: vi.fn(() => REDIRECT),
            launchWebAuthFlow: async ({ url }) => {
              launched.push(url);
              return opts.launch ? opts.launch(url) : undefined;
            },
          },
        }),
  };
  return { deps, requests, launched, session: () => session };
}

const stateOf = (url: string) => new URL(url).searchParams.get('state');

describe('PKCE', () => {
  it('computes the RFC 7636 S256 challenge', async () => {
    expect(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('uses a 32-byte base64url verifier and a random state', async () => {
    const p = await createPkce();
    expect(p.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.state).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(p.challenge).toBe(await challengeFor(p.verifier));
    expect(base64url(new Uint8Array([251, 255]))).toBe('-_8');
  });

  it('builds the auth URL with key_label Shoo, and without callback_url in headless mode', () => {
    const u = new URL(authUrl({ challenge: 'c', state: 's', callbackUrl: REDIRECT }));
    expect(u.origin + u.pathname).toBe('https://openrouter.ai/auth');
    expect(Object.fromEntries(u.searchParams)).toEqual({ callback_url: REDIRECT, code_challenge: 'c', code_challenge_method: 'S256', key_label: 'Shoo', state: 's' });
    expect(new URL(authUrl({ challenge: 'c' })).searchParams.has('callback_url')).toBe(false);
  });
});

describe('connectOpenRouter', () => {
  it('launches the flow with the identity redirect URL, checks state and exchanges the code', async () => {
    const t = setup({ launch: async (url) => `${REDIRECT}?code=abc&state=${stateOf(url)}`, exchange: [{ status: 200, body: { key: 'sk-or-new', user_id: 'user_1' } }] });
    expect(await connectOpenRouter(t.deps)).toEqual({ ok: true, key: 'sk-or-new', label: 'Shoo' });
    expect(t.deps.identity!.getRedirectURL).toHaveBeenCalledWith('openrouter');
    const sent = new URL(t.launched[0]!).searchParams;
    expect(sent.get('callback_url')).toBe(REDIRECT);
    expect(t.requests[0]!.body).toEqual({ code: 'abc', code_verifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), code_challenge_method: 'S256' });
    expect(await challengeFor(t.requests[0]!.body.code_verifier)).toBe(sent.get('code_challenge'));
    expect(t.requests[0]!.init!.headers).toEqual({ 'Content-Type': 'application/json', 'X-OpenRouter-Title': 'Shoo' });
    expect(t.session()).toBeUndefined();
  });

  it('rejects a mismatched state without exchanging', async () => {
    const t = setup({ launch: async () => `${REDIRECT}?code=abc&state=forged` });
    expect(await connectOpenRouter(t.deps)).toEqual({ ok: false, error: 'exchangeFailed' });
    expect(t.requests).toEqual([]);
  });

  it('reports a user cancel, a missing code, an unusable browser flow and a failed exchange', async () => {
    expect(await connectOpenRouter(setup({ launch: async () => Promise.reject(new Error('The user did not approve access.')) }).deps)).toEqual({ ok: false, error: 'cancelled' });
    expect(await connectOpenRouter(setup({ launch: async () => Promise.reject(new Error('User cancelled or denied the request.')) }).deps)).toEqual({ ok: false, error: 'cancelled' });
    expect(await connectOpenRouter(setup({ launch: async (url) => `${REDIRECT}?state=${stateOf(url)}` }).deps)).toEqual({ ok: false, error: 'cancelled' });
    expect(await connectOpenRouter(setup({ launch: async () => Promise.reject(new Error('Authorization page could not be loaded.')) }).deps)).toEqual({ ok: false, error: 'unsupported' });
    expect(await connectOpenRouter(setup({ identity: false }).deps)).toEqual({ ok: false, error: 'unsupported' });
    const bad = setup({ launch: async (url) => `${REDIRECT}?code=abc&state=${stateOf(url)}`, exchange: [{ status: 400, body: { error: { code: 400, message: 'Invalid code' } } }] });
    expect(await connectOpenRouter(bad.deps)).toEqual({ ok: false, error: 'exchangeFailed' });
  });
});

describe('headless code', () => {
  it('exchanges a pasted code with the stored verifier', async () => {
    const t = setup({ exchange: [{ status: 403, body: {} }, { status: 200, body: { key: 'sk-or-h', user_id: 'u' } }] });
    expect(await exchangeHeadlessCode(t.deps, 'code')).toEqual({ ok: false, error: 'expired' });
    const url = await startHeadless(t.deps);
    expect(new URL(url).searchParams.has('callback_url')).toBe(false);
    const verifier = t.session()!.verifier;
    expect(await exchangeHeadlessCode(t.deps, ' code ')).toEqual({ ok: false, error: 'exchangeFailed' });
    expect(await exchangeHeadlessCode(t.deps, 'code2')).toEqual({ ok: true, key: 'sk-or-h', label: 'Shoo' });
    expect(t.requests.map((r) => r.body)).toEqual([
      { code: 'code', code_verifier: verifier, code_challenge_method: 'S256' },
      { code: 'code2', code_verifier: verifier, code_challenge_method: 'S256' },
    ]);
    expect(t.session()).toBeUndefined();
  });

  it('treats a pending flow older than an hour as expired', async () => {
    const t = setup({});
    await t.deps.session.set({ verifier: 'v', state: 's', startedAt: 5 - 61 * 60 * 1000 });
    expect(await exchangeHeadlessCode(t.deps, 'code')).toEqual({ ok: false, error: 'expired' });
    expect(t.requests).toEqual([]);
  });
});
