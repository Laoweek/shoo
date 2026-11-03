// Surface registry. Source of truth: docs/spec/youtube-integration.md Section 1.
// One frozen SurfaceDef per SurfaceId. Unsupported Surfaces stay listed with `supported: false`
// and an i18n `reason` key so Settings can show them disabled (REQ-SURF-1a).
import type { SurfaceId } from '~/core/types';

// Bump when a selector below changes. Failure reports carry it (Section 7).
export const SELECTOR_VERSION = '2026-10-09';

export type SurfaceAction = 'notInterested' | 'dontRecommendChannel';

export interface SurfaceDef {
  id: SurfaceId;
  supported: boolean;
  reason?: string; // i18n key shown in Settings when unsupported
  matches(loc: Location, page: Element): boolean;
  containers(page: Element): Element[]; // resolved fresh after every navigation
  tiles(container: Element): Element[];
  actionRoot(tile: Element): Element | null;
  thumbnail(tile: Element): Element | null;
  mountParent(tile: Element): Element | null;
  menuButton(tile: Element): HTMLElement | null;
  focusReturn(tile: Element): HTMLElement | null;
  actions: SurfaceAction[];
  selectorVersion: string;
}

/** The current page: `ytd-page-manager` keeps pages you left, hidden. Scope every query to this. */
export function visiblePage(doc: Document): Element | null {
  return doc.querySelector('ytd-page-manager > :not([hidden])');
}

const all = (root: Element, sel: string): Element[] => Array.from(root.querySelectorAll(sel));
const childTiles = (c: Element, ok: (el: Element) => boolean): Element[] => Array.from(c.children).filter(ok);
const none = (): null => null;
const UNSUPPORTED_REASON = 'settings.surfaces.unsupported';

const isHome = (loc: Location, page: Element) => loc.pathname === '/' && page.matches('ytd-browse[page-subtype="home"]');

// Lockup Tiles (Home grid and Watch sidebar) share the yt-lockup-view-model component.
const lockupRoles = {
  thumbnail: (tile: Element) => tile.querySelector('a.ytLockupViewModelContentImage yt-thumbnail-view-model'),
  mountParent: (tile: Element) => tile.querySelector('.ytLockupViewModelHost'),
  menuButton: (tile: Element) => tile.querySelector<HTMLElement>('.ytLockupMetadataViewModelMenuButton button'),
  focusReturn: (tile: Element) => tile.querySelector<HTMLElement>('a.ytLockupMetadataViewModelTitle'),
};

const unsupported = {
  supported: false,
  reason: UNSUPPORTED_REASON,
  containers: (): Element[] => [], // not observed in v1
  actionRoot: none,
  thumbnail: none,
  mountParent: none,
  menuButton: none,
  focusReturn: none,
  actions: [] as SurfaceAction[],
  selectorVersion: SELECTOR_VERSION,
};

const defs: Record<SurfaceId, SurfaceDef> = {
  home: {
    id: 'home',
    supported: true,
    matches: isHome,
    containers: (page) => all(page, 'ytd-rich-grid-renderer > #contents'),
    // Ads hold their lockup deeper (inside ytd-ad-slot-renderer), so they do not match here. extract() checks again.
    tiles: (c) =>
      childTiles(c, (el) => el.localName === 'ytd-rich-item-renderer' && !!el.querySelector(':scope > #content > yt-lockup-view-model')),
    actionRoot: (tile) => tile.querySelector('yt-lockup-view-model'),
    ...lockupRoles,
    actions: ['notInterested', 'dontRecommendChannel'],
    selectorVersion: SELECTOR_VERSION,
  },
  shortsShelf: {
    id: 'shortsShelf',
    supported: true,
    matches: isHome, // inside Home only
    containers: (page) => all(page, 'ytd-rich-grid-renderer > #contents ytd-rich-shelf-renderer[is-shorts] #contents'),
    tiles: (c) =>
      childTiles(c, (el) => el.localName === 'ytd-rich-item-renderer' && el.hasAttribute('is-shelf-item') && !!el.querySelector('ytm-shorts-lockup-view-model')),
    // Observed 2026-10-10: YouTube swaps the -v2 wrapper's children for the placeholder (the inner lockup is removed).
    actionRoot: (tile) => tile.querySelector('ytm-shorts-lockup-view-model-v2'),
    thumbnail: (tile) => tile.querySelector('.shortsLockupViewModelHostThumbnailParentContainer'),
    mountParent: (tile) => tile.querySelector('ytm-shorts-lockup-view-model'),
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
    ...lockupRoles,
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

export const SURFACES: Readonly<Record<SurfaceId, SurfaceDef>> = Object.freeze(
  Object.fromEntries(Object.entries(defs).map(([k, v]) => [k, Object.freeze(v)])) as Record<SurfaceId, SurfaceDef>,
);

/** Supported Surfaces that are enabled and match the visible page. Empty means: attach no Tile observers. */
export function activeSurfaces(loc: Location, doc: Document, enabled: Partial<Record<SurfaceId, boolean>>): SurfaceDef[] {
  const page = visiblePage(doc);
  if (!page) return [];
  return Object.values(SURFACES).filter((d) => d.supported && enabled[d.id] === true && d.matches(loc, page));
}
