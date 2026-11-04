// Escalation: Topic removal counts, suggest and automatic Banned channels, Not now. Source of truth:
// docs/spec/requirements.md §9, docs/spec/architecture.md Sections 5 ("Counting") and 10 (ChannelKey).
import { channelKey, channelsMatch, ruleChannelIdentity, type ChannelIdentity } from '~/core/channel';
import {
  bannedRuleFor,
  dismissEscalation,
  ESCALATION_MIN_REMOVALS,
  escalationKey,
  escalationStatus,
  isProtected,
  recordIdentity,
  recordSite,
  recordTopicRemoval,
} from '~/core/escalation';
import { newId } from '~/core/ids';
import type { Rule, RuleOp, SiteId } from '~/core/types';
import type { EscalationMeta } from '~/store/local';
import { isNonEmpty, isRecord } from '../guards';
import { InvalidInput, type Routes } from '../router';
import type { Services } from '../services';

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

export function createEscalation(s: Services) {
  const { writer, state } = s;

  /**
   * Adds the Banned channel Rule (origin 'escalation'), records Activity 'escalated' and broadcasts. Runs
   * exclusively, so two tabs or a double click never add two bans for one channel.
   */
  const ban = (key: string, rec: EscalationMeta, detail: 'automatic' | 'confirmed', batchId?: string): Promise<string> =>
    s.exclusive(() => banNow(key, rec, detail, batchId));

  async function banNow(key: string, rec: EscalationMeta, detail: 'automatic' | 'confirmed', batchId?: string): Promise<string> {
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
     * A Removal by a Topic rule (source 'model') in a normal window: unless Escalation is Off, counts it, then
     * applies the Escalation setting when the channel qualifies. Suggest stores `suggestedAt` (pages show it,
     * store/read.ts readEscalations). Automatic adds the Banned channel at once, records 'escalated' with the Removal's batchId and
     * returns it, so the batch summary can say so (REQ-ESC-2).
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
      const store = await writer.recordTopicRemoval(day, (all) => {
        const prev = all[key] ?? { topicRemoved: {} };
        const rec: EscalationMeta = {
          ...recordTopicRemoval(prev, day),
          name: prev.name ?? c.channelName,
          ...(c.channelHandle && !prev.handle && { handle: c.channelHandle }),
          ...(c.channelId && !prev.id && { id: c.channelId }),
          site: c.site ?? 'youtube',
        };
        return { ...all, [key]: rec };
      });
      const meta = store?.[key];
      if (!meta) return;
      const settings = await writer.getSettings();
      if (settings.escalationMode === 'off') return;
      const [rules, exceptions] = await Promise.all([writer.getRules(), writer.getExceptions()]);
      const identity = recordIdentity(key, meta);
      if (bannedRuleFor(rules, identity)) return;
      const protectedChannel = isProtected(identity, rules, exceptions);
      // Removals and "Not now" are in the record itself, so the judged days are read only for a channel that may qualify.
      const removals = escalationStatus({ ...meta, judged: {} }, s.now(), protectedChannel);
      if (protectedChannel || removals.suppressed || removals.removed < ESCALATION_MIN_REMOVALS) return;
      const rec = (await writer.getEscalation((k) => k === key))[key];
      if (!rec || !escalationStatus(rec, s.now(), protectedChannel).qualifies) return;
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

export function escalationRoutes(s: Services, esc: ReturnType<typeof createEscalation>): Pick<Routes, 'confirmEscalation' | 'dismissEscalation'> {
  const { writer } = s;
  return {
    confirmEscalation: {
      from: 'page',
      valid: (v) => isRecord(v) && isNonEmpty(v.channelKey),
      async run({ channelKey: key }) {
        const rec = (await writer.getEscalationMeta())[key];
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
          const { suggestedAt: _s, ...rest } = rec;
          // "Not now": suggested again only after 3 more Topic removals (REQ-ESC-2).
          return { ...all, [key]: dismissEscalation(rest, at) };
        });
      },
    },
  };
}
