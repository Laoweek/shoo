// Test-only helpers for the content pipeline tests: a fake background behind the Messages contract and a loaded
// Home page wired to the simulated YouTube menu. Never imported by production code.
import { vi } from 'vitest';
import type { RuntimeSnapshot, TileFacts, TileResult, Verdict } from '~/core/types';
import type { ProtocolMap, RuleDisplay } from '~/messaging/protocol';
import { youtube } from '~/sites/youtube';
import { SURFACES, visiblePage } from '~/sites/youtube/surfaces';
import { FIXTURES, fakeIntersection, loadPage, manualScheduler, microtasks, simulateYouTube, type WireOptions } from '~/sites/youtube/test-harness';
import { createPipeline, type Pipeline } from './pipeline';
import type { Data, Send } from './send';
import { createPageUi, type PageUi } from './ui';

export const DROPPED = 'Could not establish connection. Receiving end does not exist.';

export const RULES: Record<string, RuleDisplay> = {
  r1: { ref: 'R1', text: 'Reaction videos', colour: 'c1' },
  r2: { ref: 'R2', text: 'Videos about cryptocurrency or trading', name: 'Crypto & trading', colour: 'c2' },
};

export function snapshot(over: Partial<RuntimeSnapshot> = {}): RuntimeSnapshot {
  return {
    enabled: true,
    mode: 'review',
    reason: 'ok',
    stages: { exact: true, model: true, nativeActions: true, ui: true },
    eye: 'watching',
    settingsGeneration: 1,
    rulesVersion: 'rv1',
    surfaces: { home: true, watchSidebar: true, shortsShelf: true, search: false, channel: false, endScreen: false, bilibiliHome: true, bilibiliVideoSidebar: false },
    ...over,
  };
}

export const OFF = snapshot({ enabled: false, reason: 'off', stages: { exact: false, model: false, nativeActions: false, ui: false }, eye: 'paused' });

// ref: the Verdict's ruleRef for a ruleId the reply has no display data for (default the RULES entry's ref).
type Outcome = { ruleId: string; ref?: string; source?: Verdict['source']; p?: number } | 'keep' | { undecided: TileResult['reason'] };

export interface Call {
  type: keyof ProtocolMap;
  data: unknown;
}

/** A fake background: answers from `state` and the per-video `outcomes` (default keep). */
export function fakeBackground() {
  const bg = {
    state: snapshot(),
    outcomes: new Map<string, Outcome>(),
    calls: [] as Call[],
    /** Throw the "receiving end does not exist" error for the next n messages. */
    drop: 0,
    /** Hold judgeTiles replies until release(). */
    hold: false,
    held: [] as Array<() => void>,
    /** judgeTiles replies say the tab is a private window. */
    private: false,
    /** The channel is Banned: keepChannel without liftBan creates nothing and answers ruleId ''. */
    banned: false,
    /** reportActionResult replies carry this automatic Escalation. */
    escalated: undefined as { ruleId: string; channelName: string } | undefined,
    release() {
      for (const r of bg.held.splice(0)) r();
    },
    of<K extends keyof ProtocolMap>(type: K): Data<K>[] {
      return bg.calls.filter((c) => c.type === type).map((c) => c.data as Data<K>);
    },
    result(f: TileFacts): TileResult {
      const o = bg.outcomes.get(f.videoId) ?? 'keep';
      if (typeof o === 'object' && 'undecided' in o) return { videoId: f.videoId, status: 'undecided', reason: o.undecided };
      const base = { videoId: f.videoId, rulesVersion: bg.state.rulesVersion, at: 1 };
      const verdict: Verdict =
        o === 'keep'
          ? { ...base, outcome: 'keep', source: 'model', probability: 0.1 }
          : { ...base, outcome: 'remove', ruleId: o.ruleId, ruleRef: o.ref ?? RULES[o.ruleId]?.ref, source: o.source ?? 'exact', probability: o.p, nativeAction: 'notInterested' };
      return { videoId: f.videoId, status: 'decided', verdict };
    },
    send: vi.fn(async (type: keyof ProtocolMap, data: unknown) => {
      bg.calls.push({ type, data });
      if (bg.drop > 0) {
        bg.drop -= 1;
        throw new Error(DROPPED);
      }
      switch (type) {
        case 'reportActionResult':
          return bg.escalated ? { ...bg.state, escalated: bg.escalated } : bg.state;
        case 'getRuntimeState':
        case 'reportMarkupCheck':
        case 'resumeFromBreaker':
          return bg.state;
        case 'judgeTiles': {
          const req = data as Data<'judgeTiles'>;
          const reply = {
            results: req.items.map((f) => bg.result(f)),
            rulesVersion: bg.state.rulesVersion,
            settingsGeneration: bg.state.settingsGeneration,
            runtime: bg.state,
            rules: RULES,
            private: bg.private,
          };
          if (!bg.hold) return reply;
          return new Promise((resolve) => bg.held.push(() => resolve(reply)));
        }
        case 'keepChannel': {
          const req = data as Data<'keepChannel'>;
          if (bg.banned && req.liftBan === undefined) return { ruleId: '', bannedRuleId: 'b1' };
          return bg.banned ? { ruleId: 'k1', bannedRuleId: 'b1' } : { ruleId: 'k1' };
        }
        case 'banChannel':
          return bg.banned ? { ruleId: 'b1', added: false } : { ruleId: 'u1', added: true };
        default:
          return undefined;
      }
    }) as unknown as Send & ReturnType<typeof vi.fn>,
  };
  return bg;
}

export type FakeBackground = ReturnType<typeof fakeBackground>;

export const grid = () => visiblePage(document)?.querySelector('ytd-rich-grid-renderer > #contents') as Element;
/** Every Tile element on the visible page showing this video (Home grid and Shorts shelves). */
export function tilesOf(videoId: string): Element[] {
  const page = visiblePage(document) as Element;
  const out: Element[] = [];
  for (const id of ['home', 'shortsShelf'] as const) {
    for (const c of SURFACES[id].containers(page)) {
      for (const t of SURFACES[id].tiles(c)) {
        if (t.querySelector(`.content-id-${videoId}`) || t.querySelector(`a[href^="/shorts/${videoId}"]`)) out.push(t);
      }
    }
  }
  return out;
}

/** Wire every Tile on the visible page to the simulated menu. */
export function wireAll(sim: ReturnType<typeof simulateYouTube>, opts: Partial<WireOptions> = {}): void {
  const page = visiblePage(document) as Element;
  for (const c of SURFACES.home.containers(page)) for (const t of SURFACES.home.tiles(c)) sim.wire(t, 'home', { menuHtml: FIXTURES.homeMenu, ...opts });
  for (const c of SURFACES.shortsShelf.containers(page))
    for (const t of SURFACES.shortsShelf.tiles(c)) sim.wire(t, 'shortsShelf', { menuHtml: FIXTURES.shortsMenu, ...opts });
}

export interface Env {
  bg: FakeBackground;
  ui: PageUi;
  p: Pipeline;
  sim: ReturnType<typeof simulateYouTube>;
  io: ReturnType<typeof fakeIntersection>;
  frames: ReturnType<typeof manualScheduler>;
  /** Mutation records arrive as microtasks, then the watcher's frame runs. */
  settle(): Promise<void>;
  /** Report every observed Tile as visible, then wait for the batch and its reply. */
  showAll(): Promise<void>;
  kinds(videoId: string): Array<string | undefined>;
  shadowOf(el: Element): ShadowRoot;
  /** Push a background broadcast: the new state as runtimeStateChanged. */
  broadcast(over: Partial<RuntimeSnapshot>): void;
}

let ids = 0;

/** Home page, fake timers, fake background, pipeline started with `state`. */
export function setupHome(state: Partial<RuntimeSnapshot> = {}, wire: Partial<WireOptions> = {}): Env {
  loadPage(FIXTURES.pageHome, '/');
  const sim = simulateYouTube();
  wireAll(sim, wire);
  const bg = fakeBackground();
  bg.state = snapshot(state);
  const io = fakeIntersection();
  const frames = manualScheduler();
  const ui = createPageUi(document, youtube);
  const p = createPipeline({
    doc: document,
    site: youtube,
    send: bg.send,
    ui,
    watcher: { schedule: frames.schedule, intersection: io.factory },
    newId: () => `id${++ids}`,
  });
  const settle = async () => {
    await microtasks();
    frames.flush();
    await microtasks();
  };
  const env: Env = {
    bg,
    ui,
    p,
    sim,
    io,
    frames,
    settle,
    async showAll() {
      io.trigger(true);
      await vi.advanceTimersByTimeAsync(400);
      await settle();
    },
    kinds: (videoId) => tilesOf(videoId).map((el) => ui.kindOf(el)),
    shadowOf(el) {
      const host = ui.hostOf(el);
      if (!host?.shadowRoot) throw new Error('no Shoo host on this Tile');
      return host.shadowRoot;
    },
    broadcast(over) {
      bg.state = { ...bg.state, ...over };
      p.apply(bg.state);
    },
  };
  p.apply(bg.state);
  return env;
}

export const overlayRoot = () => document.querySelector('shoo-summary-host')?.shadowRoot ?? null;
export const shooHosts = () => document.querySelectorAll('shoo-chip-host, shoo-summary-host, shoo-overlay').length;
