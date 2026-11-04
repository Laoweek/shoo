// Imperative in-page UI layer the content script calls (docs/spec/ui-design.md Section 4,
// docs/spec/youtube-integration.md Section 6). Nothing here runs at import time (ADR 0006): every
// export is a function, and the first call does the first DOM work.
import { h, render } from 'preact';
import inPageCss from '../in-page.css?inline';
import { prefersReducedMotion } from '../motion';
import { RemovedAnnotation, type AnnotationProps } from './Annotation';
import { Chip, type ChipProps } from './Chip';
import { DryRunLabel, type DryRunLabelProps } from './Label';
import { flyingCount, playMoment, type MomentSource } from './moment';
import { InPageNotice, isTripped, noticeText, type InPageNoticeKind } from './Notice';
import { attachShooRoot } from './roots';
import { BatchSummary, summaryAnnouncement, type SummaryData } from './Summary';

export type { AnnotationProps, ChipProps, DryRunLabelProps, InPageNoticeKind, MomentSource, SummaryData };
export type { SummaryRule } from './Summary';
export { playMoment } from './moment';
export { setSiteName } from './site';

const styled = new WeakSet<ShadowRoot>();
const contained = new WeakSet<ShadowRoot>();
const stop = (e: Event) => e.stopPropagation();

/** Add Shoo's in-page CSS to a shadow root, once per root. */
function injectStyles(root: ShadowRoot): void {
  if (styled.has(root)) return;
  styled.add(root);
  const style = root.ownerDocument.createElement('style');
  style.textContent = inPageCss;
  root.prepend(style);
}

/**
 * Stop every keyboard event at the shadow root so YouTube's hotkeys (Space, k, j, l, /) never fire
 * while the user operates Shoo's UI. Handlers inside the root still run first. Idempotent.
 */
export function installKeyContainment(root: ShadowRoot): void {
  if (contained.has(root)) return;
  contained.add(root);
  for (const type of ['keydown', 'keyup', 'keypress']) root.addEventListener(type, stop);
}

function mountPoint(root: ShadowRoot): HTMLElement {
  injectStyles(root);
  installKeyContainment(root);
  let el = root.querySelector<HTMLElement>('[data-shoo-mount]');
  if (!el) {
    el = root.ownerDocument.createElement('div');
    el.setAttribute('data-shoo-mount', '');
    root.append(el);
  }
  return el;
}

/** Render or update the Review chip in a Tile's shadow root. */
export function renderChip(root: ShadowRoot, props: ChipProps): void {
  render(h(Chip, props), mountPoint(root));
}

/** Render or update the Dry-run label in a Tile's shadow root. */
export function renderLabel(root: ShadowRoot, props: DryRunLabelProps): void {
  render(h(DryRunLabel, props), mountPoint(root));
}

/** Render or update the removed-Tile annotation in its shadow root. */
export function renderAnnotation(root: ShadowRoot, props: AnnotationProps): void {
  render(h(RemovedAnnotation, props), mountPoint(root));
}

/** Remove whatever Shoo rendered in this shadow root. The caller removes the host element. */
export function unmount(root: ShadowRoot): void {
  const el = root.querySelector<HTMLElement>('[data-shoo-mount]');
  if (!el) return;
  render(null, el);
  el.remove();
}

// ---------- The page-level overlay: batch summary and notices (one host on document.body) ----------

/** Tag of the overlay host. Distinct from the YouTube layer's chip fallback layer (`shoo-overlay`). */
export const SUMMARY_HOST_TAG = 'shoo-summary-host';

export interface NoticeInput {
  kind: InPageNoticeKind;
  count?: number;
  /** The Site a breaker names (RuntimeSnapshot.site), when it is not this page's. */
  site?: string;
  onAction?: () => void;
  onDismiss?: () => void;
}

interface Overlay {
  host: HTMLElement;
  root: ShadowRoot;
  mount: HTMLElement;
  summary?: SummaryData & { shown: number; generation: number; blinkKey: number; entrance: 'rise' | 'fade' };
  notice?: NoticeInput;
  polite: string;
  assertive: string;
  timers: { polite?: ReturnType<typeof setTimeout>; assertive?: ReturnType<typeof setTimeout> };
  /** Where focus came from when it entered the overlay, to hand it back when a panel goes away. */
  returnFocus?: Element;
}

let overlay: Overlay | undefined;
let overlayDark = false;
let overlayLift = 0;
const ANNOUNCE_DELAY_MS = 100;

function ensureOverlay(): Overlay {
  if (overlay?.host.isConnected) return overlay;
  if (overlay) removeOverlay();
  const host = document.createElement(SUMMARY_HOST_TAG);
  host.toggleAttribute('data-dark', overlayDark);
  if (overlayLift) host.style.setProperty('--shoo-lift', `${overlayLift}px`);
  const root = attachShooRoot(host);
  document.body.append(host);
  const mount = mountPoint(root);
  mount.className = 'dock';
  const o: Overlay = { host, root, mount, polite: '', assertive: '', timers: {} };
  root.addEventListener('focusin', (e) => {
    const from = (e as FocusEvent).relatedTarget as Element | null;
    if (from && !root.contains(from)) o.returnFocus = from;
  });
  overlay = o;
  return o;
}

function paint(o: Overlay): void {
  if (overlay !== o) return;
  const s = o.summary;
  const n = o.notice;
  render(
    [
      n &&
        h(InPageNotice, {
          key: 'notice',
          kind: n.kind,
          count: n.count,
          site: n.site,
          onAction: n.onAction,
          onDismiss: () => {
            n.onDismiss?.();
            hideNotice();
          },
        }),
      s && h(BatchSummary, { key: 'summary', ...s, onGone: () => overlay === o && hideSummary() }),
      h('div', { key: 'polite', class: 'sr', 'aria-live': 'polite' }, o.polite),
      h('div', { key: 'assertive', class: 'sr', 'aria-live': 'assertive' }, o.assertive),
    ],
    o.mount,
  );
}

// Live regions must exist before their text changes, or screen readers may stay silent. Clearing
// first lets the same sentence be announced twice. Each region has its own timer, so a summary
// never swallows a notice's announcement.
function announce(o: Overlay, text: string, region: 'polite' | 'assertive'): void {
  clearTimeout(o.timers[region]);
  o[region] = '';
  paint(o);
  o.timers[region] = setTimeout(() => {
    o[region] = text;
    paint(o);
  }, ANNOUNCE_DELAY_MS);
}

// Before a panel with focus disappears, hand focus back to where it came from so it never drops
// to <body>, where YouTube's hotkeys would catch the next key.
function releaseFocus(o: Overlay): void {
  const active = o.root.activeElement as HTMLElement | null;
  if (!active) return;
  const back = o.returnFocus as HTMLElement | undefined;
  if (back?.isConnected && typeof back.focus === 'function') back.focus({ preventScroll: true });
  else active.blur();
}

/** Follow the site's theme on the overlay host. Chip hosts are themed by the caller. */
export function setOverlayTheme(dark: boolean): void {
  overlayDark = dark;
  overlay?.host.toggleAttribute('data-dark', dark);
}

/** Lift the summary and notices above a site layer at the viewport's bottom, such as YouTube's miniplayer (px, 0 for none). */
export function setOverlayLift(px: number): void {
  overlayLift = px;
  overlay?.host.style.setProperty('--shoo-lift', `${px}px`);
}

export interface ShowSummaryOptions {
  /** Removed Tiles to fly squares from (the moment). Omit for a plain update. */
  from?: readonly MomentSource[];
}

/**
 * Show the batch summary, or update the one already showing (never stacks). Restarts its 6 s timer.
 * With `from`, plays the moment: the count ticks up as squares land, then the eyes blink once.
 * Resolves when the moment is over.
 */
export function showSummary(data: SummaryData, opts: ShowSummaryOptions = {}): Promise<void> {
  const o = ensureOverlay();
  const prev = o.summary;
  const still = prefersReducedMotion();
  const flying = still || !opts.from ? 0 : flyingCount(opts.from.length);
  const summary = {
    ...data,
    shown: Math.max(0, data.count - flying),
    generation: (prev?.generation ?? 0) + 1,
    blinkKey: prev?.blinkKey ?? 0,
    // A new panel fades in when squares fly, so their landing spots do not move under them.
    entrance: prev ? prev.entrance : flying ? ('fade' as const) : ('rise' as const),
  };
  o.summary = summary;
  paint(o);
  announce(o, summaryAnnouncement(data), 'polite');

  const live = () => overlay === o && o.summary === summary;
  const blink = () => {
    if (!live() || still) return;
    summary.blinkKey += 1;
    paint(o);
  };
  const target = o.root.querySelector('.rules');
  if (!flying || !target || !opts.from) {
    summary.shown = data.count;
    paint(o);
    blink();
    return Promise.resolve();
  }
  return playMoment(opts.from, target, {
    onArrive: () => {
      if (!live()) return;
      summary.shown = Math.min(summary.count, summary.shown + 1);
      paint(o);
    },
  }).then(blink);
}

/**
 * Update the batch summary that is showing (open or collapsed) without restarting its timers, reopening it or
 * announcing it again. Does nothing when no summary shows.
 */
export function updateSummary(data: SummaryData): void {
  const o = overlay;
  if (!o?.summary) return;
  o.summary = { ...o.summary, ...data, shown: Math.min(o.summary.shown, data.count) };
  paint(o);
}

/** Remove the batch summary now (Shoo turned off, or its pill ran out). */
export function hideSummary(): void {
  if (!overlay?.summary) return;
  if (overlay.root.querySelector('.panel:not(.notice), .pill')?.contains(overlay.root.activeElement)) releaseFocus(overlay);
  overlay.summary = undefined;
  paint(overlay);
}

/**
 * Show the notice for a failure streak. Showing the same kind again only updates its count, so the
 * user hears about a streak once. Tripped kinds announce assertively, the others politely.
 * One notice at a time: a different kind replaces the current one.
 */
export function showNotice(input: NoticeInput): void {
  const o = ensureOverlay();
  const same = o.notice?.kind === input.kind;
  o.notice = input;
  paint(o);
  if (!same) announce(o, noticeText(input.kind, input.count, input.site), isTripped(input.kind) ? 'assertive' : 'polite');
}

export function hideNotice(): void {
  if (!overlay?.notice) return;
  if (overlay.root.querySelector('.notice')?.contains(overlay.root.activeElement)) releaseFocus(overlay);
  overlay.notice = undefined;
  paint(overlay);
}

/** Remove the overlay host and everything in it (Shoo turned off, page unload). */
export function removeOverlay(): void {
  const o = overlay;
  if (!o) return;
  releaseFocus(o);
  clearTimeout(o.timers.polite);
  clearTimeout(o.timers.assertive);
  o.summary = undefined;
  o.notice = undefined;
  render(null, o.mount);
  o.host.remove();
  overlay = undefined;
}
