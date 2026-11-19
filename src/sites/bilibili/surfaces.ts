// Bilibili's Surface registry. Source of truth: docs/spec/bilibili-integration.md Section 1.
import type { NativeAction } from '~/core/types';
import type { SurfaceDef } from '../site';
import { extract, tileTitle, tileVideoId } from './extract';

// Bump when a selector below changes. Failure reports carry it, and the prefix tells them from YouTube's.
export const SELECTOR_VERSION = 'bilibili-2026-10-18';

export type BilibiliSurfaceId = 'bilibiliHome' | 'bilibiliVideoSidebar';

const all = (root: Element, sel: string): Element[] => Array.from(root.querySelectorAll(sel));
const none = (): null => null;

const defs: Record<BilibiliSurfaceId, SurfaceDef> = {
  bilibiliHome: {
    id: 'bilibiliHome',
    supported: true,
    matches: (loc) => loc.pathname === '/',
    containers: (page) => all(page, '.recommended-container_floor-aside > .container'),
    // The first rows are .feed-card, the infinite feed adds .bili-feed-card. Loading skeletons, the carousel and
    // floors (live, bangumi, courses) hold no rcmd video card.
    tiles: (c) => Array.from(c.children).filter((el) => el.matches('.feed-card, .bili-feed-card') && !!el.querySelector('.bili-video-card.is-rcmd')),
    videoId: tileVideoId,
    title: tileTitle,
    extract: (tile, doc, warn) => extract(tile, 'bilibiliHome', doc, warn),
    reuseTargets: (tile) => [{ el: tile.querySelector('a.bili-video-card__image--link'), attributes: ['href'] }],
    actionRoot: (tile) => tile.querySelector('.bili-video-card__wrap'),
    thumbnail: (tile) => tile.querySelector('.bili-video-card__image'),
    // The stats row over the cover's bottom: plays and danmaku at the left, the duration at the right.
    badges: (thumb) => all(thumb, '.bili-video-card__stats--item, .bili-video-card__stats__duration'),
    // `position: relative` (observed 2026-10-18), and outside the cover link.
    mountParent: (tile) => tile.querySelector('.bili-video-card'),
    menuButton: (tile) => tile.querySelector<HTMLElement>('.bili-video-card__info--no-interest'),
    focusReturn: (tile) => tile.querySelector<HTMLElement>('h3.bili-video-card__info--tit a'),
    actions: ['notInterested', 'dontRecommendChannel'],
    selectorVersion: SELECTOR_VERSION,
  },
  // The video page's recommendations have no menu at all, not even on hover (live test 2026-10-18).
  bilibiliVideoSidebar: {
    id: 'bilibiliVideoSidebar',
    supported: false,
    reason: 'settings.surfaces.unsupported',
    matches: (loc) => loc.pathname.startsWith('/video/'),
    containers: (): Element[] => [],
    tiles: (c) => all(c, '.video-page-card-small'),
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
  },
};

export const SURFACES: Readonly<Record<BilibiliSurfaceId, SurfaceDef>> = Object.freeze(
  Object.fromEntries(Object.entries(defs).map(([k, v]) => [k, Object.freeze(v)])) as Record<BilibiliSurfaceId, SurfaceDef>,
);
