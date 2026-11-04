// The content pipeline, the same on every Site (docs/spec/architecture.md Sections 5, 7 and 11,
// youtube-integration.md Sections 2-7). Content finds, extracts, decorates, batches and acts. It holds no Rules and
// makes no decisions: the background judges every Tile and owns every write, failure counter and the Daily cap.
//
//   watcher (eligible Tiles) → batcher (16 Tiles or 400 ms) → judgeTiles → `judged` → Mode gate
//     auto + remove    → NativeActionQueue, once per videoId per page → reportActionResult, summary, annotation
//     review + remove  → Review chip: Remove → queue (origin 'review'), Keep → addException, Always keep this channel
//     dryRun + remove  → Dry-run label + recordWouldRemove
//
// Freshness. Every settingsChanged starts a new epoch and re-sends every decorated or pending Tile still on the page
// (watcher.rescan({ all })). A judgeTiles reply is dropped when its settingsGeneration is older than the latest seen,
// or when it was sent before the latest settingsChanged: Exact rule and Exception edits do not change rulesVersion,
// so the versions alone cannot tell such a reply apart. The Tiles it held were re-sent by that rescan.
//
// Undo ownership. The background is the one owner of the `undone` Activity event and the Exception, recorded when
// it receives reportUndo({ via }). Content never calls addException for an Undo that happened:
//   via 'site' when the site's own Undo restored a Tile Shoo removed (onSiteUndo),
//   via 'shoo' when content clicked Undo itself (annotation Keep, summary Undo all, and an undoRemoval request from
//   the background for Activity's Undo, which is answered ok / expired / notFound and followed by reportUndo on ok).
// The annotation's Keep when Undo is no longer possible stores the Exception alone (addException, origin 'undo').
//
// The user's own Don't recommend channel (REQ-ACT-5, the Site's watchUserBans) sends banChannel. The site's Undo on
// that Tile sends liftChannelBan for a ban it added, never reportUndo: the Removal was the user's, so no Exception.
import { SURFACE_SITE } from '~/core/sites';
import { SHELF_IDS, type Mode, type RuntimeSnapshot, type ShelfId, type SiteId, type SurfaceId, type TileFacts, type TileResult, type Verdict } from '~/core/types';
import type { RuleDisplay } from '~/messaging/protocol';
import { surfaceOf, type ShelfWatcher, type Site } from '~/sites/site';
import type { MomentSource, SummaryRule } from '~/ui/in-page';
import { createActionQueue, type ActionJob, type ActionOutcome, type NativeActionQueue } from './actions';
import { createBatcher, type Batcher } from './batcher';
import { createNotices, MODEL_FAILURE_REASONS, OPENROUTER_CREDITS_URL, type Notices } from './notices';
import { withRetry, type Send } from './send';
import { createPageUi, type PageUi } from './ui';
import { createWatcher, type DecorState, type MarkupCheck, type TileItem, type Watcher, type WatcherOptions } from './watcher';

/** A batch summary keeps collecting Removals while it can still be showing (6 s open + 30 s pill). */
export const SUMMARY_SPAN_MS = 36_000;
/** Pause before a stale Auto job with a still-fresh Verdict is tried once more. */
export const STALE_RETRY_MS = 1000;
/** A chip or label whose Tile shows no video while the site re-renders it is looked at once more after this pause. */
export const REMOUNT_RETRY_MS = 500;

export interface PipelineDeps {
  doc: Document;
  /** The Site this content script runs on. */
  site: Site;
  /** Raw messenger. The pipeline adds the one retry itself. */
  send: Send;
  ui?: PageUi;
  /** Watcher test seams (frame scheduler, IntersectionObserver factory). */
  watcher?: Pick<WatcherOptions, 'schedule' | 'intersection'>;
  newId?: () => string;
  now?: () => number;
  openUrl?: (url: string) => void;
}

export interface Pipeline {
  apply(snapshot: RuntimeSnapshot): void;
  settingsChanged(req: { settingsGeneration: number; rulesVersion: string; actOnShowingChips?: boolean }): void;
  undoRemoval(req: { videoId: string }): Promise<{ ok: true } | { ok: false; reason: 'expired' | 'notFound' }>;
  /** Tear everything down (extension context invalidated). */
  dispose(): void;
  readonly running: boolean;
  readonly ui: PageUi;
}

interface Judged {
  result: TileResult;
  rulesVersion: string;
  settingsGeneration: number;
  epoch: number;
}

interface SummaryState {
  batchId: string;
  count: number;
  rules: Map<string, SummaryRule>;
  videos: string[];
  /** Channels an automatic Escalation banned during this batch (REQ-ESC-2). */
  escalated: string[];
  last: number;
}

type Level = 'off' | 'noticeOnly' | 'run';

/** Shoo works somewhere on this Site. A Site the user turned off has every Surface off in the snapshot. */
export const worksOn = (s: RuntimeSnapshot, site: SiteId): boolean =>
  Object.entries(s.surfaces).some(([id, on]) => on && SURFACE_SITE[id as SurfaceId] === site);

// Off on this Site is off: chips and labels go, queued Native actions are cancelled.
const levelOf = (s: RuntimeSnapshot, site: SiteId): Level =>
  !s.enabled || s.reason === 'off' || !s.stages.ui || !worksOn(s, site) ? 'off' : !s.stages.exact && !s.stages.model ? 'noticeOnly' : 'run';

const isRemove = (r: TileResult | undefined): r is TileResult & { verdict: Verdict } =>
  r?.status === 'decided' && r.verdict?.outcome === 'remove';

export function createPipeline(deps: PipelineDeps): Pipeline {
  const { doc, site } = deps;
  const send = withRetry(deps.send);
  const ui = deps.ui ?? createPageUi(doc, site);
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const now = deps.now ?? Date.now;
  const openUrl = deps.openUrl ?? ((url: string) => void window.open(url, '_blank', 'noopener'));

  let snap: RuntimeSnapshot | null = null;
  let latest = { gen: -1, rulesVersion: '' };
  let epoch = 0;
  let actOnChipsEpoch = -1; // the popup confirmed "Remove the N flagged videos now?" for this epoch
  const judged = new Map<string, Judged>();
  const facts = new Map<string, TileFacts>();
  const rules = new Map<string, RuleDisplay>();
  let privateWindow = false;
  const kept = new Set<string>(); // kept in this tab (Keep, Undo): never act or ask again

  // Running state, rebuilt on every start.
  let level: Level = 'off';
  let run = 0; // bumps on start and stop: replies from an older run are ignored
  let watcher: Watcher | null = null;
  let actions: NativeActionQueue | null = null;
  let batcher: Batcher<TileItem> | null = null;
  let stopUserBans: (() => void) | null = null;
  let surfacesKey = '';
  let shelves: ShelfWatcher | null = null; // only while a Shelf dismissal is on and the Mode acts
  const inflight = new Map<string, number>(); // videoId → epoch it was sent in

  // Per page: reset on navigation.
  let actingByVideo = new Map<string, Promise<ActionOutcome['status']>>(); // Auto: once per videoId per page
  let staleRetried = new Set<string>(); // Auto: a job that went stale with a fresh Verdict is tried once more
  let wouldRecorded = new Set<string>();
  let summary: SummaryState | null = null;
  let focusLost = new WeakSet<Element>();
  let userBans = new Map<string, Promise<string | undefined>>(); // videoId → ruleId of the ban banChannel added

  let wouldBuffer: TileResult[] = [];
  let precheckSnap: Promise<RuntimeSnapshot | null> | null = null;
  let sentPending = 0;
  let pendingScheduled = false;

  const notices: Notices = createNotices(ui, {
    openSettings: () => void send('openSettings', {}).catch(() => undefined),
    retryModel: () => void send('resumeFromBreaker', { category: 'model' }).then(apply, () => undefined),
    openOpenRouter: () => openUrl(OPENROUTER_CREDITS_URL),
  });

  ui.onHostLost((el) => {
    restoreUi(el, true);
    chipsChanged();
  });

  // ---------- helpers ----------

  const decor = (el: Element) => watcher?.decor(el);
  const setDecor = (el: Element, s: DecorState) => watcher?.setDecor(el, s);
  const fresh = (j: Judged | undefined): j is Judged => j !== undefined && j.epoch === epoch;
  const effectiveMode = (): Mode => (snap && !snap.stages.nativeActions ? 'dryRun' : (snap?.mode ?? 'review'));
  const ruleOf = (v: Verdict): RuleDisplay => (v.ruleId && rules.get(v.ruleId)) || { ref: v.ruleRef ?? '', text: v.ruleRef ?? '' };
  const hasChannel = (f: TileFacts | undefined) => !!(f?.channelName || f?.channelHandle || f?.channelId);
  const focusTitle = (el: Element, surface: SurfaceId) => surfaceOf(site, surface).focusReturn(el)?.focus({ preventScroll: true });
  const elementsOf = (videoId: string) => watcher?.elementsFor(videoId) ?? [];

  function quiet<T>(p: Promise<T>): Promise<T | null> {
    return p.catch(() => null);
  }

  // reviewPending whenever the number of showing chips changes (coalesced per task).
  function chipsChanged(): void {
    if (pendingScheduled) return;
    pendingScheduled = true;
    queueMicrotask(() => {
      pendingScheduled = false;
      const count = level === 'run' ? ui.count('chip', site.visiblePage(doc)) : 0;
      if (count === sentPending) return;
      sentPending = count;
      void quiet(send('reviewPending', { count }));
    });
  }

  function clearUi(el: Element): void {
    const had = ui.kindOf(el) === 'chip';
    ui.clear(el);
    if (had) chipsChanged();
  }

  // ---------- Mode gate ----------

  /**
   * Decorate or act on one element from the judged entry of its video. `wasRemove`: the previous Verdict for this
   * video was already remove (so a Tile withdrawn to 'none' is not acted on retroactively).
   */
  function gate(el: Element, wasRemove = true): void {
    if (level !== 'run' || !watcher) return;
    const d = decor(el);
    const surface = watcher.surfaceOf(el);
    if (!d || !surface || !el.isConnected) return;
    if (d.state === 'acting' || d.state === 'removed' || d.state === 'annotated') return;
    const entry = judged.get(d.videoId);
    if (!entry) return;
    if (site.isPlayingOrQueued(el, d.videoId, doc)) {
      // REQ-SURF-3: the video started playing after it was extracted (watch-to-watch navigation). Never decorate or
      // act on it. 'pending': sent again by a later rescan, and extract() skips it while it plays.
      clearUi(el);
      setDecor(el, 'pending');
      return;
    }
    if (entry.result.status !== 'decided') {
      clearUi(el);
      setDecor(el, 'pending'); // re-sent on the next rescan
      return;
    }
    if (!isRemove(entry.result) || kept.has(d.videoId)) {
      if (ui.kindOf(el) !== 'kept') clearUi(el);
      setDecor(el, 'none');
      return;
    }
    const verdict = entry.result.verdict;
    const rule = ruleOf(verdict);
    switch (effectiveMode()) {
      case 'dryRun':
        if (ui.label(el, surface, { ruleRef: rule.ref, ruleName: rule.name, colour: rule.colour, ruleText: rule.text })) {
          setDecor(el, 'label');
          chipsChanged();
          bufferWould(entry.result);
        }
        return;
      case 'review':
        if (showChip(el, surface, d.videoId, verdict)) setDecor(el, 'chip');
        return;
      case 'auto':
        if (d.state === 'label') {
          clearUi(el); // Dry-run → Auto: labels withdrawn, nothing acted retroactively
          setDecor(el, 'none');
        } else if (d.state === 'chip') {
          if (actOnChipsEpoch === epoch && fresh(entry)) act(el, surface, d.videoId, verdict, 'auto');
          else if (!ui.isLive(el)) showChip(el, surface, d.videoId, verdict); // chips stay in Auto until confirmed
        } else if ((d.state === 'pending' || !wasRemove) && fresh(entry)) {
          act(el, surface, d.videoId, verdict, 'auto');
        }
        return;
    }
  }

  // The site destroyed a chip or label (re-render, Back navigation), or a scan met a decorated Tile without its UI:
  // mount it again from `judged`, without a new request. A different video in the element is a new Tile.
  function restoreUi(el: Element, retry: boolean): void {
    if (level !== 'run' || !watcher || ui.isLive(el)) return;
    const d = decor(el);
    const surface = watcher.surfaceOf(el);
    if (!d || !surface || !el.isConnected || (d.state !== 'chip' && d.state !== 'label')) return;
    const shown = surfaceOf(site, surface).videoId(el);
    if (shown === d.videoId) gate(el);
    else if (shown !== null) watcher.recheck(el); // reuse: the watcher resets the element and sends the new video
    else if (retry) {
      const thisRun = run;
      setTimeout(() => thisRun === run && restoreUi(el, false), REMOUNT_RETRY_MS); // content still rendering
    }
  }

  function regateAll(): void {
    ui.prune();
    for (const videoId of judged.keys()) for (const el of elementsOf(videoId)) gate(el);
    flushWould();
    chipsChanged();
  }

  function showChip(el: Element, surface: SurfaceId, videoId: string, verdict: Verdict): boolean {
    const rule = ruleOf(verdict);
    const f = facts.get(videoId);
    const ok = ui.chip(el, surface, {
      ruleRef: rule.ref,
      ruleName: rule.name,
      colour: rule.colour,
      ruleText: rule.text,
      probability: verdict.source === 'model' || verdict.source === 'modelThumbnail' ? verdict.probability : undefined,
      hasChannel: hasChannel(f),
      privateWindow,
      onRemove: () => {
        const cur = judged.get(videoId);
        if (decor(el)?.state === 'chip' && isRemove(cur?.result)) act(el, surface, videoId, cur.result.verdict, 'review');
      },
      onKeep: () => keepFromChip(el, videoId, verdict),
      onAlwaysKeepChannel: () => keepChannel(videoId),
      onEscape: () => focusTitle(el, surface),
      onNoteDone: (hadFocus) => {
        if (ui.kindOf(el) !== 'kept') return;
        ui.clear(el);
        if (hadFocus) focusTitle(el, surface);
      },
    });
    if (ok) chipsChanged();
    return ok;
  }

  function keepFromChip(el: Element, videoId: string, verdict: Verdict): void {
    kept.add(videoId);
    ui.markKept(el);
    setDecor(el, 'none');
    const f = facts.get(videoId);
    void quiet(send('addException', { videoId, title: f?.title ?? '', channelName: f?.channelName, ruleId: verdict.ruleId, origin: 'reviewKeep' }));
    // The Exception covers every copy of this video.
    for (const other of elementsOf(videoId)) if (other !== el) gate(other);
    chipsChanged();
  }

  function keepChannel(videoId: string): void {
    const f = facts.get(videoId);
    if (!hasChannel(f) || privateWindow) return;
    const channel = { channelName: f?.channelName, channelHandle: f?.channelHandle, channelId: f?.channelId, site: site.id };
    // The background confirms the new Keep rule with settingsChanged, which re-judges the page. A Banned channel
    // gets nothing until the caller answers (ruleId ''). There is no in-page prompt, so keep the ban: the Keep
    // rule already beats it, and nothing is deleted without asking.
    void quiet(send('keepChannel', channel)).then((res) => {
      if (res && !('error' in res) && res.ruleId === '') void quiet(send('keepChannel', { ...channel, liftBan: false }));
    });
  }

  // The background's settingsChanged after a new ban re-judges the page, so the channel's other Tiles follow the Mode.
  function banChannel(tileEl: Element, f: TileFacts): void {
    if (privateWindow || !hasChannel(f)) return;
    userBans.set(
      f.videoId,
      quiet(send('banChannel', { tile: f })).then((res) => (res && 'added' in res && res.added ? res.ruleId : undefined)),
    );
    actions?.watchRemoval({ tileEl, videoId: f.videoId, surface: f.surface, nativeAction: 'dontRecommendChannel', origin: 'user' });
  }

  /** The site's Undo restored a Tile the user removed: the video is kept in this tab and a ban it added is lifted. */
  function liftBan(videoId: string): void {
    kept.add(videoId);
    for (const el of elementsOf(videoId)) gate(el);
    const added = userBans.get(videoId);
    userBans.delete(videoId);
    void added?.then((ruleId) => {
      if (ruleId) void quiet(send('liftChannelBan', { ruleId, videoId }));
    });
  }

  function bufferWould(result: TileResult): void {
    if (wouldRecorded.has(result.videoId)) return;
    wouldRecorded.add(result.videoId);
    wouldBuffer.push(result);
  }

  function flushWould(): void {
    if (wouldBuffer.length === 0) return;
    const results = wouldBuffer;
    wouldBuffer = [];
    const tiles = results.map((r) => facts.get(r.videoId)).filter((f): f is TileFacts => f !== undefined);
    void quiet(send('recordWouldRemove', { results, batchId: newId(), tiles }));
  }

  // ---------- NativeActionQueue hand-off ----------

  function act(el: Element, surface: SurfaceId, videoId: string, verdict: Verdict, origin: 'auto' | 'review'): void {
    if (!actions) return;
    const first = actingByVideo.get(videoId);
    if (first && origin === 'auto') {
      // Another copy of this video is already acting or removed on this page: annotate this one when it lands.
      setDecor(el, 'acting');
      const thisRun = run;
      void first.then((status) => {
        if (thisRun !== run || decor(el)?.state !== 'acting') return;
        if (status === 'ok') setDecor(el, duplicateNote(el, surface, verdict) ? 'annotated' : 'none');
        else if (status === 'failed') setDecor(el, 'none'); // one failure per video, the Tile stays as the site shows it
        else {
          // The first copy did not act (Mode changed, re-judging): this copy follows the same gate again.
          setDecor(el, 'pending');
          gate(el);
          flushWould();
        }
      });
      return;
    }
    setDecor(el, 'acting');
    const job: ActionJob = { tileEl: el, videoId, surface, nativeAction: verdict.nativeAction ?? 'notInterested', verdict, origin };
    // A chip in the page-level overlay sits outside the Tile: tell focus safety it is this job's own chip.
    if (origin === 'review') job.chipHost = ui.hostOf(el);
    const rect = el.getBoundingClientRect();
    const queue = actions;
    const thisRun = run;
    const outcome = queue.enqueue(job);
    const status = outcome.then((o) => o.status);
    if (origin === 'auto') actingByVideo.set(videoId, status);
    void outcome.then((o) => {
      if (o.status !== 'ok' && actingByVideo.get(videoId) === status) actingByVideo.delete(videoId);
      if (queue.size() === 0) precheckSnap = null;
      if (thisRun === run) onOutcome(el, o, rect);
      else afterStop(queue, o);
    });
  }

  // Shoo was turned off while this job was already clicking: the site got the signal, so the background still
  // counts it (or the failure). No UI, and the Undo watch the queue started for it ends now.
  function afterStop(queue: NativeActionQueue, o: ActionOutcome): void {
    const { job } = o;
    if (o.status === 'ok') void quiet(send('reportActionResult', okReport(job, newId())));
    else if (o.status === 'failed') void quiet(send('reportActionResult', failReport(job, o)));
    queue.navigated();
  }

  function okReport(job: ActionJob, batchId: string) {
    const verdict = job.verdict as Verdict;
    const f = facts.get(job.videoId);
    return {
      ok: true as const,
      videoId: job.videoId,
      surface: job.surface,
      ruleId: verdict.ruleId,
      nativeAction: job.nativeAction,
      batchId,
      title: f?.title ?? '',
      channelName: f?.channelName,
      channelHandle: f?.channelHandle,
      channelId: f?.channelId,
      cover: f?.cover,
      source: verdict.source,
      p: verdict.probability,
      mode: snap?.mode,
    };
  }

  function failReport(job: ActionJob, o: Extract<ActionOutcome, { status: 'failed' }>) {
    return {
      ok: false as const,
      videoId: job.videoId,
      surface: job.surface,
      nativeAction: job.nativeAction,
      step: o.step,
      selectorVersion: o.selectorVersion,
      title: facts.get(job.videoId)?.title,
      ruleId: job.verdict?.ruleId,
    };
  }

  function duplicateNote(el: Element, surface: SurfaceId, verdict: Verdict): boolean {
    const rule = ruleOf(verdict);
    return ui.duplicate(el, surface, { ruleRef: rule.ref, ruleName: rule.name, colour: rule.colour, ruleText: rule.text, hasChannel: false });
  }

  async function precheck(job: ActionJob): Promise<boolean> {
    precheckSnap ??= quiet(send('getRuntimeState', undefined));
    const s = await precheckSnap;
    if (!s || !s.enabled || !s.stages.nativeActions || !s.stages.ui) return false;
    if (job.origin !== 'review' && s.mode !== 'auto') return false;
    if (s.mode === 'dryRun') return false; // Dry-run: nothing reaches the site, not even a Remove the user clicked
    const entry = judged.get(job.videoId);
    return fresh(entry) && isRemove(entry.result) && !kept.has(job.videoId);
  }

  function onOutcome(el: Element, o: ActionOutcome, rect: DOMRect): void {
    const { job } = o;
    const verdict = job.verdict as Verdict;
    if (o.status === 'ok') {
      ui.clear(el); // the site's placeholder replaced or covered the Tile's content and its chip
      setDecor(el, 'removed');
      annotate(el, job, verdict);
      notices.nativeOk();
      const batchId = job.origin === 'auto' ? addToSummary(job.videoId, verdict, rect) : newId();
      void quiet(send('reportActionResult', okReport(job, batchId))).then((res) => {
        if (!res) return;
        const { escalated, ...s } = res;
        apply(s);
        if (escalated) summaryEscalated(batchId, escalated.channelName);
      });
      chipsChanged();
      return;
    }
    if (o.status === 'failed') {
      clearUi(el); // a failed Native action leaves the Tile as the site shows it (ui-design.md "In-page" states)
      setDecor(el, 'none');
      if (focusLost.has(el)) focusTitle(el, job.surface);
      notices.nativeFailed();
      void quiet(send('reportActionResult', failReport(job, o))).then((s) => s && apply(s));
      return;
    }
    if (o.status === 'duplicate') {
      // A Review Remove on a copy of a video already removed on this page.
      clearUi(el);
      setDecor(el, duplicateNote(el, job.surface, verdict) ? 'annotated' : 'none');
      return;
    }
    if (o.status === 'cancelled') {
      // Mode left Auto: this Tile now gets what the new Mode shows.
      setDecor(el, 'none');
      gate(el);
      flushWould();
      return;
    }
    // stale: the page changed, the precheck failed, or a settingsChanged made the Verdict old.
    if (!fresh(judged.get(job.videoId))) {
      setDecor(el, 'pending'); // re-judged, then gated again
      watcher?.rescan();
    } else if (effectiveMode() !== 'auto' || job.origin === 'review') {
      setDecor(el, 'none'); // the Native action breaker tripped or the Mode changed: show what the Mode shows
      gate(el);
      flushWouldLater();
    } else if (!staleRetried.has(job.videoId)) {
      // Precheck timeout or the user pressed the pointer on Shoo's menu: try once more after a pause.
      staleRetried.add(job.videoId);
      setDecor(el, 'pending');
      const thisRun = run;
      setTimeout(() => thisRun === run && gate(el), STALE_RETRY_MS);
    } else setDecor(el, 'none');
  }

  function flushWouldLater(): void {
    queueMicrotask(flushWould);
  }

  function annotate(el: Element, job: ActionJob, verdict: Verdict): void {
    const rule = ruleOf(verdict);
    const f = facts.get(job.videoId);
    const focusKeep = focusLost.has(el);
    focusLost.delete(el);
    const shown = ui.annotation(el, job.surface, {
      ruleRef: rule.ref,
      ruleName: rule.name,
      colour: rule.colour,
      ruleText: rule.text,
      hasChannel: hasChannel(f) && !privateWindow,
      // Shown on the page only, so the user can tell what was removed: never sent or logged.
      title: f?.title,
      channelName: f?.channelName,
      focusKeep,
      onKeep: () => void keepRemoved(el, job, verdict),
      onAlwaysKeepChannel: () => keepChannel(job.videoId),
    });
    if (!shown && focusKeep) focusTitle(el, job.surface);
  }

  // Annotation Keep: undo through the site's Undo. reportUndo records undone + the Exception. When Undo is no longer
  // possible the Exception alone keeps the video from coming back.
  async function keepRemoved(el: Element, job: ActionJob, verdict: Verdict): Promise<void> {
    if (!actions) return;
    const r = await actions.undo(job.videoId);
    kept.add(job.videoId);
    if (r === 'ok') {
      undone(job.videoId, el);
      void quiet(send('reportUndo', { videoId: job.videoId, via: 'shoo' }));
    } else {
      const f = facts.get(job.videoId);
      void quiet(send('addException', { videoId: job.videoId, title: f?.title ?? '', channelName: f?.channelName, ruleId: verdict.ruleId, origin: 'undo' }));
    }
  }

  /** A Removal was undone (any path): the Tile is back, kept for this tab. */
  function undone(videoId: string, el?: Element): void {
    kept.add(videoId);
    actingByVideo.delete(videoId);
    for (const e of el ? [el, ...elementsOf(videoId)] : elementsOf(videoId)) {
      const k = ui.kindOf(e);
      if (k === 'annotation' || k === 'duplicate') ui.clear(e);
      if (decor(e)) setDecor(e, 'none');
    }
    refreshSummary();
  }

  // ---------- batch summary (Auto) ----------

  function addToSummary(videoId: string, verdict: Verdict, rect: DOMRect): string {
    const t = now();
    const style = snap?.notificationStyle ?? 'summary';
    // perRemoval: the same component once per Removal (one at a time). silent: toolbar badge only.
    if (!summary || style !== 'summary' || t - summary.last > SUMMARY_SPAN_MS) summary = { batchId: newId(), count: 0, rules: new Map(), videos: [], escalated: [], last: t };
    const s = summary;
    s.last = t;
    s.count += 1;
    s.videos.push(videoId);
    const rule = ruleOf(verdict);
    const key = verdict.ruleId ?? rule.ref;
    const row = s.rules.get(key);
    s.rules.set(key, row ? { ...row, count: row.count + 1 } : { ruleRef: rule.ref, ruleName: rule.name, colour: rule.colour, ruleText: rule.text, count: 1 });
    const from: MomentSource[] = [{ rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, colour: rule.colour, ruleRef: rule.ref }];
    if (style !== 'silent') ui.summary(summaryData(s), from);
    return s.batchId;
  }

  function summaryData(s: SummaryState) {
    return {
      batchId: s.batchId,
      count: s.count,
      rules: [...s.rules.values()],
      escalated: s.escalated,
      undoAvailable: () => s.videos.some((v) => actions?.canUndo(v) ?? false), // asked at render time
      onReview: (batchId: string) => void quiet(send('openSettings', { hash: `activity?batch=${encodeURIComponent(batchId)}` })),
      onUndoAll: () => void undoAll(s),
    };
  }

  /** Update Undo availability on the summary if it still shows, however long it was held open (no reopening). */
  function refreshSummary(): void {
    if (summary && snap?.notificationStyle !== 'silent') ui.updateSummary(summaryData(summary));
  }

  /** An automatic Escalation from a Removal in this batch: the summary says so. */
  function summaryEscalated(batchId: string, channelName: string): void {
    if (summary?.batchId !== batchId || summary.escalated.includes(channelName)) return;
    summary.escalated.push(channelName);
    if (snap?.notificationStyle !== 'silent' && now() - summary.last <= SUMMARY_SPAN_MS) ui.summary(summaryData(summary));
  }

  async function undoAll(s: SummaryState): Promise<void> {
    for (const videoId of s.videos) {
      if (!actions?.canUndo(videoId)) continue;
      if ((await actions.undo(videoId)) !== 'ok') continue;
      undone(videoId);
      void quiet(send('reportUndo', { videoId, via: 'shoo' }));
    }
    refreshSummary();
  }

  // ---------- judging ----------

  function onTiles(batch: TileItem[]): void {
    ui.prune();
    for (const item of batch) {
      const { videoId } = item.facts;
      facts.set(videoId, item.facts);
      const entry = judged.get(videoId);
      // Re-rendered Tiles are decorated from `judged` without a new request.
      if (fresh(entry) && entry.result.status === 'decided') gate(item.el);
      else if (inflight.get(videoId) !== epoch) batcher?.add(item);
    }
    flushWould();
  }

  async function judge(items: TileItem[]): Promise<void> {
    const sentEpoch = epoch;
    const thisRun = run;
    const unique = new Map<string, TileFacts>();
    for (const it of items) if (inflight.get(it.facts.videoId) !== sentEpoch) unique.set(it.facts.videoId, it.facts);
    if (unique.size === 0) return;
    for (const v of unique.keys()) inflight.set(v, sentEpoch);
    const reply = await quiet(send('judgeTiles', { items: [...unique.values()], settingsGeneration: latest.gen }));
    for (const v of unique.keys()) if (inflight.get(v) === sentEpoch) inflight.delete(v);
    // A second failure leaves the Tiles 'pending': the next rescan sends them again.
    if (!reply || thisRun !== run) return;
    if (sentEpoch !== epoch) return; // stale: dropped, the settingsChanged rescan re-sent these Tiles
    if (reply.settingsGeneration < latest.gen) {
      watcher?.rescan(); // a newer generation came by runtimeStateChanged alone: send the pending Tiles again
      return;
    }
    if (reply.settingsGeneration > latest.gen) latest = { gen: reply.settingsGeneration, rulesVersion: reply.rulesVersion };
    // The reply's snapshot first, so its Tiles are gated in the Mode the background judged them for.
    apply(reply.runtime);
    if (thisRun !== run) return;
    for (const [id, r] of Object.entries(reply.rules ?? {})) rules.set(id, r);
    privateWindow = reply.private === true;

    let modelFailed = false;
    let modelOk = false;
    for (const result of reply.results) {
      const prev = judged.get(result.videoId);
      judged.set(result.videoId, { result, rulesVersion: reply.rulesVersion, settingsGeneration: reply.settingsGeneration, epoch });
      if (result.status === 'undecided' && result.reason && MODEL_FAILURE_REASONS.has(result.reason)) modelFailed = true;
      if (result.verdict?.source === 'model' || result.verdict?.source === 'modelThumbnail') modelOk = true;
      for (const el of elementsOf(result.videoId)) gate(el, isRemove(prev?.result));
    }
    flushWould();
    if (modelFailed) notices.modelFailed();
    else if (modelOk) notices.modelOk();
  }

  function onMarkupCheck(r: MarkupCheck): void {
    // An existing container with zero Tiles is a legitimate empty feed, not a markup failure.
    const page = site.visiblePage(doc);
    const missing = r.missing.filter((m) => {
      const [id, part] = m.split('.') as [SurfaceId, string];
      const def = site.surfaces[id];
      if (part !== 'tile' || !page || !def) return true;
      return def.containers(page).some((c) => def.tiles(c).length > 0);
    });
    void quiet(send('reportMarkupCheck', { ok: missing.length === 0, selectorVersion: r.selectorVersion, missing })).then((s) => s && apply(s));
  }

  function onNavigate(): void {
    actions?.navigated();
    actingByVideo = new Map();
    staleRetried = new Set();
    wouldRecorded = new Set();
    focusLost = new WeakSet();
    userBans = new Map();
    summary = null;
    ui.hideSummary();
    ui.prune();
    ui.lift();
    chipsChanged();
  }

  // ---------- Shelf dismissal (youtube-integration.md Section 10) ----------

  // The Shelf watcher exists while Shoo runs on a Site with Shelves and a Shelf is switched on. It offers Shelves
  // only while the Mode acts on the site: Auto and Review (the switch is the user's own choice), never Dry-run or a
  // tripped Native action breaker. Gating instead of dropping it keeps what this page already dismissed across Mode
  // changes.
  function syncShelves(): void {
    const on = snap?.shelfDismissal;
    if (!site.shelves || level !== 'run' || !on || !SHELF_IDS.some((id) => on[id])) {
      shelves?.stop();
      shelves = null;
      return;
    }
    shelves ??= site.shelves.watch(doc, dismissShelf);
    shelves.setEnabled(effectiveMode() === 'dryRun' ? {} : on);
  }

  /** Resolves whether the attempt counts: a stale or cancelled one lets the Shelf watcher offer the Shelf again. */
  async function dismissShelf(el: Element, shelf: ShelfId): Promise<boolean> {
    const queue = actions;
    if (!queue || !site.shelves) return false;
    const o = await queue.enqueueTarget(site.shelves.target(el, shelf, () => shelfPrecheck(shelf)));
    if (queue.size() === 0) precheckSnap = null;
    // A failure is not reported: the Shelf's controls are unverified and must not trip a breaker.
    if (o.status === 'ok') void quiet(send('reportShelfDismissal', { shelf }));
    return o.status === 'ok' || o.status === 'failed';
  }

  async function shelfPrecheck(shelf: ShelfId): Promise<boolean> {
    precheckSnap ??= quiet(send('getRuntimeState', undefined));
    const s = await precheckSnap;
    return !!s && s.enabled && s.stages.nativeActions && s.stages.ui && s.mode !== 'dryRun' && s.shelfDismissal?.[shelf] === true;
  }

  // ---------- lifecycle ----------

  function start(s: RuntimeSnapshot): void {
    run += 1;
    level = 'run';
    surfacesKey = JSON.stringify(s.surfaces);
    actions = createActionQueue({
      doc,
      site,
      precheck,
      onSiteUndo: (videoId, job) => {
        if (job.origin === 'user') return liftBan(videoId);
        undone(videoId, job.tileEl);
        void quiet(send('reportUndo', { videoId, via: 'site' }));
      },
      onDropdownCheck: (ok) =>
        void quiet(send('reportMarkupCheck', { ok, selectorVersion: site.selectorVersion, missing: ok ? [] : ['dropdown'] })).then((r) => r && apply(r)),
      onFocusLost: (tileEl) => focusLost.add(tileEl),
    });
    batcher = createBatcher((items) => void judge(items));
    watcher = createWatcher({
      doc,
      site,
      enabledSurfaces: s.surfaces,
      onTiles,
      onElementReset: (el) => clearUi(el),
      onDecoratedSeen: (els) => {
        for (const el of els) restoreUi(el, false);
        chipsChanged();
      },
      onMarkupCheck,
      onNavigate,
      ...deps.watcher,
    });
    watcher.start();
    stopUserBans = site.watchUserBans?.({ doc, surfaceOf: (el) => watcher?.surfaceOf(el), onBan: banChannel }) ?? null;
    syncShelves();
  }

  function stop(next: Level): void {
    run += 1;
    level = next;
    syncShelves();
    batcher?.clear();
    batcher = null;
    watcher?.stop();
    watcher = null;
    stopUserBans?.();
    stopUserBans = null;
    userBans = new Map();
    actions?.dispose(); // cancels queued jobs; a job already clicking finishes on its own
    actions = null;
    inflight.clear();
    actingByVideo = new Map();
    summary = null;
    wouldBuffer = [];
    precheckSnap = null;
    ui.clearAll({ overlay: next === 'off' });
    if (next === 'off') notices.reset();
    chipsChanged();
  }

  function apply(next: RuntimeSnapshot): void {
    const prev = snap;
    // Replies and broadcasts can cross: a snapshot from an older settings generation is out of date.
    if (prev && next.settingsGeneration < prev.settingsGeneration) return;
    const prevMode = effectiveMode();
    snap = next;
    if (latest.gen < 0 || next.settingsGeneration > latest.gen) latest = { gen: next.settingsGeneration, rulesVersion: next.rulesVersion };
    precheckSnap = null;
    const want = levelOf(next, site.id);
    if (want !== 'run') {
      if (level === 'run' || want !== level) stop(want);
      if (want === 'noticeOnly') notices.fromSnapshot(next);
      return;
    }
    if (level !== 'run') {
      start(next);
      notices.fromSnapshot(next);
      return;
    }
    notices.fromSnapshot(next);
    const key = JSON.stringify(next.surfaces);
    if (key !== surfacesKey) {
      surfacesKey = key;
      watcher?.setEnabledSurfaces(next.surfaces);
    }
    // Leaving Auto cancels queued Auto jobs. Entering Dry-run also cancels the Removes the user clicked in Review
    // (nothing reaches the site in Dry-run). A job already clicking finishes.
    if (prev && ((prevMode === 'auto' && effectiveMode() !== 'auto') || (prevMode !== 'dryRun' && effectiveMode() === 'dryRun'))) actions?.cancelAll();
    if (prev && (prev.mode !== next.mode || prev.stages.nativeActions !== next.stages.nativeActions)) regateAll();
    syncShelves();
    // Leaving any reason (resume, online, reconnect, consent, a new day): re-send undecided visible Tiles.
    if (prev && prev.reason !== 'ok' && prev.reason !== next.reason) watcher?.rescan();
  }

  return {
    apply,
    settingsChanged(req) {
      epoch += 1;
      if (req.settingsGeneration >= latest.gen) latest = { gen: req.settingsGeneration, rulesVersion: req.rulesVersion };
      if (req.actOnShowingChips) actOnChipsEpoch = epoch;
      precheckSnap = null;
      if (level !== 'run') return;
      batcher?.clear(); // queued items are sent again by the rescan, with the new generation
      watcher?.rescan({ all: true });
    },
    async undoRemoval({ videoId }) {
      if (!actions) return { ok: false, reason: 'expired' };
      const r = await actions.undo(videoId);
      if (r !== 'ok') return { ok: false, reason: r };
      undone(videoId);
      void quiet(send('reportUndo', { videoId, via: 'shoo' }));
      return { ok: true };
    },
    dispose: () => stop('off'),
    get running() {
      return level === 'run';
    },
    ui,
  };
}
