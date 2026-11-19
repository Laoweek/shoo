// Test-only helpers for the YouTube Site's tests, the content engine's tests and the extraction benchmark. Never
// imported by production code. Simulates the parts of YouTube that Shoo drives: the reused menu dropdown, lazy menu
// icons, the removed-Tile placeholder and its Undo (docs/spec/youtube-integration.md Section 8).
import type { SurfaceId } from '~/core/types';
import { parse } from '~/content/test-dom';
import { surfaceOf } from '../site';
import { youtube } from '.';

export { fakeIntersection, loadPage, manualScheduler, microtasks, parse } from '~/content/test-dom';

import channelMenu from '../../../test/fixtures/youtube/channel-menu.html?raw';
import channelTile from '../../../test/fixtures/youtube/channel-tile.html?raw';
import homeAdTile from '../../../test/fixtures/youtube/home-ad-tile.html?raw';
import homeLiveTile from '../../../test/fixtures/youtube/home-live-tile.html?raw';
import homeMenu from '../../../test/fixtures/youtube/home-menu.html?raw';
import homeMixTile from '../../../test/fixtures/youtube/home-mix-tile.html?raw';
import homeChannelPlaceholder from '../../../test/fixtures/youtube/home-removed-channel-placeholder.html?raw';
import homePlaceholder from '../../../test/fixtures/youtube/home-removed-placeholder.html?raw';
import homeShortsShelfHeader from '../../../test/fixtures/youtube/home-shorts-shelf-header.html?raw';
import homeShortsShelfMenu from '../../../test/fixtures/youtube/home-shorts-shelf-menu.html?raw';
import homeTile from '../../../test/fixtures/youtube/home-tile.html?raw';
import pageHome from '../../../test/fixtures/youtube/page-home.html?raw';
import pageWatch from '../../../test/fixtures/youtube/page-watch.html?raw';
import searchMenu from '../../../test/fixtures/youtube/search-menu.html?raw';
import searchTile from '../../../test/fixtures/youtube/search-tile.html?raw';
import shortsMenu from '../../../test/fixtures/youtube/shorts-menu.html?raw';
import shortsPlaceholder from '../../../test/fixtures/youtube/shorts-removed-placeholder.html?raw';
import shortsTile from '../../../test/fixtures/youtube/shorts-tile.html?raw';
import watchMenu from '../../../test/fixtures/youtube/watch-menu.html?raw';
import watchPlaceholder from '../../../test/fixtures/youtube/watch-removed-placeholder.html?raw';
import watchTile from '../../../test/fixtures/youtube/watch-tile.html?raw';

export const FIXTURES = {
  channelMenu,
  channelTile,
  homeAdTile,
  homeChannelPlaceholder,
  homeLiveTile,
  homeMenu,
  homeMixTile,
  homePlaceholder,
  homeShortsShelfHeader,
  homeShortsShelfMenu,
  homeTile,
  pageHome,
  pageWatch,
  searchMenu,
  searchTile,
  shortsMenu,
  shortsPlaceholder,
  shortsTile,
  watchMenu,
  watchPlaceholder,
  watchTile,
};

/** Append the composed page's `template#continuation-batch` to the visible container, as YouTube does on scroll. */
export function appendContinuation(container: Element, doc: Document = document): Element[] {
  const tpl = doc.querySelector<HTMLTemplateElement>('template#continuation-batch');
  if (!tpl) throw new Error('no continuation batch');
  container.querySelector(':scope > ytd-continuation-item-renderer')?.remove();
  const nodes = [...tpl.content.children].map((c) => doc.importNode(c, true));
  container.append(...nodes);
  return nodes;
}

/** Put a single Tile into a minimal page so the registry, watcher and queue can find it. */
export function mountTile(html: string, surface: SurfaceId, doc: Document = document): Element {
  const tile = parse(html, doc);
  const page = surface === 'watchSidebar' ? 'ytd-watch-flexy' : 'ytd-browse';
  const wrapper = doc.createElement('div');
  wrapper.innerHTML = `<ytd-page-manager><${page} page-subtype="home"><div id="tile-slot"></div></${page}></ytd-page-manager><ytd-popup-container></ytd-popup-container>`;
  if (!doc.querySelector('ytd-page-manager')) doc.body.append(...wrapper.childNodes);
  doc.querySelector('#tile-slot')?.append(tile);
  return tile;
}

/** Strip every menu <svg> and re-insert them after `delayMs`, like YouTube's lazily rendered icons. */
export function withLazyIcons(menuEl: Element, delayMs: number): void {
  const svgs = [...menuEl.querySelectorAll('svg')].map((svg) => ({ svg, parent: svg.parentNode as Node }));
  for (const { svg } of svgs) svg.remove();
  setTimeout(() => {
    for (const { svg, parent } of svgs) parent.appendChild(svg);
  }, delayMs);
}

export interface WireOptions {
  menuHtml: string; // a menu fixture (tp-yt-iron-dropdown root)
  placeholderHtml?: string; // default: the captured placeholder of the Tile's Surface (PLACEHOLDERS)
  openDelayMs?: number; // menu button click → dropdown open
  iconDelayMs?: number; // withLazyIcons delay, undefined: icons present at once
  staleMs?: number; // the dropdown opens at once with its previous content, the new items arrive after staleMs
  neverOpen?: boolean;
  placeholderDelayMs?: number;
  noPlaceholder?: boolean;
}

export interface YouTubeSim {
  dropdown(): HTMLElement | null;
  log: string[];
  wire(tile: Element, surface: SurfaceId, opts: WireOptions): void;
  /** The user opens a menu themselves. */
  openAsUser(menuHtml: string): HTMLElement;
  /** The user reopens the reused dropdown with the same items at the same position. */
  reopenAsUser(): HTMLElement;
  /** Ignore the next n Escape presses (a menu that does not close). */
  ignoreEscapes: number;
  close(): void;
}

/** Captured placeholders, each rooted at its Surface's actionRoot. */
export const PLACEHOLDERS: Partial<Record<SurfaceId, string>> = {
  home: homePlaceholder,
  watchSidebar: watchPlaceholder,
  shortsShelf: shortsPlaceholder,
};

const ACTION_LABELS = new Set(['Not interested', "Don't recommend channel"]);

/** A simulated YouTube: one reused tp-yt-iron-dropdown in ytd-popup-container, menu items, placeholder and Undo. */
export function simulateYouTube(doc: Document = document): YouTubeSim {
  const log: string[] = [];
  let dropdown: HTMLElement | null = null;
  let renderedFor: { tile: Element; surface: SurfaceId; opts: WireOptions } | null = null;
  let opens = 0;

  const ensureDropdown = (): HTMLElement => {
    if (dropdown) return dropdown;
    let popup = doc.querySelector('ytd-popup-container');
    if (!popup) {
      popup = doc.createElement('ytd-popup-container');
      doc.body.append(popup);
    }
    const d = doc.createElement('tp-yt-iron-dropdown');
    d.setAttribute('aria-hidden', 'true');
    popup.append(d);
    d.addEventListener('click', (ev) => {
      const item = (ev.target as Element).closest('yt-list-item-view-model, ytd-menu-service-item-renderer');
      const label = item?.querySelector('.ytListItemViewModelTitle, yt-formatted-string')?.textContent?.trim() ?? '';
      const target = renderedFor;
      log.push(`click:${label}${target ? `@${videoOf(target.tile)}` : ''}`);
      sim.close();
      if (target && ACTION_LABELS.has(label) && !target.opts.noPlaceholder) {
        setTimeout(() => swapForPlaceholder(target.tile, target.surface, target.opts.placeholderHtml ?? PLACEHOLDERS[target.surface] ?? watchPlaceholder), target.opts.placeholderDelayMs ?? 15);
      }
    });
    d.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return;
      if (sim.ignoreEscapes > 0) {
        sim.ignoreEscapes -= 1;
        log.push('escape(ignored)');
        return;
      }
      log.push('escape');
      sim.close();
    });
    return (dropdown = d);
  };

  const render = (menuHtml: string, iconDelayMs?: number) => {
    const d = ensureDropdown();
    d.innerHTML = parse(menuHtml, doc).innerHTML;
    opens += 1;
    d.style.top = `${100 + opens * 37}px`;
    d.style.left = `${200 + opens * 11}px`;
    if (iconDelayMs !== undefined) withLazyIcons(d, iconDelayMs);
  };
  const show = () => {
    const d = ensureDropdown();
    d.removeAttribute('aria-hidden');
    d.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  };

  const swapForPlaceholder = (tile: Element, surface: SurfaceId, placeholderHtml: string) => {
    const root = surfaceOf(youtube, surface).actionRoot(tile);
    if (!root) return;
    const original = [...root.childNodes];
    const replacement = [...parse(placeholderHtml, doc).childNodes];
    root.replaceChildren(...replacement);
    log.push(`placeholder@${videoOfIds(original)}`);
    root.querySelector('.ytNotificationMultiActionRendererButtonContainer button')?.addEventListener('click', () => {
      setTimeout(() => {
        root.replaceChildren(...original);
        log.push(`restored@${videoOf(tile)}`);
      }, 15);
    });
  };

  const sim: YouTubeSim = {
    dropdown: () => dropdown,
    log,
    wire(tile, surface, opts) {
      const button = surfaceOf(youtube, surface).menuButton(tile);
      button?.addEventListener('click', () => {
        log.push(`open@${videoOf(tile)}`);
        if (opts.neverOpen) return;
        const reveal = () => {
          renderedFor = { tile, surface, opts };
          render(opts.menuHtml, opts.iconDelayMs);
          show();
        };
        if (opts.staleMs !== undefined) {
          setTimeout(show, opts.openDelayMs ?? 30); // previous items still inside
          setTimeout(reveal, (opts.openDelayMs ?? 30) + opts.staleMs);
        } else setTimeout(reveal, opts.openDelayMs ?? 30);
      });
    },
    openAsUser(menuHtml) {
      renderedFor = null;
      render(menuHtml);
      show();
      log.push('open@user');
      return ensureDropdown();
    },
    reopenAsUser() {
      renderedFor = null;
      show();
      log.push('reopen@user');
      return ensureDropdown();
    },
    ignoreEscapes: 0,
    close() {
      dropdown?.setAttribute('aria-hidden', 'true');
    },
  };
  return sim;
}

// SYNTHETIC Shelf markup, not captured from youtube.com. No fixture shows a dismissed Shelf or a games shelf yet
// (youtube-integration.md Section 10, pending fixture). These helpers exercise Shoo's logic around a guessed shape.
// They prove nothing about YouTube's real markup.

/** SYNTHETIC: a one-item sheet menu labelled `label`. */
export const syntheticShelfMenu = (label: string) =>
  `<tp-yt-iron-dropdown><yt-list-view-model role="menu"><yt-list-item-view-model><button role="menuitem"><span class="ytListItemViewModelTitle">${label}</span></button></yt-list-item-view-model></yt-list-view-model></tp-yt-iron-dropdown>`;

/** SYNTHETIC: give a Shelf a header control, its menu button, or a button that dismisses it, labelled `label`. */
export function addSyntheticShelfControl(shelf: Element, control: 'menu' | { label: string }, doc: Document = document): HTMLElement {
  const box = shelf.querySelector('#dismissible') ?? shelf;
  const header = doc.createElement('div');
  header.id = 'rich-shelf-header-container';
  header.innerHTML =
    control === 'menu'
      ? '<div id="menu"><ytd-menu-renderer><button aria-label="Action menu"></button></ytd-menu-renderer></div>'
      : `<div id="dismiss-button"><button aria-label="${control.label}"></button></div>`;
  box.prepend(header);
  return header.querySelector('button') as HTMLElement;
}

/**
 * The captured Shorts shelf section (home-shorts-shelf-header.html) in place of page-home.html's stripped one, with
 * the Shorts moved into it. Returns the new Shelf.
 */
export function useCapturedShortsShelf(shelf: Element, doc: Document = document): Element {
  const captured = parse(FIXTURES.homeShortsShelfHeader, doc);
  captured.querySelector('#contents')!.append(...shelf.querySelector('#contents')!.children);
  shelf.closest('ytd-rich-section-renderer')!.replaceWith(captured);
  return captured.querySelector('ytd-rich-shelf-renderer')!;
}

/** SYNTHETIC: a games shelf (a rich shelf whose Tiles link to /playables), appended to the Home grid `#contents`. */
export function addSyntheticGamesShelf(grid: Element, doc: Document = document): Element {
  const section = doc.createElement('ytd-rich-section-renderer');
  section.innerHTML =
    '<div id="content"><ytd-rich-shelf-renderer><div id="dismissible"><span id="title">Fixture games</span><div id="contents">' +
    '<ytd-rich-item-renderer is-shelf-item=""><a href="/playables/FIXTUREgame1">Fixture game 1</a></ytd-rich-item-renderer>' +
    '</div></div></ytd-rich-shelf-renderer></div>';
  grid.append(section);
  return section.querySelector('ytd-rich-shelf-renderer') as Element;
}

/**
 * SYNTHETIC: a click on the Shelf's control (with `menuLabel`, on that item of the menu it opens) folds the Shelf
 * away and adds a notice with an Undo button. Any other menu item only closes the menu. `menuHtml` replaces the
 * synthetic menu, for example with the captured one (`FIXTURES.homeShortsShelfMenu`). The dismissed state stays synthetic.
 */
export function wireShelf(
  sim: YouTubeSim,
  shelf: Element,
  control: HTMLElement,
  menuLabel?: string,
  doc: Document = document,
  menuHtml?: string,
): void {
  const dismiss = () =>
    setTimeout(() => {
      shelf.querySelector('#dismissible')?.setAttribute('hidden', '');
      const notice = doc.createElement('notification-multi-action-renderer');
      notice.innerHTML = '<button>Undo</button>';
      (shelf.closest('ytd-rich-section-renderer') ?? shelf).append(notice);
      sim.log.push('shelfDismissed');
    }, 15);
  control.addEventListener('click', () => {
    sim.log.push('open@shelf');
    if (menuLabel === undefined) return dismiss();
    setTimeout(() => {
      const d = sim.openAsUser(menuHtml ?? syntheticShelfMenu(menuLabel));
      d.addEventListener('click', () => SHELF_DISMISS.has(menuLabel) && dismiss(), { once: true });
    }, 30);
  });
}
const SHELF_DISMISS = new Set(['Show fewer Shorts', 'Show fewer games', 'Not interested']);

function videoOf(tile: Element): string {
  const lockup = /content-id-([\w-]+)/.exec(tile.innerHTML + ' ' + (tile.getAttribute('class') ?? ''));
  const short = /\/shorts\/([\w-]{11})/.exec(tile.innerHTML);
  return lockup?.[1] ?? short?.[1] ?? '?';
}
function videoOfIds(nodes: Node[]): string {
  const wrap = document.createElement('div');
  for (const n of nodes) wrap.append(n.cloneNode(true));
  return videoOf(wrap);
}

/**
 * A click with `isTrusted` true, like the user's. `el.click()` is untrusted, like Shoo's own clicks. jsdom fires a
 * trusted click on a label's control when the label is clicked, so the label goes to the body, away from the Tile
 * and the dropdown, and is removed again.
 */
export function userClick(el: HTMLElement, doc: Document = document): void {
  el.id ||= `user-click-${Math.random().toString(36).slice(2)}`;
  const label = doc.createElement('label');
  label.htmlFor = el.id;
  doc.body.append(label);
  label.click();
  label.remove();
}
