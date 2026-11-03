// Shared library for the Decision model calibration harness (scripts/calibration/README.md).
// Request builders mirror src/engine/decisions.ts (buildTextRequest, buildThumbnailRequest) for the
// shipped `choice` framing and add switchable variants. requests.test.ts checks the mirror against src.
// Never prints or writes the API key. Sends only synthetic Tile facts: no video IDs, no URLs.
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const DATA_DIR = resolve(ROOT, 'test/calibration');
export const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';
export const TIMEOUT_MS = 15_000;
export const MAX_CONCURRENCY = 4;
export const MAX_QUESTIONS = 64;
export const MAX_TILES_PER_BATCH = 16;
export const STATE_TOKEN_BUDGET = 1800;
// evaluate.mjs's default cutoffs: the shipped thumbnail presets, which were also the earlier text presets.
// The shipped text presets are in src/core/verdict.ts STRENGTH_PRESETS (pass them with --cutoffs).
export const CUTOFFS = { cautious: 0.85, balanced: 0.6, eager: 0.35 };
export const P_KEEP_THRESHOLD = 0.5;

// ---------------------------------------------------------------------------------------------------
// Data

export const readJson = (p) => JSON.parse(readFileSync(resolve(DATA_DIR, p), 'utf8'));
export const loadTiles = () => readJson('tiles.json');
export const loadRules = () => readJson('rules.json');
export const loadLabels = () => readJson('labels.json');
export const loadThumbnails = () => readJson('thumbnails.json');

/** OPENROUTER_API_KEY from an env file. The value never leaves this process except in the Authorization header. */
export function readKey(envPath = resolve(ROOT, '.env.local')) {
  const key = readFileSync(envPath, 'utf8').match(/^OPENROUTER_API_KEY=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
  if (!key) throw new Error(`OPENROUTER_API_KEY missing in ${envPath}`);
  return key;
}

// ---------------------------------------------------------------------------------------------------
// Shipped wording, copied from src/engine/decisions.ts (requests.test.ts keeps them equal)

export const CHOICE_TASK =
  'Which rule in viewer_does_not_want does this recommended YouTube video clearly match? Choose keep if it matches none or only shares words with a rule. Videos similar to viewer_kept_anyway should be kept.';
export const KEEP_CRITERION = "Matches none of the rules, including videos that only explain, report on, review or sit near a rule's topic";
export const ruleTask = (text) => `Does this recommended YouTube video match this rule: ${text}?`;
export const thumbnailTask = (text) => `The thumbnail image shows: ${text}`;
export const SURFACE_LABELS = { home: 'home page', watchSidebar: 'watch page sidebar', shortsShelf: 'Shorts shelf' };

/** Choice task variants. `shipped` is CHOICE_TASK. Any other string passed with --task-text is used as is. */
export const CHOICE_TASKS = {
  shipped: CHOICE_TASK,
  noKept: 'Which rule in viewer_does_not_want does this recommended YouTube video match? Choose keep if it matches none.',
  viewer:
    'The viewer does not want videos that match a rule in viewer_does_not_want. Which rule does this recommended YouTube video match? Choose keep if it matches none.',
  strict:
    'Which rule in viewer_does_not_want does this recommended YouTube video clearly match? Choose keep if it matches none or only shares words with a rule.',
};
/** Per-rule noul task variants (remove nouls and Keep nouls). `{rule}` is replaced by the Rule text. */
export const NOUL_TASKS = {
  shipped: 'Does this recommended YouTube video match this rule: {rule}?',
  viewer: 'The viewer wrote this rule: {rule}. Does this recommended YouTube video match it?',
  about: 'Is this recommended YouTube video about the following: {rule}?',
};
export const fillRule = (template, text) => template.replaceAll('{rule}', text);

/** Duration as YouTube shows it: 18:42, 1:02:05 (same as src/engine/decisions.ts formatDuration). */
export function formatDuration(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export const ALL_FIELDS = ['title', 'channel', 'duration', 'surface'];

/** Tile facts as src/engine/decisions.ts videoFacts sends them, limited to `fields`. Title is always sent. */
export function videoFacts(t, fields = ALL_FIELDS) {
  const has = (f) => fields.includes(f);
  return {
    title: t.title,
    ...(has('channel') && t.channel ? { channel: t.channel } : {}),
    ...(has('duration') && t.durationSec != null && Number.isFinite(t.durationSec) ? { duration: formatDuration(t.durationSec) } : {}),
    ...(has('surface') ? { surface: SURFACE_LABELS[t.surface] ?? t.surface } : {}),
  };
}

/** Lowercase provider tags, as listed by /api/v1/models/<slug>/endpoints. Other slugs pin to their prefix unless --provider is given. */
export const PROVIDER_TAGS = {
  'cloudflare/clef-flash': 'cloudflare',
  'cloudflare/clef': 'cloudflare',
  'cloudflare/clef-omni': 'cloudflare',
  'typesafe/jev-1.13': 'typesafe',
  'openai/gpt-6-luna-decisions': 'openai',
  'liquid/d1': 'liquid',
  'perplexity/pplx-decider-v1.1-27b': 'perplexity',
  'inception/mercury-decide': 'inception',
};
export const providerTag = (model, override) => override ?? PROVIDER_TAGS[model] ?? model.replace(/^~/, '').split('/')[0];
export const providerFor = (model, override) => ({ order: [providerTag(model, override)], allow_fallbacks: false, data_collection: 'deny' });

const refKey = (ref) => {
  const m = /^([KRT])(\d+)$/.exec(ref);
  return m ? [0, m[1] === 'K' ? 0 : 1, Number(m[2])] : [1, 0, 0];
};
/** Ref order of src/core/rules.ts sortByRef: K before R, then by number. */
export const sortRefs = (refs) =>
  [...refs].sort((a, b) => {
    const ka = refKey(a), kb = refKey(b);
    for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return a < b ? -1 : a > b ? 1 : 0;
  });
const ordered = (obj) => Object.fromEntries(sortRefs(Object.keys(obj)).map((k) => [k, obj[k]]));

export const estimateTokens = (obj) => Math.ceil(JSON.stringify(obj).length / 4);

/**
 * Tiles per text request. Shipped choice: min(16, floor(64 / (1 + keepRules))). Noul: floor(64 / (rules + keepRules)).
 * `requested` overrides, but never above 64 questions.
 */
export function batchSizeFor({ framing, removeRules, keepRules, requested }) {
  const perTile = (removeRules > 0 ? (framing === 'choice' ? 1 : removeRules) : 0) + keepRules;
  const max = Math.max(1, Math.floor(MAX_QUESTIONS / Math.max(1, perTile)));
  if (requested) {
    if (requested > max) throw new Error(`batch ${requested} would exceed ${MAX_QUESTIONS} questions (${perTile} per Tile, max ${max})`);
    return requested;
  }
  return Math.min(MAX_TILES_PER_BATCH, max);
}

/**
 * Text pass request. Defaults reproduce src/engine/decisions.ts buildTextRequest with the choice framing,
 * no Exceptions. Options:
 *  framing 'choice' | 'noul', criteria 'text' | 'null', choiceTask (string), noulTask / keepTask (template with {rule}),
 *  fields (subset of ALL_FIELDS), keepRules ({K1: text}), exceptions (strings for viewer_kept_anyway), model, provider.
 * Returns { body, specs } where specs maps question id -> { kind, tile, ref?, options? }.
 */
export function buildTextRequest(removeRules, tiles, opts = {}) {
  const {
    model = 'cloudflare/clef-flash',
    provider,
    framing = 'choice',
    criteria = 'text',
    choiceTask = CHOICE_TASK,
    noulTask = NOUL_TASKS.shipped,
    keepTask = NOUL_TASKS.shipped,
    fields = ALL_FIELDS,
    keepRules = {},
    exceptions = [],
  } = opts;
  const remove = ordered(removeRules);
  const keep = ordered(keepRules);
  const hasRemove = Object.keys(remove).length > 0;
  const state = hasRemove ? { viewer_does_not_want: remove } : {};
  if (Object.keys(keep).length) state.viewer_always_wants = keep;
  if (hasRemove && exceptions.length) state.viewer_kept_anyway = exceptions.slice(0, 10);

  const body = { model, provider: providerFor(model, provider), state, questions: {} };
  const specs = new Map();
  tiles.forEach((t, i) => {
    const id = `t${String(i + 1).padStart(2, '0')}`;
    const video = videoFacts(t, fields);
    if (hasRemove) {
      if (framing === 'choice') {
        const crit = criteria === 'null' ? Object.fromEntries(['keep', ...Object.keys(remove)].map((k) => [k, null])) : { keep: KEEP_CRITERION, ...remove };
        body.questions[id] = { type: 'choice', instructions: { task: choiceTask, video }, criteria: crit };
        specs.set(id, { kind: 'choice', tile: i, options: ['keep', ...Object.keys(remove)] });
      } else {
        for (const [ref, text] of Object.entries(remove)) {
          body.questions[`${id}_${ref}`] = { type: 'noul', instructions: { task: fillRule(noulTask, text), video } };
          specs.set(`${id}_${ref}`, { kind: 'rule', tile: i, ref });
        }
      }
    }
    for (const [ref, text] of Object.entries(keep)) {
      body.questions[`${id}_${ref}`] = { type: 'noul', instructions: { task: fillRule(keepTask, text), video } };
      specs.set(`${id}_${ref}`, { kind: 'keep', tile: i, ref });
    }
  });
  if (Object.keys(body.questions).length > MAX_QUESTIONS) throw new Error(`request has more than ${MAX_QUESTIONS} questions`);
  return { body, specs };
}

/**
 * Thumbnail pass request, one Tile, mirroring src/engine/decisions.ts buildThumbnailRequest: the image is a
 * top-level `state` item and question ids are the Thumbnail rule refs. `fields` may drop title or channel.
 */
export function buildThumbnailRequest(thumbRules, tile, dataUrl, opts = {}) {
  const { model = 'cloudflare/clef-flash', provider, fields = ['title', 'channel'], task = 'The thumbnail image shows: {rule}' } = opts;
  const state = [];
  if (fields.includes('title')) state.push(`Title: ${tile.title}`);
  if (fields.includes('channel') && tile.channel) state.push(`Channel: ${tile.channel}`);
  state.push({ type: 'image_url', image_url: { url: dataUrl } });
  const body = { model, provider: providerFor(model, provider), state, questions: {} };
  const specs = new Map();
  for (const [ref, text] of Object.entries(ordered(thumbRules))) {
    body.questions[ref] = { type: 'noul', instructions: fillRule(task, text) };
    specs.set(ref, { kind: 'thumb', tile: 0, ref });
  }
  return { body, specs };
}

// ---------------------------------------------------------------------------------------------------
// Decoding (mirrors src/core/verdict.ts deriveChoiceAnswer, deriveNoulAnswers, deriveKeepAnswers)

const isP = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

export function deriveChoice(a) {
  const probs = a?.probabilities;
  if (probs && typeof probs === 'object') {
    if (!isP(probs.keep)) return null;
    let ref;
    let best = -Infinity;
    for (const [k, p] of Object.entries(probs)) if (k !== 'keep' && isP(p) && p > best) { best = p; ref = k; }
    return { pRemove: 1 - probs.keep, ref: ref ?? null, viaConfidence: false };
  }
  if (typeof a?.choice !== 'string' || !isP(a?.confidence)) return null;
  return a.choice === 'keep' ? { pRemove: 1 - a.confidence, ref: null, viaConfidence: true } : { pRemove: a.confidence, ref: a.choice, viaConfidence: true };
}

export function argmax(pByRef) {
  let ref = null;
  let p = 0;
  for (const [k, v] of Object.entries(pByRef)) if (isP(v) && (ref === null || v > p)) { ref = k; p = v; }
  return { p, ref };
}

const PROB_SUM_TOLERANCE = 0.02;

/**
 * The checks src/engine/decisions.ts validateResponse makes on a 200 body. Returns the problem, or null.
 * The shipped engine rejects the whole response (no Verdict for any Tile in it) when this fails.
 */
export function validateAnswers(specs, json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return 'notObject';
  const answers = json.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return 'answersMissing';
  for (const [id, spec] of specs) {
    const a = answers[id];
    if (!a || typeof a !== 'object' || Array.isArray(a)) return `missingAnswer:${id}`;
    if (spec.kind === 'choice') {
      if (typeof a.choice !== 'string' || !spec.options.includes(a.choice)) return `choiceNotOption:${id}`;
      if (a.probabilities !== undefined) {
        if (!a.probabilities || typeof a.probabilities !== 'object' || Array.isArray(a.probabilities)) return `probabilitiesShape:${id}`;
        if (!Object.keys(a.probabilities).every((k) => spec.options.includes(k))) return `probabilitiesKeys:${id}`;
        const values = Object.values(a.probabilities);
        if (!values.every(isP)) return `probabilityRange:${id}`;
        if (Math.abs(values.reduce((s, p) => s + p, 0) - 1) > PROB_SUM_TOLERANCE) return `probabilitiesSum:${id}`;
      }
      if (deriveChoice(a) === null) return `choiceUnusable:${id}`;
    } else if (!isP(a.noul)) {
      return `noulRange:${id}`;
    }
  }
  if (!json.usage || typeof json.usage !== 'object' || typeof json.usage.input_tokens !== 'number') return 'usageMissing';
  return null;
}

/** Per-Tile results for one 200 response: { pRemove, ref, probs?, pKeep?, keepRef?, keeps?, invalid? }. */
export function decodeAnswers(specs, tileCount, answers) {
  const per = Array.from({ length: tileCount }, () => ({ choice: undefined, rules: {}, keeps: {}, missing: [] }));
  for (const [id, spec] of specs) {
    const a = answers?.[id];
    const slot = per[spec.tile];
    if (!a || typeof a !== 'object') { slot.missing.push(id); continue; }
    if (spec.kind === 'choice') slot.choice = a;
    else if (isP(a.noul)) (spec.kind === 'keep' ? slot.keeps : slot.rules)[spec.ref] = a.noul;
    else slot.missing.push(id);
  }
  const hasKeep = [...specs.values()].some((s) => s.kind === 'keep');
  return per.map((slot) => {
    const out = {};
    if (slot.missing.length) out.invalid = `missing:${slot.missing.join(',')}`;
    if (slot.choice) {
      const d = deriveChoice(slot.choice);
      if (!d) out.invalid = 'choiceUnusable';
      else Object.assign(out, { pRemove: r4(d.pRemove), ref: d.ref, probs: slot.choice.probabilities, ...(d.viaConfidence ? { viaConfidence: true } : {}) });
    } else if (Object.keys(slot.rules).length) {
      const d = argmax(slot.rules);
      Object.assign(out, { pRemove: r4(d.p), ref: d.ref, probs: slot.rules });
    }
    if (hasKeep) {
      const k = argmax(slot.keeps);
      Object.assign(out, { pKeep: r4(k.p), keepRef: k.ref, keeps: slot.keeps });
    }
    return out;
  });
}
const r4 = (x) => Math.round(x * 1e4) / 1e4;

// ---------------------------------------------------------------------------------------------------
// Network

/** Error details safe to log: never the whole body (some carry user_id). */
export function safeError(json) {
  const e = json?.error;
  if (!e || typeof e !== 'object') return undefined;
  return {
    ...(typeof e.code === 'number' ? { code: e.code } : {}),
    ...(typeof e.message === 'string' ? { message: e.message.slice(0, 300) } : {}),
    ...(typeof e.metadata?.failed_routing_step === 'string' ? { failedRoutingStep: e.metadata.failed_routing_step } : {}),
  };
}

/** An error's name and cause code only: messages can quote request headers, including the key. */
export const errorName = (e) => (e?.name === 'TimeoutError' ? 'timeout' : `${e?.name ?? 'Error'}${e?.cause?.code ? `:${e.cause.code}` : ''}`);

/** One POST. status 0 = network error or timeout. */
export async function postDecisions(key, body, timeoutMs = TIMEOUT_MS) {
  const t0 = performance.now();
  try {
    const res = await fetch(DECISIONS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-OpenRouter-Title': 'Shoo calibration' },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = undefined; }
    const header = res.headers.get('retry-after');
    const retryAfter = header === null || header.trim() === '' ? NaN : Number(header);
    return { status: res.status, ms: Math.round(performance.now() - t0), json, retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined };
  } catch (e) {
    return { status: 0, ms: Math.round(performance.now() - t0), json: undefined, netError: errorName(e) };
  }
}

/** Where OpenRouter sees this process (Cloudflare trace): { loc, colo }. No IP is kept. */
export async function routeTrace() {
  try {
    const text = await (await fetch('https://openrouter.ai/cdn-cgi/trace', { signal: AbortSignal.timeout(TIMEOUT_MS) })).text();
    const get = (k) => text.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1];
    return { loc: get('loc'), colo: get('colo') };
  } catch (e) {
    return { error: errorName(e) };
  }
}

/**
 * The endpoint a run pins to, from the public endpoints list: { tag, price ($ per prompt token), name }.
 * Without an explicit tag: the known tag for the model, else its only endpoint, else an error listing the tags.
 */
export async function resolveEndpoint(model, tag) {
  const res = await fetch(`https://openrouter.ai/api/v1/models/${model.replace(/^~/, '')}/endpoints`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`endpoints lookup for ${model}: HTTP ${res.status}`);
  const eps = (await res.json())?.data?.endpoints ?? [];
  const want = tag ?? PROVIDER_TAGS[model];
  const ep = want ? eps.find((e) => e.tag === want) : eps.length === 1 ? eps[0] : undefined;
  if (!ep) throw new Error(`pick a provider for ${model} with --provider (endpoint tags: ${eps.map((e) => e.tag).join(', ') || 'none'})`);
  const price = Number(ep.pricing?.prompt);
  if (!Number.isFinite(price)) throw new Error(`no prompt price for ${model} pinned to ${ep.tag}`);
  return { tag: ep.tag, price, name: ep.name };
}

/** Numeric usage of the key (GET /api/v1/key). Never the label, which can show part of the key. */
export async function keyUsage(key) {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const d = (await res.json())?.data ?? {};
    const pick = ['usage', 'usage_daily', 'limit', 'limit_remaining', 'limit_reset'];
    return Object.fromEntries(pick.filter((k) => d[k] !== undefined).map((k) => [k, d[k]]));
  } catch (e) {
    return { error: errorName(e) };
  }
}

/**
 * Budget guard. `reserve(est)` returns false when spent + in-flight reservations + est would exceed the cap.
 * The estimate for a body is chars x learned $/char (max seen x 1.25), or before the first answer
 * chars / 3 tokens x price x `priorFactor`.
 */
export class Budget {
  constructor(cap, price, priorFactor = 2) {
    if (!(Number.isFinite(cap) && cap > 0)) throw new Error(`budget cap must be a positive number, got ${cap}`);
    if (!(Number.isFinite(price) && price >= 0)) throw new Error(`price must be a number, got ${price}`);
    this.cap = cap;
    this.price = price;
    this.priorFactor = priorFactor;
    this.spent = 0;
    this.reserved = 0;
    this.perChar = 0;
    this.stopped = false;
  }
  estimate(chars) {
    return this.perChar > 0 ? chars * this.perChar * 1.25 : (chars / 3) * this.price * this.priorFactor;
  }
  reserve(est) {
    if (this.stopped || this.spent + this.reserved + est > this.cap) { this.stopped = true; return false; }
    this.reserved += est;
    return true;
  }
  /**
   * Books one attempt. Without usage.cost (some models, timeouts, network errors) it books input tokens x
   * price, or else the estimate, so a missing field can never switch the guard off.
   */
  settle(est, cost, chars, inputTokens) {
    this.reserved -= est;
    if (typeof cost === 'number' && Number.isFinite(cost)) {
      this.spent += cost;
      if (chars > 0) this.perChar = Math.max(this.perChar, cost / chars);
    } else if (typeof inputTokens === 'number' && Number.isFinite(inputTokens)) {
      this.spent += inputTokens * this.price;
    } else {
      this.spent += est;
    }
  }
}

export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

/** Append-only JSONL log. */
export function jsonlWriter(path) {
  mkdirSync(dirname(path), { recursive: true });
  return (obj) => appendFileSync(path, JSON.stringify(obj) + '\n');
}

export function readJsonl(path) {
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/** Seeded shuffle (mulberry32), so every variant can see the same batches. */
export function shuffle(xs, seed) {
  let a = seed | 0;
  const rnd = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return xs.map((x) => [rnd(), x]).sort((p, q) => p[0] - q[0]).map(([, x]) => x);
}

export const chunk = (xs, n) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
