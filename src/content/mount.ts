// Host elements for Shoo's in-page UI, the same on every Site. Source of truth: docs/spec/youtube-integration.md
// Section 6. DOM only: this module creates, positions and destroys chip and annotation hosts with closed shadow roots.
// The batch summary and notice host (`shoo-summary-host`) is created and positioned by the in-page UI itself. The UI
// layer renders into `shadow`. Shoo never sets styles or attributes on the site's own elements and never mounts
// inside a thumbnail link.
import type { SurfaceId } from '~/core/types';
import { surfaceOf, type Site, type SurfaceDef } from '~/sites/site';
import { attachShooRoot } from '~/ui/in-page/roots';

export const CHIP_HOST_TAG = 'shoo-chip-host';
export const OVERLAY_TAG = 'shoo-overlay';
/**
 * Thumbnails narrower than this get the compact variants. Measured 2026-10-10 on YouTube's own CSS with the 28-character
 * Rule text and 30% longer copy: below 320 px the room left of the duration badge drops under the ~240 px the full chip
 * needs for two rows, and it wraps to three (docs/spec/ui-design.md Section 4).
 */
export const COMPACT_BELOW_PX = 320;
export const INSET_PX = 8;
/** Space kept between Shoo's UI and the site's thumbnail badges (duration, LIVE, view counts). */
export const BADGE_GAP_PX = 8;
/**
 * Room kept free at the thumbnail's bottom-right when no badge is measured: a 52 px "1:02:33" badge with YouTube's
 * 4 px inset, plus the gap (badges observed 36 to 42 px wide and 18 px tall, inset 4 or 8 px, 2026-10-10).
 */
export const DEFAULT_BADGE_ZONE_PX = 64;

export interface ChipHost {
  host: HTMLElement;
  shadow: ShadowRoot;
  /** Recompute position and the compact flag now (navigation, or the caller). The document's ResizeObserver does it on resizes. */
  update(): void;
  destroy(): void;
  /** False once the site removed the host or replaced the thumbnail it tracks: mount a new one. */
  live(): boolean;
  readonly compact: boolean;
  /** The thumbnail's width at the last measurement, px (0 before it had a box). */
  thumbWidth(): number;
  /** True when the host sits above the site's badges because the room beside them is too narrow. */
  readonly lifted: boolean;
  /** True when the chip sits in the page-level overlay (an overlay Surface, or a mountParent that is not a containing block). */
  readonly overlay: boolean;
}

export interface HostHandle {
  host: HTMLElement;
  shadow: ShadowRoot;
  destroy(): void;
  /** False once the element the host belongs to (thumbnail, placeholder) left the document. */
  live(): boolean;
}

type ResizeObserverCtor = new (cb: (entries: ReadonlyArray<{ target: Element }>) => void) => {
  observe(el: Element): void;
  unobserve(el: Element): void;
  disconnect(): void;
};

export interface ChipHostOptions {
  /** Called when the compact flag flips after a resize, and on the first real width (the caller repaints). */
  onCompactChange?(compact: boolean): void;
  /** The site removed the host or replaced the thumbnail (re-render, Back navigation). Called once. */
  onLost?(): void;
  /** Default the platform ResizeObserver. Omitted in jsdom, which has none. */
  ResizeObserver?: ResizeObserverCtor;
  /** Force the page-level overlay (true) or the in-Tile host (false). Default: see mountChipHost. */
  forceOverlay?: boolean;
}

export interface AnnotationHostOptions {
  /** The site removed the placeholder (a re-render, navigation, YouTube's Undo). Called once. */
  onLost?(): void;
  /** The Tile root, so a re-render that replaces the whole actionRoot is noticed too. Default the actionRoot. */
  tile?: Element;
  ResizeObserver?: ResizeObserverCtor;
}

function makeHost(doc: Document, tag: string, style: string): { host: HTMLElement; shadow: ShadowRoot } {
  const host = doc.createElement(tag);
  host.setAttribute('style', style);
  return { host, shadow: attachShooRoot(host) };
}

const platformRO = (win: Window, opt?: ResizeObserverCtor) => opt ?? (win as unknown as { ResizeObserver?: ResizeObserverCtor }).ResizeObserver;
const hasBox = (r: DOMRect) => r.width > 0 || r.height > 0;

/** Left and top edge of the site's badges over the bottom half of the thumbnail, or null when none shows. */
export function badgeZone(badges: Iterable<Element>, t: DOMRect): { left: number; top: number } | null {
  let left = Infinity;
  let top = Infinity;
  for (const badge of badges) {
    const r = badge.getBoundingClientRect();
    if (!hasBox(r) || r.top < t.top + t.height / 2) continue;
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
  }
  return left === Infinity ? null : { left, top };
}

export interface Placement {
  /** Max width of the host, px. */
  maxWidth: number;
  /** Viewport y of the host's bottom edge. */
  bottom: number;
  lifted: boolean;
}

/**
 * Where Shoo's UI goes over a thumbnail so it never covers the site's badges. Bottom-left,
 * inset 8 px, and no wider than the room left of the badges minus an 8 px gap. Without a measured badge the same room
 * is kept free for one (DEFAULT_BADGE_ZONE_PX). When the content needs more than that room (`need`, its min-content
 * width), it sits above the badges at the thumbnail's width minus 16 px, or keeps the corner when there is no badge.
 */
export function placeOverThumbnail(t: DOMRect, zone: { left: number; top: number } | null, need: number): Placement {
  const full = Math.max(0, t.width - 2 * INSET_PX);
  const beside = Math.min(full, (zone ? zone.left : t.right - DEFAULT_BADGE_ZONE_PX) - BADGE_GAP_PX - (t.left + INSET_PX));
  if (need <= beside) return { maxWidth: Math.floor(beside), bottom: t.bottom - INSET_PX, lifted: false };
  if (zone) return { maxWidth: Math.floor(full), bottom: zone.top - BADGE_GAP_PX, lifted: true };
  return { maxWidth: Math.floor(full), bottom: t.bottom - INSET_PX, lifted: false };
}

/**
 * Watch for the site removing `nodes` (or any ancestor up to `tile`): one childList observer on each element of their
 * ancestor chains, no subtree. Calls `lost` once when `alive()` turns false.
 */
function watchLoss(nodes: Element[], tile: Element, alive: () => boolean, lost: () => void): () => void {
  const mo = new MutationObserver(() => {
    if (alive()) return;
    mo.disconnect();
    lost();
  });
  const chain = new Set<Element>();
  for (const n of nodes) {
    for (let el: Element | null = n.parentElement; el; el = el.parentElement) {
      chain.add(el);
      if (el === tile) break;
    }
  }
  for (const el of chain) mo.observe(el, { childList: true });
  return () => mo.disconnect();
}

/** A chip host's placement state, shared by its own update() and the document's ResizeObserver. */
interface Chip {
  host: HTMLElement;
  thumb: Element;
  parent: Element;
  def: SurfaceDef;
  overlay: boolean;
  compact: boolean;
  /** False until the thumbnail had a box. */
  measured: boolean;
  lifted: boolean;
  width: number;
  /** Overlay hosts: the thumbnail's last document position and size, and the host's top above its top edge. */
  at: { x: number; y: number; w: number; h: number; rise: number } | null;
  onCompactChange?(compact: boolean): void;
}

/**
 * Place every chip in one pass: all reads, then the writes that measure the content, one read of each host's width,
 * then the final writes. A batch of new chips forces one layout for the measurement, not several per chip.
 */
function placeChips(chips: readonly Chip[], win: Window): void {
  const seen = chips.map((c) => {
    const t = c.thumb.getBoundingClientRect();
    if (!hasBox(t)) return null;
    const origin = c.overlay ? { left: -win.scrollX, top: -win.scrollY } : c.parent.getBoundingClientRect();
    return { t, zone: badgeZone(c.def.badges(c.thumb), t), origin };
  });
  chips.forEach((c, i) => {
    // No box yet (not laid out, or its page is hidden): stay hidden and keep the variant until a real width arrives,
    // so a chip never sits above the thumbnail with geometry measured before layout (seen once in a live test, 2026-10-10).
    c.host.style.visibility = seen[i] ? '' : 'hidden';
    if (!seen[i]) return;
    // The narrowest the rendered content can be: one row for the compact variants, the tightest wrap for the full chip.
    // While data-measuring is set, the in-page CSS lets the Rule label, which truncates, count only as a word's room.
    c.host.setAttribute('data-measuring', '');
    c.host.style.width = 'min-content';
    c.host.style.maxWidth = '';
  });
  const needs = chips.map((c, i) => (seen[i] ? c.host.offsetWidth : 0));
  const flipped: Chip[] = [];
  chips.forEach((c, i) => {
    const s = seen[i];
    if (!s) return;
    const { t, origin } = s;
    const { style } = c.host;
    style.width = 'max-content';
    c.host.removeAttribute('data-measuring');
    const place = placeOverThumbnail(t, s.zone, needs[i]!);
    c.lifted = place.lifted;
    style.maxWidth = `${place.maxWidth}px`;
    style.left = `${t.left - origin.left + INSET_PX}px`;
    style.top = `${place.bottom - origin.top}px`;
    if (c.overlay) c.at = { x: t.left - origin.left, y: t.top - origin.top, w: t.width, h: t.height, rise: place.bottom - t.top };
    c.width = t.width;
    const next = t.width < COMPACT_BELOW_PX;
    if (next !== c.compact || !c.measured) flipped.push(c);
    c.compact = next;
    c.measured = true;
  });
  for (const c of flipped) c.onCompactChange?.(c.compact);
}

/**
 * One ResizeObserver per document for every chip host: its thumbnail and host, and the body while overlay hosts
 * exist. A thumbnail or host resize places that chip again in full. A body resize (content inserted above a Tile)
 * only moves overlay hosts whose thumbnail moved, so an infinite-scroll append does not measure every overlay chip.
 */
interface ChipObserver {
  ro: InstanceType<ResizeObserverCtor>;
  chips: Map<Element, Chip>;
  overlays: Set<Chip>;
}
// Keyed by the window's ResizeObserver constructor, which is one per window and so one per document.
const chipObservers = new WeakMap<ResizeObserverCtor, ChipObserver>();

function chipObserver(doc: Document, win: Window, RO: ResizeObserverCtor): ChipObserver {
  const known = chipObservers.get(RO);
  if (known) return known;
  const chips = new Map<Element, Chip>();
  const overlays = new Set<Chip>();
  const ro = new RO((entries) => {
    const full = new Set<Chip>();
    let bodyMoved = false;
    for (const { target } of entries) {
      if (target === doc.body) bodyMoved = true;
      const c = chips.get(target);
      if (c) full.add(c);
    }
    const sx = win.scrollX;
    const sy = win.scrollY;
    const moved: Array<[Chip, DOMRect]> = [];
    if (bodyMoved) {
      for (const c of overlays) {
        if (full.has(c)) continue;
        const t = c.thumb.getBoundingClientRect();
        // A new size or no box is a full placement. Only the position: just move the host.
        if (!c.at || !hasBox(t) || t.width !== c.at.w || t.height !== c.at.h) full.add(c);
        else if (t.left + sx !== c.at.x || t.top + sy !== c.at.y) moved.push([c, t]);
      }
    }
    placeChips([...full], win);
    for (const [c, t] of moved) {
      c.at = { ...c.at!, x: t.left + sx, y: t.top + sy };
      c.host.style.left = `${c.at.x + INSET_PX}px`;
      c.host.style.top = `${c.at.y + c.at.rise}px`;
    }
  });
  const observer = { ro, chips, overlays };
  chipObservers.set(RO, observer);
  return observer;
}

/**
 * One `<shoo-chip-host>` per decorated element, over the bottom-left of the thumbnail, inset 8 px, clear of the
 * site's badges (placeOverThumbnail).
 * In-Tile: appended as the last child of mountParent(tile), which is `position: relative` on YouTube's Home and Watch
 * sidebar (observed 2026-10-10) and Bilibili's Home (2026-10-18). Overlay: on overlay Surfaces (YouTube's Shorts
 * shelf), and for any `position: static` mountParent, the host sits in the page-level overlay in document coordinates.
 * YouTube's Shorts hover preview (`ytd-video-preview`) is a page-level element drawn over the Tile, so no z-index
 * inside the Tile can keep the chip above it (live test 2026-10-10).
 * With a ResizeObserver, its first notification places the host, after the caller rendered into it and before the
 * frame paints. Without one (jsdom) the host is placed at once.
 * Returns null when the Tile has no thumbnail or mount parent, or while the site's placeholder shows.
 */
export function mountChipHost(site: Site, tile: Element, surface: SurfaceId, opts: ChipHostOptions = {}): ChipHost | null {
  const def = surfaceOf(site, surface);
  const parent = def.mountParent(tile);
  const thumb = def.thumbnail(tile);
  const root = def.actionRoot(tile);
  const doc = tile.ownerDocument;
  const win = doc.defaultView;
  // YouTube's placeholder replaces the thumbnail. Bilibili's covers the Tile and leaves it in place.
  const covered = () => root !== null && site.placeholder.find(root) !== null;
  if (!parent || !thumb || !win || covered()) return null;

  const overlay = opts.forceOverlay ?? (def.overlay === true || win.getComputedStyle(parent).position === 'static');
  // Read before the host joins the page, so this read finds the layout as the site left it.
  const t0 = thumb.getBoundingClientRect();
  // Only the chip inside the shadow root takes pointer events. translateY(-100%) puts the host's bottom edge on the anchor.
  // width: max-content sizes the host by its content in any containing block (the overlay layer is 0 px wide), and
  // max-width (set by placeChips) caps it.
  const { host, shadow } = makeHost(doc, CHIP_HOST_TAG, 'position:absolute;z-index:2;pointer-events:none;transform:translateY(-100%);width:max-content;');
  const chip: Chip = {
    host,
    thumb,
    parent,
    def,
    overlay,
    compact: hasBox(t0) && t0.width < COMPACT_BELOW_PX,
    measured: hasBox(t0),
    lifted: false,
    width: t0.width,
    at: null,
    onCompactChange: opts.onCompactChange,
  };
  if (!hasBox(t0)) host.style.visibility = 'hidden';
  if (overlay) overlayLayer(doc).append(host);
  else parent.append(host);

  const update = () => placeChips([chip], win);
  const RO = platformRO(win, opts.ResizeObserver);
  const observer = RO ? chipObserver(doc, win, RO) : null;
  if (observer) {
    observer.chips.set(thumb, chip);
    observer.chips.set(host, chip); // a repaint (variant flip, kept note) changes the width the content needs
    observer.ro.observe(thumb);
    observer.ro.observe(host);
    // Content inserted above the Tile moves an overlay host without resizing the thumbnail.
    if (overlay && observer.overlays.add(chip).size === 1) observer.ro.observe(doc.body);
  } else update();
  const unobserve = () => {
    if (!observer) return;
    for (const el of [thumb, host]) {
      if (observer.chips.get(el) !== chip) continue;
      observer.chips.delete(el);
      observer.ro.unobserve(el);
    }
    if (observer.overlays.delete(chip) && observer.overlays.size === 0) observer.ro.unobserve(doc.body);
  };
  const onNav = overlay ? update : null;
  if (onNav) for (const ev of site.navigatedEvents) doc.addEventListener(ev, onNav);
  const live = () => host.isConnected && thumb.isConnected && !covered();
  let gone = false;
  const lose = () => {
    if (gone) return;
    gone = true;
    stopLoss();
    coverMo?.disconnect();
    opts.onLost?.();
  };
  const stopLoss = watchLoss(overlay ? [thumb] : [thumb, host], tile, live, lose);
  // The site covered the Tile with its placeholder without removing anything (Bilibili, after the user chose an item
  // of Bilibili's own menu): a chip left over the placeholder would offer a Remove that can no longer happen.
  const coverMo = root ? new MutationObserver(() => covered() && lose()) : null;
  if (root) coverMo?.observe(root, site.placeholder.observe);

  return {
    host,
    shadow,
    update,
    live,
    destroy() {
      unobserve();
      stopLoss();
      coverMo?.disconnect();
      if (onNav) for (const ev of site.navigatedEvents) doc.removeEventListener(ev, onNav);
      host.remove();
    },
    get compact() {
      return chip.compact;
    },
    thumbWidth: () => chip.width,
    get lifted() {
      return chip.lifted;
    },
    overlay,
  };
}

// The single page-level overlay layer, appended to body in document coordinates. Its z-index keeps Shoo's hosts
// above page-level site layers such as YouTube's Shorts hover preview, and below YouTube's menus (tp-yt-iron-dropdown).
function overlayLayer(doc: Document): Element {
  let layer = doc.querySelector(`body > ${OVERLAY_TAG}`);
  if (!layer) {
    layer = doc.createElement(OVERLAY_TAG);
    layer.setAttribute('style', 'position:absolute;left:0;top:0;width:0;height:0;z-index:2000;pointer-events:none;');
    doc.body.append(layer);
  }
  return layer;
}

/** Remove the page-level overlay layer once it holds no host (Shoo turned off). */
export function removeOverlayLayer(doc: Document): void {
  const layer = doc.querySelector(`body > ${OVERLAY_TAG}`);
  if (layer && layer.childElementCount === 0) layer.remove();
}

/** Height of the one-line annotation (its text buttons have a 24 px target) until the rendered height is known. */
const ANNOTATION_LINE_PX = 24;
/** Space kept between the annotation and the site's first placeholder action (Shoo's focus ring is 4 px). */
const ACTION_CLEARANCE_PX = 4;
/**
 * Least air above the annotation and between it and the site's sentence below it, or the two read as one paragraph.
 * Less than this on either side, and the annotation covers the sentence instead.
 */
const BAND_GAP_PX = 8;

const px = (v: string) => parseFloat(v) || 0;

/**
 * The site's content column inside its placeholder card (YouTube's `notification-multi-action-renderer`: 1 px
 * outline, 8 px radius, 20 / 12 / 8 px padding, measured 2026-10-10): the same left and right edges as its Undo and
 * "Tell us why" buttons, and the top just inside the outline. Without the card's CSS it falls back to an 8 px inset.
 */
function cardColumn(card: Element | null, p: DOMRect, win: Window): { left: number; right: number; top: number } {
  const r = card?.getBoundingClientRect();
  const box = r && hasBox(r) ? r : p;
  const cs = card ? win.getComputedStyle(card) : null;
  const start = cs ? px(cs.borderLeftWidth) + px(cs.paddingLeft) : 0;
  const end = cs ? px(cs.borderRightWidth) + px(cs.paddingRight) : 0;
  return {
    left: box.left + (start || INSET_PX),
    right: box.right - (end || INSET_PX),
    top: box.top + Math.max(1, cs ? px(cs.borderTopWidth) : 0), // never on the card's outline
  };
}

/** Alpha of a computed CSS colour: 0 for `transparent`, the value after `/` or the fourth comma value, else 1. */
function alphaOf(c: string): number {
  if (!c || c === 'transparent') return 0;
  const inner = c.slice(c.indexOf('(') + 1, c.lastIndexOf(')'));
  const a = inner.includes('/') ? inner.split('/')[1] : inner.split(',')[3];
  if (a === undefined) return 1;
  return a.trim().endsWith('%') ? px(a) / 100 : px(a);
}

type Rgb = [number, number, number];
const rgbOf = (c: string): Rgb | null => {
  const m = /^rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(c);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};

/**
 * The colour the site paints behind its card: the first opaque background up the tree, with any see-through fills on
 * the way blended over it (YouTube's dark fills are white at 10%). '' when nothing is opaque, or a see-through fill is
 * not plain rgb.
 */
function groundOf(el: Element, win: Window): string {
  const fills: [Rgb, number][] = []; // see-through fills and their alpha, innermost first
  for (let e: Element | null = el; e; e = e.parentElement) {
    const bg = win.getComputedStyle(e).backgroundColor;
    const a = alphaOf(bg);
    if (a <= 0) continue;
    if (a < 1) {
      const rgb = rgbOf(bg);
      if (!rgb) return '';
      fills.push([rgb, a]);
      continue;
    }
    if (fills.length === 0) return bg;
    const base = rgbOf(bg);
    if (!base) return '';
    // Outermost fill first, each painted over what is below it.
    const out = fills.reverse().reduce<Rgb>((acc, [rgb, fa]) => [0, 1, 2].map((i) => rgb[i]! * fa + acc[i]! * (1 - fa)) as Rgb, base);
    return `rgb(${out.map(Math.round).join(', ')})`;
  }
  return '';
}

/** Top of the site's first visible placeholder action (Undo, Tell us why, Learn more), or null when none shows. */
function firstActionTop(actions: Element[]): number | null {
  let top: number | null = null;
  for (const a of actions) {
    const r = a.getBoundingClientRect();
    if (hasBox(r)) top = Math.min(top ?? r.top, r.top);
  }
  return top;
}

/**
 * Host for the removed-Tile annotation while the site's placeholder (YouTube's `.ytDismissibleItemReplacedContent`)
 * shows. It sits in the page-level overlay, so it takes no layout space and never shifts the site's layout. It reads as
 * part of the site's card: it spans the card's content column, the same width as its buttons. Where the band above
 * the site's sentence ("Video removed") leaves 8 px on both sides, it sits centred in that band. Otherwise
 * `data-cramped` and `--shoo-cover` make it cover the room between the card's top and the site's first button,
 * centred in it, over the sentence in the site's own ground colour (`--shoo-ground`), so no patch shows. A placeholder
 * drawn over the thumbnail (Bilibili's) gives it `data-surface`, a surface of its own. Hidden while the placeholder
 * has no box.
 */
export function mountAnnotationHost(
  site: Site,
  actionRoot: Element,
  opts: AnnotationHostOptions = {},
): (HostHandle & { update(): void; readonly channel: boolean }) | null {
  const spec = site.placeholder;
  const placeholder = spec.find(actionRoot);
  const doc = actionRoot.ownerDocument;
  const win = doc.defaultView;
  if (!placeholder || !win) return null;
  const { host, shadow } = makeHost(doc, CHIP_HOST_TAG, 'position:absolute;display:block;pointer-events:none;');
  host.toggleAttribute('data-surface', spec.overPicture);
  overlayLayer(doc).append(host);
  const card = () => spec.card(placeholder);

  // The site's ground under its card, read once per theme (the in-page UI calls update() when the theme changes).
  let ground: { dark: boolean; value: string } | null = null;
  const update = () => {
    const p = placeholder.getBoundingClientRect();
    if (!hasBox(p)) {
      host.style.visibility = 'hidden';
      return;
    }
    host.style.visibility = '';
    const c = spec.sentence(placeholder)?.getBoundingClientRect();
    const text = c && hasBox(c) ? c : null;
    const col = cardColumn(card(), p, win);
    const actions = firstActionTop(spec.actions(placeholder));
    const dark = site.isDark(doc);
    if (ground?.dark !== dark) ground = { dark, value: groundOf(card() ?? placeholder, win) };
    // The width first: the annotation's container queries and its height depend on it.
    host.style.left = `${col.left + win.scrollX}px`;
    host.style.width = `${Math.max(0, col.right - col.left)}px`;
    for (const a of ['data-cramped', 'data-tight', 'data-min']) host.removeAttribute(a); // measure the bare annotation
    // YouTube's buttons sit below its sentence on every card observed. Anything else (an action beside or above the
    // sentence, as on Bilibili's), or no sentence at all, is unknown markup: Shoo then sits 8 px below the placeholder's
    // top with no cover, so it never paints over an action or through the sentence.
    const known = !!text && (actions === null || actions - ACTION_CLEARANCE_PX >= text.bottom);
    // The room for Shoo's lines inside the card: from its top outline to 4 px above YouTube's first button, or to the
    // sentence's last line when no button is measured, so a cover never reaches an action Shoo could not find.
    const roomBottom = actions !== null ? actions - ACTION_CLEARANCE_PX : (text?.bottom ?? p.bottom);
    const room = Math.floor(roomBottom - col.top);
    const height = () => host.offsetHeight || ANNOTATION_LINE_PX;
    // Lines taller than the room: the CSS folds the title into line one or drops it (data-tight), then drops "Shooed by"
    // (data-min, the screen-reader sentence keeps it).
    if (shadow.querySelector('.vid') && height() > room) host.setAttribute('data-tight', '');
    if (height() > room) host.setAttribute('data-min', '');
    const h = height();
    // Centred in the band above YouTube's sentence, as far from the card's top as from the sentence.
    const band = text ? text.top - col.top : 0;
    const cramped = known && band - h < 2 * BAND_GAP_PX;
    // Covering, the host spans the room and the CSS centres the lines in it. Where YouTube's sentence overflows above
    // the card (Home at 5 Tiles per row), a strip as wide as the sentence covers it there (YouTube already paints
    // there), so the card's top outline beside it stays.
    const cap = cramped && text ? Math.max(0, Math.ceil(col.top - text.top)) : 0;
    const top = !known ? p.top + INSET_PX : cramped ? col.top - cap : col.top + (band - h) / 2;
    host.toggleAttribute('data-cramped', cramped);
    host.style.setProperty('--shoo-cover', cramped ? `${cap + Math.max(h, room)}px` : '');
    host.style.setProperty('--shoo-cap', cap ? `${cap}px` : '');
    host.style.setProperty('--shoo-cap-x', cap && text ? `${Math.max(0, Math.floor(text.left - col.left))}px` : '');
    host.style.setProperty('--shoo-cap-w', cap && text ? `${Math.ceil(Math.min(text.right, col.right) - Math.max(text.left, col.left))}px` : '');
    host.style.setProperty('--shoo-ground', cramped ? ground.value : '');
    host.style.top = `${Math.round(top + win.scrollY)}px`;
  };
  update();

  const RO = platformRO(win, opts.ResizeObserver);
  const ro = RO ? new RO(update) : null;
  ro?.observe(placeholder);
  ro?.observe(host); // its rendered height decides the placement on a short band
  ro?.observe(doc.body);
  for (const ev of site.navigatedEvents) doc.addEventListener(ev, update);
  // Bilibili hides its placeholder instead of removing it: a hidden placeholder is gone too.
  const live = () => host.isConnected && placeholder.isConnected && spec.find(actionRoot) === placeholder;
  const stopLoss = watchLoss([placeholder], opts.tile ?? actionRoot, live, () => opts.onLost?.());

  return {
    host,
    shadow,
    update,
    live,
    channel: spec.isChannel(placeholder),
    destroy() {
      ro?.disconnect();
      stopLoss();
      for (const ev of site.navigatedEvents) doc.removeEventListener(ev, update);
      host.remove();
    },
  };
}
