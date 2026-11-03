// Connect OpenRouter with OAuth PKCE (REQ-MODEL-4). Source of truth: docs/spec/decision-engine.md Section 7.2.
// Not yet tested live against OpenRouter in a real browser: unit tests use a fake identity API and a fake
// fetch. The open checks are listed in Section 7.2. The messages each browser uses for a user cancel are
// unknown too, so `isUserCancel` matches them loosely.
import { fetchWithTimeout, isRecord, readJson, REQUEST_TIMEOUT_MS, type FetchLike } from './net';

export const AUTH_URL = 'https://openrouter.ai/auth';
export const EXCHANGE_URL = 'https://openrouter.ai/api/v1/auth/keys';
export const KEY_LABEL = 'Shoo';
export const REDIRECT_PATH = 'openrouter';
/** A pending flow older than this is treated as expired (the code itself expires 10 minutes after issue). */
export const SESSION_MAX_AGE_MS = 60 * 60 * 1000;

/** `session:oauth`: kept in storage.session for the length of one flow. Never logged. */
export interface PkceSession {
  verifier: string;
  state: string;
  startedAt: number;
}

export interface IdentityLike {
  getRedirectURL(path?: string): string;
  launchWebAuthFlow(details: { url: string; interactive: boolean }): Promise<string | undefined>;
}

export interface OAuthDeps {
  fetch: FetchLike;
  now(): number;
  /** `browser.identity`, undefined where the API is missing. */
  identity?: IdentityLike;
  session: { get(): Promise<PkceSession | undefined>; set(s: PkceSession | undefined): Promise<void> };
  random?(n: number): Uint8Array;
  timeoutMs?: number;
}

export function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const defaultRandom = (n: number) => crypto.getRandomValues(new Uint8Array(n));

/** S256 challenge for a verifier: base64url(SHA-256(verifier)). */
export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** Fresh verifier (32 random bytes), its challenge and a random `state`. */
export async function createPkce(random: (n: number) => Uint8Array = defaultRandom): Promise<{ verifier: string; challenge: string; state: string }> {
  const verifier = base64url(random(32));
  return { verifier, challenge: await challengeFor(verifier), state: base64url(random(16)) };
}

/** The auth page URL. Without `callbackUrl` it is the headless mode, where OpenRouter shows the code on screen. */
export function authUrl(p: { challenge: string; state?: string; callbackUrl?: string }): string {
  const q = new URLSearchParams();
  if (p.callbackUrl) q.set('callback_url', p.callbackUrl);
  q.set('code_challenge', p.challenge);
  q.set('code_challenge_method', 'S256');
  q.set('key_label', KEY_LABEL);
  if (p.state) q.set('state', p.state);
  return `${AUTH_URL}?${q.toString()}`;
}

/** POST /api/v1/auth/keys. Returns the key only: `user_id` is dropped unread and nothing is logged. */
export async function exchangeCode(
  fetchFn: FetchLike,
  code: string,
  verifier: string,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<{ ok: true; key: string } | { ok: false; error: 'exchangeFailed' }> {
  try {
    const { res, value: json } = await fetchWithTimeout(
      fetchFn,
      EXCHANGE_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-OpenRouter-Title': 'Shoo' },
        body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
        credentials: 'omit',
      },
      timeoutMs,
      readJson,
    );
    if (res.ok && isRecord(json) && typeof json.key === 'string' && json.key) return { ok: true, key: json.key };
    return { ok: false, error: 'exchangeFailed' };
  } catch {
    return { ok: false, error: 'exchangeFailed' };
  }
}

const isUserCancel = (e: unknown) => /cancel|did not approve|denied/i.test(e instanceof Error ? e.message : String(e));

export type ConnectResult = { ok: true; key: string; label: string } | { ok: false; error: 'cancelled' | 'exchangeFailed' | 'unsupported' };

/**
 * Steps 1-5: PKCE, launchWebAuthFlow with callback_url = identity.getRedirectURL('openrouter'), state check,
 * code exchange. The caller stores the key through store/secret.ts with label 'Shoo' and the connect date,
 * then confirms it with checkKey (step 6). 'unsupported' means the browser flow failed: offer the headless
 * code (startHeadless, exchangeHeadlessCode), then the paste-key path.
 */
export async function connectOpenRouter(deps: OAuthDeps): Promise<ConnectResult> {
  if (!deps.identity) return { ok: false, error: 'unsupported' };
  const pkce = await createPkce(deps.random);
  await deps.session.set({ verifier: pkce.verifier, state: pkce.state, startedAt: deps.now() });
  const callbackUrl = deps.identity.getRedirectURL(REDIRECT_PATH);
  let returned: string | undefined;
  try {
    returned = await deps.identity.launchWebAuthFlow({ url: authUrl({ challenge: pkce.challenge, state: pkce.state, callbackUrl }), interactive: true });
  } catch (e) {
    await deps.session.set(undefined);
    return { ok: false, error: isUserCancel(e) ? 'cancelled' : 'unsupported' };
  }
  let params: URLSearchParams;
  try {
    params = new URL(returned ?? '').searchParams;
  } catch {
    await deps.session.set(undefined);
    return { ok: false, error: 'cancelled' };
  }
  const code = params.get('code');
  if (params.get('state') !== pkce.state || !code) {
    await deps.session.set(undefined);
    return { ok: false, error: code ? 'exchangeFailed' : 'cancelled' };
  }
  const exchanged = await exchangeCode(deps.fetch, code, pkce.verifier, deps.timeoutMs);
  await deps.session.set(undefined);
  return exchanged.ok ? { ok: true, key: exchanged.key, label: KEY_LABEL } : exchanged;
}

/** Headless fallback (step 7): stores a fresh verifier and returns the auth URL to open in a tab. */
export async function startHeadless(deps: OAuthDeps): Promise<string> {
  const pkce = await createPkce(deps.random);
  await deps.session.set({ verifier: pkce.verifier, state: pkce.state, startedAt: deps.now() });
  return authUrl({ challenge: pkce.challenge });
}

/** exchangeHeadlessCode: exchanges a pasted code with the stored verifier. 'expired' when no flow is pending. */
export async function exchangeHeadlessCode(
  deps: OAuthDeps,
  code: string,
): Promise<{ ok: true; key: string; label: string } | { ok: false; error: 'exchangeFailed' | 'expired' }> {
  const session = await deps.session.get();
  if (!session || deps.now() - session.startedAt > SESSION_MAX_AGE_MS) return { ok: false, error: 'expired' };
  const trimmed = code.trim();
  if (!trimmed) return { ok: false, error: 'exchangeFailed' };
  const exchanged = await exchangeCode(deps.fetch, trimmed, session.verifier, deps.timeoutMs);
  if (!exchanged.ok) return exchanged;
  await deps.session.set(undefined);
  return { ok: true, key: exchanged.key, label: KEY_LABEL };
}
