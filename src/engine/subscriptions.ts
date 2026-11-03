// Reading the user's Subscribed channels from youtube.com (background only). Source of truth:
// docs/spec/requirements.md REQ-RULE-14, docs/spec/youtube-integration.md Section 9.
import { parseSubscribedChannels, SUBSCRIPTIONS_MAX_AGE_MS, type SubscribedChannels } from '~/core/subscriptions';
import type { StoredSubscriptions } from '~/store/local';
import { fetchWithTimeout, type FetchLike } from './net';

export const SUBSCRIPTIONS_URL = 'https://www.youtube.com/feed/channels';
const HOUR_MS = 60 * 60 * 1000;
/** A list this old is read again. */
export const SUBSCRIPTIONS_REFRESH_MS = 24 * HOUR_MS;
/** Wait after a failed read, doubled for each failure in a row, at most SUBSCRIPTIONS_REFRESH_MS. */
export const SUBSCRIPTIONS_RETRY_MS = HOUR_MS;
/** The page is about 11 MB for 1,000 channels. Under the 30 s a service worker fetch may wait. */
export const SUBSCRIPTIONS_TIMEOUT_MS = 20_000;

/**
 * GET /feed/channels with the user's YouTube cookies. Undefined on any failure: network, timeout, a
 * redirect (signed out), a non-200 status, or a page without Subscribed channels.
 */
export async function fetchSubscribedChannels(fetchFn: FetchLike): Promise<SubscribedChannels | undefined> {
  try {
    const { res, value } = await fetchWithTimeout(fetchFn, SUBSCRIPTIONS_URL, { credentials: 'include' }, SUBSCRIPTIONS_TIMEOUT_MS, (r) => r.text());
    return res.ok ? parseSubscribedChannels(value) : undefined;
  } catch {
    return undefined;
  }
}

export interface SubscriptionsDeps {
  fetch: FetchLike;
  now(): number;
  /** `local:subscriptions`. */
  get(): Promise<StoredSubscriptions | undefined>;
  set(value: StoredSubscriptions): Promise<void>;
  /** A read found a different list: open tabs must judge their Tiles again. */
  onChanged(): void;
}

export interface Subscriptions {
  /**
   * The list to judge with, or undefined when none is usable. With `mayRead`, starts a read when one is due:
   * no list yet, a list 24 h old, or a failed read whose back-off has passed. It waits for that read only
   * when no list is usable, and otherwise answers with the stored list at once.
   */
  current(opts: { mayRead: boolean }): Promise<SubscribedChannels | undefined>;
}

const listKey = (c: SubscribedChannels | undefined): string => (c ? JSON.stringify([c.ids, c.handles, c.keys]) : '');

export function createSubscriptions(deps: SubscriptionsDeps): Subscriptions {
  let reading: Promise<SubscribedChannels | undefined> | undefined;

  const usable = (s: StoredSubscriptions | undefined, now: number): SubscribedChannels | undefined =>
    s?.list && now - s.list.readAt < SUBSCRIPTIONS_MAX_AGE_MS ? s.list : undefined;

  const waitAfter = (failures: number): number =>
    failures > 0 ? Math.min(SUBSCRIPTIONS_REFRESH_MS, SUBSCRIPTIONS_RETRY_MS * 2 ** (failures - 1)) : SUBSCRIPTIONS_REFRESH_MS;

  // A read stamps `triedAt` whether it worked or not, so one clock covers the refresh and the back-off.
  const due = (s: StoredSubscriptions | undefined, now: number): boolean => !s || now - s.triedAt >= waitAfter(s.failures);

  async function read(prev: StoredSubscriptions | undefined): Promise<SubscribedChannels | undefined> {
    const at = deps.now();
    const channels = await fetchSubscribedChannels(deps.fetch);
    if (!channels) {
      await deps.set({ ...(prev?.list && { list: prev.list }), triedAt: at, failures: (prev?.failures ?? 0) + 1 });
      return usable(prev, at);
    }
    await deps.set({ list: { ...channels, readAt: at }, triedAt: at, failures: 0 });
    if (listKey(prev?.list) !== listKey(channels)) deps.onChanged();
    return channels;
  }

  return {
    async current({ mayRead }) {
      const stored = await deps.get();
      const now = deps.now();
      const list = usable(stored, now);
      if (!mayRead || !due(stored, now)) return list;
      const pending = (reading ??= read(stored).finally(() => {
        reading = undefined;
      }));
      if (!list) return pending;
      pending.catch(() => undefined);
      return list;
    },
  };
}
