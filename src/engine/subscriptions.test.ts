import { describe, expect, it } from 'vitest';
import type { StoredSubscriptions } from '~/store/local';
import { createSubscriptions, SUBSCRIPTIONS_REFRESH_MS, SUBSCRIPTIONS_RETRY_MS, SUBSCRIPTIONS_URL } from './subscriptions';
import { scriptedFetch, type Scripted } from './testing';

// Synthetic /feed/channels pages with one subscribed channel each, not captured from YouTube.
const page = (handle: string): Scripted => {
  const data = { items: [{ channelRenderer: { channelId: `UC${handle.padEnd(22, 'x')}`, title: { simpleText: handle }, navigationEndpoint: { browseEndpoint: { canonicalBaseUrl: `/@${handle}` } }, subscriptionButton: { subscribed: true } } }] };
  return { status: 200, headers: { 'content-type': 'text/html' }, bytes: new TextEncoder().encode(`<script>var ytInitialData = ${JSON.stringify(data)};</script>`) };
};
const SIGNED_OUT: Scripted = { status: 200, headers: { 'content-type': 'text/html' }, bytes: new TextEncoder().encode('<html>Sign in to see your subscriptions</html>') };

function setup(script: Scripted[], stored?: StoredSubscriptions) {
  const { fetch, requests } = scriptedFetch({ [SUBSCRIPTIONS_URL]: script });
  const t = { now: 1_000_000, stored, changed: 0 };
  const subs = createSubscriptions({
    fetch,
    now: () => t.now,
    get: async () => t.stored,
    set: async (v) => void (t.stored = v),
    onChanged: () => void t.changed++,
  });
  return { subs, requests, t };
}

describe('createSubscriptions', () => {
  it('waits for the first read, sends the YouTube cookies and tells the tabs', async () => {
    const { subs, requests, t } = setup([page('first')]);
    expect(await subs.current({ mayRead: true })).toMatchObject({ handles: ['first'] });
    expect(requests.map((r) => r.init?.credentials)).toEqual(['include']);
    expect(t.stored).toMatchObject({ list: { handles: ['first'], readAt: 1_000_000 }, failures: 0 });
    expect(t.changed).toBe(1);
  });

  it('reads at most once a day, answering from the stored list meanwhile', async () => {
    const { subs, requests, t } = setup([page('first'), page('first'), page('second')]);
    await subs.current({ mayRead: true });
    t.now += SUBSCRIPTIONS_REFRESH_MS - 1;
    await subs.current({ mayRead: true });
    expect(requests).toHaveLength(1);

    t.now += 1;
    expect(await subs.current({ mayRead: true })).toMatchObject({ handles: ['first'] });
    await new Promise((r) => setTimeout(r, 0));
    expect(requests).toHaveLength(2);
    expect(t.changed).toBe(1); // the same list again tells nobody

    t.now += SUBSCRIPTIONS_REFRESH_MS;
    await subs.current({ mayRead: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(t.stored?.list?.handles).toEqual(['second']);
    expect(t.changed).toBe(2);
  });

  it('backs off after a failed read and never reads for a private window', async () => {
    const { subs, requests, t } = setup([SIGNED_OUT, SIGNED_OUT, page('first')]);
    expect(await subs.current({ mayRead: true })).toBeUndefined();
    expect(t.stored).toMatchObject({ failures: 1 });
    expect(t.stored).not.toHaveProperty('list');

    t.now += SUBSCRIPTIONS_RETRY_MS - 1;
    expect(await subs.current({ mayRead: true })).toBeUndefined();
    expect(requests).toHaveLength(1);

    t.now += 1;
    await subs.current({ mayRead: true });
    expect(t.stored).toMatchObject({ failures: 2 });
    t.now += SUBSCRIPTIONS_RETRY_MS; // the second wait is twice as long
    expect(await subs.current({ mayRead: false })).toBeUndefined();
    await subs.current({ mayRead: true });
    expect(requests).toHaveLength(2);

    t.now += SUBSCRIPTIONS_RETRY_MS;
    expect(await subs.current({ mayRead: true })).toMatchObject({ handles: ['first'] });
    expect(t.stored).toMatchObject({ failures: 0 });
  });
});
