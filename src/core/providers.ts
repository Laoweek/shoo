// Decision providers reached directly, without OpenRouter (CONTEXT.md "Decision provider"). They all speak
// the System One API, the request and response shape Shoo already sends to OpenRouter's Decisions API,
// and differ only in what this table records. Source of truth: docs/spec/requirements.md REQ-MODEL-7 and
// docs/spec/decision-engine.md Section 12, facts and sources in its Section 12.4 (checked 2026-10-10).

export type DirectProviderId = 'cloudflare' | 'typesafe' | 'perplexity' | 'ollama' | 'llamacpp' | 'lmstudio';

/**
 * Where the endpoint reads a thumbnail: 'state' as an `image_url` item of the state array (OpenRouter's
 * format), 'dataUrl' or 'base64' in a top-level `images` array. Absent: the endpoint reads no images.
 */
export type ImageFormat = 'state' | 'dataUrl' | 'base64';

export interface DirectProvider {
  id: DirectProviderId;
  /** A brand name, not translated. */
  name: string;
  /** Prefilled base URL. Cloudflare's carries `{account}`, the user's account ID. */
  baseUrl: string;
  /** Appended to the base URL. `{model}` is the model ID (Cloudflare names the model in the path). */
  path: string;
  /** Prefilled model ID, as the endpoint names it (no OpenRouter `vendor/` prefix). Empty: the user's. */
  model: string;
  /** Runs on this computer: no key, nothing leaves the device. */
  local: boolean;
  images?: ImageFormat;
  /** Cloudflare wraps the answer in `{ result, success, errors, messages }`. */
  envelope?: true;
  /** Documented question limit. Shoo sends at most 64 (core/budget.ts), so every limit must be at least that. */
  maxQuestions: number;
  /**
   * Documented limit on a choice question's options. Shoo's choice question has `keep` plus one option per
   * enabled remove Topic rule, so it allows `maxChoiceOptions - 1` Topic rules (topicRuleLimit).
   */
  maxChoiceOptions: number;
  /** Published USD per input token, to estimate spend: these endpoints report no `usage.cost`. */
  price: number;
  /** Where the provider explains how to get a key. */
  keyUrl?: string;
}

export const DIRECT_PROVIDERS: readonly DirectProvider[] = [
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/@cf/cloudflare',
    path: '/{model}',
    model: 'clef-flash',
    local: false,
    images: 'dataUrl',
    envelope: true,
    maxQuestions: 64,
    maxChoiceOptions: 255,
    price: 0.038e-6,
    keyUrl: 'https://developers.cloudflare.com/workers-ai/get-started/rest-api/',
  },
  {
    id: 'typesafe',
    name: 'TypeSafe',
    baseUrl: 'https://api.typesafe.ai/v1',
    path: '/systemone',
    model: 'jev-1.13.0',
    local: false,
    maxQuestions: 64,
    maxChoiceOptions: 255,
    price: 0.042e-6,
    keyUrl: 'https://docs.typesafe.ai/api',
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    baseUrl: 'https://api.perplexity.ai/v1',
    path: '/decisions',
    model: 'pplx-decider-v1.1-27b',
    local: false,
    images: 'state',
    maxQuestions: 128,
    maxChoiceOptions: 255,
    price: 0.02e-6,
    keyUrl: 'https://docs.perplexity.ai/docs/decisions/quickstart',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    path: '/systemone',
    model: 'clef-flash',
    local: true,
    images: 'base64',
    maxQuestions: 64,
    maxChoiceOptions: 26,
    price: 0,
  },
  {
    id: 'llamacpp',
    name: 'llama.cpp',
    baseUrl: 'http://localhost:9931/v1',
    path: '/systemone',
    model: 'clef-flash',
    local: true,
    images: 'dataUrl',
    maxQuestions: 64,
    maxChoiceOptions: 255,
    price: 0,
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    path: '/systemone',
    model: '',
    local: true,
    images: 'dataUrl',
    maxQuestions: 64,
    maxChoiceOptions: 255,
    price: 0,
  },
];

/** The model whose scores Filtering strength was tuned on (decision-engine.md §2.3). */
export const CALIBRATED_MODEL = 'clef-flash';

export function directProvider(id: string): DirectProvider | undefined {
  return DIRECT_PROVIDERS.find((p) => p.id === id);
}

/** The POST address for a saved direct endpoint. */
export function directUrl(p: DirectProvider, baseUrl: string, model: string): string {
  return baseUrl.trim().replace(/\/+$/, '') + p.path.replace('{model}', encodeURIComponent(model.trim()));
}

/**
 * Whether thumbnails go to this endpoint (Thumbnail rules run). On this computer only Clef reads images:
 * Ollama serves images for Clef models only, and other local models are treated as text only.
 */
export function readsImages(p: DirectProvider, model: string): boolean {
  return p.images !== undefined && (!p.local || /clef/i.test(model));
}

/**
 * Enabled remove Topic rules one choice question can carry on this provider: its option limit minus
 * `keep`. Over it, Shoo sends no text request there (decision-engine.md §12.1), because the provider
 * would refuse every one.
 */
export function topicRuleLimit(p: DirectProvider): number {
  return p.maxChoiceOptions - 1;
}

/** Cloudflare's account ID inside a saved base URL, for the form. */
export function cloudflareAccount(baseUrl: string): string {
  return /\/accounts\/([^/]+)\//.exec(baseUrl)?.[1] ?? '';
}
