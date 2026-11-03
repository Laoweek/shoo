// Settings, Mode, Rules, breakers, export, import and Reset. Source of truth: docs/spec/architecture.md
// Sections 5 (Mode transitions), 6, 7 (Resume) and 8 (writers, export and import, Reset).
import type { RuleOp, Settings } from '~/core/types';
import { computeRulesVersion } from '~/engine/judge';
import { clearCustomKey, clearDirectKey, clearOpenRouterKey } from '~/store/secret';
import { cleanSettingsPatch, isBool, isCategory, isMode, isRecord, isStr, optional } from '../guards';
import type { Routes } from '../router';
import type { Services } from '../services';

/** Every settings change goes through here: writer (generation +1), settingsChanged, then RuntimeState. */
export async function applySettings(s: Services, patch: Partial<Settings>, extra: { actOnChipsTab?: number } = {}): Promise<Settings> {
  const settings = await s.writer.updateSettings(patch);
  await s.state.broadcastSettings(extra);
  await s.state.refresh();
  return settings;
}

/** The contract's update patch: `Partial<Pick<Rule, 'text' | 'name' | 'params' | 'enabled' | 'kind' | 'skipSubscribed'>>`. Ids, refs and tombstones belong to the writer. */
const PATCH_KEYS = new Set(['text', 'name', 'params', 'enabled', 'kind', 'skipSubscribed']);

const isRuleOp = (v: unknown): v is RuleOp => {
  if (!isRecord(v)) return false;
  if (v.op === 'delete') return typeof v.id === 'string';
  if (v.op === 'update') {
    return typeof v.id === 'string' && isRecord(v.patch) && Object.keys(v.patch).every((k) => PATCH_KEYS.has(k)) && optional(v.patch.name, isStr) && optional(v.patch.skipSubscribed, isBool);
  }
  // Shapes inside `rule` are validated by the writer through core validateRuleInput. A name must be a string to be trimmed.
  return (
    v.op === 'add' &&
    isRecord(v.rule) &&
    typeof v.rule.text === 'string' &&
    typeof v.rule.kind === 'string' &&
    typeof v.rule.polarity === 'string' &&
    optional(v.rule.name, isStr) &&
    optional(v.rule.skipSubscribed, isBool)
  );
};

export function settingsRoutes(s: Services): Pick<Routes, 'updateSettings' | 'setMode' | 'mutateRules' | 'resumeFromBreaker' | 'exportData' | 'importData' | 'resetAll'> {
  const { writer, state } = s;
  return {
    updateSettings: {
      from: 'page',
      valid: (v) => isRecord(v) && cleanSettingsPatch(v.patch) !== undefined,
      async run({ patch }) {
        const clean = cleanSettingsPatch(patch)!;
        // Switching engine: key and credits states belong to the previous engine's key.
        if (clean.engine !== undefined && clean.engine !== (await writer.getSettings()).engine) await state.clearFlags('keyRejected', 'creditsExhausted');
        return { settings: await applySettings(s, clean) };
      },
    },

    setMode: {
      from: 'page',
      valid: (v) => isRecord(v) && isMode(v.mode) && optional(v.actOnShowingChips, isBool),
      async run({ mode, actOnShowingChips }) {
        // The popup's prompt counted the active tab's chips, so only that tab acts on them (REQ-MODE-5).
        const tabId = await state.activeTabId();
        await applySettings(s, { mode }, actOnShowingChips && tabId !== undefined ? { actOnChipsTab: tabId } : {});
        return state.snapshot(tabId);
      },
    },

    mutateRules: {
      from: 'page',
      valid: (v) => isRecord(v) && Array.isArray(v.ops) && v.ops.length > 0 && v.ops.length <= 200 && v.ops.every(isRuleOp),
      invalid: { error: 'invalidInput', detail: 'shape' },
      async run({ ops }) {
        const res = await writer.mutateRules(ops);
        if ('error' in res) return res;
        await state.broadcastSettings({ force: true });
        await state.refresh();
        return { rules: res.rules, rulesVersion: computeRulesVersion(res.rules, await writer.getSettings()) };
      },
    },

    resumeFromBreaker: {
      // Also accepted from content: the in-page model notice offers Retry (entrypoints/content/pipeline.ts).
      from: 'both',
      valid: (v) => v === undefined || (isRecord(v) && optional(v.category, isCategory)),
      async run(req, sender) {
        await state.resume(req?.category);
        return state.refresh(sender.kind === 'content' ? sender.tabId : await state.activeTabId());
      },
    },

    exportData: {
      from: 'page',
      valid: () => true,
      run: () => writer.exportData(),
    },

    importData: {
      from: 'page',
      valid: (v) => isRecord(v) && (v.mode === 'merge' || v.mode === 'replace') && isBool(v.dryRun),
      invalid: { error: 'invalidInput', detail: 'request' },
      async run({ file, mode, dryRun }) {
        const res = await s.quietRules(() => writer.importData(file, mode, dryRun));
        if (!dryRun && !('error' in res)) {
          await state.broadcastSettings({ force: true });
          await state.refresh();
        }
        return res;
      },
    },

    resetAll: {
      from: 'page',
      valid: () => true,
      async run() {
        await s.quietRules(() => writer.resetAll()); // clears storage.local (keys included) and storage.session
        await clearOpenRouterKey(s.platform.areas.local);
        await clearCustomKey(s.platform.areas.local);
        await clearDirectKey(s.platform.areas.local);
        s.keyUsage.clear();
        s.removals.clear();
        state.reset();
        await state.broadcastSettings({ force: true });
        await state.refresh();
      },
    },
  };
}
