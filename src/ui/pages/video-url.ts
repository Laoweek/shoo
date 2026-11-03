// Try a title: the optional URL is parsed on the device into a video ID (docs/spec/decision-engine.md
// Section 7.5). Accepted: youtube.com/watch?v=<id>, youtu.be/<id>, youtube.com/shorts/<id> and
// i.ytimg.com/vi/<id>/... Anything else is rejected in the form. Only the derived i.ytimg.com
// thumbnail URL is sent to the background, never the text the user typed.

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com']);

/** The 11-character video ID, or null when the text is not one of the four accepted forms. */
export function parseVideoId(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  let id: string | null | undefined;
  if (YOUTUBE_HOSTS.has(host)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else if (parts[0] === 'shorts' && parts.length === 2) id = parts[1];
  } else if (host === 'youtu.be') {
    if (parts.length === 1) id = parts[0];
  } else if (host === 'i.ytimg.com') {
    if (parts[0] === 'vi' && parts.length >= 3) id = parts[1];
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

/** The only image URL Try a title ever sends (decision-engine.md Section 7.5). */
export const tryThumbnailUrl = (videoId: string): string => `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
