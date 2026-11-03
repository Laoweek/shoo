// NativeActionQueue and Undo. Source of truth: docs/spec/youtube-integration.md Sections 4 and 5.
// The only module that clicks anything on YouTube (architecture.md Section 4, rule 5).
// Never reads, logs or stores YouTube page data such as feedbackToken or undoToken: it only clicks DOM elements.
//
// API for the content pipeline:
//
//   const q = createActionQueue({ doc, precheck, onYouTubeUndo, onDropdownCheck })
//   q.enqueue(job)      → Promise<ActionOutcome>. One job at a time per tab, ≥ 350 ms apart, paused while
//                         document.hidden, waits for focus safety. Outcomes: 'ok' (send reportActionResult),
//                         'failed' with step and selectorVersion (send reportFailure, category 'nativeAction'),
//                         'stale' (precheck failed or page left, not a failure), 'cancelled', and 'duplicate'
//                         (this videoId is already queued, running or removed on this page: annotate the copy instead).
//   q.cancelAll()       drop queued jobs (Mode left Auto). A job that already clicked the menu button finishes.
//   q.navigated()       page changed: queued jobs become 'stale', Undo watches end, per-page state resets.
//                       Undo watches already end on yt-navigate-start and yt-navigate-finish (navigation is never Undo).
//   q.undo(videoId)     Shoo's Undo: 'ok' | 'expired' | 'notFound'.
//   q.canUndo(videoId)  whether YouTube's placeholder (and its Undo) is still there.
//   q.watchRemoval(job) the user removed this Tile with YouTube's own menu (origin 'user'): watch it for YouTube's Undo.
//   q.enqueueTarget(t)  a Native action on something other than a Tile (a Shelf dismissal, built in shelves.ts).
//                       Same queue, spacing, focus safety and scroll guard. No Undo watch and no markup check.
//                       → 'ok' | 'stale' | 'cancelled' | 'failed' with step.
//   q.dispose()         remove listeners and observers.
//
// Callbacks:
//   precheck(job)            async re-validation by the background (Mode, enabled, Keep rules, Exceptions). false → 'stale'.
//   onYouTubeUndo(videoId)   YouTube's own Undo restored a Tile Shoo removed: report undone and ask for an Exception.
//   onDropdownCheck(ok)      markup self-test on the first Native action of a page: did the dropdown open?
//   onFocusLost(tileEl)      focus was inside a Shoo chip that YouTube destroyed with the placeholder swap: move it
//                            (to the removed-Tile annotation or focusReturn(tile)). Without the hook Shoo blurs.
//
// Jobs carry `origin`: 'auto' (default) waits while focus is anywhere in the target Tile or any chip. 'review' (the
// user clicked Remove on a chip) does not wait for focus inside its own Tile or its own chip host (`chipHost`, needed
// only when the chip sits in the page-level overlay outside the Tile).
//
// Shoo never moves the page: no menu opens while the user scrolls, a scroll closes Shoo's open menu and the job tries
// again once the page is quiet, and YouTube's own focus calls around a Native action are kept from scrolling (the
// scroll guard below).
import type { ActionStep, NativeAction, SurfaceId, Verdict } from '~/core/types';
import { isPlayingOrQueued, tileVideoId } from './extract';
import { CHIP_HOST_TAG } from './mount';
import { SURFACES, visiblePage } from './surfaces';

// Built-in localized label fallback. Extend only with observed labels.
export const NOT_INTERESTED_LABELS = ['Not interested', 'No me interesa', 'Pas intéressé', "Ça ne m'intéresse pas", 'Kein Interesse', 'Non mi interessa', 'Não tenho interesse', '興味なし', '관심 없음', '不感兴趣', '不感興趣', 'Не интересует', 'Geen interesse', 'Brak zainteresowania', 'لست مهتمًا'];
// Only the en-GB label is verified. Add others only after observing them.
export const DONT_RECOMMEND_CHANNEL_LABELS = ["Don't recommend channel"];

// Distinguishing substrings of the menu icon paths. The first 40 characters are shared with Watch Later.
export const ICON_SIGNATURES: Readonly<Record<NativeAction, string>> = {
  notInterested: '8.246 12.605L4.755 6.661',
  dontRecommendChannel: 'Zm4 8H8a1 1 0 000 2h8',
};

export const TIMING = {
  gapMs: 350, // minimum time between two jobs
  focusPollMs: 250, // focus safety and hidden-tab re-check
  dropdownMs: 1500,
  dropdownPollMs: 50,
  iconPollMs: 100,
  iconWaitMs: 3000, // then the text fallback
  confirmMs: 2000,
  confirmPollMs: 50,
  escapeSettleMs: 50,
  undoMs: 2000,
  precheckMs: 5000, // a background that never answers makes the job stale instead of stalling the queue
  guardFrames: 10, // animation frames after a job during which YouTube's late focus is still kept from moving the page
  scrollQuietMs: 500, // no menu opens until the user has not scrolled for this long
} as const;

// Keys that scroll the page. Typing in a field never counts.
const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' ']);

export const DROPDOWN_SEL = 'ytd-popup-container tp-yt-iron-dropdown';
export const ITEM_SEL = 'yt-list-item-view-model, ytd-menu-service-item-renderer';
const ITEM_TEXT_SEL = '.ytListItemViewModelTitle, yt-formatted-string';
export const PLACEHOLDER_SEL = '.ytDismissibleItemReplacedContent';
const NAV_EVENTS = ['yt-navigate-start', 'yt-navigate-finish'];
const UNDO_SEL = `${PLACEHOLDER_SEL} .ytNotificationMultiActionRendererButtonContainer button`;
// iframe: focus inside an embedded frame such as the Watch page live chat. Not in the spec's list, same intent.
const TYPING_SEL = 'input, textarea, select, iframe, [contenteditable]:not([contenteditable="false"])';

export interface ActionJob {
  tileEl: Element;
  videoId: string;
  surface: SurfaceId;
  nativeAction: NativeAction;
  verdict?: Verdict;
  origin?: 'auto' | 'review' | 'user'; // 'user': the user's own Don't recommend channel, never queued
  chipHost?: Element;
}

export type ActionOutcome =
  | { status: 'ok'; job: ActionJob }
  | { status: 'stale' | 'cancelled' | 'duplicate'; job: ActionJob }
  | { status: 'failed'; job: ActionJob; step: ActionStep; selectorVersion: string };

export type UndoResult = 'ok' | 'expired' | 'notFound';

/** A Native action on something other than a Tile, such as a Shelf dismissal (shelves.ts). */
export interface TargetJob {
  /** Focus inside it holds the job. Focus YouTube moves into it during the job goes back (scroll guard). */
  scope: Element;
  /** Still there and not acted on yet. Checked together with the page and URL before every attempt. */
  valid(): boolean;
  /** What to click: a menu button (`menu: true`), or the control that acts by itself. */
  control(): { el: HTMLElement; menu: boolean } | null;
  /** The item in the open dropdown. `byText`: the fallback labels, tried once the icons had 3 s to render. */
  item(dropdown: Element, byText: boolean): Element | null;
  /** YouTube confirmed the action. */
  done(): boolean;
  /** Background re-validation right before acting. false → 'stale'. */
  precheck?(): Promise<boolean>;
}

export type TargetOutcome = { status: 'ok' | 'stale' | 'cancelled' } | { status: 'failed'; step: ActionStep };

export interface QueueOptions {
  doc: Document;
  precheck?(job: ActionJob): Promise<boolean>;
  onYouTubeUndo?(videoId: string, job: ActionJob): void;
  onDropdownCheck?(ok: boolean): void;
  onFocusLost?(tileEl: Element): void;
}

export interface NativeActionQueue {
  enqueue(job: ActionJob): Promise<ActionOutcome>;
  enqueueTarget(job: TargetJob): Promise<TargetOutcome>;
  cancelAll(): void;
  navigated(): void;
  undo(videoId: string): Promise<UndoResult>;
  canUndo(videoId: string): boolean;
  watchRemoval(job: ActionJob): void;
  size(): number;
  dispose(): void;
}

/**
 * A YouTube dropdown is open only on positive evidence: aria-hidden is not "true", it is displayed, and it holds menu
 * items. A closed one keeps display:block and its height, so aria-hidden decides. In a hidden tab YouTube toggles
 * aria-hidden off but leaves the dropdown display:none (with the previous items) until a frame renders (live test 2026-10-10).
 */
export const isDropdownOpen = (d: Element): boolean =>
  d.getAttribute('aria-hidden') !== 'true' &&
  (d.ownerDocument.defaultView?.getComputedStyle(d).display ?? (d as HTMLElement).style?.display) !== 'none' &&
  d.querySelector(ITEM_SEL) !== null;

/** How menu labels are compared: curly apostrophes straightened, trimmed, lowercased. */
export const norm = (s: string) => s.replace(/[‘’]/g, "'").trim().toLowerCase();
const LABELS: Record<NativeAction, string[]> = {
  notInterested: NOT_INTERESTED_LABELS.map(norm),
  dontRecommendChannel: DONT_RECOMMEND_CHANNEL_LABELS.map(norm),
};

/** Whether a menu item is `action`'s: by icon path, or with `byText` by the built-in localized labels. */
export function isMenuItem(item: Element, action: NativeAction, byText = false): boolean {
  if (byText) {
    const text = item.querySelector(ITEM_TEXT_SEL)?.textContent;
    return !!text && LABELS[action].includes(norm(text));
  }
  for (const p of item.querySelectorAll('path[d]')) if (p.getAttribute('d')?.includes(ICON_SIGNATURES[action])) return true;
  return false;
}

/**
 * The menu item for `action` in an open dropdown: by icon path, or with `byText` by the built-in localized labels.
 * Never by position. Works for sheet menus (yt-list-item-view-model) and legacy menus (ytd-menu-service-item-renderer).
 */
export function findMenuItem(dropdown: Element, action: NativeAction, byText = false): Element | null {
  for (const item of dropdown.querySelectorAll(ITEM_SEL)) if (!item.closest('[hidden]') && isMenuItem(item, action, byText)) return item;
  return null;
}

/** The first visible menu item whose text is one of `labels`, compared lowercased and trimmed. */
export function findItemByText(dropdown: Element, labels: readonly string[]): Element | null {
  const wanted = labels.map(norm);
  for (const item of dropdown.querySelectorAll(ITEM_SEL)) {
    if (item.closest('[hidden]')) continue;
    const text = item.querySelector(ITEM_TEXT_SEL)?.textContent;
    if (text && wanted.includes(norm(text))) return item;
  }
  return null;
}

/** What the queue acts on: a Tile job's roles, or a TargetJob as given. */
interface Target extends TargetJob {
  /** A Review Remove: focus inside its own Tile or chip host does not hold the job. */
  ownFocus: boolean;
  chipHost?: Element;
  /** Focus at `el` is YouTube's, moved into what Shoo acted on (the placeholder's Undo). */
  stole(el: Element): boolean;
}

type Result = TargetOutcome;

interface Entry {
  t: Target;
  tile?: ActionJob; // Tile jobs only: Undo watch, markup check, duplicates
  page: Element | null;
  href: string; // a watch-to-watch navigation changes the URL but keeps the page element
  pageGen: number;
  resolve(result: Result): void;
  cancelled?: 'cancelled' | 'stale';
  started?: boolean; // the menu button was clicked: the job runs to completion
  wentHidden?: boolean; // the tab was hidden at some point after the menu button was clicked
  step: ActionStep;
}

interface UndoWatch {
  job: ActionJob;
  root: Element;
  mo: MutationObserver;
  shooUndo: boolean;
  /** The page and URL the Removal happened on. A change of either means navigation, never Undo. */
  page: Element | null;
  href: string;
}

type DropdownSig = { first: Element | null; pos: string };

export function createActionQueue(opts: QueueOptions): NativeActionQueue {
  const { doc } = opts;
  const pending: Entry[] = [];
  const acted = new Set<string>(); // videoIds queued, running or removed on this page
  const watches = new Map<string, UndoWatch>();
  let current: Entry | null = null;
  let running = false;
  let lastEnd = -Infinity;
  let ownDropdown: Element | null = null;
  let ownSig: DropdownSig | null = null; // what Shoo's menu looked like when Shoo last handled it
  let pointerDown = false;
  let dropdownChecked = false;
  let pointerDowns = 0;
  let pageGen = 0;

  const now = () => Date.now();
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  // Sleep that also wakes when the tab becomes visible (hidden-tab timers are throttled hard).
  const pause = (ms: number) =>
    new Promise<void>((r) => {
      const done = () => {
        clearTimeout(t);
        doc.removeEventListener('visibilitychange', done);
        r();
      };
      const t = setTimeout(done, ms);
      doc.addEventListener('visibilitychange', done);
    });

  async function waitFor<T>(fn: () => T | null | false, timeoutMs: number, pollMs: number): Promise<T | null> {
    const end = now() + timeoutMs;
    for (;;) {
      const v = fn();
      if (v) return v;
      const left = end - now();
      if (left <= 0) return null;
      await sleep(Math.min(pollMs, left));
    }
  }

  const onDown = () => {
    pointerDown = true;
    pointerDowns += 1;
  };
  const onUp = () => (pointerDown = false);
  // A hidden tab draws no frames: a step that times out after the tab was hidden says nothing about YouTube.
  const onVisibility = () => {
    if (doc.hidden && current?.started) current.wentHidden = true;
  };
  doc.addEventListener('visibilitychange', onVisibility);
  doc.addEventListener('pointerdown', onDown, true);
  doc.addEventListener('pointerup', onUp, true);
  doc.addEventListener('pointercancel', onUp, true);
  doc.defaultView?.addEventListener('blur', onUp);

  // The user scrolling. While a YouTube dropdown is open it holds the page still (wheel blocked, scroll position put
  // back, observed 2026-10-10), so Shoo closes its own menu before the event reaches YouTube, the job tries again,
  // and no menu opens until the page has been quiet for `scrollQuietMs`. Listening on the window in the capture
  // phase runs ahead of YouTube's listeners on the document.
  let lastScroll = -Infinity;
  let scrolls = 0;
  const onScrollIntent = (ev: Event) => {
    if (ev instanceof KeyboardEvent) {
      if (!SCROLL_KEYS.has(ev.key) || ev.altKey || ev.ctrlKey || ev.metaKey) return;
      const path = ev.composedPath();
      if (path[0] instanceof Element && path[0].matches(TYPING_SEL)) return;
      if (path.some((n) => n instanceof Element && n.localName.startsWith('shoo-'))) return; // Space on a chip's Remove
    }
    // A press counts only for middle-button autoscroll or on the root element (its scrollbar) [unverified live].
    if (ev.type === 'pointerdown' && (ev as MouseEvent).button !== 1 && ev.composedPath()[0] !== doc.documentElement) return;
    lastScroll = now();
    scrolls += 1;
    escapeOwn();
  };
  const SCROLL_INTENTS = ['wheel', 'touchstart', 'touchmove', 'keydown', 'pointerdown'] as const;
  for (const t of SCROLL_INTENTS) doc.defaultView?.addEventListener(t, onScrollIntent, { capture: true, passive: true });

  // The dropdown element is reused, so "Shoo's dropdown" means: the element Shoo opened, still open, still showing
  // the same items at the same position. Once it closes, any reopening belongs to the user.
  function isOwnOpen(d: Element | null): d is Element {
    if (!d || d !== ownDropdown || !ownSig) return false;
    if (!isDropdownOpen(d)) {
      ownDropdown = ownSig = null;
      return false;
    }
    const cur = sig(d);
    return cur.first === ownSig.first && cur.pos === ownSig.pos;
  }

  function userMenuOpen(): boolean {
    for (const d of doc.querySelectorAll(DROPDOWN_SEL)) if (isDropdownOpen(d) && !isOwnOpen(d)) return true;
    return false;
  }

  // Focus safety (Section 4): never take a menu or focus away from the user.
  function focusBlocked(t: Target): boolean {
    if (pointerDown || userMenuOpen()) return true;
    const a = doc.activeElement;
    if (!a || a === doc.body) return false;
    if (a.matches(TYPING_SEL)) return true;
    if (t.ownFocus && (t.scope.contains(a) || (t.chipHost?.contains(a) ?? false))) return false;
    return t.scope.contains(a) || a.closest(CHIP_HOST_TAG) !== null;
  }

  function deepActive(el: Element | null): Element | null {
    let cur = el;
    while (cur?.shadowRoot?.activeElement) cur = cur.shadowRoot.activeElement;
    return cur;
  }

  function backgroundPrecheck(check: () => Promise<boolean>): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), TIMING.precheckMs);
      check().then(
        (ok) => {
          clearTimeout(t);
          resolve(ok === true);
        },
        () => {
          clearTimeout(t);
          resolve(false);
        },
      );
    });
  }

  function tileValid({ tileEl, surface, videoId }: ActionJob): boolean {
    if (!tileEl.isConnected || tileVideoId(tileEl, surface) !== videoId) return false;
    // A Tile in a hidden subtree (a dismissed Shelf keeps its Shorts) has no menu YouTube would open.
    if (tileEl.closest('[hidden]')) return false;
    if (isPlayingOrQueued(tileEl, videoId, doc)) return false; // REQ-SURF-3, checked right before the menu opens
    const root = SURFACES[surface].actionRoot(tileEl);
    return !!root && !root.querySelector(PLACEHOLDER_SEL);
  }

  function tileTarget(job: ActionJob): Target {
    const def = SURFACES[job.surface];
    const { precheck } = opts;
    return {
      scope: job.tileEl,
      ownFocus: job.origin === 'review',
      chipHost: job.chipHost,
      valid: () => tileValid(job),
      control: () => {
        const el = def.menuButton(job.tileEl);
        return el && { el, menu: true };
      },
      item: (dropdown, byText) => findMenuItem(dropdown, job.nativeAction, byText),
      done: () => def.actionRoot(job.tileEl)?.querySelector(PLACEHOLDER_SEL) != null,
      precheck: precheck && (() => precheck(job)),
      stole: (el) => el.closest(PLACEHOLDER_SEL) !== null && job.tileEl.contains(el),
    };
  }

  const localPrecheck = (e: Entry): boolean => e.t.valid() && visiblePage(doc) === e.page && doc.location.href === e.href;

  function sig(d: Element): DropdownSig {
    const s = (d as HTMLElement).style;
    return { first: d.querySelector(ITEM_SEL), pos: `${s?.top}|${s?.left}` };
  }

  // The dropdown is one reused element: require that its items or position changed since before the click,
  // so Shoo never acts on the previous Tile's menu. YouTube keeps the item elements and re-renders them in place
  // (observed 2026-10-10), and the menu of a Tile outside the viewport is clamped to the viewport edge, so two
  // consecutive menus can share both. A dropdown that was closed at the click and re-rendered inside since
  // (`rerendered`) opened for this click too.
  function openedSince(before: Map<Element, DropdownSig>, rerendered: Set<Element>): Element | null {
    for (const d of doc.querySelectorAll(DROPDOWN_SEL)) {
      if (!isDropdownOpen(d)) continue;
      const prev = before.get(d);
      if (!prev || rerendered.has(d)) return d;
      const cur = sig(d);
      if (cur.first && (cur.first !== prev.first || cur.pos !== prev.pos)) return d;
    }
    return null;
  }

  // Escape only on the dropdown Shoo opened, as a keydown on the focused element inside it.
  function escapeOwn(): void {
    const d = ownDropdown;
    if (!isOwnOpen(d)) return;
    const a = doc.activeElement;
    const target = a && d.contains(a) ? a : d;
    selfKey = true; // not the user's key press
    try {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true, composed: true }));
    } finally {
      selfKey = false;
    }
  }

  // Restore focus, unless the user has since opened a menu or started typing: then focus is theirs. A chip host
  // that YouTube destroyed with the placeholder swap hands focus to the pipeline (onFocusLost).
  function restoreFocus(saved: Element | null, savedInChip: boolean, tileEl?: Element): void {
    if (userMenuOpen() || doc.activeElement?.matches(TYPING_SEL)) return;
    if (saved && saved !== doc.body && saved.isConnected && typeof (saved as HTMLElement).focus === 'function') {
      selfFocus = true; // Shoo's own focus call scrolls nothing: the guard leaves it alone
      try {
        (saved as HTMLElement).focus({ preventScroll: true });
        look(); // the same in a window without system focus, where no focusin fires
      } finally {
        selfFocus = false;
      }
      return;
    }
    (doc.activeElement as HTMLElement | null)?.blur?.();
    if (savedInChip && tileEl) opts.onFocusLost?.(tileEl);
  }

  // Scroll guard. YouTube calls focus() without preventScroll around a Native action (measured in Chrome, 2026-10-10):
  // the dropdown gives focus back on close to the element focused when the menu opened, and the "Video removed"
  // placeholder focuses its first button one animation frame after it renders. Chrome (and Firefox, on a test page)
  // scroll that element into view before the focus events fire, so a Tile or element outside the viewport moved the
  // page. From the menu button click until `guardFrames` frames after the job, a focus change that moved the page is
  // undone after the call that made it, before the frame paints. The page goes back to the last position the
  // document's scroll events reported: a focus scroll fires its scroll event only in the next frame, so the user's
  // own scrolling always wins. That is also where the page stays without the focus call (measured with content
  // growing above the viewport in the same frame).
  // Only those two focus targets count: the element focused when Shoo opened a menu, and a placeholder in a Tile Shoo
  // acted on, which also gives focus back to the element that had it before. Focus the user moves (a pointer or key
  // press in the same task) and Shoo's own focus calls are left alone.
  // In a visible window without system focus Chrome still scrolls and moves focus, but fires no focus events
  // (measured live, 2026-10-10). The guard then finds each focus move by comparing the focused element with the one it
  // last saw (`look`): after every frame's animation frame callbacks, where YouTube's focus calls run, through a
  // ResizeObserver re-armed each frame, so the page goes back before that frame paints; on the document's scroll
  // event, before its position counts (a focus call from a task); and right before Shoo moves focus at the end of a
  // job. By a frame's end the scroll events have reported all of the user's scrolling (measured), so there the page
  // always goes back. Elsewhere it goes back only when the user has not scrolled since the last scroll event or frame
  // end.
  const win = doc.defaultView;
  let guarding = false;
  let guardGen = 0;
  let known = { x: 0, y: 0 };
  let knownScrolls = 0; // `scrolls` when `known` was last up to date: at a scroll event or a frame's end
  let back: Element | null = null;
  let seen: Element | null = null; // the focused element the guard last judged
  let userTask = false;
  let selfFocus = false;
  let selfKey = false;
  let frames: ResizeObserver | null = null;
  let frameLoop = 0;
  const openers = new Set<Element>();
  const targets = new Set<Target>(); // what the guarded jobs act on

  const readScroll = () => {
    if (win) known = { x: win.scrollX, y: win.scrollY };
    knownScrolls = scrolls;
  };
  const onScroll = () => {
    look();
    readScroll();
  };
  const onUserInput = () => {
    if (selfKey) return;
    userTask = true;
    setTimeout(() => (userTask = false), 0);
  };
  // From focusin the focus call that scrolled is still running: the page goes back in a microtask. A move found
  // without a focus event is over: the page goes back at once, at a frame's end always, elsewhere ('found') unless
  // the user scrolled meanwhile.
  function judge(el: Element, how: 'focusin' | 'frameEnd' | 'found'): void {
    seen = el;
    if (userTask || selfFocus) {
      back = el;
      return;
    }
    const inPlaceholder = el.closest(PLACEHOLDER_SEL) !== null;
    const stolen = [...targets].some((t) => t.stole(el));
    if (!inPlaceholder && !stolen && !el.closest(DROPDOWN_SEL)) back = el;
    if (!stolen && !openers.has(el)) return;
    const at = known;
    const putBack = (scroll: boolean) => {
      if (!guarding || !win) return;
      if (scroll && (win.scrollX !== at.x || win.scrollY !== at.y)) win.scrollTo({ left: at.x, top: at.y, behavior: 'instant' });
      if (stolen && doc.activeElement === el) restoreFocus(back, false, el);
    };
    if (how === 'focusin') queueMicrotask(() => putBack(true));
    else putBack(how === 'frameEnd' || scrolls === knownScrolls);
  }
  const onFocusIn = (ev: FocusEvent) => {
    const el = ev.composedPath()[0];
    if (el instanceof Element) judge(el, 'focusin');
  };
  function look(how: 'frameEnd' | 'found' = 'found'): void {
    if (!guarding) return;
    const el = deepActive(doc.activeElement);
    if (el === seen) return;
    seen = el;
    if (el && el !== doc.body) judge(el, how);
  }
  // A ResizeObserver notification comes after the frame's animation frame callbacks and before it paints.
  function watchFrames(): void {
    const RO = win?.ResizeObserver;
    if (!RO) return;
    const ro = (frames ??= new RO(() => {
      look('frameEnd');
      knownScrolls = scrolls; // a scroll intent that moved nothing (a panel, the page end) no longer counts
    }));
    const loop = ++frameLoop;
    const tick = () => {
      if (loop !== frameLoop || !guarding) return;
      ro.unobserve(doc.documentElement);
      ro.observe(doc.documentElement);
      win?.requestAnimationFrame(tick);
    };
    tick();
  }

  function armGuard(t: Target): void {
    guardGen += 1; // a countdown from the previous job stops
    back = deepActive(doc.activeElement);
    if (back && back !== doc.body) openers.add(back);
    targets.add(t);
    if (guarding || !win) return;
    guarding = true;
    seen = back;
    readScroll();
    doc.addEventListener('scroll', onScroll, { passive: true });
    doc.addEventListener('focusin', onFocusIn, true);
    doc.addEventListener('pointerdown', onUserInput, true);
    doc.addEventListener('keydown', onUserInput, true);
    watchFrames();
  }

  // A hidden tab draws no frames, so the guard outlasts it: YouTube's placeholder focus waits for a frame too.
  function releaseGuard(): void {
    const gen = guardGen;
    let left = TIMING.guardFrames;
    const frame = (cb: () => void) => (win?.requestAnimationFrame ? win.requestAnimationFrame(cb) : setTimeout(cb, 16));
    const tick = () => {
      if (gen !== guardGen) return;
      if (--left > 0) frame(tick);
      else endGuard();
    };
    frame(tick);
  }

  function endGuard(): void {
    openers.clear();
    targets.clear();
    if (!guarding) return;
    guarding = false;
    guardGen += 1;
    frames?.disconnect();
    doc.removeEventListener('scroll', onScroll);
    doc.removeEventListener('focusin', onFocusIn, true);
    doc.removeEventListener('pointerdown', onUserInput, true);
    doc.removeEventListener('keydown', onUserInput, true);
  }

  async function perform(e: Entry): Promise<Result | 'again'> {
    const { t, tile } = e;
    // Spacing, visibility, focus safety and prechecks. Cancellable until the menu button is clicked.
    const blocked = () => doc.hidden || focusBlocked(t) || now() - lastScroll < TIMING.scrollQuietMs;
    for (;;) {
      const gap = lastEnd + TIMING.gapMs - now();
      if (gap > 0) await sleep(gap);
      while (!e.cancelled && blocked()) await pause(TIMING.focusPollMs);
      if (e.cancelled) return { status: e.cancelled };
      if (!localPrecheck(e)) return { status: 'stale' };
      if (t.precheck && !(await backgroundPrecheck(t.precheck))) return { status: 'stale' };
      if (e.cancelled) return { status: e.cancelled };
      if (!localPrecheck(e)) return { status: 'stale' }; // the Tile may have changed during the round trip
      if (blocked()) continue; // the user acted while the precheck ran: wait again

      // Step 2: clear Shoo's own leftover dropdown. Never a dropdown the user opened.
      if (!isOwnOpen(ownDropdown)) break;
      escapeOwn();
      await sleep(TIMING.escapeSettleMs);
      // Shoo turned off, the Mode changed, YouTube reused the element or the user acted during the settle.
      if (e.cancelled) return { status: e.cancelled };
      if (!localPrecheck(e)) return { status: 'stale' };
      if (!blocked()) break;
    }
    ownDropdown = ownSig = null;

    const outer = doc.activeElement;
    const savedInChip = outer?.closest(CHIP_HOST_TAG) != null; // focus inside a shadow root reports the host
    const saved = deepActive(outer); // the host itself is not focusable: keep the element inside it
    const restore = () => {
      look(); // a focus move YouTube made without focus events, before Shoo's own move hides it
      restoreFocus(saved, savedInChip, tile?.tileEl);
    };
    // A step that timed out after the tab was hidden at any point since the menu button was clicked is dropped as
    // stale, not failed: switching tabs never counts toward the nativeAction breaker. The pipeline re-queues it.
    const fail = (step: ActionStep): Result => {
      escapeOwn();
      restore();
      if (e.started && (e.wentHidden || doc.hidden)) return { status: 'stale' };
      return { status: 'failed', step };
    };

    // Step 3: open the menu, or click a control that acts by itself. Synthetic clicks are accepted by YouTube.
    const control = t.control();
    if (!control) return fail('openMenu');
    if (!control.menu) {
      e.started = true;
      e.wentHidden = doc.hidden;
      e.step = 'clickItem';
      armGuard(t);
      control.el.click();
      return confirm(e, fail, restore);
    }
    const button = control.el;
    const before = new Map<Element, DropdownSig>();
    const closed: Element[] = [];
    const rerendered = new Set<Element>();
    const watchers: MutationObserver[] = [];
    for (const d of doc.querySelectorAll(DROPDOWN_SEL)) {
      before.set(d, sig(d));
      if (isDropdownOpen(d)) continue;
      closed.push(d);
      // Attributes change on any opening (aria-hidden, style, focus state), also one that still shows the previous
      // items: only content added, removed or rewritten counts as a re-render.
      const mo = new MutationObserver(() => rerendered.add(d));
      mo.observe(d, { subtree: true, childList: true, characterData: true });
      watchers.push(mo);
    }
    e.started = true;
    e.wentHidden = doc.hidden;
    const downsAtClick = pointerDowns;
    const scrollsAtClick = scrolls;
    armGuard(t);
    button.click();

    // Step 4: the dropdown opens (and changed), up to 1.5 s.
    const dropdown = await waitFor(() => openedSince(before, rerendered), TIMING.dropdownMs, TIMING.dropdownPollMs);
    for (const mo of watchers) mo.disconnect();
    // A hidden tab draws no frames, so a dropdown that did not open there says nothing about YouTube's markup.
    // Only Tile menus count: a Shelf's controls are unverified and must never trip the markup breaker.
    if (tile && !dropdownChecked && (dropdown !== null || !(e.wentHidden || doc.hidden))) {
      dropdownChecked = true;
      opts.onDropdownCheck?.(dropdown !== null);
    }
    if (!dropdown) {
      // A menu Shoo's click opened but could not tell from the previous one is closed, never left open holding
      // focus and the page still. A pointer press since the click may have opened it for the user instead.
      const opened = closed.find((d) => isDropdownOpen(d));
      if (opened && pointerDowns === downsAtClick) {
        ownDropdown = opened;
        ownSig = sig(opened);
      }
      return fail('openMenu');
    }
    ownDropdown = dropdown;
    ownSig = sig(dropdown);
    // The user scrolled since the click: the page is theirs. Close Shoo's menu (if the scroll listener has not yet),
    // give focus back and try again once the page is quiet, nothing clicked. Cancellable again meanwhile.
    const scrolled = () => scrolls !== scrollsAtClick;
    const yieldToUser = (): 'again' => {
      escapeOwn();
      restore();
      ownDropdown = ownSig = null;
      e.started = false;
      e.step = 'openMenu';
      lastEnd = now();
      releaseGuard();
      return 'again';
    };
    if (scrolled()) return yieldToUser();

    // Steps 5 and 6: icon path, polling while icons render lazily, then the localized label fallback.
    // The menu stops being Shoo's when it closes, moves (the user opened another Tile's menu in the same element)
    // or the user pressed the pointer: then the job is dropped as stale and nothing is clicked.
    e.step = 'findItem';
    const openPos = ownSig.pos;
    const stillOurs = () => isDropdownOpen(dropdown) && sig(dropdown).pos === openPos && pointerDowns === downsAtClick;
    let lost = false;
    const poll = () => {
      if (scrolled() || !stillOurs()) return (lost = true);
      ownSig = sig(dropdown); // items may still be rendering
      return t.item(dropdown, false);
    };
    const found = await waitFor(poll, TIMING.iconWaitMs, TIMING.iconPollMs);
    if (scrolled()) return yieldToUser();
    if (lost || !stillOurs()) {
      ownDropdown = ownSig = null;
      return { status: 'stale' };
    }
    const item = found instanceof Element ? found : t.item(dropdown, true);
    if (!item) return fail('findItem');

    // Step 7: click the menu item (button in sheet menus, tp-yt-paper-item in legacy menus).
    e.step = 'clickItem';
    const target = item.querySelector<HTMLElement>('[role="menuitem"]') ?? (item.matches('[role="menuitem"]') ? (item as HTMLElement) : null);
    if (!target) return fail('clickItem');
    target.click();
    return confirm(e, fail, restore);
  }

  // Step 8: YouTube confirms, for a Tile by swapping the actionRoot's children for its placeholder, up to 2 s.
  async function confirm(e: Entry, fail: (step: ActionStep) => Result, restore: () => void): Promise<Result> {
    e.step = 'confirmPlaceholder';
    const placed = await waitFor(() => e.t.done(), TIMING.confirmMs, TIMING.confirmPollMs);
    if (!placed) return fail('confirmPlaceholder');
    const root = e.tile && SURFACES[e.tile.surface].actionRoot(e.tile.tileEl);
    if (e.tile && root && e.pageGen === pageGen) watchUndo(e.tile, root); // no Undo watch survives into a new page
    restore();
    return { status: 'ok' };
  }

  async function pump(): Promise<void> {
    if (running) return;
    running = true;
    while (pending.length > 0) {
      const e = pending.shift() as Entry;
      current = e;
      let outcome: Result;
      try {
        let attempt: Result | 'again';
        do attempt = await perform(e);
        while (attempt === 'again'); // the user scrolled while Shoo's menu was open
        outcome = attempt;
      } catch {
        outcome = { status: 'failed', step: e.step };
      }
      if (e.started) {
        lastEnd = now();
        releaseGuard();
      }
      isOwnOpen(ownDropdown); // drops ownership once Shoo's menu has closed, so a reopening counts as the user's
      current = null;
      if (outcome.status !== 'ok' && e.tile) acted.delete(e.tile.videoId);
      e.resolve(outcome);
    }
    running = false;
  }

  // Keep the actionRoot observer until navigation. The placeholder disappearing without Shoo's Undo means the
  // user clicked YouTube's own Undo. A different video in the element afterwards means reuse, not Undo.
  // Navigation is not Undo: YouTube restores or clears the placeholders of the page being left before the watcher
  // rebinds (live test 2026-10-10), so watches end on yt-navigate-start, and a change on a page that is no longer the
  // visible one, or after the URL changed, ends the watch without a report.
  function watchUndo(job: ActionJob, root: Element): void {
    const old = watches.get(job.videoId);
    if (old) stopWatch(old);
    const w: UndoWatch = { job, root, shooUndo: false, mo: new MutationObserver(() => checkWatch(w)), page: visiblePage(doc), href: doc.location.href };
    w.mo.observe(root, { childList: true });
    watches.set(job.videoId, w);
  }

  const samePage = (w: UndoWatch) =>
    w.root.isConnected && w.page !== null && visiblePage(doc) === w.page && w.page.contains(w.root) && doc.location.href === w.href;

  function checkWatch(w: UndoWatch): void {
    if (!samePage(w)) return stopWatch(w);
    if (w.root.querySelector(PLACEHOLDER_SEL) || !w.root.firstElementChild) return; // still removed, or content not back yet
    stopWatch(w);
    if (tileVideoId(w.job.tileEl, w.job.surface) !== w.job.videoId) return;
    acted.delete(w.job.videoId);
    if (!w.shooUndo) opts.onYouTubeUndo?.(w.job.videoId, w.job);
  }

  // The page is being left: no Undo watch survives, and a job finishing now registers none.
  const disarm = () => {
    pageGen += 1;
    for (const w of [...watches.values()]) stopWatch(w);
    endGuard();
  };
  for (const t of NAV_EVENTS) doc.addEventListener(t, disarm);

  function stopWatch(w: UndoWatch): void {
    w.mo.disconnect();
    if (watches.get(w.job.videoId) === w) watches.delete(w.job.videoId);
  }

  function cancel(status: 'cancelled' | 'stale'): void {
    for (const e of pending.splice(0)) {
      if (e.tile) acted.delete(e.tile.videoId);
      e.resolve({ status });
    }
    if (current && !current.started) current.cancelled = status;
  }

  function push(t: Target, tile: ActionJob | undefined, resolve: (r: Result) => void): void {
    pending.push({ t, tile, page: visiblePage(doc), href: doc.location.href, pageGen, resolve, step: 'openMenu' });
    void pump();
  }

  const undoButton = (w: UndoWatch) => (w.root.isConnected ? w.root.querySelector<HTMLElement>(UNDO_SEL) : null);

  return {
    enqueue(input) {
      const job: ActionJob =
        input.surface === 'shortsShelf' && input.nativeAction === 'dontRecommendChannel' ? { ...input, nativeAction: 'notInterested' } : input;
      if (acted.has(job.videoId)) return Promise.resolve({ status: 'duplicate', job });
      acted.add(job.videoId);
      const { selectorVersion } = SURFACES[job.surface];
      return new Promise<ActionOutcome>((resolve) =>
        push(tileTarget(job), job, (r) => resolve(r.status === 'failed' ? { ...r, job, selectorVersion } : { status: r.status, job })),
      );
    },
    enqueueTarget(job) {
      return new Promise<TargetOutcome>((resolve) => push({ ...job, ownFocus: false, stole: (el) => job.scope.contains(el) }, undefined, resolve));
    },
    cancelAll: () => cancel('cancelled'),
    navigated() {
      pageGen += 1;
      cancel('stale');
      for (const w of [...watches.values()]) stopWatch(w);
      acted.clear();
      dropdownChecked = false;
      endGuard();
    },
    async undo(videoId) {
      const w = watches.get(videoId);
      if (!w) return 'notFound';
      const button = undoButton(w);
      if (!button) {
        stopWatch(w);
        return 'expired';
      }
      w.shooUndo = true;
      button.click(); // the first button is Undo in both placeholder variants (language-independent)
      const restored = await waitFor(() => !w.root.querySelector(PLACEHOLDER_SEL) && w.root.firstElementChild !== null, TIMING.undoMs, 50);
      if (!restored) {
        w.shooUndo = false; // a late restore is then reported as YouTube's Undo
        return 'expired';
      }
      stopWatch(w);
      acted.delete(videoId);
      return 'ok';
    },
    canUndo(videoId) {
      const w = watches.get(videoId);
      return !!w && undoButton(w) !== null;
    },
    watchRemoval(job) {
      const root = SURFACES[job.surface].actionRoot(job.tileEl);
      if (root?.querySelector(PLACEHOLDER_SEL)) watchUndo(job, root);
    },
    size: () => pending.length + (current ? 1 : 0),
    dispose() {
      cancel('cancelled');
      endGuard();
      for (const w of [...watches.values()]) stopWatch(w);
      for (const t of NAV_EVENTS) doc.removeEventListener(t, disarm);
      doc.removeEventListener('visibilitychange', onVisibility);
      doc.removeEventListener('pointerdown', onDown, true);
      doc.removeEventListener('pointerup', onUp, true);
      doc.removeEventListener('pointercancel', onUp, true);
      doc.defaultView?.removeEventListener('blur', onUp);
      for (const t of SCROLL_INTENTS) doc.defaultView?.removeEventListener(t, onScrollIntent, true);
    },
  };
}
