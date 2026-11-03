// Turns calibration run logs (test/calibration/runs/*.jsonl) into metrics. Usage: scripts/calibration/README.md.
//   node scripts/calibration/evaluate.mjs <run.jsonl> [more.jsonl ...] [--json out.json] [--brief] [--by category]
// No network. Ambiguous labels are excluded from headline metrics and counted separately.
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { CUTOFFS, P_KEEP_THRESHOLD, loadLabels, loadRules, loadThumbnails, loadTiles, readJsonl } from './lib.mjs';

const { values: o, positionals: files } = parseArgs({
  allowPositionals: true,
  options: { json: { type: 'string' }, brief: { type: 'boolean', default: false }, by: { type: 'string', multiple: true }, cutoffs: { type: 'string' } },
});
if (!files.length) { console.error('usage: evaluate.mjs <run.jsonl> [...] [--json out.json] [--brief] [--by category] [--cutoffs 0.9,0.75,0.55]'); process.exit(2); }
// --cutoffs <cautious>,<balanced>,<eager> replaces the CUTOFFS preset values, for example the shipped text presets.
const CUT = o.cutoffs ? Object.fromEntries(Object.keys(CUTOFFS).map((k, i) => [k, Number(o.cutoffs.split(',')[i])])) : CUTOFFS;
if (!Object.values(CUT).every((c) => c > 0 && c <= 1)) { console.error('--cutoffs needs three numbers in (0, 1], for example 0.9,0.75,0.55'); process.exit(2); }

// ---- metric helpers -------------------------------------------------------------------------------
const r3 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]; };

function prf(rows, cutoff, score = 'p', gold = 'gold') {
  let tp = 0, fp = 0, fn = 0;
  for (const x of rows) { const pred = x[score] >= cutoff; if (pred && x[gold]) tp++; else if (pred) fp++; else if (x[gold]) fn++; }
  const p = tp + fp ? tp / (tp + fp) : null, r = tp + fn ? tp / (tp + fn) : null;
  const f1 = 2 * tp + fp + fn ? (2 * tp) / (2 * tp + fp + fn) : null;
  return { precision: r3(p), recall: r3(r), f1: r3(f1), tp, fp, fn };
}

/** ROC AUC (Mann-Whitney U, ties count half). */
function auc(rows, score = 'p', gold = 'gold') {
  const pos = rows.filter((x) => x[gold]).map((x) => x[score]), neg = rows.filter((x) => !x[gold]).map((x) => x[score]);
  if (!pos.length || !neg.length) return null;
  let s = 0;
  for (const a of pos) for (const b of neg) s += a > b ? 1 : a === b ? 0.5 : 0;
  return r3(s / (pos.length * neg.length));
}

/** Expected calibration error over 10 equal-width bins. */
function ece(rows, score = 'p', gold = 'gold') {
  if (!rows.length) return null;
  const bins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 }));
  for (const x of rows) { const b = bins[Math.min(9, Math.floor(x[score] * 10))]; b.n++; b.p += x[score]; b.y += x[gold] ? 1 : 0; }
  return r3(bins.reduce((s, b) => s + (b.n ? (b.n / rows.length) * Math.abs(b.p / b.n - b.y / b.n) : 0), 0));
}

function bestF1(rows) {
  let best = { cutoff: null, f1: -1 };
  for (let k = 1; k <= 99; k++) {
    const c = k / 100;
    const m = prf(rows, c);
    if (m.f1 !== null && m.f1 > best.f1) best = { cutoff: c, ...m };
  }
  return best.cutoff === null ? null : best;
}

/** Remove metrics for rows { p, ref, gold, goldRefs }. */
function removeMetrics(rows, full = true) {
  const pos = rows.filter((x) => x.gold).length;
  const out = { n: rows.length, positives: pos, negatives: rows.length - pos, auc: auc(rows) };
  out.cut = Object.fromEntries(Object.entries(CUT).map(([k, c]) => [k, prf(rows, c)]));
  if (!full) return out;
  out.best = bestF1(rows);
  out.ece = ece(rows);
  out.brier = rows.length ? r3(rows.reduce((s, x) => s + (x.p - (x.gold ? 1 : 0)) ** 2, 0) / rows.length) : null;
  const truePos = rows.filter((x) => x.gold);
  const tpBal = truePos.filter((x) => x.p >= CUT.balanced);
  const ok = (x) => x.ref != null && x.goldRefs.includes(x.ref);
  out.attribution = { onTrueRemoves: truePos.length ? r3(truePos.filter(ok).length / truePos.length) : null, onBalancedTruePositives: tpBal.length ? r3(tpBal.filter(ok).length / tpBal.length) : null, n: truePos.length };
  return out;
}

// ---- gold -----------------------------------------------------------------------------------------
const tiles = new Map(loadTiles().map((t) => [t.id, t]));
const labelFile = loadLabels();
const labels = new Map((labelFile.labels ?? labelFile).map((l) => [l.id, l]));
let thumbs;
const facts = (id) => tiles.get(id) ?? (thumbs ??= new Map(loadThumbnails().map((t) => [t.id, t]))).get(id);

/** Rule set B refs whose hard negatives are hard negatives for the run's rule set. */
const rulesFile = loadRules();
const hardRefsFor = (ruleSet) => (rulesFile[ruleSet]?.sameAsB ? new Set(Object.values(rulesFile[ruleSet].sameAsB)) : ruleSet === 'B' ? new Set(Object.keys(rulesFile.B.remove)) : new Set());

/** Gold for one item under the run's rule set: { remove, refs, ambiguous } and keep fields. */
function gold(id, ruleSet, keepRefs) {
  if (ruleSet === 'D') {
    const t = facts(id);
    return t && { remove: t.remove != null, refs: t.removeAll ?? [], ambiguous: !!t.ambiguous };
  }
  const l = labels.get(id);
  if (!l) return undefined;
  const g = ruleSet === 'B' ? l : l[ruleSet]; // A and E labels sit under their own key
  if (!g) return undefined;
  const out = { remove: g.remove != null, refs: g.removeAll ?? [], ambiguous: !!g.ambiguous };
  if (keepRefs) {
    // Same merge rule as merge-labels.mjs, applied to the tested Keep refs only.
    const [a, b] = l.labellers.map((x) => x.keep.filter((r) => keepRefs.includes(r)));
    const shared = a.filter((r) => b.includes(r));
    out.keepAmbiguous = (a.length > 0 || b.length > 0) && shared.length === 0;
    out.keep = shared.length > 0;
    out.keepRefs = shared;
  }
  return out;
}

// ---- one run --------------------------------------------------------------------------------------
function evaluate(path) {
  const lines = readJsonl(path);
  const meta = lines.find((l) => l.type === 'meta');
  if (!meta) { console.error(`skipping ${path}: no meta line, not a run log`); return null; }
  const end = lines.find((l) => l.type === 'end');
  const reqs = lines.filter((l) => l.type === 'request');
  const skippedLines = lines.filter((l) => l.type === 'skipped');
  const cfg = meta.config;
  const keepRefs = cfg.keep && cfg.keep !== 'none' ? keepRefsOf(cfg.keep) : null;

  // Last attempt per request index decides the outcome.
  const last = new Map();
  for (const r of reqs) if (!last.has(r.i) || r.attempt > last.get(r.i).attempt) last.set(r.i, r);
  const finals = [...last.values()];
  const sentIds = new Set(reqs.flatMap((r) => r.ids));
  const skippedIds = new Set(skippedLines.flatMap((s) => s.ids));

  const rows = [];
  let invalid = 0, viaConfidence = 0;
  for (const r of finals) for (const x of r.results ?? []) {
    if (x.invalid || typeof x.pRemove !== 'number' && typeof x.pKeep !== 'number') { invalid++; continue; }
    if (x.viaConfidence) viaConfidence++;
    const g = gold(x.id, cfg.ruleSet, keepRefs);
    if (!g) continue;
    rows.push({ id: x.id, p: x.pRemove, ref: x.ref, pKeep: x.pKeep, keepRef: x.keepRef, gold: g.remove, goldRefs: g.refs, ambiguous: g.ambiguous, keepGold: g.keep, keepGoldRefs: g.keepRefs, keepAmbiguous: g.keepAmbiguous, t: facts(x.id) });
  }
  const answered = rows.length;
  const clear = rows.filter((x) => !x.ambiguous && typeof x.p === 'number');
  const amb = rows.filter((x) => x.ambiguous && typeof x.p === 'number');

  const out = { file: path, experiment: meta.experiment, config: cfg, route: meta.route, cutoffs: CUT, answered, invalid, viaConfidence, ambiguousExcluded: amb.length };
  out.remove = clear.length ? removeMetrics(clear) : null;
  out.ambiguous = amb.length ? { n: amb.length, removedAtBalanced: amb.filter((x) => x.p >= CUT.balanced).length, meanP: r3(amb.reduce((s, x) => s + x.p, 0) / amb.length) } : null;

  // Slices
  const slices = {};
  const slice = (name, pred) => { const s = clear.filter((x) => x.t && pred(x.t)); if (s.length) slices[name] = removeMetrics(s, false); };
  for (const s of ['home', 'watchSidebar', 'shortsShelf']) slice(`surface=${s}`, (t) => t.surface === s);
  for (const l of ['en', 'es', 'de', 'ja', 'hi']) slice(`lang=${l}`, (t) => t.lang === l);
  slice('lang=non-en', (t) => t.lang && t.lang !== 'en');
  const hardRefs = hardRefsFor(cfg.ruleSet);
  const isHard = (t) => hardRefs.has(t?.hardNegative);
  slice('hardNegative (remove rules)', isHard);
  for (const k of o.by ?? []) for (const v of [...new Set(clear.map((x) => x.t?.[k]))].sort()) slice(`${k}=${v}`, (t) => t[k] === v);
  out.slices = slices;
  const hard = clear.filter((x) => isHard(x.t) && !x.gold);
  out.hardNegatives = hard.length ? { n: hard.length, fp: Object.fromEntries(Object.entries(CUT).map(([k, c]) => [k, hard.filter((x) => x.p >= c).map((x) => x.id)])) } : null;

  // Per Rule: recall = share of the Tiles labelled with the Rule that are removed (citing any Rule). Removals citing
  // the Rule (argmax ref) split into true removes and false removes (Tiles labelled keep).
  const refs = Object.keys(cfg.ruleTexts ?? rulesFile[cfg.ruleSet]?.remove ?? {});
  out.perRule = Object.fromEntries(refs.map((ref) => {
    const pos = clear.filter((x) => x.goldRefs.includes(ref));
    return [ref, { positives: pos.length, ...Object.fromEntries(Object.entries(CUT).map(([k, c]) => {
      const cited = clear.filter((x) => x.p >= c && x.ref === ref);
      const falseRemoves = cited.filter((x) => !x.gold).map((x) => x.id);
      return [k, { recall: pos.length ? r3(pos.filter((x) => x.p >= c).length / pos.length) : null, cited: cited.length, falseRemoves }];
    })) }];
  }));

  // Keep questions
  if (keepRefs) {
    const kr = rows.filter((x) => typeof x.pKeep === 'number' && !x.keepAmbiguous).map((x) => ({ ...x, kp: x.pKeep, kg: x.keepGold }));
    const m = prf(kr, P_KEEP_THRESHOLD, 'kp', 'kg');
    const tpK = kr.filter((x) => x.kg && x.kp >= P_KEEP_THRESHOLD);
    out.keep = { refs: keepRefs, n: kr.length, positives: kr.filter((x) => x.kg).length, at05: m, auc: auc(kr, 'kp', 'kg'), attribution: tpK.length ? r3(tpK.filter((x) => x.keepGoldRefs.includes(x.keepRef)).length / tpK.length) : null, excludedAmbiguous: rows.filter((x) => x.keepAmbiguous).length };
    const fin = rows.filter((x) => !x.ambiguous && !x.keepAmbiguous && typeof x.p === 'number' && typeof x.pKeep === 'number').map((x) => ({ fp: x.pKeep < P_KEEP_THRESHOLD ? x.p : 0, fg: x.gold && !x.keepGold }));
    out.finalBalancedWithKeep = prf(fin, CUT.balanced, 'fp', 'fg');
  }

  // Requests, latency, errors, cost
  const okFinal = finals.filter((r) => r.status === 200);
  const statusCounts = {};
  for (const r of reqs) statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
  const cost = reqs.reduce((s, r) => s + (r.cost ?? 0), 0);
  const tokens = reqs.reduce((s, r) => s + (r.inputTokens ?? 0), 0);
  out.requests = {
    planned: cfg.requests, sent: last.size, attempts: reqs.length, skippedByBudget: skippedLines.length, failedFinal: finals.length - okFinal.length,
    errorRate: last.size ? r3((finals.length - okFinal.length) / last.size) : null,
    statusCounts,
    errors: [...new Set(reqs.filter((r) => r.status !== 200).map((r) => `${r.status} ${r.error?.message ?? r.error?.net ?? ''}`.trim()))].slice(0, 10),
    p50ms: pct(okFinal.map((r) => r.ms), 50), p95ms: pct(okFinal.map((r) => r.ms), 95), maxMs: okFinal.length ? Math.max(...okFinal.map((r) => r.ms)) : null,
    providers: [...new Set(okFinal.map((r) => r.provider))],
    rejectedByValidator: okFinal.filter((r) => r.rejected).length,
    rejectReasons: [...new Set(okFinal.filter((r) => r.rejected).map((r) => r.rejected.replace(/:t\d+.*$/, '')))],
  };
  out.cost = { usd: +cost.toFixed(8), inputTokens: tokens, tiles: sentIds.size, tilesSkipped: skippedIds.size, per1kTilesUsd: sentIds.size ? +((cost / sentIds.size) * 1000).toFixed(5) : null, tokensPerTile: sentIds.size ? Math.round(tokens / sentIds.size) : null, stoppedByBudget: end?.stopped === 'budget' };
  return out;
}

function keepRefsOf(spec) {
  const [set, refs] = spec.split(':');
  if (refs) return refs.split(',');
  return set === 'C' ? ['K1', 'K2'] : [];
}

// ---- printing -------------------------------------------------------------------------------------
const f = (x) => (x == null ? '–' : typeof x === 'number' ? String(x) : x);
const pr = (m) => (m ? `${f(m.precision)} / ${f(m.recall)} / ${f(m.f1)}` : '–');

function print(m) {
  const c = m.config;
  console.log(`\n## ${m.experiment}  (${c.pass}, ${c.model} @${c.provider}, rules ${c.ruleSet}, keep ${c.keep}, ${c.framing}${c.pass === 'text' ? `, criteria ${c.criteria}, task ${c.task}, fields ${c.fields.join('+')}, batch ${c.batchSize}` : ''})`);
  console.log(`route loc=${f(m.route?.loc)}  answered ${m.answered}  invalid ${m.invalid}  ambiguous excluded ${m.ambiguousExcluded}${m.viaConfidence ? `  via confidence ${m.viaConfidence}` : ''}`);
  if (m.remove) {
    const r = m.remove;
    console.log(`remove: n ${r.n} (${r.positives} pos / ${r.negatives} neg)  AUC ${f(r.auc)}  ECE ${f(r.ece)}  Brier ${f(r.brier)}`);
    console.log('  cutoff        P / R / F1             TP  FP  FN');
    for (const [k, c] of Object.entries(CUT)) { const x = r.cut[k]; console.log(`  ${k.padEnd(9)} ${String(c).padEnd(4)} ${pr(x).padEnd(22)} ${String(x.tp).padStart(3)} ${String(x.fp).padStart(3)} ${String(x.fn).padStart(3)}`); }
    if (r.best) console.log(`  best F1   ${String(r.best.cutoff).padEnd(4)} ${pr(r.best).padEnd(22)} ${String(r.best.tp).padStart(3)} ${String(r.best.fp).padStart(3)} ${String(r.best.fn).padStart(3)}`);
    console.log(`  attribution: ${f(r.attribution.onTrueRemoves)} on all ${r.attribution.n} true removes, ${f(r.attribution.onBalancedTruePositives)} on Balanced true positives`);
  }
  if (m.ambiguous) console.log(`ambiguous (reported apart): n ${m.ambiguous.n}, removed at Balanced ${m.ambiguous.removedAtBalanced}, mean P(remove) ${m.ambiguous.meanP}`);
  if (Object.keys(m.slices).length) {
    console.log('slices (Balanced P / R / F1, AUC):');
    for (const [k, s] of Object.entries(m.slices)) console.log(`  ${k.padEnd(30)} n ${String(s.n).padStart(3)}  pos ${String(s.positives).padStart(3)}  ${pr(s.cut.balanced).padEnd(22)} AUC ${f(s.auc)}  FP ${s.cut.balanced.fp}`);
  }
  if (m.hardNegatives) console.log(`hard negatives: ${m.hardNegatives.n} labelled keep; removed at Cautious ${m.hardNegatives.fp.cautious.length}, Balanced ${m.hardNegatives.fp.balanced.length} [${m.hardNegatives.fp.balanced.join(' ')}], Eager ${m.hardNegatives.fp.eager.length}`);
  if (Object.keys(m.perRule).length) {
    console.log('per Rule (Cautious / Balanced / Eager): recall of its labelled Tiles, removals citing it, false removes citing it [ids at Balanced]:');
    const each = (r, fn) => ['cautious', 'balanced', 'eager'].map((k) => fn(r[k])).join(' / ');
    for (const [ref, r] of Object.entries(m.perRule)) console.log(`  ${ref.padEnd(4)} pos ${String(r.positives).padStart(3)}  recall ${each(r, (x) => f(x.recall))}  cited ${each(r, (x) => x.cited)}  false ${each(r, (x) => x.falseRemoves.length)} [${r.balanced.falseRemoves.join(' ')}]`);
  }
  if (m.keep) {
    console.log(`keep (${m.keep.refs.join(',')}): n ${m.keep.n}, ${m.keep.positives} pos, at 0.5 P / R / F1 ${pr(m.keep.at05)}  AUC ${f(m.keep.auc)}  attribution ${f(m.keep.attribution)}  ambiguous excluded ${m.keep.excludedAmbiguous}`);
    console.log(`final at Balanced with Keep override: P / R / F1 ${pr(m.finalBalancedWithKeep)}`);
  }
  const q = m.requests;
  console.log(`requests: ${q.sent} sent of ${q.planned}, ${q.attempts} attempts, failed ${q.failedFinal} (rate ${f(q.errorRate)}), skipped by budget ${q.skippedByBudget}, statuses ${JSON.stringify(q.statusCounts)}`);
  if (q.errors.length) console.log(`  errors: ${q.errors.join(' | ')}`);
  if (q.rejectedByValidator) console.log(`  ${q.rejectedByValidator} responses would be rejected by the shipped validator (${q.rejectReasons.join(', ')}); their Tiles count as invalid`);
  console.log(`latency per request: p50 ${f(q.p50ms)} ms, p95 ${f(q.p95ms)} ms, max ${f(q.maxMs)} ms; providers ${q.providers.join(', ')}`);
  console.log(`cost: $${m.cost.usd.toFixed(6)} for ${m.cost.tiles} items sent${m.cost.tilesSkipped ? ` (${m.cost.tilesSkipped} skipped)` : ''}, $${f(m.cost.per1kTilesUsd)} per 1,000, ${f(m.cost.tokensPerTile)} input tokens per item${m.cost.stoppedByBudget ? ', STOPPED BY BUDGET' : ''}`);
}

function table(ms) {
  console.log('\n| experiment | model | AUC | Cautious P/R | Balanced P/R/F1 | Eager P/R | best F1 @cut | attr | ECE | keep P/R | p50/p95 ms | $/1k | err |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const m of ms) {
    const r = m.remove;
    const c = (k) => (r ? `${f(r.cut[k].precision)}/${f(r.cut[k].recall)}` : '–');
    console.log(`| ${m.experiment} | ${m.config.model} | ${f(r?.auc)} | ${c('cautious')} | ${r ? pr(r.cut.balanced).replaceAll(' ', '') : '–'} | ${c('eager')} | ${r?.best ? `${r.best.f1} @${r.best.cutoff}` : '–'} | ${f(r?.attribution.onTrueRemoves)} | ${f(r?.ece)} | ${m.keep ? `${f(m.keep.at05.precision)}/${f(m.keep.at05.recall)}` : '–'} | ${f(m.requests.p50ms)}/${f(m.requests.p95ms)} | ${f(m.cost.per1kTilesUsd)} | ${f(m.requests.errorRate)} |`);
  }
}

const results = files.map(evaluate).filter(Boolean);
if (!results.length) process.exit(1);
if (!o.brief) results.forEach(print);
if (results.length > 1 || o.brief) table(results);
if (o.json) writeFileSync(o.json, JSON.stringify(results, null, 2));
