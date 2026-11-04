// RuntimeSnapshot, failure counters and what the tabs are told. Source of truth: docs/spec/architecture.md
// Section 7 (reasons, precedence, counters) and Section 11 (action icon and badge).
//
// Inputs to core/runtime.ts computeRuntime:
// - settings, consent, key presence (the custom or direct key for those engines), host permissions checked with
//   permissions.contains on every snapshot and on permissions.onAdded/onRemoved (app.ts), failures and trips,
//   today's judged count (normal and private windows together) against the Daily cap. Consent counts only
//   for the recipient it names and the current CONSENT_VERSION. On Firefox the optional data collection
//   permission must still be granted (about:addons can revoke it), else the snapshot is noConsent.
// - `keyRejected` and `creditsExhausted` are timestamps kept in `local:runtime` next to the failure counters.
//   Both clear on setKey, connect, disconnect, setCustomEndpoint, setDirectEndpoint and an engine switch.
//   Resuming the model category clears `creditsExhausted`. A model success or a 200 from GET /api/v1/key
//   clears `keyRejected`.
// - offline: navigator.onLine at the time of the request, or an `offline` event not yet followed by `online`.
//   The engine reports a network error as 'modelError' (indistinguishable from a 5xx), so a failed request
//   does not by itself set offline. It counts as a model failure instead.
// - migrating: a schema migration is running (writer.init after an update), see services.ts ensureInit.
// - reviewPending and judging per tab, in memory. reviewPending is mirrored in storage.session so it
//   survives a background restart.
import { exactVersion } from '~/core/ids';
import { SITE_IDS, SITE_ORIGINS } from '~/core/sites';
import { computeRuntime, endpointBase, endpointHost, endpointPattern, recordFailure, recordSuccess, type FailureState, type RuntimeInputs } from '~/core/runtime';
import type { FailureCategory, ReasonCode, RuntimeSnapshot, Settings, SiteId } from '~/core/types';
import { computeRulesVersion } from '~/engine/judge';
import { CONSENT_VERSION } from '~/store/schema';
import { getCustomKey, getDirectKey, hasOpenRouterKey } from '~/store/secret';
import type { PrivacyContext, Writer } from '~/store/writer';
import { toolbarIconPaths } from '~/ui/toolbar-icon';
import type { Platform, TabInfo } from './platform';

/** `local:runtime` as the background stores it. */
export type RuntimeRecord = FailureState & { keyRejected?: number; creditsExhausted?: number };

export const YOUTUBE_ORIGIN = 'https://www.youtube.com/*';
export const OPENROUTER_ORIGIN = 'https://openrouter.ai/*';
export const BADGE_COLOUR = '#121214';
const REVIEW_KEY = 'reviewPending';

type Base = Omit<RuntimeInputs, 'reviewPending' | 'judging'>;

export interface RuntimeStateDeps {
  platform: Platform;
  writer: Writer;
  isMigrating(): boolean;
}

/**
 * Host permission pattern for the active model host. For a direct or custom endpoint it is the same pattern the
 * page requests on Save (core/runtime.ts endpointPattern): `<origin>/*` with the port on Chrome, the
 * portless host on Firefox, where a pattern with a port matches no URL.
 */
export function modelOrigin(settings: Settings, firefox: boolean = import.meta.env.BROWSER === 'firefox'): string | undefined {
  if (settings.engine === 'openrouter') return OPENROUTER_ORIGIN;
  const base = endpointBase(settings);
  if (!base || !endpointHost(base)) return undefined;
  return endpointPattern(base, firefox);
}

function without<T extends object, K extends keyof T>(o: T, ...keys: K[]): Omit<T, K> {
  const out = { ...o };
  for (const k of keys) delete out[k];
  return out;
}

export function createRuntimeState(d: RuntimeStateDeps) {
  const { platform, writer } = d;
  const { areas } = platform;
  const review = new Map<number, number>();
  let reviewLoaded: Promise<void> | undefined;
  const judging = new Map<number, number>();
  let offlineEvent = false;
  let lastKey: string | undefined;
  let lastSettingsSig: string | undefined;
  let lastRulesVersion = '';
  // Only the global icon is memoized: a per-tab icon resets when the tab navigates (MDN action.setIcon).
  let globalIconMemo: string | undefined;
  let refreshing: Promise<unknown> = Promise.resolve();
  let lastBadge: string | undefined;

  const safe = async <T>(p: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await p;
    } catch {
      return fallback;
    }
  };

  function loadReview(): Promise<void> {
    reviewLoaded ??= (async () => {
      const raw = (await safe(areas.session.get(REVIEW_KEY), {} as Record<string, unknown>))[REVIEW_KEY];
      if (raw && typeof raw === 'object') {
        for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && !review.has(Number(k))) review.set(Number(k), v);
      }
    })();
    return reviewLoaded;
  }

  async function saveReview(): Promise<void> {
    await safe(areas.session.set({ [REVIEW_KEY]: Object.fromEntries(review) }), undefined);
  }

  async function getRecord(): Promise<RuntimeRecord> {
    return (await writer.getRuntime()) as RuntimeRecord;
  }

  async function gather(): Promise<Base> {
    const settings = await writer.getSettings();
    const migrating = d.isMigrating();
    const origin = modelOrigin(settings);
    const [record, hasKey, hostYouTube, hostModel, dataCollection, counters] = await Promise.all([
      getRecord(),
      // A saved custom or direct endpoint counts as keyed even with an empty key: local endpoints need none.
      settings.engine === 'custom'
        ? getCustomKey(areas.local).then((k) => k !== undefined)
        : settings.engine === 'direct'
          ? getDirectKey(areas.local).then((k) => k !== undefined)
          : hasOpenRouterKey(areas.local),
      safe(platform.hasHost(YOUTUBE_ORIGIN), false),
      origin ? safe(platform.hasHost(origin), false) : Promise.resolve(false),
      safe(platform.dataCollection(), false),
      writer.getDayCounters(writer.today()),
    ]);
    // Rules wait for writer.init, so a migration in progress keeps the last known rulesVersion.
    if (!migrating) lastRulesVersion = computeRulesVersion(await writer.getRules(), settings);
    return {
      settings,
      hasKey,
      keyRejected: record.keyRejected !== undefined,
      creditsExhausted: record.creditsExhausted !== undefined,
      migrating,
      hostYouTube,
      hostModel,
      tripped: record.tripped,
      ...(record.trippedSite && { trippedSite: record.trippedSite }),
      dailyCapReached: counters.judged >= settings.dailyCap,
      offline: offlineEvent || !platform.isOnline(),
      rulesVersion: lastRulesVersion,
      consentVersion: CONSENT_VERSION,
      dataCollection,
    };
  }

  function forTab(base: Base, tabId?: number): RuntimeSnapshot {
    const snap = computeRuntime({
      ...base,
      ...(tabId !== undefined && { reviewPending: review.get(tabId) ?? 0, judging: (judging.get(tabId) ?? 0) > 0 }),
    });
    snap.notificationStyle = base.settings.notificationStyle;
    snap.shelfDismissal = base.settings.shelfDismissal;
    return snap;
  }

  /** What content acts on. Per-tab eyes (judging, review) only change the toolbar icon, never a broadcast. */
  const broadcastKey = (s: RuntimeSnapshot) =>
    JSON.stringify([s.enabled, s.mode, s.reason, s.detail ?? null, s.site ?? null, s.stages, s.surfaces, s.notificationStyle, s.shelfDismissal]);

  /** Tabs of every Site, those whose content script Shoo talks to. A Site without host access lists none. */
  async function siteTabs(): Promise<(TabInfo & { id: number })[]> {
    const tabs = await safe(platform.tabs.query({ url: SITE_IDS.map((site) => `${SITE_ORIGINS[site]}/*`) }), []);
    return tabs.filter((t): t is TabInfo & { id: number } => typeof t.id === 'number');
  }

  async function setIcon(target: number | 'all', eye: RuntimeSnapshot['eye'], dark: boolean): Promise<void> {
    const path = toolbarIconPaths(eye, dark);
    if (target === 'all') {
      const memo = JSON.stringify(path);
      if (globalIconMemo === memo) return;
      globalIconMemo = memo;
    }
    await safe(platform.action.setIcon(target === 'all' ? { path } : { tabId: target, path }), undefined);
  }

  async function paintIcons(base: Base, tabs: { id: number }[]): Promise<void> {
    const dark = platform.darkToolbar();
    await setIcon('all', forTab(base).eye, dark);
    await Promise.all(tabs.map((t) => setIcon(t.id, forTab(base, t.id).eye, dark)));
    const removed = (await safe(writer.getDayCounters(writer.today()), { removed: 0 } as { removed: number })).removed;
    const text = removed > 0 ? String(removed) : '';
    if (text !== lastBadge) {
      lastBadge = text;
      await safe(platform.action.setBadgeBackgroundColor({ color: BADGE_COLOUR }), undefined);
      await safe(platform.action.setBadgeText({ text }), undefined);
    }
  }

  async function refreshNow(tabId?: number): Promise<RuntimeSnapshot> {
    await loadReview();
    const base = await gather();
    const tabs = await siteTabs();
    const global = forTab(base);
    const key = broadcastKey(global);
    if (key !== lastKey) {
      lastKey = key;
      await Promise.all(tabs.map((t) => safe(platform.sendToTab('runtimeStateChanged', forTab(base, t.id), t.id), undefined)));
    }
    await paintIcons(base, tabs);
    return tabId === undefined ? global : forTab(base, tabId);
  }

  const state = {
    gather,
    forTab,

    /** The snapshot for one tab (reviewPending and judging of that tab), or the global one. */
    async snapshot(tabId?: number): Promise<RuntimeSnapshot> {
      await loadReview();
      return forTab(await gather(), tabId);
    },

    /** The popup asks for the active tab's reviewPending. */
    async activeTabId(): Promise<number | undefined> {
      const [tab] = await safe(platform.tabs.query({ active: true, lastFocusedWindow: true }), []);
      return tab?.id;
    },

    /**
     * Recomputes the snapshot, sends runtimeStateChanged to every Site tab when what content acts on
     * changed (reason, detail, site, stages, mode, enabled, surfaces, notificationStyle, shelfDismissal),
     * and repaints icons and the badge. Returns the snapshot for `tabId`, or the global one.
     */
    refresh(tabId?: number): Promise<RuntimeSnapshot> {
      // One at a time, so a refresh that gathered before a write never broadcasts after a newer one.
      const run = refreshing.then(() => refreshNow(tabId));
      refreshing = run.catch(() => undefined);
      return run;
    },

    /**
     * Sends settingsChanged to every Site tab, so content re-judges what it shows. Without `force` it is
     * sent only when the generation, rulesVersion or Exact rules changed since the last one (remote merges
     * and imports can report one change twice). Rule, Keep rule, Banned channel and Exception changes pass
     * `force`, since Exceptions and some Rule edits change neither version. `actOnChipsTab` adds
     * `actOnShowingChips: true` for that one tab only: the popup's "Remove the N flagged videos now?"
     * counted only the active tab's chips (REQ-MODE-5).
     */
    async broadcastSettings(extra: { actOnChipsTab?: number; force?: boolean } = {}): Promise<void> {
      const settings = await writer.getSettings();
      const rules = await writer.getRules();
      const rulesVersion = computeRulesVersion(rules, settings);
      // Rule names are not in rulesVersion (a rename never re-judges) but tabs must still redraw their labels.
      const names = rules.map((r) => r.name ?? '').join('\u0001');
      const sig = `${settings.generation}|${rulesVersion}|${exactVersion(rules, settings.regexEnabled)}|${names}`;
      if (sig === lastSettingsSig && extra.actOnChipsTab === undefined && !extra.force) return;
      lastSettingsSig = sig;
      const msg = { settingsGeneration: settings.generation, rulesVersion };
      const tabs = await siteTabs();
      await Promise.all(
        tabs.map((t) => safe(platform.sendToTab('settingsChanged', t.id === extra.actOnChipsTab ? { ...msg, actOnShowingChips: true } : msg, t.id), undefined)),
      );
    },

    /** Marks a batch in flight for a tab and paints its 'judging' eye. Returns the end callback. */
    startJudging(base: Base, tabId: number | undefined): () => void {
      if (tabId === undefined) return () => undefined;
      judging.set(tabId, (judging.get(tabId) ?? 0) + 1);
      void setIcon(tabId, forTab(base, tabId).eye, platform.darkToolbar());
      return () => {
        const n = (judging.get(tabId) ?? 1) - 1;
        if (n > 0) judging.set(tabId, n);
        else judging.delete(tabId);
      };
    },

    async setReviewPending(tabId: number, count: number): Promise<void> {
      await loadReview();
      if (count > 0) review.set(tabId, count);
      else review.delete(tabId);
      await saveReview();
      const base = await gather();
      await setIcon(tabId, forTab(base, tabId).eye, platform.darkToolbar());
    },

    async forgetTab(tabId: number): Promise<void> {
      await loadReview();
      judging.delete(tabId);
      if (review.delete(tabId)) await saveReview();
    },

    setOfflineEvent(offline: boolean): void {
      offlineEvent = offline;
    },

    /**
     * Whether model calls may run (pipeline stages 6 and 7 and the keep-only question, JudgeDeps.modelAllowed).
     * The Native action breaker does not stop the model. Try a title (`ignoreDailyCap`) is a deliberate manual check: it also ignores the model
     * breaker, credits state, Off, migrations and the youtube.com permission, but still needs consent, a
     * key, the model host permission and a network.
     */
    async modelAllowed(opts: { ignoreDailyCap: boolean }): Promise<{ ok: true } | { ok: false; reason: ReasonCode }> {
      const base = await gather();
      const inputs: Base = opts.ignoreDailyCap
        ? {
            ...base,
            settings: { ...base.settings, enabled: true },
            migrating: false,
            hostYouTube: true,
            tripped: {},
            creditsExhausted: false,
            dailyCapReached: false,
          }
        : { ...base, tripped: without(base.tripped, 'nativeAction') };
      const snap = computeRuntime(inputs);
      return snap.stages.model ? { ok: true } : { ok: false, reason: snap.detail ?? (snap.reason as ReasonCode) };
    },

    // local:runtime -----------------------------------------------------------------------------------

    /** `site`: the Site whose markup failed (nativeAction and markup), named by the breaker's copy. */
    async failure(cat: FailureCategory, ctx?: PrivacyContext, site?: SiteId): Promise<void> {
      await writer.updateRuntime((s) => ({ ...s, ...recordFailure(s, cat, platform.now(), site).state }), ctx);
    },

    /** A success resets its own category (and a rejected key for 'model'). Skips the write when nothing changes. */
    async success(cat: FailureCategory, ctx?: PrivacyContext): Promise<void> {
      const cur = await getRecord();
      if (cur.failures[cat] === 0 && (cat !== 'model' || cur.keyRejected === undefined)) return;
      await writer.updateRuntime((s) => {
        const next: RuntimeRecord = { ...s, ...recordSuccess(s, cat).state };
        return cat === 'model' ? without(next, 'keyRejected') : next;
      }, ctx);
    },

    async setFlag(flag: 'keyRejected' | 'creditsExhausted'): Promise<void> {
      await writer.updateRuntime((s) => ({ ...s, [flag]: platform.now() }));
    },

    async clearFlags(...flags: ('keyRejected' | 'creditsExhausted')[]): Promise<void> {
      await writer.updateRuntime((s) => without(s as RuntimeRecord, ...flags));
    },

    /** Resume: clears the trip and the consecutive count of one category or all, and the credits state. */
    async resume(cat?: FailureCategory): Promise<void> {
      await writer.updateRuntime((s) => {
        const cats: FailureCategory[] = cat ? [cat] : ['model', 'nativeAction', 'markup'];
        const failures = { ...s.failures };
        const tripped = { ...s.tripped };
        const trippedSite = { ...s.trippedSite };
        for (const c of cats) {
          failures[c] = 0;
          delete tripped[c];
          delete trippedSite[c];
        }
        const next: RuntimeRecord = { ...s, failures, tripped, trippedSite };
        return cats.includes('model') ? without(next, 'creditsExhausted') : next;
      });
    },

    /** After Reset: forget per-tab state and memos so the next refresh repaints and rebroadcasts. */
    reset(): void {
      review.clear();
      judging.clear();
      globalIconMemo = undefined;
      lastKey = undefined;
      lastSettingsSig = undefined;
      lastBadge = undefined;
    },
  };
  return state;
}

export type RuntimeState = ReturnType<typeof createRuntimeState>;
