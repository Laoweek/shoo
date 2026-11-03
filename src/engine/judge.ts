// The judging pipeline, stages 1-7 and gating (background only). Source of truth: docs/spec/decision-engine.md
// Sections 1, 2.5, 4, 5, 7.5 and 8.3, docs/spec/architecture.md Sections 5 and 7.
// Storage is reached only through JudgeDeps, so the background router wires the real store.
import { MAX_KEPT_EXAMPLES, MAX_QUESTIONS_PER_REQUEST } from '~/core/budget';
import { tileChannelIdentity } from '~/core/channel';
import { compileExact, type CompiledExact } from '~/core/exact';
import { cacheVersion, exactVersion, rulesVersion } from '~/core/ids';
import { directProvider, readsImages, topicRuleLimit } from '~/core/providers';
import { activeRules, runExactStages, type ExactStageOutcome } from '~/core/rules';
import { subscribedMatcher, type SubscribedChannels } from '~/core/subscriptions';
import type { Exception, ReasonCode, Rule, Settings, TileFacts, TileResult } from '~/core/types';
import { finalVerdict, needsThumbnailPass, type ThumbModelResult } from '~/core/verdict';
import { buildChatRequest, chatCost, parseChatResponse, sendChat } from './chat';
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
  validateResponse,
  type BuiltRequest,
  type CachedText,
  type ChainResult,
  type DecisionsDeps,
  type EngineLog,
} from './decisions';
import { defaultSleep, Semaphore, TEXT_IN_FLIGHT, THUMBNAIL_IN_FLIGHT, type FetchLike, type Sleep } from './net';
import { fetchThumbnail, parseThumbnailInput } from './thumbnails';

/** decision-engine.md §1.2. Structurally the same as `VerdictCacheRecord` in store/local.ts. */
export interface VerdictCacheRecord {
  text?: CachedText;
  thumb?: ThumbModelResult;
  rulesVersion: string;
  at: number;
}

/** One cache write: the store merges it into a record with the same rulesVersion (store/local.ts putVerdicts). */
export interface VerdictPut {
  videoId: string;
  rulesVersion: string;
  text?: CachedText;
  thumb?: ThumbModelResult;
  at: number;
}

/** Per call. `private` comes from `sender.tab.incognito`: no Verdict cache writes, counters go to session storage. */
export interface JudgeContext {
  private: boolean;
  tabId?: number;
}

/**
 * Reported once per request chain. Mapping for the router (architecture.md Section 7):
 * ok → recordSuccess('model'). Otherwise: 'keyRejected' sets the rejected-key state, 'creditsExhausted'
 * trips breakerModel with detail creditsExhausted, and `countsAsFailure` → recordFailure('model').
 */
export type ModelOutcome = { ok: true; model: string; fallback: boolean } | { ok: false; reason: ReasonCode; countsAsFailure: boolean };

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
  /** The n most recent Exceptions, newest first, for `viewer_kept_anyway`. */
  recentExceptions(n: number): Promise<Exception[]>;
  /**
   * The user's Subscribed channels, asked only while an enabled remove Rule has `skipSubscribed`. Undefined
   * when no list is usable (never read, signed out, the page changed). A private context never starts a read.
   */
  subscriptions?(ctx: JudgeContext): Promise<SubscribedChannels | undefined>;
  /** Records for these videos whose rulesVersion matches (store/local.ts getVerdicts). */
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
}

export interface TryTitleInput {
  title: string;
  channelName?: string;
  durationSec?: number;
  thumbnailUrl?: string;
}

export type TryTitleResult = { result: TileResult; costUsd: number } | { error: ReasonCode };

export interface Judge {
  /** judgeTiles: one result per item, in input order. */
  judgeTiles(items: TileFacts[], ctx: JudgeContext): Promise<JudgeResult>;
  /** Try a title (§7.5): the same pipeline for one synthetic Tile, no Verdict cache, no daily cap, cost added. */
  tryTitle(input: TryTitleInput, ctx: JudgeContext): Promise<TryTitleResult>;
  /** rulesVersion for the current Rules and settings (architecture.md Section 9). */
  rulesVersionFor(rules: Rule[], settings: Settings): string;
}

/** videoId of the synthetic Try a title Tile when no thumbnail URL was given. Never sent anywhere. */
export const TRY_TITLE_ID = 'tryTitle';
export const TRY_TITLE_MAX_CHARS = 300;

/**
 * The Rules that apply to a Tile. A Tile from a Subscribed channel gets a view without the remove Rules that
 * skip Subscribed channels: they are never asked about it, and its answers are cached under `cacheRv`.
 */
interface RuleView {
  topicRemove: Rule[];
  thumbnail: Rule[];
  rulesByRef: Map<string, Rule>;
  hasTopicRules: boolean;
  cacheRv: string;
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
  /** Try a title: ask Topic Keep rules even when nothing could remove the Tile, so one can be tested (REQ-RULE-8). */
  askKeepAlone?: true;
  /** Try a title judges the title alone, as from a channel the user is not subscribed to. */
  ignoreSubscriptions?: true;
}

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
 * The one outcome reported for a judgeTiles call. A rejected key or exhausted credits win (they change
 * RuntimeState at once), then a counted failure, then a success. Uncounted failures alone report nothing.
 */
export function summarizeOutcomes(list: ModelOutcome[]): ModelOutcome | undefined {
  const failed = (reason: ReasonCode) => list.find((o) => !o.ok && o.reason === reason);
  return failed('keyRejected') ?? failed('creditsExhausted') ?? list.find((o) => !o.ok && o.countsAsFailure) ?? list.find((o) => o.ok);
}

export function computeRulesVersion(rules: Rule[], settings: Settings): string {
  return rulesVersion({
    rules,
    models: settings.models,
    textFraming: TEXT_FRAMING,
    requestShapeVersion: REQUEST_SHAPE_VERSION,
    engine: settings.engine,
    direct: settings.direct,
    customEndpoint: settings.customEndpoint,
  });
}

export function createJudge(deps: JudgeDeps): Judge {
  const textSem = new Semaphore(TEXT_IN_FLIGHT);
  const thumbSem = new Semaphore(THUMBNAIL_IN_FLIGHT);
  const sleep = deps.sleep ?? defaultSleep;
  const decisionsDeps: DecisionsDeps = { fetch: deps.fetch, sleep, now: () => deps.now(), timeoutMs: deps.timeouts?.requestMs, log: deps.log };
  let exactMemo: { version: string; compiled: CompiledExact } | undefined;

  const compiledFor = (rules: Rule[], regexEnabled: boolean): CompiledExact => {
    const version = exactVersion(rules, regexEnabled);
    if (exactMemo?.version !== version) exactMemo = { version, compiled: compileExact(rules, regexEnabled) };
    return exactMemo.compiled;
  };

  async function run(items: TileFacts[], ctx: JudgeContext, opts: RunOptions): Promise<JudgeResult> {
    const [settings, allRules] = await Promise.all([deps.settings(), deps.rules()]);
    const rv = computeRulesVersion(allRules, settings);
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
    const compiled = compiledFor(allRules, settings.regexEnabled);

    // REQ-RULE-14: remove Rules that never remove a Tile from a Subscribed channel.
    const skipping = opts.ignoreSubscriptions ? [] : activeRules(rules).filter((r) => r.polarity === 'remove' && r.skipSubscribed === true);
    const skippingIds = new Set(skipping.map((r) => r.id));
    const subscriptions = skipping.length > 0 ? await deps.subscriptions?.(ctx) : undefined;
    const fromSubscribed = subscriptions ? subscribedMatcher(subscriptions) : undefined;
    const viewWithout = (skip: ReadonlySet<string>): RuleView => {
      const applies = (r: Rule) => !skip.has(r.id);
      const remove = topicRemove.filter(applies);
      const skippedRefs = [...topicRemove, ...thumbnail].filter((r) => !applies(r)).map((r) => r.ref);
      return {
        topicRemove: remove,
        thumbnail: thumbnail.filter(applies),
        rulesByRef: new Map([...rulesByRef].filter(([, r]) => applies(r))),
        hasTopicRules: remove.length + topicKeep.length > 0,
        cacheRv: cacheVersion(rv, skippedRefs),
      };
    };
    const fullView = viewWithout(new Set());
    const subscribedView = skipping.length > 0 ? viewWithout(skippingIds) : fullView;
    const views = subscribedView === fullView ? [fullView] : [fullView, subscribedView];

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

    if (modelSlots.length > 0) {
      const allowed = opts.allowed ? ({ ok: true } as const) : await deps.modelAllowed({ ctx, ignoreDailyCap: opts.ignoreDailyCap });
      const key = allowed.ok && target ? await (custom ? deps.getCustomKey() : direct ? deps.getDirectKey() : deps.getKey()) : undefined;
      // A custom or direct endpoint may have an empty key (a local endpoint needs none). Only a missing key is noKey.
      if (!allowed.ok || key === undefined || !target) {
        const reason = allowed.ok ? 'noKey' : allowed.reason;
        for (const s of modelSlots) s.reason = reason;
      } else {
        // Stage 5: Verdict cache.
        if (opts.useCache) {
          for (const view of views) {
            const group = modelSlots.filter((s) => s.view === view);
            if (group.length === 0) continue;
            const cached = await deps.cacheGet(group.map((s) => s.facts.videoId), view.cacheRv);
            for (const s of group) {
              const rec = cached.get(s.facts.videoId);
              if (!rec) continue;
              // A keep-only answer holds no remove answer, so a Tile that now needs the full text pass re-asks.
              if (rec.text && !(rec.text.keepOnly && s.exact.kind === 'none' && view.topicRemove.length > 0)) s.text = rec.text;
              if (rec.thumb) s.thumb = rec.thumb;
            }
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
        // One model outcome per judgeTiles call (architecture.md §7: counted per batch, after the chain).
        const outcomes: ModelOutcome[] = [];
        const fail = (tiles: Slot[], r: { reason: ReasonCode; countsAsFailure: boolean }) => {
          for (const s of tiles) s.reason = r.reason;
          outcomes.push({ ok: false, reason: r.reason, countsAsFailure: r.countsAsFailure });
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
          const exceptions = fullPass.some((s) => s.view.topicRemove.length > 0) ? await deps.recentExceptions(MAX_KEPT_EXAMPLES) : [];
          const keepOnlyIds = new Set(keepPass.map((s) => s.facts.videoId));
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
            for (const s of group) if (!keepOnlyIds.has(s.facts.videoId)) judged.add(s.facts.videoId);
            if (!parsed.ok) {
              deps.log?.({ event: 'apiShapeChanged', model: endpoint.model, problem: parsed.detail, shape: '' });
              return fail(group, { reason: parsed.reason, countsAsFailure: true });
            }
            for (const s of group) {
              const r = parsed.results.get(s.facts.videoId)!;
              s.newText = s.text = keepOnlyIds.has(s.facts.videoId) ? { ...r, keepOnly: true } : r;
            }
            outcomes.push({ ok: true, model: endpoint.model, fallback: false });
          };

          const sendText = async (group: Slot[], removeRules: Rule[]): Promise<void> => {
            const facts = group.map((s) => s.facts);
            const needsChoice = group.some((s) => !keepOnlyIds.has(s.facts.videoId));
            const merged = new Map<string, CachedText>();
            let lastOk: { model: string; fallback: boolean } | undefined;
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
              // §8.3: every Tile in a paid text request counts as judged, keep-only Tiles do not.
              if (gi === 0) for (const s of group) if (!keepOnlyIds.has(s.facts.videoId)) judged.add(s.facts.videoId);
              const valid = validateResponse(sent.json, built.questions);
              if (!valid.ok) {
                await account(sent.model, readUsage(sent.json));
                deps.log?.({ event: 'apiShapeChanged', model: sent.model, problem: valid.problem, shape: valid.shape });
                return fail(group, { reason: 'apiShapeChanged', countsAsFailure: true });
              }
              await account(sent.model, valid.value.usage);
              for (const [videoId, r] of deriveTextResults(built, valid.value.answers, sent.model)) {
                const prev = merged.get(videoId);
                merged.set(videoId, prev ? mergeKeep(prev, r) : r);
              }
              lastOk = { model: sent.model, fallback: sent.fallback };
            }
            for (const s of group) {
              const r = merged.get(s.facts.videoId)!;
              s.newText = s.text = keepOnlyIds.has(s.facts.videoId) ? { ...r, keepOnly: true } : withoutKeepOnly(r);
            }
            if (lastOk) outcomes.push({ ok: true, ...lastOk });
          };

          // Tiles from Subscribed channels go in requests of their own, asked only the Rules that apply to them.
          const all = [...fullPass, ...keepPass];
          const sends: Promise<void>[] = [];
          for (const view of views) {
            const group = all.filter((s) => s.view === view);
            const size = custom ? 16 : textBatchSizeFor(TEXT_FRAMING, view.topicRemove.length, keepGroups[0]!.length);
            for (const part of chunk(group, size)) sends.push(custom ? sendCustom(part, view.topicRemove) : sendText(part, view.topicRemove));
          }
          await Promise.all(sends);
        }

        // Stage 7: thumbnail pass, only where stage 6 matched no Rule at all.
        if (hasThumb && images) {
          const thumbPass = modelSlots.filter(
            (s) => s.exact.kind === 'none' && s.view.thumbnail.length > 0 && !s.thumb && !s.reason && needsThumbnailPass(s.text, s.view.hasTopicRules),
          );
          await Promise.all(
            thumbPass.map((s) =>
              thumbSem.run(async () => {
                const keepTile = () => {
                  s.thumb = { p: 0, model: models.image };
                  s.thumbKept = true;
                };
                const dataUrl = await fetchThumbnail(deps.fetch, s.facts.videoId, deps.timeouts?.thumbnailMs);
                if (!dataUrl) return keepTile();
                const built = buildThumbnailRequest(s.view.thumbnail, s.facts, dataUrl, { model: models.image });
                if (!(await stillAllowed([s]))) return;
                const sent = await sendDecisions(decisionsDeps, key, built.body, 'thumbnail', FALLBACK_MODELS.image, target);
                requests += sent.requests;
                if (!sent.ok) {
                  if (sent.keepTile) return keepTile();
                  return fail([s], sent);
                }
                if (!s.view.hasTopicRules) judged.add(s.facts.videoId);
                const valid = validateResponse(sent.json, built.questions);
                if (!valid.ok) {
                  await account(sent.model, readUsage(sent.json));
                  deps.log?.({ event: 'apiShapeChanged', model: sent.model, problem: valid.problem, shape: valid.shape });
                  return fail([s], { reason: 'apiShapeChanged', countsAsFailure: true });
                }
                await account(sent.model, valid.value.usage);
                s.newThumb = s.thumb = deriveThumbResult(built, valid.value.answers, sent.model);
                outcomes.push({ ok: true, model: sent.model, fallback: sent.fallback });
              }),
            ),
          );
        }

        // Side effects after paid calls: a storage error must not throw away the results (cost first).
        const guard = async (what: string, fn: () => Promise<void>) => {
          try {
            await fn();
          } catch {
            deps.log?.({ event: 'sideEffectFailed', what });
          }
        };
        if (requests > 0) await guard('addCost', () => deps.addCost({ usd: costUsd, judged: opts.countJudged ? judged.size : 0, requests }, ctx));
        const outcome = summarizeOutcomes(outcomes);
        if (outcome) await guard('recordModelOutcome', () => deps.recordModelOutcome(outcome));
        if (opts.useCache && !ctx.private) {
          const at = deps.now();
          const puts: VerdictPut[] = [];
          for (const s of modelSlots) {
            if (!s.newText && !s.newThumb) continue;
            const put: VerdictPut = { videoId: s.facts.videoId, rulesVersion: s.view.cacheRv, at };
            if (s.newText) put.text = s.newText;
            if (s.newThumb) put.thumb = s.newThumb;
            puts.push(put);
          }
          if (puts.length > 0) await guard('cachePut', () => deps.cachePut(puts));
        }
      }
    }

    // Stage 8: final Verdicts with the current Filtering strength, in input order.
    const now = deps.now();
    const results: TileResult[] = items.map((t) => {
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
    });
    return { results, rulesVersion: rv, costUsd };
  }

  return {
    judgeTiles(items, ctx) {
      return run(items, ctx, { useCache: true, ignoreDailyCap: false, countJudged: true });
    },

    async tryTitle(input, ctx) {
      const title = typeof input.title === 'string' ? input.title.trim() : '';
      if (!title || title.length > TRY_TITLE_MAX_CHARS) return { error: 'invalidInput' };
      const channelName = typeof input.channelName === 'string' && input.channelName.trim() ? input.channelName.trim() : undefined;
      const d = input.durationSec;
      if (d !== undefined && !(typeof d === 'number' && Number.isFinite(d) && d >= 0)) return { error: 'invalidInput' };
      let videoId = TRY_TITLE_ID;
      if (typeof input.thumbnailUrl === 'string' && input.thumbnailUrl.trim()) {
        const parsed = parseThumbnailInput(input.thumbnailUrl);
        if (!parsed) return { error: 'invalidInput' };
        videoId = parsed;
      }
      const allowed = await deps.modelAllowed({ ctx, ignoreDailyCap: true });
      if (!allowed.ok) return { error: allowed.reason };
      const tile: TileFacts = {
        videoId,
        surface: 'home',
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
  };
}
