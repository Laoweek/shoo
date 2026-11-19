// Test-only helpers for the Bilibili Site's tests. Never imported by production code. Simulates the parts of Bilibili
// that Shoo drives (docs/spec/bilibili-integration.md Sections 3 and 4): a popover per Tile that opens on mouseenter of
// the menu button and closes after mouseleave, the placeholder that was hidden inside the Tile, and its Undo.
import { parse } from '~/content/test-dom';

import homeAdTile from '../../../test/fixtures/bilibili/home-ad-tile.html?raw';
import homeMenu from '../../../test/fixtures/bilibili/home-menu.html?raw';
import homeTile from '../../../test/fixtures/bilibili/home-tile.html?raw';
import videoSidebarTile from '../../../test/fixtures/bilibili/video-sidebar-tile.html?raw';

export const FIXTURES = { homeAdTile, homeMenu, homeTile, videoSidebarTile };

/** The Home fixture Tile showing another video, uploader and title. */
export function homeTileFor(n: number): string {
  const id = `BV1FIXTURE${String(n).padStart(2, '0')}`;
  return homeTile.replaceAll('BV1FIXTURE01', id).replaceAll('Fixture title 1', `Fixture title ${n}`).replaceAll('Fixture Uploader 1', `Fixture Uploader ${n}`).replaceAll('10000001', String(10000000 + n));
}

/**
 * Bilibili Home as the watcher meets it (live 2026-10-18): the feed container holds the carousel, feed-cards (video
 * Tiles and an ad), a floor (bangumi), loading skeletons, then bili-feed-cards from the infinite feed.
 */
export function loadHome(doc: Document = document): Element {
  doc.defaultView?.history.replaceState(null, '', '/');
  doc.body.innerHTML = `<div id="app"><div class="bili-feed4"><main class="bili-feed4-layout"><div class="feed2"><div class="recommended-container_floor-aside"><div class="container is-version8"></div></div></div></main></div></div>`;
  const container = doc.querySelector('.recommended-container_floor-aside > .container') as Element;
  container.innerHTML = '<div class="recommended-swipe"><div class="recommended-swipe-core"><div class="bili-video-card"></div></div></div>';
  container.append(parse(homeTileFor(1), doc), parse(homeAdTile, doc), parse(homeTileFor(2), doc));
  container.insertAdjacentHTML('beforeend', '<div class="floor-single-card"><div class="floor-card single-card"><a href="https://www.bilibili.com/bangumi/play/ss1"></a></div></div>');
  container.insertAdjacentHTML('beforeend', '<div class="bili-video-card"><div class="bili-video-card__skeleton"></div></div>');
  const fed = parse(homeTileFor(3), doc);
  fed.className = 'bili-feed-card';
  fed.innerHTML = fed.querySelector('.bili-feed-card')!.innerHTML;
  container.append(fed);
  return container;
}

export interface BilibiliWire {
  openDelayMs?: number; // mouseenter → popover shown
  closeDelayMs?: number; // mouseleave → popover hidden
  placeholderDelayMs?: number; // item click → placeholder shown
  undoDelayMs?: number; // 撤销 click → Tile restored
  neverOpen?: boolean;
}

export interface BilibiliSim {
  log: string[];
  wire(tile: Element, opts?: BilibiliWire): void;
  /** The user hovers a Tile's menu button themselves: its popover opens. */
  hoverAsUser(tile: Element): Element;
  popoverOf(tile: Element): HTMLElement | undefined;
}

const videoOf = (tile: Element) => /BV1FIXTURE\d\d/.exec(tile.innerHTML)?.[0] ?? '?';
const show = (el: Element | null, on: boolean) => el && ((el as HTMLElement).style.display = on ? '' : 'none');

export function simulateBilibili(doc: Document = document): BilibiliSim {
  const log: string[] = [];
  const popovers = new Map<Element, HTMLElement>();

  const popover = (tile: Element, opts: BilibiliWire): HTMLElement => {
    let p = popovers.get(tile);
    if (p?.isConnected) return p;
    p = parse(homeMenu, doc) as HTMLElement;
    p.style.display = 'none';
    doc.body.append(p);
    popovers.set(tile, p);
    p.addEventListener('click', (ev) => {
      const item = (ev.target as Element).closest('.bili-video-card__info--no-interest-panel--item');
      if (!item) return;
      const label = item.textContent?.trim() ?? '';
      log.push(`click:${label}@${videoOf(tile)}`);
      p!.remove(); // Bilibili removes the popover once an item is chosen
      setTimeout(() => {
        const ph = tile.querySelector('.bili-video-card__no-interest');
        const title = ph?.querySelector('.no-interest-title');
        if (title) title.textContent = label;
        show(ph, true);
        show(tile.querySelector('.bili-video-card__info'), false);
        log.push(`placeholder@${videoOf(tile)}`);
      }, opts.placeholderDelayMs ?? 15);
    });
    return p;
  };

  return {
    log,
    wire(tile, opts = {}) {
      const button = tile.querySelector('.bili-video-card__info--no-interest') as HTMLElement;
      let closing: ReturnType<typeof setTimeout> | undefined;
      button.addEventListener('mouseenter', () => {
        log.push(`hover@${videoOf(tile)}`);
        clearTimeout(closing);
        if (opts.neverOpen) return;
        setTimeout(() => (popover(tile, opts).style.display = ''), opts.openDelayMs ?? 30);
      });
      button.addEventListener('mouseleave', () => {
        closing = setTimeout(() => {
          const p = popovers.get(tile);
          if (p) p.style.display = 'none';
        }, opts.closeDelayMs ?? 600);
      });
      tile.querySelector('.revert-btn')?.addEventListener('click', () => {
        setTimeout(() => {
          show(tile.querySelector('.bili-video-card__no-interest'), false);
          show(tile.querySelector('.bili-video-card__info'), true);
          log.push(`restored@${videoOf(tile)}`);
        }, opts.undoDelayMs ?? 15);
      });
    },
    hoverAsUser(tile) {
      const p = popover(tile, {});
      p.style.display = '';
      log.push(`hover@user`);
      return p;
    },
    popoverOf: (tile) => popovers.get(tile),
  };
}
