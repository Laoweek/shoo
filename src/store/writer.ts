// The serialized mutation queue. Background only: the background is the sole storage writer
// (docs/spec/architecture.md Section 8 "Writers"). Every mutation runs through one promise queue, so
// concurrent calls from the popup, Settings and content never lose updates or duplicate refs.
import { channelKey } from '~/core/channel';
import { dayKey, type EscalationRecord } from '~/core/escalation';
import { newId as defaultNewId } from '~/core/ids';
import { createRule, parseRef, resolveRefCollisions, sortByRef, trimName, validateRuleInput, type RefCounters } from '~/core/rules';
import type { FailureState } from '~/core/runtime';
import { SUPPORTED_SURFACES, SURFACE_IDS, type ActivityEvent, type Exception, type Rule, type RuleOp, type Settings, type ShooExport } from '~/core/types';
import { browserAreas, type Areas, type StorageChange } from './areas';
import { parseImportFile, type ImportPreview } from './import';
import {
  addCounters,
  appendActivity,
  bumpCounters as bumpLocalCounters,
  getArchive,
  getCounters,
  getEscalation,
  getRuntime,
  getSettings,
  markActivitySeen,
  pruneRetention,
  putVerdicts,
  recordRuleHits,
  setRuntime,
  setSettings,
  updateArchive,
  updateEscalation as updateLocalEscalation,
  type DayCounters,
  type EscalationStore,
  type VerdictPut,
} from './local';
import { runMigrations, SCHEMA, DEFAULT_SETTINGS, META_KEY } from './schema';
import {
  addPrivateException,
  bumpPrivateCounters,
  getPrivateCounters,
  getPrivateExceptions,
  removePrivateException,
} from './session';
import { FLOOR_KEY, OUTBOX_KEY, SyncStore, TOMBSTONE_TTL_MS, isSyncDataKey, liveKey, parseSync, tombstone, type RemoteMergeResult, type Timers } from './sync';

/** Set from `sender.tab` when the sender is a private-window tab: nothing goes to local or sync. */
export interface PrivacyContext {
  incognitoTabId?: number;
}

export interface WriterDeps {
  areas?: Areas;
  now?: () => number;
  newId?: () => string;
  /** Sync write debounce, 1 s by default. */
  debounceMs?: number;
  timers?: Timers;
  /** Called when a remote merge or import changed the Rules (recompute rulesVersion, broadcast). */
  onRulesChanged?: (rules: Rule[]) => void;
  onError?: (e: unknown) => void;
}

export type MutateRulesResult = { rules: Rule[] } | { error: 'syncQuota' | 'invalidInput'; detail: string };

export interface ExceptionInput {
  videoId: string;
  title: string;
  channelName?: string;
  ruleId?: string;
}

export type Writer = ReturnType<typeof createWriter>;

const isPrivate = (ctx?: PrivacyContext): ctx is { incognitoTabId: number } => ctx?.incognitoTabId !== undefined;
/** Surfaces with no Native action stay off (REQ-SURF-1a). */
const LOCKED_SURFACES = Object.fromEntries(SURFACE_IDS.filter((s) => !SUPPORTED_SURFACES.includes(s)).map((s) => [s, false]));

/** Raises ref counters past every ref in use, so imported refs are never handed out again. */
function countersCovering(rules: Rule[], counters: RefCounters): RefCounters {
  let { nextR, nextK } = counters;
  for (const r of rules) {
    const p = parseRef(r.ref);
    if (p?.letter === 'R') nextR = Math.max(nextR, p.n + 1);
    if (p?.letter === 'K') nextK = Math.max(nextK, p.n + 1);
  }
  return { ...counters, nextR, nextK };
}

export function createWriter(deps: WriterDeps = {}) {
  const areas = deps.areas ?? browserAreas();
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? defaultNewId;

  let tail: Promise<unknown> = Promise.resolve();
  /** Runs `fn` after every earlier mutation has settled. Never call it from inside a queued task. */
  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  }

  const sync = new SyncStore({
    sync: areas.sync,
    local: areas.local,
    now,
    ...(deps.debounceMs !== undefined && { debounceMs: deps.debounceMs }),
    ...(deps.timers && { timers: deps.timers }),
    runExclusive: (fn) => enqueue(fn),
    onError: (e) => deps.onError?.(e),
  });

  let ready: Promise<void> | undefined;
  /** Set once storage.sync is loaded. A change that lands earlier is already in the load. */
  let loaded = false;
  const listener = (changes: Record<string, StorageChange>) => {
    if (!Object.keys(changes).some(isSyncDataKey)) return;
    const previous: Record<string, unknown> = {};
    for (const [k, c] of Object.entries(changes)) if (isSyncDataKey(k)) previous[k] = c.oldValue;
    const cold = !loaded;
    void enqueue(async () => {
      // The live Rules before this change. Before the load they come from storage.sync with the change undone
      // (a key the change created has no oldValue, and parsing skips it).
      const before = liveKey(cold ? parseSync({ ...(await areas.sync.get(null)), ...previous }).rules.values() : sync.allRules());
      await init();
      await applyRemote(await sync.mergeRemote(previous), before);
    }).catch((e) => deps.onError?.(e));
  };
  // Registered synchronously, so a background woken by a sync change still receives the event.
  areas.sync.onChanged.addListener(listener);

  /**
   * Archives evicted Exceptions, applies removals to the archive, records renumbered live Rules. Notifies
   * when the live Rules differ from `rulesBefore` (`result.changed` only says storage.sync needs a write).
   */
  async function applyRemote(result: RemoteMergeResult, rulesBefore?: string): Promise<void> {
    await updateArchive(areas.local, result.archive, sync.syncedExceptions().map((x) => x.videoId), result.removed, result.excEpoch);
    await recordRenumbered(result.renumbered);
    if (rulesBefore !== undefined && rulesBefore !== liveKey(sync.allRules())) deps.onRulesChanged?.(sortByRef(sync.liveRules()));
  }

  async function recordRenumbered(list: { ruleId: string; from: string; to: string }[]): Promise<void> {
    const live = new Set(sync.liveRules().map((r) => r.id));
    const at = now();
    const events: ActivityEvent[] = list
      .filter((x) => live.has(x.ruleId))
      .map((x) => ({ id: newId(), kind: 'renumbered', at, ruleId: x.ruleId, detail: `${x.from} -> ${x.to}` }));
    await appendActivity(areas.local, events);
  }

  /** Runs migrations and loads storage.sync. Idempotent. A failure is retried on the next call. */
  function init(): Promise<void> {
    ready ??= (async () => {
      await runMigrations(areas);
      await applyRemote(await sync.load());
      loaded = true;
    })().catch((e: unknown) => {
      ready = undefined;
      throw e;
    });
    return ready;
  }

  /** Queued task that waits for init first. */
  const task = <T>(fn: () => Promise<T>): Promise<T> =>
    enqueue(async () => {
      await init();
      return fn();
    });

  async function allExceptions(): Promise<Exception[]> {
    const merged = new Map<string, Exception>();
    for (const x of [...(await getArchive(areas.local, sync.excEpoch())), ...sync.syncedExceptions()]) {
      const prev = merged.get(x.videoId);
      if (!prev || x.at >= prev.at) merged.set(x.videoId, x);
    }
    return [...merged.values()].sort((a, b) => b.at - a.at);
  }

  /**
   * Puts the newest Exceptions in sync and the rest in the archive. `removed` are deletions (they sync).
   * `newEpoch` removes every Exception from before on every device (Reset, replace import).
   */
  async function placeExceptions(candidates: Exception[], removed: string[] = [], opts: { newEpoch?: boolean } = {}): Promise<void> {
    const overflow = await sync.commitExceptions(candidates, removed, opts);
    const inSync = sync.syncedExceptions().map((x) => x.videoId);
    await updateArchive(areas.local, overflow, [...inSync, ...removed], {}, sync.excEpoch());
  }

  function applyOps(ops: RuleOp[], settings: Settings, at: number): { rules: Rule[]; counters: RefCounters } | { error: string } {
    const rules = sync.allRules();
    let counters = sync.counters();
    for (const [i, op] of ops.entries()) {
      if (op.op === 'add') {
        const { polarity, kind, text, name, params, site, skipSubscribed, enabled, origin } = op.rule;
        const input = trimName({
          polarity,
          kind,
          text,
          name,
          enabled,
          origin,
          ...(params && { params }),
          ...(site && { site }),
          ...(skipSubscribed === true && { skipSubscribed }),
        });
        const check = validateRuleInput(input, settings.regexEnabled);
        if (!check.ok) return { error: `${i}:${check.reason}` };
        const created = createRule(input, rules, counters, at, newId());
        rules.push(created.rule);
        counters = created.counters;
      } else {
        const index = rules.findIndex((r) => r.id === op.id && r.deletedAt === undefined);
        if (index < 0) {
          if (op.op === 'delete') continue; // already gone, deleting is idempotent
          return { error: `${i}:notFound` };
        }
        const current = rules[index]!;
        // After the Rule's own time, so the change wins even if a device with a clock ahead wrote it last.
        const changedAt = Math.max(at, current.updatedAt + 1);
        if (op.op === 'delete') {
          rules[index] = tombstone(current, changedAt);
          continue;
        }
        const { site, ...patch } = op.patch;
        const next: Rule = trimName({ ...current, ...patch, updatedAt: changedAt });
        // Stored only when on, like the compact form, so switching it off leaves no field behind.
        if (next.skipSubscribed !== true) delete next.skipSubscribed;
        if (site === null) delete next.site;
        else if (site !== undefined) next.site = site;
        // Only a changed kind or text needs regex enabled. Switching a regex Rule off must always work.
        const touchesPattern = op.patch.kind !== undefined || op.patch.text !== undefined;
        // Only an edited name is checked, so a longer name synced from elsewhere never blocks switching the Rule off.
        const check = validateRuleInput(op.patch.name === undefined ? { ...next, name: undefined } : next, touchesPattern ? settings.regexEnabled : undefined);
        if (!check.ok) return { error: `${i}:${check.reason}` };
        rules[index] = next;
      }
    }
    return { rules, counters };
  }

  return {
    init,

    /** Resolves when every queued mutation so far has settled. */
    whenIdle: (): Promise<void> => enqueue(async () => undefined),

    /** Writes pending sync changes now instead of after the debounce. False when a rate limit deferred them. */
    flush: (): Promise<boolean> => task(() => sync.flush()),

    dispose(): void {
      areas.sync.onChanged.removeListener(listener);
      sync.dispose();
    },

    // Reads -----------------------------------------------------------------------------------------

    getSettings: (): Promise<Settings> => getSettings(areas.local),

    /** Live Rules sorted by ref. */
    getRules: async (): Promise<Rule[]> => {
      await init();
      return sortByRef(sync.liveRules());
    },

    /** Exceptions that apply to this sender: synced, archived and, in a private window, the tab's own. */
    getExceptions: async (ctx?: PrivacyContext): Promise<Exception[]> => {
      await init();
      const all = await allExceptions();
      return isPrivate(ctx) ? [...(await getPrivateExceptions(areas.session, ctx.incognitoTabId)), ...all] : all;
    },

    /** Today's counters across normal and private windows (the Daily cap counts both). */
    getDayCounters: async (day: string): Promise<DayCounters> =>
      addCounters(await getCounters(areas.local, day), await getPrivateCounters(areas.session, day)),

    getRuntime: (): Promise<FailureState> => getRuntime(areas.local),

    getEscalation: (): Promise<EscalationStore> => getEscalation(areas.local),

    // Mutations -------------------------------------------------------------------------------------

    /** Applies a settings patch. `generation` goes up by one, locked Surfaces stay off. */
    updateSettings: (patch: Partial<Settings>): Promise<Settings> =>
      task(async () => {
        const current = await getSettings(areas.local);
        const { generation: _ignored, ...rest } = patch;
        const next: Settings = { ...current, ...rest, generation: current.generation + 1 };
        next.sites = { ...current.sites, ...rest.sites };
        next.surfaces = { ...current.surfaces, ...rest.surfaces, ...LOCKED_SURFACES };
        await setSettings(areas.local, next);
        return next;
      }),

    /**
     * Applies all ops or none: validation through core, refs and colours allocated, deletes tombstoned.
     * Returns the live Rules sorted by ref. The router computes `rulesVersion` from them. Deletes are
     * accepted even over the sync budget, so an over-budget Rule set can always be shrunk.
     */
    mutateRules: (ops: RuleOp[]): Promise<MutateRulesResult> =>
      task(async () => {
        const settings = await getSettings(areas.local);
        const applied = applyOps(ops, settings, sync.ruleTime(now()));
        if ('error' in applied) return { error: 'invalidInput' as const, detail: applied.error };
        const shrinkOnly = ops.every((op) => op.op === 'delete');
        if (!(await sync.commitRules(applied.rules, applied.counters, { shrinkOnly }))) return { error: 'syncQuota' as const, detail: 'rules' };
        return { rules: sortByRef(sync.liveRules()) };
      }),

    /** Keep, Undo or Activity Keep. In a private window the Exception lives in session storage only. */
    addException: (input: ExceptionInput, ctx?: PrivacyContext): Promise<Exception> =>
      task(async () => {
        const x: Exception = { videoId: input.videoId, title: input.title, at: now() };
        if (input.channelName) {
          x.channelName = input.channelName;
          x.channelKey = channelKey(input.channelName);
        }
        if (input.ruleId) x.ruleId = input.ruleId;
        if (isPrivate(ctx)) {
          await addPrivateException(areas.session, ctx.incognitoTabId, x);
          return x;
        }
        const others = sync.syncedExceptions().filter((e) => e.videoId !== x.videoId);
        await placeExceptions([x, ...others]);
        await updateArchive(areas.local, [], [x.videoId]);
        return x;
      }),

    removeException: (videoId: string, ctx?: PrivacyContext): Promise<void> =>
      task(async () => {
        if (isPrivate(ctx)) return removePrivateException(areas.session, ctx.incognitoTabId, videoId);
        const rest = sync.syncedExceptions().filter((e) => e.videoId !== videoId);
        await placeExceptions(rest, [videoId]);
      }),

    /** Activity events. Nothing is recorded for private windows. */
    recordActivity: (events: ActivityEvent[], ctx?: PrivacyContext): Promise<void> =>
      task(async () => {
        if (isPrivate(ctx)) return;
        await appendActivity(areas.local, events);
      }),

    markActivitySeen: (ids: string[]): Promise<void> => task(() => markActivitySeen(areas.local, ids, now())),

    /** Daily counters. Private windows count in session storage so the Daily cap still holds. */
    bumpCounters: (day: string, delta: Partial<DayCounters>, ctx?: PrivacyContext): Promise<DayCounters> =>
      task(() => (isPrivate(ctx) ? bumpPrivateCounters(areas.session, day, delta) : bumpLocalCounters(areas.local, day, delta))),

    recordRuleHits: (hits: { ruleId: string; at: number; n?: number }[], ctx?: PrivacyContext): Promise<void> =>
      task(async () => {
        if (isPrivate(ctx)) return;
        await recordRuleHits(areas.local, hits);
      }),

    /** Escalation counts. A no-op returning the stored records for private windows. */
    updateEscalation: (fn: (all: Record<string, EscalationRecord>) => Record<string, EscalationRecord>, ctx?: PrivacyContext): Promise<EscalationStore> =>
      task(() => (isPrivate(ctx) ? getEscalation(areas.local) : updateLocalEscalation(areas.local, fn))),

    /** Failure counters (`local:runtime`). A no-op returning the stored state for private windows (Section 8). */
    updateRuntime: (fn: (state: FailureState) => FailureState, ctx?: PrivacyContext): Promise<FailureState> =>
      task(async () => {
        if (isPrivate(ctx)) return getRuntime(areas.local);
        const next = fn(await getRuntime(areas.local));
        await setRuntime(areas.local, next);
        return next;
      }),

    /** Verdict cache writes. Never for private windows. */
    putVerdicts: (puts: VerdictPut[], ctx?: PrivacyContext): Promise<void> =>
      task(async () => {
        if (isPrivate(ctx)) return;
        await putVerdicts(areas.local, puts);
      }),

    /** Rules without tombstones and every Exception (archive included). Never the key, settings or Activity. */
    exportData: (): Promise<ShooExport> =>
      task(async () => ({
        format: 'shoo-rules' as const,
        version: 1 as const,
        exportedAt: new Date(now()).toISOString(),
        rules: sortByRef(sync.liveRules()),
        exceptions: await allExceptions(),
      })),

    /**
     * Validates the file, returns the preview, and unless `dryRun` merges (new ids added, same id with a
     * newer `updatedAt` wins) or replaces (every Rule and Exception not in the file is removed on every
     * device). Ref collisions are renumbered and recorded in Activity. The dry run runs the same quota
     * check (`syncQuota` in the preview) and, for replace, counts what would be removed.
     */
    importData: (file: unknown, mode: 'merge' | 'replace', dryRun: boolean): Promise<{ preview: ImportPreview } | { error: 'invalidInput'; detail: string }> =>
      task(async () => {
        const parsed = parseImportFile(file, now());
        if (!parsed.ok) return { error: 'invalidInput' as const, detail: parsed.detail };
        const at = sync.ruleTime(now());
        const current = sync.allRules();
        const liveIds = new Set(current.filter((r) => r.deletedAt === undefined).map((r) => r.id));
        // Replace clears every Rule not updated after `clearedAt`, so it needs no tombstones that could overflow.
        const clearedAt = mode === 'replace' ? Math.max(at, ...current.map((r) => r.updatedAt)) : undefined;
        const stamp = clearedAt === undefined ? at : clearedAt + 1;
        const byId = new Map(mode === 'merge' ? current.map((r) => [r.id, r]) : []);
        let add = 0;
        let update = 0;
        for (const r of parsed.value.rules) {
          const existing = byId.get(r.id);
          // Merge: same id with a newer updatedAt wins, so an old backup never revives a later delete.
          if (existing && r.updatedAt <= existing.updatedAt) continue;
          if (mode === 'replace' ? liveIds.has(r.id) : existing !== undefined && existing.deletedAt === undefined) update++;
          else add++;
          // Stamped now so the imported version also wins the sync merge on other devices.
          byId.set(r.id, { ...r, updatedAt: Math.max(stamp, (existing?.updatedAt ?? 0) + 1) });
        }
        const resolved = resolveRefCollisions([...byId.values()], countersCovering([...byId.values()], sync.counters()), stamp);
        const resolvedLive = new Set(resolved.rules.filter((r) => r.deletedAt === undefined).map((r) => r.id));
        const renumbered = resolved.renumbered.filter((x) => resolvedLive.has(x.ruleId));
        const preview: ImportPreview = { add, update, renumber: renumbered.length, invalid: parsed.value.invalid };
        const currentExceptions = await allExceptions();
        if (mode === 'replace') {
          const fileRules = new Set(parsed.value.rules.map((r) => r.id));
          const fileExceptions = new Set(parsed.value.exceptions.map((x) => x.videoId));
          preview.remove = {
            rules: [...liveIds].filter((id) => !fileRules.has(id)).length,
            exceptions: currentExceptions.filter((x) => !fileExceptions.has(x.videoId)).length,
          };
        }
        if (!sync.fits(resolved.rules)) return dryRun ? { preview: { ...preview, syncQuota: true as const } } : { error: 'invalidInput' as const, detail: 'syncQuota' };
        if (dryRun) return { preview };

        const counters = countersCovering(resolved.rules, resolved.counters);
        if (!(await sync.commitRules(resolved.rules, counters, clearedAt === undefined ? {} : { clearedAt }))) return { error: 'invalidInput' as const, detail: 'syncQuota' };

        if (mode === 'replace') await placeExceptions(parsed.value.exceptions, [], { newEpoch: true });
        else {
          const candidates = new Map<string, Exception>(currentExceptions.map((x) => [x.videoId, x]));
          for (const imported of parsed.value.exceptions) {
            // An Exception removed since the backup would be deleted again by its removal record.
            const x = { ...imported, at: Math.max(imported.at, sync.exceptionFloor(imported.videoId)) };
            const prev = candidates.get(x.videoId);
            if (!prev || x.at >= prev.at) candidates.set(x.videoId, x);
          }
          await placeExceptions([...candidates.values()]);
        }
        await recordRenumbered(renumbered);
        deps.onRulesChanged?.(sortByRef(sync.liveRules()));
        return { preview };
      }),

    /**
     * Reset (REQ-SET-1): every Rule and Exception is removed on every device through the `rulesClearedAt`
     * watermark and a new `excEpoch` (they always fit, however many there were), and storage.local (key,
     * Activity, Verdict cache, archive, stats) and storage.session are emptied. Ref counters survive, so
     * refs are never reused. `syncPending` is true when a rate limit deferred the sync write: the outbox
     * keeps it across a restart.
     */
    resetAll: (): Promise<{ syncPending: boolean }> =>
      task(async () => {
        const at = now();
        const generation = (await getSettings(areas.local)).generation + 1;
        const clearedAt = Math.max(sync.ruleTime(at), ...sync.allRules().map((r) => r.updatedAt));
        await sync.commitRules([], sync.counters(), { clearedAt });
        await sync.commitExceptions([], [], { newEpoch: true });
        const synced = await sync.flush();
        // Everything but the outbox, which is the only copy of the Reset while the sync write is deferred,
        // and the floor, which lets this device repair a sync:meta a stale device overwrites later.
        const keys = Object.keys(await areas.local.get(null)).filter((k) => k !== OUTBOX_KEY && k !== FLOOR_KEY);
        if (keys.length > 0) await areas.local.remove(keys);
        await areas.session.clear();
        await areas.local.set({ [META_KEY]: { schema: SCHEMA } });
        await setSettings(areas.local, { ...DEFAULT_SETTINGS, generation });
        deps.onRulesChanged?.([]);
        return { syncPending: !synced };
      }),

    /** The daily `shoo:retention` alarm: local retention plus purging Rule tombstones older than 30 days. */
    runRetention: (): Promise<void> =>
      task(async () => {
        const at = now();
        await pruneRetention(areas.local, at);
        const rules = sync.allRules();
        const kept = rules.filter((r) => r.deletedAt === undefined || at - r.deletedAt <= TOMBSTONE_TTL_MS);
        if (kept.length !== rules.length) await sync.commitRules(kept, sync.counters());
      }),

    /** Local day key for counters ('YYYY-MM-DD'). */
    today: (): string => dayKey(now()),
  };
}
