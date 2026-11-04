// The three storage areas behind one small interface, so tests can pass quota-enforcing fakes and two
// simulated devices. Source of truth for keys and budgets: docs/spec/architecture.md Section 8.
import { browser } from 'wxt/browser';
import { isRecord } from '~/core/types';

export interface StorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

export type ChangeListener = (changes: Record<string, StorageChange>) => void;

/** The subset of `browser.storage.StorageArea` the store uses. Keys carry no area prefix (`rules:b0`). */
export interface AreaLike {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  clear(): Promise<void>;
  getBytesInUse?(keys?: string | string[] | null): Promise<number>;
  onChanged: { addListener(cb: ChangeListener): void; removeListener(cb: ChangeListener): void };
}

export interface Areas {
  sync: AreaLike;
  local: AreaLike;
  session: AreaLike;
}

/** The real areas. Resolved at call time so tests can stub the global first. */
export function browserAreas(): Areas {
  const s = browser.storage;
  return { sync: s.sync as unknown as AreaLike, local: s.local as unknown as AreaLike, session: s.session as unknown as AreaLike };
}

const encoder = new TextEncoder();

/** Bytes an item costs the way Chrome counts it: key length plus the JSON of the value, UTF-8. */
export function itemBytes(key: string, value: unknown): number {
  return encoder.encode(key).length + encoder.encode(JSON.stringify(value)).length;
}

const message = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

/** Chrome: "QUOTA_BYTES quota exceeded" / "QUOTA_BYTES_PER_ITEM ...". Firefox: "QuotaExceededError". */
export function isQuotaError(e: unknown): boolean {
  return /QUOTA_BYTES|quota exceeded|QuotaExceeded/i.test(message(e)) && !isRateLimitError(e);
}

/** Chrome: "This request exceeds the MAX_WRITE_OPERATIONS_PER_MINUTE quota." (or _PER_HOUR). */
export function isRateLimitError(e: unknown): boolean {
  return /MAX_WRITE_OPERATIONS|MAX_SUSTAINED_WRITE/i.test(message(e));
}

/** `get` that drops undefined and null values (some fakes return `{ key: undefined }` for missing keys). */
export async function getDefined(area: AreaLike, keys: string | string[] | null): Promise<Record<string, unknown>> {
  const raw = await area.get(keys);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) if (v !== undefined && v !== null) out[k] = v;
  return out;
}

export async function getOne<T>(area: AreaLike, key: string): Promise<T | undefined> {
  const raw = await area.get(key);
  const v = raw[key];
  return v === undefined || v === null ? undefined : (v as T);
}

export { isRecord };

/** JSON with object keys sorted at every level, so a comparison does not depend on key order (Chrome returns keys sorted). */
export function stableJson(v: unknown): string {
  return JSON.stringify(v, (_key, value: unknown) =>
    isRecord(value) ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, value[k]])) : value,
  );
}
