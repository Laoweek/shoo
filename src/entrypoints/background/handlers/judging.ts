// judgeTiles with its tileVerdicts push and tileVerdictsPending, tryTitle, getRuntimeState and the content reports that feed RuntimeState
// (reviewPending, reportMarkupCheck) or Activity (recordWouldRemove). judgeTiles also records Rescues by Keep rules
// in Activity.
// Source of truth: docs/spec/architecture.md Sections 5 (pipeline, Counting), 6 and 7,
// docs/spec/decision-engine.md Sections 7.5 and 8.3.
import { channelKey } from '~/core/channel';
import { dayKey, escalationKey } from '~/core/escalation';
import { SURFACE_SITE } from '~/core/sites';
import { newId } from '~/core/ids';
import type { ActivityEvent, ReasonCode, Rule, Settings, TileFacts, TileResult } from '~/core/types';
import type { RuleDisplay } from '~/messaging/protocol';
import { TRY_TITLE_MAX_CHARS } from '~/engine/judge';
import { ACTIVITY_TITLE_MAX, queryActivity, type JudgedTile } from '~/store/local';
import { isBool, isNonEmpty, isNum, isRecord, isShortStr, isSite, isStr, isTileList, isWouldRemoveList, isWouldRemoveTiles, optional } from '../guards';
import { InvalidInput, type Routes, type Sender } from '../router';
import type { Services } from '../services';

const HIT_MEMO_MAX = 5000;
/** keptByRule Activity events per day at most, so a broad Keep rule cannot crowd Removals out of the 3 MB cap. */
export const KEPT_BY_RULE_DAY_MAX = 100;
/** Try a title: longer input is invalidInput, so a page bug cannot send an arbitrarily long, paid title. */
const TRY_CHANNEL_MAX_CHARS = 120;
/** Ids content sends (batch, Rule, selector version) are UUIDs or short names. Longer ones are invalidInput. */
const ID_MAX_CHARS = 64;
export const isShortId = (v: unknown): v is string => isStr(v) && v.length <= ID_MAX_CHARS;

// The bookkeeping each judgeTiles reply leaves running, per background.
const bookkeeping = new WeakMap<Services, Promise<void>>();
/** Settles once the bookkeeping of every judgeTiles reply so far has finished. */
export const judgingSettled = (s: Services): Promise<void> => bookkeeping.get(s) ?? Promise.resolve();

export const truncateTitle = (t: string | undefined): string | undefined => (t === undefined ? undefined : t.slice(0, ACTIVITY_TITLE_MAX));

/** ref, text, Rule name and colour for every ruleId in the results (content holds no Rules). */
export function ruleDisplay(results: TileResult[], rules: Rule[]): Record<string, RuleDisplay> {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const out: Record<string, RuleDisplay> = {};
  for (const r of results) {
    const id = r.verdict?.ruleId;
    const rule = id ? byId.get(id) : undefined;
    if (!id || !rule || out[id]) continue;
    out[id] = { ref: rule.ref, text: rule.text, ...(rule.name && { name: rule.name }), ...(rule.colour && { colour: rule.colour }) };
  }
  return out;
}

export function judgingRoutes(
  s: Services,
): Pick<Routes, 'getRuntimeState' | 'judgeTiles' | 'tileVerdictsPending' | 'tryTitle' | 'recordWouldRemove' | 'reviewPending' | 'reportMarkupCheck'> {
  const { writer, state } = s;
  // `<tabId> <batchId>` of each batch whose tileVerdicts push has not gone out yet. Memory only: a background that
  // stopped holds none, so content then sends those Tiles again.
  const pushing = new Set<string>();
  // Rule hits are counted at judge time (Counting, Section 5), once per Rule, video and day. A rescan after
  // settingsChanged re-sends the same Tiles, so this memo keeps them from counting twice. Memory only: a
  // background restart can count a video again, which only nudges the hit count.
  const hitMemo = new Set<string>();
  // Rescues go to Activity once per Keep rule, video and day, at most KEPT_BY_RULE_DAY_MAX a day
  // (REQ-ACTV-1). Seeded from the day's Activity the first time a day needs it, so a background restart does not
  // record the same keep again. A failed read is not kept, so the next batch reads again.
  let keptByRule: { day: string; seen: Promise<Set<string>> } | undefined;
  const keptOn = (day: string): Promise<Set<string>> => {
    if (keptByRule?.day !== day) {
      const entry = {
        day,
        seen: queryActivity(s.platform.areas.local, { fromDay: day, toDay: day, kinds: ['keptByRule'] }).then(
          (events) => new Set(events.map((e) => `${e.ruleId}|${e.videoId}`)),
        ),
      };
      entry.seen.catch(() => {
        if (keptByRule === entry) keptByRule = undefined;
      });
      keptByRule = entry;
    }
    return keptByRule.seen;
  };

  /**
   * Escalation counts, Rule hits and Rescues of one batch. The writes are queued before the first await, so they
   * keep their order with the batch's later reports even though the reply does not wait for them.
   */
  async function countJudged(results: TileResult[], items: TileFacts[], sender: Sender, settings: Settings): Promise<void> {
    if (sender.incognito) return;
    const day = writer.today();
    const facts = new Map(items.map((t) => [t.videoId, t]));
    const decided = results.filter((r) => r.status === 'decided');
    const writes: Promise<void>[] = [];

    // Escalation: each (channelKey, videoId) once per day when the pipeline decided the Tile. Nothing while Off.
    if (settings.escalationMode !== 'off') {
      const judged: JudgedTile[] = [];
      for (const r of decided) {
        const t = facts.get(r.videoId);
        if (!t?.channelName?.trim()) continue;
        judged.push({ key: escalationKey(channelKey(t.channelName), SURFACE_SITE[t.surface]), videoId: t.videoId });
      }
      if (judged.length > 0) writes.push(writer.recordEscalationJudged(day, judged));
    }

    // ruleStats: remove Rule hits, and Keep rule hits for Rescues only (a keep that beat a removal, REQ-RULE-6).
    const at = s.now();
    const hits: { ruleId: string; at: number }[] = [];
    for (const r of decided) {
      const id = r.verdict?.ruleId;
      if (!id || (r.verdict?.outcome === 'keep' && !r.verdict.rescuedFrom)) continue;
      const memo = `${day}|${id}|${r.videoId}`;
      if (hitMemo.has(memo)) continue;
      if (hitMemo.size >= HIT_MEMO_MAX) hitMemo.clear();
      hitMemo.add(memo);
      hits.push({ ruleId: id, at });
    }
    if (hits.length > 0) writes.push(writer.recordRuleHits(hits));
    await Promise.all(writes);

    // Activity: Rescues, Tiles a Keep rule (exact or Topic) kept from a removal. Recorded as seen, so they never light up like Removals.
    const keeps = decided.filter((r) => r.verdict?.outcome === 'keep' && r.verdict.source === 'keepRule' && r.verdict.ruleId && r.verdict.rescuedFrom);
    if (keeps.length === 0) return;
    // Read the clock once, with no await before keptOn, so the events are filed under the day they are deduplicated on.
    const keptAt = s.now();
    const seen = await keptOn(dayKey(keptAt));
    const events: ActivityEvent[] = [];
    const added: string[] = [];
    for (const r of keeps) {
      const ruleId = r.verdict!.ruleId!;
      const key = `${ruleId}|${r.videoId}`;
      if (seen.has(key)) continue;
      if (seen.size >= KEPT_BY_RULE_DAY_MAX) break;
      seen.add(key);
      added.push(key);
      const f = facts.get(r.videoId);
      events.push({
        id: newId(),
        kind: 'keptByRule',
        at: keptAt,
        seenAt: keptAt,
        videoId: r.videoId,
        ruleId,
        source: 'keepRule',
        ...(f && { title: truncateTitle(f.title)!, surface: f.surface }),
        ...(f?.channelName && { channelName: f.channelName, channelKey: channelKey(f.channelName) }),
        ...(f?.cover && { cover: f.cover }),
      });
    }
    if (events.length === 0) return;
    try {
      await writer.recordActivity(events, s.privacy(sender));
    } catch (e) {
      // Not saved: let a later batch record them.
      for (const key of added) seen.delete(key);
      throw e;
    }
  }

  return {
    getRuntimeState: {
      from: 'both',
      valid: () => true,
      async run(_req, sender) {
        void s.ensureInit().catch(() => undefined);
        const tabId = sender.kind === 'content' ? sender.tabId : await state.activeTabId();
        return state.snapshot(tabId);
      },
    },

    judgeTiles: {
      from: 'content',
      valid: (v) => isRecord(v) && isTileList(v.items) && isNum(v.settingsGeneration) && optional(v.batchId, isShortId),
      async run({ items, batchId }, sender) {
        // The judge takes a batch's Rules from its Site, so every Tile must come from the sender's Site.
        if (items.some((t) => SURFACE_SITE[t.surface] !== sender.site)) throw new InvalidInput('judgeTiles');
        await s.ensureInit();
        const base = await state.gather();
        const before = state.forTab(base, sender.tabId);
        let results: TileResult[];
        let later: Promise<TileResult[]> | undefined;
        let rulesVersion = before.rulesVersion;
        const undecided = (reason: ReasonCode, list: { videoId: string }[] = items): TileResult[] => list.map((t) => ({ videoId: t.videoId, status: 'undecided', reason }));
        // Storage threw (judge side effects after paid calls are already guarded inside the judge).
        const failed = (e: unknown, list?: { videoId: string }[]) => {
          s.platform.log?.('judgeFailed', { name: e instanceof Error ? e.name : 'unknown' });
          return undecided('modelError', list);
        };
        if (!before.stages.exact) {
          // Off, migrating, youtube.com revoked or the markup breaker: nothing is judged.
          results = undecided(before.reason as ReasonCode);
        } else {
          const end = state.startJudging(base, sender.tabId);
          try {
            const out = await s.judge.judgeTiles(items, s.judgeContext(sender));
            results = out.results;
            rulesVersion = out.rulesVersion;
            const waiting = results.filter((r) => r.reason === 'thumbnailPending');
            // The tab shows 'judging' until the thumbnail checks end.
            later = out.later?.catch((e: unknown) => failed(e, waiting)).finally(end);
          } catch (e) {
            results = failed(e);
          } finally {
            if (!later) end();
          }
        }
        const reply = async (list: TileResult[]) => ({
          results: list,
          rulesVersion,
          // The generation the results were judged under, so content drops this reply after a settings
          // change made while it was in flight.
          settingsGeneration: base.settings.generation,
          runtime: await state.snapshot(sender.tabId),
          rules: ruleDisplay(list, await writer.getRules()),
          private: sender.incognito,
        });
        // Neither the reply nor the tileVerdicts push waits for the bookkeeping, only for a fresh snapshot (a
        // breaker may have tripped). Each Tile's result is in the reply or in the push, never both.
        const count = (list: TileResult[]) =>
          countJudged(list, items, sender, base.settings)
            .catch(() => s.platform.log?.('countJudgedFailed'))
            .then(() => state.refresh(sender.tabId))
            .then(
              () => undefined,
              () => s.platform.log?.('refreshFailed'),
            );
        const key = `${sender.tabId} ${batchId}`;
        if (later && batchId !== undefined) pushing.add(key);
        // A tab that closed or navigated away has nothing waiting for it.
        const push = (list: TileResult[]) =>
          batchId === undefined
            ? undefined
            : reply(list)
                .then((r) => s.platform.sendToTab('tileVerdicts', { batchId, ...r }, sender.tabId!))
                .catch(() => undefined)
                .finally(() => pushing.delete(key));
        const done = Promise.all([count(results), later?.then((list) => Promise.all([count(list), push(list)]))]);
        bookkeeping.set(s, Promise.all([judgingSettled(s), done]).then(() => undefined));
        return reply(results);
      },
    },

    tileVerdictsPending: {
      from: 'content',
      valid: (v) => isRecord(v) && isShortId(v.batchId),
      run: async ({ batchId }, sender) => pushing.has(`${sender.tabId} ${batchId}`),
    },

    tryTitle: {
      from: 'page',
      valid: (v) =>
        isRecord(v) &&
        isNonEmpty(v.title) &&
        v.title.length <= TRY_TITLE_MAX_CHARS &&
        optional(v.channelName, (c) => isStr(c) && c.length <= TRY_CHANNEL_MAX_CHARS) &&
        optional(v.durationSec, (d) => isNum(d) && d >= 0) &&
        optional(v.thumbnailUrl, isShortStr) &&
        optional(v.site, isSite),
      invalid: { error: 'invalidInput' },
      async run(req) {
        await s.ensureInit();
        // The judge checks consent, key and host through modelAllowed with the daily cap and model breaker
        // ignored, never reads or writes the Verdict cache, and adds the cost to today's counters.
        const out = await s.judge.tryTitle(req, { private: false });
        await state.refresh();
        return out;
      },
    },

    recordWouldRemove: {
      from: 'content',
      // Larger than a batch: a Review → Dry-run switch reports every flagged Tile on the page at once.
      valid: (v) =>
        isRecord(v) &&
        isWouldRemoveList(v.results) &&
        v.results.every((r) => optional(r.verdict?.ruleId, isShortId)) &&
        isShortId(v.batchId) &&
        optional(v.tiles, isWouldRemoveTiles),
      async run({ results, batchId, tiles }, sender) {
        const facts = new Map((tiles ?? []).map((t) => [t.videoId, t]));
        const at = s.now();
        const events: ActivityEvent[] = [];
        for (const r of results) {
          const v = r.verdict;
          if (!v || v.outcome !== 'remove') continue;
          const f = facts.get(r.videoId);
          const e: ActivityEvent = { id: newId(), kind: 'wouldRemove', at, videoId: r.videoId, mode: 'dryRun', batchId, source: v.source };
          if (f) {
            e.title = truncateTitle(f.title)!;
            e.surface = f.surface;
            if (f.channelName) {
              e.channelName = f.channelName;
              e.channelKey = channelKey(f.channelName);
            }
            if (f.cover) e.cover = f.cover;
          }
          if (v.ruleId) e.ruleId = v.ruleId;
          if (v.probability !== undefined) e.p = v.probability;
          if (v.nativeAction) e.nativeAction = v.nativeAction;
          events.push(e);
        }
        if (events.length > 0) await writer.recordActivity(events, s.privacy(sender));
      },
    },

    reviewPending: {
      from: 'content',
      valid: (v) => isRecord(v) && isNum(v.count) && v.count >= 0,
      async run({ count }, sender) {
        if (sender.tabId !== undefined) await state.setReviewPending(sender.tabId, Math.floor(count));
      },
    },

    reportMarkupCheck: {
      from: 'content',
      valid: (v) => isRecord(v) && isBool(v.ok) && isStr(v.selectorVersion) && Array.isArray(v.missing) && v.missing.every(isStr),
      async run({ ok }, sender) {
        // Counted from private windows too: the counters hold no browsing data, and a markup change must
        // trip the breaker whichever window sees it (REQ-COST-4).
        if (ok) await state.success('markup');
        else await state.failure('markup', undefined, sender.site);
        return state.refresh(sender.tabId);
      },
    },
  };
}
