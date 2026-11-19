// Live end-to-end check against OpenRouter (decision-engine.md Section 11 item 7). Opt-in: `pnpm test:live`.
// Skipped unless OPENROUTER_API_KEY is in .env.local. Never prints the key. Synthetic titles only, the one
// thumbnail is a public i.ytimg.com image whose bytes alone go to OpenRouter. Budget: $0.01 in total.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Rule, TileFacts } from '~/core/types';
import { removeCutoff } from '~/core/verdict';
import { DECISIONS_URL } from './decisions';
import { createJudge, type JudgeDeps, type VerdictCacheRecord } from './judge';
import { privateDataIn, rule, SETTINGS, tile } from './testing';

const envPath = resolve(process.cwd(), '.env.local');
const KEY = existsSync(envPath) ? readFileSync(envPath, 'utf8').match(/^OPENROUTER_API_KEY=(.+)$/m)?.[1]?.trim() : undefined;

// The 20 hand-labelled Tiles of the Decisions API smoke test run before the engine was built (results in
// decision-engine.md). R = remove, K = keep, ? = borderline.
const LABELLED: [string, string, number, 'R' | 'K' | '?'][] = [
  ['Reacting to the WORST cooking fails of 2026', 'Jake Reacts', 1122, 'R'],
  ['How sourdough fermentation actually works', 'Food Science Lab', 845, 'K'],
  ['This altcoin will 100x before Christmas', 'Crypto Kingz', 571, 'R'],
  ['Taylor and Travis: the breakup rumors explained', 'Pop Tea Daily', 720, 'R'],
  ['Rust ownership in 10 minutes', 'Code Bites', 612, 'K'],
  ['Musician reacts to Bohemian Rhapsody for the first time', 'Vocal Coach Ana', 1330, 'R'],
  ['Index funds vs. stock picking: what 30 years of data says', 'Plain Money', 1000, '?'], // known choice false positive in the smoke test
  ['I tried day trading for 30 days with $1,000', 'Max Hustle', 1142, 'R'],
  ['Restoring a rusted 1950s hand plane', 'Workshop Tales', 1513, 'K'],
  ['Drake vs Kendrick: every diss track, in order', 'Rap Lore', 1880, '?'], // missed in a smoke-test batch at Balanced
  ["Bitcoin's whitepaper explained, line by line", 'CS Explained', 1665, '?'],
  ['Our trip to the Faroe Islands (4K)', 'Wander Two', 718, 'K'],
  ['xQc reacts to the new GTA trailer', 'xQc Clips', 933, 'R'],
  ['The physics of a perfect free kick', 'Sports Science', 527, 'K'],
  ['Kardashian family feud gets worse', 'Celeb Buzz', 605, 'R'],
  ['Learn piano chords in 15 minutes', 'Keys Academy', 900, 'K'],
  ['Passive income: 7 side hustles that made me $10k/month', 'Hustle Daily', 817, '?'],
  ['Lecture 1: Introduction to Linear Algebra', 'Open University Courses', 2952, 'K'],
  ['Actor opens up about burnout (podcast clip)', 'The Long Talk', 550, '?'],
  ['Dog sees snow for the first time', 'Happy Paws', 201, 'K'],
];

const RULES: Rule[] = [
  rule('R1', 'Reaction videos, where someone watches and reacts to other content'),
  rule('R2', 'Crypto, day trading, or get-rich-quick finance'),
  rule('R3', 'Celebrity gossip and drama'),
];

function liveDeps(rules: Rule[]) {
  const cache = new Map<string, VerdictCacheRecord>();
  const totals = { usd: 0, requests: 0, judged: 0 };
  const bodies: unknown[] = [];
  const outcomes: unknown[] = [];
  const deps: JudgeDeps = {
    now: () => Date.now(),
    fetch: async (url, init) => {
      if (url === DECISIONS_URL && typeof init?.body === 'string') bodies.push(JSON.parse(init.body));
      return fetch(url, init);
    },
    getKey: async () => KEY,
    getCustomKey: async () => undefined,
    getDirectKey: async () => undefined,
    settings: async () => SETTINGS,
    rules: async () => rules,
    exceptionIds: async () => new Set(),
    recentExceptions: async () => [],
    cacheGet: async () => new Map(),
    cachePut: async (puts) => puts.forEach((p) => cache.set(p.videoId, { text: p.text, thumb: p.thumb, rulesVersion: p.rulesVersion, at: p.at })),
    addCost: async (c) => {
      totals.usd += c.usd;
      totals.requests += c.requests;
      totals.judged += c.judged;
    },
    recordModelOutcome: async (o) => void outcomes.push(o),
    modelAllowed: async () => ({ ok: true }),
  };
  return { deps, cache, totals, bodies, outcomes };
}

describe.skipIf(!KEY)('live: Decisions API end to end', () => {
  let spent = 0;

  it('judges 20 labelled Tiles in 2 requests and lands clear cases on the right side of Balanced', async () => {
    const live = liveDeps(RULES);
    const tiles: TileFacts[] = LABELLED.map(([title, channelName, durationSec], i) =>
      tile(`live${String(i).padStart(7, '0')}`, title, { channelName, durationSec, surface: i % 3 ? 'home' : 'watchSidebar' }),
    );
    const out = await createJudge(live.deps).judgeTiles(tiles, { private: false });
    spent += live.totals.usd;

    expect(live.bodies).toHaveLength(2);
    expect(live.totals).toMatchObject({ requests: 2, judged: 20 });
    expect(live.outcomes).toEqual([{ ok: true, fallback: false }]); // one per call
    expect(privateDataIn(live.bodies, tiles.map((t) => t.videoId))).toEqual([]);

    const cutoff = removeCutoff({ preset: 'balanced', custom: 0.6 }, 'text');
    const rows = out.results.map((r, i) => ({ title: LABELLED[i]![0], label: LABELLED[i]![3], p: live.cache.get(r.videoId)?.text?.pRemove, ref: live.cache.get(r.videoId)?.text?.ref, outcome: r.verdict?.outcome }));
    console.log(rows.map((r) => `${r.label} ${r.outcome?.padEnd(6)} p=${r.p?.toFixed(3)} ${r.ref ?? ''}  ${r.title}`).join('\n'));
    for (const r of rows) {
      expect(r.p).toBeGreaterThanOrEqual(0);
      expect(r.p).toBeLessThanOrEqual(1);
      if (r.label === 'R') expect(r.p, r.title).toBeGreaterThanOrEqual(cutoff);
      if (r.label === 'K') expect(r.p, r.title).toBeLessThan(cutoff);
    }
    expect(out.results.every((r) => r.status === 'decided')).toBe(true);
  });

  it('judges one thumbnail end to end', async () => {
    const live = liveDeps([rule('R8', 'A man singing or dancing', { kind: 'thumbnail' })]);
    const out = await createJudge(live.deps).judgeTiles([tile('dQw4w9WgXcQ', 'Music video from the 80s', { channelName: 'Retro Music Vault' })], { private: false });
    spent += live.totals.usd;
    expect(live.bodies).toHaveLength(1);
    expect(live.totals.requests).toBe(1);
    const thumb = live.cache.get('dQw4w9WgXcQ')?.thumb;
    console.log(`thumbnail p=${thumb?.p} ref=${thumb?.ref} outcome=${out.results[0]!.verdict?.outcome}`);
    expect(thumb).toMatchObject({ ref: 'R8', model: 'cloudflare/clef-flash' });
    expect(thumb!.p).toBeGreaterThanOrEqual(0);
    expect(out.results[0]!.status).toBe('decided');
    expect(privateDataIn(live.bodies, ['dQw4w9WgXcQ'])).toEqual([]);
  });

  it('stays within $0.01 in total', () => {
    console.log(`live total usage.cost: $${spent.toFixed(6)}`);
    expect(spent).toBeGreaterThan(0);
    expect(spent).toBeLessThanOrEqual(0.01);
  });
});
