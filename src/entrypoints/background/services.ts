// The background's shared services: the writer, the judge, the model catalogue, key usage, OAuth deps and
// the RuntimeState tracker, built once per background start. Handlers receive this object.
import type { NativeAction, SurfaceId } from '~/core/types';
import { createJudge, type Judge, type JudgeContext } from '~/engine/judge';
import { createKeyUsage } from '~/engine/key';
import { createModelCatalog, type ModelCatalog, type ModelsCache } from '~/engine/models';
import type { OAuthDeps } from '~/engine/oauth';
import { createSubscriptions } from '~/engine/subscriptions';
import { getOne } from '~/store/areas';
import { getSubscriptions, getVerdicts, MODELS_KEY, setModelsCache, setSubscriptions } from '~/store/local';
import { needsMigration } from '~/store/schema';
import { getCustomKey, getDirectKey, getOpenRouterKey } from '~/store/secret';
import { clearOAuthSession, getOAuthSession, setOAuthSession } from '~/store/session';
import { createWriter, type PrivacyContext, type Writer } from '~/store/writer';
import type { Platform } from './platform';
import type { Sender } from './router';
import { createRuntimeState, type RuntimeState } from './runtime-state';

/** What reportUndo needs about a recent Removal (title, channel, Rule). Memory only, newest 500. */
export interface RemovalInfo {
  title: string;
  channelName?: string;
  channelKey?: string;
  ruleId?: string;
  surface: SurfaceId;
  nativeAction: NativeAction;
}

export interface Services {
  platform: Platform;
  writer: Writer;
  state: RuntimeState;
  judge: Judge;
  catalog: ModelCatalog;
  keyUsage: ReturnType<typeof createKeyUsage>;
  oauth: OAuthDeps;
  now(): number;
  /** Runs migrations and loads sync once. RuntimeState is `migrating` while a schema migration runs. */
  ensureInit(): Promise<void>;
  privacy(sender: Sender): PrivacyContext;
  judgeContext(sender: Sender): JudgeContext;
  removals: Map<string, RemovalInfo>;
  rememberRemoval(videoId: string, info: RemovalInfo): void;
  /** Called by the writer after remote Rule merges and imports. Set by app.ts. */
  onRulesChanged?: () => void;
  /**
   * Runs check-then-act sequences one at a time (read Rules, then mutateRules; read-modify-write of
   * session:removalTabs). The writer queue serializes single writes, not a read followed by a write.
   */
  exclusive<T>(fn: () => Promise<T>): Promise<T>;
  /** Runs a writer call whose handler broadcasts itself, so the writer's onRulesChanged does not send twice. */
  quietRules<T>(fn: () => Promise<T>): Promise<T>;
}

const REMOVALS_MAX = 500;

export function createServices(platform: Platform): Services {
  const { areas } = platform;
  const now = () => platform.now();
  const log = platform.log;

  // Created synchronously at background start: the writer registers storage.sync.onChanged in its constructor.
  const writer = createWriter({
    areas,
    now,
    onRulesChanged: () => {
      if (quiet === 0) services.onRulesChanged?.();
    },
    onError: (e) => log?.('writerError', { name: e instanceof Error ? e.name : 'unknown' }),
  });

  let quiet = 0;
  let chain: Promise<unknown> = Promise.resolve();
  let migrating = false;
  let ready: Promise<void> | undefined;
  const ensureInit = (): Promise<void> => {
    ready ??= (async () => {
      migrating = await needsMigration(areas).catch(() => false);
      if (migrating) void state.refresh().catch(() => undefined);
      try {
        await writer.init();
      } finally {
        const was = migrating;
        migrating = false;
        if (was) void state.refresh().catch(() => undefined);
      }
    })().catch((e: unknown) => {
      ready = undefined;
      throw e;
    });
    return ready;
  };

  const state = createRuntimeState({ platform, writer, isMigrating: () => migrating });

  const catalog = createModelCatalog({
    fetch: platform.fetch,
    now,
    // The raw stored list without the 24 h check: the catalogue serves a stale list when offline.
    getCache: () => getOne<ModelsCache>(areas.local, MODELS_KEY),
    setCache: (c) => setModelsCache(areas.local, c),
  });

  const subscriptions = createSubscriptions({
    fetch: platform.fetch,
    now,
    get: () => getSubscriptions(areas.local),
    set: (v) => setSubscriptions(areas.local, v),
    // Content re-sends its Tiles. A Tile whose channel joined or left the list misses the Verdict cache.
    onChanged: () => void state.broadcastSettings({ force: true }).catch(() => undefined),
  });

  const privacy = (sender: Sender): PrivacyContext =>
    sender.kind === 'content' && sender.incognito && sender.tabId !== undefined ? { incognitoTabId: sender.tabId } : {};
  const fromJudge = (ctx: JudgeContext): PrivacyContext => (ctx.private && ctx.tabId !== undefined ? { incognitoTabId: ctx.tabId } : {});

  const judge = createJudge({
    now,
    fetch: platform.fetch,
    ...(platform.sleep && { sleep: platform.sleep }),
    getKey: async () => (await getOpenRouterKey(areas.local))?.key,
    getCustomKey: async () => (await getCustomKey(areas.local))?.key,
    getDirectKey: async () => (await getDirectKey(areas.local))?.key,
    settings: () => writer.getSettings(),
    rules: () => writer.getRules(),
    exceptionIds: async (ids, ctx) => {
      const want = new Set(ids);
      const all = await writer.getExceptions(fromJudge(ctx));
      return new Set(all.map((x) => x.videoId).filter((id) => want.has(id)));
    },
    recentExceptions: async (n, keep) => (await writer.getExceptions()).filter(keep).slice(0, n),
    // A failed storage read or write counts as no list, so the fail safe holds the Tiles (REQ-RULE-14).
    subscriptions: (ctx) => subscriptions.current({ mayRead: !ctx.private }).catch(() => undefined),
    cacheGet: (ids, rv) => getVerdicts(areas.local, ids, rv),
    cachePut: (puts) => writer.putVerdicts(puts),
    addCost: async (c, ctx) => {
      await writer.bumpCounters(writer.today(), { costUsd: c.usd, judged: c.judged, requests: c.requests }, fromJudge(ctx));
    },
    // ModelOutcome carries no JudgeContext, so failures from private windows count too. The counters hold
    // no browsing data (architecture.md Section 8 lists what private windows must not write).
    recordModelOutcome: async (o) => {
      if (o.ok) await state.success('model');
      else if (o.reason === 'keyRejected') await state.setFlag('keyRejected');
      else if (o.reason === 'creditsExhausted') await state.setFlag('creditsExhausted');
      else if (o.countsAsFailure) await state.failure('model');
    },
    modelAllowed: ({ ignoreDailyCap }) => state.modelAllowed({ ignoreDailyCap }),
    priceFor: (model) => catalog.priceFor(model),
    log: (e) => log?.('engine', { event: e.event }),
  });

  const removals = new Map<string, RemovalInfo>();

  const services: Services = {
    platform,
    writer,
    state,
    judge,
    catalog,
    keyUsage: createKeyUsage({ fetch: platform.fetch, now }),
    oauth: {
      fetch: platform.fetch,
      now,
      ...(platform.identity && { identity: platform.identity }),
      session: {
        get: async () => {
          const s = await getOAuthSession(areas.session);
          return s ? { verifier: s.codeVerifier, state: s.state, startedAt: s.startedAt } : undefined;
        },
        set: (s) => (s ? setOAuthSession(areas.session, { codeVerifier: s.verifier, state: s.state, startedAt: s.startedAt }) : clearOAuthSession(areas.session)),
      },
    },
    now,
    ensureInit,
    privacy,
    judgeContext: (sender) => ({ private: sender.kind === 'content' && sender.incognito, ...(sender.tabId !== undefined && { tabId: sender.tabId }) }),
    removals,
    exclusive(fn) {
      const run = chain.then(fn, fn);
      chain = run.catch(() => undefined);
      return run;
    },
    async quietRules(fn) {
      quiet++;
      try {
        return await fn();
      } finally {
        quiet--;
      }
    },
    rememberRemoval(videoId, info) {
      removals.delete(videoId);
      removals.set(videoId, info);
      if (removals.size > REMOVALS_MAX) removals.delete(removals.keys().next().value!);
    },
  };
  return services;
}
