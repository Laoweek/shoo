// Browser APIs the background uses, behind one small interface so tests can pass fakes (fakeBrowser lacks
// permissions.contains, and tests need to capture messages sent to tabs). `browserPlatform()` is the real one.
// The browser differences it hides: docs/spec/cross-browser-and-stores.md Section 2.
import { browser } from 'wxt/browser';
import { DATA_COLLECTION } from '~/core/types';
import type { IdentityLike } from '~/engine/oauth';
import type { FetchLike, Sleep } from '~/engine/net';
import type { ProtocolMap } from '~/messaging/protocol';
import { sendWire } from '~/messaging/wire';
import { browserAreas, type Areas } from '~/store/areas';

/** Background → content messages, sent to one tab. */
export type ToTab = 'runtimeStateChanged' | 'settingsChanged' | 'undoRemoval' | 'tileVerdicts';
export type TabReq<K extends ToTab> = Parameters<ProtocolMap[K]>[0];
export type TabRes<K extends ToTab> = ReturnType<ProtocolMap[K]>;

export interface TabInfo {
  id?: number;
  url?: string;
  incognito?: boolean;
}

export interface Platform {
  areas: Areas;
  fetch: FetchLike;
  sleep?: Sleep;
  now(): number;
  runtimeId: string;
  getURL(path: string): string;
  tabs: {
    query(q: { url?: string | string[]; active?: boolean; lastFocusedWindow?: boolean }): Promise<TabInfo[]>;
    get(tabId: number): Promise<TabInfo>;
    create(p: { url: string }): Promise<unknown>;
    update(tabId: number, p: { url?: string; active?: boolean }): Promise<unknown>;
  };
  /** windows.update(windowId, { focused: true }). */
  focusWindow(windowId: number): Promise<unknown>;
  /** This extension's pages open in tabs (runtime.getContexts, Chrome 116+, Firefox 127+). */
  extensionTabs(): Promise<{ tabId: number; windowId: number; url: string }[]>;
  sendToTab<K extends ToTab>(type: K, data: TabReq<K>, tabId: number): Promise<TabRes<K>>;
  /** permissions.contains for one origin pattern, e.g. 'https://www.youtube.com/*'. */
  hasHost(origin: string): Promise<boolean>;
  /**
   * Firefox: whether every optional data collection category Shoo asked for (DATA_COLLECTION) is still
   * granted. The user can revoke each one in about:addons. Chrome has no such permission and answers true.
   */
  dataCollection(): Promise<boolean>;
  action: {
    setIcon(d: { tabId?: number; path: Record<number, string> }): Promise<void>;
    setBadgeText(d: { tabId?: number; text: string }): Promise<void>;
    setBadgeBackgroundColor(d: { color: string }): Promise<void>;
  };
  alarms: {
    get(name: string): Promise<unknown>;
    create(name: string, info: { periodInMinutes: number; delayInMinutes?: number }): Promise<void> | void;
  };
  identity?: IdentityLike;
  /** navigator.onLine at call time. */
  isOnline(): boolean;
  /** Whether the toolbar is dark. Chrome's service worker has no matchMedia, so it answers false there. */
  darkToolbar(): boolean;
  /** Diagnostics. Never pass keys, Authorization headers, OAuth codes, error bodies or feedback tokens. */
  log?(event: string, detail?: Record<string, unknown>): void;
}

export function browserPlatform(): Platform {
  return {
    areas: browserAreas(),
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    runtimeId: browser.runtime.id,
    getURL: (path) => browser.runtime.getURL(path as '/'),
    tabs: {
      query: (q) => browser.tabs.query(q),
      get: (tabId) => browser.tabs.get(tabId),
      create: (p) => browser.tabs.create(p),
      update: (tabId, p) => browser.tabs.update(tabId, p),
    },
    focusWindow: (windowId) => browser.windows.update(windowId, { focused: true }),
    extensionTabs: async () =>
      (await browser.runtime.getContexts({ contextTypes: [browser.runtime.ContextType.TAB] })).flatMap((c) =>
        c.tabId >= 0 && c.documentUrl ? [{ tabId: c.tabId, windowId: c.windowId, url: c.documentUrl }] : [],
      ),
    sendToTab: (type, data, tabId) => sendWire(type, data, tabId) as never,
    hasHost: (origin) => browser.permissions.contains({ origins: [origin] }),
    dataCollection: () =>
      import.meta.env.BROWSER === 'firefox'
        ? (browser.permissions.contains as (p: { data_collection: readonly string[] }) => Promise<boolean>)({ data_collection: DATA_COLLECTION })
        : Promise.resolve(true),
    action: {
      setIcon: async (d) => void (await browser.action.setIcon(d)),
      setBadgeText: async (d) => void (await browser.action.setBadgeText(d)),
      setBadgeBackgroundColor: async (d) => void (await browser.action.setBadgeBackgroundColor(d)),
    },
    alarms: {
      get: (name) => browser.alarms.get(name),
      create: (name, info) => browser.alarms.create(name, info),
    },
    identity: browser.identity
      ? {
          getRedirectURL: (path) => browser.identity.getRedirectURL(path),
          launchWebAuthFlow: (details) => browser.identity.launchWebAuthFlow(details),
        }
      : undefined,
    isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
    darkToolbar: () =>
      typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia('(prefers-color-scheme: dark)').matches : false,
  };
}
