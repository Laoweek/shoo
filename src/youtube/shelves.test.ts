// @vitest-environment jsdom
// Shelf dismissal: finding Shelves and handing each switched-on one to the queue once per page
// (youtube-integration.md Section 10). Header controls are SYNTHETIC: no fixture shows them yet.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShelfId } from '~/core/types';
import { createActionQueue, type NativeActionQueue } from './actions';
import { SHELF_RESCAN_MS, createShelfWatcher, isShelfDismissed, shelfControl, shelfKind, shelfTarget, type ShelfWatcher } from './shelves';
import { visiblePage } from './surfaces';
import {
  FIXTURES,
  addSyntheticGamesShelf,
  addSyntheticShelfControl,
  loadPage,
  simulateYouTube,
  useCapturedShortsShelf,
  wireShelf,
  type YouTubeSim,
} from './test-harness';

let sim: YouTubeSim;
let q: NativeActionQueue | undefined;
let w: ShelfWatcher | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  loadPage(FIXTURES.pageHome, '/');
  sim = simulateYouTube();
});
afterEach(() => {
  w?.stop();
  q?.dispose();
  w = q = undefined;
  vi.useRealTimers();
  document.body.innerHTML = '';
});

const grid = () => visiblePage(document)?.querySelector('ytd-rich-grid-renderer > #contents') as Element;
const shortsShelf = () => grid().querySelector('ytd-rich-shelf-renderer[is-shorts]') as Element;

function watch(on: Partial<Record<ShelfId, boolean>>) {
  const offered: Array<[Element, ShelfId]> = [];
  w = createShelfWatcher(document, async (el, id) => {
    offered.push([el, id]);
    return true;
  });
  w.setEnabled(on);
  return offered;
}

describe('Shelves', () => {
  it('tells the Shorts shelf (captured) from a games shelf (synthetic)', () => {
    expect(shelfKind(shortsShelf())).toBe('shorts');
    expect(shelfKind(addSyntheticGamesShelf(grid()))).toBe('games');
  });

  it('still offers the Shorts shelf after one of its Shorts was removed', async () => {
    addSyntheticShelfControl(shortsShelf(), 'menu');
    const root = shortsShelf().querySelector('ytm-shorts-lockup-view-model-v2') as Element;
    root.innerHTML = FIXTURES.shortsPlaceholder;
    const offered = watch({ shorts: true });
    await vi.advanceTimersByTimeAsync(SHELF_RESCAN_MS * 6);
    expect(offered.map(([, id]) => id)).toEqual(['shorts']);
  });

  it('leaves a Shelf without a dismiss control alone, as on the captured Home page', async () => {
    const offered = watch({ shorts: true, games: true });
    await vi.advanceTimersByTimeAsync(SHELF_RESCAN_MS * 6);
    expect(offered).toEqual([]);
  });

  it('offers each switched-on Shelf once per page, and again after a navigation', async () => {
    addSyntheticShelfControl(shortsShelf(), 'menu');
    const games = addSyntheticGamesShelf(grid());
    addSyntheticShelfControl(games, 'menu');
    const offered = watch({ shorts: true });
    await vi.advanceTimersByTimeAsync(SHELF_RESCAN_MS * 6);
    expect(offered.map(([, id]) => id)).toEqual(['shorts']);
    // YouTube fires both events for one navigation: on the same page and URL they change nothing.
    document.dispatchEvent(new Event('yt-page-data-updated'));
    document.dispatchEvent(new Event('yt-navigate-finish'));
    await vi.advanceTimersByTimeAsync(SHELF_RESCAN_MS * 6);
    expect(offered.map(([, id]) => id)).toEqual(['shorts']);
    history.replaceState(null, '', '/?nav=1');
    document.dispatchEvent(new Event('yt-navigate-finish'));
    await vi.advanceTimersByTimeAsync(0);
    expect(offered.map(([, id]) => id)).toEqual(['shorts', 'shorts']);
  });
});

describe('Shelf dismissal through the NativeActionQueue', () => {
  it('captured Shorts shelf: opens the header menu and picks "Show fewer Shorts" from the captured menu', async () => {
    const shelf = useCapturedShortsShelf(shortsShelf());
    const control = shelfControl(shelf, 'shorts');
    expect(control?.menu).toBe(true);
    expect(control?.el.getAttribute('aria-label')).toBe('Shorts – More actions');
    wireShelf(sim, shelf, control!.el, 'Show fewer Shorts', document, FIXTURES.homeShortsShelfMenu);
    q = createActionQueue({ doc: document });
    const out = q.enqueueTarget(shelfTarget(shelf, 'shorts'));
    await vi.advanceTimersByTimeAsync(500);
    expect(await out).toEqual({ status: 'ok' });
    expect(sim.log).toEqual(['open@shelf', 'open@user', 'click:Show fewer Shorts', 'shelfDismissed']);
  });

  it("menu: picks the Shelf's own label, confirms the dismissal and never runs the markup check", async () => {
    const shelf = shortsShelf();
    wireShelf(sim, shelf, addSyntheticShelfControl(shelf, 'menu'), 'Show fewer Shorts');
    const onDropdownCheck = vi.fn();
    q = createActionQueue({ doc: document, onDropdownCheck });
    const out = q.enqueueTarget(shelfTarget(shelf, 'shorts'));
    await vi.advanceTimersByTimeAsync(500);
    expect(await out).toEqual({ status: 'ok' });
    expect(sim.log).toEqual(['open@shelf', 'open@user', 'click:Show fewer Shorts', 'shelfDismissed']);
    expect(isShelfDismissed(shelf)).toBe(true);
    expect(onDropdownCheck).not.toHaveBeenCalled();
  });

  it('direct control: clicks the button labelled with the dismissal', async () => {
    const shelf = addSyntheticGamesShelf(grid());
    wireShelf(sim, shelf, addSyntheticShelfControl(shelf, { label: 'Show fewer games' }));
    q = createActionQueue({ doc: document });
    const out = q.enqueueTarget(shelfTarget(shelf, 'games'));
    await vi.advanceTimersByTimeAsync(500);
    expect(await out).toEqual({ status: 'ok' });
    expect(sim.log).toEqual(['open@shelf', 'shelfDismissed']);
  });

  it('a menu without the item fails at findItem, closes the menu and leaves the Shelf as it was', async () => {
    const shelf = shortsShelf();
    wireShelf(sim, shelf, addSyntheticShelfControl(shelf, 'menu'), 'Report');
    const onDropdownCheck = vi.fn();
    q = createActionQueue({ doc: document, onDropdownCheck });
    const out = q.enqueueTarget(shelfTarget(shelf, 'shorts'));
    await vi.advanceTimersByTimeAsync(4000);
    expect(await out).toEqual({ status: 'failed', step: 'findItem' });
    expect(sim.log.at(-1)).toBe('escape');
    expect(isShelfDismissed(shelf)).toBe(false);
    expect(onDropdownCheck).not.toHaveBeenCalled();
  });
});
