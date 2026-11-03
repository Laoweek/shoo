// Test harness for background tests only (never imported by runtime code): in-memory storage areas, a
// fake Platform that records messages sent to tabs, senders, and a fake OpenRouter.
import { vi } from 'vitest';
import type { TileFacts } from '~/core/types';
import { DECISIONS_URL } from '~/engine/decisions';
import { KEY_URL } from '~/engine/key';
import type { FetchLike } from '~/engine/net';
import { answerer, type RecordedRequest, type Scripted } from '~/engine/testing';
import { setOpenRouterKey } from '~/store/secret';
import { createMemoryArea } from '~/store/testing/quota-storage';
import { createBackground } from './app';
import type { Platform, TabInfo } from './platform';
import type { Inbound, RawSender, Req } from './router';
import { CONSENT_VERSION } from '~/store/schema';

export const EXT_ID = 'test-extension-id';
export const EXT_ORIGIN = `chrome-extension://${EXT_ID}/`;
export const T0 = new Date(2026, 9, 10, 12, 0, 0).getTime();

export const contentSender = (tabId = 1, incognito = false, url = 'https://www.youtube.com/'): RawSender => ({
  id: EXT_ID,
  url,
  tab: { id: tabId, url, incognito },
});
export const pageSender = (page = 'options.html'): RawSender => ({ id: EXT_ID, url: `${EXT_ORIGIN}${page}` });

export const tile = (videoId: string, title: string, over: Partial<TileFacts> = {}): TileFacts => ({
  videoId,
  surface: 'home',
  title,
  isShort: false,
  isLive: false,
  isUpcoming: false,
  isMembersOnly: false,
  ...over,
});

const toResponse = (r: Scripted) => {
  if (r.throws) throw new TypeError('Failed to fetch');
  return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers ?? { 'content-type': 'application/json' } });
};

/** A fake fetch: Decisions requests go to `decisions`, /api/v1/key to `key`. Records every request. */
export function fakeOpenRouter(opts: { decisions?: (req: RecordedRequest) => Scripted; key?: () => Scripted } = {}) {
  const requests: RecordedRequest[] = [];
  const decisions =
    opts.decisions ?? answerer({ choose: (title) => (/react/i.test(title) ? { keep: 0.05, R1: 0.95 } : { keep: 0.97, R1: 0.03 }) });
  const fetchFn: FetchLike = async (input, init) => {
    const url = String(input);
    const req: RecordedRequest = { url, init, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined };
    requests.push(req);
    if (url.startsWith(DECISIONS_URL)) return toResponse(decisions(req));
    if (url.startsWith(KEY_URL)) return toResponse(opts.key?.() ?? { status: 200, body: { data: { label: 'sk-or-v1-abc...xyz', usage: 0.5, usage_daily: 0.1, limit: null, limit_remaining: null } } });
    throw new Error(`unscripted request to ${url}`);
  };
  return { fetch: fetchFn, requests, decisionRequests: () => requests.filter((r) => r.url.startsWith(DECISIONS_URL)) };
}

export interface Sent {
  type: string;
  data: any;
  tabId: number;
}

export function harness(opts: { fetch?: FetchLike; tabs?: TabInfo[]; hosts?: Record<string, boolean> } = {}) {
  const areas = { sync: createMemoryArea(), local: createMemoryArea(), session: createMemoryArea() };
  const clock = { t: T0 };
  const sent: Sent[] = [];
  const tabs = new Map<number, TabInfo>((opts.tabs ?? [{ id: 1, url: 'https://www.youtube.com/', incognito: false }]).map((t) => [t.id!, t]));
  const alarms = new Map<string, unknown>();
  const net = { online: true };
  /** Firefox's optional data collection permission (`dataCollection()`), granted by default. */
  const perms = { dataCollection: true };
  /** Extension tabs as runtime.getContexts reports them. */
  const extensionTabs: { tabId: number; windowId: number; url: string }[] = [];
  const undoReplies = new Map<number, unknown>();
  const platform: Platform = {
    areas,
    fetch: opts.fetch ?? fakeOpenRouter().fetch,
    sleep: async () => undefined,
    now: () => clock.t,
    runtimeId: EXT_ID,
    getURL: (path) => `chrome-extension://${EXT_ID}${path}`,
    tabs: {
      query: async (q) => {
        const all = [...tabs.values()];
        if (q.url) return all.filter((t) => t.url?.startsWith('https://www.youtube.com/'));
        return all.slice(0, 1);
      },
      get: async (id) => {
        const t = tabs.get(id);
        if (!t) throw new Error(`No tab with id: ${id}`);
        return t;
      },
      create: vi.fn(async () => undefined),
      update: vi.fn(async () => undefined),
    },
    focusWindow: vi.fn(async () => undefined),
    extensionTabs: async () => extensionTabs,
    sendToTab: vi.fn(async (type, data, tabId) => {
      sent.push({ type, data, tabId });
      if (type === 'undoRemoval') return (undoReplies.get(tabId) ?? { ok: true }) as never;
      return undefined as never;
    }),
    hasHost: async (origin) => opts.hosts?.[origin] ?? true,
    dataCollection: async () => perms.dataCollection,
    action: {
      setIcon: vi.fn(async () => undefined),
      setBadgeText: vi.fn(async () => undefined),
      setBadgeBackgroundColor: vi.fn(async () => undefined),
    },
    alarms: {
      get: vi.fn(async (name: string) => alarms.get(name)),
      create: vi.fn((name: string, info: unknown) => void alarms.set(name, info)),
    },
    isOnline: () => net.online,
    darkToolbar: () => false,
  };
  const bg = createBackground(platform);
  const call = <K extends Inbound>(type: K, data: Req<K>, sender: RawSender = pageSender()) => bg.dispatch(type, data, sender);
  return {
    bg,
    areas,
    clock,
    sent,
    tabs,
    alarms,
    net,
    perms,
    extensionTabs,
    undoReplies,
    platform,
    call,
    writer: bg.services.writer,
    /** Messages of one type sent to tabs. */
    sentOf: (type: string) => sent.filter((m) => m.type === type),
    async connect(): Promise<void> {
      await setOpenRouterKey({ key: 'sk-or-v1-test', source: 'pasted', connectedAt: T0 }, areas.local);
      await call('giveConsent', { version: CONSENT_VERSION });
    },
    async addRules(...ops: Req<'mutateRules'>['ops']) {
      const res = await call('mutateRules', { ops });
      if ('error' in res) throw new Error(`${res.error} ${res.detail}`);
      return res.rules;
    },
  };
}

export const topicRule = (text: string) => ({ op: 'add' as const, rule: { polarity: 'remove' as const, kind: 'topic' as const, text, enabled: true, origin: 'user' as const } });
export const keywordRule = (text: string) => ({ op: 'add' as const, rule: { polarity: 'remove' as const, kind: 'keyword' as const, text, enabled: true, origin: 'user' as const } });
export const banRule = (name: string) => ({
  op: 'add' as const,
  rule: { polarity: 'remove' as const, kind: 'channel' as const, text: name, params: { channelName: name }, enabled: true, origin: 'user' as const },
});
