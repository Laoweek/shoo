// Read-only helpers for extension pages, and readEnabled() for the content script. Pages never write
// (every mutation is a message to the background, docs/spec/architecture.md Section 8 "Writers").
//
// Key isolation: this file never touches the stored API keys. Pages learn about the key through messages:
// `getRuntimeState` (reason `noKey`, detail `keyRejected`) and `getKeyUsage` (label, source, connectedAt),
// which the background answers from store/secret.ts without the key value.
import { sortByRef } from '~/core/rules';
import type { ActivityEvent, Exception, Rule, Settings, SiteId } from '~/core/types';
import { browserAreas, getOne, type AreaLike, type Areas } from './areas';
import {
  getArchive,
  getCounters,
  getRuleStats,
  getSettings,
  getSubscriptions,
  queryActivity,
  type ActivityQuery,
  type DayCounters,
  type RuleStats,
  type StoredSubscriptions,
  SUBSCRIPTIONS_KEY,
} from './local';
import { SETTINGS_KEY } from './schema';
import { readSync } from './sync';

type ReadAreas = Pick<Areas, 'sync' | 'local'>;
/** Tests pass fake areas. Pages use the real ones. */
const areasOrBrowser = (a?: Partial<ReadAreas>): ReadAreas => ({ sync: a?.sync ?? browserAreas().sync, local: a?.local ?? browserAreas().local });

/**
 * Content script start-up: one `storage.local.get('settings')`. Whether Shoo is on, and on for this Site.
 * Missing settings, or settings from before Sites, mean on (the defaults).
 */
export async function readEnabled(site: SiteId, local?: AreaLike): Promise<boolean> {
  const settings = await getOne<Partial<Settings>>(local ?? browserAreas().local, SETTINGS_KEY);
  return (settings?.enabled ?? true) && settings?.sites?.[site] !== false;
}

export const readSettings = (a?: Partial<ReadAreas>): Promise<Settings> => getSettings(areasOrBrowser(a).local);

/** Live Rules from every sync bucket, sorted by ref (K before R). */
export async function readRules(a?: Partial<ReadAreas>): Promise<Rule[]> {
  const { rules } = await readSync(areasOrBrowser(a).sync);
  return sortByRef([...rules.values()].filter((r) => r.deletedAt === undefined));
}

/** Synced and archived Exceptions, newest first. */
export async function readExceptions(a?: Partial<ReadAreas>): Promise<Exception[]> {
  const { sync, local } = areasOrBrowser(a);
  const merged = new Map<string, Exception>();
  const synced = await readSync(sync);
  for (const x of [...(await getArchive(local, synced.meta.excEpoch)), ...synced.exceptions.values()]) {
    const prev = merged.get(x.videoId);
    if (!prev || x.at >= prev.at) merged.set(x.videoId, x);
  }
  return [...merged.values()].sort((x, y) => y.at - x.at);
}

export const readActivity = (q: ActivityQuery = {}, a?: Partial<ReadAreas>): Promise<ActivityEvent[]> => queryActivity(areasOrBrowser(a).local, q);
/** Counters for one local day ('YYYY-MM-DD'). Private-window counts stay in the background's session storage. */
export const readCounters = (day: string, a?: Partial<ReadAreas>): Promise<DayCounters> => getCounters(areasOrBrowser(a).local, day);
export const readRuleStats = (a?: Partial<ReadAreas>): Promise<RuleStats> => getRuleStats(areasOrBrowser(a).local);
export const readSubscriptions = (a?: Partial<ReadAreas>): Promise<StoredSubscriptions | undefined> => getSubscriptions(areasOrBrowser(a).local);

// Watchers. Each returns an unsubscribe function. Pages re-read on change.

function watch(area: AreaLike, match: (key: string) => boolean, cb: () => void): () => void {
  const listener = (changes: Record<string, unknown>) => {
    if (Object.keys(changes).some(match)) cb();
  };
  area.onChanged.addListener(listener);
  return () => area.onChanged.removeListener(listener);
}

export const watchSettings = (cb: () => void, a?: Partial<ReadAreas>) => watch(areasOrBrowser(a).local, (k) => k === SETTINGS_KEY, cb);
export const watchRules = (cb: () => void, a?: Partial<ReadAreas>) => watch(areasOrBrowser(a).sync, (k) => k.startsWith('rules:'), cb);
export function watchExceptions(cb: () => void, a?: Partial<ReadAreas>): () => void {
  const { sync, local } = areasOrBrowser(a);
  const offSync = watch(sync, (k) => k.startsWith('exc:'), cb);
  const offLocal = watch(local, (k) => k.startsWith('exceptions:archive:'), cb);
  return () => (offSync(), offLocal());
}
export const watchActivity = (cb: () => void, a?: Partial<ReadAreas>) => watch(areasOrBrowser(a).local, (k) => k.startsWith('activity:'), cb);
export const watchCounters = (cb: () => void, a?: Partial<ReadAreas>) => watch(areasOrBrowser(a).local, (k) => k.startsWith('counters:'), cb);
export const watchRuleStats = (cb: () => void, a?: Partial<ReadAreas>) => watch(areasOrBrowser(a).local, (k) => k === 'ruleStats', cb);
export const watchEscalation = (cb: () => void, a?: Partial<ReadAreas>) => watch(areasOrBrowser(a).local, (k) => k === 'escalation', cb);
export const watchSubscriptions = (cb: () => void, a?: Partial<ReadAreas>) => watch(areasOrBrowser(a).local, (k) => k === SUBSCRIPTIONS_KEY, cb);
export const watchRuntime = (cb: () => void, a?: Partial<ReadAreas>) => watch(areasOrBrowser(a).local, (k) => k === 'runtime', cb);
