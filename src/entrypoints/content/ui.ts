// In-page UI for the content script (docs/spec/ui-design.md Section 4, docs/spec/youtube-integration.md Section 6).
// Same bundle as the pipeline (ADR 0006). Nothing runs at import time: mountUi() runs on the first chip, label,
// annotation, summary or notice, and starts the theme observer then. Every host Shoo creates is tracked here, so
// turning Shoo off removes all of them at once.
import {
  hideNotice,
  hideSummary,
  removeOverlay,
  renderAnnotation,
  renderChip,
  renderLabel,
  setOverlayLift,
  setOverlayTheme,
  showNotice,
  showSummary,
  unmount,
  updateSummary,
  type AnnotationProps,
  type ChipProps,
  type DryRunLabelProps,
  type MomentSource,
  type NoticeInput,
  type SummaryData,
} from '~/ui/in-page';
import type { SurfaceId } from '~/core/types';
import { INSET_PX, mountAnnotationHost, mountChipHost, removeOverlayLayer } from '~/youtube/mount';
import { SURFACES } from '~/youtube/surfaces';
import { isDark, observeTheme } from '~/youtube/theme';

/** chip: Review chip. kept: the chip's 4 s kept note. label: Dry-run label. annotation: under YouTube's placeholder.
 *  duplicate: "Already shooed above" over a copy of a removed video. */
export type DecoKind = 'chip' | 'kept' | 'label' | 'annotation' | 'duplicate';

interface Deco {
  kind: DecoKind;
  host: HTMLElement;
  shadow: ShadowRoot;
  destroy(): void;
  /** False once YouTube destroyed the host or replaced what it is anchored to. */
  live(): boolean;
  /** Place the host again (the annotation's cover takes YouTube's ground colour, which changes with the theme). */
  update?(): void;
}

export type ChipInput = Omit<ChipProps, 'variant' | 'maxWidth'>;
export type LabelInput = Omit<DryRunLabelProps, 'variant' | 'maxWidth'>;

export interface PageUi {
  readonly mounted: boolean;
  kindOf(el: Element): DecoKind | undefined;
  hostOf(el: Element): HTMLElement | undefined;
  /** The element's UI is showing: its host is connected and anchored to a connected thumbnail or placeholder. */
  isLive(el: Element): boolean;
  /** Live hosts of this kind, only those for Tiles inside `within` when given (the visible page). */
  count(kind: DecoKind, within?: Element | null): number;
  /**
   * YouTube destroyed an element's host or replaced its anchor (re-render, Back navigation). The UI is already
   * cleared when `cb` runs: the caller decides whether to mount it again.
   */
  onHostLost(cb: (el: Element, kind: DecoKind) => void): void;
  chip(el: Element, surface: SurfaceId, props: ChipInput): boolean;
  /** The chip turned into its kept note (no longer waiting for the user). */
  markKept(el: Element): void;
  label(el: Element, surface: SurfaceId, props: LabelInput): boolean;
  annotation(el: Element, surface: SurfaceId, props: AnnotationProps): boolean;
  duplicate(el: Element, surface: SurfaceId, props: Omit<AnnotationProps, 'duplicate'>): boolean;
  clear(el: Element): void;
  /** Drop hosts whose Tile left the document. */
  prune(): void;
  /** Every chip, label and annotation (Shoo off, markup breaker). `overlay: false` keeps the overlay. */
  clearAll(opts?: { overlay?: boolean }): void;
  summary(data: SummaryData, from?: readonly MomentSource[]): void;
  /** Update the summary that is showing, without reopening or announcing it. Nothing when none shows. */
  updateSummary(data: SummaryData): void;
  hideSummary(): void;
  notice(input: NoticeInput): void;
  hideNotice(): void;
  /** Recompute the miniplayer lift (navigation). */
  lift(): void;
}

/** Distance from the bottom of the viewport to the top of a visible miniplayer, 0 when none shows. */
export function miniplayerLift(doc: Document): number {
  const mp = doc.querySelector('ytd-miniplayer');
  const win = doc.defaultView;
  if (!mp || !win || win.getComputedStyle(mp).display === 'none') return 0;
  const r = mp.getBoundingClientRect();
  return r.height > 0 ? Math.max(0, Math.round(win.innerHeight - r.top)) : 0;
}

export function createPageUi(doc: Document): PageUi {
  const decos = new Map<Element, Deco>();
  let mounted = false;
  let stopTheme: (() => void) | null = null;
  let lastLift = 0;
  let hostLost: ((el: Element, kind: DecoKind) => void) | null = null;

  function mountUi(): void {
    if (mounted) return;
    mounted = true;
    setOverlayTheme(isDark(doc));
    stopTheme = observeTheme(doc, (dark) => {
      for (const d of decos.values()) {
        d.host.toggleAttribute('data-dark', dark);
        if (d.kind === 'annotation') d.update?.();
      }
      setOverlayTheme(dark);
    });
  }

  function lift(): void {
    const px = miniplayerLift(doc);
    if (px !== lastLift) setOverlayLift((lastLift = px));
  }

  function clear(el: Element): void {
    const d = decos.get(el);
    if (!d) return;
    decos.delete(el);
    unmount(d.shadow);
    d.destroy();
  }

  function adopt(el: Element, kind: DecoKind, handle: Omit<Deco, 'kind'>): Deco {
    handle.host.toggleAttribute('data-dark', isDark(doc));
    const d = { kind, ...handle };
    decos.set(el, d);
    return d;
  }

  // The deco's host or anchor is gone: drop it, then let the pipeline mount it again from `judged`.
  function lost(el: Element, own: { deco?: Deco }): void {
    const d = own.deco;
    if (!d || decos.get(el) !== d) return;
    clear(el);
    hostLost?.(el, d.kind);
  }

  // A host over the thumbnail (chip, label, duplicate note). Re-renders when the compact flag flips.
  function overThumbnail(el: Element, surface: SurfaceId, kind: DecoKind, paint: (root: ShadowRoot, compact: boolean, maxWidth?: number) => void): boolean {
    mountUi();
    const maxWidth = () => {
      const w = SURFACES[surface].thumbnail(el)?.getBoundingClientRect().width ?? 0;
      return w > 2 * INSET_PX ? Math.floor(w - 2 * INSET_PX) : undefined;
    };
    const cur = decos.get(el);
    if (cur && cur.kind === kind && cur.live()) {
      paint(cur.shadow, cur.host.dataset.compact === '1', maxWidth());
      return true;
    }
    clear(el);
    const own: { deco?: Deco } = {};
    const handle = mountChipHost(el, surface, {
      onCompactChange: (compact) => {
        const d = own.deco;
        if (!d || decos.get(el) !== d) return;
        d.host.dataset.compact = compact ? '1' : '0';
        paint(d.shadow, compact, maxWidth());
      },
      onLost: () => lost(el, own),
    });
    if (!handle) return false;
    const d = (own.deco = adopt(el, kind, handle));
    d.host.dataset.compact = handle.compact ? '1' : '0';
    paint(d.shadow, handle.compact, maxWidth());
    return true;
  }

  return {
    get mounted() {
      return mounted;
    },
    kindOf: (el) => decos.get(el)?.kind,
    hostOf: (el) => decos.get(el)?.host,
    isLive: (el) => decos.get(el)?.live() ?? false,
    count(kind, within) {
      let n = 0;
      for (const [el, d] of decos) if (d.kind === kind && d.live() && (within === undefined || !!within?.contains(el))) n += 1;
      return n;
    },
    onHostLost(cb) {
      hostLost = cb;
    },
    chip(el, surface, props) {
      return overThumbnail(el, surface, 'chip', (root, compact, maxWidth) => renderChip(root, { ...props, variant: compact ? 'compact' : 'full', maxWidth }));
    },
    markKept(el) {
      const d = decos.get(el);
      if (d?.kind === 'chip') d.kind = 'kept';
    },
    label(el, surface, props) {
      return overThumbnail(el, surface, 'label', (root, compact, maxWidth) => renderLabel(root, { ...props, variant: compact ? 'compact' : 'full', maxWidth }));
    },
    duplicate(el, surface, props) {
      return overThumbnail(el, surface, 'duplicate', (root) => renderAnnotation(root, { ...props, duplicate: true }));
    },
    annotation(el, surface, props) {
      const root = SURFACES[surface].actionRoot(el);
      if (!root) return false;
      mountUi();
      clear(el);
      const own: { deco?: Deco } = {};
      const handle = mountAnnotationHost(root, { tile: el, onLost: () => lost(el, own) });
      if (!handle) return false;
      renderAnnotation((own.deco = adopt(el, 'annotation', handle)).shadow, { ...props, channel: handle.channel });
      handle.update(); // place it with its rendered height
      return true;
    },
    clear,
    prune() {
      for (const el of [...decos.keys()]) if (!el.isConnected) clear(el);
    },
    clearAll({ overlay = true } = {}) {
      for (const el of [...decos.keys()]) clear(el);
      if (!overlay) return;
      removeOverlay();
      removeOverlayLayer(doc);
      stopTheme?.();
      stopTheme = null;
      mounted = false;
    },
    summary(data, from) {
      mountUi();
      lift();
      void showSummary(data, from ? { from } : {});
    },
    updateSummary,
    hideSummary,
    notice(input) {
      mountUi();
      lift();
      showNotice(input);
    },
    hideNotice,
    lift,
  };
}
