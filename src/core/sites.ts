// Sites and the Surfaces on them. Source of truth: docs/spec/architecture.md Section 3 and ADR 0011.
// A Site is told apart from its video IDs alone, so stored Verdicts, Exceptions and Activity need no Site field:
// YouTube IDs are 11 characters of [A-Za-z0-9_-], Bilibili IDs are 'BV' and 10 more letters or digits.
import type { ActivityKind, SurfaceId } from './types';

export type SiteId = 'youtube' | 'bilibili';
export const SITE_IDS: readonly SiteId[] = ['youtube', 'bilibili'];

/** The Site's name in copy. */
export const SITE_NAMES: Readonly<Record<SiteId, string>> = { youtube: 'YouTube', bilibili: 'Bilibili' };

/** Each Site's host access in the manifest: its pages, then its image host for Thumbnail rules. */
export const SITE_HOSTS: Readonly<Record<SiteId, readonly string[]>> = {
  youtube: ['https://www.youtube.com/*', 'https://i.ytimg.com/*'],
  bilibili: ['https://www.bilibili.com/*', 'https://i0.hdslb.com/*'],
};

/** The origin of the pages the Site's content script runs on. */
export const SITE_ORIGINS: Readonly<Record<SiteId, string>> = {
  youtube: 'https://www.youtube.com',
  bilibili: 'https://www.bilibili.com',
};

export const SURFACE_SITE: Readonly<Record<SurfaceId, SiteId>> = {
  home: 'youtube',
  watchSidebar: 'youtube',
  shortsShelf: 'youtube',
  search: 'youtube',
  channel: 'youtube',
  endScreen: 'youtube',
  bilibiliHome: 'bilibili',
  bilibiliVideoSidebar: 'bilibili',
};

const YOUTUBE_ID = /^[\w-]{11}$/;
const BILIBILI_ID = /^BV[0-9A-Za-z]{10}$/;

/** The Site a video ID belongs to, or undefined for an ID of neither shape. */
export function videoSite(id: string): SiteId | undefined {
  if (BILIBILI_ID.test(id)) return 'bilibili';
  if (YOUTUBE_ID.test(id)) return 'youtube';
  return undefined;
}

/**
 * The Site of an Activity row: its video ID's shape, else its Surface (a Review Keep row stores none), else its own
 * Site. An 'escalated' row recorded before Sites has none of these and is YouTube's.
 */
export const siteOfVideo = (e: { kind?: ActivityKind; videoId?: string; surface?: SurfaceId; site?: SiteId }): SiteId | undefined =>
  (e.videoId ? videoSite(e.videoId) : undefined) ??
  (e.surface ? SURFACE_SITE[e.surface] : undefined) ??
  e.site ??
  (e.kind === 'escalated' ? 'youtube' : undefined);

/** The Site a page URL belongs to: its origin is the Site's origin. */
export function siteOfUrl(url: string): SiteId | undefined {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return undefined;
  }
  return SITE_IDS.find((s) => SITE_ORIGINS[s] === origin);
}

/**
 * The only Bilibili cover path Shoo accepts from a page: an archive image named by its 40-character hash. The
 * thumbnail pass fetches it from Bilibili's image host at the size YouTube's mqdefault has (320 × 180).
 */
export const BILIBILI_COVER_PATH = /^\/bfs\/archive\/[0-9a-f]{40}\.(jpg|png)$/;

/** A thumbnail URL for a video: YouTube's derived mqdefault, or a Bilibili cover from its path. */
export function thumbnailUrlFor(videoId: string, cover?: string): string | undefined {
  const site = videoSite(videoId);
  if (site === 'youtube') return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
  if (site === 'bilibili' && cover !== undefined && BILIBILI_COVER_PATH.test(cover)) return `https://i0.hdslb.com${cover}@320w_180h_1c.jpg`;
  return undefined;
}
