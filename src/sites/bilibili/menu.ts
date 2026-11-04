// Bilibili's Tile menu and removed-Tile placeholder. Source of truth: docs/spec/bilibili-integration.md Sections 3
// and 4. Observed live on 2026-10-18 (zh-CN, signed out): hovering a Tile's menu button opens a popover of its own,
// appended to <body>, with "内容不感兴趣" and "不想看此UP主". A click on either shows the placeholder that was
// already inside the Tile (hidden until then), with "撤销" (Undo).
import type { NativeAction } from '~/core/types';
import type { SiteMenu, SitePlaceholder } from '../site';

const POPOVER_SEL = 'body > .vui_popover';
const PANEL_SEL = '.bili-video-card__info--no-interest-panel';
const ITEM_SEL = '.bili-video-card__info--no-interest-panel--item';
const PLACEHOLDER_SEL = '.bili-video-card__no-interest';

// The items carry no icon, so text is the only mark. Bilibili's web UI offers no other language [inf]. "不感兴趣" is
// the item's shorter wording on older cards [unverified].
export const NOT_INTERESTED_LABELS = ['内容不感兴趣', '不感兴趣'];
export const DONT_RECOMMEND_CHANNEL_LABELS = ['不想看此UP主'];

const LABELS: Record<NativeAction, readonly string[]> = {
  notInterested: NOT_INTERESTED_LABELS,
  dontRecommendChannel: DONT_RECOMMEND_CHANNEL_LABELS,
};

const displayed = (el: Element | null): el is Element =>
  !!el && (el.ownerDocument.defaultView?.getComputedStyle(el).display ?? (el as HTMLElement).style?.display) !== 'none';

// Bilibili's popover opens on mouseenter and closes about 0.6 s after mouseleave. A synthetic click on the button
// does nothing (live test 2026-10-18). No `view`: Firefox content scripts may not pass their window to page events.
const hover = (button: HTMLElement, type: 'mouseenter' | 'mouseleave') => button.dispatchEvent(new MouseEvent(type, { bubbles: false, cancelable: false }));

export const bilibiliMenu: SiteMenu = {
  menus: (doc) => [...doc.querySelectorAll(POPOVER_SEL)].filter((p) => p.querySelector(PANEL_SEL) !== null),
  isOpen: (p) => displayed(p) && p.querySelector(ITEM_SEL) !== null,
  // Each Tile gets its own popover, kept hidden after it closes: no reuse across Tiles.
  shared: false,
  // Popper moves an open popover (its transform) when the page scrolls or lays out, so position tells nothing here.
  signature: (p) => ({ first: p.querySelector(ITEM_SEL), pos: '' }),
  open: (button) => hover(button, 'mouseenter'),
  hoverTrigger: '.bili-video-card__info--no-interest',
  close: (_p, button) => {
    if (button) hover(button, 'mouseleave');
  },
  release: (button) => hover(button, 'mouseleave'),
  findItem(p, action) {
    for (const item of p.querySelectorAll(ITEM_SEL)) {
      if (LABELS[action].includes(item.textContent?.trim() ?? '')) return item;
    }
    return null;
  },
  // The item itself takes the click.
  clickTarget: (item) => item as HTMLElement,
};

export const bilibiliPlaceholder: SitePlaceholder = {
  find(root) {
    const p = root.querySelector(PLACEHOLDER_SEL);
    return displayed(p) ? p : null;
  },
  // Undo fades the placeholder out (about 0.4 s), then hides it and shows the Tile's info row again.
  restored: (root) => !displayed(root.querySelector(PLACEHOLDER_SEL)) && displayed(root.querySelector('.bili-video-card__info')),
  // The placeholder and the info row are shown and hidden (style), never added or removed.
  observe: { attributes: true, subtree: true, attributeFilter: ['style', 'class'] },
  undoButton: (p) => p.querySelector<HTMLElement>('.revert-btn'),
  card: (p) => p,
  sentence: (p) => p.querySelector('.bili-video-card__no-interest--left'),
  actions: (p) => [...p.querySelectorAll('.revert-btn')],
  // The title repeats the item that was clicked [inf]: "内容不感兴趣" was seen after Not interested.
  isChannel: (p) => (p.querySelector('.no-interest-title')?.textContent ?? '').includes('UP主'),
  // A blurred copy of the cover with a dark veil: the annotation brings its own surface.
  overPicture: true,
};
