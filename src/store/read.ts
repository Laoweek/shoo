// Read-only helpers for extension pages, and readEnabled() for the content script. Pages never write
// (every mutation is a message to the background, docs/spec/architecture.md Section 8 "Writers").
//
// Key isolation: this file never touches the stored API keys. Pages learn about the key through messages:
// `getRuntimeState` (reason `noKey`, detail `keyRejected`) and `getKeyUsage` (label, source, connectedAt),
// which the background answers from store/secret.ts without the key value.
import { bannedRuleFor, dayKey, ESCALATION_WINDOW_DAYS, escalationKey, escalationStatus, isProtected, recordIdentity } from '~/core/escalation';
import { sortByRef } from '~/core/rules';
import { videoSite } from '~/core/sites';
import type { ActivityEvent, Exception, Rule, Settings, SiteId } from '~/core/types';
import { browserAreas, getOne, type AreaLike, type Areas } from './areas';
import {
  getArchive,
  getArchiveSummary,
  getCounters,
  getEscalation,
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

/** How many Exceptions there are, without reading the archive. */
export async function readExceptionCount(a?: Partial<ReadAreas>): Promise<number> {
  const { sync, local } = areasOrBrowser(a);
  const synced = await readSync(sync);
  // The writer keeps the archive free of synced Exceptions, so the two add up.
  return synced.exceptions.size + (await getArchiveSummary(local, synced.meta.excEpoch)).count;
}

export const readActivity = (q: ActivityQuery = {}, a?: Partial<ReadAreas>): Promise<ActivityEvent[]> => queryActivity(areasOrBrowser(a).local, q);
/** Counters for one local day ('YYYY-MM-DD'). Private-window counts stay in the background's session storage. */
export const readCounters = (day: string, a?: Partial<ReadAreas>): Promise<DayCounters> => getCounters(areasOrBrowser(a).local, day);
export const readRuleStats = (a?: Partial<ReadAreas>): Promise<RuleStats> => getRuleStats(areasOrBrowser(a).local);
export const readSubscriptions = (a?: Partial<ReadAreas>): Promise<StoredSubscriptions | undefined> => getSubscriptions(areasOrBrowser(a).local);

/** A channel ban waiting on the user's Ban or Not now (REQ-ESC-2). */
export interface EscalationSuggestion {
  channelKey: string;
  channelName: string;
  removed: number;
  judged: number;
  /** The Rule behind most of the channel's Topic removals, when it still exists. */
  ruleId?: string;
}

/**
 * The Escalation suggestions to show, most removed first: channels the background marked as suggested that still
 * qualify and have no Banned channel. Off shows none. Automatic still shows the ones made before the switch.
 */
export async function readEscalations(now = Date.now(), a?: Partial<ReadAreas>): Promise<EscalationSuggestion[]> {
  const { local } = areasOrBrowser(a);
  if ((await getSettings(local)).escalationMode === 'off') return [];
  const store = await getEscalation(local, now, (_, meta) => meta.suggestedAt !== undefined);
  if (Object.keys(store).length === 0) return [];
  const [rules, exceptions] = await Promise.all([readRules(a), readExceptions(a)]);
  const out: EscalationSuggestion[] = [];
  for (const [key, rec] of Object.entries(store)) {
    const identity = recordIdentity(key, rec);
    if (bannedRuleFor(rules, identity)) continue;
    const status = escalationStatus(rec, now, isProtected(identity, rules, exceptions));
    if (!status.qualifies) continue;
    out.push({ channelKey: key, channelName: rec.name ?? key, removed: status.removed, judged: status.judged });
  }
  if (out.length > 0) {
    const top = await topRuleByChannel(local, rules, now);
    for (const e of out) {
      const ruleId = top.get(e.channelKey);
      if (ruleId) e.ruleId = ruleId;
    }
  }
  return out.sort((x, y) => y.removed - x.removed || x.channelKey.localeCompare(y.channelKey));
}

/**
 * Per Escalation key, the Rule behind most of the channel's Topic removals (Activity `removed` events with source
 * 'model') in the Escalation window, so a suggestion can say "4 of 6 removed by R2". Ties go to the Rule used most
 * recently. No entry when the Removals carry no Rule or that Rule was deleted since.
 */
async function topRuleByChannel(local: AreaLike, rules: Rule[], now: number): Promise<Map<string, string>> {
  const start = new Date(now);
  start.setDate(start.getDate() - (ESCALATION_WINDOW_DAYS - 1));
  const liveIds = new Set(rules.map((r) => r.id));
  const events = await queryActivity(local, { kinds: ['removed'], fromDay: dayKey(start.getTime()) });
  const counts = new Map<string, Map<string, number>>();
  for (const e of events) {
    if (e.source !== 'model' || !e.channelKey || !e.ruleId) continue;
    const key = escalationKey(e.channelKey, (e.videoId && videoSite(e.videoId)) || 'youtube');
    const perRule = counts.get(key) ?? new Map<string, number>();
    perRule.set(e.ruleId, (perRule.get(e.ruleId) ?? 0) + 1);
    counts.set(key, perRule);
  }
  const out = new Map<string, string>();
  // Events come newest first and Map keeps insertion order, so `>` keeps the most recent Rule on a tie.
  for (const [key, perRule] of counts) {
    let best: [string, number] | undefined;
    for (const entry of perRule) if (!best || entry[1] > best[1]) best = entry;
    if (liveIds.has(best![0])) out.set(key, best![0]);
  }
  return out;
}

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
  const offLocal = watch(local, (k) => k.startsWith('exceptions:'), cb);
  return () => (offSync(), offLocal());
}
export const watchActivity = (cb: () => void, a?: Partial<ReadAreas>) => watch(areasOrBrowser(a).local, (k) => k.startsWith('activity:'), cb);
export const watchCounters = (cb: () => void, a?: Partial<ReadAreas>) => watch(areasOrBrowser(a).local, (k) => k.startsWith('counters:'), cb);
export const watchRuleStats = (cb: () => void, a?: Partial<ReadAreas>) => watch(areasOrBrowser(a).local, (k) => k === 'ruleStats', cb);
export const watchEscalation = (cb: () => void, a?: Partial<ReadAreas>) => watch(areasOrBrowser(a).local, (k) => k === 'escalation', cb);
export const watchSubscriptions = (cb: () => void, a?: Partial<ReadAreas>) => watch(areasOrBrowser(a).local, (k) => k === SUBSCRIPTIONS_KEY, cb);
export const watchRuntime = (cb: () => void, a?: Partial<ReadAreas>) => watch(areasOrBrowser(a).local, (k) => k === 'runtime', cb);
