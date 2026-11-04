// Subscribed channels: reading YouTube's channel list page and matching Tiles against it. Source of truth:
// docs/spec/requirements.md REQ-RULE-14, docs/spec/youtube-integration.md Section 9.
import { channelIdentity, tileChannelIdentity } from './channel';
import type { TileFacts } from './types';

/** The user's Subscribed channels as channel keys, each list sorted: ids, handles (lowercase, no '@') and ChannelKeys of the names. */
export interface SubscribedChannels {
  ids: string[];
  handles: string[];
  keys: string[];
}

/** A list this old is no longer used, so a Rule that skips Subscribed channels holds Tiles instead. */
export const SUBSCRIPTIONS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const DATA_START = 'var ytInitialData = ';
const DATA_END = ';</script>';

/** The fields Shoo reads from a `channelRenderer`. Page data, so any of them may be missing or of another type. */
interface ChannelRenderer {
  channelId?: unknown;
  title?: { simpleText?: unknown; runs?: { text?: unknown }[] };
  navigationEndpoint?: { browseEndpoint?: { canonicalBaseUrl?: unknown } };
  subscriptionButton?: { subscribed?: unknown };
}

const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const sorted = (list: string[]): string[] => [...new Set(list)].sort();

function decodeHandle(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Reads the Subscribed channels from the HTML of youtube.com/feed/channels: every `channelRenderer` in
 * `ytInitialData` whose `subscriptionButton.subscribed` is true. Undefined when the page holds no
 * `ytInitialData` or no Subscribed channel at all (signed out, or the markup changed).
 */
export function parseSubscribedChannels(html: string): SubscribedChannels | undefined {
  const from = html.indexOf(DATA_START) + DATA_START.length;
  const end = html.indexOf(DATA_END, from);
  if (from < DATA_START.length || end < 0) return undefined;
  const ids: string[] = [];
  const handles: string[] = [];
  const keys: string[] = [];
  try {
    // The reviver sees every value once, so no walk over the parsed page is needed.
    JSON.parse(html.slice(from, end), (key, r: ChannelRenderer | null) => {
      if (key !== 'channelRenderer' || r?.subscriptionButton?.subscribed !== true) return r;
      const base = text(r.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl);
      const name = text(r.title?.simpleText ?? r.title?.runs?.[0]?.text);
      const channel = channelIdentity(name, base?.startsWith('/@') ? decodeHandle(base.slice(2)) : undefined, text(r.channelId));
      if (channel?.id) ids.push(channel.id);
      if (channel?.handle) handles.push(channel.handle);
      if (channel?.key) keys.push(channel.key);
      return r;
    });
  } catch {
    return undefined;
  }
  if (ids.length + handles.length + keys.length === 0) return undefined;
  // Sorted, so the same channels give the same list whatever order the page lists them in.
  return { ids: sorted(ids), handles: sorted(handles), keys: sorted(keys) };
}

/**
 * Tells whether a Tile is from a Subscribed channel. Any one of its channel id, handle or ChannelKey in the
 * list is enough, so two channels with the same name both count. A Tile that shows no channel never matches,
 * and neither does a Tile from another Site, because the list is the user's YouTube subscriptions.
 */
export function subscribedMatcher(list: SubscribedChannels): (t: TileFacts) => boolean {
  const ids = new Set(list.ids);
  const handles = new Set(list.handles);
  const keys = new Set(list.keys);
  return (t) => {
    const tile = tileChannelIdentity(t);
    if (tile?.site !== 'youtube') return false;
    return (
      (tile.id !== undefined && ids.has(tile.id)) ||
      (tile.handle !== undefined && handles.has(tile.handle)) ||
      (tile.key !== undefined && keys.has(tile.key))
    );
  };
}
