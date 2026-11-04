// The user's own Don't recommend channel becomes a Banned channel, and the Site's Undo lifts it again. Only a Site
// whose content watches its own menu sends these (YouTube today). Source of truth: docs/spec/requirements.md
// REQ-ACT-5, docs/spec/architecture.md Section 6.
import { tileChannelIdentity } from '~/core/channel';
import { bannedRuleFor, keepRuleFor } from '~/core/escalation';
import { newId } from '~/core/ids';
import { SURFACE_SITE } from '~/core/sites';
import { queryActivity } from '~/store/local';
import { isNonEmpty, isRecord, isTileFacts, isVideoId } from '../guards';
import { InvalidInput, type Routes } from '../router';
import type { Services } from '../services';
import { addedChannelRule, channelRuleOp } from './escalation';
import { truncateTitle } from './judging';

/** The Site's Undo can lift the ban only this long after it was added, like Activity's Undo routing. */
export const LIFT_WINDOW_MS = 3_600_000;

export function userBanRoutes(s: Services): Pick<Routes, 'banChannel' | 'liftChannelBan'> {
  const { writer, state } = s;
  return {
    /**
     * Adds the Banned channel (origin 'user'), a Site-only rule for the Tile's Site, and records Activity 'banned'.
     * An existing ban for the channel on that Site is returned with `added: false`. Nothing is added when Shoo is off or cannot run Exact rules, from a private
     * window (Rules sync, REQ-ACTV-3), or when a Keep rule covers the channel.
     */
    banChannel: {
      from: 'content',
      valid: (v) => isRecord(v) && isTileFacts(v.tile),
      async run({ tile }, sender) {
        if (SURFACE_SITE[tile.surface] !== sender.site) throw new InvalidInput('banChannel');
        if (sender.incognito) return { error: 'privateWindow' as const };
        const identity = tileChannelIdentity(tile);
        const name = [tile.channelName, tile.channelHandle, tile.channelId].find(isNonEmpty)?.trim();
        if (!identity || !name) return { error: 'noChannel' as const };
        await s.ensureInit();
        if (!(await state.snapshot(sender.tabId)).stages.exact) return { error: 'off' as const };
        return s.exclusive(async () => {
          const rules = await writer.getRules();
          const ban = bannedRuleFor(rules, identity);
          if (ban) return { ruleId: ban.id, added: false };
          if (keepRuleFor(rules, identity)) return { error: 'keptChannel' as const };
          const res = await writer.mutateRules([channelRuleOp('remove', name, tile.channelHandle?.trim() || undefined, tile.channelId?.trim() || undefined, 'user', identity.site)]);
          if ('error' in res) throw new Error(`banChannel ${res.error}`);
          const ruleId = addedChannelRule(rules, res.rules, 'remove', identity)!.id;
          const { videoId, surface } = tile;
          await writer.recordActivity([
            { id: newId(), kind: 'banned', at: s.now(), videoId, title: truncateTitle(tile.title)!, surface, ruleId, nativeAction: 'dontRecommendChannel', channelName: name, channelKey: identity.key },
          ]);
          await state.broadcastSettings({ force: true });
          return { ruleId, added: true };
        });
      },
    },

    /**
     * Tombstones the Banned channel only when this video's 'banned' event added it within LIFT_WINDOW_MS, and
     * records it as 'undone' with the Site's id as detail, like reportUndo via 'site'. Anything else changes nothing.
     */
    liftChannelBan: {
      from: 'content',
      valid: (v) => isRecord(v) && isNonEmpty(v.ruleId) && isVideoId(v.videoId),
      async run({ ruleId, videoId }, sender) {
        if (sender.incognito) return;
        await s.ensureInit();
        await s.exclusive(async () => {
          const [banned] = await queryActivity(s.platform.areas.local, { videoId, kinds: ['banned'], limit: 1 });
          const live = (await writer.getRules()).some((r) => r.id === ruleId && r.deletedAt === undefined);
          if (!live || banned?.ruleId !== ruleId || s.now() - banned.at > LIFT_WINDOW_MS) return;
          await writer.mutateRules([{ op: 'delete', id: ruleId }]);
          const { seenAt: _seen, ...e } = banned;
          await writer.recordActivity([{ ...e, id: newId(), kind: 'undone', at: s.now(), detail: sender.site ?? 'youtube' }]);
          await state.broadcastSettings({ force: true });
        });
      },
    },
  };
}
