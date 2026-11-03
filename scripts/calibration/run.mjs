// Runs one calibration experiment against OpenRouter's Decisions API and logs every request to
// test/calibration/runs/<experiment>.jsonl. Usage and options: scripts/calibration/README.md.
// Never prints or writes the API key. Sends synthetic Tile facts only: no video IDs, no URLs.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  ALL_FIELDS,
  Budget,
  CHOICE_TASKS,
  DATA_DIR,
  MAX_CONCURRENCY,
  NOUL_TASKS,
  batchSizeFor,
  buildTextRequest,
  buildThumbnailRequest,
  chunk,
  decodeAnswers,
  estimateTokens,
  jsonlWriter,
  keyUsage,
  loadRules,
  loadThumbnails,
  loadTiles,
  pool,
  postDecisions,
  resolveEndpoint,
  readKey,
  safeError,
  validateAnswers,
  routeTrace,
  shuffle,
  sleep,
  STATE_TOKEN_BUDGET,
} from './lib.mjs';

const { values: o } = parseArgs({
  options: {
    experiment: { type: 'string' },
    cap: { type: 'string' },
    pass: { type: 'string', default: 'text' },
    model: { type: 'string', default: 'cloudflare/clef-flash' },
    provider: { type: 'string' },
    rules: { type: 'string' },
    'rule-text': { type: 'string', multiple: true },
    keep: { type: 'string', default: 'none' },
    framing: { type: 'string', default: 'choice' },
    criteria: { type: 'string', default: 'text' },
    task: { type: 'string', default: 'shipped' },
    'task-text': { type: 'string' },
    'noul-task': { type: 'string', default: 'shipped' },
    'keep-task': { type: 'string', default: 'shipped' },
    'thumb-task': { type: 'string', default: 'The thumbnail image shows: {rule}' },
    fields: { type: 'string' },
    batch: { type: 'string' },
    concurrency: { type: 'string', default: '4' },
    tiles: { type: 'string' },
    ids: { type: 'string' },
    where: { type: 'string', multiple: true },
    seed: { type: 'string' },
    price: { type: 'string' },
    env: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
  },
});

const fail = (msg) => { console.error(msg); process.exit(2); };
if (!o.experiment || !/^[\w.-]+$/.test(o.experiment)) fail('--experiment <name> is required (letters, digits, . _ -)');
const cap = Number(o.cap);
if (!o['dry-run'] && !(cap > 0)) fail('--cap <usd> is required, for example --cap 0.01');
const concurrency = Math.min(MAX_CONCURRENCY, Math.max(1, Number(o.concurrency) || 1));
const pass = o.pass;
if (!['text', 'thumbnail'].includes(pass)) fail('--pass text|thumbnail');

const rules = loadRules();
const ruleSetName = o.rules ?? (pass === 'thumbnail' ? 'D' : 'B');
const ruleSet = rules[ruleSetName];
if (!ruleSet?.remove) fail(`unknown rule set ${ruleSetName}`);
// Gold labels exist for A, B and E on Tiles and for D on thumbnails only.
if (pass === 'text' ? !['A', 'B', 'E'].includes(ruleSetName) : ruleSetName !== 'D') fail(`rule set ${ruleSetName} has no labels for the ${pass} pass (text: A, B or E, thumbnail: D)`);
// --rule-text R3=<text> replaces one Rule's wording. The labels stay those of the set.
const removeRules = { ...ruleSet.remove };
for (const s of o['rule-text'] ?? []) {
  const i = s.indexOf('=');
  const ref = s.slice(0, i);
  if (i < 1 || !Object.hasOwn(removeRules, ref) || !s.slice(i + 1).trim()) fail(`--rule-text needs <ref>=<text> with a ref of rule set ${ruleSetName}, got ${s}`);
  removeRules[ref] = s.slice(i + 1);
}

// ---- items ----------------------------------------------------------------------------------------
let items = pass === 'thumbnail' ? loadThumbnails() : loadTiles();
if (o.tiles) {
  const [a, b] = o.tiles.split('-').map(Number);
  items = items.slice(a - 1, b ?? a);
}
if (o.ids) {
  const want = new Set(o.ids.split(','));
  items = items.filter((t) => want.has(t.id));
}
for (const w of o.where ?? []) {
  const [k, v] = w.split('=');
  const vals = v.split(',');
  items = items.filter((t) => vals.includes(String(t[k])));
}
if (o.seed) items = shuffle(items, Number(o.seed));
if (!items.length) fail('no items selected');

// ---- endpoint -------------------------------------------------------------------------------------
const endpoint = o.price ? { tag: o.provider ?? fail('--price needs --provider'), price: Number(o.price) >= 0 ? Number(o.price) : fail('--price must be a number of $ per token') } : await resolveEndpoint(o.model, o.provider).catch((e) => fail(e.message));
const tag = endpoint.tag;

// ---- requests -------------------------------------------------------------------------------------
let keepRules = {};
if (pass === 'text' && o.keep !== 'none') {
  const [set, refs] = o.keep.split(':');
  const all = rules[set]?.keep;
  if (!all) fail(`unknown keep set ${set}`);
  keepRules = refs ? Object.fromEntries(refs.split(',').map((r) => [r, all[r] ?? fail(`unknown keep ref ${r} in ${set}`)])) : all;
}
const fields = o.fields ? o.fields.split(',') : pass === 'thumbnail' ? ['title', 'channel'] : ALL_FIELDS;
const template = (name, table) => table[name] ?? name; // a known variant name or a literal template
const textOpts = {
  model: o.model,
  provider: tag,
  framing: o.framing,
  criteria: o.criteria,
  choiceTask: o['task-text'] ?? CHOICE_TASKS[o.task] ?? fail(`unknown --task ${o.task}`),
  noulTask: template(o['noul-task'], NOUL_TASKS),
  keepTask: template(o['keep-task'], NOUL_TASKS),
  fields,
  keepRules,
};

let batches;
let batchSize = 1;
if (pass === 'text') {
  batchSize = batchSizeFor({ framing: o.framing, removeRules: Object.keys(removeRules).length, keepRules: Object.keys(keepRules).length, requested: o.batch ? Number(o.batch) : undefined });
  batches = chunk(items, batchSize).map((tiles) => ({ ids: tiles.map((t) => t.id), ...buildTextRequest(removeRules, tiles, textOpts) }));
} else {
  batches = items.map((t) => {
    const img = readFileSync(resolve(DATA_DIR, 'thumbnails', t.file));
    const dataUrl = `data:image/jpeg;base64,${img.toString('base64')}`;
    return { ids: [t.id], ...buildThumbnailRequest(removeRules, t, dataUrl, { model: o.model, provider: tag, fields, task: o['thumb-task'] }) };
  });
}
for (const b of batches) b.chars = JSON.stringify(b.body).length;

const stateTokens = pass === 'text' ? estimateTokens(batches[0].body.state) : undefined;
const config = {
  pass,
  model: o.model,
  provider: tag,
  ruleSet: ruleSetName,
  ruleTexts: removeRules,
  keep: o.keep,
  framing: pass === 'text' ? o.framing : 'noul',
  criteria: o.criteria,
  task: o['task-text'] ? 'custom' : o.task,
  choiceTask: textOpts.choiceTask,
  noulTask: textOpts.noulTask,
  keepTask: textOpts.keepTask,
  ...(pass === 'thumbnail' ? { thumbTask: o['thumb-task'] } : {}),
  fields,
  batchSize,
  concurrency,
  cap,
  items: items.length,
  requests: batches.length,
  seed: o.seed ? Number(o.seed) : null,
  selection: { tiles: o.tiles ?? null, ids: o.ids ?? null, where: o.where ?? [] },
  stateTokens,
};
if (stateTokens > STATE_TOKEN_BUDGET) console.warn(`warning: state estimate ${stateTokens} tokens is over Shoo's budget of ${STATE_TOKEN_BUDGET}`);

// ---- dry run --------------------------------------------------------------------------------------
const totalChars = batches.reduce((s, b) => s + b.chars, 0);
if (o['dry-run']) {
  const q = batches.reduce((s, b) => s + Object.keys(b.body.questions).length, 0);
  console.log(JSON.stringify({ ...config, questions: q, bodyChars: totalChars, pricePerToken: endpoint.price, roughCostUsd: +((totalChars / 2.4) * endpoint.price).toFixed(6), sampleBody: batches[0].body }, (k, v) => (k === 'url' && typeof v === 'string' && v.startsWith('data:') ? `${v.slice(0, 40)}…` : v), 2));
  process.exit(0);
}

// ---- live run -------------------------------------------------------------------------------------
const outPath = resolve(DATA_DIR, 'runs', `${o.experiment}.jsonl`);
if (existsSync(outPath)) {
  if (!o.force) fail(`${outPath} exists. Pick another --experiment name or pass --force to replace it.`);
  rmSync(outPath);
}
const log = jsonlWriter(outPath);
const key = readKey(o.env ? resolve(o.env) : undefined);
const route = await routeTrace();
const usageBefore = await keyUsage(key);
console.log(`experiment ${o.experiment}: ${batches.length} requests, ${items.length} items, model ${o.model} pinned to ${tag}, route loc=${route.loc ?? '?'} colo=${route.colo ?? '?'}, cap $${cap}`);
log({ type: 'meta', experiment: o.experiment, startedAt: new Date().toISOString(), config, route, price: endpoint, keyUsageBefore: usageBefore, node: process.version });

const budget = new Budget(cap, endpoint.price);
const started = performance.now();
let skipped = 0;

async function runBatch(b, i) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const est = budget.estimate(b.chars);
    if (!budget.reserve(est)) { skipped++; log({ type: 'skipped', i, reason: 'budget', ids: b.ids, estimate: est }); return; }
    const r = await postDecisions(key, b.body);
    const usage = r.json?.usage ?? {};
    budget.settle(est, usage.cost, b.chars, usage.input_tokens);
    const rec = {
      type: 'request', i, attempt, model: r.json?.model ?? o.model, provider: r.json?.provider ?? null, status: r.status, ms: r.ms,
      inputTokens: usage.input_tokens ?? null, cost: usage.cost ?? null, questions: Object.keys(b.body.questions).length, chars: b.chars, ids: b.ids,
    };
    if (r.status === 200) {
      // Answers the shipped validator would reject are kept for diagnosis but marked invalid, as the engine
      // would give no Verdict for any Tile in the response.
      const problem = validateAnswers(b.specs, r.json);
      const results = decodeAnswers(b.specs, b.ids.length, r.json?.answers);
      if (problem) rec.rejected = problem;
      rec.results = results.map((x, j) => ({ id: b.ids[j], ...x, ...(problem ? { invalid: `rejected:${problem}` } : {}) }));
    } else {
      rec.error = r.netError ? { net: r.netError } : (safeError(r.json) ?? { body: 'unparsed' });
    }
    log(rec);
    const retryable = r.status === 0 || r.status === 429 || r.status >= 500;
    if (!retryable || attempt === 2) return;
    if (r.retryAfterMs !== undefined && r.retryAfterMs > 10_000) return; // the engine would not wait that long either
    await sleep(r.retryAfterMs ?? 2000);
  }
}

// The first request runs alone so the budget guard learns the real $/char before going parallel.
await runBatch(batches[0], 0);
await pool(batches.slice(1), concurrency, (b, j) => runBatch(b, j + 1));

const usageAfter = await keyUsage(key);
const end = { type: 'end', finishedAt: new Date().toISOString(), wallMs: Math.round(performance.now() - started), spentUsd: +budget.spent.toFixed(8), stopped: budget.stopped ? 'budget' : null, skipped, keyUsageAfter: usageAfter };
log(end);
console.log(`done: spent $${end.spentUsd.toFixed(6)} (usage.cost sum), wall ${end.wallMs} ms${end.stopped ? `, STOPPED by budget cap, ${skipped} requests skipped` : ''}`);
console.log(`log: ${outPath}`);
