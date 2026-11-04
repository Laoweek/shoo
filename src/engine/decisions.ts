// Decisions API client: request builders, response validator, derivation and the fallback chain, for
// OpenRouter and for a Decision provider reached directly (System One API). Source of truth:
// docs/spec/decision-engine.md Sections 2, 4, 5, 8.1 and 12.
import { fitState, MAX_QUESTIONS_PER_REQUEST, MAX_TILES_PER_BATCH, textBatchSize, type ModelState } from '~/core/budget';
import { keepQuestionId, questionId } from '~/core/ids';
import { directProvider, directUrl, type ImageFormat } from '~/core/providers';
import { activeRules, isTopicKeep, sortByRef } from '~/core/rules';
import { SITE_NAMES, SURFACE_SITE } from '~/core/sites';
import type { DirectEndpoint, Exception, ReasonCode, Rule, SurfaceId, TileFacts } from '~/core/types';
import { deriveChoiceAnswer, deriveKeepAnswers, deriveNoulAnswers, type TextModelResult, type ThumbModelResult } from '~/core/verdict';
import {
  fetchWithTimeout,
  isRecord,
  LOCAL_REQUEST_TIMEOUT_MS,
  MAX_RETRY_AFTER_MS,
  parseApiError,
  readJson,
  REQUEST_TIMEOUT_MS,
  retryAfterMs,
  type ApiError,
  type FetchLike,
  type Sleep,
} from './net';

export const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';

/** Text framing (§2.4). 'choice' ships, picked by the Decisions API smoke test. Changing it changes rulesVersion. */
export type TextFraming = 'choice' | 'noul';
export const TEXT_FRAMING: TextFraming = 'choice';

/** Bump whenever the framing, the task strings, the state keys or the criteria wording change (§2.2). */
export const REQUEST_SHAPE_VERSION = 2;

/** REQ-MODEL-1. */
export const DEFAULT_MODEL = 'cloudflare/clef-flash';

/**
 * Fallback models (§5.2), one retry each. Defined only here so a product decision can swap them
 * (both are unavailable in some countries; the engine then reports the fallback as unavailable).
 */
export const FALLBACK_MODELS = { text: 'typesafe/jev-1.13', image: 'openai/gpt-6-luna-decisions' } as const;

/** Lowercase provider tags, as listed by /api/v1/models/<slug>/endpoints. Other slugs pin to their prefix. */
const PROVIDER_TAGS: Record<string, string> = {
  [DEFAULT_MODEL]: 'cloudflare',
  [FALLBACK_MODELS.text]: 'typesafe',
  [FALLBACK_MODELS.image]: 'openai',
};

export function providerTag(model: string): string {
  return PROVIDER_TAGS[model] ?? model.replace(/^~/, '').split('/')[0]!;
}

export interface ProviderPin {
  order: string[];
  allow_fallbacks: false;
  data_collection: 'deny';
}

/** Every request, primary or fallback, is pinned to one provider with fallbacks off. Never `zdr`. */
export function providerFor(model: string): ProviderPin {
  return { order: [providerTag(model)], allow_fallbacks: false, data_collection: 'deny' };
}

// ---------------------------------------------------------------------------------------------------
// Request builders (pure)

export interface VideoFacts {
  title: string;
  channel?: string;
  duration?: string;
  surface: string;
}

export type Question =
  | { type: 'choice'; instructions: { task: string; video: VideoFacts }; criteria: Record<string, string> }
  | { type: 'noul'; instructions: { task: string; video: VideoFacts } | string };

export type StateImage = { type: 'image_url'; image_url: { url: string } };

export interface DecisionsBody {
  model: string;
  /** OpenRouter's routing object. Left out for any other Decisions endpoint (§12). */
  provider?: ProviderPin;
  state: Partial<ModelState> | (string | StateImage)[];
  questions: Record<string, Question>;
}

/** What each question id means. Held locally, so videoIds never leave the background (REQ-PRIV-1). */
export type QuestionSpec =
  | { kind: 'choice'; tile: number; options: string[] }
  | { kind: 'rule'; tile: number; ref: string }
  | { kind: 'keep'; tile: number; ref: string }
  | { kind: 'thumb'; tile: number; ref: string };

export interface BuiltRequest {
  body: DecisionsBody;
  questions: Map<string, QuestionSpec>;
  /** Index i is the Tile behind question ids `t<i+1>…`. */
  tiles: TileFacts[];
  /** Tiles that only got their Topic Keep questions (an exact remove is pending, §2.5). */
  keepOnly: boolean[];
  /** Budget report from core/budget.ts fitState. */
  fit?: { droppedExceptions: number; truncatedRefs: string[]; usedTokens: number; budget: number };
}

// The tasks name the Tile's Site. For YouTube the words are exactly the ones Filtering strength was calibrated on
// (REQUEST_SHAPE_VERSION covers them), so Bilibili's wording never changes a YouTube request.
export const choiceTask = (site: string) =>
  `Which rule in viewer_does_not_want does this recommended ${site} video clearly match? Choose keep if it matches none or only shares words with a rule. Videos similar to viewer_kept_anyway should be kept.`;
export const CHOICE_TASK = choiceTask('YouTube');
export const KEEP_CRITERION = "Matches none of the rules, including videos that only explain, report on, review or sit near a rule's topic";
export const ruleTask = (text: string, site = 'YouTube') => `Does this recommended ${site} video match this rule: ${text}?`;
/** The Tile's Site as the tasks name it. */
export const siteOf = (t: TileFacts): string => SITE_NAMES[SURFACE_SITE[t.surface]];
export const thumbnailTask = (text: string) => `The thumbnail image shows: ${text}`;

const SURFACE_LABELS: Record<SurfaceId, string> = {
  home: 'home page',
  watchSidebar: 'watch page sidebar',
  shortsShelf: 'Shorts shelf',
  search: 'search results',
  channel: 'channel page',
  endScreen: 'end screen',
  bilibiliHome: 'home page',
  bilibiliVideoSidebar: 'video page sidebar',
};

/** Duration as YouTube shows it: 18:42, 1:02:05. */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** The only Tile facts sent: title, channel name, duration, Surface label. Never ids, handles or URLs. */
export function videoFacts(t: TileFacts): VideoFacts {
  return {
    title: t.title,
    ...(t.channelName ? { channel: t.channelName } : {}),
    ...(t.durationSec !== undefined && Number.isFinite(t.durationSec) ? { duration: formatDuration(t.durationSec) } : {}),
    surface: SURFACE_LABELS[t.surface] ?? t.surface,
  };
}

const isTopicRemove = (r: Rule) => r.kind === 'topic' && r.polarity === 'remove';
const isThumbnailRule = (r: Rule) => r.kind === 'thumbnail' && r.polarity === 'remove';

/** Enabled, non-deleted model Rules by role, in ref order. */
export function modelRules(rules: Rule[]): { topicRemove: Rule[]; topicKeep: Rule[]; thumbnail: Rule[] } {
  const live = sortByRef(activeRules(rules));
  return { topicRemove: live.filter(isTopicRemove), topicKeep: live.filter(isTopicKeep), thumbnail: live.filter(isThumbnailRule) };
}

/** Tiles per text request (§2.2, §2.4). Every request stays at or under 64 questions. */
export function textBatchSizeFor(framing: TextFraming, removeRules: number, keepRules: number): number {
  if (framing === 'choice' && removeRules > 0) return textBatchSize(keepRules);
  // Keep-only requests, or the noul framing: one noul per Tile and Rule.
  const questionsPerTile = framing === 'choice' ? keepRules : removeRules + keepRules;
  return Math.max(1, Math.min(MAX_TILES_PER_BATCH, Math.floor(MAX_QUESTIONS_PER_REQUEST / Math.max(1, questionsPerTile))));
}

export interface TextRequestOptions {
  model?: string;
  framing?: TextFraming;
  /** videoIds of Tiles with an exact remove pending: they get only their Topic Keep questions. */
  keepOnly?: ReadonlySet<string>;
}

/**
 * Text pass request (§2.2). `rules` may hold every Rule: only enabled Topic rules and Topic Keep rules are
 * used. Rule texts in the criteria and Keep tasks are the ones that fit the state budget (§3).
 */
export function buildTextRequest(rules: Rule[], exceptions: Exception[], tiles: TileFacts[], opts: TextRequestOptions = {}): BuiltRequest {
  const model = opts.model ?? DEFAULT_MODEL;
  const framing = opts.framing ?? TEXT_FRAMING;
  const { topicRemove, topicKeep } = modelRules(rules);
  const fit = fitState(topicRemove, topicKeep, exceptions);
  const removeTexts = fit.state.viewer_does_not_want;
  const keepTexts = fit.state.viewer_always_wants ?? {};
  const state: Partial<ModelState> = topicRemove.length > 0 ? fit.state : { viewer_always_wants: keepTexts };

  const questions = new Map<string, QuestionSpec>();
  const body: DecisionsBody = { model, provider: providerFor(model), state, questions: {} };
  const keepOnly = tiles.map((t) => opts.keepOnly?.has(t.videoId) === true);

  tiles.forEach((t, i) => {
    const video = videoFacts(t);
    const site = siteOf(t);
    if (!keepOnly[i] && topicRemove.length > 0) {
      if (framing === 'choice') {
        const id = questionId(i);
        body.questions[id] = { type: 'choice', instructions: { task: choiceTask(site), video }, criteria: { keep: KEEP_CRITERION, ...removeTexts } };
        questions.set(id, { kind: 'choice', tile: i, options: ['keep', ...Object.keys(removeTexts)] });
      } else {
        for (const [ref, text] of Object.entries(removeTexts)) {
          const id = keepQuestionId(i, ref);
          body.questions[id] = { type: 'noul', instructions: { task: ruleTask(text, site), video } };
          questions.set(id, { kind: 'rule', tile: i, ref });
        }
      }
    }
    for (const [ref, text] of Object.entries(keepTexts)) {
      const id = keepQuestionId(i, ref);
      body.questions[id] = { type: 'noul', instructions: { task: ruleTask(text, site), video } };
      questions.set(id, { kind: 'keep', tile: i, ref });
    }
  });

  const { droppedExceptions, truncatedRefs, usedTokens, budget } = fit;
  return { body, questions, tiles, keepOnly, fit: { droppedExceptions, truncatedRefs, usedTokens, budget } };
}

/** Keep-only request (§2.5): one noul per Tile and Topic Keep rule. No remove Rules, no Exceptions. */
export function buildKeepOnlyRequest(keepRules: Rule[], tiles: TileFacts[], opts: { model?: string } = {}): BuiltRequest {
  const topicKeep = activeRules(keepRules).filter(isTopicKeep);
  // With no remove Rules and no Exceptions, the state is `{ viewer_always_wants }` only.
  return buildTextRequest(topicKeep, [], tiles, { model: opts.model, keepOnly: new Set(tiles.map((t) => t.videoId)) });
}

/**
 * Thumbnail pass request (§4), one Tile. The image is a top-level `state` item. Question ids are the
 * Thumbnail rule refs. The videoId is used only by the caller to fetch the image.
 */
export function buildThumbnailRequest(thumbnailRules: Rule[], tile: TileFacts, dataUrl: string, opts: { model?: string } = {}): BuiltRequest {
  const model = opts.model ?? DEFAULT_MODEL;
  const rules = sortByRef(activeRules(thumbnailRules).filter(isThumbnailRule));
  const state: (string | StateImage)[] = [`Title: ${tile.title}`];
  if (tile.channelName) state.push(`Channel: ${tile.channelName}`);
  state.push({ type: 'image_url', image_url: { url: dataUrl } });
  const questions = new Map<string, QuestionSpec>();
  const body: DecisionsBody = { model, provider: providerFor(model), state, questions: {} };
  for (const r of rules) {
    body.questions[r.ref] = { type: 'noul', instructions: thumbnailTask(r.text) };
    questions.set(r.ref, { kind: 'thumb', tile: 0, ref: r.ref });
  }
  return { body, questions, tiles: [tile], keepOnly: [false] };
}

/** The same request for another model, pinned to that model's provider. */
export function withModel(body: DecisionsBody, model: string): DecisionsBody {
  return { ...body, model, provider: providerFor(model) };
}

// ---------------------------------------------------------------------------------------------------
// Response validation (§8.1)

export interface ChoiceAnswer {
  type?: string;
  choice: string;
  probabilities?: Record<string, number>;
  confidence?: number;
}
export interface NoulAnswer {
  type?: string;
  noul: number;
}

export interface ValidResponse {
  model?: string;
  answers: Record<string, ChoiceAnswer | NoulAnswer>;
  usage: { inputTokens: number; cost?: number };
}

const PROB_SUM_TOLERANCE = 0.02;
const isUnit = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/** Keys and value types only, no content, for diagnostics when the alpha API changes shape. */
export function shapeSummary(v: unknown, depth = 3): string {
  if (Array.isArray(v)) return `[${v.length}]`;
  if (!isRecord(v)) return v === null ? 'null' : typeof v;
  if (depth === 0) return '{…}';
  const keys = Object.keys(v);
  const parts = keys.slice(0, 20).map((k) => {
    const child = v[k];
    return isRecord(child) || Array.isArray(child) ? `${k}:${shapeSummary(child, depth - 1)}` : k;
  });
  if (keys.length > 20) parts.push(`…+${keys.length - 20}`);
  return `{${parts.join(',')}}`;
}

export type Validation = { ok: true; value: ValidResponse } | { ok: false; problem: string; shape: string };

/** Strict hand-written check of a 200 body against the questions that were asked. Extra answers are ignored. */
export function validateResponse(body: unknown, questions: Map<string, QuestionSpec>): Validation {
  const fail = (problem: string): Validation => ({ ok: false, problem, shape: shapeSummary(body) });
  if (!isRecord(body)) return fail('notObject');
  const answers = body.answers;
  if (!isRecord(answers)) return fail('answersMissing');
  for (const [id, spec] of questions) {
    const a = answers[id];
    if (!isRecord(a)) return fail(`missingAnswer:${id}`);
    if (spec.kind === 'choice') {
      if (typeof a.choice !== 'string' || !spec.options.includes(a.choice)) return fail(`choiceNotOption:${id}`);
      if (a.probabilities !== undefined) {
        if (!isRecord(a.probabilities)) return fail(`probabilitiesShape:${id}`);
        // An unrequested key could otherwise become the argmax ref and credit an unrelated Rule.
        if (!Object.keys(a.probabilities).every((k) => spec.options.includes(k))) return fail(`probabilitiesKeys:${id}`);
        const values = Object.values(a.probabilities);
        if (!values.every(isUnit)) return fail(`probabilityRange:${id}`);
        const sum = (values as number[]).reduce((s, p) => s + p, 0);
        if (Math.abs(sum - 1) > PROB_SUM_TOLERANCE) return fail(`probabilitiesSum:${id}`);
      }
      if (deriveChoiceAnswer(a as Parameters<typeof deriveChoiceAnswer>[0]) === null) return fail(`choiceUnusable:${id}`);
    } else if (!isUnit(a.noul)) {
      return fail(`noulRange:${id}`);
    }
  }
  const usage = body.usage;
  if (!isRecord(usage) || typeof usage.input_tokens !== 'number') return fail('usageMissing');
  const value: ValidResponse = { answers: answers as ValidResponse['answers'], usage: { inputTokens: usage.input_tokens } };
  if (typeof usage.cost === 'number' && Number.isFinite(usage.cost)) value.usage.cost = usage.cost;
  if (typeof body.model === 'string') value.model = body.model;
  return { ok: true, value };
}

/** usage.cost from any body, valid or not, so a paid but malformed answer is still accounted. */
export function readUsage(body: unknown): { inputTokens?: number; cost?: number } {
  const usage = isRecord(body) && isRecord(body.usage) ? body.usage : undefined;
  const out: { inputTokens?: number; cost?: number } = {};
  if (typeof usage?.input_tokens === 'number') out.inputTokens = usage.input_tokens;
  if (typeof usage?.cost === 'number' && Number.isFinite(usage.cost)) out.cost = usage.cost;
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Derivation into cache records (§2.3, §2.5, §4)

/** A text result as cached (§1.2). `keepOnly` marks a keep-only answer (§2.5), whose pRemove is no answer. */
export type CachedText = TextModelResult;

/** Text and keep-only answers per videoId. Assumes `validateResponse` passed. */
export function deriveTextResults(built: BuiltRequest, answers: ValidResponse['answers'], model: string): Map<string, CachedText> {
  const perTile = built.tiles.map(() => ({ choice: undefined as ChoiceAnswer | undefined, rules: {} as Record<string, number>, keeps: {} as Record<string, number> }));
  for (const [id, spec] of built.questions) {
    const a = answers[id];
    const slot = perTile[spec.tile];
    if (!a || !slot) continue;
    if (spec.kind === 'choice') slot.choice = a as ChoiceAnswer;
    else if (spec.kind === 'rule') slot.rules[spec.ref] = (a as NoulAnswer).noul;
    else if (spec.kind === 'keep') slot.keeps[spec.ref] = (a as NoulAnswer).noul;
  }
  const hasKeep = [...built.questions.values()].some((q) => q.kind === 'keep');
  const out = new Map<string, CachedText>();
  built.tiles.forEach((t, i) => {
    const slot = perTile[i]!;
    const remove = slot.choice ? deriveChoiceAnswer(slot.choice) : Object.keys(slot.rules).length > 0 ? deriveNoulAnswers(slot.rules) : null;
    const r: CachedText = { pRemove: remove?.pRemove ?? 0, model };
    if (remove?.ref !== undefined) r.ref = remove.ref;
    if (hasKeep) {
      const k = deriveKeepAnswers(slot.keeps);
      r.pKeep = k.pKeep;
      if (k.keepRef !== undefined) r.keepRef = k.keepRef;
    }
    if (built.keepOnly[i]) r.keepOnly = true;
    out.set(t.videoId, r);
  });
  return out;
}

/** Thumbnail answer (§4): p = max over the rule nouls, ref = argmax. */
export function deriveThumbResult(built: BuiltRequest, answers: ValidResponse['answers'], model: string): ThumbModelResult {
  const byRef: Record<string, number> = {};
  for (const [id, spec] of built.questions) {
    const a = answers[id];
    if (spec.kind === 'thumb' && a) byRef[spec.ref] = (a as NoulAnswer).noul;
  }
  const d = deriveNoulAnswers(byRef);
  return d.ref === undefined ? { p: d.pRemove, model } : { p: d.pRemove, ref: d.ref, model };
}

// ---------------------------------------------------------------------------------------------------
// Network policy and fallback chain (§5)

export type Pass = 'text' | 'thumbnail';

export const REGION_BLOCK_STEP = 'Gate Endpoints with Geo Restrictions';

/** What to do with one response (§5.3). */
export type Action =
  | { kind: 'ok' }
  | { kind: 'fallback'; reason: ReasonCode }
  | { kind: 'retrySame'; waitMs: number; otherwise: Exclude<Action, { kind: 'retrySame' } | { kind: 'ok' }> }
  | { kind: 'fail'; reason: ReasonCode; countsAsFailure: boolean; split?: true; keepTile?: true };

/** `status` 0 means a network error or our own timeout. */
export function classifyResponse(status: number, err: ApiError | undefined, waitMs: number | undefined, pass: Pass, model: string, openRouter = true): Action {
  const message = err?.message ?? '';
  if (status >= 200 && status < 300) return { kind: 'ok' };
  if (status === 0 || status === 408 || status >= 500) return { kind: 'fallback', reason: 'modelError' };
  switch (status) {
    case 429: {
      const otherwise = { kind: 'fallback', reason: 'rateLimited' } as const;
      return waitMs !== undefined && waitMs <= MAX_RETRY_AFTER_MS ? { kind: 'retrySame', waitMs, otherwise } : otherwise;
    }
    case 400: {
      const namesModel = !err?.schemaPaths && (message.includes(model) || /does not exist/i.test(message) || /provider/i.test(message));
      return namesModel ? { kind: 'fallback', reason: 'modelError' } : { kind: 'fail', reason: 'apiShapeChanged', countsAsFailure: true };
    }
    case 401:
      return { kind: 'fail', reason: 'keyRejected', countsAsFailure: false };
    case 403: {
      // OpenRouter's region block. Off OpenRouter every 403 is a refusal (§12.2).
      const regionBlocked = openRouter && (err?.failedRoutingStep === REGION_BLOCK_STEP || /not available in your region/i.test(message));
      return regionBlocked ? { kind: 'fallback', reason: 'modelError' } : { kind: 'fail', reason: 'keyRejected', countsAsFailure: false };
    }
    case 402: {
      if (err?.limitSource !== 'openrouter_in_flight_budget') return { kind: 'fail', reason: 'creditsExhausted', countsAsFailure: false };
      const otherwise = { kind: 'fail', reason: 'rateLimited', countsAsFailure: true } as const;
      return waitMs !== undefined && waitMs <= MAX_RETRY_AFTER_MS ? { kind: 'retrySame', waitMs, otherwise } : otherwise;
    }
    case 404:
      return { kind: 'fallback', reason: 'modelError' };
    case 413:
      return pass === 'text'
        ? { kind: 'fail', reason: 'modelError', countsAsFailure: false, split: true }
        : { kind: 'fail', reason: 'modelError', countsAsFailure: false, keepTile: true };
    case 422:
      return pass === 'text'
        ? { kind: 'fail', reason: 'modelError', countsAsFailure: true }
        : { kind: 'fail', reason: 'modelError', countsAsFailure: false, keepTile: true };
    default:
      return { kind: 'fail', reason: 'modelError', countsAsFailure: true };
  }
}

/** Diagnostics only. Never the key, an Authorization header or an error body as is. */
export type EngineLog =
  | { event: 'decisionsError'; model: string; status: number; code?: number; message?: string; schemaPaths?: string[] }
  | { event: 'apiShapeChanged'; model: string; problem: string; shape: string }
  | { event: 'stateTrimmed'; droppedExceptions: number; truncatedRefs: string[]; overBudget: boolean }
  | { event: 'sideEffectFailed'; what: string };

export interface DecisionsDeps {
  fetch: FetchLike;
  sleep: Sleep;
  now(): number;
  timeoutMs?: number;
  log?(e: EngineLog): void;
}

export type ChainResult =
  | { ok: true; model: string; json: unknown; requests: number; fallback: boolean }
  | {
      ok: false;
      reason: ReasonCode;
      countsAsFailure: boolean;
      split?: true;
      keepTile?: true;
      requests: number;
      /** HTTP status of the last response, 0 for a network error or timeout. */
      status: number;
    };

/** Only these headers: OpenRouter's CORS allow-list blocks any other custom header (§2.1). */
export function decisionsHeaders(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-OpenRouter-Title': 'Shoo' };
}

/**
 * Where a Decisions request goes (§2.1, §12). Only OpenRouter gets the provider pin, the title header and
 * the fallback chain. A direct endpoint gets the same questions, its thumbnail where it reads one, and
 * its answer unwrapped from Cloudflare's envelope.
 */
export interface DecisionsTarget {
  url: string;
  openRouter: boolean;
  timeoutMs: number;
  images?: ImageFormat;
  envelope?: true;
}

export const OPENROUTER: DecisionsTarget = { url: DECISIONS_URL, openRouter: true, timeoutMs: REQUEST_TIMEOUT_MS };

/** The target for a saved direct endpoint. A model on this computer gets the longer local timeout. */
export function directTarget(e: DirectEndpoint): DecisionsTarget | undefined {
  const p = directProvider(e.provider);
  if (!p) return undefined;
  const t: DecisionsTarget = { url: directUrl(p, e.baseUrl, e.model), openRouter: false, timeoutMs: p.local ? LOCAL_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS };
  if (p.images) t.images = p.images;
  if (p.envelope) t.envelope = true;
  return t;
}

/** Content-Type, and Authorization only with a key: a model on this computer needs none. */
export function directHeaders(key: string): Record<string, string> {
  return key ? { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

const isStateImage = (v: unknown): v is StateImage => isRecord(v) && v.type === 'image_url';

/**
 * The body as the target takes it. Off OpenRouter: no `provider` object (Perplexity refuses unknown
 * fields), and a thumbnail moves from the state array to a top-level `images` array, as a data URL or as
 * raw base64 (Ollama).
 */
export function bodyFor(t: DecisionsTarget, body: DecisionsBody): Record<string, unknown> {
  if (t.openRouter) return body as unknown as Record<string, unknown>;
  const { provider: _pin, ...rest } = body;
  if (!Array.isArray(rest.state) || t.images === 'state') return rest;
  const urls = rest.state.filter(isStateImage).map((i) => i.image_url.url);
  if (urls.length === 0) return rest;
  const images = t.images === 'base64' ? urls.map((u) => u.slice(u.indexOf(',') + 1)) : urls;
  return { ...rest, state: rest.state.filter((v) => !isStateImage(v)), images };
}

/**
 * Sends one Decisions request through the fallback chain (§5.2, §5.3): the body's own model first, then
 * `fallbackModel` once, each pinned to its own provider with `allow_fallbacks: false`. A 429 with a short
 * Retry-After or a 402 in-flight budget retries the same model once. Returns the raw 200 body. A direct
 * target (§12) has no fallback chain: what would fall back fails and counts as one model failure.
 */
export async function sendDecisions(
  deps: DecisionsDeps,
  key: string,
  body: DecisionsBody,
  pass: Pass,
  fallbackModel?: string,
  target: DecisionsTarget = OPENROUTER,
): Promise<ChainResult> {
  const models = [body.model];
  if (target.openRouter && fallbackModel && fallbackModel !== body.model) models.push(fallbackModel);
  let requests = 0;
  let last: { reason: ReasonCode; status: number } = { reason: 'modelError', status: 0 };

  for (const [mi, model] of models.entries()) {
    const req = mi === 0 ? body : withModel(body, model);
    let retried = false;
    for (;;) {
      requests++;
      let status = 0;
      let json: unknown;
      let err: ApiError | undefined;
      let wait: number | undefined;
      try {
        const { res, value } = await fetchWithTimeout(
          deps.fetch,
          target.url,
          { method: 'POST', headers: target.openRouter ? decisionsHeaders(key) : directHeaders(key), body: JSON.stringify(bodyFor(target, req)), credentials: 'omit' },
          deps.timeoutMs ?? target.timeoutMs,
          readJson,
        );
        status = res.status;
        json = target.envelope && res.ok && isRecord(value) ? value.result : value;
        if (!res.ok) {
          err = parseApiError(status, json);
          wait = retryAfterMs(res.headers, deps.now());
        }
      } catch {
        status = 0;
      }

      let action = classifyResponse(status, err, wait, pass, model, target.openRouter);
      if (action.kind === 'ok') return { ok: true, model, json, requests, fallback: mi > 0 };
      deps.log?.({
        event: 'decisionsError',
        model,
        status,
        ...(err?.code !== undefined ? { code: err.code } : {}),
        ...(err?.message ? { message: err.message } : {}),
        ...(err?.schemaPaths ? { schemaPaths: err.schemaPaths } : {}),
      });
      if (action.kind === 'retrySame') {
        if (!retried) {
          retried = true;
          await deps.sleep(action.waitMs);
          continue;
        }
        action = action.otherwise;
      }
      if (action.kind === 'fail') {
        const out: ChainResult = { ok: false, reason: action.reason, countsAsFailure: action.countsAsFailure, requests, status };
        if (action.split) out.split = true;
        if (action.keepTile) out.keepTile = true;
        return out;
      }
      last = { reason: action.reason, status };
      break;
    }
  }
  return { ok: false, reason: last.reason, countsAsFailure: true, requests, status: last.status };
}

/** The synthetic Tile an endpoint test sends: no user data. */
export const TEST_TILE: TileFacts = { videoId: 'test', surface: 'home', title: 'How sourdough fermentation works', isShort: false, isLive: false, isUpcoming: false, isMembersOnly: false };

/**
 * testDirectEndpoint (§12): one synthetic Tile and Rule, no user data, for a model on this computer before
 * consent. Errors: 'network' (not running), 'keyRejected' (401 or 403, Ollama's Origin check), 'http<status>'
 * (404: the model is not there), or the validator's problem when the answer has the wrong shape.
 */
export async function testDirect(deps: DecisionsDeps, e: DirectEndpoint, key: string): Promise<{ ok: true; latencyMs: number } | { ok: false; error: string }> {
  const target = directTarget(e);
  if (!target) return { ok: false, error: 'invalidInput' };
  const rule: Rule = { id: 'test', ref: 'R1', polarity: 'remove', kind: 'topic', text: 'Cooking videos', enabled: true, origin: 'user', createdAt: 0, updatedAt: 0 };
  const built = buildTextRequest([rule], [], [TEST_TILE], { model: e.model });
  const started = deps.now();
  const sent = await sendDecisions(deps, key, built.body, 'text', undefined, target);
  if (!sent.ok) return { ok: false, error: sent.reason === 'keyRejected' ? 'keyRejected' : sent.status === 0 ? 'network' : `http${sent.status}` };
  const valid = validateResponse(sent.json, built.questions);
  return valid.ok ? { ok: true, latencyMs: deps.now() - started } : { ok: false, error: valid.problem };
}
