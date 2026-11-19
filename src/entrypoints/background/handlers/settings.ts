// Settings, Mode, Rules, breakers, export, import, Clear history and Reset. Source of truth: docs/spec/architecture.md
// Sections 5 (Mode transitions), 6, 7 (Resume) and 8 (writers, export and import, Reset).
import type { RuleOp, Settings } from '~/core/types';
import { computeRulesVersion } from '~/engine/judge';
import { clearCustomKey, clearDirectKey, clearOpenRouterKey } from '~/store/secret';
import { cleanSettingsPatch, isBool, isCategory, isMode, isRecord, isSite, isStr, optional } from '../guards';
import { InvalidInput, type Routes } from '../router';
import type { Services } from '../services';

/** Every settings change goes through here: writer (generation +1), settingsChanged, then RuntimeState. */
export async function applySettings(s: Services, patch: Partial<Settings>, extra: { actOnChipsTab?: number } = {}): Promise<Settings> {
  const settings = await s.writer.updateSettings(patch);
  await s.state.broadcastSettings(extra);
  await s.state.refresh();
  return settings;
}

/** The contract's update patch: `Partial<Pick<Rule, 'text' | 'name' | 'params' | 'enabled' | 'kind' | 'skipSubscribed'>>` and a Site or null. Ids, refs and tombstones belong to the writer. */
const PATCH_KEYS = new Set(['text', 'name', 'params', 'enabled', 'kind', 'skipSubscribed', 'site']);
const isSiteOrNull = (v: unknown) => v === null || isSite(v);

const isRuleOp = (v: unknown): v is RuleOp => {
  if (!isRecord(v)) return false;
  if (v.op === 'delete') return typeof v.id === 'string';
  if (v.op === 'update') {
    return (
      typeof v.id === 'string' &&
      isRecord(v.patch) &&
      Object.keys(v.patch).every((k) => PATCH_KEYS.has(k)) &&
      optional(v.patch.name, isStr) &&
      optional(v.patch.skipSubscribed, isBool) &&
      optional(v.patch.site, isSiteOrNull)
    );
  }
  // Shapes inside `rule` are validated by the writer through core validateRuleInput. A name must be a string to be trimmed.
  return (
    v.op === 'add' &&
    isRecord(v.rule) &&
    typeof v.rule.text === 'string' &&
    typeof v.rule.kind === 'string' &&
    typeof v.rule.polarity === 'string' &&
    optional(v.rule.name, isStr) &&
    optional(v.rule.skipSubscribed, isBool) &&
    optional(v.rule.site, isSite)
  );
};

export function settingsRoutes(
  s: Services,
): Pick<Routes, 'updateSettings' | 'setMode' | 'mutateRules' | 'resumeFromBreaker' | 'exportData' | 'importData' | 'clearHistory' | 'resetAll'> {
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
      // Also accepted from content, for the model only: the in-page model notice offers Retry
      // (src/content/pipeline.ts). The other breakers protect every Site's tabs and resume from the popup.
      from: 'both',
      valid: (v) => v === undefined || (isRecord(v) && optional(v.category, isCategory)),
      async run(req, sender) {
        if (sender.kind === 'content' && req?.category !== 'model') throw new InvalidInput('resumeFromBreaker');
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
      // The options page checked every entry of the file (store/import.ts) before it sends the result.
      valid: (v) =>
        isRecord(v) &&
        isRecord(v.file) &&
        [v.file.rules, v.file.exceptions, v.file.invalid].every(Array.isArray) &&
        (v.mode === 'merge' || v.mode === 'replace') &&
        isBool(v.dryRun),
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

    clearHistory: {
      from: 'page',
      valid: () => true,
      async run() {
        // Exclusive with the read-modify-writes of session:removalTabs, which the writer clears too.
        await s.exclusive(() => writer.clearHistory());
        s.removals.clear();
        await state.refresh();
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
