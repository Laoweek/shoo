// Thumbnail fetcher for the thumbnail pass and Try a title. Source of truth: docs/spec/decision-engine.md
// Sections 4 and 7.5, docs/spec/architecture.md Section 13. The image is never stored.
import { fetchWithTimeout, THUMBNAIL_TIMEOUT_MS, type FetchLike } from './net';

export const THUMBNAIL_MAX_BYTES = 100 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/webp'];
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export const isVideoId = (id: string): boolean => VIDEO_ID_RE.test(id);

/** The only URL a thumbnail is ever fetched from. */
export function thumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

/**
 * Fetches mqdefault for a video as a base64 data URL. Cookies are never sent. Undefined on any failure:
 * bad id, timeout (4 s), non-200, a type other than JPEG or WebP, or 100 KB or more. The caller keeps the Tile.
 */
export async function fetchThumbnail(fetchFn: FetchLike, videoId: string, timeoutMs = THUMBNAIL_TIMEOUT_MS): Promise<string | undefined> {
  if (!isVideoId(videoId)) return undefined;
  try {
    const { res, value } = await fetchWithTimeout(fetchFn, thumbnailUrl(videoId), { credentials: 'omit' }, timeoutMs, async (r) => {
      // Check type and declared size before reading the body.
      const type = (r.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      const declared = Number(r.headers.get('content-length'));
      if (!r.ok || !ACCEPTED_TYPES.includes(type) || (Number.isFinite(declared) && declared >= THUMBNAIL_MAX_BYTES)) return undefined;
      return { type, bytes: new Uint8Array(await r.arrayBuffer()) };
    });
    if (!res.ok || !value) return undefined;
    const { type, bytes } = value;
    if (bytes.length === 0 || bytes.length >= THUMBNAIL_MAX_BYTES) return undefined;
    return `data:${type};base64,${toBase64(bytes)}`;
  } catch {
    return undefined;
  }
}

/**
 * Try a title (§7.5): accepts only youtube.com/watch?v=<id>, youtu.be/<id>, youtube.com/shorts/<id> or
 * i.ytimg.com/vi/<id>/… (or vi_webp), and returns the 11-character video ID. Anything else is undefined.
 */
export function parseThumbnailInput(input: string): string | undefined {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  let id: string | undefined;
  if (host === 'youtu.be') id = parts[0];
  else if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') {
    if (parts[0] === 'watch' && parts.length === 1) id = url.searchParams.get('v') ?? undefined;
    else if (parts[0] === 'shorts') id = parts[1];
  } else if (host === 'i.ytimg.com' && (parts[0] === 'vi' || parts[0] === 'vi_webp')) id = parts[1];
  return id !== undefined && isVideoId(id) ? id : undefined;
}
