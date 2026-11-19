// Merges the two blind labellings in test/calibration/labellers/ into test/calibration/labels.json and
// reports inter-labeller agreement (Cohen's kappa). No network.
//   node scripts/calibration/merge-labels.mjs
// Merge rule per Tile and rule set: both say "no rule" -> no remove. Both name rules and share at least one
// -> remove = the first shared ref (labeller 1's order), removeAll = the shared refs. Anything else
// (one says remove and the other not, or no shared ref) -> ambiguous: true. Keep rules merge the same way.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_DIR, loadRules, loadTiles } from './lib.mjs';

const read = (p) => JSON.parse(readFileSync(resolve(DATA_DIR, p), 'utf8'));
const l1 = new Map(read('labellers/labeller1.json').map((x) => [x.id, x]));
const l2 = new Map(read('labellers/labeller2.json').map((x) => [x.id, x]));
// R3 relabelled for rule set E: { id, match, unsure? } per Tile, "get-rich-quick hype only" (definition in `doc` below).
const g1 = new Map(read('labellers/getrich-labeller1.json').map((x) => [x.id, x]));
const g2 = new Map(read('labellers/getrich-labeller2.json').map((x) => [x.id, x]));
const tiles = loadTiles();
const rules = loadRules();
const bToA = Object.fromEntries(Object.entries(rules.A.sameAsB).map(([a, b]) => [b, a]));
const toA = (refs) => refs.filter((r) => bToA[r]).map((r) => bToA[r]);
/** A refs with R3 replaced by the hype-only answer, keeping A's order. */
const toE = (refs, g) => {
  const a = toA(refs).filter((r) => r !== 'R3' || g.match);
  return g.match && !a.includes('R3') ? [...a, 'R3'] : a;
};

function merge(a, b) {
  if (!a.length && !b.length) return { ref: null, all: [], ambiguous: false };
  const shared = a.filter((r) => b.includes(r));
  if (!a.length || !b.length || !shared.length) return { ref: null, all: [], ambiguous: true };
  return { ref: shared[0], all: shared, ambiguous: false };
}

const labels = tiles.map((t) => {
  const x = l1.get(t.id), y = l2.get(t.id), gx = g1.get(t.id), gy = g2.get(t.id);
  if (!x || !y || !gx || !gy) throw new Error(`missing label for ${t.id}`);
  const b = merge(x.remove, y.remove);
  const a = merge(toA(x.remove), toA(y.remove));
  const e = merge(toE(x.remove, gx), toE(y.remove, gy));
  const k = merge(x.keep, y.keep);
  return {
    id: t.id,
    remove: b.ref, removeAll: b.all, ambiguous: b.ambiguous,
    keep: k.ref, keepAll: k.all, keepAmbiguous: k.ambiguous,
    A: { remove: a.ref, removeAll: a.all, ambiguous: a.ambiguous },
    E: { remove: e.ref, removeAll: e.all, ambiguous: e.ambiguous, ...(gx.unsure || gy.unsure ? { unsure: true } : {}) },
    labellers: [{ remove: x.remove, keep: x.keep }, { remove: y.remove, keep: y.keep }],
  };
});

// ---- agreement ------------------------------------------------------------------------------------
function kappa(pairs) {
  const n = pairs.length;
  if (!n) return null;
  const cats = [...new Set(pairs.flat())];
  const po = pairs.filter(([p, q]) => p === q).length / n;
  const pe = cats.reduce((s, c) => s + (pairs.filter(([p]) => p === c).length / n) * (pairs.filter(([, q]) => q === c).length / n), 0);
  return pe === 1 ? 1 : Math.round(((po - pe) / (1 - pe)) * 1000) / 1000;
}
function share(xs, pred) { return xs.length ? Math.round((xs.filter(pred).length / xs.length) * 1000) / 1000 : null; }
const ids = tiles.map((t) => t.id);
const L1 = (id) => l1.get(id), L2 = (id) => l2.get(id);
const yes = (xs) => (xs.length ? 'yes' : 'no');
const bothRemove = ids.filter((id) => L1(id).remove.length && L2(id).remove.length);
const agreement = {
  tiles: ids.length,
  removeB: { kappa: kappa(ids.map((id) => [yes(L1(id).remove), yes(L2(id).remove)])), rawAgreement: share(ids, (id) => yes(L1(id).remove) === yes(L2(id).remove)) },
  removeA: { kappa: kappa(ids.map((id) => [yes(toA(L1(id).remove)), yes(toA(L2(id).remove))])) },
  removeE: { kappa: kappa(ids.map((id) => [yes(toE(L1(id).remove, g1.get(id))), yes(toE(L2(id).remove, g2.get(id)))])) },
  hypeR3: { kappa: kappa(ids.map((id) => [g1.get(id).match, g2.get(id).match])), rawAgreement: share(ids, (id) => g1.get(id).match === g2.get(id).match) },
  keep: { kappa: kappa(ids.map((id) => [yes(L1(id).keep), yes(L2(id).keep)])), rawAgreement: share(ids, (id) => yes(L1(id).keep) === yes(L2(id).keep)) },
  attributionB: {
    kappaPrimaryAllTiles: kappa(ids.map((id) => [L1(id).remove[0] ?? 'none', L2(id).remove[0] ?? 'none'])),
    kappaPrimaryWhereBothRemove: kappa(bothRemove.map((id) => [L1(id).remove[0], L2(id).remove[0]])),
    sharedRefWhereBothRemove: share(bothRemove, (id) => L1(id).remove.some((r) => L2(id).remove.includes(r))),
    bothRemove: bothRemove.length,
  },
  attributionKeep: { kappaPrimaryAllTiles: kappa(ids.map((id) => [L1(id).keep[0] ?? 'none', L2(id).keep[0] ?? 'none'])) },
  perRuleKappa: Object.fromEntries([...Object.keys(rules.B.remove), ...Object.keys(rules.C.keep)].map((ref) => {
    const key = ref.startsWith('K') ? 'keep' : 'remove';
    return [ref, kappa(ids.map((id) => [L1(id)[key].includes(ref), L2(id)[key].includes(ref)]))];
  })),
};

const count = (pred) => labels.filter(pred).length;
const perRule = (set) => Object.fromEntries(Object.keys(rules[set].remove).map((r) => [r, count((l) => (set === 'B' ? l : l[set]).removeAll.includes(r))]));
const summary = {
  B: { remove: count((l) => l.remove), keep: count((l) => !l.ambiguous && !l.remove), ambiguous: count((l) => l.ambiguous), perRule: perRule('B') },
  A: { remove: count((l) => l.A.remove), keep: count((l) => !l.A.ambiguous && !l.A.remove), ambiguous: count((l) => l.A.ambiguous), perRule: perRule('A') },
  E: { remove: count((l) => l.E.remove), keep: count((l) => !l.E.ambiguous && !l.E.remove), ambiguous: count((l) => l.E.ambiguous), perRule: perRule('E'), unsure: labels.filter((l) => l.E.unsure).map((l) => l.id) },
  C: { keep: count((l) => l.keep), notKeep: count((l) => !l.keepAmbiguous && !l.keep), ambiguous: count((l) => l.keepAmbiguous), perRule: { K1: count((l) => l.keepAll.includes('K1')), K2: count((l) => l.keepAll.includes('K2')) } },
};

const doc = 'Gold labels for test/calibration/tiles.json, merged from two blind, independent labellings (test/calibration/labellers/) by scripts/calibration/merge-labels.mjs. remove/removeAll: rule set B refs. A: the same for rule set A (starter rules). E: rule set A with R3 relabelled by two more blind labellers (labellers/getrich-labeller{1,2}.json) for the intent "get-rich-quick hype only", merged the same way. Their definition: MATCH = get-rich-quick money hype: the video promotes or promises fast or easy money (crypto coin pumps or price hype, trading signals, bots or systems sold as easy profits, day-trading-for-a-living or \'I made $X in a day\' hype, passive-income or side-hustle schemes promising quick income, gambling or betting \'systems\'). NO MATCH = videos that explain, teach, analyse, report news on, review, debunk or critique crypto, trading, investing or personal finance, ordinary business, career or money-saving advice, and everything unrelated. E.unsure: a labeller marked the R3 answer unsure (counted as given). keep/keepAll: rule set C refs. ambiguous / keepAmbiguous / A.ambiguous / E.ambiguous: the labellers disagreed; such Tiles are excluded from headline metrics and reported apart.';
const out = { _doc: doc, agreement, summary, labels };
// One label per line keeps diffs readable.
writeFileSync(resolve(DATA_DIR, 'labels.json'), JSON.stringify({ ...out, labels: '__LABELS__' }, null, 2).replace('"__LABELS__"', `[\n${labels.map((l) => '    ' + JSON.stringify(l)).join(',\n')}\n  ]`) + '\n');
console.log(JSON.stringify({ agreement, summary }, null, 2));
