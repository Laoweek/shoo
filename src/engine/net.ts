// Network helpers for engine/. Limits are defined in docs/spec/decision-engine.md Section 5.1.
import { isRecord } from '~/core/types';

/** Decisions requests (text, keep-only, thumbnail), GET /api/v1/key, /api/v1/models and the OAuth exchange. */
export const REQUEST_TIMEOUT_MS = 8000;
/**
 * A request to a model on this computer (localhost), chat or Decisions. A laptop model answers a 16-Tile
 * request far slower than a hosted one. Kept under Chrome's 30 s limit for a service worker fetch with no response.
 */
export const LOCAL_REQUEST_TIMEOUT_MS = 25_000;
/** Thumbnail image fetch from i.ytimg.com or Bilibili's image host. */
export const THUMBNAIL_TIMEOUT_MS = 4000;
/** In flight per browser: text and keep-only requests share one limit, thumbnail requests have their own. */
export const TEXT_IN_FLIGHT = 2;
export const THUMBNAIL_IN_FLIGHT = 4;
/** 429: wait for Retry-After and retry the same model only when the wait is at most this. */
export const MAX_RETRY_AFTER_MS = 5000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type Sleep = (ms: number) => Promise<void>;

export const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `fetch` plus reading the body, both under one AbortController timeout, so a stalled body cannot hold a
 * concurrency slot. Rejects on timeout like any network error, and on any redirect (`redirect: 'error'`).
 */
export async function fetchWithTimeout<T>(
  fetchFn: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  read: (res: Response) => Promise<T>,
): Promise<{ res: Response; value: T }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new DOMException('Request timed out', 'TimeoutError'));
    }, timeoutMs);
  });
  const work = (async () => {
    // Never follow redirects: a 307 or 308 would re-send titles or a key to a host without consent or permission.
    const res = await fetchFn(url, { ...init, redirect: 'error', signal: controller.signal });
    return { res, value: await read(res) };
  })();
  work.catch(() => {}); // the timeout may win the race, the aborted request then rejects unobserved
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Retry-After in ms (delta seconds or an HTTP date). Undefined when absent or unreadable. */
export function retryAfterMs(headers: Headers, now: number = Date.now()): number | undefined {
  const raw = headers.get('retry-after');
  if (raw === null || raw.trim() === '') return undefined;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(raw);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

/** In-memory counting semaphore. Background state is disposable, so losing it on restart is harmless. */
export class Semaphore {
  #active = 0;
  readonly #waiting: (() => void)[] = [];
  readonly #limit: number;

  constructor(limit: number) {
    this.#limit = limit;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.#active >= this.#limit) await new Promise<void>((resolve) => this.#waiting.push(resolve));
    else this.#active++;
    try {
      return await task();
    } finally {
      const next = this.#waiting.shift();
      if (next) next();
      else this.#active--;
    }
  }
}

/**
 * Largest JSON body read from any endpoint. A 16-Tile answer is a few KB and the model list about 35 KB, so a
 * reply past this is broken or hostile and is never buffered whole.
 */
export const MAX_JSON_BYTES = 1024 * 1024;

/**
 * The body, or undefined once more than `maxBytes` arrive. Reading stops and the stream is cancelled at that point,
 * so a body with no or a false Content-Length never fills memory.
 */
export async function readBody(res: Response, maxBytes: number): Promise<Blob | undefined> {
  const chunks: BlobPart[] = [];
  let total = 0;
  const reader = res.body?.getReader();
  for (;;) {
    const next = await reader?.read();
    if (!next || next.done) return new Blob(chunks);
    total += next.value.byteLength;
    if (total > maxBytes) {
      reader!.cancel().catch(() => {});
      return undefined;
    }
    chunks.push(next.value);
  }
}

/** Parsed JSON body, or undefined when it is not JSON or larger than MAX_JSON_BYTES. */
export async function readJson(res: Response): Promise<unknown> {
  try {
    const body = await readBody(res, MAX_JSON_BYTES);
    return body && JSON.parse(await body.text());
  } catch {
    return undefined;
  }
}

/** A usage count or cost: finite, not negative and at most `max`. Anything else is treated as absent. */
export function usageNumber(v: unknown, max: number): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : undefined;
}

/** More than any one request can cost: a 16-Tile text request costs well under US$0.01. */
export const MAX_REQUEST_COST_USD = 1;
/** More input than any one request carries: a text request is a few thousand tokens, a thumbnail about 8,500. */
export const MAX_REQUEST_INPUT_TOKENS = 1_000_000;

export { isRecord };

/**
 * The loggable part of an OpenRouter error body: `code` and a trimmed `message`, plus the two metadata
 * fields the network policy branches on. Never the body as is (some carry a top-level `user_id`).
 */
export interface ApiError {
  status: number;
  code?: number;
  /** Trimmed. Empty for a schema error, whose issues are reduced to `schemaPaths`. */
  message: string;
  /** A 400 schema error carries a JSON string of zod issues in `message`. Only their paths are kept. */
  schemaPaths?: string[];
  failedRoutingStep?: string;
  limitSource?: string;
}

const MESSAGE_LOG_CHARS = 300;

function zodPaths(message: string): string[] | undefined {
  if (!message.trimStart().startsWith('[')) return undefined;
  try {
    const issues: unknown = JSON.parse(message);
    if (!Array.isArray(issues)) return undefined;
    return issues.map((i) => (isRecord(i) && Array.isArray(i.path) ? i.path.join('.') : '?'));
  } catch {
    return undefined;
  }
}

export function parseApiError(status: number, body: unknown): ApiError {
  // OpenRouter's `{ error }`, or Cloudflare's `{ errors: [...] }` from a direct endpoint (§12).
  const first = isRecord(body) && Array.isArray(body.errors) ? body.errors[0] : undefined;
  const err = isRecord(body) && isRecord(body.error) ? body.error : isRecord(first) ? first : undefined;
  const meta = err && isRecord(err.metadata) ? err.metadata : undefined;
  const raw = typeof err?.message === 'string' ? err.message : '';
  const paths = zodPaths(raw);
  const out: ApiError = { status, message: paths ? '' : raw.slice(0, MESSAGE_LOG_CHARS) };
  if (paths) out.schemaPaths = paths;
  if (typeof err?.code === 'number') out.code = err.code;
  if (typeof meta?.failed_routing_step === 'string') out.failedRoutingStep = meta.failed_routing_step;
  if (typeof meta?.limit_source === 'string') out.limitSource = meta.limit_source;
  return out;
}
