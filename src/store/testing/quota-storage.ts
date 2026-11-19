// Test helpers: an in-memory storage area and a quota-enforcing wrapper that behaves like Chrome's
// storage.sync limits (docs/spec/architecture.md Section 14, store/ row). Not shipped in any bundle.
import { itemBytes, type AreaLike, type ChangeListener, type StorageChange } from '../areas';

export const SYNC_QUOTA_BYTES = 102_400;
export const SYNC_QUOTA_BYTES_PER_ITEM = 8_192;

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
const keyList = (keys: string | string[]) => (Array.isArray(keys) ? keys : [keys]);

/**
 * An in-memory area that clones on the way in and out (like real storage) and fires `onChanged`
 * asynchronously, as browsers do. Use one per simulated device for `local` and `session`.
 */
export function createMemoryArea(): AreaLike & { dump(): Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  const listeners = new Set<ChangeListener>();
  const emit = (changes: Record<string, StorageChange>) => {
    if (Object.keys(changes).length === 0) return;
    queueMicrotask(() => listeners.forEach((l) => l(changes)));
  };
  return {
    async get(keys) {
      if (keys === undefined || keys === null) return clone(data);
      const out: Record<string, unknown> = {};
      for (const k of keyList(keys)) if (k in data) out[k] = clone(data[k]);
      return out;
    },
    async set(items) {
      const changes: Record<string, StorageChange> = {};
      for (const [k, v] of Object.entries(clone(items))) {
        if (v === undefined) continue;
        changes[k] = { oldValue: data[k], newValue: v };
        data[k] = v;
      }
      emit(changes);
    },
    async remove(keys) {
      const changes: Record<string, StorageChange> = {};
      for (const k of keyList(keys)) {
        if (!(k in data)) continue;
        changes[k] = { oldValue: data[k] };
        delete data[k];
      }
      emit(changes);
    },
    async clear() {
      const changes: Record<string, StorageChange> = {};
      for (const k of Object.keys(data)) {
        changes[k] = { oldValue: data[k] };
        delete data[k];
      }
      emit(changes);
    },
    async getBytesInUse(keys) {
      const list = keys === undefined || keys === null ? Object.keys(data) : keyList(keys);
      return list.reduce((sum, k) => (k in data ? sum + itemBytes(k, data[k]) : sum), 0);
    },
    onChanged: { addListener: (cb) => void listeners.add(cb), removeListener: (cb) => void listeners.delete(cb) },
    dump: () => clone(data),
  };
}

export interface QuotaOptions {
  /** Total bytes (QUOTA_BYTES). Sync: 102,400. */
  quotaBytes?: number;
  /** Bytes per item including its key (QUOTA_BYTES_PER_ITEM). Sync: 8,192. Omit for local. */
  quotaBytesPerItem?: number;
  /** Write operations (set, remove, clear) per rolling minute. Omit for no limit. */
  maxWritesPerMinute?: number;
  now?: () => number;
}

export interface QuotaArea extends AreaLike {
  getBytesInUse(keys?: string | string[] | null): Promise<number>;
  /** Number of successful write operations. */
  writes: number;
  /** Keys of every successful `set`, in order. */
  log: string[][];
}

/**
 * Wraps an area (fakeBrowser's storage.sync, or a memory area) and rejects writes the way Chrome does:
 * "QUOTA_BYTES_PER_ITEM quota exceeded", "QUOTA_BYTES quota exceeded" and
 * "This request exceeds the MAX_WRITE_OPERATIONS_PER_MINUTE quota.". `getBytesInUse` counts key plus
 * JSON value, like Chrome.
 */
export function withQuota(inner: AreaLike, opts: QuotaOptions = {}): QuotaArea {
  const now = opts.now ?? Date.now;
  const writeTimes: number[] = [];

  async function current(): Promise<Record<string, unknown>> {
    const raw = await inner.get(null);
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined && v !== null));
  }
  const bytesOf = (data: Record<string, unknown>) => Object.entries(data).reduce((s, [k, v]) => s + itemBytes(k, v), 0);

  function checkRate(): void {
    if (opts.maxWritesPerMinute === undefined) return;
    const t = now();
    while (writeTimes.length > 0 && t - writeTimes[0]! >= 60_000) writeTimes.shift();
    if (writeTimes.length >= opts.maxWritesPerMinute) throw new Error('This request exceeds the MAX_WRITE_OPERATIONS_PER_MINUTE quota.');
  }

  const area: QuotaArea = {
    writes: 0,
    log: [],
    get: (keys) => inner.get(keys),
    async set(items) {
      checkRate();
      const data = await current();
      for (const [k, v] of Object.entries(items)) {
        if (v === undefined) continue;
        if (opts.quotaBytesPerItem !== undefined && itemBytes(k, v) > opts.quotaBytesPerItem) throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
        data[k] = v;
      }
      if (opts.quotaBytes !== undefined && bytesOf(data) > opts.quotaBytes) throw new Error('QUOTA_BYTES quota exceeded');
      await inner.set(items);
      writeTimes.push(now());
      area.writes++;
      area.log.push(Object.keys(items));
    },
    async remove(keys) {
      checkRate();
      await inner.remove(keys);
      writeTimes.push(now());
      area.writes++;
    },
    async clear() {
      checkRate();
      await inner.clear();
      writeTimes.push(now());
      area.writes++;
    },
    async getBytesInUse(keys) {
      const data = await current();
      const list = keys === undefined || keys === null ? Object.keys(data) : keyList(keys);
      return list.reduce((s, k) => (k in data ? s + itemBytes(k, data[k]) : s), 0);
    },
    onChanged: inner.onChanged,
  };
  return area;
}

/** Sync limits as in Chrome. */
export const syncQuota = (inner: AreaLike, opts: Omit<QuotaOptions, 'quotaBytes' | 'quotaBytesPerItem'> = {}): QuotaArea =>
  withQuota(inner, { quotaBytes: SYNC_QUOTA_BYTES, quotaBytesPerItem: SYNC_QUOTA_BYTES_PER_ITEM, ...opts });
