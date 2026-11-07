// The judging pipeline, stages 1-7 and gating (background only). Source of truth: docs/spec/decision-engine.md
// Sections 1, 2.5, 4, 5, 7.5 and 8.3, docs/spec/architecture.md Sections 5 and 7.
// Storage is reached only through JudgeDeps, so the background router wires the real store.
import { MAX_KEPT_EXAMPLES, MAX_QUESTIONS_PER_REQUEST } from '~/core/budget';
import { tileChannelIdentity } from '~/core/channel';
import { compileExact, type CompiledExact } from '~/core/exact';
import { answerVersions, cacheVersion, exactVersion, rulesVersion, type RulesVersionInputs } from '~/core/ids';
import { directProvider, readsImages, topicRuleLimit } from '~/core/providers';
import { activeRules, exampleOn, rulesOn, runExactStages, type ExactStageOutcome } from '~/core/rules';
import { SURFACE_SITE } from '~/core/sites';
import { subscribedMatcher, type SubscribedChannels } from '~/core/subscriptions';
import type { Exception, ReasonCode, Rule, Settings, SiteId, TileFacts, TileResult } from '~/core/types';
import { finalVerdict, needsThumbnailPass, type ThumbModelResult } from '~/core/verdict';
import { buildChatRequest, CHAT_PROMPT_VERSION, chatCost, parseChatResponse, sendChat } from './chat';
import {
  buildKeepOnlyRequest,
  buildTextRequest,
  buildThumbnailRequest,
  deriveTextResults,
  deriveThumbResult,
  directTarget,
  FALLBACK_MODELS,
  modelRules,
  OPENROUTER,
  readUsage,
  REQUEST_SHAPE_VERSION,
  sendDecisions,
  TEXT_FRAMING,
  textBatchSizeFor,
  THUMBNAIL_SHAPE_VERSION,
  validateResponse,
  type BuiltRequest,
  type CachedText,
  type ChainResult,
  type DecisionsDeps,
  type EngineLog,
} from './decisions';
import { defaultSleep, Semaphore, TEXT_IN_FLIGHT, THUMBNAIL_IN_FLIGHT, type FetchLike, type Sleep } from './net';
import { fetchThumbnail, parseThumbnailInput } from './thumbnails';

/** A cached answer with `v`, the answer version it was asked under (answerVersions in core/ids.ts). */
type Versioned<T> = T & { v?: string };

/**
 * decision-engine.md §1.2. Structurally the same as `VerdictCacheRecord` in store/local.ts. Every record is stored
 * under VERDICT_RECORD_VERSION, and each part is checked against its own `v`.
 */
export interface VerdictCacheRecord {
  text?: Versioned<CachedText>;
  thumb?: Versioned<ThumbModelResult>;
  rulesVersion: string;
  at: number;
}

/** One cache write: the store merges it into a record with the same rulesVersion (store/local.ts putVerdicts). */
export interface VerdictPut {
  videoId: string;
  rulesVersion: string;
  text?: Versioned<CachedText>;
  thumb?: Versioned<ThumbModelResult>;
  at: number;
}

/**
 * The store's record key for every Verdict cache record. The store merges writes under one key, so a new text
 * answer keeps the thumbnail answer beside it and the reverse.
 */
export const VERDICT_RECORD_VERSION = 'answers';

/** Per call. `private` comes from `sender.tab.incognito`: no Verdict cache writes, counters go to session storage. */
export interface JudgeContext {
  private: boolean;
  tabId?: number;
}

/**
 * Reported once per request chain. Mapping for the router (architecture.md Section 7):
 * ok → recordSuccess('model'). Otherwise: 'keyRejected' sets the rejected-key state, 'creditsExhausted'
 * trips breakerModel with detail creditsExhausted, and `countsAsFailure` → recordFailure('model').
 * `thumbnail` marks an answer from the thumbnail pass, whose fallback is FALLBACK_MODELS.image.
 */
export type ModelOutcome =
  | { ok: true; fallback: boolean; thumbnail?: true }
  | { ok: false; reason: ReasonCode; countsAsFailure: boolean };

export interface JudgeDeps {
  now(): number;
  fetch: FetchLike;
  sleep?: Sleep;
  /** OpenRouter key, read through store/secret.ts. */
  getKey(): Promise<string | undefined>;
  /** Custom endpoint key, read through store/secret.ts. */
  getCustomKey(): Promise<string | undefined>;
  /** Direct Decision provider key, read through store/secret.ts. Empty for a model on this computer. */
  getDirectKey(): Promise<string | undefined>;
  settings(): Promise<Settings>;
  /** Every Rule, including disabled ones and tombstones (filtered here). */
  rules(): Promise<Rule[]>;
  /** Which of these videoIds have an Exception: sync, the local archive, and the tab's session Exceptions in private windows. */
  exceptionIds(videoIds: string[], ctx: JudgeContext): Promise<ReadonlySet<string>>;
  /** The `n` most recent Exceptions that pass `keep`, newest first, for `viewer_kept_anyway`. */
  recentExceptions(n: number, keep: (x: Exception) => boolean): Promise<Exception[]>;
  /**
   * The user's YouTube Subscribed channels, asked only while a YouTube batch meets an enabled remove Rule with
   * `skipSubscribed`. Undefined when no list is usable (never read, signed out, the page changed). A private
   * context never starts a read.
   */
  subscriptions?(ctx: JudgeContext): Promise<SubscribedChannels | undefined>;
  /** Records for these videos whose rulesVersion matches (store/local.ts getVerdicts). Read-only, so private contexts read it too. */
  cacheGet(videoIds: string[], rulesVersion: string): Promise<Map<string, VerdictCacheRecord>>;
  /** store/local.ts putVerdicts. Never called for private contexts or Try a title. */
  cachePut(puts: VerdictPut[]): Promise<void>;
  /** Today's counters: cost in USD, Tiles judged (REQ-COST-2), HTTP requests made. */
  addCost(c: { usd: number; judged: number; requests: number }, ctx: JudgeContext): Promise<void>;
  recordModelOutcome(o: ModelOutcome): Promise<void>;
  /**
   * Whether model stages 5-7 may run (core/runtime.ts): consent, key, host permission, breaker, daily cap,
   * offline. Try a title passes `ignoreDailyCap`. Asked once before a call and again right before each
   * request, so a consent withdrawn or an engine switched while a batch waits stops what has not gone out.
   */
  modelAllowed(opts: { ctx: JudgeContext; ignoreDailyCap: boolean }): Promise<{ ok: true } | { ok: false; reason: ReasonCode }>;
  /** $ per input token for a model, from the cached catalogue, when `usage.cost` is absent. */
  priceFor?(model: string): number | undefined | Promise<number | undefined>;
  log?(e: EngineLog): void;
  timeouts?: { requestMs?: number; thumbnailMs?: number };
}

export interface JudgeResult {
  results: TileResult[];
  rulesVersion: string;
  costUsd: number;
  /**
   * judgeTiles only: the final results of the Tiles that came back `thumbnailPending`, once their thumbnail checks
   * and the batch's bookkeeping (cost, model outcomes, cache writes) are done.
   */
  later?: Promise<TileResult[]>;
}

/** Checked by the tryTitle route (handlers/judging.ts): a non-blank title, a short channel name, a duration of 0 or more. */
export interface TryTitleInput {
  title: string;
  channelName?: string;
  durationSec?: number;
  /** A YouTube video's address or ID. */
  thumbnailUrl?: string;
  /** The Site the title is tried on, so only its Rules apply. YouTube when unset. */
  site?: SiteId;
}

export type TryTitleResult = { result: TileResult; costUsd: number } | { error: ReasonCode };

export interface Judge {
  /** judgeTiles: one result per item, in input order. Tiles waiting on a thumbnail check get theirs in `later`. */
  judgeTiles(items: TileFacts[], ctx: JudgeContext): Promise<JudgeResult>;
  /** Try a title (§7.5): the same pipeline for one synthetic Tile, no Verdict cache, no daily cap, cost added. */
  tryTitle(input: TryTitleInput, ctx: JudgeContext): Promise<TryTitleResult>;
  /** rulesVersion for the current Rules and settings (architecture.md Section 9). */
  rulesVersionFor(rules: Rule[], settings: Settings): string;
  /** Drops a closed private tab's in-memory Verdict cache. */
  forgetTab(tabId: number): void;
}

/** videoId of the synthetic Try a title Tile when no thumbnail URL was given. Never sent anywhere. */
export const TRY_TITLE_ID = 'tryTitle';
export const TRY_TITLE_MAX_CHARS = 300;

/**
 * The Rules that apply to a Tile. A Tile from a Subscribed channel gets a view without the remove Rules that
 * skip Subscribed channels: they never remove it, and its answers are cached under their own `textV` and `thumbV`.
 */
interface RuleView {
  topicRemove: Rule[];
  thumbnail: Rule[];
  rulesByRef: Map<string, Rule>;
  hasTopicRules: boolean;
  textV: string;
  thumbV: string;
}

interface Slot {
  facts: TileFacts;
  view: RuleView;
  /** Shoo has no list of Subscribed channels, so a Rule that skips them may not remove this Tile. */
  unchecked: boolean;
  exact: ExactStageOutcome;
  text?: CachedText;
  thumb?: ThumbModelResult;
  newText?: CachedText;
  newThumb?: ThumbModelResult;
  /** Synthetic "keep the Tile" thumbnail after a fetch failure or a 413/422. Never cached. */
  thumbKept?: boolean;
  reason?: ReasonCode;
}

interface RunOptions {
  useCache: boolean;
  ignoreDailyCap: boolean;
  countJudged: boolean;
  /** Try a title already checked modelAllowed. */
  allowed?: true;
  /** judgeTiles: answer once stage 6 is done, and give the thumbnail pass's results in `later`. */
  early?: true;
  /** Try a title: ask Topic Keep rules even when nothing could remove the Tile, so one can be tested (REQ-RULE-8). */
  askKeepAlone?: true;
  /** Try a title judges the title alone, as from a channel the user is not subscribed to. */
  ignoreSubscriptions?: true;
}

/**
 * Records in the in-memory Verdict cache of private tabs, all tabs together. Their answers live there instead of in
 * storage (REQ-ACTV-3), so a rescan of the same page does not send its titles again. A background restart drops it.
 */
export const PRIVATE_CACHE_MAX = 4000;

const chunk = <T>(list: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

/** Topic Keep rules per request next to one choice question: 1 + 63 = 64 questions per Tile (§2.2, §5.3). */
export const MAX_KEEP_RULES_PER_REQUEST = MAX_QUESTIONS_PER_REQUEST - 1;

/** Adds the Keep answers of a later keep-only part to a Tile's text result: pKeep = max, keepRef = argmax. */
function mergeKeep(base: CachedText, part: CachedText): CachedText {
  if (part.pKeep === undefined || (base.pKeep !== undefined && base.pKeep >= part.pKeep)) return base;
  const { keepRef: _old, ...rest } = base;
  return part.keepRef === undefined ? { ...rest, pKeep: part.pKeep } : { ...rest, pKeep: part.pKeep, keepRef: part.keepRef };
}

function withoutKeepOnly(r: CachedText): CachedText {
  const { keepOnly: _k, ...rest } = r;
  return rest;
}

/**
 * The outcomes reported for a judgeTiles call. A rejected key or exhausted credits win (they change RuntimeState at
 * once), then a counted failure. Otherwise one success per pass, a fallback answer over the chosen model's, so a
 * fallback stays noted until its own pass's chosen model answers (decision-engine.md Section 5.2). Uncounted
 * failures alone report nothing.
 */
export function summarizeOutcomes(list: ModelOutcome[]): ModelOutcome[] {
  const failed = (reason: ReasonCode) => list.find((o) => !o.ok && o.reason === reason);
  const failure = failed('keyRejected') ?? failed('creditsExhausted') ?? list.find((o) => !o.ok && o.countsAsFailure);
  if (failure) return [failure];
  // Fallback answers sort last, so each one replaces its pass's chosen answer in the Map.
  return [
    ...new Map(
      list
        .filter((o) => o.ok)
        .sort((a, b) => +a.fallback - +b.fallback)
        .map((o) => [o.thumbnail, o] as const),
    ).values(),
  ];
}

const versionInputs = (rules: Rule[], settings: Settings): RulesVersionInputs => ({
  rules,
  models: settings.models,
  textFraming: TEXT_FRAMING,
  requestShapeVersion: REQUEST_SHAPE_VERSION,
  thumbnailShapeVersion: THUMBNAIL_SHAPE_VERSION,
  engine: settings.engine,
  direct: settings.direct,
  customEndpoint: settings.customEndpoint,
  chatPromptVersion: CHAT_PROMPT_VERSION,
});

export function computeRulesVersion(rules: Rule[], settings: Settings): string {
  return rulesVersion(versionInputs(rules, settings));
}

/** The versions a Tile's cached text and thumbnail answers must carry to be used. */
export function computeAnswerVersions(rules: Rule[], settings: Settings): { text: string; thumb: string } {
  return answerVersions(versionInputs(rules, settings));
}

/** What a Tile asked by another judgeTiles call at the same time got: its text answer, or why it has none. */
type SharedText = { text: CachedText } | { reason: ReasonCode };

export function createJudge(deps: JudgeDeps): Judge {
  const textSem = new Semaphore(TEXT_IN_FLIGHT);
  const thumbSem = new Semaphore(THUMBNAIL_IN_FLIGHT);
  const sleep = deps.sleep ?? defaultSleep;
  const decisionsDeps: DecisionsDeps = { fetch: deps.fetch, sleep, now: () => deps.now(), timeoutMs: deps.timeouts?.requestMs, log: deps.log };
  const exactMemo = new Map<SiteId, { version: string; compiled: CompiledExact }>();
  // Text answers being asked right now, keyed `<context> <textV> <keepOnly> <videoId>`, so a second tab showing the
  // same Tiles waits for them instead of paying for the same questions. A private tab shares only with itself.
  const askingText = new Map<string, Promise<SharedText>>();
  // A private tab writes only its own records here, keyed `<tabId> <videoId>`, merged like putVerdicts. It reads
  // the stored Verdict cache too, which reading leaves unchanged, with its own records laid over it.
  const privateVerdicts = new Map<string, VerdictCacheRecord>();
  const cacheGet = async (ctx: JudgeContext, videoIds: string[], rv: string) => {
    const out = await deps.cacheGet(videoIds, rv);
    if (!ctx.private) return out;
    for (const v of videoIds) {
      const rec = privateVerdicts.get(`${ctx.tabId} ${v}`);
      if (rec?.rulesVersion === rv) out.set(v, { ...out.get(v), ...rec });
    }
    return out;
  };
  const cachePut = async (ctx: JudgeContext, puts: VerdictPut[]) => {
    if (!ctx.private) return deps.cachePut(puts);
    for (const { videoId, ...put } of puts) {
      const key = `${ctx.tabId} ${videoId}`;
      const prev = privateVerdicts.get(key);
      privateVerdicts.delete(key);
      privateVerdicts.set(key, prev?.rulesVersion === put.rulesVersion ? { ...prev, ...put } : put);
      if (privateVerdicts.size > PRIVATE_CACHE_MAX) privateVerdicts.delete(privateVerdicts.keys().next().value!);
    }
  };

  const compiledFor = (site: SiteId, rules: Rule[], regexEnabled: boolean): CompiledExact => {
    const version = exactVersion(rules, regexEnabled);
    let memo = exactMemo.get(site);
    if (memo?.version !== version) exactMemo.set(site, (memo = { version, compiled: compileExact(rules, regexEnabled) }));
    return memo.compiled;
  };

  async function run(items: TileFacts[], ctx: JudgeContext, opts: RunOptions): Promise<JudgeResult> {
    const [settings, everyRule] = await Promise.all([deps.settings(), deps.rules()]);
    // Content compares Verdicts with this one, which every Rule changes.
    const rv = computeRulesVersion(everyRule, settings);
    // One Site per batch (the router checks), judged only against the Rules that work there (ADR 0012). Cached
    // answers carry versions over those, so a Rule for another Site never voids this Site's cached answers.
    const site = items[0] ? SURFACE_SITE[items[0].surface] : 'youtube';
    const allRules = rulesOn(everyRule, site);
    const versions = computeAnswerVersions(allRules, settings);
    const custom = settings.engine === 'custom';
    // A direct Decision provider (§12): its own address, model and key, no OpenRouter fallback chain.
    const direct = settings.engine === 'direct' ? settings.direct : undefined;
    const provider = direct && directProvider(direct.provider);
    // Engine 'direct' with no saved endpoint has no target (noKey), never a silent fall back to OpenRouter.
    const target = settings.engine === 'direct' ? direct && directTarget(direct) : OPENROUTER;
    const models = direct ? { text: direct.model, image: direct.model } : settings.models;
    // Thumbnail rules run only where the endpoint reads images: never on a custom endpoint (REQ-MODEL-5),
    // on a direct one only when it does (§12). Elsewhere they must not hold Tiles undecided.
    const images = !custom && (!direct || (!!provider && readsImages(provider, direct.model)));
    const rules = allRules.filter((r) => r.deletedAt === undefined && (images || r.kind !== 'thumbnail'));
    const rulesByRef = new Map(rules.map((r) => [r.ref, r]));
    const keepRules = rules.filter((r) => r.polarity === 'keep');
    const { topicRemove, topicKeep, thumbnail } = modelRules(rules);
    const hasThumb = thumbnail.length > 0;
    const compiled = compiledFor(site, allRules, settings.regexEnabled);

    // REQ-RULE-14: remove Rules that never remove a Tile from a Subscribed channel. The list is the user's YouTube
    // subscriptions, so another Site's batch never reads it and those Rules remove its Tiles as usual.
    const skipping = opts.ignoreSubscriptions || site !== 'youtube' ? [] : activeRules(rules).filter((r) => r.polarity === 'remove' && r.skipSubscribed === true);
    const skippingIds = new Set(skipping.map((r) => r.id));
    const subscriptions = skipping.length > 0 ? await deps.subscriptions?.(ctx) : undefined;
    const fromSubscribed = subscriptions ? subscribedMatcher(subscriptions) : undefined;
    const viewWithout = (skip: ReadonlySet<string>): RuleView => {
      const applies = (r: Rule) => !skip.has(r.id);
      const skippedRefs = (list: Rule[]) => list.filter((r) => !applies(r)).map((r) => r.ref);
      const remove = topicRemove.filter(applies);
      return {
        topicRemove: remove,
        thumbnail: thumbnail.filter(applies),
        rulesByRef: new Map([...rulesByRef].filter(([, r]) => applies(r))),
        hasTopicRules: remove.length + topicKeep.length > 0,
        textV: cacheVersion(versions.text, skippedRefs(topicRemove)),
        thumbV: cacheVersion(versions.thumb, skippedRefs(thumbnail)),
      };
    };
    const fullView = viewWithout(new Set());
    const subscribedView = skipping.length > 0 ? viewWithout(skippingIds) : fullView;
    const views = subscribedView === fullView ? [fullView] : [fullView, subscribedView];
    const scope = ctx.private ? `p${ctx.tabId}` : 'n';

    const slots = new Map<string, Slot>();
    for (const t of items) {
      if (slots.has(t.videoId)) continue;
      const subscribed = fromSubscribed?.(t) ?? false;
      const unchecked = skipping.length > 0 && !subscriptions && tileChannelIdentity(t) !== undefined;
      slots.set(t.videoId, { facts: t, view: subscribed ? subscribedView : fullView, unchecked, exact: { kind: 'none' } });
    }
    const ids = [...slots.keys()];
    const excepted = ids.length > 0 ? await deps.exceptionIds(ids, ctx) : new Set<string>();
    for (const s of slots.values()) {
      const exactStages = (skipSubscribed: boolean) => runExactStages(s.facts, compiled, (id) => excepted.has(id), skipSubscribed);
      s.exact = exactStages(s.view !== fullView);
      // Without the list, a Rule that does not skip Subscribed channels still removes the Tile.
      if (s.unchecked && s.exact.kind === 'remove' && skippingIds.has(s.exact.rule.id)) {
        const withoutSkipping = exactStages(true);
        if (withoutSkipping.kind === 'remove') s.exact = withoutSkipping;
      }
    }

    // An undecided Tile goes to the model only when a Rule there could remove it: Topic Keep answers alone
    // cannot change a keep (§1). Its Topic Keep questions still go with the remove question. Try a title asks them
    // anyway, so a Topic Keep rule can be tested on its own.
    const couldRemove = (v: RuleView) => v.topicRemove.length > 0 || v.thumbnail.length > 0 || (opts.askKeepAlone === true && topicKeep.length > 0);
    const needsModel = (s: Slot) => (s.exact.kind === 'remove' ? topicKeep.length > 0 : s.exact.kind === 'none' && couldRemove(s.view));
    const modelSlots = [...slots.values()].filter(needsModel);

    let costUsd = 0;
    let requests = 0;
    const judged = new Set<string>();
    // Stage 7 and the bookkeeping after it. With `early`, the Tiles in `pending` wait for it and the others do not.
    let finish: (() => Promise<void>) | undefined;
    let pending = new Set<Slot>();

    if (modelSlots.length > 0) {
      const allowed = opts.allowed ? ({ ok: true } as const) : await deps.modelAllowed({ ctx, ignoreDailyCap: opts.ignoreDailyCap });
      const key = allowed.ok && target ? await (custom ? deps.getCustomKey() : direct ? deps.getDirectKey() : deps.getKey()) : undefined;
      // A custom or direct endpoint may have an empty key (a local endpoint needs none). Only a missing key is noKey.
      if (!allowed.ok || key === undefined || !target) {
        const reason = allowed.ok ? 'noKey' : allowed.reason;
        for (const s of modelSlots) s.reason = reason;
      } else {
        // Stage 5: Verdict cache. Each answer counts only under the version of the Rules it was asked about.
        if (opts.useCache) {
          const cached = await cacheGet(ctx, modelSlots.map((s) => s.facts.videoId), VERDICT_RECORD_VERSION);
          for (const s of modelSlots) {
            const { text, thumb } = cached.get(s.facts.videoId) ?? {};
            // A keep-only answer holds no remove answer, so a Tile that now needs the full text pass re-asks.
            const usable = text && !(text.keepOnly && s.exact.kind === 'none' && s.view.topicRemove.length > 0);
            if (usable && text.v === s.view.textV) s.text = text;
            if (thumb?.v === s.view.thumbV) s.thumb = thumb;
          }
        }

        // §8.3: usage.cost, else input_tokens × the catalogue price. The price is awaited before the sum is
        // read, so concurrent requests never overwrite each other's cost.
        const account = async (model: string, usage: { inputTokens?: number; cost?: number }) => {
          // A direct endpoint reports no cost: its published price per input token (core/providers.ts).
          const price = usage.cost !== undefined ? 0 : provider ? provider.price : ((await deps.priceFor?.(model)) ?? 0);
          costUsd += usage.cost ?? (usage.inputTokens ?? 0) * price;
        };
        // Re-checked inside each request slot, right before sending: the gate above ran before cache reads
        // and queueing, and consent, Off, a host or the engine may have changed since (architecture.md
        // Section 7). A refused request sends nothing and counts as no outcome.
        const recipient = (x: Settings): string => {
          if (x.engine === 'direct') return `direct ${x.direct?.provider} ${x.direct?.baseUrl} ${x.direct?.model}`;
          if (x.engine === 'custom') return `custom ${x.customEndpoint?.baseUrl} ${x.customEndpoint?.model}`;
          return 'openrouter';
        };
        const stillAllowed = async (tiles: Slot[]): Promise<boolean> => {
          const [now, gate] = await Promise.all([deps.settings(), deps.modelAllowed({ ctx, ignoreDailyCap: opts.ignoreDailyCap })]);
          const reason: ReasonCode | undefined = !gate.ok ? gate.reason : recipient(now) !== recipient(settings) ? 'noConsent' : undefined;
          if (reason) for (const s of tiles) s.reason = reason;
          return reason === undefined;
        };
        // Model outcomes are reported per judgeTiles call (architecture.md §7: counted per batch, after the chain).
        const outcomes: ModelOutcome[] = [];
        const fail = (tiles: Slot[], r: { reason: ReasonCode; countsAsFailure: boolean }) => {
          for (const s of tiles) s.reason = r.reason;
          outcomes.push({ ok: false, reason: r.reason, countsAsFailure: r.countsAsFailure });
        };
        // A paid answer counts as spend even when unusable (§8.3). One that fails the check fails its Tiles.
        const checked = async (sent: Extract<ChainResult, { ok: true }>, questions: BuiltRequest['questions'], tiles: Slot[]) => {
          const valid = validateResponse(sent.json, questions);
          await account(sent.model, valid.ok ? valid.value.usage : readUsage(sent.json));
          if (valid.ok) return valid.value;
          deps.log?.({ event: 'apiShapeChanged', model: sent.model, problem: valid.problem, shape: valid.shape });
          fail(tiles, { reason: 'apiShapeChanged', countsAsFailure: true });
          return undefined;
        };

        // Stage 6: text pass (Topic rules, Topic Keep rules) and keep-only questions.
        const wanted = modelSlots.filter((s) => s.exact.kind === 'none' && s.view.hasTopicRules && !s.text);
        // A direct provider whose choice question cannot take keep plus every remove Topic rule would refuse
        // each request (Ollama: 26 options). Send none, and say why, instead of tripping the breaker (§12.1).
        const overLimit = !!provider && topicRemove.length > topicRuleLimit(provider);
        if (overLimit) for (const s of wanted) s.reason = 'tooManyRules';
        const fullPass = overLimit ? [] : wanted;
        const keepPass = modelSlots.filter((s) => s.exact.kind === 'remove' && s.text?.pKeep === undefined);
        if (fullPass.length + keepPass.length > 0) {
          // A Tile with an exact remove pending is asked in full wherever remove Topic rules are asked, so no request
          // shows which Tiles a local Rule removed (§2.5). Its remove answer is cached, and unused while the exact
          // remove stands. Only where no choice question can go does it get its Keep questions alone.
          const keepOnlyIds = new Set(keepPass.filter((s) => overLimit || s.view.topicRemove.length === 0).map((s) => s.facts.videoId));
          const asksRemove = [...fullPass, ...keepPass].some((s) => !keepOnlyIds.has(s.facts.videoId) && s.view.topicRemove.length > 0);
          const exceptions = asksRemove ? await deps.recentExceptions(MAX_KEPT_EXAMPLES, exampleOn(everyRule, site)) : [];
          // Judged counts only Tiles no local Rule decided (§8.3).
          const countsJudged = (s: Slot) => s.exact.kind !== 'remove';
          // More Topic Keep rules than fit next to a choice question in 64 go to extra keep-only requests.
          const keepGroups = topicKeep.length > MAX_KEEP_RULES_PER_REQUEST ? chunk(topicKeep, MAX_KEEP_RULES_PER_REQUEST) : [topicKeep];

          // `removeRules`: the remove Topic rules of the group's RuleView.
          const sendCustom = async (group: Slot[], removeRules: Rule[]): Promise<void> => {
            const endpoint = settings.customEndpoint;
            if (!endpoint) return fail(group, { reason: 'noKey', countsAsFailure: false });
            const plan = buildChatRequest([...removeRules, ...topicKeep], exceptions, group.map((s) => s.facts), endpoint.model, endpoint.baseUrl);
            const sent = await textSem.run(async () => ((await stillAllowed(group)) ? sendChat(decisionsDeps, endpoint.baseUrl, key, plan.body) : undefined));
            if (!sent) return;
            requests += sent.requests;
            if (!sent.ok) return fail(group, sent);
            // A paid reply counts as spend even when its content is unusable (§8.3).
            costUsd += chatCost(sent.json) ?? 0;
            const parsed = parseChatResponse(sent.json, plan, endpoint.model);
            for (const s of group) if (countsJudged(s)) judged.add(s.facts.videoId);
            if (!parsed.ok) {
              deps.log?.({ event: 'apiShapeChanged', model: endpoint.model, problem: parsed.detail, shape: '' });
              return fail(group, { reason: parsed.reason, countsAsFailure: true });
            }
            for (const s of group) {
              const r = parsed.results.get(s.facts.videoId)!;
              s.newText = s.text = keepOnlyIds.has(s.facts.videoId) ? { ...r, keepOnly: true } : r;
            }
            outcomes.push({ ok: true, fallback: false });
          };

          const sendText = async (group: Slot[], removeRules: Rule[]): Promise<void> => {
            const facts = group.map((s) => s.facts);
            const needsChoice = group.some((s) => !keepOnlyIds.has(s.facts.videoId));
            const merged = new Map<string, CachedText>();
            for (const [gi, keepGroup] of keepGroups.entries()) {
              const built: BuiltRequest =
                gi === 0 && needsChoice
                  ? buildTextRequest([...removeRules, ...keepGroup], exceptions, facts, { model: models.text, keepOnly: keepOnlyIds })
                  : buildKeepOnlyRequest(keepGroup, facts, { model: models.text });
              const fit = built.fit;
              if (fit && (fit.droppedExceptions > 0 || fit.truncatedRefs.length > 0 || fit.usedTokens > fit.budget)) {
                deps.log?.({ event: 'stateTrimmed', droppedExceptions: fit.droppedExceptions, truncatedRefs: fit.truncatedRefs, overBudget: fit.usedTokens > fit.budget });
              }
              const sent: ChainResult | undefined = await textSem.run(async () =>
                (await stillAllowed(group)) ? sendDecisions(decisionsDeps, key, built.body, 'text', FALLBACK_MODELS.text, target) : undefined,
              );
              if (!sent) return;
              requests += sent.requests;
              if (!sent.ok) {
                if (sent.split && group.length > 1) {
                  const half = Math.ceil(group.length / 2);
                  await Promise.all([sendText(group.slice(0, half), removeRules), sendText(group.slice(half), removeRules)]);
                  return;
                }
                return fail(group, sent);
              }
              // §8.3: every Tile in a paid text request counts as judged, Tiles with an exact remove do not.
              if (gi === 0) for (const s of group) if (countsJudged(s)) judged.add(s.facts.videoId);
              const answer = await checked(sent, built.questions, group);
              if (!answer) return;
              for (const [videoId, r] of deriveTextResults(built, answer.answers, sent.model)) {
                const prev = merged.get(videoId);
                merged.set(videoId, prev ? mergeKeep(prev, r) : r);
              }
              outcomes.push({ ok: true, fallback: sent.fallback });
            }
            for (const s of group) {
              const r = merged.get(s.facts.videoId)!;
              s.newText = s.text = keepOnlyIds.has(s.facts.videoId) ? { ...r, keepOnly: true } : withoutKeepOnly(r);
            }
          };

          // A Tile another call is asking already waits for that answer. The others are announced, then asked.
          const all: Slot[] = [];
          const waits: Promise<void>[] = [];
          const announced: { s: Slot; key: string; done: (r: SharedText) => void }[] = [];
          for (const s of [...fullPass, ...keepPass]) {
            const key = `${scope} ${s.view.textV} ${keepOnlyIds.has(s.facts.videoId)} ${s.facts.videoId}`;
            const asking = opts.useCache ? askingText.get(key) : undefined;
            if (asking) {
              const settle = (r: SharedText) => {
                if ('text' in r) s.text = r.text;
                else s.reason = r.reason;
              };
              waits.push(asking.then(settle));
              continue;
            }
            all.push(s);
            if (opts.useCache) askingText.set(key, new Promise((done) => announced.push({ s, key, done })));
          }
          try {
            // Tiles from Subscribed channels go in requests of their own, asked only the Rules that apply to them.
            const sends: Promise<void>[] = [];
            for (const view of views) {
              const group = all.filter((s) => s.view === view);
              const size = custom ? 16 : textBatchSizeFor(TEXT_FRAMING, view.topicRemove.length, keepGroups[0]!.length);
              for (const part of chunk(group, size)) sends.push(custom ? sendCustom(part, view.topicRemove) : sendText(part, view.topicRemove));
            }
            await Promise.all(sends);
          } finally {
            for (const { s, key, done } of announced) {
              askingText.delete(key);
              done(s.newText ? { text: s.newText } : { reason: s.reason ?? 'modelError' });
            }
          }
          await Promise.all(waits);
        }

        // Stage 7: thumbnail pass, only where stage 6 matched no Rule at all.
        const thumbWanted =
          hasThumb && images
            ? modelSlots.filter((s) => s.exact.kind === 'none' && s.view.thumbnail.length > 0 && !s.thumb && !s.reason && needsThumbnailPass(s.text, s.view.hasTopicRules))
            : [];
        // The thumbnail question has the same option limit as the text choice question (§12.1).
        const thumbOverLimit = (s: Slot) => !!provider && s.view.thumbnail.length > topicRuleLimit(provider);
        for (const s of thumbWanted) if (thumbOverLimit(s)) s.reason = 'tooManyRules';
        const thumbPass = thumbWanted.filter((s) => !thumbOverLimit(s));
        if (opts.early) pending = new Set(thumbPass);
        finish = async () => {
          await Promise.all(
            thumbPass.map(async (s) => {
              const keepTile = () => {
                s.thumb = { p: 0, model: models.image };
                s.thumbKept = true;
              };
              // Fetched before taking a request slot, so the slots wait on the model only.
              const dataUrl = await fetchThumbnail(deps.fetch, s.facts, deps.timeouts?.thumbnailMs);
              if (!dataUrl) return keepTile();
              return thumbSem.run(async () => {
                // Only the Thumbnail rules that apply to the Tile (REQ-RULE-14): one choice question shares its
                // probability among its options, so a Rule that skips the Tile would take the share of one that applies.
                const built = buildThumbnailRequest(s.view.thumbnail, s.facts, dataUrl, { model: models.image });
                if (!(await stillAllowed([s]))) return;
                const sent = await sendDecisions(decisionsDeps, key, built.body, 'thumbnail', FALLBACK_MODELS.image, target);
                requests += sent.requests;
                if (!sent.ok) {
                  if (sent.keepTile) return keepTile();
                  return fail([s], sent);
                }
                if (!s.view.hasTopicRules) judged.add(s.facts.videoId);
                const answer = await checked(sent, built.questions, [s]);
                if (!answer) return;
                s.newThumb = s.thumb = deriveThumbResult(built, answer.answers, sent.model);
                outcomes.push({ ok: true, fallback: sent.fallback, thumbnail: true });
              });
            }),
          );

          // Side effects after paid calls: a storage error must not throw away the results (cost first).
          const guard = async (what: string, fn: () => Promise<void>) => {
            try {
              await fn();
            } catch {
              deps.log?.({ event: 'sideEffectFailed', what });
            }
          };
          if (requests > 0) await guard('addCost', () => deps.addCost({ usd: costUsd, judged: opts.countJudged ? judged.size : 0, requests }, ctx));
          for (const outcome of summarizeOutcomes(outcomes)) await guard('recordModelOutcome', () => deps.recordModelOutcome(outcome));
          if (opts.useCache) {
            const at = deps.now();
            const puts: VerdictPut[] = [];
            for (const s of modelSlots) {
              if (!s.newText && !s.newThumb) continue;
              const put: VerdictPut = { videoId: s.facts.videoId, rulesVersion: VERDICT_RECORD_VERSION, at };
              if (s.newText) put.text = { ...s.newText, v: s.view.textV };
              if (s.newThumb) put.thumb = { ...s.newThumb, v: s.view.thumbV };
              puts.push(put);
            }
            if (puts.length > 0) await guard('cachePut', () => cachePut(ctx, puts));
          }
        };
      }
    }

    // Stage 8: final Verdicts with the current Filtering strength, in input order.
    const verdictOf = (t: TileFacts, now: number): TileResult => {
      const s = slots.get(t.videoId)!;
      const verdict = finalVerdict({
        videoId: t.videoId,
        exact: s.exact,
        text: s.text,
        thumb: s.thumb,
        keepRules,
        rulesByRef: s.view.rulesByRef,
        strength: settings.strength,
        rulesVersion: rv,
        now,
      });
      // Fail safe: without the list, a Rule that skips Subscribed channels holds the Tile instead of removing it.
      if (verdict?.outcome === 'remove' && s.unchecked && verdict.ruleId !== undefined && skippingIds.has(verdict.ruleId)) {
        return { videoId: t.videoId, status: 'undecided', reason: 'subscriptionsUnavailable' };
      }
      if (verdict) return { videoId: t.videoId, status: 'decided', verdict };
      const reason: ReasonCode = s.exact.kind === 'remove' ? 'keepCheckUnavailable' : (s.reason ?? 'modelError');
      return { videoId: t.videoId, status: 'undecided', reason };
    };
    const decide = (list: TileFacts[]) => {
      const now = deps.now();
      return list.map((t) => verdictOf(t, now));
    };
    if (pending.size === 0) {
      await finish?.();
      return { results: decide(items), rulesVersion: rv, costUsd };
    }
    const waits = (t: TileFacts) => pending.has(slots.get(t.videoId)!);
    const results = decide(items).map((r, i): TileResult => (waits(items[i]!) ? { videoId: r.videoId, status: 'undecided', reason: 'thumbnailPending' } : r));
    const later = finish!().then(() => decide(items.filter(waits)));
    return { results, rulesVersion: rv, costUsd, later };
  }

  return {
    judgeTiles(items, ctx) {
      return run(items, ctx, { useCache: true, ignoreDailyCap: false, countJudged: true, early: true });
    },

    async tryTitle(input, ctx) {
      const title = input.title.trim();
      const channelName = input.channelName?.trim();
      const d = input.durationSec;
      const site = input.site ?? 'youtube';
      let videoId = TRY_TITLE_ID;
      if (input.thumbnailUrl?.trim()) {
        if (site !== 'youtube') return { error: 'invalidInput' };
        const parsed = parseThumbnailInput(input.thumbnailUrl);
        if (!parsed) return { error: 'invalidInput' };
        videoId = parsed;
      }
      const allowed = await deps.modelAllowed({ ctx, ignoreDailyCap: true });
      if (!allowed.ok) return { error: allowed.reason };
      const tile: TileFacts = {
        videoId,
        surface: site === 'bilibili' ? 'bilibiliHome' : 'home',
        title,
        ...(channelName ? { channelName } : {}),
        ...(d !== undefined ? { durationSec: d } : {}),
        isShort: false,
        isLive: false,
        isUpcoming: false,
        isMembersOnly: false,
      };
      const out = await run([tile], ctx, { useCache: false, ignoreDailyCap: true, countJudged: false, allowed: true, askKeepAlone: true, ignoreSubscriptions: true });
      return { result: out.results[0]!, costUsd: out.costUsd };
    },

    rulesVersionFor: computeRulesVersion,

    forgetTab(tabId) {
      for (const key of privateVerdicts.keys()) if (key.startsWith(`${tabId} `)) privateVerdicts.delete(key);
    },
  };
}
