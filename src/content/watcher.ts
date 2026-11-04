// Tile watcher, the same on every Site. Source of truth: docs/spec/youtube-integration.md Sections 2, 3 and 7,
// docs/spec/architecture.md Section 5 (decoration state, duplicate Tiles). The Site supplies where Tiles are and
// how to read them (src/sites/site.ts).
//
// API for the content pipeline:
//
//   const w = createWatcher({ doc, site, enabledSurfaces, onTiles, onElementReset, onMarkupCheck, onMarkupWarning, onNavigate })
//   w.start()                       attach navigation listeners and bind the visible page
//   w.stop()                        disconnect every observer, listener and timer (Shoo off)
//   w.setEnabledSurfaces(record)    Settings changed: rebind with the new set
//   w.rescan({ all })               re-send 'pending' Tiles (or with `all` every Tile except 'acting', 'removed' and
//                                   'annotated'): eligible ones at once, the others when they next come into view
//   w.decor(el) / w.setDecor(el, s) per-element decoration state (judging is keyed by videoId elsewhere)
//   w.elementsFor(videoId)          every connected element on this page showing that video (duplicate copies)
//   w.surfaceOf(el)                 the Surface an element was found on
//   w.recheck(el)                   the site re-rendered the element's content: re-read its video ID next frame
//   w.observers()                   observer counts, for tests and the REQ-QUAL-2 budget check
//
// Callbacks:
//   onTiles(batch)                  newly eligible Tiles (in or within one viewport of the screen), already extracted.
//                                   Each sent element gets decor state 'pending'.
//   onElementReset(el, oldVideoId)  the site reused the element for another video: unmount Shoo's UI for it.
//                                   The decor entry is already dropped; the element is treated as a new Tile.
//                                   The site's removed-Tile placeholder (no video ID readable) is not a reset.
//   onMarkupCheck(result)           markup self-test, once per bind, within 5 s (reportMarkupCheck payload).
//   onMarkupWarning(field, surface) a Tile had no videoId or title (skipped silently).
//   onNavigate()                    the visible page or URL changed: cancel queued Native actions (they are stale).
//   onDecoratedSeen(els)            Tiles with a chip or label that a scan, navigation or rescan came across again.
//                                   The site may have destroyed their UI meanwhile (re-render, Back): mount it again.
//
// Observers: one childList MutationObserver per active container (no subtree), one IntersectionObserver for
// eligibility, one shared attribute observer for decorated Tiles (the Surface's reuse targets, Section 3), one
// page-switcher observer as a navigation backup while started (YouTube's page manager), and a temporary subtree
// observer on the visible page while waiting (at most 10 s of visible time) for a container. None of the Tile
// observers exist when no enabled and supported Surface matches the page. Mutation records are coalesced per
// animation frame.
//
// Badge wait: a Tile whose channel row holds a badge icon that has not rendered (the Surface's badgePending) is not sent at
// once. A 100 ms timer reads it again (no observer) and sends it once the icon renders, or after 1.5 s of visible
// time without the Artist channel flag. Navigation, leaving the eligible area or the page, another video, and stop()
// end its wait. Only first sends wait: a re-send reads the Tile as it is.
import type { SurfaceId, TileFacts } from '~/core/types';
import { activeSurfaces, surfaceOf as siteSurface, type MarkupWarning, type Site, type SurfaceDef } from '~/sites/site';

export type DecorState = 'pending' | 'chip' | 'label' | 'acting' | 'removed' | 'annotated' | 'none';
export interface Decor {
  videoId: string;
  state: DecorState;
}
export interface TileItem {
  el: Element;
  surface: SurfaceId;
  facts: TileFacts;
}
export interface MarkupCheck {
  ok: boolean;
  selectorVersion: string;
  missing: string[];
}

export interface IntersectionLike {
  observe(el: Element): void;
  unobserve(el: Element): void;
  disconnect(): void;
}
export type IntersectionFactory = (
  cb: (entries: ReadonlyArray<{ target: Element; isIntersecting: boolean }>) => void,
  init: IntersectionObserverInit,
) => IntersectionLike;

export interface WatcherOptions {
  doc: Document;
  site: Site;
  enabledSurfaces: Partial<Record<SurfaceId, boolean>>;
  onTiles(batch: TileItem[]): void;
  onElementReset?(el: Element, previousVideoId: string): void;
  onMarkupCheck?(result: MarkupCheck): void;
  onMarkupWarning?: MarkupWarning;
  onNavigate?(): void;
  onDecoratedSeen?(els: Element[]): void;
  /** Frame scheduler. Default requestAnimationFrame. Tests pass a manual flush. */
  schedule?: (cb: () => void) => void;
  /** IntersectionObserver factory. Default the platform one. jsdom has none, so tests inject a fake. */
  intersection?: IntersectionFactory;
}

export interface Watcher {
  start(): void;
  stop(): void;
  setEnabledSurfaces(enabled: Partial<Record<SurfaceId, boolean>>): void;
  rescan(opts?: { all?: boolean }): void;
  decor(el: Element): Decor | undefined;
  setDecor(el: Element, state: DecorState): void;
  elementsFor(videoId: string): Element[];
  surfaceOf(el: Element): SurfaceId | undefined;
  recheck(el: Element): void;
  observers(): { containers: number; intersection: number; attributes: number; pageManager: number; waiting: number };
}

export const INTERSECTION_INIT: IntersectionObserverInit = { rootMargin: '100% 0px', threshold: 0 };
export const CONTAINER_WAIT_MS = 10_000;
export const SELF_TEST_MS = 5_000;
// Channel-row badge icons may render late, like menu icons (Section 4): re-read at the menu icon poll cadence.
export const BADGE_POLL_MS = 100;
export const BADGE_WAIT_MS = 1_500; // of visible time, then the Tile is sent without the Artist channel flag

const NOT_RESENT: ReadonlySet<DecorState> = new Set(['acting', 'removed', 'annotated']);
const SHOWING: ReadonlySet<DecorState> = new Set(['chip', 'label']);

export function createWatcher(opts: WatcherOptions): Watcher {
  const { doc, site } = opts;
  const schedule = opts.schedule ?? ((cb: () => void) => void requestAnimationFrame(() => cb()));
  const makeIO: IntersectionFactory =
    opts.intersection ?? ((cb, init) => new IntersectionObserver((entries) => cb(entries), init));
  let enabled = { ...opts.enabledSurfaces };

  // Decoration persists with the element across navigations (chips on a hidden page stay mounted).
  const decor = new WeakMap<Element, Decor>();
  // Re-send generations: rescan() bumps them, a Tile sent in an older generation is re-sent when next eligible.
  const sentGen = new WeakMap<Element, number>();
  let gen = 0;
  let pendingGen = 0; // last rescan: re-send 'pending' Tiles
  let allGen = 0; // last rescan({ all }): re-send every Tile not in NOT_RESENT

  // Per-bind state, reset on every navigation.
  let started = false;
  let currentPage: Element | null = null;
  let currentHref = '';
  let active: SurfaceDef[] = [];
  let containers = new Map<Element, { def: SurfaceDef | null; mo: MutationObserver }>(); // def null: structure only
  let io: IntersectionLike | null = null;
  let attrMo: MutationObserver | null = null;
  let attrTile = new WeakMap<Element, Element>(); // observed attribute target -> its Tile
  let surfaceOf = new WeakMap<Element, SurfaceDef>();
  let indexed = new WeakMap<Element, string>();
  let byVideo = new Map<string, Set<Element>>();
  let skipped = new WeakMap<Element, string | null>(); // extract() returned null for this videoId
  let badgeWait = new Map<Element, { def: SurfaceDef; videoId: string; polls: number }>(); // not sent yet
  let badgeTimer: ReturnType<typeof setTimeout> | undefined;
  let observed = new Set<Element>();
  let eligible = new Set<Element>();
  let added = new Set<Node>();
  let removed = new Set<Node>();
  let dirty = new Set<Element>();
  let recheck = new Set<Element>();
  let seen = new Set<Element>(); // decorated Tiles with a chip or label met in this scan
  let frameScheduled = false;
  let rebindScheduled = false;
  let waiter: MutationObserver | null = null;
  let waitTimer: ReturnType<typeof setTimeout> | undefined;
  let waitCheck: ReturnType<typeof setTimeout> | undefined;
  let waitVisible: (() => void) | null = null;
  let selfTestDefs: SurfaceDef[] | null = null;
  let selfTestTimer: ReturnType<typeof setTimeout> | undefined;
  let pageMo: MutationObserver | null = null;

  const onNavEvent = () => scheduleRebind();
  // Hidden tabs: rAF does not run and timers are throttled. Deferred self-tests resume when the tab is visible.
  const onVisible = () => {
    if (doc.hidden || !selfTestDefs) return;
    doc.removeEventListener('visibilitychange', onVisible);
    armSelfTest();
  };

  function scheduleRebind(): void {
    if (rebindScheduled) return;
    rebindScheduled = true;
    schedule(() => {
      rebindScheduled = false;
      if (started) bind();
    });
  }

  function bind(): void {
    const page = site.visiblePage(doc);
    const href = doc.location.href;
    const navigated = currentHref !== '' && (page !== currentPage || href !== currentHref);
    teardownPage();
    currentPage = page;
    currentHref = href;
    if (navigated) opts.onNavigate?.();
    active = page ? activeSurfaces(site, doc.location, doc, enabled) : [];
    if (!page || active.length === 0) return;
    io = makeIO(onIntersect, INTERSECTION_INIT);
    attrMo = new MutationObserver(onAttributes);
    resolveContainers();
    if (containers.size === 0) waitForContainer(page);
    selfTestDefs = active.filter((d) => !d.optional);
    if (selfTestDefs.length > 0) {
      armSelfTest();
      selfTest(false);
    }
  }

  function teardownPage(): void {
    for (const { mo } of containers.values()) mo.disconnect();
    containers = new Map();
    io?.disconnect();
    io = null;
    attrMo?.disconnect();
    attrMo = null;
    attrTile = new WeakMap();
    stopWaiting();
    clearTimeout(selfTestTimer);
    doc.removeEventListener('visibilitychange', onVisible);
    selfTestDefs = null;
    active = [];
    surfaceOf = new WeakMap();
    indexed = new WeakMap();
    byVideo = new Map();
    skipped = new WeakMap();
    badgeWait = new Map();
    clearTimeout(badgeTimer);
    badgeTimer = undefined;
    observed = new Set();
    eligible = new Set();
    added = new Set();
    removed = new Set();
    dirty = new Set();
    recheck = new Set();
    seen = new Set();
  }

  // Attach observers to containers that appeared since the last call and drop disconnected ones.
  function resolveContainers(): void {
    const page = currentPage;
    if (!page) return;
    for (const [c, rec] of containers) {
      if (!c.isConnected) {
        rec.mo.disconnect();
        containers.delete(c);
      }
    }
    const fresh: Element[] = [];
    const attach = (c: Element, def: SurfaceDef | null) => {
      if (containers.has(c)) return;
      const mo = new MutationObserver((records) => {
        for (const r of records) {
          r.addedNodes.forEach((n) => added.add(n));
          r.removedNodes.forEach((n) => removed.add(n));
        }
        dirty.add(c);
        scheduleFrame();
      });
      mo.observe(c, { childList: true });
      containers.set(c, { def, mo });
      fresh.push(c);
    };
    for (const def of active) for (const c of def.containers(page)) attach(c, def);
    // Nested Surfaces (Shorts shelves) arrive as new sections of their host's containers: watch the host's structure
    // even when the host Surface is off.
    for (const def of active) {
      if (!def.nestedIn || active.some((d) => d.id === def.nestedIn)) continue;
      for (const c of siteSurface(site, def.nestedIn).containers(page)) attach(c, null);
    }
    const batch: TileItem[] = [];
    for (const c of fresh) scanContainer(c, batch);
    flush(batch);
  }

  const hasNested = () => active.some((d) => d.nestedIn !== undefined);

  function scanContainer(c: Element, batch: TileItem[], addedNow?: Set<Node>): boolean {
    const def = containers.get(c)?.def;
    let structural = false;
    if (def) {
      const tiles = def.tiles(c);
      for (const t of tiles) consider(t, def, batch);
      if (addedNow) {
        const tileSet = new Set(tiles);
        for (const n of c.children) if (addedNow.has(n) && !tileSet.has(n)) structural = true;
      }
    } else if (addedNow) {
      structural = true;
    }
    return structural;
  }

  function scheduleFrame(): void {
    if (frameScheduled) return;
    frameScheduled = true;
    schedule(frame);
  }

  function frame(): void {
    frameScheduled = false;
    if (!started || !io) return;
    const addedNow = added;
    const removedNow = removed;
    const dirtyNow = dirty;
    const recheckNow = recheck;
    added = new Set();
    removed = new Set();
    dirty = new Set();
    recheck = new Set();
    // A removed node can be a Tile or a section holding Tiles (a nested Surface): forget every disconnected Tile.
    for (const n of removedNow) {
      if (n instanceof Element && !n.isConnected) {
        for (const el of observed) if (!el.isConnected) forget(el);
        break;
      }
    }
    const batch: TileItem[] = [];
    let structural = false;
    for (const c of dirtyNow) if (containers.has(c) && scanContainer(c, batch, addedNow)) structural = true;
    for (const el of recheckNow) {
      const def = surfaceOf.get(el);
      if (def && el.isConnected) consider(el, def, batch);
    }
    flush(batch);
    if (structural) resolveContainers();
    selfTest(false);
  }

  // Reuse check, index, eligibility. Emits the Tile when it is eligible and not yet sent (or due a re-send).
  function consider(el: Element, def: SurfaceDef, batch: TileItem[]): void {
    const videoId = def.videoId(el);
    const d = decor.get(el);
    surfaceOf.set(el, def);
    // No readable video ID on a decorated Tile: the site's removed-Tile placeholder, or content mid-render.
    // Keep its decoration and index entry. Reuse means a different video ID.
    if (d && videoId === null) return;
    if (d && d.videoId !== videoId) {
      decor.delete(el);
      skipped.delete(el);
      opts.onElementReset?.(el, d.videoId);
    }
    const old = indexed.get(el);
    if (old !== (videoId ?? undefined)) {
      if (old !== undefined) byVideo.get(old)?.delete(el);
      if (videoId) {
        indexed.set(el, videoId);
        let set = byVideo.get(videoId);
        if (!set) byVideo.set(videoId, (set = new Set()));
        set.add(el);
      } else indexed.delete(el);
    }
    if (!observed.has(el)) {
      observed.add(el);
      io?.observe(el);
    } else if (eligible.has(el)) {
      const cur = decor.get(el);
      if (!cur) emit(el, def, videoId, batch, false);
      else if (dueResend(el, cur)) emit(el, def, cur.videoId, batch, true);
    }
    if (decor.has(el)) watchAttributes(el, def);
    const shown = decor.get(el);
    if (shown && SHOWING.has(shown.state)) seen.add(el);
  }

  function dueResend(el: Element, d: Decor): boolean {
    const sent = sentGen.get(el) ?? 0;
    return (d.state === 'pending' && sent < pendingGen) || (!NOT_RESENT.has(d.state) && sent < allGen);
  }

  function emit(el: Element, def: SurfaceDef, videoId: string | null, batch: TileItem[], resend: boolean): void {
    const d = decor.get(el);
    if (d && !resend) return;
    if (!d && skipped.has(el) && skipped.get(el) === videoId) return;
    const facts = def.extract(el, doc, opts.onMarkupWarning);
    if (!facts) {
      skipped.set(el, videoId);
      badgeWait.delete(el);
      return;
    }
    if (!d && waitForBadge(el, def, facts)) return;
    if (!d) decor.set(el, { videoId: facts.videoId, state: 'pending' });
    sentGen.set(el, gen);
    batch.push({ el, surface: def.id, facts });
  }

  // Section 2, badge wait: hold a first send while the channel row holds a badge icon that has not rendered, since it
  // may be the Artist channel badge. Returns false (send now) once the icon rendered or the wait ran out.
  function waitForBadge(el: Element, def: SurfaceDef, facts: TileFacts): boolean {
    const w = badgeWait.get(el);
    const due = w?.videoId === facts.videoId && w.polls * BADGE_POLL_MS >= BADGE_WAIT_MS;
    if (facts.isArtistChannel || due || !(def.badgePending?.(el) ?? false)) {
      badgeWait.delete(el);
      return false;
    }
    if (w?.videoId !== facts.videoId) badgeWait.set(el, { def, videoId: facts.videoId, polls: 0 });
    badgeTimer ??= setTimeout(pollBadges, BADGE_POLL_MS);
    return true;
  }

  // A timer at the menu icon poll cadence (Section 4), no observer. Only visible polls count toward the wait: a hidden
  // tab draws no frames, so its icons may not render there. Hidden polls still send a Tile whose icon rendered.
  function pollBadges(): void {
    badgeTimer = undefined;
    const batch: TileItem[] = [];
    for (const [el, w] of [...badgeWait]) {
      if (decor.has(el) || !eligible.has(el) || !el.isConnected) {
        badgeWait.delete(el);
        continue;
      }
      const videoId = w.def.videoId(el);
      if (videoId !== null && videoId !== w.videoId) badgeWait.delete(el); // another video starts its own wait
      else if (!doc.hidden) w.polls += 1;
      // No readable video ID: content mid-render. Read it again at the next poll, until the wait runs out.
      if (videoId === null && w.polls * BADGE_POLL_MS < BADGE_WAIT_MS) continue;
      consider(el, w.def, batch); // sends now, or waits for the next poll
    }
    if (badgeWait.size > 0) badgeTimer ??= setTimeout(pollBadges, BADGE_POLL_MS);
    flush(batch);
  }

  // Section 3: re-check the video ID when the site rewrites what identifies the Tile's video (its reuse targets).
  function watchAttributes(el: Element, def: SurfaceDef): void {
    if (!attrMo) return;
    for (const { el: t, attributes } of def.reuseTargets(el)) {
      if (!t || attrTile.get(t) === el) continue;
      attrTile.set(t, el);
      attrMo.observe(t, { attributes: true, attributeFilter: attributes });
    }
  }

  function onAttributes(records: MutationRecord[]): void {
    for (const r of records) {
      const el = attrTile.get(r.target as Element);
      if (el) recheck.add(el);
    }
    if (recheck.size > 0) scheduleFrame();
  }

  function onIntersect(entries: ReadonlyArray<{ target: Element; isIntersecting: boolean }>): void {
    if (!started) return;
    // A nested section's inner container can render after the section was added: look again on scroll.
    if (hasNested()) resolveContainers();
    const batch: TileItem[] = [];
    for (const e of entries) {
      const el = e.target;
      if (!e.isIntersecting) {
        eligible.delete(el);
        badgeWait.delete(el);
        continue;
      }
      const def = surfaceOf.get(el);
      if (!def || !el.isConnected) continue;
      if (!eligible.has(el)) skipped.delete(el); // entering view again: retry a Tile skipped while it rendered
      eligible.add(el);
      consider(el, def, batch);
    }
    flush(batch);
  }

  function forget(el: Element): void {
    if (!observed.delete(el)) return;
    io?.unobserve(el);
    eligible.delete(el);
    badgeWait.delete(el);
    const v = indexed.get(el);
    if (v !== undefined) byVideo.get(v)?.delete(el);
    indexed.delete(el);
  }

  function flush(batch: TileItem[]): void {
    if (batch.length > 0) opts.onTiles(batch);
    if (seen.size === 0) return;
    const els = [...seen];
    seen = new Set();
    opts.onDecoratedSeen?.(els);
  }

  // No container yet: watch the visible page (subtree) until one appears. Checks are coalesced on a timer, not rAF,
  // so they also run in hidden tabs. Give up after 10 s of visible time and wait for the next navigation.
  function waitForContainer(page: Element): void {
    waiter = new MutationObserver(() => {
      if (waitCheck !== undefined) return;
      waitCheck = setTimeout(() => {
        waitCheck = undefined;
        if (!waiter) return;
        resolveContainers();
        if (containers.size > 0) {
          stopWaiting();
          selfTest(false);
          if (selfTestDefs) armSelfTest(); // the final check skipped while waiting runs 5 s from now
        }
      }, 50);
    });
    waiter.observe(page, { childList: true, subtree: true });
    // The wait counts visible time only: becoming visible restarts it. Giving up runs the final markup self-test,
    // so a missing container is reported only after 10 s on a visible page (in a live test, a background tab drew
    // the Watch sidebar about 10 s late).
    const giveUp = () => {
      if (doc.hidden) waitTimer = setTimeout(giveUp, CONTAINER_WAIT_MS);
      else {
        stopWaiting();
        selfTest(true);
      }
    };
    waitVisible = () => {
      if (doc.hidden) return;
      clearTimeout(waitTimer);
      waitTimer = setTimeout(giveUp, CONTAINER_WAIT_MS);
    };
    doc.addEventListener('visibilitychange', waitVisible);
    waitTimer = setTimeout(giveUp, CONTAINER_WAIT_MS);
  }

  function stopWaiting(): void {
    waiter?.disconnect();
    waiter = null;
    if (waitVisible) doc.removeEventListener('visibilitychange', waitVisible);
    waitVisible = null;
    clearTimeout(waitTimer);
    clearTimeout(waitCheck);
    waitCheck = undefined;
  }

  function armSelfTest(): void {
    clearTimeout(selfTestTimer);
    selfTestTimer = setTimeout(() => selfTest(true), SELF_TEST_MS);
  }

  // Markup self-test: each active Surface has a container and a Tile with a videoId and a title. Containers are
  // resolved from the DOM again here, so a late container counts even if no observer picked it up yet. A failing
  // final check in a hidden tab is not reported: the test re-arms when the tab becomes visible. While the watcher
  // still waits for a container, the final check belongs to the end of that wait (10 s of visible time).
  function selfTest(final: boolean): void {
    if (!selfTestDefs || !currentPage) return;
    if (final && waiter) return;
    const missing: string[] = [];
    for (const def of selfTestDefs) {
      const cs = def.containers(currentPage);
      if (cs.length === 0) missing.push(`${def.id}.container`);
      else if (!cs.some((c) => def.tiles(c).some((t) => def.videoId(t) && def.title(t)))) missing.push(`${def.id}.tile`);
    }
    if (missing.length > 0 && !final) return;
    if (missing.length > 0 && doc.hidden) {
      doc.addEventListener('visibilitychange', onVisible);
      return;
    }
    selfTestDefs = null;
    clearTimeout(selfTestTimer);
    opts.onMarkupCheck?.({ ok: missing.length === 0, selectorVersion: site.selectorVersion, missing });
  }

  // Navigation backup: page-switcher children added or their `hidden` attribute toggled. No subtree.
  function observePageManager(): void {
    const pm = site.pageSwitcher?.(doc);
    if (!pm) return;
    const watchChild = (el: Element) => pageMo?.observe(el, { attributes: true, attributeFilter: ['hidden'] });
    pageMo = new MutationObserver((records) => {
      for (const r of records) r.addedNodes.forEach((n) => n instanceof Element && watchChild(n));
      if (site.visiblePage(doc) !== currentPage) scheduleRebind();
    });
    pageMo.observe(pm, { childList: true });
    for (const child of pm.children) watchChild(child);
  }

  return {
    start() {
      if (started) return;
      started = true;
      for (const t of site.navigatedEvents) doc.addEventListener(t, onNavEvent);
      observePageManager();
      bind();
    },
    stop() {
      if (!started) return;
      started = false;
      for (const t of site.navigatedEvents) doc.removeEventListener(t, onNavEvent);
      pageMo?.disconnect();
      pageMo = null;
      teardownPage();
      currentPage = null;
      currentHref = '';
    },
    setEnabledSurfaces(next) {
      enabled = { ...next };
      if (started) bind();
    },
    rescan({ all = false } = {}) {
      if (!started) return;
      gen += 1;
      pendingGen = gen;
      if (all) allGen = gen;
      skipped = new WeakMap();
      const batch: TileItem[] = [];
      for (const el of eligible) {
        const def = surfaceOf.get(el);
        if (!def || !el.isConnected) forget(el);
        else consider(el, def, batch);
      }
      flush(batch);
    },
    decor: (el) => decor.get(el),
    setDecor(el, state) {
      const d = decor.get(el);
      if (d) d.state = state;
      else {
        const def = surfaceOf.get(el);
        const videoId = def?.videoId(el);
        if (videoId) decor.set(el, { videoId, state });
      }
    },
    elementsFor(videoId) {
      return [...(byVideo.get(videoId) ?? [])].filter((el) => el.isConnected);
    },
    surfaceOf: (el) => surfaceOf.get(el)?.id,
    recheck(el) {
      if (!started || !surfaceOf.has(el)) return;
      recheck.add(el);
      scheduleFrame();
    },
    observers: () => ({
      containers: containers.size,
      intersection: io ? 1 : 0,
      attributes: attrMo ? 1 : 0,
      pageManager: pageMo ? 1 : 0,
      waiting: waiter ? 1 : 0,
    }),
  };
}
