// OpenRouter key checks: GET /api/v1/key for setKey (validate before storing), the OAuth confirm step and
// getKeyUsage. Source of truth: docs/spec/decision-engine.md Sections 7.1, 7.2 step 6 and 8.3.
import { fetchWithTimeout, isRecord, readJson, REQUEST_TIMEOUT_MS, type FetchLike } from './net';

export const KEY_URL = 'https://openrouter.ai/api/v1/key';
/** getKeyUsage refreshes the key's limit and usage at most this often. */
export const KEY_USAGE_TTL_MS = 10 * 60 * 1000;

export interface KeyInfo {
  label?: string;
  usage: number;
  /** usage_daily: spend in the current UTC day. */
  usageDaily?: number;
  limit: number | null;
  limitRemaining: number | null;
}

export type KeyCheck = { ok: true; info: KeyInfo } | { ok: false; error: 'keyRejected' | 'offline' | 'modelError' };

const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** 200 → the key's label, usage and limit. 401 or 403 → keyRejected. Network error or timeout → offline. */
export async function checkKey(fetchFn: FetchLike, key: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<KeyCheck> {
  let res: Response;
  let json: unknown;
  try {
    ({ res, value: json } = await fetchWithTimeout(
      fetchFn,
      KEY_URL,
      { headers: { Authorization: `Bearer ${key}`, 'X-OpenRouter-Title': 'Shoo' }, credentials: 'omit' },
      timeoutMs,
      readJson,
    ));
  } catch {
    return { ok: false, error: 'offline' };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, error: 'keyRejected' };
  if (!res.ok) return { ok: false, error: 'modelError' };
  const data = isRecord(json) && isRecord(json.data) ? json.data : undefined;
  if (!data) return { ok: false, error: 'modelError' };
  const info: KeyInfo = { usage: numOrNull(data.usage) ?? 0, limit: numOrNull(data.limit), limitRemaining: numOrNull(data.limit_remaining) };
  if (typeof data.label === 'string') info.label = data.label;
  const daily = numOrNull(data.usage_daily);
  if (daily !== null) info.usageDaily = daily;
  return { ok: true, info };
}

/**
 * getKeyUsage with a 10 minute memo per key. Held in memory only (a background restart refetches).
 * Call `clear()` on disconnect or when the key changes.
 */
export function createKeyUsage(deps: { fetch: FetchLike; now(): number }) {
  let memo: { key: string; at: number; check: KeyCheck & { ok: true } } | undefined;
  return {
    async get(key: string, opts: { refresh?: boolean } = {}): Promise<KeyCheck> {
      if (!opts.refresh && memo && memo.key === key && deps.now() - memo.at < KEY_USAGE_TTL_MS) return memo.check;
      const check = await checkKey(deps.fetch, key);
      memo = check.ok ? { key, at: deps.now(), check } : undefined;
      return check;
    },
    clear() {
      memo = undefined;
    },
  };
}
