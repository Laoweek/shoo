// Bilibili Tile extraction. Source of truth: docs/spec/bilibili-integration.md Section 2.
// extract() returns TileFacts or null (skip). Skip order: anything that is not a plain video (ads included), then
// the current-video guard. Reads only the DOM (isolated world). Never reads Bilibili page data.
import { BILIBILI_COVER_PATH } from '~/core/sites';
import type { SurfaceId, TileFacts } from '~/core/types';
import { parseDuration, type MarkupWarning } from '../site';

const VIDEO_PATH = /^\/video\/(BV[0-9A-Za-z]{10})\/?$/;
const SPACE_PATH = /^\/(\d+)\/?$/;
const IMAGE_HOST = /^i\d\.hdslb\.com$/;

const url = (href: string | null | undefined): URL | null => {
  if (!href) return null;
  try {
    return new URL(href, 'https://www.bilibili.com/');
  } catch {
    return null;
  }
};

/** The BV id of a link to a video page on www.bilibili.com, or null (live rooms, bangumi, courses, ad links). */
export function videoIdOfLink(href: string | null | undefined): string | null {
  const u = url(href);
  if (!u || u.hostname !== 'www.bilibili.com') return null;
  return VIDEO_PATH.exec(u.pathname)?.[1] ?? null;
}

const imageLink = (tile: Element) => tile.querySelector('a.bili-video-card__image--link');

/** The video a Tile element shows now, or null. */
export function tileVideoId(tile: Element): string | null {
  return videoIdOfLink(imageLink(tile)?.getAttribute('href'));
}

export function tileTitle(tile: Element): string | null {
  const h3 = tile.querySelector('h3.bili-video-card__info--tit');
  return h3?.getAttribute('title')?.trim() || h3?.textContent?.trim() || null;
}

/** The video of a video page (`/video/BV…`), the one playing there. */
export function currentVideoId(doc: Document): string | null {
  return VIDEO_PATH.exec(doc.location?.pathname ?? '')?.[1] ?? null;
}

/** REQ-SURF-3. Home plays no video. A video page's own video never counts as a recommendation. */
export function isPlayingOrQueued(_tile: Element, videoId: string, doc: Document): boolean {
  return videoId === currentVideoId(doc);
}

/** The cover's path on Bilibili's image host, without the size suffix (`@672w_378h_…`), when it has the archive shape. */
export function coverPath(tile: Element): string | undefined {
  const u = url(tile.querySelector('picture.bili-video-card__cover img')?.getAttribute('src'));
  if (!u || !IMAGE_HOST.test(u.hostname)) return undefined;
  const path = u.pathname.split('@')[0] ?? '';
  return BILIBILI_COVER_PATH.test(path) ? path : undefined;
}

export function extract(tile: Element, surface: SurfaceId, doc: Document, warn?: MarkupWarning): TileFacts | null {
  // 1. Only plain videos: a Tile linking anywhere else is skipped silently. Ads look like video Tiles, menu button
  // included, but link to cm.bilibili.com and show no duration (2 of 10 Home Tiles, 2026-10-18).
  const link = imageLink(tile);
  if (!link) {
    warn?.('videoId', surface);
    return null;
  }
  const videoId = videoIdOfLink(link.getAttribute('href'));
  if (!videoId) return null;
  const durationSec = parseDuration(tile.querySelector('.bili-video-card__stats__duration')?.textContent);
  if (durationSec === undefined) return null;
  // 2. Never the playing video (REQ-SURF-3).
  if (isPlayingOrQueued(tile, videoId, doc)) return null;

  const title = tileTitle(tile);
  if (!title) {
    warn?.('title', surface);
    return null;
  }
  const facts: TileFacts = { videoId, surface, title, durationSec, isShort: false, isLive: false, isUpcoming: false, isMembersOnly: false };
  readChannel(tile, facts);
  const cover = coverPath(tile);
  if (cover) facts.cover = cover;
  return facts;
}

// The uploader (UP主): the owner link to their space page carries the numeric id, the author span the name.
function readChannel(tile: Element, facts: TileFacts): void {
  const owner = tile.querySelector('a.bili-video-card__info--owner');
  if (!owner) return;
  const author = owner.querySelector('.bili-video-card__info--author');
  const name = (author?.getAttribute('title') || author?.textContent)?.trim();
  if (name) facts.channelName = name;
  const u = url(owner.getAttribute('href'));
  const mid = u?.hostname === 'space.bilibili.com' ? SPACE_PATH.exec(u.pathname)?.[1] : undefined;
  if (mid) facts.channelId = mid;
}
