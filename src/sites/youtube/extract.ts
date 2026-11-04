// YouTube Tile extraction. Source of truth: docs/spec/youtube-integration.md Section 3.
// extract() returns TileFacts or null (skip). Skip order: ad, then type checks, then the current-video guard.
// channelBadgePending() tells the watcher to read a Tile again once its channel-row badge icon renders.
// Reads only the DOM (isolated world). Never reads YouTube page data or tokens.
import { parseCount } from '~/core/count';
import type { SurfaceId, TileFacts } from '~/core/types';
import { parseDuration, type MarkupWarning } from '../site';

export { parseDuration };

const AD_SELECTOR = 'ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, feed-ad-metadata-view-model, ad-badge-view-model, .ytBadgeShapeAd';
const VIDEO_ID = /^[\w-]{11}$/;

/**
 * `116 thousand views` → 116000, `1.1m views` → 1100000, `1 view` → 1, `No views` → 0. English only: in another
 * language the Tile has no view count, so views Rules never match it. Live Tiles say "watching", not "views".
 */
export function parseViews(text: string | null | undefined): number | undefined {
  const t = text?.trim();
  if (!t) return undefined;
  if (/^no views$/i.test(t)) return 0;
  const m = /^(.+?)\s+views?$/i.exec(t);
  return m ? parseCount(m[1]!) : undefined;
}

/**
 * Lockups: the metadata text with a views label (`aria-label="116 thousand views"`, visible text `116k`). The channel
 * name carries no label, so a channel named like a count is never read as one. Shorts shelf: the subhead text.
 */
function readViewCount(tile: Element, shorts: boolean): number | undefined {
  if (shorts) {
    const subhead = tile.querySelector('.shortsLockupViewModelHostMetadataSubhead');
    return parseViews(subhead?.querySelector('[aria-label]')?.getAttribute('aria-label')) ?? parseViews(subhead?.textContent);
  }
  for (const text of tile.querySelectorAll('.ytContentMetadataViewModelMetadataText[aria-label]')) {
    const views = parseViews(text.getAttribute('aria-label'));
    if (views !== undefined) return views;
  }
  return undefined;
}

function contentIdClass(host: Element | null): string | undefined {
  if (!host) return undefined;
  for (const c of host.classList) if (c.startsWith('content-id-')) return c.slice(11);
  return undefined;
}

const isShortsSurface = (surface: SurfaceId) => surface === 'shortsShelf';

/** The video a Tile element currently shows, or null. Cheap: used for reuse detection on every scan. */
export function tileVideoId(tile: Element, surface: SurfaceId): string | null {
  if (isShortsSurface(surface)) {
    const href = tile.querySelector('a.shortsLockupViewModelHostEndpoint[href^="/shorts/"]')?.getAttribute('href');
    const id = href?.slice(8, 19);
    return id && VIDEO_ID.test(id) ? id : null;
  }
  // Only the content-id class. The spec's field table also allows the thumbnail link's v parameter, but its skip
  // table skips lockups without content-id-* (podcasts, movies, playlists may link to /watch). Skipping is the safe
  // reading (REQ-SURF-2); a lockup without the class is skipped with a videoId markup warning.
  const fromClass = contentIdClass(tile.querySelector('.ytLockupViewModelHost'));
  return fromClass !== undefined && VIDEO_ID.test(fromClass) ? fromClass : null;
}

/** The Tile's title, or null. Shared by extract() and the markup self-test. */
export function tileTitle(tile: Element, surface: SurfaceId): string | null {
  if (isShortsSurface(surface)) {
    return tile.querySelector('h3.shortsLockupViewModelHostMetadataTitle a[title]')?.getAttribute('title')?.trim() || null;
  }
  const h3 = tile.querySelector('h3.ytLockupMetadataViewModelHeadingReset');
  const attr = (h3?.getAttribute('aria-label') || h3?.getAttribute('title'))?.trim();
  if (attr) return attr;
  return tile.querySelector('a.ytLockupMetadataViewModelTitle span.ytAttributedStringHost')?.textContent?.trim() || null;
}

/** The video ID of the page's own player (`ytd-watch-flexy[video-id]` or the `v` URL parameter). */
export function currentVideoId(doc: Document): string | null {
  return doc.querySelector('ytd-watch-flexy')?.getAttribute('video-id') || new URLSearchParams(doc.location?.search ?? '').get('v');
}

/**
 * REQ-SURF-3: the element shows the video that is playing, or sits in the playlist panel (the playing queue).
 * extract() skips these, and the gate and the NativeActionQueue check again, because the playing video can change
 * after extraction (watch-to-watch navigation keeps the same page element).
 */
export function isPlayingOrQueued(tile: Element, videoId: string, doc: Document): boolean {
  return videoId === currentVideoId(doc) || tile.closest('ytd-playlist-panel-renderer') !== null;
}

export function extract(tile: Element, surface: SurfaceId, doc: Document, warn?: MarkupWarning): TileFacts | null {
  // 1. Ads. Home ads hold a real lockup with a content-id, so check descendants first.
  if (tile.querySelector(AD_SELECTOR) || tile.closest('#player-ads')) return null;
  // 2. Type checks. Never act on anything inside the playlist panel (it lists the playing queue).
  if (tile.closest('ytd-playlist-panel-renderer')) return null;

  const shorts = isShortsSurface(surface);
  let durationSec: number | undefined;
  let isLive = false;
  if (!shorts) {
    const host = tile.querySelector('.ytLockupViewModelHost');
    // [unverified] A content-id that is not an 11-character video ID marks a playlist, podcast, movie or Mix collection.
    const cid = contentIdClass(host);
    if (cid !== undefined && !VIDEO_ID.test(cid)) return null;
    const href = tile.querySelector('a.ytLockupViewModelContentImage')?.getAttribute('href') ?? '';
    // Radio or Mix start (list=RD…, start_radio=1) and [unverified] any other list= link (playlists).
    if (/[?&](list=|start_radio=1)/.test(href)) return null;
    durationSec = parseDuration(tile.querySelector('yt-thumbnail-badge-view-model badge-shape .ytBadgeShapeText')?.textContent);
    isLive = tile.querySelector('badge-shape.ytBadgeShapeThumbnailLive') !== null;
    // Duration-less and not live: upcoming streams are pending a fixture, so they are skipped too.
    if (durationSec === undefined && !isLive) return null;
  }

  const videoId = tileVideoId(tile, surface);
  if (!videoId) {
    warn?.('videoId', surface);
    return null;
  }
  // 3. Never the currently playing video (REQ-SURF-3).
  if (videoId === currentVideoId(doc)) return null;

  const title = tileTitle(tile, surface);
  if (!title) {
    warn?.('title', surface);
    return null;
  }

  const facts: TileFacts = { videoId, surface, title, isShort: shorts, isLive, isUpcoming: false, isMembersOnly: false };
  if (durationSec !== undefined) facts.durationSec = durationSec;
  const viewCount = readViewCount(tile, shorts);
  if (viewCount !== undefined) facts.viewCount = viewCount;
  if (!shorts) readChannel(tile, facts);
  return facts;
}

// Home: the first metadata row links the channel. Watch sidebar: plain text, no link.
// Collaboration Tiles (yt-avatar-stack-view-model): plain-text names, take the first. [unverified] no fixture yet.
function readChannel(tile: Element, facts: TileFacts): void {
  const row = tile.querySelector('.ytContentMetadataViewModelMetadataRow');
  if (!row) return;
  const link = row.querySelector('a.ytAttributedStringLink');
  const name = (link ?? row.querySelector('.ytContentMetadataViewModelMetadataText'))?.textContent?.trim();
  if (name) facts.channelName = name;
  const href = link?.getAttribute('href') ?? '';
  if (href.startsWith('/@')) facts.channelHandle = safeDecode(href.slice(1).split(/[/?#]/)[0] ?? '');
  else if (href.startsWith('/channel/UC')) facts.channelId = href.slice(9).split(/[/?#]/)[0];
  if (hasArtistBadge(row)) facts.isArtistChannel = true;
}

// The music note of the Official Artist Channel badge icon. The Verified badge in the same place is a check mark.
export const ARTIST_ICON_SIGNATURE = 'L14.001 9.7v4.55a2.75 2.75 0 11-2-2.646';
// Localized badge labels, for an icon that has not rendered yet. Only the en-GB label is verified.
export const ARTIST_BADGE_LABELS = ['Official Artist Channel'];
// Labels of the Verified badge, which sits in the same place: an icon with one of them is never the Artist channel
// badge, rendered or not. Only the en-GB label is verified.
export const VERIFIED_BADGE_LABELS = ['Verified'];

/** The Artist channel badge beside the channel name (CONTEXT.md). Icon path first, so any language works. */
function hasArtistBadge(row: Element): boolean {
  for (const icon of row.querySelectorAll('.ytContentMetadataViewModelIcon')) {
    for (const p of icon.querySelectorAll('path[d]')) if (p.getAttribute('d')?.includes(ARTIST_ICON_SIGNATURE)) return true;
    if (ARTIST_BADGE_LABELS.includes(icon.getAttribute('aria-label')?.trim() ?? '')) return true;
  }
  return false;
}

/**
 * The channel row holds a badge icon that has not rendered yet (no `path[d]`) and whose label is in neither list
 * (another language, or none): it may be the Artist channel badge. The watcher reads such a Tile again until the icon
 * renders (docs/spec/youtube-integration.md Section 2). Same row as readChannel().
 */
export function channelBadgePending(tile: Element, surface: SurfaceId): boolean {
  if (isShortsSurface(surface)) return false;
  const row = tile.querySelector('.ytContentMetadataViewModelMetadataRow');
  if (!row) return false;
  for (const icon of row.querySelectorAll('.ytContentMetadataViewModelIcon')) {
    if (icon.querySelector('path[d]')) continue;
    const label = icon.getAttribute('aria-label')?.trim() ?? '';
    if (!ARTIST_BADGE_LABELS.includes(label) && !VERIFIED_BADGE_LABELS.includes(label)) return true;
  }
  return false;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
