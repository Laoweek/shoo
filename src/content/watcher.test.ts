// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SurfaceId } from '~/core/types';
import { isTileFacts } from '~/entrypoints/background/guards';
import { youtube } from '~/sites/youtube';
import { visiblePage } from '~/sites/youtube/surfaces';
import { FIXTURES, appendContinuation, fakeIntersection, loadPage, manualScheduler, microtasks, parse } from '~/sites/youtube/test-harness';
import { BADGE_POLL_MS, BADGE_WAIT_MS, CONTAINER_WAIT_MS, INTERSECTION_INIT, SELF_TEST_MS, createWatcher, type MarkupCheck, type TileItem, type WatcherOptions } from './watcher';

const ALL: Record<SurfaceId, boolean> = { home: true, watchSidebar: true, shortsShelf: true, search: true, channel: true, endScreen: true, bilibiliHome: true, bilibiliVideoSidebar: true };

function setup(over: Partial<WatcherOptions> = {}) {
  const io = fakeIntersection();
  const frames = manualScheduler();
  const batches: TileItem[][] = [];
  const resets: Array<[Element, string]> = [];
  const checks: MarkupCheck[] = [];
  const onNavigate = vi.fn();
  const w = createWatcher({
    doc: document,
    site: youtube,
    enabledSurfaces: ALL,
    onTiles: (b) => batches.push(b),
    onElementReset: (el, old) => resets.push([el, old]),
    onMarkupCheck: (r) => checks.push(r),
    onNavigate,
    schedule: frames.schedule,
    intersection: io.factory,
    ...over,
  });
  const sent = () => batches.flat().map((b) => `${b.surface}:${b.facts.videoId}`);
  // Mutation records arrive as microtasks, then the frame runs.
  const settle = async () => {
    await microtasks();
    frames.flush();
  };
  return { w, io, frames, batches, resets, checks, onNavigate, sent, settle };
}

const grid = () => visiblePage(document)?.querySelector('ytd-rich-grid-renderer > #contents') as Element;
const sidebar = () => visiblePage(document)?.querySelector('ytd-item-section-renderer > #contents') as Element;
const homeTileOf = (id: string) => [...grid().children].find((c) => c.querySelector(`.content-id-${id}`)) as Element;

let stops: Array<() => void> = [];
beforeEach(() => {
  stops = [];
});
afterEach(() => {
  for (const s of stops) s();
  vi.useRealTimers();
  document.body.innerHTML = '';
  history.replaceState(null, '', '/');
});

function started(over: Partial<WatcherOptions> = {}) {
  const t = setup(over);
  t.w.start();
  stops.push(() => t.w.stop());
  return t;
}

describe('watcher on the composed Home page', () => {
  beforeEach(() => loadPage(FIXTURES.pageHome, '/'));

  it('observes one container per active Surface and sends only eligible Tiles from the visible page', () => {
    const t = started();
    expect(t.w.observers()).toEqual({ containers: 2, intersection: 1, attributes: 1, pageManager: 1, waiting: 0 }); // grid + one Shorts shelf
    expect(t.io.inits()).toEqual([INTERSECTION_INIT]);
    expect(t.batches).toEqual([]); // nothing is sent before it is near the viewport

    t.io.trigger(true);
    expect(t.sent().sort()).toEqual(
      [
        'home:FIXTURE0001',
        'home:FIXTURE0001', // a second copy of the same video
        'home:FIXTURE0002',
        'home:FIXTURE0004', // live
        'home:FIXTURE0006',
        'home:FIXTURE0007',
        'home:FIXTURE0008',
        'home:FIXTURE0009',
        'home:FIXTURE0010',
        'shortsShelf:FIXTURE0002',
        'shortsShelf:FIXTURE0101',
        'shortsShelf:FIXTURE0102',
        'shortsShelf:FIXTURE0103',
      ].sort(),
    );
    // Ad (0003), radio Mix start (0005) and every decoy on a hidden page stay out.
    expect(t.sent().join()).not.toMatch(/FIXTURE0003|FIXTURE0005|DECOY/);
    const observed = t.io.observed();
    expect(observed.some((el) => el.closest('[hidden]'))).toBe(false);
  });

  it('cuts an oversize title and channel name and drops an oversize handle or channel ID, so the batch still goes', () => {
    const long = (n: number) => 'x'.repeat(n);
    const surfaces = Object.fromEntries(
      Object.entries(youtube.surfaces).map(([id, def]) => [
        id,
        def && {
          ...def,
          extract: (el: Element, doc: Document) => {
            const facts = def.extract(el, doc);
            return facts && { ...facts, title: long(5000), channelName: long(500), channelHandle: `@${long(200)}`, channelId: `UC${long(200)}` };
          },
        },
      ]),
    );
    const t = started({ site: { ...youtube, surfaces } });
    t.io.trigger(true);
    const facts = t.batches.flat()[0]!.facts;
    expect(facts.title).toHaveLength(1000);
    expect(facts.channelName).toHaveLength(120);
    expect(facts).not.toHaveProperty('channelHandle');
    expect(facts).not.toHaveProperty('channelId');
  });

  it('cuts a 2,000-character title and a 500-character channel name without splitting a pair into a Tile the background accepts', () => {
    const surfaces = Object.fromEntries(
      Object.entries(youtube.surfaces).map(([id, def]) => [
        id,
        def && {
          ...def,
          extract: (el: Element, doc: Document) => {
            const facts = def.extract(el, doc);
            return facts && { ...facts, title: 'a' + '😀'.repeat(1000), channelName: '𝕏'.repeat(500) };
          },
        },
      ]),
    );
    const t = started({ site: { ...youtube, surfaces } });
    t.io.trigger(true);
    const facts = t.batches.flat()[0]!.facts;
    expect(facts.title).toBe('a' + '😀'.repeat(499));
    expect(facts.channelName).toBe('𝕏'.repeat(120));
    expect(isTileFacts(facts)).toBe(true);
  });

  it('marks sent Tiles pending and never sends a decorated Tile twice', () => {
    const t = started();
    t.io.trigger(true);
    const first = t.batches.flat()[0] as TileItem;
    expect(t.w.decor(first.el)).toEqual({ videoId: first.facts.videoId, state: 'pending' });
    t.w.setDecor(first.el, 'chip');
    t.io.trigger(false);
    t.io.trigger(true);
    expect(t.batches).toHaveLength(1);
    expect(t.w.decor(first.el)?.state).toBe('chip');
  });

  it('lists every element showing one video (duplicate copies, including the Shorts shelf)', () => {
    const t = started();
    expect(t.w.elementsFor('FIXTURE0001')).toHaveLength(2);
    const both = t.w.elementsFor('FIXTURE0002');
    expect(both.map((el) => t.w.surfaceOf(el)).sort()).toEqual(['home', 'shortsShelf']);
    expect(t.w.elementsFor('FIXTURE0003')).toEqual([]); // the ad is not a Tile
  });

  it('picks up a continuation batch and its new Shorts shelf in one coalesced frame', async () => {
    const t = started();
    t.io.trigger(true);
    const before = t.batches.length;
    appendContinuation(grid());
    await microtasks();
    expect(t.frames.pending()).toBe(1); // coalesced: one frame for the whole batch
    t.frames.flush();
    expect(t.w.observers().containers).toBe(3); // the new shelf got its own observer
    t.io.trigger(true, t.io.observed().filter((el) => !t.w.decor(el)));
    const fresh = t.batches.slice(before).flat().map((b) => b.facts.videoId).sort();
    expect(fresh).toEqual(['FIXTURE0011', 'FIXTURE0012', 'FIXTURE0013', 'FIXTURE0014', 'FIXTURE0015', 'FIXTURE0016', 'FIXTURE0104', 'FIXTURE0105']);
  });

  it('treats an element that switches to another video as a new Tile', async () => {
    const t = started();
    t.io.trigger(true);
    const el = homeTileOf('FIXTURE0006');
    t.w.setDecor(el, 'chip');
    // YouTube reuses the element: new content-id and links.
    el.innerHTML = el.innerHTML.replaceAll('FIXTURE0006', 'FIXTURE0777').replaceAll('Fixture title 6', 'Fixture title 777');
    t.io.trigger(true, [el]); // seen again when it scrolls back into view
    expect(t.resets).toEqual([[el, 'FIXTURE0006']]);
    expect(t.w.decor(el)).toEqual({ videoId: 'FIXTURE0777', state: 'pending' });
    expect(t.batches.at(-1)?.map((b) => b.facts.title)).toEqual(['Fixture title 777']);
    expect(t.w.elementsFor('FIXTURE0006')).toEqual([]);
    expect(t.w.elementsFor('FIXTURE0777')).toEqual([el]);

    // The same check runs on every coalesced container mutation.
    t.w.setDecor(el, 'label');
    el.innerHTML = el.innerHTML.replaceAll('FIXTURE0777', 'FIXTURE0888');
    grid().append(document.createElement('ytd-continuation-item-renderer'));
    await t.settle();
    expect(t.resets.at(-1)).toEqual([el, 'FIXTURE0777']);
    expect(t.w.decor(el)?.videoId).toBe('FIXTURE0888');
  });

  it('keeps a removed Tile decorated while YouTube shows its placeholder (not element reuse)', async () => {
    const t = started();
    t.io.trigger(true);
    const el = homeTileOf('FIXTURE0006');
    t.w.setDecor(el, 'removed');
    const root = el.querySelector('yt-lockup-view-model') as Element;
    root.replaceChildren(...parse(FIXTURES.homePlaceholder).childNodes);
    appendContinuation(grid());
    await t.settle();
    t.io.trigger(false, [el]);
    t.io.trigger(true, [el]);
    t.w.rescan({ all: true });
    expect(t.resets).toEqual([]);
    expect(t.w.decor(el)).toEqual({ videoId: 'FIXTURE0006', state: 'removed' });
    expect(t.w.elementsFor('FIXTURE0006')).toEqual([el]);
    expect(t.batches.flat().filter((b) => b.el === el)).toHaveLength(1); // sent once, never again
  });

  it('notices in-place reuse through the content-id class or thumbnail href, without a container mutation', async () => {
    const t = started();
    t.io.trigger(true);
    const el = homeTileOf('FIXTURE0007');
    t.w.setDecor(el, 'chip');
    expect(t.w.observers().attributes).toBe(1);
    el.querySelector('.ytLockupViewModelHost')?.classList.replace('content-id-FIXTURE0007', 'content-id-FIXTURE0999');
    await t.settle();
    expect(t.resets).toEqual([[el, 'FIXTURE0007']]);
    expect(t.w.decor(el)).toEqual({ videoId: 'FIXTURE0999', state: 'pending' });
  });

  it('keeps watching a decorated Tile for in-place reuse after YouTube re-rendered its content', async () => {
    const t = started();
    t.io.trigger(true);
    const el = homeTileOf('FIXTURE0007');
    t.w.setDecor(el, 'chip');
    el.innerHTML = el.innerHTML.replace('Fixture title 7', 'Fixture title 7 '); // same video, new elements
    appendContinuation(grid());
    await t.settle();
    expect(t.resets).toEqual([]);
    el.querySelector('.ytLockupViewModelHost')?.classList.replace('content-id-FIXTURE0007', 'content-id-FIXTURE0999');
    await t.settle();
    expect(t.resets).toEqual([[el, 'FIXTURE0007']]);
  });

  it('rescan re-sends Tiles outside the viewport when they come back into view', () => {
    const t = started();
    t.io.trigger(true);
    const el = homeTileOf('FIXTURE0008');
    t.w.setDecor(el, 'chip');
    t.io.trigger(false, [el]);
    t.w.rescan({ all: true });
    expect(t.batches.at(-1)?.some((b) => b.el === el)).toBe(false);
    const before = t.batches.length;
    t.io.trigger(true, [el]);
    expect(t.batches.slice(before).flat().map((b) => b.el)).toEqual([el]);
    t.io.trigger(false, [el]);
    t.io.trigger(true, [el]);
    expect(t.batches.slice(before).flat()).toHaveLength(1); // once per rescan
  });

  it('does not report a markup failure from a hidden tab; it re-checks once the tab is visible', () => {
    vi.useFakeTimers();
    let hidden = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    stops.push(() => delete (document as { hidden?: boolean }).hidden);
    for (const h of grid().querySelectorAll('h3')) h.remove();
    const t = started();
    vi.advanceTimersByTime(SELF_TEST_MS * 3);
    expect(t.checks).toEqual([]);
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(SELF_TEST_MS);
    expect(t.checks).toEqual([{ ok: false, selectorVersion: expect.any(String), missing: ['home.tile'] }]);
  });

  it('forgets Tiles inside a removed Shorts shelf section', async () => {
    const t = started();
    const shelfTiles = t.io.observed().filter((el) => t.w.surfaceOf(el) === 'shortsShelf');
    expect(shelfTiles.length).toBeGreaterThan(0);
    grid().querySelector('ytd-rich-section-renderer')?.remove();
    await t.settle();
    expect(t.io.observed().filter((el) => shelfTiles.includes(el))).toEqual([]);
    expect(t.w.elementsFor('FIXTURE0101')).toEqual([]);
  });

  it('rescan re-sends pending Tiles, or with all every Tile except acting, removed and annotated', () => {
    const t = started();
    t.io.trigger(true);
    const items = t.batches.flat();
    const [a, b, c, d] = items.map((i) => i.el) as [Element, Element, Element, Element];
    for (const el of items.map((i) => i.el)) t.w.setDecor(el, 'none');
    t.w.setDecor(a, 'pending');
    t.w.setDecor(b, 'chip');
    t.w.setDecor(c, 'removed');
    t.w.setDecor(d, 'annotated');
    t.w.rescan();
    expect(t.batches.at(-1)?.map((i) => i.el)).toEqual([a]);
    t.w.rescan({ all: true });
    const resent = t.batches.at(-1)?.map((i) => i.el) ?? [];
    expect(resent).toContain(a);
    expect(resent).toContain(b);
    expect(resent).not.toContain(c);
    expect(resent).not.toContain(d);
  });

  it('attaches zero Tile observers when no enabled Surface matches', () => {
    const t = started({ enabledSurfaces: { ...ALL, home: false, shortsShelf: false } });
    expect(t.w.observers()).toEqual({ containers: 0, intersection: 0, attributes: 0, pageManager: 1, waiting: 0 });
    t.w.setEnabledSurfaces({ ...ALL, home: false, shortsShelf: true });
    // Shorts only: the grid is watched for new shelves, its own Tiles are not sent.
    expect(t.w.observers()).toMatchObject({ containers: 2, intersection: 1 });
    t.io.trigger(true);
    expect(t.sent().every((s) => s.startsWith('shortsShelf:'))).toBe(true);
  });

  it('runs the markup self-test once and reports success at once when Tiles resolve', () => {
    const t = started();
    expect(t.checks).toEqual([{ ok: true, selectorVersion: expect.any(String), missing: [] }]);
  });

  it('reports a markup failure within 5 s when no Tile yields a video ID and title', () => {
    vi.useFakeTimers();
    for (const h of grid().querySelectorAll('h3')) h.remove();
    const warn = vi.fn();
    const t = started({ onMarkupWarning: warn });
    expect(t.checks).toEqual([]);
    vi.advanceTimersByTime(SELF_TEST_MS);
    expect(t.checks).toEqual([{ ok: false, selectorVersion: expect.any(String), missing: ['home.tile'] }]);
    t.io.trigger(true);
    expect(warn).toHaveBeenCalledWith('title', 'home');
  });

  it('stop() disconnects everything and sends nothing afterwards', async () => {
    const t = setup();
    t.w.start();
    t.w.stop();
    expect(t.w.observers()).toEqual({ containers: 0, intersection: 0, attributes: 0, pageManager: 0, waiting: 0 });
    appendContinuation(grid());
    document.dispatchEvent(new Event('yt-navigate-finish'));
    await t.settle();
    t.io.trigger(true);
    expect(t.batches).toEqual([]);
  });
});

describe('watcher navigation', () => {
  beforeEach(() => loadPage(FIXTURES.pageHome, '/'));

  const showWatch = () => {
    history.replaceState(null, '', '/watch?v=DECOY000009');
    document.querySelector('ytd-browse[page-subtype="home"]')?.setAttribute('hidden', '');
    document.querySelector('ytd-watch-flexy')?.removeAttribute('hidden');
  };

  it('rebinds on yt-navigate-finish: drops old observers, signals navigation, scans the new page', async () => {
    const t = started();
    t.io.trigger(true);
    showWatch();
    document.dispatchEvent(new Event('yt-navigate-finish'));
    document.dispatchEvent(new Event('yt-page-data-updated'));
    await t.settle();
    expect(t.onNavigate).toHaveBeenCalledTimes(1);
    expect(t.w.observers()).toMatchObject({ containers: 1, intersection: 1 });
    expect(t.io.observed().every((el) => el.closest('ytd-watch-flexy'))).toBe(true);
    t.io.trigger(true);
    expect(t.batches.at(-1)?.map((b) => `${b.surface}:${b.facts.videoId}`)).toEqual(['watchSidebar:DECOY000003']);
  });

  it('notices a page switch through the page-manager observer when no event fires', async () => {
    const t = started();
    showWatch();
    await t.settle();
    expect(t.onNavigate).toHaveBeenCalledTimes(1);
    expect(t.w.observers().containers).toBe(1);
  });

  it('a data update on the same page rebinds without signalling navigation', async () => {
    const t = started();
    document.dispatchEvent(new Event('yt-page-data-updated'));
    await t.settle();
    expect(t.onNavigate).not.toHaveBeenCalled();
    expect(t.w.observers().containers).toBe(2);
  });
});

describe('watcher badge wait (a channel-row icon that has not rendered)', () => {
  beforeEach(() => {
    loadPage(FIXTURES.pageHome, '/');
    vi.useFakeTimers();
  });

  const FRENCH_ARTIST = 'Chaîne officielle d’artiste';
  const artistBadge = () => homeTileOf('FIXTURE0004').querySelector('.ytContentMetadataViewModelIcon') as Element;
  /** Remove the badge's icon, as before YouTube renders it. Returns a function that renders it. */
  const unrender = (icon: Element) => {
    const svg = icon.querySelector('svg') as Element;
    const parent = svg.parentElement as Element;
    svg.remove();
    return () => parent.append(svg);
  };
  const sentFor = (t: ReturnType<typeof started>, id: string) => t.batches.flat().filter((b) => b.facts.videoId === id);

  it('sends a Tile once its late icon renders, with the Artist channel flag, and not before', () => {
    artistBadge().setAttribute('aria-label', FRENCH_ARTIST);
    setTimeout(unrender(artistBadge()), 300);
    const t = started();
    t.io.trigger(true);
    expect(t.sent()).toContain('home:FIXTURE0001'); // other Tiles go at once
    expect(sentFor(t, 'FIXTURE0004')).toEqual([]);
    vi.advanceTimersByTime(299);
    expect(sentFor(t, 'FIXTURE0004')).toEqual([]);
    vi.advanceTimersByTime(BADGE_POLL_MS);
    expect(sentFor(t, 'FIXTURE0004').map((b) => b.facts.isArtistChannel)).toEqual([true]);
    vi.advanceTimersByTime(BADGE_WAIT_MS * 2);
    t.io.trigger(true);
    expect(sentFor(t, 'FIXTURE0004')).toHaveLength(1);
  });

  it('sends the Tile without the flag after the wait when the icon never renders', () => {
    artistBadge().setAttribute('aria-label', FRENCH_ARTIST);
    unrender(artistBadge());
    const t = started();
    t.io.trigger(true);
    vi.advanceTimersByTime(BADGE_WAIT_MS - 1);
    expect(sentFor(t, 'FIXTURE0004')).toEqual([]);
    vi.advanceTimersByTime(1);
    const sent = sentFor(t, 'FIXTURE0004');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.facts).not.toHaveProperty('isArtistChannel');
    expect(t.w.decor(sent[0]?.el as Element)?.state).toBe('pending');
    vi.advanceTimersByTime(BADGE_WAIT_MS * 2);
    expect(sentFor(t, 'FIXTURE0004')).toHaveLength(1);
  });

  it('counts only visible time toward the wait', () => {
    let hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    stops.push(() => delete (document as { hidden?: boolean }).hidden);
    artistBadge().setAttribute('aria-label', FRENCH_ARTIST);
    const render = unrender(artistBadge());
    const t = started();
    t.io.trigger(true);
    hidden = true;
    vi.advanceTimersByTime(BADGE_WAIT_MS * 3);
    expect(sentFor(t, 'FIXTURE0004')).toEqual([]);
    hidden = false;
    render();
    vi.advanceTimersByTime(BADGE_POLL_MS);
    expect(sentFor(t, 'FIXTURE0004').map((b) => b.facts.isArtistChannel)).toEqual([true]);
  });

  it('sends at once a Tile whose unrendered icon has the known Artist channel label, with the flag', () => {
    unrender(artistBadge()); // label "Official Artist Channel"
    const t = started();
    t.io.trigger(true);
    expect(sentFor(t, 'FIXTURE0004').map((b) => b.facts.isArtistChannel)).toEqual([true]);
  });

  it('ends the wait without a send when the Tile leaves the eligible area or the page', async () => {
    artistBadge().setAttribute('aria-label', FRENCH_ARTIST);
    unrender(artistBadge());
    const t = started();
    t.io.trigger(true);
    const el = homeTileOf('FIXTURE0004');
    vi.advanceTimersByTime(BADGE_WAIT_MS - BADGE_POLL_MS);
    t.io.trigger(false, [el]);
    t.io.trigger(true, [el]); // back in view before the next poll: a new wait, not the rest of the old one
    vi.advanceTimersByTime(BADGE_WAIT_MS - BADGE_POLL_MS);
    expect(sentFor(t, 'FIXTURE0004')).toEqual([]);
    el.remove();
    await t.settle();
    vi.advanceTimersByTime(BADGE_WAIT_MS * 2);
    expect(sentFor(t, 'FIXTURE0004')).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ends the wait on a rebind (navigation) and on stop()', async () => {
    artistBadge().setAttribute('aria-label', FRENCH_ARTIST);
    unrender(artistBadge());
    const t = started();
    t.io.trigger(true);
    vi.advanceTimersByTime(BADGE_WAIT_MS - BADGE_POLL_MS);
    document.dispatchEvent(new Event('yt-page-data-updated'));
    await t.settle();
    t.io.trigger(true);
    vi.advanceTimersByTime(BADGE_WAIT_MS - BADGE_POLL_MS);
    expect(sentFor(t, 'FIXTURE0004')).toEqual([]); // the rebind started a new wait
    t.w.stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(BADGE_WAIT_MS * 2);
    expect(sentFor(t, 'FIXTURE0004')).toEqual([]);
  });

  it('keeps waiting through a moment without a readable video ID (content mid-render)', () => {
    artistBadge().setAttribute('aria-label', FRENCH_ARTIST);
    const render = unrender(artistBadge());
    const warn = vi.fn();
    const t = started({ onMarkupWarning: warn });
    t.io.trigger(true);
    const host = homeTileOf('FIXTURE0004').querySelector('.ytLockupViewModelHost') as Element;
    vi.advanceTimersByTime(BADGE_POLL_MS * 3);
    host.classList.remove('content-id-FIXTURE0004');
    vi.advanceTimersByTime(BADGE_POLL_MS * 3);
    host.classList.add('content-id-FIXTURE0004');
    render();
    vi.advanceTimersByTime(BADGE_POLL_MS);
    expect(sentFor(t, 'FIXTURE0004').map((b) => b.facts.isArtistChannel)).toEqual([true]);
    expect(warn).not.toHaveBeenCalledWith('videoId', 'home');
  });

  it('starts over when the waiting element shows another video, and sends only that video', () => {
    artistBadge().setAttribute('aria-label', FRENCH_ARTIST);
    unrender(artistBadge());
    const t = started();
    t.io.trigger(true);
    const el = homeTileOf('FIXTURE0004');
    vi.advanceTimersByTime(BADGE_POLL_MS * 5);
    el.innerHTML = el.innerHTML.replaceAll('FIXTURE0004', 'FIXTURE0444'); // reused in place: only the poll sees it
    vi.advanceTimersByTime(BADGE_WAIT_MS);
    expect(sentFor(t, 'FIXTURE0444')).toEqual([]); // its own wait from the next poll, not the rest of the old one
    vi.advanceTimersByTime(BADGE_POLL_MS);
    expect(t.batches.flat().filter((b) => b.el === el).map((b) => b.facts.videoId)).toEqual(['FIXTURE0444']);
    expect(t.w.elementsFor('FIXTURE0444')).toEqual([el]);
  });
});

describe('watcher on the composed Watch page', () => {
  beforeEach(() => loadPage(FIXTURES.pageWatch, '/watch?v=FIXTURE0201'));

  it('sends Tiles with a Verified badge at once, rendered in any language or unrendered with its known label', () => {
    vi.useFakeTimers();
    const icons = [...sidebar().querySelectorAll('.ytContentMetadataViewModelIcon')];
    for (const [i, icon] of icons.entries()) {
      if (i % 2) icon.querySelector('svg')?.remove(); // label "Verified"
      else icon.setAttribute('aria-label', 'Validé'); // icon rendered
    }
    const t = started();
    t.io.trigger(true);
    expect(t.sent()).toHaveLength(7);
    expect(vi.getTimerCount()).toBe(0); // no badge poll pending
  });

  it('skips the playing video and the playlist panel, keeps duplicate copies', async () => {
    const t = started();
    expect(t.w.observers()).toMatchObject({ containers: 1, intersection: 1, waiting: 0 });
    t.io.trigger(true);
    expect(t.sent()).toEqual([
      'watchSidebar:FIXTURE0202',
      'watchSidebar:FIXTURE0203',
      'watchSidebar:FIXTURE0204',
      'watchSidebar:FIXTURE0202',
      'watchSidebar:FIXTURE0205',
      'watchSidebar:FIXTURE0206',
      'watchSidebar:FIXTURE0207',
    ]);
    expect(t.w.elementsFor('FIXTURE0202')).toHaveLength(2);
    expect(t.w.elementsFor('FIXTURE0299')).toEqual([]);
    appendContinuation(sidebar());
    await t.settle();
    t.io.trigger(true, t.io.observed().filter((el) => !t.w.decor(el)));
    expect(t.sent().slice(-3)).toEqual(['watchSidebar:FIXTURE0208', 'watchSidebar:FIXTURE0209', 'watchSidebar:FIXTURE0210']);
  });

  it('waits for a late container, then switches to the narrow observer', async () => {
    const section = sidebar().parentElement as Element;
    const parent = section.parentElement as Element;
    section.remove();
    vi.useFakeTimers();
    const t = started();
    expect(t.w.observers()).toMatchObject({ containers: 0, waiting: 1, intersection: 1 });
    parent.append(section);
    await microtasks();
    vi.advanceTimersByTime(60); // checks are timer-coalesced, so they also run in hidden tabs
    expect(t.w.observers()).toMatchObject({ containers: 1, waiting: 0 });
    expect(t.checks).toEqual([{ ok: true, selectorVersion: expect.any(String), missing: [] }]);
  });

  it('gives up waiting after 10 s and only then reports the missing container', () => {
    vi.useFakeTimers();
    sidebar().parentElement?.remove();
    const t = started();
    expect(t.w.observers().waiting).toBe(1);
    vi.advanceTimersByTime(SELF_TEST_MS);
    expect(t.checks).toEqual([]); // still waiting for YouTube to draw the sidebar
    vi.advanceTimersByTime(CONTAINER_WAIT_MS - SELF_TEST_MS);
    expect(t.w.observers().waiting).toBe(0);
    expect(t.checks).toEqual([{ ok: false, selectorVersion: expect.any(String), missing: ['watchSidebar.container'] }]);
  });

  it('a sidebar YouTube draws between 5 and 10 s is not a markup failure', async () => {
    const section = sidebar().parentElement as Element;
    const parent = section.parentElement as Element;
    section.remove();
    vi.useFakeTimers();
    const t = started();
    vi.advanceTimersByTime(SELF_TEST_MS + 3000);
    parent.append(section);
    await microtasks();
    vi.advanceTimersByTime(60);
    expect(t.checks).toEqual([{ ok: true, selectorVersion: expect.any(String), missing: [] }]);
  });

  it('a late container whose Tiles never resolve is still reported, 5 s after it appeared', async () => {
    const section = sidebar().parentElement as Element;
    const parent = section.parentElement as Element;
    section.remove();
    for (const h of section.querySelectorAll('h3')) h.remove();
    vi.useFakeTimers();
    const t = started();
    vi.advanceTimersByTime(SELF_TEST_MS + 1000);
    parent.append(section);
    await microtasks();
    vi.advanceTimersByTime(60);
    expect(t.checks).toEqual([]);
    vi.advanceTimersByTime(SELF_TEST_MS);
    expect(t.checks).toEqual([{ ok: false, selectorVersion: expect.any(String), missing: ['watchSidebar.tile'] }]);
  });

  it('never reports a missing container from a hidden tab, and waits 10 s of visible time', () => {
    vi.useFakeTimers();
    let hidden = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    stops.push(() => delete (document as { hidden?: boolean }).hidden);
    sidebar().parentElement?.remove();
    const t = started();
    vi.advanceTimersByTime(CONTAINER_WAIT_MS * 3);
    expect(t.checks).toEqual([]);
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(SELF_TEST_MS);
    expect(t.checks).toEqual([]);
    vi.advanceTimersByTime(CONTAINER_WAIT_MS);
    expect(t.checks).toEqual([{ ok: false, selectorVersion: expect.any(String), missing: ['watchSidebar.container'] }]);
  });
});
