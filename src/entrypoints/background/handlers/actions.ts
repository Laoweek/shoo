// Native action results, Undo, Exceptions and "Always keep this channel". Source of truth:
// docs/spec/architecture.md Sections 5 ("Counting"), 6, 8 (session:removalTabs, private windows) and 10,
// docs/spec/requirements.md §5, §8 and §11.
//
// Undo ownership: content sends reportUndo once after every successful undo, whatever started it (YouTube's
// own Undo, Shoo's annotation or summary Undo, or an undoRemoval this background routed from Activity).
// reportUndo records exactly one 'undone' Activity event and one Exception. undoFromActivity records nothing.
// A second reportUndo for the same video within UNDO_DEDUPE_MS is ignored, so two detectors firing for one
// undo still give one event.
import { channelIdentity, channelKey } from '~/core/channel';
import { newId } from '~/core/ids';
import type { ActivityEvent } from '~/core/types';
import { queryActivity } from '~/store/local';
import { forgetRemovalTab, getRemovalTab, recordRemovalTab } from '~/store/session';
import {
  isBool,
  isChannelParts,
  isIdList,
  isMode,
  isNativeAction,
  isNonEmpty,
  isNum,
  isRecord,
  isShortStr,
  isSource,
  isStep,
  isStr,
  isSurface,
  isVideoId,
  optional,
  optionalStr,
} from '../guards';
import type { Routes } from '../router';
import type { Services } from '../services';
import { addedChannelRule, bannedRuleFor, channelRuleOp, keepRuleFor, type createEscalation } from './escalation';
import { truncateTitle } from './judging';

export const UNDO_DEDUPE_MS = 10_000;

const isOkReport = (v: Record<string, unknown>) =>
  v.ok === true &&
  isStr(v.batchId) &&
  isShortStr(v.title) &&
  optionalStr(v.ruleId) &&
  isChannelParts(v) &&
  optional(v.source, isSource) &&
  optional(v.p, isNum) &&
  optional(v.mode, isMode);
const isFailReport = (v: Record<string, unknown>) =>
  v.ok === false && isStep(v.step) && isStr(v.selectorVersion) && optionalStr(v.title) && optionalStr(v.ruleId);

const withChannel = (e: ActivityEvent, name: string | undefined): ActivityEvent => {
  if (name?.trim()) {
    e.channelName = name;
    e.channelKey = channelKey(name);
  }
  return e;
};

export function actionRoutes(
  s: Services,
  esc: ReturnType<typeof createEscalation>,
): Pick<Routes, 'reportActionResult' | 'reportUndo' | 'addException' | 'removeException' | 'keepChannel' | 'undoFromActivity' | 'markActivitySeen' | 'openSettings'> {
  const { writer, state, platform } = s;
  const { session } = platform.areas;
  const undoneAt = new Map<string, number>();

  return {
    reportActionResult: {
      from: 'content',
      valid: (v) => isRecord(v) && isVideoId(v.videoId) && isSurface(v.surface) && isNativeAction(v.nativeAction) && (isOkReport(v) || isFailReport(v)),
      async run(r, sender) {
        const ctx = s.privacy(sender);
        const at = s.now();
        let escalated: { ruleId: string; channelName: string } | undefined;
        if (r.ok) {
          await writer.bumpCounters(writer.today(), { removed: 1 }, ctx);
          const e: ActivityEvent = { id: newId(), kind: 'removed', at, videoId: r.videoId, title: truncateTitle(r.title)!, surface: r.surface, batchId: r.batchId, nativeAction: r.nativeAction };
          if (r.ruleId) e.ruleId = r.ruleId;
          if (r.source) e.source = r.source;
          if (r.p !== undefined) e.p = r.p;
          if (r.mode) e.mode = r.mode;
          withChannel(e, r.channelName);
          await writer.recordActivity([e], ctx);
          const tabId = sender.tabId;
          if (tabId !== undefined) await s.exclusive(() => recordRemovalTab(session, r.videoId, tabId, at));
          s.rememberRemoval(r.videoId, {
            title: e.title!,
            surface: r.surface,
            nativeAction: r.nativeAction,
            ...(e.channelName && { channelName: e.channelName, channelKey: e.channelKey! }),
            ...(r.ruleId && { ruleId: r.ruleId }),
          });
          // The Rule hit was counted when the Tile was judged (handlers/judging.ts), not here.
          if (r.source === 'model' && r.channelName?.trim() && !sender.incognito) {
            try {
              escalated = await esc.afterTopicRemoval({ channelName: r.channelName, channelHandle: r.channelHandle, channelId: r.channelId, batchId: r.batchId });
            } catch {
              platform.log?.('escalationFailed');
            }
          }
          // Failure counters count private windows too: they hold no browsing data (REQ-COST-4).
          await state.success('nativeAction');
        } else {
          const e: ActivityEvent = {
            id: newId(),
            kind: 'failed',
            at,
            videoId: r.videoId,
            surface: r.surface,
            nativeAction: r.nativeAction,
            step: r.step,
            selectorVersion: r.selectorVersion,
          };
          if (r.title) e.title = truncateTitle(r.title)!;
          if (r.ruleId) e.ruleId = r.ruleId;
          await writer.recordActivity([e], ctx);
          await state.failure('nativeAction');
        }
        const snapshot = await state.refresh(sender.tabId);
        return escalated ? { ...snapshot, escalated } : snapshot;
      },
    },

    reportUndo: {
      from: 'content',
      valid: (v) => isRecord(v) && isVideoId(v.videoId) && (v.via === 'youtube' || v.via === 'shoo'),
      async run({ videoId, via }, sender) {
        const at = s.now();
        const last = undoneAt.get(videoId);
        if (last !== undefined && at - last < UNDO_DEDUPE_MS) return;
        undoneAt.set(videoId, at);
        if (undoneAt.size > 500) undoneAt.delete(undoneAt.keys().next().value!);

        const ctx = s.privacy(sender);
        let info = s.removals.get(videoId);
        if (!info && !sender.incognito) {
          const [removed] = await queryActivity(platform.areas.local, { videoId, kinds: ['removed'], limit: 1 });
          if (removed) {
            info = { title: removed.title ?? '', surface: removed.surface ?? 'home', nativeAction: removed.nativeAction ?? 'notInterested' };
            if (removed.channelName) info.channelName = removed.channelName;
            if (removed.ruleId) info.ruleId = removed.ruleId;
          }
        }
        const title = info?.title ?? '';
        const e: ActivityEvent = { id: newId(), kind: 'undone', at, videoId, title, detail: via };
        if (info) {
          e.surface = info.surface;
          e.nativeAction = info.nativeAction;
          if (info.ruleId) e.ruleId = info.ruleId;
          withChannel(e, info.channelName);
        }
        await writer.recordActivity([e], ctx);
        await writer.addException(
          { videoId, title, ...(info?.channelName && { channelName: info.channelName }), ...(info?.ruleId && { ruleId: info.ruleId }) },
          ctx,
        );
        await s.exclusive(() => forgetRemovalTab(session, videoId));
        // Other tabs may hold a queued job or a chip for this video.
        await state.broadcastSettings({ force: true });
      },
    },

    addException: {
      from: 'both',
      valid: (v) =>
        isRecord(v) &&
        isVideoId(v.videoId) &&
        isShortStr(v.title) &&
        optionalStr(v.channelName) &&
        optionalStr(v.ruleId) &&
        (v.origin === 'reviewKeep' || v.origin === 'undo' || v.origin === 'activityKeep'),
      async run({ videoId, title, channelName, ruleId, origin }, sender) {
        const ctx = s.privacy(sender);
        await writer.addException({ videoId, title, ...(channelName && { channelName }), ...(ruleId && { ruleId }) }, ctx);
        // A Review choice or an Activity Keep is recorded as 'kept'. Origin 'undo' is recorded by reportUndo.
        if (origin !== 'undo') {
          const e: ActivityEvent = { id: newId(), kind: 'kept', at: s.now(), videoId, title: truncateTitle(title)!, detail: origin };
          if (ruleId) e.ruleId = ruleId;
          await writer.recordActivity([withChannel(e, channelName)], ctx);
        }
        // Every tab re-judges: another YouTube tab may hold a queued Auto job or a chip for this video.
        await state.broadcastSettings({ force: true });
      },
    },

    removeException: {
      from: 'page',
      valid: (v) => isRecord(v) && isVideoId(v.videoId),
      async run({ videoId }) {
        await writer.removeException(videoId);
        await state.broadcastSettings({ force: true });
      },
    },

    /**
     * "Always keep this channel". Semantics with a Banned channel for the same channel:
     * - `liftBan` absent: nothing is created. Returns `{ ruleId: '', bannedRuleId }` so the UI asks first and
     *   calls again with `liftBan: true` or `false`.
     * - `liftBan: true`: adds the Keep rule and tombstones the ban in one mutateRules call. Returns
     *   `{ ruleId, liftedBanRuleId }`.
     * - `liftBan: false`: adds the Keep rule and leaves the ban (the Keep rule wins at stage 1). Returns
     *   `{ ruleId, bannedRuleId }`.
     * Without a ban it adds the Keep rule, or returns the existing Keep rule's id when one matches.
     * From a private-window tab it is refused with `{ error: 'privateWindow' }`: Rules sync, and REQ-ACTV-3 allows
     * no sync writes from private windows. Content should not offer it there (the judgeTiles reply says `private`).
     */
    keepChannel: {
      from: 'both',
      valid: (v) => isRecord(v) && isChannelParts(v) && optional(v.liftBan, isBool),
      async run({ channelName, channelHandle, channelId, liftBan }, sender) {
        if (sender.incognito) return { error: 'privateWindow' as const };
        const identity = channelIdentity(channelName, channelHandle, channelId);
        const name = [channelName, channelHandle, channelId].find(isNonEmpty)?.trim();
        if (!identity || !name) return { error: 'noChannel' as const };
        await s.ensureInit();
        // Exclusive: a double click must not add two Keep rules.
        return s.exclusive(async () => {
          const rules = await writer.getRules();
          const ban = bannedRuleFor(rules, identity);
          if (ban && liftBan === undefined) return { ruleId: '', bannedRuleId: ban.id };
          const existing = keepRuleFor(rules, identity);
          const ops = [
            ...(existing ? [] : [channelRuleOp('keep', name, channelHandle?.trim() || undefined, channelId?.trim() || undefined, 'user')]),
            ...(ban && liftBan ? [{ op: 'delete' as const, id: ban.id }] : []),
          ];
          let ruleId = existing?.id ?? '';
          if (ops.length > 0) {
            const res = await writer.mutateRules(ops);
            if ('error' in res) throw new Error(`keepChannel ${res.error}`);
            ruleId = existing?.id ?? addedChannelRule(rules, res.rules, 'keep', identity)!.id;
            await state.broadcastSettings({ force: true });
          }
          if (ban && liftBan) return { ruleId, liftedBanRuleId: ban.id };
          if (ban) return { ruleId, bannedRuleId: ban.id };
          return { ruleId };
        });
      },
    },

    /**
     * Activity's Undo: routes undoRemoval to the tab that removed the video (session:removalTabs, 1 hour).
     * Records nothing itself: content answers ok and then sends reportUndo. A closed tab, a tab that left
     * YouTube or a tab whose content script no longer answers gives 'expired'.
     */
    undoFromActivity: {
      from: 'page',
      valid: (v) => isRecord(v) && isVideoId(v.videoId),
      async run({ videoId }) {
        const entry = await getRemovalTab(session, videoId, s.now());
        if (!entry) return { ok: false as const, reason: 'expired' as const };
        try {
          const tab = await platform.tabs.get(entry.tabId);
          if (!tab.url || new URL(tab.url).origin !== 'https://www.youtube.com') return { ok: false as const, reason: 'expired' as const };
          const res = await platform.sendToTab('undoRemoval', { videoId }, entry.tabId);
          return res && typeof res === 'object' && 'ok' in res ? res : { ok: false as const, reason: 'expired' as const };
        } catch {
          return { ok: false as const, reason: 'expired' as const };
        }
      },
    },

    markActivitySeen: {
      from: 'page',
      valid: (v) => isRecord(v) && isIdList(v.ids),
      async run({ ids }) {
        await writer.markActivitySeen(ids);
      },
    },

    openSettings: {
      from: 'both',
      valid: (v) => v === undefined || (isRecord(v) && optional(v.hash, (h) => isStr(h) && h.length <= 200)),
      /** Focuses an open Settings tab (moving it to `hash` when given), else opens one. */
      async run(req) {
        const hash = req?.hash?.replace(/^#/, '');
        const base = platform.getURL('/options.html');
        const url = base + (hash ? `#${hash}` : '');
        const tabs = await platform.extensionTabs().catch(() => []);
        const open = tabs.find((t) => t.url === base || t.url.startsWith(`${base}#`));
        if (!open) {
          await platform.tabs.create({ url });
          return;
        }
        await platform.tabs.update(open.tabId, hash ? { active: true, url } : { active: true });
        await platform.focusWindow(open.windowId);
      },
    },
  };
}
