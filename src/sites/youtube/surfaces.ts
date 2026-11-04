// YouTube's Surface registry. Source of truth: docs/spec/youtube-integration.md Section 1.
// One frozen SurfaceDef per YouTube SurfaceId. Unsupported Surfaces stay listed with `supported: false`
// and an i18n `reason` key so Settings can show them disabled (REQ-SURF-1a).
import type { NativeAction } from '~/core/types';
import type { SurfaceDef } from '../site';
import { channelBadgePending, extract, tileTitle, tileVideoId } from './extract';

// Bump when a selector below changes. Failure reports carry it (Section 7).
export const SELECTOR_VERSION = '2026-10-09';

export type YouTubeSurfaceId = 'home' | 'watchSidebar' | 'shortsShelf' | 'search' | 'channel' | 'endScreen';

/** The current page: `ytd-page-manager` keeps pages you left, hidden. Scope every query to this. */
export function visiblePage(doc: Document): Element | null {
  return doc.querySelector('ytd-page-manager > :not([hidden])');
}

const all = (root: Element, sel: string): Element[] => Array.from(root.querySelectorAll(sel));
const childTiles = (c: Element, ok: (el: Element) => boolean): Element[] => Array.from(c.children).filter(ok);
const none = (): null => null;
const UNSUPPORTED_REASON = 'settings.surfaces.unsupported';

const isHome = (loc: Location, page: Element) => loc.pathname === '/' && page.matches('ytd-browse[page-subtype="home"]');

// YouTube's duration and LIVE badges over a thumbnail.
const badges = (thumb: Element): Element[] => all(thumb, 'badge-shape');

// Lockup Tiles (Home grid and Watch sidebar) share the yt-lockup-view-model component.
const lockupRoles = (id: 'home' | 'watchSidebar') => ({
  videoId: (tile: Element) => tileVideoId(tile, id),
  title: (tile: Element) => tileTitle(tile, id),
  extract: (tile: Element, doc: Document, warn?: Parameters<SurfaceDef['extract']>[2]) => extract(tile, id, doc, warn),
  // Section 3: a reused lockup changes its content-id class or its thumbnail href.
  reuseTargets: (tile: Element) => [
    { el: tile.querySelector('.ytLockupViewModelHost'), attributes: ['class'] },
    { el: tile.querySelector('a.ytLockupViewModelContentImage'), attributes: ['href'] },
  ],
  badgePending: (tile: Element) => channelBadgePending(tile, id),
  thumbnail: (tile: Element) => tile.querySelector('a.ytLockupViewModelContentImage yt-thumbnail-view-model'),
  badges,
  mountParent: (tile: Element) => tile.querySelector('.ytLockupViewModelHost'),
  menuButton: (tile: Element) => tile.querySelector<HTMLElement>('.ytLockupMetadataViewModelMenuButton button'),
  focusReturn: (tile: Element) => tile.querySelector<HTMLElement>('a.ytLockupMetadataViewModelTitle'),
});

const unsupported = {
  supported: false,
  reason: UNSUPPORTED_REASON,
  containers: (): Element[] => [], // not observed in v1
  videoId: none,
  title: none,
  extract: none,
  reuseTargets: () => [],
  actionRoot: none,
  thumbnail: none,
  badges: () => [],
  mountParent: none,
  menuButton: none,
  focusReturn: none,
  actions: [] as NativeAction[],
  selectorVersion: SELECTOR_VERSION,
};

const defs: Record<YouTubeSurfaceId, SurfaceDef> = {
  home: {
    id: 'home',
    supported: true,
    matches: isHome,
    containers: (page) => all(page, 'ytd-rich-grid-renderer > #contents'),
    // Ads hold their lockup deeper (inside ytd-ad-slot-renderer), so they do not match here. extract() checks again.
    tiles: (c) =>
      childTiles(c, (el) => el.localName === 'ytd-rich-item-renderer' && !!el.querySelector(':scope > #content > yt-lockup-view-model')),
    actionRoot: (tile) => tile.querySelector('yt-lockup-view-model'),
    ...lockupRoles('home'),
    actions: ['notInterested', 'dontRecommendChannel'],
    selectorVersion: SELECTOR_VERSION,
  },
  shortsShelf: {
    id: 'shortsShelf',
    supported: true,
    optional: true, // shelves are optional on Home
    nestedIn: 'home', // shelves arrive as new sections of the Home grid
    matches: isHome, // inside Home only
    containers: (page) => all(page, 'ytd-rich-grid-renderer > #contents ytd-rich-shelf-renderer[is-shorts] #contents'),
    tiles: (c) =>
      childTiles(c, (el) => el.localName === 'ytd-rich-item-renderer' && el.hasAttribute('is-shelf-item') && !!el.querySelector('ytm-shorts-lockup-view-model')),
    videoId: (tile) => tileVideoId(tile, 'shortsShelf'),
    title: (tile) => tileTitle(tile, 'shortsShelf'),
    extract: (tile, doc, warn) => extract(tile, 'shortsShelf', doc, warn),
    reuseTargets: (tile) => [{ el: tile.querySelector('a.shortsLockupViewModelHostEndpoint'), attributes: ['href'] }],
    // Observed 2026-10-10: YouTube swaps the -v2 wrapper's children for the placeholder (the inner lockup is removed).
    actionRoot: (tile) => tile.querySelector('ytm-shorts-lockup-view-model-v2'),
    thumbnail: (tile) => tile.querySelector('.shortsLockupViewModelHostThumbnailParentContainer'),
    badges,
    mountParent: (tile) => tile.querySelector('ytm-shorts-lockup-view-model'),
    // YouTube's Shorts hover preview (ytd-video-preview) is a page-level element drawn over the Tile (Section 6).
    overlay: true,
    menuButton: (tile) => tile.querySelector<HTMLElement>('.shortsLockupViewModelHostOutsideMetadataMenu > button'),
    // Focusable: no tabindex or aria-hidden (observed 2026-10-10).
    focusReturn: (tile) => tile.querySelector<HTMLElement>('a.shortsLockupViewModelHostOutsideMetadataEndpoint'),
    actions: ['notInterested'], // REQ-SURF-1b
    selectorVersion: SELECTOR_VERSION,
  },
  watchSidebar: {
    id: 'watchSidebar',
    supported: true,
    matches: (loc, page) => loc.pathname === '/watch' && page.matches('ytd-watch-flexy'),
    containers: (page) => all(page, 'ytd-watch-next-secondary-results-renderer ytd-item-section-renderer > #contents'),
    tiles: (c) => childTiles(c, (el) => el.localName === 'yt-lockup-view-model' && el.classList.contains('lockup')),
    actionRoot: (tile) => tile,
    ...lockupRoles('watchSidebar'),
    actions: ['notInterested', 'dontRecommendChannel'],
    selectorVersion: SELECTOR_VERSION,
  },
  search: {
    id: 'search',
    ...unsupported,
    matches: (loc, page) => loc.pathname === '/results' && page.matches('ytd-search'),
    tiles: (c) => all(c, 'ytd-video-renderer[is-search]'),
  },
  channel: {
    id: 'channel',
    ...unsupported,
    matches: (loc, page) =>
      /^\/(@|channel\/|c\/|user\/)/.test(loc.pathname) && page.matches('ytd-browse[page-subtype="channels"]'),
    tiles: (c) =>
      all(c, 'yt-horizontal-list-renderer #items > yt-lockup-view-model, ytd-rich-grid-renderer > #contents > ytd-rich-item-renderer'),
  },
  endScreen: {
    id: 'endScreen',
    ...unsupported,
    matches: (loc) => loc.pathname === '/watch',
    tiles: (c) => all(c, '.ytp-ce-element, .ytp-modern-videowall-still'),
  },
};

export const SURFACES: Readonly<Record<YouTubeSurfaceId, SurfaceDef>> = Object.freeze(
  Object.fromEntries(Object.entries(defs).map(([k, v]) => [k, Object.freeze(v)])) as Record<YouTubeSurfaceId, SurfaceDef>,
);
