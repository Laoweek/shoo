// Custom OpenAI-compatible endpoint client (REQ-MODEL-5). Topic rules only, no Thumbnail rules.
// Source of truth: docs/spec/decision-engine.md Section 6. Network limits: Section 5.1.
import { fitState } from '~/core/budget';
import { questionId } from '~/core/ids';
import type { Exception, ReasonCode, Rule, TileFacts } from '~/core/types';
import { modelRules, siteOf, TEST_TILE, videoFacts, type CachedText } from './decisions';
import {
  fetchWithTimeout,
  isRecord,
  LOCAL_REQUEST_TIMEOUT_MS,
  MAX_RETRY_AFTER_MS,
  readJson,
  REQUEST_TIMEOUT_MS,
  retryAfterMs,
  type FetchLike,
  type Sleep,
} from './net';

export const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'shoo_verdicts',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['results'],
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'outcome', 'rule', 'probability'],
            properties: {
              id: { type: 'string' },
              outcome: { type: 'string', enum: ['keep', 'remove'] },
              rule: { type: ['string', 'null'] },
              probability: { type: 'number' },
            },
          },
        },
      },
    },
  },
} as const;

/** The system prompt, naming the Site the request's Tiles come from (one tab, so one Site). */
export const chatInstructions = (site: string) => [
  `You judge recommended ${site} videos for one viewer. The rules and examples follow as JSON.`,
  'viewer_does_not_want maps rule refs to videos the viewer wants removed. viewer_always_wants maps rule refs to videos the viewer always wants to see. viewer_kept_anyway lists videos the viewer chose to keep, and similar videos should be kept.',
  'The user message is a JSON array of videos. Return exactly one result per video, with its id.',
  'If a video matches a rule in viewer_always_wants, set outcome to keep and rule to that ref.',
  'Otherwise, if it matches a rule in viewer_does_not_want, set outcome to remove and rule to that ref.',
  'Otherwise set outcome to keep and rule to null.',
  'Set probability to the probability, from 0 to 1, that the viewer wants the video removed.',
].join('\n');

export interface ChatPlan {
  body: Record<string, unknown>;
  /** Index i is the Tile behind id `t<i+1>`. */
  tiles: TileFacts[];
  keepRefs: string[];
  removeRefs: string[];
}

function hostOf(baseUrl: string): string | undefined {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return undefined;
  }
}

export function isOpenRouterBase(baseUrl: string): boolean {
  return hostOf(baseUrl) === 'openrouter.ai';
}

/** Tokens a reasoning model may spend before it answers. */
const REASONING_ROOM = 1024;

/**
 * Token budget and reasoning fields by host and model (Section 6.1). OpenAI's gpt-6 models reason: they
 * take `reasoning_effort: 'none'` and `max_completion_tokens`, and refuse `max_tokens` (and `temperature`
 * unless effort is none, so Shoo leaves it out). Other OpenAI models get `max_completion_tokens`, which
 * every current OpenAI chat model accepts, with room for reasoning and no fields a reasoning model refuses.
 * Groq's gpt-oss has no 'none', so it reasons briefly with room for that. Every other endpoint (Ollama,
 * LM Studio, OpenRouter, other Groq models) gets the plain fields, because Ollama ignores
 * `max_completion_tokens`.
 */
export function budgetFields(baseUrl: string, model: string, tiles: number): Record<string, unknown> {
  const answer = 64 + 48 * tiles;
  const host = hostOf(baseUrl);
  if (host === 'api.openai.com') {
    return model.startsWith('gpt-6') ? { reasoning_effort: 'none', max_completion_tokens: answer } : { max_completion_tokens: REASONING_ROOM + answer };
  }
  if (host === 'api.groq.com' && model.startsWith('openai/gpt-oss')) return { temperature: 0, reasoning_effort: 'low', max_completion_tokens: REASONING_ROOM + answer };
  return { temperature: 0, max_tokens: answer };
}

/** localhost or 127.0.0.1: a model on this computer, which gets the longer local timeout. */
export function isLocalBase(baseUrl: string): boolean {
  const host = hostOf(baseUrl);
  return host === 'localhost' || host === '127.0.0.1';
}

export function chatUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

/** Chat request for the text pass (§6). Same Rule and Exception content as the Decisions `state`. */
export function buildChatRequest(rules: Rule[], exceptions: Exception[], tiles: TileFacts[], model: string, baseUrl: string): ChatPlan {
  const { topicRemove, topicKeep } = modelRules(rules);
  const { state } = fitState(topicRemove, topicKeep, exceptions);
  const videos = tiles.map((t, i) => ({ id: questionId(i), ...videoFacts(t) }));
  const body: Record<string, unknown> = {
    model,
    ...budgetFields(baseUrl, model, tiles.length),
    messages: [
      { role: 'system', content: `${chatInstructions(tiles[0] ? siteOf(tiles[0]) : 'YouTube')}\n\n${JSON.stringify(state)}` },
      { role: 'user', content: JSON.stringify(videos) },
    ],
    response_format: RESPONSE_FORMAT,
  };
  if (isOpenRouterBase(baseUrl)) body.provider = { require_parameters: true, allow_fallbacks: false, data_collection: 'deny' };
  return { body, tiles, keepRefs: Object.keys(state.viewer_always_wants ?? {}), removeRefs: Object.keys(state.viewer_does_not_want) };
}

export type ChatParse = { ok: true; results: Map<string, CachedText> } | { ok: false; reason: ReasonCode; detail: string };

/** `usage.cost` of a chat reply, read before its content is checked: a paid reply counts even when unusable. */
export function chatCost(json: unknown): number | undefined {
  const usage = isRecord(json) && isRecord(json.usage) ? json.usage : undefined;
  return typeof usage?.cost === 'number' && Number.isFinite(usage.cost) ? usage.cost : undefined;
}

const isUnit = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/**
 * Maps `probability` to pRemove and `rule` to ref (§6). A Topic Keep ref gives pKeep = 1 - probability.
 * `finish_reason: 'length'` with empty content means the model needs more max_tokens.
 */
export function parseChatResponse(json: unknown, plan: ChatPlan, model: string): ChatParse {
  const choice = isRecord(json) && Array.isArray(json.choices) && isRecord(json.choices[0]) ? json.choices[0] : undefined;
  const message = choice && isRecord(choice.message) ? choice.message : undefined;
  const content = typeof message?.content === 'string' ? message.content : '';
  if (!content.trim()) {
    return choice?.finish_reason === 'length'
      ? { ok: false, reason: 'modelError', detail: 'finishLength' }
      : { ok: false, reason: 'apiShapeChanged', detail: 'emptyContent' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, reason: 'apiShapeChanged', detail: choice?.finish_reason === 'length' ? 'finishLength' : 'notJson' };
  }
  const list = isRecord(parsed) && Array.isArray(parsed.results) ? parsed.results : undefined;
  if (!list) return { ok: false, reason: 'apiShapeChanged', detail: 'resultsMissing' };
  const byId = new Map<string, Record<string, unknown>>();
  for (const r of list) if (isRecord(r) && typeof r.id === 'string') byId.set(r.id, r);

  const results = new Map<string, CachedText>();
  for (const [i, t] of plan.tiles.entries()) {
    const r = byId.get(questionId(i));
    if (!r || !isUnit(r.probability) || (r.outcome !== 'keep' && r.outcome !== 'remove')) {
      return { ok: false, reason: 'apiShapeChanged', detail: `badResult:${questionId(i)}` };
    }
    const rule = typeof r.rule === 'string' ? r.rule : undefined;
    const out: CachedText = { pRemove: r.probability, model };
    if (rule !== undefined && plan.removeRefs.includes(rule)) out.ref = rule;
    if (plan.keepRefs.length > 0) {
      const keptByRule = rule !== undefined && plan.keepRefs.includes(rule);
      out.pKeep = keptByRule ? 1 - r.probability : 0;
      if (keptByRule) out.keepRef = rule;
    }
    results.set(t.videoId, out);
  }
  return { ok: true, results };
}

export interface ChatDeps {
  fetch: FetchLike;
  sleep: Sleep;
  now(): number;
  timeoutMs?: number;
}

export type ChatSend = { ok: true; json: unknown; requests: number } | { ok: false; reason: ReasonCode; countsAsFailure: boolean; detail: string; requests: number };

/**
 * Only Authorization and Content-Type, plus the OpenRouter title header when the endpoint is OpenRouter.
 * An empty key (a local endpoint such as Ollama, which needs none) sends no Authorization header.
 */
export function chatHeaders(key: string, baseUrl: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) h.Authorization = `Bearer ${key}`;
  if (isOpenRouterBase(baseUrl)) h['X-OpenRouter-Title'] = 'Shoo';
  return h;
}

/** One chat request. There is no fallback model on a custom endpoint. A 429 with a short Retry-After retries once. */
export async function sendChat(deps: ChatDeps, baseUrl: string, key: string, body: Record<string, unknown>): Promise<ChatSend> {
  let requests = 0;
  let retried = false;
  for (;;) {
    requests++;
    let res: Response;
    let json: unknown;
    try {
      ({ res, value: json } = await fetchWithTimeout(
        deps.fetch,
        chatUrl(baseUrl),
        { method: 'POST', headers: chatHeaders(key, baseUrl), body: JSON.stringify(body), credentials: 'omit' },
        deps.timeoutMs ?? (isLocalBase(baseUrl) ? LOCAL_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS),
        readJson,
      ));
    } catch {
      return { ok: false, reason: 'modelError', countsAsFailure: true, detail: 'network', requests };
    }
    if (res.ok) return { ok: true, json, requests };
    const fail = (reason: ReasonCode, countsAsFailure: boolean): ChatSend => ({ ok: false, reason, countsAsFailure, detail: `http${res.status}`, requests });
    if (res.status === 401 || res.status === 403) return fail('keyRejected', false);
    if (res.status === 402) return fail('creditsExhausted', false);
    if (res.status === 429) {
      const wait = retryAfterMs(res.headers, deps.now());
      if (!retried && wait !== undefined && wait <= MAX_RETRY_AFTER_MS) {
        retried = true;
        await deps.sleep(wait);
        continue;
      }
      return fail('rateLimited', true);
    }
    return fail('modelError', true);
  }
}

/** testCustomEndpoint: one synthetic Tile, no Rules. Error strings: 'keyRejected', 'finishLength', 'http<status>', 'network', … */
export async function testEndpoint(
  deps: ChatDeps,
  req: { baseUrl: string; model: string; key: string },
): Promise<{ ok: true; latencyMs: number } | { ok: false; error: string }> {
  const plan = buildChatRequest([], [], [TEST_TILE], req.model, req.baseUrl);
  const started = deps.now();
  const sent = await sendChat(deps, req.baseUrl, req.key, plan.body);
  if (!sent.ok) return { ok: false, error: sent.reason === 'keyRejected' ? 'keyRejected' : sent.detail };
  const parsed = parseChatResponse(sent.json, plan, req.model);
  return parsed.ok ? { ok: true, latencyMs: deps.now() - started } : { ok: false, error: parsed.detail };
}
