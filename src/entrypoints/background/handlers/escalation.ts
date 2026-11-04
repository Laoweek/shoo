// Escalation: Topic removal counts, suggest and automatic Banned channels, Not now. Source of truth:
// docs/spec/requirements.md §9, docs/spec/architecture.md Sections 5 ("Counting") and 10 (ChannelKey).
import { channelIdentity, channelKey, channelsMatch, ruleChannelIdentity, type ChannelIdentity } from '~/core/channel';
import {
  dayKey,
  dismissEscalation,
  emptyEscalation,
  ESCALATION_WINDOW_DAYS,
  escalationKey,
  escalationStatus,
  recordTopicRemoval,
  type EscalationRecord,
} from '~/core/escalation';
import { newId } from '~/core/ids';
import { isBannedChannel } from '~/core/rules';
import { videoSite } from '~/core/sites';
import type { Exception, Rule, RuleOp, SiteId } from '~/core/types';
import type { EscalationSuggestion } from '~/messaging/protocol';
import { queryActivity } from '~/store/local';
import { isNonEmpty, isRecord } from '../guards';
import { InvalidInput, type Routes } from '../router';
import type { Services } from '../services';

const live = (rules: Rule[]) => rules.filter((r) => r.deletedAt === undefined);

/** A record stored before Sites has no Site and is YouTube's, as its key without a Site prefix says. */
const recordSite = (rec: EscalationRecord): SiteId => rec.site ?? 'youtube';

export const recordIdentity = (key: string, rec: EscalationRecord): ChannelIdentity => {
  const identity = channelIdentity(rec.name ?? key, rec.handle, rec.id) ?? { key };
  return { ...identity, site: recordSite(rec) };
};

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

/**
 * The add op for a channel Rule (Banned channel or Keep). The channel name doubles as the Rule text. A Site, when
 * the channel was seen on a Tile, makes it a Site-only rule, so it never matches a same-named channel elsewhere.
 */
export function channelRuleOp(
  polarity: 'remove' | 'keep',
  name: string,
  handle: string | undefined,
  id: string | undefined,
  origin: Rule['origin'],
  site?: SiteId,
): RuleOp {
  return {
    op: 'add',
    rule: {
      polarity,
      kind: 'channel',
      text: name,
      params: { channelName: name, ...(handle && { handle }), ...(id && { channelId: id }) },
      ...(site && { site }),
      enabled: true,
      origin,
    },
  };
}

/** The channel Rule a successful mutateRules added: new since `before`, with this polarity and channel. */
export function addedChannelRule(before: Rule[], after: Rule[], polarity: Rule['polarity'], identity: ChannelIdentity): Rule | undefined {
  const ids = new Set(before.map((r) => r.id));
  return after.find((r) => !ids.has(r.id) && r.kind === 'channel' && r.polarity === polarity && channelsMatch(ruleChannelIdentity(r) ?? {}, identity));
}

/**
 * Per ChannelKey, the Rule behind most of the channel's Topic removals (Activity `removed` events with
 * source 'model') in the Escalation window, so a suggestion can say "4 of 6 removed by R2". Ties go to the
 * Rule used most recently. No entry when the Removals carry no Rule or that Rule was deleted since.
 */
async function topRuleByChannel(s: Services, rules: Rule[]): Promise<Map<string, string>> {
  const start = new Date(s.now());
  start.setDate(start.getDate() - (ESCALATION_WINDOW_DAYS - 1));
  const liveIds = new Set(live(rules).map((r) => r.id));
  const events = await queryActivity(s.platform.areas.local, { kinds: ['removed'], fromDay: dayKey(start.getTime()) });
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

export function createEscalation(s: Services) {
  const { writer, state } = s;

  /**
   * Adds the Banned channel Rule (origin 'escalation'), records Activity 'escalated' and broadcasts. Runs
   * exclusively, so two tabs or a double click never add two bans for one channel.
   */
  const ban = (key: string, rec: EscalationRecord, detail: 'automatic' | 'confirmed', batchId?: string): Promise<string> =>
    s.exclusive(() => banNow(key, rec, detail, batchId));

  async function banNow(key: string, rec: EscalationRecord, detail: 'automatic' | 'confirmed', batchId?: string): Promise<string> {
    const rules = await writer.getRules();
    const identity = recordIdentity(key, rec);
    const existing = bannedRuleFor(rules, identity);
    if (existing) return existing.id;
    const name = rec.name ?? key;
    const site = recordSite(rec);
    const res = await writer.mutateRules([channelRuleOp('remove', name, rec.handle, rec.id, 'escalation', site)]);
    if ('error' in res) throw new Error(`escalation ${res.error}`);
    const rule = addedChannelRule(rules, res.rules, 'remove', identity)!;
    await writer.recordActivity([
      { id: newId(), kind: 'escalated', at: s.now(), channelName: name, channelKey: channelKey(name), ruleId: rule.id, detail, site, ...(batchId && { batchId }) },
    ]);
    await writer.updateEscalation((all) => {
      const r = all[key];
      if (!r) return all;
      const { suggestedAt: _s, ...rest } = r;
      return { ...all, [key]: rest };
    });
    await state.broadcastSettings({ force: true });
    return rule.id;
  }

  return {
    ban,

    /**
     * A Removal by a Topic rule (source 'model') in a normal window: counts it, then applies the Escalation
     * setting when the channel qualifies. Suggest stores `suggestedAt` (listEscalations shows it). Automatic
     * adds the Banned channel at once, records 'escalated' with the Removal's batchId and returns it, so the
     * batch summary can say so (REQ-ESC-2).
     */
    async afterTopicRemoval(c: {
      channelName: string;
      channelHandle?: string;
      channelId?: string;
      site?: SiteId;
      batchId?: string;
    }): Promise<{ ruleId: string; channelName: string } | undefined> {
      const key = escalationKey(channelKey(c.channelName), c.site ?? 'youtube');
      if (!key) return;
      const day = writer.today();
      const store = await writer.updateEscalation((all) => {
        let rec = recordTopicRemoval(all[key] ?? emptyEscalation(), day);
        rec = {
          ...rec,
          name: rec.name ?? c.channelName,
          ...(c.channelHandle && !rec.handle && { handle: c.channelHandle }),
          ...(c.channelId && !rec.id && { id: c.channelId }),
          site: c.site ?? 'youtube',
        };
        return { ...all, [key]: rec };
      });
      const settings = await writer.getSettings();
      const rec = store[key];
      if (settings.escalationMode === 'off' || !rec) return;
      const [rules, exceptions] = await Promise.all([writer.getRules(), writer.getExceptions()]);
      const identity = recordIdentity(key, rec);
      if (bannedRuleFor(rules, identity)) return;
      const status = escalationStatus(rec, s.now(), isProtected(identity, rules, exceptions));
      if (!status.qualifies) return;
      if (settings.escalationMode === 'automatic') {
        return { ruleId: await ban(key, rec, 'automatic', c.batchId), channelName: rec.name ?? key };
      }
      if (rec.suggestedAt === undefined) {
        const at = s.now();
        await writer.updateEscalation((all) => (all[key] ? { ...all, [key]: { ...all[key], suggestedAt: at } } : all));
      }
    },
  };
}

export function escalationRoutes(s: Services, esc: ReturnType<typeof createEscalation>): Pick<Routes, 'listEscalations' | 'confirmEscalation' | 'dismissEscalation'> {
  const { writer } = s;
  return {
    listEscalations: {
      from: 'page',
      valid: () => true,
      async run() {
        await s.ensureInit();
        // Off hides pending suggestions. Automatic keeps showing ones made before the switch.
        if ((await writer.getSettings()).escalationMode === 'off') return [];
        const [store, rules, exceptions] = await Promise.all([writer.getEscalation(), writer.getRules(), writer.getExceptions()]);
        const out: EscalationSuggestion[] = [];
        for (const [key, rec] of Object.entries(store)) {
          if (rec.suggestedAt === undefined) continue;
          const identity = recordIdentity(key, rec);
          if (bannedRuleFor(rules, identity)) continue;
          const status = escalationStatus(rec, s.now(), isProtected(identity, rules, exceptions));
          if (!status.qualifies) continue;
          out.push({ channelKey: key, channelName: rec.name ?? key, removed: status.removed, judged: status.judged });
        }
        if (out.length > 0) {
          const top = await topRuleByChannel(s, rules);
          for (const e of out) {
            const ruleId = top.get(e.channelKey);
            if (ruleId) e.ruleId = ruleId;
          }
        }
        return out.sort((a, b) => b.removed - a.removed || a.channelKey.localeCompare(b.channelKey));
      },
    },

    confirmEscalation: {
      from: 'page',
      valid: (v) => isRecord(v) && isNonEmpty(v.channelKey),
      async run({ channelKey: key }) {
        const rec = (await writer.getEscalation())[key];
        if (!rec) throw new InvalidInput('confirmEscalation');
        return { ruleId: await esc.ban(key, rec, 'confirmed') };
      },
    },

    dismissEscalation: {
      from: 'page',
      valid: (v) => isRecord(v) && isNonEmpty(v.channelKey),
      async run({ channelKey: key }) {
        const at = s.now();
        await writer.updateEscalation((all) => {
          const rec = all[key];
          if (!rec) return all;
          const { suggestedAt: _s, ...rest } = dismissEscalation(rec, at);
          return { ...all, [key]: rest };
        });
      },
    },
  };
}
