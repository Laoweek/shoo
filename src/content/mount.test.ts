// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BADGE_GAP_PX, CHIP_HOST_TAG, COMPACT_BELOW_PX, DEFAULT_BADGE_ZONE_PX, INSET_PX, OVERLAY_TAG, badgeZone, mountAnnotationHost, mountChipHost, placeOverThumbnail } from './mount';
import { FIXTURES, mountTile, parse } from '~/sites/youtube/test-harness';
import { isDark, observeTheme } from '~/sites/youtube/theme';
import type { SurfaceId } from '~/core/types';
import { surfaceOf } from '~/sites/site';
import { youtube } from '~/sites/youtube';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('dark');
});

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

/** A ResizeObserver stand-in (jsdom has none): `FakeRO.last.cb()` fires the latest one. */
class FakeRO {
  static last: FakeRO | null = null;
  targets: Element[] = [];
  constructor(public cb: () => void) {
    FakeRO.last = this;
  }
  observe = (el: Element) => void this.targets.push(el);
  disconnect = vi.fn();
}

// Snapshot of every YouTube element's attributes, to prove mounting never touches them.
function attrs(root: Element): string {
  return [...root.querySelectorAll('*')]
    .filter((el) => !el.closest(CHIP_HOST_TAG))
    .map((el) => `${el.localName}[${[...el.attributes].map((a) => `${a.name}=${a.value}`).join(',')}]`)
    .join('\n');
}

function placed(surface: SurfaceId, html: string, thumbWidth: number) {
  const tile = mountTile(html, surface);
  const def = surfaceOf(youtube, surface);
  const thumb = def.thumbnail(tile) as Element;
  const parent = def.mountParent(tile) as Element;
  vi.spyOn(thumb, 'getBoundingClientRect').mockReturnValue(rect(110, 220, thumbWidth, thumbWidth * 0.5625));
  vi.spyOn(parent, 'getBoundingClientRect').mockReturnValue(rect(100, 200, 400, 400));
  return { tile, thumb, parent };
}

describe('chip host', () => {
  it('appends one host with an open shadow root to mountParent, over the bottom-left of the thumbnail', () => {
    const { tile, parent } = placed('home', FIXTURES.homeTile, 320);
    const before = attrs(tile);
    const h = mountChipHost(youtube, tile, 'home', { forceOverlay: false }) as NonNullable<ReturnType<typeof mountChipHost>>;
    expect(h.host.localName).toBe(CHIP_HOST_TAG);
    expect(parent.lastElementChild).toBe(h.host);
    expect(h.host.closest('a')).toBeNull();
    expect(h.shadow.mode).toBe('open');
    expect(h.host.style.position).toBe('absolute');
    expect(h.host.style.left).toBe('18px'); // 110 - 100 + 8
    expect(h.host.style.top).toBe(`${220 + 180 - 200 - 8}px`); // thumbnail bottom - parent top - 8
    expect(h.host.style.pointerEvents).toBe('none');
    expect(h.compact).toBe(false);
    expect(h.overlay).toBe(false);
    expect(attrs(tile)).toBe(before); // YouTube's elements are untouched
    h.destroy();
    expect(tile.querySelector(CHIP_HOST_TAG)).toBeNull();
  });

  it('is compact below 320 px (Watch sidebar thumbnails of 200 to 310 px) and re-evaluates on resize', () => {
    expect(COMPACT_BELOW_PX).toBe(320);
    const { tile, thumb } = placed('watchSidebar', FIXTURES.watchTile, 260);
    const fire = () => FakeRO.last?.cb();
    const onCompactChange = vi.fn();
    const h = mountChipHost(youtube, tile, 'watchSidebar', { forceOverlay: false, ResizeObserver: FakeRO, onCompactChange });
    expect(h?.compact).toBe(true); // 260 px: the full chip would wrap to three rows
    vi.spyOn(thumb, 'getBoundingClientRect').mockReturnValue(rect(110, 220, 319, 179));
    fire();
    expect(h?.compact).toBe(true);
    vi.spyOn(thumb, 'getBoundingClientRect').mockReturnValue(rect(110, 220, 320, 180));
    fire();
    expect(h?.compact).toBe(false);
    expect(onCompactChange).toHaveBeenCalledWith(false);
    expect(FakeRO.last?.targets).toContain(h?.host); // a repaint (kept note, variant flip) re-runs the placement
  });

  it('sizes the host by its content in any containing block, capped clear of the badge zone', () => {
    const { tile } = placed('home', FIXTURES.homeTile, 360);
    const h = mountChipHost(youtube, tile, 'home', { forceOverlay: false }) as NonNullable<ReturnType<typeof mountChipHost>>;
    expect(h.host.style.width).toBe('max-content');
    // jsdom has no layout and no badge box: the default zone is kept free at the bottom-right.
    expect(h.host.style.maxWidth).toBe(`${360 - INSET_PX - DEFAULT_BADGE_ZONE_PX - BADGE_GAP_PX}px`);
    expect(h.host.hasAttribute('data-measuring')).toBe(false);
    expect(h.lifted).toBe(false);
  });

  it('measures the narrowest content with data-measuring set, where a long Rule label counts only as a word (components.css)', () => {
    const { tile } = placed('watchSidebar', FIXTURES.watchTile, 248);
    let reads = 0;
    // jsdom has no layout: stand in for Chrome's sizes (measured 2026-10-10). Measured, the compact chip with a long
    // label is 127 px plus the label's 40 px. Unmeasured, a long label would make it look 400 px wide.
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      if (this.localName !== CHIP_HOST_TAG) return 0;
      reads += 1;
      return this.hasAttribute('data-measuring') && this.style.width === 'min-content' ? 167 : 400;
    });
    const h = mountChipHost(youtube, tile, 'watchSidebar', { forceOverlay: false }) as NonNullable<ReturnType<typeof mountChipHost>>;
    expect(reads).toBe(1);
    // Beside the badge zone (jsdom measures no badge: the default zone, 248 - 8 - 64 - 8 = 168 px), not at full width.
    expect(h.lifted).toBe(false);
    expect(h.host.style.maxWidth).toBe(`${248 - INSET_PX - DEFAULT_BADGE_ZONE_PX - BADGE_GAP_PX}px`);
    expect(h.host.hasAttribute('data-measuring')).toBe(false);
  });

  it('mounts Shorts shelf chips in the page-level overlay, above YouTube\'s page-level hover preview', () => {
    const { tile, parent } = placed('shortsShelf', FIXTURES.shortsTile, 275);
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ position: 'relative' } as CSSStyleDeclaration);
    const h = mountChipHost(youtube, tile, 'shortsShelf') as NonNullable<ReturnType<typeof mountChipHost>>;
    expect(h.overlay).toBe(true);
    expect(parent.querySelector(CHIP_HOST_TAG)).toBeNull();
    const layer = h.host.parentElement as HTMLElement;
    expect(layer.localName).toBe(OVERLAY_TAG);
    expect(layer.parentElement).toBe(document.body);
    expect(Number(layer.style.zIndex)).toBeGreaterThan(2);
    h.destroy();
  });

  it('a thumbnail with no box yet keeps the host hidden and full, then re-evaluates on the first real size', () => {
    const { tile, thumb } = placed('home', FIXTURES.homeTile, 0);
    const onCompactChange = vi.fn();
    const h = mountChipHost(youtube, tile, 'home', { forceOverlay: false, ResizeObserver: FakeRO, onCompactChange }) as NonNullable<ReturnType<typeof mountChipHost>>;
    expect(h.compact).toBe(false);
    expect(h.host.style.visibility).toBe('hidden');
    vi.spyOn(thumb, 'getBoundingClientRect').mockReturnValue(rect(110, 220, 469, 264));
    FakeRO.last?.cb();
    expect(h.host.style.visibility).toBe('');
    expect(h.host.style.top).toBe(`${220 + 264 - 200 - 8}px`);
    expect(h.compact).toBe(false);
    expect(onCompactChange).toHaveBeenCalledWith(false); // first real width: the caller repaints with its max width
  });

  it('reports loss when YouTube replaces the thumbnail or the mount parent under the chip', async () => {
    const { tile, thumb } = placed('home', FIXTURES.homeTile, 320);
    const onLost = vi.fn();
    const h = mountChipHost(youtube, tile, 'home', { forceOverlay: false, onLost }) as NonNullable<ReturnType<typeof mountChipHost>>;
    thumb.replaceWith(thumb.cloneNode(true)); // a feed re-render swaps the thumbnail element
    await Promise.resolve();
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(h.live()).toBe(false);

    document.body.innerHTML = '';
    const shorts = placed('shortsShelf', FIXTURES.shortsTile, 275);
    const lost2 = vi.fn();
    const h2 = mountChipHost(youtube, shorts.tile, 'shortsShelf', { forceOverlay: false, onLost: lost2 }) as NonNullable<ReturnType<typeof mountChipHost>>;
    shorts.parent.remove(); // the inner Shorts lockup is re-rendered (seen in a live test)
    await Promise.resolve();
    expect(lost2).toHaveBeenCalledTimes(1);
    expect(h2.host.isConnected).toBe(false);
  });

  it('falls back to a page-level overlay when mountParent is position: static', () => {
    const { tile } = placed('shortsShelf', FIXTURES.shortsTile, 200);
    const h = mountChipHost(youtube, tile, 'shortsShelf'); // jsdom computes position: static
    expect(h?.overlay).toBe(true);
    expect(h?.host.parentElement?.localName).toBe(OVERLAY_TAG);
    expect(h?.host.parentElement?.parentElement).toBe(document.body);
    expect(h?.host.style.left).toBe('118px'); // document coordinates: 110 + scrollX 0 + 8
    expect(tile.querySelector(CHIP_HOST_TAG)).toBeNull();
    h?.destroy();
    expect(document.querySelector(CHIP_HOST_TAG)).toBeNull();
  });

  it('returns null when the Tile shows YouTube\'s placeholder (no thumbnail)', () => {
    const tile = parse(FIXTURES.watchPlaceholder);
    document.body.append(tile);
    expect(mountChipHost(youtube, tile, 'watchSidebar')).toBeNull();
  });
});

describe('placement clear of YouTube\'s duration badge', () => {
  // Live 2026-10-10: a 330 x 186 sidebar thumbnail with a 42 x 18 "29:32" badge inset 8 px.
  const thumb = rect(100, 100, 330, 186);
  const badge = { left: 100 + 330 - 8 - 42, top: 100 + 186 - 8 - 18 };

  it('sits bottom-left, no wider than the room left of the badge minus the gap', () => {
    const p = placeOverThumbnail(thumb, badge, 200);
    expect(p).toEqual({ maxWidth: badge.left - BADGE_GAP_PX - (100 + INSET_PX), bottom: 100 + 186 - INSET_PX, lifted: false });
    expect(100 + INSET_PX + p.maxWidth + BADGE_GAP_PX).toBeLessThanOrEqual(badge.left);
  });

  it('moves above the badge, at the thumbnail width minus 16 px, when the content needs more room than that', () => {
    const narrow = rect(100, 100, 200, 113);
    const zone = { left: 100 + 200 - 4 - 42, top: 100 + 113 - 4 - 18 };
    const p = placeOverThumbnail(narrow, zone, 145); // a one-row compact chip
    expect(p).toEqual({ maxWidth: 200 - 2 * INSET_PX, bottom: zone.top - BADGE_GAP_PX, lifted: true });
  });

  it('without a badge keeps the default zone free when it can, and the corner otherwise', () => {
    const shorts = rect(100, 100, 210, 315);
    expect(placeOverThumbnail(shorts, null, 100).maxWidth).toBe(210 - INSET_PX - DEFAULT_BADGE_ZONE_PX - BADGE_GAP_PX);
    expect(placeOverThumbnail(shorts, null, 180)).toEqual({ maxWidth: 210 - 2 * INSET_PX, bottom: 100 + 315 - INSET_PX, lifted: false });
  });

  it('reads badges over the bottom half of the thumbnail only (a top-left "New" or LIVE badge is not in the way)', () => {
    const t = parse(FIXTURES.watchTile);
    document.body.append(t);
    const thumbEl = t.querySelector('yt-thumbnail-view-model') as Element;
    const duration = thumbEl.querySelector('badge-shape') as Element;
    const top = document.createElement('badge-shape');
    thumbEl.append(top);
    const r = rect(100, 100, 330, 186);
    vi.spyOn(duration, 'getBoundingClientRect').mockReturnValue(rect(badge.left, badge.top, 42, 18));
    vi.spyOn(top, 'getBoundingClientRect').mockReturnValue(rect(108, 108, 36, 18));
    expect(badgeZone(thumbEl.querySelectorAll('badge-shape'), r)).toEqual(badge);
    vi.spyOn(duration, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 0, 0));
    expect(badgeZone(thumbEl.querySelectorAll('badge-shape'), r)).toBeNull();
  });
});

describe('annotation host (takes no layout space, never over YouTube\'s buttons)', () => {
  // Geometry from a live test on Home and the Shorts shelf (2026-10-10): the placeholder text and
  // buttons are centred vertically, so the band above "Video removed" is empty.
  const GEOMETRY = {
    home: { box: rect(656, 248, 410, 264), text: rect(800, 322, 120, 20), buttons: rect(667, 413, 388, 80) },
    shortsShelf: { box: rect(745, 105, 150, 266), text: rect(790, 205, 60, 16), buttons: rect(800, 314, 40, 30) },
    watchSidebar: { box: rect(1083, 310, 414, 146), text: rect(1243, 328, 94, 20), buttons: rect(1093, 363, 394, 80) },
  } as const;

  it.each([
    ['home', FIXTURES.homePlaceholder],
    ['watchSidebar', FIXTURES.watchPlaceholder],
    ['shortsShelf', FIXTURES.shortsPlaceholder],
  ] as const)('%s: mounts in the page-level overlay inside the placeholder, clear of YouTube\'s buttons', (surface, html) => {
    const root = parse(html);
    document.body.append(root);
    const placeholder = root.querySelector('.ytDismissibleItemReplacedContent') as Element;
    const g = GEOMETRY[surface];
    vi.spyOn(placeholder, 'getBoundingClientRect').mockReturnValue(g.box);
    vi.spyOn(root.querySelector('.ytNotificationMultiActionRendererTextContainer > *') as Element, 'getBoundingClientRect').mockReturnValue(g.text);
    vi.spyOn(placeholder.querySelector('button, a') as Element, 'getBoundingClientRect').mockReturnValue(g.buttons);
    const before = attrs(root);
    const h = mountAnnotationHost(youtube, root, { ResizeObserver: FakeRO }) as NonNullable<ReturnType<typeof mountAnnotationHost>>;
    // No layout space: nothing is added inside YouTube's placeholder, and its elements are untouched.
    expect(placeholder.querySelector(CHIP_HOST_TAG)).toBeNull();
    expect(attrs(root)).toBe(before);
    expect(h.host.parentElement?.localName).toBe(OVERLAY_TAG);
    expect(h.host.style.position).toBe('absolute');
    // Without YouTube's CSS the column falls back to an 8 px inset.
    expect(h.host.style.left).toBe(`${g.box.left + 8}px`);
    expect(h.host.style.width).toBe(`${g.box.width - 16}px`);
    const top = parseFloat(h.host.style.top);
    expect(top).toBeGreaterThan(g.box.top); // never over the Tile above, nor on YouTube's outline
    const cover = parseFloat(h.host.style.getPropertyValue('--shoo-cover')) || 24;
    expect(top + cover).toBeLessThanOrEqual(g.buttons.top - 4);
    if (surface === 'watchSidebar') {
      // An 18 px band: the annotation covers YouTube's sentence instead.
      expect(h.host.hasAttribute('data-cramped')).toBe(true);
      expect(top).toBeLessThanOrEqual(g.text.top);
      expect(top + cover).toBeGreaterThanOrEqual(g.text.bottom);
    } else {
      // As much air above the annotation as between it and "Video removed".
      expect(h.host.hasAttribute('data-cramped')).toBe(false);
      expect(Math.abs(top - (g.box.top + 1) - (g.text.top - (top + 24)))).toBeLessThanOrEqual(1);
    }
    expect(h.live()).toBe(true);
    h.destroy();
    expect(document.querySelector(CHIP_HOST_TAG)).toBeNull();
  });

  it('follows the placeholder on resize, hides while its page is hidden, and reports loss when YouTube removes it', async () => {
    const root = parse(FIXTURES.homePlaceholder);
    document.body.append(root);
    const placeholder = root.querySelector('.ytDismissibleItemReplacedContent') as Element;
    const spy = vi.spyOn(placeholder, 'getBoundingClientRect').mockReturnValue(rect(100, 200, 400, 225));
    const onLost = vi.fn();
    const h = mountAnnotationHost(youtube, root, { ResizeObserver: FakeRO, onLost }) as NonNullable<ReturnType<typeof mountAnnotationHost>>;
    expect(FakeRO.last?.targets).toContain(placeholder);
    spy.mockReturnValue(rect(100, 300, 400, 225));
    FakeRO.last?.cb();
    // No sentence to measure (unknown markup): it stays at the top, with no cover.
    expect(h.host.style.top).toBe('308px');
    expect(h.host.hasAttribute('data-cramped')).toBe(false);
    spy.mockReturnValue(rect(0, 0, 0, 0)); // the page went [hidden]
    FakeRO.last?.cb();
    expect(h.host.style.visibility).toBe('hidden');
    root.replaceChildren(); // YouTube's Undo or a re-render
    await Promise.resolve();
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(h.live()).toBe(false);
  });

  it('measures the visible "Video removed" text, not its container that grows to fill the placeholder', () => {
    const root = parse(FIXTURES.homePlaceholder);
    document.body.append(root);
    const placeholder = root.querySelector('.ytDismissibleItemReplacedContent') as Element;
    vi.spyOn(placeholder, 'getBoundingClientRect').mockReturnValue(rect(24, 147, 360, 203));
    // YouTube's CSS: the text container is flex: 1 and starts under the 20 px padding, the text sits 57 px down.
    vi.spyOn(root.querySelector('.ytNotificationMultiActionRendererTextContainer') as Element, 'getBoundingClientRect').mockReturnValue(rect(37, 168, 334, 90));
    vi.spyOn(root.querySelector('.ytNotificationMultiActionRendererTextContainer > *') as Element, 'getBoundingClientRect').mockReturnValue(rect(140, 205, 128, 22));
    const h = mountAnnotationHost(youtube, root) as NonNullable<ReturnType<typeof mountAnnotationHost>>;
    expect(h.host.style.top).toBe(`${Math.round(148 + (57 - 24) / 2)}px`); // centred on the 57 px band
    expect(h.host.hasAttribute('data-cramped')).toBe(false);
  });

  it('spans YouTube\'s content column, measured from its card\'s outline and padding', () => {
    const root = parse(FIXTURES.watchPlaceholder);
    document.body.append(root);
    const placeholder = root.querySelector('.ytDismissibleItemReplacedContent') as Element;
    const card = placeholder.querySelector('notification-multi-action-renderer') as HTMLElement;
    card.style.cssText = 'border: 1px solid; padding: 20px 12px 8px;'; // YouTube's values, 2026-10-10
    vi.spyOn(placeholder, 'getBoundingClientRect').mockReturnValue(rect(1237, 346, 475, 168));
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(rect(1237, 346, 475, 168));
    const h = mountAnnotationHost(youtube, root) as NonNullable<ReturnType<typeof mountAnnotationHost>>;
    expect(h.host.style.left).toBe(`${1237 + 13}px`); // the left edge of YouTube's Undo and "Tell us why"
    expect(h.host.style.width).toBe(`${475 - 26}px`);
  });

  describe('the cover (YouTube\'s sentence, where the band is too short)', () => {
    function mountCover(paint: (root: HTMLElement) => void = () => {}) {
      const root = parse(FIXTURES.homePlaceholder) as HTMLElement;
      paint(root);
      document.body.append(root);
      const placeholder = root.querySelector('.ytDismissibleItemReplacedContent') as Element;
      vi.spyOn(placeholder, 'getBoundingClientRect').mockReturnValue(rect(24, 147, 241, 136));
      // Home with 5 Tiles per row: "Video removed" starts above the box.
      vi.spyOn(root.querySelector('.ytNotificationMultiActionRendererTextContainer > *') as Element, 'getBoundingClientRect').mockReturnValue(rect(80, 140, 128, 22));
      vi.spyOn(placeholder.querySelector('button') as Element, 'getBoundingClientRect').mockReturnValue(rect(34, 180, 221, 36));
      return { root, h: mountAnnotationHost(youtube, root) as NonNullable<ReturnType<typeof mountAnnotationHost>> };
    }

    it('spans the room to 4 px above Undo, and above the card only as wide as the overflowing sentence', () => {
      const { h } = mountCover();
      expect(h.host.hasAttribute('data-cramped')).toBe(true);
      expect(h.host.style.top).toBe('140px'); // the sentence overflows above the box (140 < 148)
      expect(h.host.style.getPropertyValue('--shoo-cap')).toBe('8px');
      expect(h.host.style.getPropertyValue('--shoo-cover')).toBe(`${8 + (180 - 4 - 148)}px`);
      // Only the sentence's own width above the card's outline (column from x 32, sentence 80 to 208), so the outline
      // beside it stays.
      expect(h.host.style.getPropertyValue('--shoo-cap-x')).toBe(`${80 - 32}px`);
      expect(h.host.style.getPropertyValue('--shoo-cap-w')).toBe('128px');
    });

    it('is painted in the colour YouTube paints behind the card, so no patch shows', () => {
      const { h } = mountCover((root) => (root.style.backgroundColor = 'rgb(15, 15, 15)')); // stands in for ytd-app
      expect(h.host.style.getPropertyValue('--shoo-ground')).toBe('rgb(15, 15, 15)');
    });

    it('blends see-through fills over the first opaque ground, and skips fully transparent ones in any syntax', () => {
      const real = window.getComputedStyle.bind(window);
      const fills = new Map<Element, string>();
      vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
        const cs = real(el);
        const bg = fills.get(el);
        return bg === undefined ? cs : (new Proxy(cs, { get: (t, k) => (k === 'backgroundColor' ? bg : Reflect.get(t, k)) }) as CSSStyleDeclaration);
      });
      const { h } = mountCover((root) => {
        fills.set(root.querySelector('notification-multi-action-renderer') as Element, 'color(srgb 0 0 0 / 0)');
        fills.set(root.querySelector('.ytDismissibleItemReplacedContent') as Element, 'rgba(255, 255, 255, 0.1)');
        fills.set(root, 'rgb(15, 15, 15)');
      });
      expect(h.host.style.getPropertyValue('--shoo-ground')).toBe('rgb(39, 39, 39)'); // 15 + 10% of (255 - 15)
    });

    it('takes a fill on YouTube\'s card itself', () => {
      const { h } = mountCover((root) => {
        root.style.backgroundColor = 'rgb(15, 15, 15)';
        (root.querySelector('notification-multi-action-renderer') as HTMLElement).style.backgroundColor = 'rgb(33, 33, 33)';
      });
      expect(h.host.style.getPropertyValue('--shoo-ground')).toBe('rgb(33, 33, 33)');
    });

    it('reads the ground again when YouTube switches theme', () => {
      const { root, h } = mountCover((r) => (r.style.backgroundColor = 'rgb(255, 255, 255)'));
      expect(h.host.style.getPropertyValue('--shoo-ground')).toBe('rgb(255, 255, 255)');
      root.style.backgroundColor = 'rgb(15, 15, 15)';
      document.documentElement.setAttribute('dark', '');
      try {
        h.update(); // createPageUi calls it from its theme observer
        expect(h.host.style.getPropertyValue('--shoo-ground')).toBe('rgb(15, 15, 15)');
      } finally {
        document.documentElement.removeAttribute('dark');
      }
    });
  });

  it('stays at the top with no cover where YouTube\'s buttons are not below its sentence (unknown layout)', () => {
    const root = parse(FIXTURES.homePlaceholder);
    document.body.append(root);
    const placeholder = root.querySelector('.ytDismissibleItemReplacedContent') as Element;
    vi.spyOn(placeholder, 'getBoundingClientRect').mockReturnValue(rect(24, 100, 411, 231));
    vi.spyOn(root.querySelector('.ytNotificationMultiActionRendererTextContainer > *') as Element, 'getBoundingClientRect').mockReturnValue(rect(40, 150, 120, 22));
    vi.spyOn(placeholder.querySelector('button') as Element, 'getBoundingClientRect').mockReturnValue(rect(200, 150, 100, 36)); // beside it
    const h = mountAnnotationHost(youtube, root) as NonNullable<ReturnType<typeof mountAnnotationHost>>;
    expect(h.host.hasAttribute('data-cramped')).toBe(false);
    expect(h.host.style.top).toBe('108px');
  });

  describe('the title line (42 px with it, 24 px without it)', () => {
    function mountTwoLines(box: DOMRect, text: DOMRect, undoTop: number) {
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
        return this.localName === CHIP_HOST_TAG ? (this.hasAttribute('data-tight') ? 24 : 42) : 0;
      });
      const root = parse(FIXTURES.homePlaceholder);
      document.body.append(root);
      vi.spyOn(root.querySelector('.ytDismissibleItemReplacedContent') as Element, 'getBoundingClientRect').mockReturnValue(box);
      vi.spyOn(root.querySelector('.ytNotificationMultiActionRendererTextContainer > *') as Element, 'getBoundingClientRect').mockReturnValue(text);
      vi.spyOn(root.querySelector('.ytNotificationMultiActionRendererButton button') as Element, 'getBoundingClientRect').mockReturnValue(rect(box.left + 10, undoTop, box.width - 20, 36));
      const h = mountAnnotationHost(youtube, root) as NonNullable<ReturnType<typeof mountAnnotationHost>>;
      h.shadow.append(Object.assign(document.createElement('span'), { className: 'vid' })); // as renderAnnotation does
      h.update();
      return h;
    }

    it('both lines take the room above YouTube\'s buttons where it holds them (Watch sidebar, live 2026-10-10)', () => {
      const h = mountTwoLines(rect(1237, 346, 475, 168), rect(1421, 367, 107, 22), 407);
      expect(h.host.hasAttribute('data-tight')).toBe(false);
      expect(h.host.hasAttribute('data-cramped')).toBe(true);
      expect(h.host.style.top).toBe('347px');
      expect(h.host.style.getPropertyValue('--shoo-cover')).toBe(`${407 - 4 - 347}px`); // the CSS centres both lines in it
    });

    it('still fit a tighter sidebar with no air to spare', () => {
      const h = mountTwoLines(rect(1083, 310, 414, 146), rect(1243, 328, 94, 20), 359);
      expect(h.host.hasAttribute('data-tight')).toBe(false);
      expect(parseFloat(h.host.style.top) + 42).toBeLessThanOrEqual(359 - 4);
    });

    it('sit centred in a band that leaves 8 px on both sides, with YouTube\'s sentence still showing', () => {
      const roomy = mountTwoLines(rect(24, 100, 411, 231), rect(150, 170, 120, 22), 260);
      expect(roomy.host.hasAttribute('data-cramped')).toBe(false);
      expect(roomy.host.style.top).toBe(`${Math.round(101 + (69 - 42) / 2)}px`);
    });

    it('cover YouTube\'s sentence when the band leaves less than 8 px on a side (two lines must not read as one paragraph with it)', () => {
      const close = mountTwoLines(rect(24, 100, 411, 231), rect(150, 154, 120, 22), 260);
      expect(close.host.hasAttribute('data-cramped')).toBe(true);
      expect(close.host.hasAttribute('data-tight')).toBe(false);
      expect(close.host.style.top).toBe('101px');
    });

    it('fold into line one (data-tight) where two lines would reach YouTube\'s buttons (Home at 5 Tiles per row)', () => {
      const h = mountTwoLines(rect(24, 147, 241, 136), rect(80, 140, 128, 22), 180);
      expect(h.host.hasAttribute('data-tight')).toBe(true);
      expect(h.host.hasAttribute('data-min')).toBe(false);
      expect(h.host.style.top).toBe('140px');
      expect(h.host.style.getPropertyValue('--shoo-cover')).toBe(`${8 + 180 - 4 - 148}px`);
    });

    it('drop "Shooed by" too (data-min) where even the folded line is taller than the room', () => {
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
        if (this.localName !== CHIP_HOST_TAG) return 0;
        return this.hasAttribute('data-min') ? 24 : this.hasAttribute('data-tight') ? 48 : 60; // line one wraps
      });
      const root = parse(FIXTURES.homePlaceholder);
      document.body.append(root);
      vi.spyOn(root.querySelector('.ytDismissibleItemReplacedContent') as Element, 'getBoundingClientRect').mockReturnValue(rect(24, 147, 241, 136));
      vi.spyOn(root.querySelector('.ytNotificationMultiActionRendererTextContainer > *') as Element, 'getBoundingClientRect').mockReturnValue(rect(80, 150, 128, 22));
      vi.spyOn(root.querySelector('.ytNotificationMultiActionRendererButton button') as Element, 'getBoundingClientRect').mockReturnValue(rect(34, 190, 221, 36));
      const h = mountAnnotationHost(youtube, root) as NonNullable<ReturnType<typeof mountAnnotationHost>>;
      h.shadow.append(Object.assign(document.createElement('span'), { className: 'vid' }));
      h.update();
      expect(h.host.hasAttribute('data-tight')).toBe(true);
      expect(h.host.hasAttribute('data-min')).toBe(true);
      expect(h.host.style.getPropertyValue('--shoo-cover')).toBe(`${190 - 4 - 148}px`); // ends 4 px above Undo
    });
  });

  it('a wrapped "Don\'t recommend channel" sentence is covered whole, and never past a button it found', () => {
    const root = parse(FIXTURES.homePlaceholder);
    document.body.append(root);
    const placeholder = root.querySelector('.ytDismissibleItemReplacedContent') as Element;
    vi.spyOn(placeholder, 'getBoundingClientRect').mockReturnValue(rect(24, 100, 300, 169));
    vi.spyOn(root.querySelector('.ytNotificationMultiActionRendererTextContainer > *') as Element, 'getBoundingClientRect').mockReturnValue(rect(40, 112, 268, 51)); // three lines
    const h = mountAnnotationHost(youtube, root) as NonNullable<ReturnType<typeof mountAnnotationHost>>;
    // No button measured: the cover ends at the sentence's last line.
    expect(h.host.hasAttribute('data-cramped')).toBe(true);
    expect(h.host.style.top).toBe('101px');
    expect(h.host.style.getPropertyValue('--shoo-cover')).toBe(`${112 + 51 - 101}px`);
    vi.spyOn(placeholder.querySelector('button') as Element, 'getBoundingClientRect').mockReturnValue(rect(34, 175, 280, 36));
    h.update();
    expect(h.host.style.getPropertyValue('--shoo-cover')).toBe(`${175 - 4 - 101}px`);
  });

  it('tells the "Don\'t recommend channel" placeholder (Learn more link) from the "Not interested" one', () => {
    const channelHtml = readFileSync(join(__dirname, '../../test/fixtures/youtube/home-removed-channel-placeholder.html'), 'utf8');
    const ch = parse(channelHtml);
    document.body.append(ch);
    expect(mountAnnotationHost(youtube, ch)?.channel).toBe(true);
    const plain = parse(FIXTURES.homePlaceholder);
    document.body.append(plain);
    expect(mountAnnotationHost(youtube, plain)?.channel).toBe(false);
  });

  it('mounts no annotation host when there is no placeholder', () => {
    const plain = mountTile(FIXTURES.watchTile, 'watchSidebar');
    expect(mountAnnotationHost(youtube, plain)).toBeNull();
  });

});

describe('theme', () => {
  it('reads html[dark] and reports live switches until disposed', async () => {
    expect(isDark(document)).toBe(false);
    const cb = vi.fn();
    const dispose = observeTheme(document, cb);
    document.documentElement.setAttribute('dark', '');
    await Promise.resolve();
    expect(cb).toHaveBeenLastCalledWith(true);
    document.documentElement.removeAttribute('dark');
    await Promise.resolve();
    expect(cb).toHaveBeenLastCalledWith(false);
    dispose();
    document.documentElement.setAttribute('dark', '');
    await Promise.resolve();
    expect(cb).toHaveBeenCalledTimes(2);
    expect(isDark(document)).toBe(true);
  });
});
