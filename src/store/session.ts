// storage.session (memory only): OAuth flow state, recent Removal tabs, private-window Exceptions and
// counters. Source of truth: docs/spec/architecture.md Section 8 ("storage.session", "Private windows").
import type { Exception } from '~/core/types';
import { getOne, isRecord, type AreaLike } from './areas';
import { addCounters, getCounters, type DayCounters } from './local';

// OAuth (PKCE) ----------------------------------------------------------------------------------------

export interface OAuthSession {
  state: string;
  codeVerifier: string;
  startedAt: number;
}

const OAUTH_KEY = 'oauth';

export async function getOAuthSession(session: AreaLike): Promise<OAuthSession | undefined> {
  return getOne<OAuthSession>(session, OAUTH_KEY);
}

export async function setOAuthSession(session: AreaLike, value: OAuthSession): Promise<void> {
  await session.set({ [OAUTH_KEY]: value });
}

export async function clearOAuthSession(session: AreaLike): Promise<void> {
  await session.remove(OAUTH_KEY);
}

// Removal tabs, for undoFromActivity ---------------------------------------------------------------

export interface RemovalTab {
  tabId: number;
  at: number;
}
export type RemovalTabs = Record<string, RemovalTab>;

const REMOVAL_TABS_KEY = 'removalTabs';
export const REMOVAL_TAB_TTL_MS = 60 * 60 * 1000;

const fresh = (tabs: RemovalTabs, now: number): RemovalTabs =>
  Object.fromEntries(Object.entries(tabs).filter(([, t]) => now - t.at < REMOVAL_TAB_TTL_MS));

async function getRemovalTabs(session: AreaLike): Promise<RemovalTabs> {
  const raw = await getOne<unknown>(session, REMOVAL_TABS_KEY);
  return isRecord(raw) ? (raw as RemovalTabs) : {};
}

/** Remembers which tab removed a video. Entries older than 1 hour are dropped on every write. */
export async function recordRemovalTab(session: AreaLike, videoId: string, tabId: number, at: number): Promise<void> {
  const tabs = fresh(await getRemovalTabs(session), at);
  tabs[videoId] = { tabId, at };
  await session.set({ [REMOVAL_TABS_KEY]: tabs });
}

/** The tab that removed a video within the last hour, or undefined (`expired`). */
export async function getRemovalTab(session: AreaLike, videoId: string, now: number): Promise<RemovalTab | undefined> {
  return fresh(await getRemovalTabs(session), now)[videoId];
}

export async function forgetRemovalTab(session: AreaLike, videoId: string): Promise<void> {
  const tabs = await getRemovalTabs(session);
  if (!(videoId in tabs)) return;
  delete tabs[videoId];
  await session.set({ [REMOVAL_TABS_KEY]: tabs });
}

/** Drops every Removal of a closed tab. */
export async function forgetRemovalTabsOf(session: AreaLike, tabId: number): Promise<void> {
  const tabs = await getRemovalTabs(session);
  const next = Object.fromEntries(Object.entries(tabs).filter(([, t]) => t.tabId !== tabId));
  if (Object.keys(next).length !== Object.keys(tabs).length) await session.set({ [REMOVAL_TABS_KEY]: next });
}

// Private windows (REQ-ACTV-3) ------------------------------------------------------------------------

const privateExceptionsKey = (tabId: number) => `private:${tabId}:exceptions`;
const privateCountersKey = (day: string) => `private:counters:${day}`;

export async function getPrivateExceptions(session: AreaLike, tabId: number): Promise<Exception[]> {
  const raw = await getOne<unknown>(session, privateExceptionsKey(tabId));
  return isRecord(raw) ? (Object.values(raw) as Exception[]) : [];
}

export async function addPrivateException(session: AreaLike, tabId: number, x: Exception): Promise<void> {
  const raw = await getOne<unknown>(session, privateExceptionsKey(tabId));
  const all = isRecord(raw) ? { ...(raw as Record<string, Exception>) } : {};
  all[x.videoId] = x;
  await session.set({ [privateExceptionsKey(tabId)]: all });
}

export async function removePrivateException(session: AreaLike, tabId: number, videoId: string): Promise<void> {
  const raw = await getOne<unknown>(session, privateExceptionsKey(tabId));
  if (!isRecord(raw) || !(videoId in raw)) return;
  const all = { ...(raw as Record<string, Exception>) };
  delete all[videoId];
  await session.set({ [privateExceptionsKey(tabId)]: all });
}

/** Forgets a closed private tab's Exceptions. */
export async function clearPrivateTab(session: AreaLike, tabId: number): Promise<void> {
  await session.remove(privateExceptionsKey(tabId));
}

export async function getPrivateCounters(session: AreaLike, day: string): Promise<DayCounters> {
  return getCounters(session, day, privateCountersKey(day));
}

export async function bumpPrivateCounters(session: AreaLike, day: string, delta: Partial<DayCounters>): Promise<DayCounters> {
  const next = addCounters(await getPrivateCounters(session, day), delta);
  await session.set({ [privateCountersKey(day)]: next });
  return next;
}
