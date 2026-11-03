// Decision model catalogue (REQ-MODEL-3). Source of truth: docs/spec/decision-engine.md Sections 7.4 and 8.3.
import type { ReasonCode } from '~/core/types';
import { fetchWithTimeout, isRecord, readJson, REQUEST_TIMEOUT_MS, type FetchLike } from './net';

export const MODELS_URL = 'https://openrouter.ai/api/v1/models?output_modalities=decisions';
export const MODELS_TTL_MS = 24 * 60 * 60 * 1000;

/** Same shape as `ModelInfo` in messaging/protocol.ts and `CachedModel` in store/local.ts. */
export interface ModelInfo {
  id: string;
  images: boolean;
  pricePerMInput: number;
}

export interface ModelsCache {
  models: ModelInfo[];
  fetchedAt: number;
}

/** Catalogue entries: image capable when `architecture.input_modalities` includes 'image', price from `pricing.prompt` ($/token). */
export function parseModels(json: unknown): ModelInfo[] | undefined {
  const data = isRecord(json) && Array.isArray(json.data) ? json.data : undefined;
  if (!data) return undefined;
  const out: ModelInfo[] = [];
  for (const m of data) {
    if (!isRecord(m) || typeof m.id !== 'string') continue;
    const modalities = isRecord(m.architecture) && Array.isArray(m.architecture.input_modalities) ? m.architecture.input_modalities : [];
    const prompt = isRecord(m.pricing) ? Number(m.pricing.prompt) : NaN;
    out.push({ id: m.id, images: modalities.includes('image'), pricePerMInput: Number.isFinite(prompt) ? prompt * 1e6 : 0 });
  }
  return out;
}

export async function fetchModels(fetchFn: FetchLike, timeoutMs = REQUEST_TIMEOUT_MS): Promise<{ ok: true; models: ModelInfo[] } | { ok: false; error: ReasonCode }> {
  try {
    const { res, value } = await fetchWithTimeout(fetchFn, MODELS_URL, { headers: { 'X-OpenRouter-Title': 'Shoo' }, credentials: 'omit' }, timeoutMs, readJson);
    if (!res.ok) return { ok: false, error: 'modelError' };
    const models = parseModels(value);
    return models ? { ok: true, models } : { ok: false, error: 'apiShapeChanged' };
  } catch {
    return { ok: false, error: 'offline' };
  }
}

export interface CatalogDeps {
  fetch: FetchLike;
  now(): number;
  /** `local:models`. The catalogue checks the 24 h age itself. */
  getCache(): Promise<ModelsCache | undefined>;
  setCache(cache: ModelsCache): Promise<void>;
}

export interface ModelCatalog {
  /** listModels: the cached list when younger than 24 h, else a fresh one. A stale cache is served when the fetch fails. */
  list(opts?: { refresh?: boolean }): Promise<ModelsCache | { error: ReasonCode }>;
  /** $ per input token for cost estimates when `usage.cost` is absent (§8.3). Reads the stored list after a restart. */
  priceFor(model: string): Promise<number | undefined>;
}

export function createModelCatalog(deps: CatalogDeps): ModelCatalog {
  let loaded: ModelsCache | undefined;
  return {
    async list(opts = {}) {
      const cached = loaded ?? (await deps.getCache());
      if (cached) loaded = cached;
      if (!opts.refresh && cached && deps.now() - cached.fetchedAt < MODELS_TTL_MS) return cached;
      const fresh = await fetchModels(deps.fetch);
      if (!fresh.ok) return cached ?? { error: fresh.error };
      loaded = { models: fresh.models, fetchedAt: deps.now() };
      await deps.setCache(loaded);
      return loaded;
    },
    async priceFor(model) {
      loaded ??= await deps.getCache();
      const m = loaded?.models.find((x) => x.id === model);
      return m ? m.pricePerMInput / 1e6 : undefined;
    },
  };
}
