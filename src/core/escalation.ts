// Escalation counting. Source of truth: docs/spec/requirements.md §9, docs/spec/architecture.md
// Section 5 ("Counting") and Section 8 (`local:escalation`).
import { channelIdentity, channelsMatch, ruleChannelIdentity, type ChannelIdentity } from './channel';
import { isBannedChannel } from './rules';
import { videoSite, type SiteId } from './sites';
import type { Exception, Rule } from './types';

/** One channel's counts in `local:escalation`, keyed by ChannelKey. Days are local 'YYYY-MM-DD'. */
export interface EscalationRecord {
  judged: Record<string, string[]>; // videoIds judged per day, each once per day
  topicRemoved: Record<string, number>; // Removals by Topic rules per day
  suggestedAt?: number;
  dismissedAt?: number;
  removalsAtDismiss?: number; // totalTopicRemovals(record) when the user chose "Not now"
  name?: string;
  handle?: string;
  id?: string;
  /** The Site of the channel's first Topic removal: a ban from it matches that Site only. */
  site?: SiteId;
}

export const ESCALATION_WINDOW_DAYS = 30;
export const ESCALATION_MIN_REMOVALS = 3;
export const ESCALATION_MIN_SHARE = 0.5;
export const RESUGGEST_AFTER_REMOVALS = 3;

/**
 * The `local:escalation` key of a channel on a Site: its ChannelKey, with the Site in front except on YouTube, whose
 * keys predate Sites. A same-named channel on each Site is counted, protected and banned apart (REQ-SITE-2).
 */
export function escalationKey(channelKey: string, site: SiteId): string {
  return site === 'youtube' || !channelKey ? channelKey : `${site}:${channelKey}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar date of a timestamp as 'YYYY-MM-DD'. */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** First day inside the window: today and the 29 local days before it. */
function windowStart(now: number): string {
  const d = new Date(now);
  d.setDate(d.getDate() - (ESCALATION_WINDOW_DAYS - 1));
  return dayKey(d.getTime());
}

/** A channel's Topic removal counts, with or without its judged videos (store/local.ts keeps those apart). */
type Removals = Pick<EscalationRecord, 'topicRemoved'>;

/** Counts one Removal by a Topic rule. Returns a new record. */
export function recordTopicRemoval<T extends Removals>(rec: T, day: string): T {
  return { ...rec, topicRemoved: { ...rec.topicRemoved, [day]: (rec.topicRemoved[day] ?? 0) + 1 } };
}

export function totalTopicRemovals(rec: Removals): number {
  return Object.values(rec.topicRemoved).reduce((sum, n) => sum + n, 0);
}

/** "Not now": suppresses the suggestion until RESUGGEST_AFTER_REMOVALS more Topic removals. */
export function dismissEscalation<T extends Removals>(rec: T, now: number): T {
  return { ...rec, dismissedAt: now, removalsAtDismiss: totalTopicRemovals(rec) };
}

/**
 * Whether the channel qualifies for Escalation now (REQ-ESC-1 to 3). Within the last 30 local days
 * (today included): at least 3 Topic removals and removals ≥ 50% of distinct judged videos. A protected
 * channel (any Keep rule or Exception for it) never qualifies. After "Not now" the channel is suppressed
 * until 3 more Topic removals than at dismissal.
 */
export function escalationStatus(
  rec: EscalationRecord,
  now: number,
  protectedChannel: boolean,
): { qualifies: boolean; removed: number; judged: number; suppressed: boolean } {
  const start = windowStart(now);
  let removed = 0;
  for (const [day, n] of Object.entries(rec.topicRemoved)) if (day >= start) removed += n;
  const videos = new Set<string>();
  for (const [day, ids] of Object.entries(rec.judged)) if (day >= start) ids.forEach((id) => videos.add(id));
  const judged = videos.size;

  const suppressed =
    rec.dismissedAt !== undefined &&
    totalTopicRemovals(rec) - (rec.removalsAtDismiss ?? 0) < RESUGGEST_AFTER_REMOVALS;
  const meets = removed >= ESCALATION_MIN_REMOVALS && judged > 0 && removed >= judged * ESCALATION_MIN_SHARE;
  return { qualifies: meets && !protectedChannel && !suppressed, removed, judged, suppressed };
}

/**
 * Drops days older than the 30-day window. Removals dropped this way are subtracted from
 * `removalsAtDismiss` so the re-suggest count stays correct. Returns a new record.
 */
export function pruneEscalation(rec: EscalationRecord, now: number): EscalationRecord {
  const start = windowStart(now);
  const judged = Object.fromEntries(Object.entries(rec.judged).filter(([day]) => day >= start));
  const topicRemoved = Object.fromEntries(Object.entries(rec.topicRemoved).filter(([day]) => day >= start));
  const out: EscalationRecord = { ...rec, judged, topicRemoved };
  if (rec.removalsAtDismiss !== undefined) {
    const dropped = totalTopicRemovals(rec) - totalTopicRemovals(out);
    out.removalsAtDismiss = Math.max(0, rec.removalsAtDismiss - dropped);
  }
  return out;
}

/** What a channel's record says about the channel itself. */
type ChannelFields = Pick<EscalationRecord, 'name' | 'handle' | 'id' | 'site'>;

/** A record stored before Sites has no Site and is YouTube's, as its key without a Site prefix says. */
export const recordSite = (rec: ChannelFields): SiteId => rec.site ?? 'youtube';

export const recordIdentity = (key: string, rec: ChannelFields): ChannelIdentity => {
  const identity = channelIdentity(rec.name ?? key, rec.handle, rec.id) ?? { key };
  return { ...identity, site: recordSite(rec) };
};

const live = (rules: Rule[]) => rules.filter((r) => r.deletedAt === undefined);

export function bannedRuleFor(rules: Rule[], identity: ChannelIdentity): Rule | undefined {
  return live(rules).find((r) => isBannedChannel(r) && channelsMatch(ruleChannelIdentity(r) ?? {}, identity));
}

export function keepRuleFor(rules: Rule[], identity: ChannelIdentity): Rule | undefined {
  return live(rules).find((r) => r.kind === 'channel' && r.polarity === 'keep' && channelsMatch(ruleChannelIdentity(r) ?? {}, identity));
}

/** REQ-ESC-3: any Keep rule for the channel (enabled or not) or any Exception with its ChannelKey, on the channel's Site. */
export function isProtected(identity: ChannelIdentity, rules: Rule[], exceptions: Exception[]): boolean {
  const kept = (x: Exception) => x.channelKey === identity.key && (!identity.site || videoSite(x.videoId) === identity.site);
  return keepRuleFor(rules, identity) !== undefined || exceptions.some(kept);
}
