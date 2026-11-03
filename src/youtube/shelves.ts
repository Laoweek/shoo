// Shelf dismissal. Source of truth: docs/spec/youtube-integration.md Section 10 (REQ-ACT-6).
// Finds the Shelves on Home and their own dismiss control, and hands each Shelf the user switched on to the
// NativeActionQueue once per page. Only actions.ts clicks.
//
// Only the Shorts shelf's header menu and its "Show fewer Shorts" item are captured. Its dismissed state and the
// whole games shelf are [unverified] in the spec. A Shelf whose control is not found is left alone: nothing is
// clicked and nothing is reported.
import type { ShelfId } from '~/core/types';
import { NOT_INTERESTED_LABELS, findItemByText, findMenuItem, norm, type TargetJob } from './actions';
import { visiblePage } from './surfaces';

/** Each Shelf's dismiss label, compared like menu labels. "Show fewer Shorts" is captured, "Show fewer games" [unverified]. */
export const SHELF_LABELS: Readonly<Record<ShelfId, readonly string[]>> = {
  shorts: ['Show fewer Shorts'],
  games: ['Show fewer games'],
};
/** The games shelf's heading, for when no Tile in it links to /playables. [unverified] */
export const GAMES_TITLES: readonly string[] = ['YouTube Playables', 'Playables'];

/** A Shelf's heading and Tiles render after the Shelf is added: look again this often, this many times. */
export const SHELF_RESCAN_MS = 1000;
const RESCANS = 5;
/** After a navigation, wait this often and this many times for the Home grid (10 s). */
const GRID_WAIT_MS = 500;
const GRID_TRIES = 20;

const GRID_SEL = 'ytd-rich-grid-renderer > #contents';
const SHELF_SEL = `${GRID_SEL} > ytd-rich-section-renderer ytd-rich-shelf-renderer`;
const TILE_SEL = 'ytd-rich-item-renderer';
const SECTION_SEL = 'ytd-rich-section-renderer';
const MENU_SEL = 'ytd-menu-renderer button, #menu button, button[aria-haspopup]';
const DISMISSED_SEL = '.ytDismissibleItemReplacedContent, notification-multi-action-renderer, ytd-notification-multi-action-renderer';

export function shelfKind(shelf: Element): ShelfId | null {
  if (shelf.hasAttribute('is-shorts')) return 'shorts';
  if (shelf.querySelector('a[href^="/playables"]')) return 'games';
  const title = norm(shelf.querySelector('#title')?.textContent ?? '');
  return GAMES_TITLES.some((t) => norm(t) === title) ? 'games' : null;
}

/** Buttons of the Shelf itself: none inside its Tiles. */
function shelfButtons(shelf: Element): HTMLElement[] {
  return [...shelf.querySelectorAll<HTMLElement>('button, [role="button"]')].filter((b) => {
    const inner = b.closest(`#contents, ${TILE_SEL}`);
    return !inner || !shelf.contains(inner);
  });
}

const labelOf = (b: Element) => norm(b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '');

/** The Shelf's own dismiss control: a button labelled with the dismissal, else the Shelf's menu button. */
export function shelfControl(shelf: Element, id: ShelfId): { el: HTMLElement; menu: boolean } | null {
  const buttons = shelfButtons(shelf);
  const labels = [...SHELF_LABELS[id], ...NOT_INTERESTED_LABELS].map(norm);
  const direct = buttons.find((b) => labels.includes(labelOf(b)));
  if (direct) return { el: direct, menu: false };
  const menu = buttons.find((b) => b.matches(MENU_SEL));
  return menu ? { el: menu, menu: true } : null;
}

/** Gone, replaced by YouTube's notice, folded away, or holding no Tile. */
export function isShelfDismissed(shelf: Element): boolean {
  if (!shelf.isConnected) return true;
  // A removed Short carries the same placeholder class inside its own Tile, so only markers outside Tiles count.
  const markers = (shelf.closest(SECTION_SEL) ?? shelf).querySelectorAll(DISMISSED_SEL);
  if ([...markers].some((m) => !m.closest(TILE_SEL))) return true;
  return shelf.querySelector('#dismissible')?.hasAttribute('hidden') === true || !shelf.querySelector(TILE_SEL);
}

/**
 * The queue job for one Shelf. In its menu the Shelf's own label matches at once, the Not interested icon while
 * icons render, and the Not interested labels after that.
 */
export function shelfTarget(shelf: Element, id: ShelfId, precheck?: () => Promise<boolean>): TargetJob {
  return {
    scope: shelf.closest(SECTION_SEL) ?? shelf,
    valid: () => !isShelfDismissed(shelf) && shelfControl(shelf, id) !== null,
    control: () => shelfControl(shelf, id),
    item: (dropdown, byText) =>
      byText ? findMenuItem(dropdown, 'notInterested', true) : (findItemByText(dropdown, SHELF_LABELS[id]) ?? findMenuItem(dropdown, 'notInterested')),
    done: () => isShelfDismissed(shelf),
    precheck,
  };
}

export interface ShelfWatcher {
  setEnabled(on: Partial<Record<ShelfId, boolean>>): void;
  stop(): void;
}

/**
 * Offers each switched-on Shelf on Home to `onShelf` once per page, once its Tiles and dismiss control show.
 * `onShelf` resolves false when the attempt did not count (stale or cancelled): the Shelf is offered again later.
 * One childList observer on the Home grid, plus a few rescans after each change, because a Shelf's content renders
 * after the Shelf is added.
 */
export function createShelfWatcher(doc: Document, onShelf: (shelf: Element, id: ShelfId) => Promise<boolean>): ShelfWatcher {
  let on: Partial<Record<ShelfId, boolean>> = {};
  let handled = new Set<ShelfId>();
  let gen = 0;
  let mo: MutationObserver | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const homePage = () => {
    const page = visiblePage(doc);
    return doc.location.pathname === '/' && page?.matches('ytd-browse[page-subtype="home"]') ? page : null;
  };

  function scan(): void {
    const page = homePage();
    if (!page) return;
    for (const el of page.querySelectorAll(SHELF_SEL)) {
      const id = shelfKind(el);
      if (!id || !on[id] || handled.has(id) || isShelfDismissed(el) || !shelfControl(el, id)) continue;
      handled.add(id);
      const g = gen;
      void onShelf(el, id).then((counted) => {
        if (counted || g !== gen) return;
        handled.delete(id);
        rescan();
      });
    }
  }

  function rescan(): void {
    clearTimeout(timer);
    let left = RESCANS;
    const tick = () => {
      scan();
      if (--left > 0) timer = setTimeout(tick, SHELF_RESCAN_MS);
    };
    timer = setTimeout(tick, SHELF_RESCAN_MS);
  }

  // YouTube fires both navigation events for one navigation: only a new page or URL starts the page over.
  let boundPage: Element | null = null;
  let boundHref = '';
  function bind(tries = GRID_TRIES): void {
    const page = visiblePage(doc);
    if (page !== boundPage || doc.location.href !== boundHref) {
      boundPage = page;
      boundHref = doc.location.href;
      gen += 1;
      handled = new Set();
    }
    mo?.disconnect();
    mo = null;
    clearTimeout(timer);
    const grid = homePage()?.querySelector(GRID_SEL);
    if (!grid) {
      if (homePage() && tries > 0) timer = setTimeout(() => bind(tries - 1), GRID_WAIT_MS);
      return;
    }
    mo = new MutationObserver(() => {
      scan();
      rescan();
    });
    mo.observe(grid, { childList: true });
    scan();
    rescan();
  }

  const onNavigate = () => bind();
  const NAV = ['yt-navigate-finish', 'yt-page-data-updated'];
  for (const t of NAV) doc.addEventListener(t, onNavigate);
  bind();

  return {
    setEnabled(next) {
      on = next;
      scan();
    },
    stop() {
      gen += 1;
      for (const t of NAV) doc.removeEventListener(t, onNavigate);
      mo?.disconnect();
      clearTimeout(timer);
    },
  };
}
