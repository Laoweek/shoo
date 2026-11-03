import { describe, expect, it } from 'vitest';
import {
  addPrivateException,
  bumpPrivateCounters,
  clearOAuthSession,
  clearPrivateTab,
  forgetRemovalTabsOf,
  getOAuthSession,
  getPrivateCounters,
  getPrivateExceptions,
  getRemovalTab,
  recordRemovalTab,
  removePrivateException,
  setOAuthSession,
} from './session';
import { createMemoryArea } from './testing/quota-storage';

const HOUR = 60 * 60 * 1000;

describe('session storage', () => {
  it('holds the PKCE state during a Connect flow', async () => {
    const session = createMemoryArea();
    await setOAuthSession(session, { state: 's', codeVerifier: 'v', startedAt: 1 });
    expect(await getOAuthSession(session)).toEqual({ state: 's', codeVerifier: 'v', startedAt: 1 });
    await clearOAuthSession(session);
    expect(await getOAuthSession(session)).toBeUndefined();
  });

  it('maps recent Removals to their tab for one hour', async () => {
    const session = createMemoryArea();
    await recordRemovalTab(session, 'v1', 3, 0);
    await recordRemovalTab(session, 'v2', 4, HOUR / 2);
    expect(await getRemovalTab(session, 'v1', HOUR - 1)).toEqual({ tabId: 3, at: 0 });
    expect(await getRemovalTab(session, 'v1', HOUR)).toBeUndefined();
    await recordRemovalTab(session, 'v3', 4, HOUR + 1); // prunes v1
    expect(Object.keys((await session.get('removalTabs')).removalTabs as object)).toEqual(['v2', 'v3']);
    await forgetRemovalTabsOf(session, 4);
    expect(await getRemovalTab(session, 'v2', HOUR)).toBeUndefined();
  });

  it('keeps private-window Exceptions per tab and counters per day', async () => {
    const session = createMemoryArea();
    await addPrivateException(session, 7, { videoId: 'v1', title: 't', at: 1 });
    await addPrivateException(session, 8, { videoId: 'v2', title: 't', at: 1 });
    expect((await getPrivateExceptions(session, 7)).map((x) => x.videoId)).toEqual(['v1']);
    await removePrivateException(session, 7, 'v1');
    expect(await getPrivateExceptions(session, 7)).toEqual([]);
    await clearPrivateTab(session, 8);
    expect(await getPrivateExceptions(session, 8)).toEqual([]);

    await bumpPrivateCounters(session, '2026-10-10', { judged: 16 });
    await bumpPrivateCounters(session, '2026-10-10', { judged: 4, removed: 1 });
    expect(await getPrivateCounters(session, '2026-10-10')).toEqual({ judged: 20, removed: 1, requests: 0, costUsd: 0 });
    expect(Object.keys(await session.get(null))).toEqual(['private:7:exceptions', 'private:counters:2026-10-10']);
  });
});
