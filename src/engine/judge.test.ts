import { describe, expect, it } from 'vitest';
import type { SubscribedChannels } from '~/core/subscriptions';
import type { Exception, ReasonCode, Rule, Settings, TileFacts } from '~/core/types';
import type { ThumbModelResult } from '~/core/verdict';
import { DECISIONS_URL, FALLBACK_MODELS, type CachedText, type EngineLog } from './decisions';
import {
  computeAnswerVersions,
  createJudge,
  TRY_TITLE_ID,
  VERDICT_RECORD_VERSION,
  type JudgeContext,
  type JudgeDeps,
  type ModelOutcome,
  type VerdictCacheRecord,
  type VerdictPut,
} from './judge';
import { answerer, fixture, fromFixture, privateDataIn, rule, scriptedFetch, SETTINGS, tile, type RecordedRequest, type Scripted } from './testing';

const CTX: JudgeContext = { private: false, tabId: 1 };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const IMG: Scripted = { status: 200, bytes: JPEG, headers: { 'content-type': 'image/jpeg' } };
const YTIMG = 'https://i.ytimg.com/vi/';

const R1 = rule('R1', 'Reaction videos');
const R2 = rule('R2', 'Crypto hype');
const K2 = rule('K2', 'Programming tutorials');
const BAN = rule('R3', 'Jake Reacts', { kind: 'channel', params: { channelName: 'Jake Reacts' } });
const KW = rule('R4', 'giveaway', { kind: 'keyword' });
const KEEP_CH = rule('K1', 'Code Bites', { kind: 'channel', params: { channelName: 'Code Bites' } });
const TH = rule('R5', 'Shocked faces', { kind: 'thumbnail' });

const id = (n: number) => `video${String(n).padStart(6, '0')}`; // 11 characters, like a YouTube id

/** P(remove) by title, for the scripted choice answers. */
const choose = (title: string): Record<string, number> => {
  if (/react/i.test(title)) return { keep: 0.05, R1: 0.95 };
  if (/altcoin|crypto/i.test(title)) return { keep: 0.2, R2: 0.8 };
  return { keep: 0.97, R1: 0.03 };
};
const keepNoul = (title: string | undefined) => (title && /rust|python|tutorial/i.test(title) ? 0.96 : 0.02);

interface Harness {
  deps: JudgeDeps;
  requests: RecordedRequest[];
  cache: Map<string, VerdictCacheRecord>;
  puts: VerdictPut[][];
  outcomes: ModelOutcome[];
  costs: { usd: number; judged: number; requests: number }[];
  logs: EngineLog[];
  allowedCalls: { ignoreDailyCap: boolean }[];
  settings: Settings;
  rules: Rule[];
}

function harness(opts: {
  rules: Rule[];
  settings?: Partial<Settings>;
  script?: Record<string, (Scripted | ((r: RecordedRequest) => Scripted))[]>;
  exceptions?: Exception[];
  allowed?: { ok: true } | { ok: false; reason: ReasonCode };
  key?: string;
  /** The Subscribed channels the judge is given. A getter, so a test can change the list between calls. */
  subscriptions?: () => SubscribedChannels | undefined;
}): Harness {
  const { fetch, requests } = scriptedFetch(opts.script ?? {});
  const h: Harness = {
    requests,
    cache: new Map(),
    puts: [],
    outcomes: [],
    costs: [],
    logs: [],
    allowedCalls: [],
    settings: { ...SETTINGS, ...opts.settings },
    rules: opts.rules,
    deps: undefined as unknown as JudgeDeps,
  };
  h.deps = {
    now: () => 1000,
    fetch,
    sleep: async () => {},
    getKey: async () => ('key' in opts ? opts.key : 'sk-test'),
    getCustomKey: async () => 'sk-custom',
    getDirectKey: async () => 'sk-direct',
    settings: async () => h.settings,
    rules: async () => h.rules,
    exceptionIds: async (ids) => new Set(ids.filter((v) => (opts.exceptions ?? []).some((e) => e.videoId === v))),
    recentExceptions: async (n, keep) => (opts.exceptions ?? []).filter(keep).slice(0, n),
    ...(opts.subscriptions && { subscriptions: async () => opts.subscriptions!() }),
    cacheGet: async (ids, rv) => new Map(ids.flatMap((v) => (h.cache.get(v)?.rulesVersion === rv ? [[v, h.cache.get(v)!] as const] : []))),
    cachePut: async (puts) => {
      h.puts.push(puts);
      for (const p of puts) {
        const prev = h.cache.get(p.videoId);
        const base = prev && prev.rulesVersion === p.rulesVersion ? prev : {};
        h.cache.set(p.videoId, { ...base, ...(p.text ? { text: p.text } : {}), ...(p.thumb ? { thumb: p.thumb } : {}), rulesVersion: p.rulesVersion, at: p.at });
      }
    },
    addCost: async (c) => void h.costs.push(c),
    recordModelOutcome: async (o) => void h.outcomes.push(o),
    modelAllowed: async ({ ignoreDailyCap }) => {
      h.allowedCalls.push({ ignoreDailyCap });
      return opts.allowed ?? { ok: true };
    },
    priceFor: () => 9e-8,
    log: (e) => h.logs.push(e),
  };
  return h;
}

const decisions = (h: Harness) => h.requests.filter((r) => r.url === DECISIONS_URL);

/** A Verdict cache record as the judge writes it for the harness's current Rules and settings. */
const record = (h: Harness, parts: { text?: CachedText; thumb?: ThumbModelResult }): VerdictCacheRecord => {
  const v = computeAnswerVersions(h.rules, h.settings);
  return {
    ...(parts.text && { text: { ...parts.text, v: v.text } }),
    ...(parts.thumb && { thumb: { ...parts.thumb, v: v.thumb } }),
    rulesVersion: VERDICT_RECORD_VERSION,
    at: 1,
  };
};
const allBodies: unknown[] = [];
const allForbidden = new Set<string>();
const collect = (h: Harness, tiles: TileFacts[]) => {
  for (const r of decisions(h)) allBodies.push(r.body);
  for (const t of tiles) [t.videoId, t.channelId, t.channelHandle].forEach((x) => x && allForbidden.add(x));
};

describe('judgeTiles: stages 1-4 without the model', () => {
  it('decides Keep rules, Exceptions, Banned channels and Exact rules locally, in input order', async () => {
    const h = harness({ rules: [BAN, KW, KEEP_CH], exceptions: [{ videoId: id(2), title: 'x', at: 1 }] });
    const tiles = [
      tile(id(1), 'Rust ownership', { channelName: 'Code Bites' }),
      tile(id(2), 'Anything'),
      tile(id(3), 'Reacting', { channelName: 'Jake Reacts' }),
      tile(id(4), 'Huge GIVEAWAY today'),
      tile(id(5), 'Plain video'),
      tile(id(3), 'Reacting', { channelName: 'Jake Reacts' }),
    ];
    const { results } = await createJudge(h.deps).judgeTiles(tiles, CTX);
    expect(results.map((r) => [r.videoId, r.status, r.verdict?.outcome, r.verdict?.source, r.verdict?.nativeAction, r.verdict?.ruleRef])).toEqual([
      [id(1), 'decided', 'keep', 'keepRule', undefined, 'K1'],
      [id(2), 'decided', 'keep', 'exception', undefined, undefined],
      [id(3), 'decided', 'remove', 'exact', 'dontRecommendChannel', 'R3'],
      [id(4), 'decided', 'remove', 'exact', 'notInterested', 'R4'],
      [id(5), 'decided', 'keep', 'exact', undefined, undefined],
      [id(3), 'decided', 'remove', 'exact', 'dontRecommendChannel', 'R3'],
    ]);
    expect(h.requests).toHaveLength(0);
    expect(h.allowedCalls).toHaveLength(0);
  });

  it('keeps an Artist channel Tile with an Artist channel Keep rule, before Banned channels and the model', async () => {
    const ARTIST = rule('K3', 'Artist channels', { kind: 'artistChannel' });
    const h = harness({ rules: [R1, BAN, ARTIST] });
    const tiles = [tile(id(1), 'Reacting live', { channelName: 'Jake Reacts', isArtistChannel: true }), tile(id(2), 'Reacting live', { channelName: 'Jake Reacts' })];
    const { results } = await createJudge(h.deps).judgeTiles(tiles, CTX);
    expect(results.map((r) => [r.videoId, r.verdict?.outcome, r.verdict?.source, r.verdict?.ruleRef])).toEqual([
      [id(1), 'keep', 'keepRule', 'K3'],
      [id(2), 'remove', 'exact', 'R3'],
    ]);
    expect(h.requests).toHaveLength(0);
  });

  it('never sends the Artist channel badge to the model', async () => {
    const h = harness({ rules: [R1], script: { [DECISIONS_URL]: [answerer({ choose })] } });
    await createJudge(h.deps).judgeTiles([tile(id(1), 'Gardening tips', { channelName: 'Ch', isArtistChannel: true })], CTX);
    expect(h.requests).toHaveLength(1);
    expect(JSON.stringify(h.requests[0]!.body)).not.toMatch(/artist/i);
  });

  it('never sends the view count to the model', async () => {
    const h = harness({ rules: [R1], script: { [DECISIONS_URL]: [answerer({ choose })] } });
    await createJudge(h.deps).judgeTiles([tile(id(1), 'Gardening tips', { channelName: 'Ch', viewCount: 4_321_987 })], CTX);
    expect(h.requests).toHaveLength(1);
    expect(JSON.stringify(h.requests[0]!.body)).not.toMatch(/4321987|viewCount/i); // the framing itself says "viewer"
  });
});

describe('judgeTiles: text pass', () => {
  it('judges 20 Tiles in 2 requests (16 + 4), caches the results and counts 20 judged', async () => {
    const h = harness({ rules: [R1, R2], script: { [DECISIONS_URL]: [answerer({ choose }), answerer({ choose })] } });
    const tiles = Array.from({ length: 20 }, (_, i) =>
      tile(id(i), i % 2 ? `Reacting to fails ${i}` : `Gardening tips ${i}`, { channelName: `Ch ${i}`, channelId: `UCch${i}`, channelHandle: `@ch${i}` }),
    );
    const out = await createJudge(h.deps).judgeTiles(tiles, CTX);
    collect(h, tiles);
    expect(decisions(h).map((r) => Object.keys(r.body.questions).length)).toEqual([16, 4]);
    expect(out.results.map((r) => r.videoId)).toEqual(tiles.map((t) => t.videoId));
    expect(out.results.map((r) => r.verdict?.outcome)).toEqual(tiles.map((_, i) => (i % 2 ? 'remove' : 'keep')));
    expect(out.results[1]!.verdict).toMatchObject({ source: 'model', ruleRef: 'R1', ruleId: R1.id, nativeAction: 'notInterested', rulesVersion: out.rulesVersion });
    expect(out.results[1]!.verdict!.probability).toBeCloseTo(0.95);
    expect(h.cache.size).toBe(20);
    expect(h.cache.get(id(1))!.text).toMatchObject({ ref: 'R1', model: 'cloudflare/clef-flash' });
    expect(h.costs).toEqual([{ usd: 0.0002, judged: 20, requests: 2 }]);
    // One outcome per judgeTiles call, not per request (architecture.md §7).
    expect(h.outcomes).toEqual([{ ok: true, fallback: false }]);
  });

  it('serves a cache hit without a request, re-judges on a rulesVersion change, and re-gates on strength without a request', async () => {
    const h = harness({ rules: [R1, R2], script: { [DECISIONS_URL]: [answerer({ choose }), answerer({ choose })] } });
    const judge = createJudge(h.deps);
    const tiles = [tile(id(1), 'New altcoin will 100x'), tile(id(2), 'Gardening')];
    const first = await judge.judgeTiles(tiles, CTX);
    expect(first.results[0]!.verdict).toMatchObject({ outcome: 'remove', ruleRef: 'R2' }); // 0.8 ≥ Balanced 0.75
    expect(decisions(h)).toHaveLength(1);

    h.settings = { ...h.settings, strength: { preset: 'cautious', custom: 0.6 } };
    const cautious = await judge.judgeTiles(tiles, CTX);
    expect(cautious.results[0]!.verdict).toMatchObject({ outcome: 'keep', source: 'model' }); // 0.8 < Cautious 0.9
    expect(cautious.rulesVersion).toBe(first.rulesVersion);
    expect(decisions(h)).toHaveLength(1);

    h.rules = [R1, { ...R2, text: 'Crypto hype and NFTs' }];
    const changed = await judge.judgeTiles(tiles, CTX);
    expect(changed.rulesVersion).not.toBe(first.rulesVersion);
    expect(decisions(h)).toHaveLength(2);
    collect(h, tiles);
  });

  it("asks each Site only its own Rules, and a Rule for another Site never voids this Site's cached answers", async () => {
    const h = harness({ rules: [R1], script: { [DECISIONS_URL]: [answerer({ choose }), answerer({ choose })] } });
    const judge = createJudge(h.deps);
    const onYouTube = [tile(id(1), 'Streamer reacts')];
    const first = await judge.judgeTiles(onYouTube, CTX);
    const ANIME = rule('R6', 'Anime opening compilations', { site: 'bilibili' });
    h.rules = [R1, ANIME];
    const again = await judge.judgeTiles(onYouTube, CTX);
    expect(decisions(h)).toHaveLength(1);
    expect(again.results[0]!.verdict).toMatchObject({ outcome: 'remove', ruleRef: 'R1' });
    // Content still re-judges on any Rule change, so the version it compares moves.
    expect(again.rulesVersion).not.toBe(first.rulesVersion);
    await judge.judgeTiles([tile('BV1FIXTURE01', '新番导视', { surface: 'bilibiliHome' })], CTX);
    expect(decisions(h)).toHaveLength(2);
    expect(JSON.stringify(decisions(h)[0]!.body)).not.toContain('Anime opening');
    expect(JSON.stringify(decisions(h)[1]!.body)).toContain('Anime opening');
  });

  it('leaves out kept examples whose Rule works only on another Site', async () => {
    const ANIME = rule('R6', 'Anime opening compilations', { site: 'bilibili' });
    const exceptions: Exception[] = [
      { videoId: 'BV1FIXTURE02', title: 'Kept on Bilibili', ruleId: ANIME.id, at: 2 },
      { videoId: id(9), title: 'Kept anywhere', ruleId: R1.id, at: 1 },
    ];
    const h = harness({ rules: [R1, ANIME], exceptions, script: { [DECISIONS_URL]: [answerer({ choose })] } });
    await createJudge(h.deps).judgeTiles([tile(id(1), 'Gardening')], CTX);
    const body = JSON.stringify(decisions(h)[0]!.body);
    expect(body).toContain('Kept anywhere');
    expect(body).not.toContain('Kept on Bilibili');
  });

  it('leaves out kept examples from a Banned channel, an Exact rule or no Rule, which no text question is about', async () => {
    const exceptions: Exception[] = [
      { videoId: id(7), title: 'Kept from a ban', channelName: 'Jake Reacts', ruleId: BAN.id, at: 4 },
      { videoId: id(8), title: 'Kept from a keyword', ruleId: KW.id, at: 3 },
      { videoId: id(9), title: 'Kept from nothing', at: 2 },
      { videoId: id(10), title: 'Kept from a Topic rule', ruleId: R1.id, at: 1 },
    ];
    const h = harness({ rules: [R1, BAN, KW], exceptions, script: { [DECISIONS_URL]: [answerer({ choose })] } });
    await createJudge(h.deps).judgeTiles([tile(id(1), 'Gardening')], CTX);
    expect(decisions(h)[0]!.body.state.viewer_kept_anyway).toEqual(['Kept from a Topic rule']);
  });

  it('never writes the Verdict cache for private-window Tiles', async () => {
    const h = harness({ rules: [R1], script: { [DECISIONS_URL]: [answerer({ choose })] } });
    const out = await createJudge(h.deps).judgeTiles([tile(id(1), 'Reacting to X')], { private: true, tabId: 2 });
    expect(out.results[0]!.verdict).toMatchObject({ outcome: 'remove' });
    expect(h.puts).toEqual([]);
    expect(h.costs).toEqual([{ usd: 0.0001, judged: 1, requests: 1 }]);
  });

  it("keeps a private tab's answers in memory only, so a rescan asks nothing and other tabs never see them", async () => {
    const h = harness({ rules: [R1], script: { [DECISIONS_URL]: Array.from({ length: 4 }, () => answerer({ choose })) } });
    const judge = createJudge(h.deps);
    const tiles = [tile(id(1), 'Reacting to X')];
    const privateTab: JudgeContext = { private: true, tabId: 7 };
    await judge.judgeTiles(tiles, privateTab);
    const again = await judge.judgeTiles(tiles, privateTab);
    expect(again.results[0]!.verdict).toMatchObject({ outcome: 'remove', ruleRef: 'R1' });
    expect(decisions(h)).toHaveLength(1);
    await judge.judgeTiles(tiles, { private: true, tabId: 8 });
    expect(decisions(h)).toHaveLength(2);
    judge.forgetTab(7);
    await judge.judgeTiles(tiles, privateTab);
    expect(decisions(h)).toHaveLength(3);
    expect(h.puts).toEqual([]);
    await judge.judgeTiles(tiles, CTX);
    expect(decisions(h)).toHaveLength(4);
    expect(h.puts.flat().map((p) => p.videoId)).toEqual([id(1)]);
  });

  it('lets a private tab use the answers a normal window cached, without writing any', async () => {
    const h = harness({ rules: [R1], script: { [DECISIONS_URL]: [answerer({ choose })] } });
    const judge = createJudge(h.deps);
    const tiles = [tile(id(1), 'Reacting to X')];
    await judge.judgeTiles(tiles, CTX);
    const inPrivate = await judge.judgeTiles(tiles, { private: true, tabId: 7 });
    expect(inPrivate.results[0]!.verdict).toMatchObject({ outcome: 'remove', ruleRef: 'R1' });
    expect(decisions(h)).toHaveLength(1);
    expect(h.puts).toHaveLength(1);
  });

  it('caches fallback results tagged with the fallback model and records a success', async () => {
    const h = harness({ rules: [R1], script: { [DECISIONS_URL]: [{ status: 503 }, answerer({ choose })] } });
    await createJudge(h.deps).judgeTiles([tile(id(1), 'Reacting to X')], CTX);
    expect(decisions(h)[1]!.body.provider).toEqual({ order: ['typesafe'], allow_fallbacks: false, data_collection: 'deny', zdr: true });
    expect(h.cache.get(id(1))!.text!.model).toBe(FALLBACK_MODELS.text);
    expect(h.outcomes).toEqual([{ ok: true, fallback: true }]);
  });

  it('counts one model failure per exhausted chain and leaves the Tiles undecided', async () => {
    const region = fromFixture(fixture('fallback-jev-text-403-region'));
    const h = harness({ rules: [R1], script: { [DECISIONS_URL]: [region, region] } });
    const out = await createJudge(h.deps).judgeTiles([tile(id(1), 'a'), tile(id(2), 'b')], CTX);
    expect(out.results.map((r) => [r.status, r.reason])).toEqual([
      ['undecided', 'modelError'],
      ['undecided', 'modelError'],
    ]);
    expect(h.outcomes).toEqual([{ ok: false, reason: 'modelError', countsAsFailure: true }]);
    expect(h.puts).toEqual([]);
    expect(h.costs).toEqual([{ usd: 0, judged: 0, requests: 2 }]);
  });

  it('reports a rejected key without counting a model failure', async () => {
    const h = harness({ rules: [R1], script: { [DECISIONS_URL]: [fromFixture(fixture('error-401'))] } });
    const out = await createJudge(h.deps).judgeTiles([tile(id(1), 'a')], CTX);
    expect(out.results[0]).toEqual({ videoId: id(1), status: 'undecided', reason: 'keyRejected' });
    expect(h.outcomes).toEqual([{ ok: false, reason: 'keyRejected', countsAsFailure: false }]);
  });

  it('flags a changed response shape with a keys-only summary and one model failure', async () => {
    const h = harness({ rules: [R1], script: { [DECISIONS_URL]: [{ status: 200, body: { results: [{ title: 'Secret title', p: 0.9 }], usage: { input_tokens: 10, cost: 0.00001 } } }] } });
    const out = await createJudge(h.deps).judgeTiles([tile(id(1), 'Secret title')], CTX);
    expect(out.results[0]).toMatchObject({ status: 'undecided', reason: 'apiShapeChanged' });
    expect(h.outcomes).toEqual([{ ok: false, reason: 'apiShapeChanged', countsAsFailure: true }]);
    expect(h.logs).toEqual([{ event: 'apiShapeChanged', model: 'cloudflare/clef-flash', problem: 'answersMissing', shape: '{results:[1],usage:{input_tokens,cost}}' }]);
    expect(h.costs).toEqual([{ usd: 0.00001, judged: 1, requests: 1 }]); // paid, so counted
  });

  it('splits a batch in half on 413', async () => {
    const h = harness({ rules: [R1], script: { [DECISIONS_URL]: [fromFixture(fixture('error-413')), answerer({ choose }), answerer({ choose })] } });
    const tiles = [1, 2, 3, 4].map((n) => tile(id(n), `Reacting ${n}`));
    const out = await createJudge(h.deps).judgeTiles(tiles, CTX);
    expect(decisions(h).map((r) => Object.keys(r.body.questions))).toEqual([['t01', 't02', 't03', 't04'], ['t01', 't02'], ['t01', 't02']]);
    expect(out.results.every((r) => r.verdict?.outcome === 'remove')).toBe(true);
  });

  it('runs at most 2 text requests in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const slow = (req: RecordedRequest) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      return answerer({ choose })(req);
    };
    const h = harness({ rules: [R1, K2, rule('K3', 'a'), rule('K4', 'b'), rule('K5', 'c'), rule('K6', 'd')], script: {} });
    const order: string[] = [];
    h.deps.fetch = async (url, init) => {
      const req = { url: String(url), init, body: JSON.parse(String(init!.body)) };
      order.push('start');
      const r = slow(req);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      order.push('end');
      return new Response(JSON.stringify(r.body), { status: 200 });
    };
    // 5 Topic Keep rules: 10 Tiles per request, so 40 Tiles make 4 requests.
    const tiles = Array.from({ length: 40 }, (_, i) => tile(id(i), `t${i}`));
    const out = await createJudge(h.deps).judgeTiles(tiles, CTX);
    expect(order.filter((x) => x === 'start')).toHaveLength(4);
    expect(peak).toBe(2);
    expect(out.results.every((r) => r.status === 'decided')).toBe(true);
  });
});

describe('judgeTiles: Topic Keep rules and keep-only questions', () => {
  it('asks only the keep-only question for an exact remove and lets a Topic Keep match win', async () => {
    const h = harness({ rules: [KW, K2], script: { [DECISIONS_URL]: [answerer({ noul: keepNoul })] } });
    const tiles = [tile(id(1), 'Python tutorial GIVEAWAY'), tile(id(2), 'Car GIVEAWAY')];
    const out = await createJudge(h.deps).judgeTiles(tiles, CTX);
    collect(h, tiles);
    const body = decisions(h)[0]!.body;
    expect(body.state).toEqual({ viewer_always_wants: { K2: 'Programming tutorials' } });
    expect(Object.keys(body.questions)).toEqual(['t01_K2', 't02_K2']);
    expect(out.results[0]!.verdict).toMatchObject({ outcome: 'keep', source: 'keepRule', ruleRef: 'K2' });
    expect(out.results[1]!.verdict).toMatchObject({ outcome: 'remove', source: 'exact', ruleRef: 'R4', nativeAction: 'notInterested' });
    expect(h.cache.get(id(1))!.text).toMatchObject({ pKeep: 0.96, keepRef: 'K2', keepOnly: true });
    expect(h.costs).toEqual([{ usd: 0.0001, judged: 0, requests: 1 }]);
  });

  it('sends an undecided Tile only when a Rule could remove it: with Topic Keep rules alone it is kept without a request', async () => {
    const h = harness({ rules: [KW, K2], script: { [DECISIONS_URL]: [answerer({ noul: keepNoul }), answerer({ noul: keepNoul })] } });
    const tiles = [tile(id(1), 'Rust tutorial'), tile(id(2), 'Gardening'), tile(id(3), 'Car GIVEAWAY')];
    const out = await createJudge(h.deps).judgeTiles(tiles, CTX);
    collect(h, tiles);
    // Only the exact remove gets its keep-only question.
    expect(decisions(h).map((r) => Object.keys(r.body.questions))).toEqual([['t01_K2']]);
    expect(decisions(h)[0]!.body.questions.t01_K2.instructions.video.title).toBe('Car GIVEAWAY');
    expect(out.results.map((r) => [r.videoId, r.status, r.verdict?.outcome, r.verdict?.source, r.verdict?.ruleRef])).toEqual([
      [id(1), 'decided', 'keep', 'exact', undefined],
      [id(2), 'decided', 'keep', 'exact', undefined],
      [id(3), 'decided', 'remove', 'exact', 'R4'],
    ]);
    expect([...h.cache.keys()]).toEqual([id(3)]);
    expect(h.costs).toEqual([{ usd: 0.0001, judged: 0, requests: 1 }]);
  });

  it('keeps undecided Tiles with no reason when only Topic Keep rules are enabled, even when the model cannot run', async () => {
    for (const h of [harness({ rules: [K2], allowed: { ok: false, reason: 'noConsent' } }), harness({ rules: [K2], key: undefined })]) {
      const out = await createJudge(h.deps).judgeTiles([tile(id(1), 'Rust tutorial')], CTX);
      expect(out.results).toEqual([
        { videoId: id(1), status: 'decided', verdict: { videoId: id(1), outcome: 'keep', source: 'exact', rulesVersion: out.rulesVersion, at: 1000 } },
      ]);
      expect(h.requests).toEqual([]);
      expect(h.allowedCalls).toEqual([]);
    }
  });

  it('still asks the Topic Keep questions when a Thumbnail rule could remove the Tile, and a Topic Keep match skips the thumbnail', async () => {
    const h = harness({
      rules: [K2, TH],
      script: { [DECISIONS_URL]: [answerer({ noul: keepNoul }), answerer({ noul: () => 0.9 })], [YTIMG]: [IMG] },
    });
    const tiles = [tile(id(1), 'Rust tutorial'), tile(id(2), 'Gardening')];
    const out = await createJudge(h.deps).judgeTiles(tiles, CTX);
    collect(h, tiles);
    expect(decisions(h)[0]!.body.state).toEqual({ viewer_always_wants: { K2: 'Programming tutorials' } });
    expect(Object.keys(decisions(h)[0]!.body.questions)).toEqual(['t01_K2', 't02_K2']);
    expect(h.requests.filter((r) => r.url.startsWith(YTIMG)).map((r) => r.url)).toEqual([`${YTIMG}${id(2)}/mqdefault.jpg`]);
    expect(out.results.map((r) => [r.verdict?.outcome, r.verdict?.source, r.verdict?.ruleRef])).toEqual([
      ['keep', 'keepRule', 'K2'],
      ['remove', 'modelThumbnail', 'R5'],
    ]);
  });

  it('asks a Tile with an exact remove pending the same questions as any other Tile, so the request does not show it', async () => {
    const h = harness({ rules: [KW, R1, K2], script: { [DECISIONS_URL]: [answerer({ choose, noul: keepNoul })] } });
    const tiles = [tile(id(1), 'Reacting to X'), tile(id(2), 'Car GIVEAWAY')];
    const out = await createJudge(h.deps).judgeTiles(tiles, CTX);
    collect(h, tiles);
    expect(decisions(h)).toHaveLength(1);
    expect(Object.keys(decisions(h)[0]!.body.questions)).toEqual(['t01', 't01_K2', 't02', 't02_K2']);
    expect(h.cache.get(id(2))!.text!.keepOnly).toBeUndefined();
    expect(out.results.map((r) => r.verdict?.source)).toEqual(['model', 'exact']);
    expect(h.costs).toEqual([{ usd: 0.0001, judged: 1, requests: 1 }]);
  });

  it('re-asks the full text pass when the cache only holds a keep-only answer', async () => {
    const h = harness({ rules: [R1, K2], script: { [DECISIONS_URL]: [answerer({ choose, noul: keepNoul })] } });
    const judge = createJudge(h.deps);
    h.cache.set(id(1), record(h, { text: { pRemove: 0, pKeep: 0.01, model: 'm', keepOnly: true } }));
    const out = await judge.judgeTiles([tile(id(1), 'Reacting to X')], CTX);
    expect(decisions(h)).toHaveLength(1);
    expect(out.results[0]!.verdict).toMatchObject({ outcome: 'remove', ruleRef: 'R1' });
    expect(h.cache.get(id(1))!.text!.keepOnly).toBeUndefined();
  });

  it.each(['noConsent', 'noKey', 'dailyCap', 'breakerModel', 'offline'] as ReasonCode[])(
    'holds Tiles undecided when the model is not allowed (%s), with keepCheckUnavailable for a pending exact remove',
    async (reason) => {
      const h = harness({ rules: [KW, R1, K2, KEEP_CH], allowed: { ok: false, reason } });
      h.cache.set(id(2), record(h, { text: { pRemove: 0.99, ref: 'R1', model: 'm' } }));
      const out = await createJudge(h.deps).judgeTiles(
        [tile(id(1), 'Car GIVEAWAY'), tile(id(2), 'Reacting'), tile(id(3), 'x', { channelName: 'Code Bites' })],
        CTX,
      );
      expect(out.results.map((r) => [r.status, r.reason ?? r.verdict?.source])).toEqual([
        ['undecided', 'keepCheckUnavailable'],
        ['undecided', reason],
        ['decided', 'keepRule'],
      ]);
      expect(h.requests).toEqual([]);
      expect(h.allowedCalls).toEqual([{ ignoreDailyCap: false }]);
    },
  );

  it('treats a missing key as noKey even when modelAllowed passes', async () => {
    const h = harness({ rules: [R1], key: undefined });
    const out = await createJudge(h.deps).judgeTiles([tile(id(1), 'a')], CTX);
    expect(out.results[0]).toMatchObject({ status: 'undecided', reason: 'noKey' });
  });
});

describe('judgeTiles: chunking, failures and cost accounting', () => {
  it('sends a chunk that holds only exact-remove Tiles with the same state and questions as the other chunks', async () => {
    const keeps = ['K2', 'K3', 'K4', 'K5', 'K6'].map((ref) => rule(ref, `keep ${ref}`));
    const h = harness({ rules: [KW, R1, ...keeps], exceptions: [{ videoId: id(99), title: 'Kept', at: 1, ruleId: R1.id }], script: { [DECISIONS_URL]: [answerer({ choose }), answerer({})] } });
    // 5 Topic Keep rules: 10 Tiles per request. 10 full-pass Tiles, then 3 exact removes in their own chunk.
    const tiles = [...Array.from({ length: 10 }, (_, i) => tile(id(i), `Video ${i}`)), ...[10, 11, 12].map((n) => tile(id(n), `Car GIVEAWAY ${n}`))];
    const out = await createJudge(h.deps).judgeTiles(tiles, CTX);
    const [first, second] = decisions(h).map((r) => r.body);
    expect(Object.keys(first.state)).toEqual(['viewer_does_not_want', 'viewer_always_wants', 'viewer_kept_anyway']);
    expect(second.state).toEqual(first.state);
    expect(Object.keys(second.questions)).toHaveLength(18);
    expect(out.results.slice(10).map((r) => r.verdict?.source)).toEqual(['exact', 'exact', 'exact']);
    collect(h, tiles);
  });

  it('splits 64 or more Topic Keep rules across requests, each at most 64 questions, and merges pKeep as max', async () => {
    const keeps = Array.from({ length: 70 }, (_, i) => rule(`K${i + 1}`, `keep topic ${i + 1}`));
    const noul = (_t: string | undefined, q: string) => (q.endsWith('_K68') ? 0.9 : 0.05);
    const h = harness({ rules: [R1, KW, ...keeps], script: { [DECISIONS_URL]: [answerer({ choose, noul }), answerer({ noul }), answerer({ noul }), answerer({ noul })] } });
    const out = await createJudge(h.deps).judgeTiles([tile(id(1), 'Reacting to X'), tile(id(2), 'Car GIVEAWAY')], CTX);
    const bodies = decisions(h).map((r) => r.body);
    expect(bodies.map((b) => Object.keys(b.questions).length).sort((a, b) => a - b)).toEqual([7, 7, 64, 64]);
    for (const b of bodies) expect(Object.keys(b.questions).length).toBeLessThanOrEqual(64);
    expect(out.results.map((r) => [r.verdict?.outcome, r.verdict?.source, r.verdict?.ruleRef])).toEqual([
      ['keep', 'keepRule', 'K68'],
      ['keep', 'keepRule', 'K68'],
    ]);
    expect(h.cache.get(id(1))!.text).toMatchObject({ ref: 'R1', pKeep: 0.9, keepRef: 'K68' });
    expect(h.cache.get(id(1))!.text!.keepOnly).toBeUndefined();
    expect(h.cache.get(id(2))!.text!.keepOnly).toBeUndefined();
    expect(h.costs).toEqual([{ usd: 0.0004, judged: 1, requests: 4 }]);
  });

  it('reports one model failure for a thumbnail outage across many Tiles', async () => {
    const down: Scripted = { status: 503 };
    const h = harness({ rules: [TH], script: { [YTIMG]: Array(6).fill(IMG), [DECISIONS_URL]: Array(12).fill(down) } });
    const out = await createJudge(h.deps).judgeTiles([1, 2, 3, 4, 5, 6].map((n) => tile(id(n), `t${n}`)), CTX);
    expect(decisions(h)).toHaveLength(12);
    expect(out.results.every((r) => r.reason === 'modelError')).toBe(true);
    expect(h.outcomes).toEqual([{ ok: false, reason: 'modelError', countsAsFailure: true }]);
  });

  it('reports a rejected key over a counted failure when both happen in one call', async () => {
    // 5 Topic Keep rules: chunks of 10 and 1 Tiles. The big chunk hits 500 twice, the small one a 401.
    const byChunk = (req: RecordedRequest): Scripted => (Object.keys(req.body.questions).length > 6 ? { status: 500 } : fromFixture(fixture('error-401')));
    const h = harness({ rules: [R1, K2, rule('K3', 'a'), rule('K4', 'b'), rule('K5', 'c'), rule('K6', 'd')], script: { [DECISIONS_URL]: [byChunk, byChunk, byChunk] } });
    await createJudge(h.deps).judgeTiles(Array.from({ length: 11 }, (_, i) => tile(id(i), `t${i}`)), CTX);
    expect(h.outcomes).toEqual([{ ok: false, reason: 'keyRejected', countsAsFailure: false }]);
  });

  it('keeps paid results when storage fails afterwards, and records cost before the cache write', async () => {
    const h = harness({ rules: [R1], script: { [DECISIONS_URL]: [answerer({ choose })] } });
    const order: string[] = [];
    h.deps.cachePut = async () => {
      order.push('cachePut');
      throw new Error('QUOTA_BYTES quota exceeded');
    };
    const addCost = h.deps.addCost;
    h.deps.addCost = async (c, ctx) => {
      order.push('addCost');
      return addCost(c, ctx);
    };
    const out = await createJudge(h.deps).judgeTiles([tile(id(1), 'Reacting to X')], CTX);
    expect(out.results[0]!.verdict).toMatchObject({ outcome: 'remove' });
    expect(order).toEqual(['addCost', 'cachePut']);
    expect(h.logs).toContainEqual({ event: 'sideEffectFailed', what: 'cachePut' });
  });

  it('awaits an async price for the cost estimate when usage.cost is absent', async () => {
    const noCost = (req: RecordedRequest): Scripted => {
      const r = answerer({ choose })(req);
      delete (r.body as { usage: { cost?: number } }).usage.cost;
      return r;
    };
    const h = harness({ rules: [R1], script: { [DECISIONS_URL]: [noCost] } });
    h.deps.priceFor = async () => 1e-6;
    await createJudge(h.deps).judgeTiles([tile(id(1), 'a')], CTX);
    expect(h.costs[0]!.usd).toBeCloseTo(100 * 1e-6, 12);
  });
});

describe('judgeTiles: thumbnail pass', () => {
  it('skips Tiles with a Topic rule match or a Topic Keep match and fetches only the rest', async () => {
    const h = harness({
      rules: [R1, K2, TH],
      script: {
        [DECISIONS_URL]: [answerer({ choose, noul: (title, q) => (title === undefined ? (q === 'R5' ? 0.9 : 0) : keepNoul(title)) }), answerer({ noul: () => 0.9 })],
        [YTIMG]: [IMG],
      },
    });
    const tiles = [tile(id(1), 'Reacting to X'), tile(id(2), 'Rust tutorial'), tile(id(3), 'Gardening', { channelName: 'Green' })];
    const out = await createJudge(h.deps).judgeTiles(tiles, CTX);
    collect(h, tiles);
    const thumbs = h.requests.filter((r) => r.url.startsWith(YTIMG));
    expect(thumbs.map((r) => r.url)).toEqual([`${YTIMG}${id(3)}/mqdefault.jpg`]);
    expect(thumbs[0]!.init!.credentials).toBe('omit');
    const thumbBody = decisions(h)[1]!.body;
    expect(thumbBody.state).toEqual([{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/4AECAw==' } }]);
    expect(out.results.map((r) => [r.verdict?.outcome, r.verdict?.source, r.verdict?.ruleRef])).toEqual([
      ['remove', 'model', 'R1'],
      ['keep', 'keepRule', 'K2'],
      ['remove', 'modelThumbnail', 'R5'],
    ]);
    expect(h.cache.get(id(3))).toMatchObject({ text: { ref: 'R1' }, thumb: { p: 0.9, ref: 'R5' } }); // argmax ref, P(remove) 0.03: no match
    expect(h.cache.get(id(1))!.thumb).toBeUndefined();
    expect(h.costs).toEqual([{ usd: 0.0002, judged: 3, requests: 2 }]);
  });

  it('refreshes only the thumbnail when the cached text has no thumb and merges it into the record', async () => {
    const h = harness({ rules: [R1, TH], script: { [DECISIONS_URL]: [answerer({ noul: () => 0.25 })], [YTIMG]: [IMG] } });
    const judge = createJudge(h.deps);
    h.cache.set(id(1), record(h, { text: { pRemove: 0.05, ref: 'R1', model: 'cloudflare/clef-flash' } }));
    const out = await judge.judgeTiles([tile(id(1), 'Gardening')], CTX);
    expect(decisions(h).map((r) => Object.keys(r.body.questions))).toEqual([['t01']]);
    const thumbV = computeAnswerVersions(h.rules, h.settings).thumb;
    expect(h.puts).toEqual([[{ videoId: id(1), rulesVersion: VERDICT_RECORD_VERSION, thumb: { p: 0.25, ref: 'R5', model: 'cloudflare/clef-flash', v: thumbV }, at: 1000 }]]);
    expect(h.cache.get(id(1))).toMatchObject({ text: { pRemove: 0.05 }, thumb: { p: 0.25 } });
    expect(out.results[0]!.verdict).toMatchObject({ outcome: 'keep', source: 'model' });
    expect(h.costs).toEqual([{ usd: 0.0001, judged: 0, requests: 1 }]);
  });

  it('keeps cached thumbnail answers through a Topic rule edit, and cached text answers through a Thumbnail rule edit', async () => {
    const h = harness({ rules: [R1, TH], script: { [DECISIONS_URL]: Array.from({ length: 4 }, () => answerer({ noul: () => 0.25 })), [YTIMG]: [IMG, IMG] } });
    const judge = createJudge(h.deps);
    const asked = () => decisions(h).map((r) => (Array.isArray(r.body.state) ? 'thumbnail' : 'text'));
    const tiles = [tile(id(1), 'Gardening')];
    await judge.judgeTiles(tiles, CTX);
    expect(asked()).toEqual(['text', 'thumbnail']);
    h.rules = [rule('R1', 'Reaction videos and livestreams'), TH];
    await judge.judgeTiles(tiles, CTX);
    expect(asked()).toEqual(['text', 'thumbnail', 'text']);
    h.rules = [h.rules[0]!, rule('R5', 'Red arrows', { kind: 'thumbnail' })];
    const out = await judge.judgeTiles(tiles, CTX);
    expect(asked()).toEqual(['text', 'thumbnail', 'text', 'thumbnail']);
    expect(out.results[0]!.verdict).toMatchObject({ outcome: 'keep', source: 'model' });
  });

  it('keeps the Tile without caching when the thumbnail cannot be fetched or is rejected as too large', async () => {
    const h = harness({
      rules: [TH],
      script: { [YTIMG]: [{ status: 404 }, IMG], [DECISIONS_URL]: [fromFixture(fixture('error-422-image-too-large'))] },
    });
    const out = await createJudge(h.deps).judgeTiles([tile(id(1), 'a'), tile(id(2), 'b')], CTX);
    expect(out.results.map((r) => [r.status, r.verdict?.outcome])).toEqual([
      ['decided', 'keep'],
      ['decided', 'keep'],
    ]);
    expect(h.puts).toEqual([]);
    expect(h.outcomes).toEqual([]);
    expect(h.costs).toEqual([{ usd: 0, judged: 0, requests: 1 }]);
  });

  it('ignores Thumbnail rules on a custom endpoint and judges Topic rules through chat', async () => {
    const chat = (req: RecordedRequest): Scripted => ({
      status: 200,
      body: {
        choices: [
          {
            finish_reason: 'stop',
            message: { content: JSON.stringify({ results: JSON.parse(req.body.messages[1].content).map((v: { id: string }) => ({ id: v.id, outcome: 'remove', rule: 'R1', probability: 0.9 })) }) },
          },
        ],
      },
    });
    const h = harness({
      rules: [R1, TH],
      settings: { engine: 'custom', customEndpoint: { baseUrl: 'https://llm.example.com/v1', model: 'my-model' } },
      script: { 'https://llm.example.com/v1/chat/completions': [chat] },
    });
    const out = await createJudge(h.deps).judgeTiles([tile(id(1), 'Reacting')], CTX);
    expect(h.requests.map((r) => r.url)).toEqual(['https://llm.example.com/v1/chat/completions']);
    expect(h.requests[0]!.init!.headers).toEqual({ Authorization: 'Bearer sk-custom', 'Content-Type': 'application/json' });
    expect(out.results[0]!.verdict).toMatchObject({ outcome: 'remove', source: 'model', ruleRef: 'R1' });
    expect(h.cache.get(id(1))!.text!.model).toBe('my-model');
  });

  it('a custom endpoint with an empty key (a local model) is judged without an Authorization header', async () => {
    const h = harness({
      rules: [R1],
      settings: { engine: 'custom', customEndpoint: { baseUrl: 'http://localhost:11434/v1', model: 'qwen3:4b' } },
      script: {
        'http://localhost:11434/v1/chat/completions': [
          (req: RecordedRequest): Scripted => ({
            status: 200,
            body: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ results: JSON.parse(req.body.messages[1].content).map((v: { id: string }) => ({ id: v.id, outcome: 'keep', rule: null, probability: 0.1 })) }) } }] },
          }),
        ],
      },
    });
    h.deps.getCustomKey = async () => '';
    const out = await createJudge(h.deps).judgeTiles([tile(id(1), 'Reacting')], CTX);
    expect(h.requests[0]!.init!.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(out.results[0]).toMatchObject({ status: 'decided' });
  });

  it('a custom endpoint with no stored key is noKey and sends nothing', async () => {
    const h = harness({ rules: [R1], settings: { engine: 'custom', customEndpoint: { baseUrl: 'http://localhost:11434/v1', model: 'qwen3:4b' } } });
    h.deps.getCustomKey = async () => undefined;
    const out = await createJudge(h.deps).judgeTiles([tile(id(1), 'Reacting')], CTX);
    expect(h.requests).toEqual([]);
    expect(out.results[0]).toMatchObject({ status: 'undecided', reason: 'noKey' });
  });
});

describe('judgeTiles: a Decision provider reached directly (§12)', () => {
  const TS = 'https://api.typesafe.ai/v1/systemone';
  const OLLAMA = 'http://localhost:11434/v1/systemone';
  const CF = 'https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/run/@cf/cloudflare';
  // No usage.cost, like every direct endpoint: Shoo estimates spend at the provider's price.
  const noCost = (r: RecordedRequest): Scripted => {
    const a = answerer({ choose, noul: () => 0.9 })(r);
    const body = a.body as { usage: Record<string, number> };
    delete body.usage.cost;
    return a;
  };

  it('TypeSafe: the same questions at its address with its key and model, no fallback, no thumbnails, spend at its price', async () => {
    const h = harness({
      rules: [R1, TH],
      settings: { engine: 'direct', direct: { provider: 'typesafe', baseUrl: 'https://api.typesafe.ai/v1', model: 'jev-1.13.0' } },
      script: { [TS]: [noCost] },
    });
    const out = await createJudge(h.deps).judgeTiles([tile(id(1), 'Reacting'), tile(id(2), 'Bread at home')], CTX);
    // TypeSafe reads no images, so the Thumbnail rule is skipped and no thumbnail is fetched.
    expect(h.requests.map((r) => r.url)).toEqual([TS]);
    expect(h.requests[0]!.init!.headers).toEqual({ Authorization: 'Bearer sk-direct', 'Content-Type': 'application/json' });
    expect(h.requests[0]!.body.model).toBe('jev-1.13.0');
    expect(h.requests[0]!.body.provider).toBeUndefined();
    expect(out.results.map((r) => [r.status, r.verdict?.outcome])).toEqual([
      ['decided', 'remove'],
      ['decided', 'keep'],
    ]);
    expect(h.cache.get(id(1))!.text!.model).toBe('jev-1.13.0');
    // 100 input tokens at TypeSafe's published $0.042 per million.
    expect(h.costs[0]!.usd).toBeCloseTo(100 * 0.042e-6, 12);
    expect(h.outcomes).toEqual([{ ok: true, fallback: false }]);
  });

  it('a 503 from the provider fails once with no OpenRouter fallback and counts one model failure', async () => {
    const h = harness({
      rules: [R1],
      settings: { engine: 'direct', direct: { provider: 'typesafe', baseUrl: 'https://api.typesafe.ai/v1', model: 'jev-1.13.0' } },
      script: { [TS]: [{ status: 503 }] },
    });
    const out = await createJudge(h.deps).judgeTiles([tile(id(1), 'Reacting')], CTX);
    expect(h.requests.map((r) => r.url)).toEqual([TS]);
    expect(out.results[0]).toMatchObject({ status: 'undecided', reason: 'modelError' });
    expect(h.outcomes).toEqual([{ ok: false, reason: 'modelError', countsAsFailure: true }]);
  });

  it('Ollama with clef-flash and an empty key judges titles and thumbnails on this computer', async () => {
    const h = harness({
      rules: [R1, TH],
      settings: { engine: 'direct', direct: { provider: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'clef-flash' } },
      script: { [OLLAMA]: [noCost, noCost], [YTIMG]: [IMG] },
    });
    h.deps.getDirectKey = async () => '';
    const out = await createJudge(h.deps).judgeTiles([tile(id(2), 'Bread at home')], CTX);
    expect(h.requests.map((r) => r.url.startsWith(YTIMG) ? 'ytimg' : r.url)).toEqual([OLLAMA, 'ytimg', OLLAMA]);
    expect(h.requests.filter((r) => r.url === OLLAMA).every((r) => !('Authorization' in (r.init!.headers as object)))).toBe(true);
    const thumb = h.requests[2]!.body;
    expect(thumb.images).toEqual([Buffer.from(JPEG).toString('base64')]);
    expect(JSON.stringify(thumb.state)).not.toContain('image_url');
    expect(out.results[0]!.verdict).toMatchObject({ outcome: 'remove', source: 'modelThumbnail', ruleRef: 'R5' });
    expect(h.costs[0]!.usd).toBe(0);
  });

  it('Cloudflare: unwraps the answer, and a stored key that is missing means noKey with nothing sent', async () => {
    const wrapped = (r: RecordedRequest): Scripted => ({ status: 200, body: { result: answerer({ choose })(r).body, success: true, errors: [], messages: [] } });
    const settings = { engine: 'direct' as const, direct: { provider: 'cloudflare' as const, baseUrl: CF, model: 'clef-flash' } };
    const h = harness({ rules: [R1], settings, script: { [`${CF}/clef-flash`]: [wrapped] } });
    const out = await createJudge(h.deps).judgeTiles([tile(id(1), 'Reacting')], CTX);
    expect(out.results[0]!.verdict).toMatchObject({ outcome: 'remove', ruleRef: 'R1' });
    const none = harness({ rules: [R1], settings });
    none.deps.getDirectKey = async () => undefined;
    expect((await createJudge(none.deps).judgeTiles([tile(id(1), 'Reacting')], CTX)).results[0]).toMatchObject({ status: 'undecided', reason: 'noKey' });
    expect(none.requests).toEqual([]);
  });

  it('never sends Ollama a choice question over its 26 options: 25 remove Topic rules go out, 26 hold the Tiles as tooManyRules', async () => {
    const topics = (n: number) => Array.from({ length: n }, (_, i) => rule(`R${i + 1}`, `Topic ${i}`));
    const settings = { engine: 'direct' as const, direct: { provider: 'ollama' as const, baseUrl: 'http://localhost:11434/v1', model: 'clef-flash' } };
    const ok = harness({ rules: topics(25), settings, script: { [OLLAMA]: [answerer({})] } });
    await createJudge(ok.deps).judgeTiles([tile(id(1), 'Bread at home')], CTX);
    expect(Object.keys(ok.requests[0]!.body.questions.t01.criteria)).toHaveLength(26);
    const over = harness({ rules: [...topics(26), BAN, K2], settings, script: { [OLLAMA]: [answerer({})] } });
    const out = await createJudge(over.deps).judgeTiles([tile(id(1), 'Bread at home'), tile(id(2), 'x', { channelName: 'Jake Reacts' })], CTX);
    expect(over.requests.filter((r) => r.url === OLLAMA).map((r) => Object.keys(r.body.questions))).toEqual([['t01_K2']]);
    expect(out.results[0]).toMatchObject({ status: 'undecided', reason: 'tooManyRules' });
    // The Banned channel Tile still gets its Topic Keep question (noul only), so it is decided.
    expect(out.results[1]).toMatchObject({ status: 'decided' });
    // Nothing was refused, so nothing counts toward the breaker.
    expect(over.outcomes.every((o) => o.ok)).toBe(true);
  });

  it('holds thumbnails as tooManyRules when the Thumbnail rules pass the choice option limit, as for Topic rules', async () => {
    const thumbs = Array.from({ length: 26 }, (_, i) => rule(`R${i + 1}`, `Look ${i}`, { kind: 'thumbnail' }));
    const settings = { engine: 'direct' as const, direct: { provider: 'ollama' as const, baseUrl: 'http://localhost:11434/v1', model: 'clef-flash' } };
    const h = harness({ rules: thumbs, settings });
    const out = await createJudge(h.deps).judgeTiles([tile(id(1), 'Bread at home')], CTX);
    expect(h.requests).toEqual([]);
    expect(out.results[0]).toMatchObject({ status: 'undecided', reason: 'tooManyRules' });
  });

  it("engine 'direct' with no saved endpoint is noKey and never falls back to OpenRouter", async () => {
    const h = harness({ rules: [R1], settings: { engine: 'direct' } });
    const out = await createJudge(h.deps).judgeTiles([tile(id(1), 'Reacting')], CTX);
    expect(h.requests).toEqual([]);
    expect(out.results[0]).toMatchObject({ status: 'undecided', reason: 'noKey' });
  });

  it('a different direct model or address changes rulesVersion, so cached answers from another model are not reused', () => {
    const judge = createJudge(harness({ rules: [R1] }).deps);
    const direct = (model: string) => ({ ...SETTINGS, engine: 'direct' as const, direct: { provider: 'ollama' as const, baseUrl: 'http://localhost:11434/v1', model } });
    expect(judge.rulesVersionFor([R1], direct('clef-flash'))).not.toBe(judge.rulesVersionFor([R1], direct('tev1')));
    expect(judge.rulesVersionFor([R1], direct('clef-flash'))).not.toBe(judge.rulesVersionFor([R1], SETTINGS));
    // OpenRouter users keep their rulesVersion: a saved but unused direct endpoint changes nothing.
    expect(judge.rulesVersionFor([R1], { ...SETTINGS, direct: direct('x').direct })).toBe(judge.rulesVersionFor([R1], SETTINGS));
  });
});

describe('judgeTiles: last-moment checks, spend and redirects', () => {
  const chatUrl = 'https://llm.example.com/v1/chat/completions';
  const CUSTOM = { engine: 'custom' as const, customEndpoint: { baseUrl: 'https://llm.example.com/v1', model: 'my-model' } };

  it('re-checks modelAllowed right before each request and sends nothing once it fails', async () => {
    const h = harness({ rules: [R1] });
    let calls = 0;
    h.deps.modelAllowed = async () => (++calls === 1 ? { ok: true } : { ok: false, reason: 'noConsent' });
    const out = await createJudge(h.deps).judgeTiles([tile(id(1), 'Reacting')], CTX);
    expect(h.requests).toEqual([]);
    expect(out.results[0]).toMatchObject({ status: 'undecided', reason: 'noConsent' });
    expect(h.outcomes).toEqual([]);
    expect(h.costs).toEqual([]);
  });

  it('sends nothing when the engine changed after the batch started', async () => {
    const h = harness({ rules: [R1] });
    const judge = createJudge(h.deps);
    h.deps.modelAllowed = async () => {
      h.settings = { ...h.settings, ...CUSTOM }; // the engine switch lands while the batch waits
      return { ok: true };
    };
    const out = await judge.judgeTiles([tile(id(1), 'Reacting')], CTX);
    expect(h.requests).toEqual([]);
    expect(out.results[0]).toMatchObject({ status: 'undecided', reason: 'noConsent' });
  });

  it('adds every concurrent request cost when the price comes from an async lookup', async () => {
    const noCost = (req: RecordedRequest): Scripted => {
      const r = answerer({ choose })(req);
      delete (r.body as { usage: { cost?: number } }).usage.cost;
      return r;
    };
    const h = harness({ rules: [R1], script: { [DECISIONS_URL]: [noCost, noCost] } });
    h.deps.priceFor = () => new Promise((resolve) => setTimeout(() => resolve(1e-6), 5));
    const tiles = Array.from({ length: 32 }, (_, i) => tile(id(i), `Video ${i}`));
    await createJudge(h.deps).judgeTiles(tiles, CTX);
    expect(decisions(h)).toHaveLength(2);
    expect(h.costs[0]!.usd).toBeCloseTo(2 * 100 * 1e-6, 12);
  });

  it('counts a paid custom endpoint reply that fails to parse as spend', async () => {
    const h = harness({
      rules: [R1],
      settings: CUSTOM,
      script: { [chatUrl]: [{ status: 200, body: { choices: [{ finish_reason: 'length', message: { content: '' } }], usage: { cost: 0.003 } } }] },
    });
    const out = await createJudge(h.deps).judgeTiles([tile(id(1), 'Reacting')], CTX);
    expect(out.results[0]).toMatchObject({ status: 'undecided', reason: 'modelError' });
    expect(h.costs).toEqual([{ usd: 0.003, judged: 1, requests: 1 }]);
  });

  it('never follows redirects on Decisions, thumbnail and custom endpoint requests', async () => {
    const h = harness({ rules: [TH], script: { [DECISIONS_URL]: [answerer({ noul: () => 0.1 })], [YTIMG]: [IMG] } });
    await createJudge(h.deps).judgeTiles([tile(id(1), 'a')], CTX);
    const chat = (req: RecordedRequest): Scripted => ({
      status: 200,
      body: { choices: [{ message: { content: JSON.stringify({ results: JSON.parse(req.body.messages[1].content).map((v: { id: string }) => ({ id: v.id, outcome: 'keep', rule: null, probability: 0.1 })) }) } }] },
    });
    const c = harness({ rules: [R1], settings: CUSTOM, script: { [chatUrl]: [chat] } });
    await createJudge(c.deps).judgeTiles([tile(id(2), 'b')], CTX);
    const all = [...h.requests, ...c.requests];
    expect(all.map((r) => r.url.split('/')[2])).toEqual(['i.ytimg.com', 'openrouter.ai', 'llm.example.com']);
    for (const r of all) expect(r.init!.redirect).toBe('error');
  });
});

describe('judgeTiles: Rules that skip Subscribed channels (REQ-RULE-14)', () => {
  const SKIP_R1 = rule('R1', 'Reaction videos', { skipSubscribed: true });
  const SKIP_KW = rule('R4', 'giveaway', { kind: 'keyword', skipSubscribed: true });
  const SUBS: SubscribedChannels = { ids: [], handles: ['sub'], keys: [] };
  const NONE: SubscribedChannels = { ids: [], handles: ['someoneelse'], keys: [] };
  /** R1 matches reaction titles when it is asked. Without R1 in the criteria they are kept. */
  const r1Answers = (req: RecordedRequest): Scripted => {
    const asksR1 = Object.values<any>(req.body.questions).some((q) => q.type === 'choice' && 'R1' in q.criteria);
    return answerer({ choose: (title): Record<string, number> => (asksR1 && /react/i.test(title) ? { keep: 0.05, R1: 0.95 } : { keep: 0.97, R2: 0.03 }) })(req);
  };
  const criteriaFor = (h: Harness, title: string) =>
    decisions(h).flatMap((r) => Object.values<any>(r.body.questions).filter((q) => q.type === 'choice' && q.instructions.video.title === title).map((q) => Object.keys(q.criteria)));

  it("asks a Subscribed channel's Tile only the Rules that apply to it, in a request of its own", async () => {
    const h = harness({ rules: [SKIP_R1, R2], subscriptions: () => SUBS, script: { [DECISIONS_URL]: [r1Answers, r1Answers] } });
    const tiles = [tile(id(1), 'Reacting to cooking fails', { channelHandle: '@Sub' }), tile(id(2), 'Reacting to the news', { channelName: 'Other' })];
    const { results } = await createJudge(h.deps).judgeTiles(tiles, CTX);
    expect(results.map((r) => [r.videoId, r.verdict?.outcome, r.verdict?.ruleRef])).toEqual([
      [id(1), 'keep', undefined],
      [id(2), 'remove', 'R1'],
    ]);
    expect(decisions(h)).toHaveLength(2);
    expect(criteriaFor(h, 'Reacting to cooking fails')).toEqual([['keep', 'R2']]);
    expect(criteriaFor(h, 'Reacting to the news')).toEqual([['keep', 'R1', 'R2']]);
    collect(h, tiles);
  });

  it("asks a Subscribed channel's thumbnail only the Thumbnail rules that apply, so a skipping Rule takes no share of the answer", async () => {
    const SKIP_TH = rule('R6', 'A man singing', { kind: 'thumbnail', skipSubscribed: true });
    // The image matches both Rules, the skipping one best. Asked together, R5 gets about 0.40 of the answer.
    const noul = (_t: string | undefined, q: string) => (q === 'R6' ? 0.95 : 0.7);
    const h = harness({ rules: [TH, SKIP_TH], subscriptions: () => SUBS, script: { [DECISIONS_URL]: [answerer({ noul }), answerer({ noul })], [YTIMG]: [IMG, IMG] } });
    const tiles = [tile(id(1), 'Live concert', { channelHandle: '@sub' }), tile(id(2), 'Live concert', { channelName: 'Other' })];
    const { results } = await createJudge(h.deps).judgeTiles(tiles, CTX);
    expect(decisions(h).map((r) => Object.keys(Object.values<any>(r.body.questions)[0].criteria)).sort()).toEqual([
      ['keep', 'R5'],
      ['keep', 'R5', 'R6'],
    ]);
    expect(results.map((r) => [r.verdict?.outcome, r.verdict?.ruleRef])).toEqual([
      ['remove', 'R5'],
      ['remove', 'R6'],
    ]);
  });

  it('sends nothing for a Subscribed channel when every Rule that could remove the Tile skips them', async () => {
    const h = harness({ rules: [SKIP_R1, SKIP_KW], subscriptions: () => SUBS });
    const { results } = await createJudge(h.deps).judgeTiles([tile(id(1), 'Reacting to a giveaway', { channelHandle: '@sub' })], CTX);
    expect(results[0]).toMatchObject({ status: 'decided', verdict: { outcome: 'keep', source: 'exact' } });
    expect(h.requests).toEqual([]);
  });

  it('asks again, and only the Rules that apply, once the channel joins the list', async () => {
    let list = NONE;
    const h = harness({ rules: [SKIP_R1, R2], subscriptions: () => list, script: { [DECISIONS_URL]: [r1Answers, r1Answers] } });
    const judge = createJudge(h.deps);
    const tiles = [tile(id(1), 'Reacting to cooking fails', { channelHandle: '@sub' })];
    expect((await judge.judgeTiles(tiles, CTX)).results[0]!.verdict).toMatchObject({ outcome: 'remove', ruleRef: 'R1' });
    list = SUBS;
    expect((await judge.judgeTiles(tiles, CTX)).results[0]!.verdict).toMatchObject({ outcome: 'keep', source: 'model' });
    // The second answer is cached apart from the first, so the next batch asks nothing.
    expect((await judge.judgeTiles(tiles, CTX)).results[0]!.verdict).toMatchObject({ outcome: 'keep', source: 'model' });
    expect(criteriaFor(h, 'Reacting to cooking fails')).toEqual([
      ['keep', 'R1', 'R2'],
      ['keep', 'R2'],
    ]);
  });

  it('holds a Tile a skipping Rule would remove while no list is usable, and removes one that shows no channel', async () => {
    const h = harness({ rules: [SKIP_KW], subscriptions: () => undefined });
    const { results } = await createJudge(h.deps).judgeTiles(
      [tile(id(1), 'Huge giveaway', { channelName: 'Anyone' }), tile(id(2), 'Huge giveaway', { surface: 'shortsShelf', isShort: true })],
      CTX,
    );
    expect(results).toEqual([
      { videoId: id(1), status: 'undecided', reason: 'subscriptionsUnavailable' },
      expect.objectContaining({ videoId: id(2), status: 'decided', verdict: expect.objectContaining({ outcome: 'remove', ruleRef: 'R4' }) }),
    ]);
  });

  it('removes with a Rule that does not skip Subscribed channels while no list is usable', async () => {
    const plainKw = rule('R6', 'huge', { kind: 'keyword' });
    const h = harness({ rules: [SKIP_KW, plainKw], subscriptions: () => undefined });
    const { results } = await createJudge(h.deps).judgeTiles([tile(id(1), 'Huge giveaway', { channelName: 'Anyone' })], CTX);
    expect(results[0]).toMatchObject({ status: 'decided', verdict: { outcome: 'remove', ruleRef: 'R6' } });
  });

  it("removes a Bilibili Tile as usual and never reads the YouTube list for it", async () => {
    let reads = 0;
    const h = harness({ rules: [SKIP_KW], subscriptions: () => (reads++, undefined) });
    const { results } = await createJudge(h.deps).judgeTiles([tile('BV1FIXTURE01', 'Huge giveaway', { surface: 'bilibiliHome', channelName: 'Anyone' })], CTX);
    expect(results[0]).toMatchObject({ status: 'decided', verdict: { outcome: 'remove', ruleRef: 'R4' } });
    expect(reads).toBe(0);
  });
});

describe('judgeTiles: two calls at the same time', () => {
  it('asks a Tile once while two tabs judge it at the same time, and the second tab uses that answer', async () => {
    const h = harness({ rules: [R1], script: { [DECISIONS_URL]: [answerer({ choose })] } });
    const judge = createJudge(h.deps);
    const tiles = [tile(id(1), 'Reacting to X'), tile(id(2), 'Gardening')];
    const [first, second] = await Promise.all([judge.judgeTiles(tiles, CTX), judge.judgeTiles(tiles, { private: false, tabId: 2 })]);
    expect(decisions(h)).toHaveLength(1);
    expect(second.results).toEqual(first.results);
    expect(second.results[0]!.verdict).toMatchObject({ outcome: 'remove', ruleRef: 'R1' });
    expect(h.costs).toEqual([{ usd: 0.0001, judged: 2, requests: 1 }]);
  });

  it('never shares an answer between a private tab and any other tab', async () => {
    const h = harness({ rules: [R1], script: { [DECISIONS_URL]: [answerer({ choose }), answerer({ choose }), answerer({ choose })] } });
    const judge = createJudge(h.deps);
    const tiles = [tile(id(1), 'Reacting to X')];
    await Promise.all([judge.judgeTiles(tiles, CTX), judge.judgeTiles(tiles, { private: true, tabId: 7 }), judge.judgeTiles(tiles, { private: true, tabId: 8 })]);
    expect(decisions(h)).toHaveLength(3);
  });

  it('gives the waiting tab the reason when the asking tab gets no answer', async () => {
    const h = harness({ rules: [R1], script: { [DECISIONS_URL]: [{ status: 401, body: { error: { code: 401, message: 'No auth' } } }] } });
    const judge = createJudge(h.deps);
    const tiles = [tile(id(1), 'Reacting to X')];
    const [, second] = await Promise.all([judge.judgeTiles(tiles, CTX), judge.judgeTiles(tiles, { private: false, tabId: 2 })]);
    expect(decisions(h)).toHaveLength(1);
    expect(second.results[0]).toMatchObject({ status: 'undecided', reason: 'keyRejected' });
  });
});

describe('tryTitle', () => {
  it('runs the pipeline without the Verdict cache or the daily cap and returns the cost', async () => {
    const h = harness({ rules: [R1, TH], script: { [DECISIONS_URL]: [answerer({ choose: () => ({ keep: 0.9, R1: 0.1 }) }), answerer({ noul: () => 0.95 })], [YTIMG]: [IMG] } });
    const judge = createJudge(h.deps);
    h.cache.set('dQw4w9WgXcQ', record(h, { text: { pRemove: 0.99, ref: 'R1', model: 'm' } }));
    const out = await judge.tryTitle({ title: '  Gardening  ', channelName: 'Green', thumbnailUrl: 'https://youtu.be/dQw4w9WgXcQ' }, CTX);
    expect(out).toMatchObject({ costUsd: 0.0002, result: { videoId: 'dQw4w9WgXcQ', status: 'decided', verdict: { outcome: 'remove', source: 'modelThumbnail' } } });
    // The gate, then a re-check right before each of the two requests.
    expect(h.allowedCalls).toEqual([{ ignoreDailyCap: true }, { ignoreDailyCap: true }, { ignoreDailyCap: true }]);
    expect(h.puts).toEqual([]);
    expect(h.costs).toEqual([{ usd: 0.0002, judged: 0, requests: 2 }]);
    expect(decisions(h)[0]!.body.questions.t01.instructions.video).toEqual({ title: 'Gardening', channel: 'Green', surface: 'home page' });
    collect(h, [tile('dQw4w9WgXcQ', 'x')]);
  });

  it('rejects invalid input and reports why the model cannot run', async () => {
    const judge = createJudge(harness({ rules: [R1] }).deps);
    expect(await judge.tryTitle({ title: 'a', thumbnailUrl: 'https://example.com/x.jpg' }, CTX)).toEqual({ error: 'invalidInput' });
    const denied = createJudge(harness({ rules: [R1], allowed: { ok: false, reason: 'noConsent' } }).deps);
    expect(await denied.tryTitle({ title: 'a' }, CTX)).toEqual({ error: 'noConsent' });
  });

  it('uses a synthetic id without a thumbnail URL and keeps the Tile when a thumbnail is needed', async () => {
    const h = harness({ rules: [TH] });
    const out = await createJudge(h.deps).tryTitle({ title: 'a' }, CTX);
    expect(out).toEqual({ costUsd: 0, result: expect.objectContaining({ videoId: TRY_TITLE_ID, status: 'decided' }) });
    expect(h.requests).toEqual([]);
  });

  it('asks a Topic Keep rule even when it is the only model Rule, so it can be tested (REQ-RULE-8)', async () => {
    const h = harness({ rules: [K2], script: { [DECISIONS_URL]: [answerer({ noul: keepNoul }), answerer({ noul: keepNoul })] } });
    const judge = createJudge(h.deps);
    expect(await judge.tryTitle({ title: 'Rust tutorial' }, CTX)).toMatchObject({ result: { verdict: { outcome: 'keep', source: 'keepRule', ruleRef: 'K2' } } });
    const miss = await judge.tryTitle({ title: 'Sourdough basics' }, CTX);
    expect(miss).toMatchObject({ result: { verdict: { outcome: 'keep', source: 'exact' } } });
    expect('result' in miss && miss.result.verdict).not.toHaveProperty('ruleRef');
    expect(decisions(h)).toHaveLength(2);
  });
});

describe('privacy', () => {
  it('never puts a video id, channel id, handle or URL in any Decisions request body', () => {
    expect(allBodies.length).toBeGreaterThan(8);
    expect(privateDataIn(allBodies, [...allForbidden])).toEqual([]);
    for (const b of allBodies as { provider: { allow_fallbacks: boolean } }[]) expect(b.provider.allow_fallbacks).toBe(false);
  });
});

