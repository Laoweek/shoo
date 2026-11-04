// YouTube's Tile menu and removed-Tile placeholder. Source of truth: docs/spec/youtube-integration.md Sections 4 and 5.
// Never reads, logs or stores YouTube page data such as feedbackToken or undoToken: Shoo only clicks DOM elements.
import type { NativeAction } from '~/core/types';
import type { MenuSignature, SiteMenu, SitePlaceholder } from '../site';

// Built-in localized label fallback. Extend only with observed labels.
export const NOT_INTERESTED_LABELS = ['Not interested', 'No me interesa', 'Pas intéressé', "Ça ne m'intéresse pas", 'Kein Interesse', 'Non mi interessa', 'Não tenho interesse', '興味なし', '관심 없음', '不感兴趣', '不感興趣', 'Не интересует', 'Geen interesse', 'Brak zainteresowania', 'لست مهتمًا'];
// Only the en-GB label is verified. Add others only after observing them.
export const DONT_RECOMMEND_CHANNEL_LABELS = ["Don't recommend channel"];

// Distinguishing substrings of the menu icon paths. The first 40 characters are shared with Watch Later.
export const ICON_SIGNATURES: Readonly<Record<NativeAction, string>> = {
  notInterested: '8.246 12.605L4.755 6.661',
  dontRecommendChannel: 'Zm4 8H8a1 1 0 000 2h8',
};

export const DROPDOWN_SEL = 'ytd-popup-container tp-yt-iron-dropdown';
export const ITEM_SEL = 'yt-list-item-view-model, ytd-menu-service-item-renderer';
const ITEM_TEXT_SEL = '.ytListItemViewModelTitle, yt-formatted-string';
export const PLACEHOLDER_SEL = '.ytDismissibleItemReplacedContent';

/**
 * A YouTube dropdown is open only on positive evidence: aria-hidden is not "true", it is displayed, and it holds menu
 * items. A closed one keeps display:block and its height, so aria-hidden decides. In a hidden tab YouTube toggles
 * aria-hidden off but leaves the dropdown display:none (with the previous items) until a frame renders (live test 2026-10-10).
 */
export const isDropdownOpen = (d: Element): boolean =>
  d.getAttribute('aria-hidden') !== 'true' &&
  (d.ownerDocument.defaultView?.getComputedStyle(d).display ?? (d as HTMLElement).style?.display) !== 'none' &&
  d.querySelector(ITEM_SEL) !== null;

/** How menu labels are compared: curly apostrophes straightened, trimmed, lowercased. */
export const norm = (s: string) => s.replace(/[‘’]/g, "'").trim().toLowerCase();
const LABELS: Record<NativeAction, string[]> = {
  notInterested: NOT_INTERESTED_LABELS.map(norm),
  dontRecommendChannel: DONT_RECOMMEND_CHANNEL_LABELS.map(norm),
};

/** Whether a menu item is `action`'s: by icon path, or with `byText` by the built-in localized labels. */
export function isMenuItem(item: Element, action: NativeAction, byText = false): boolean {
  if (byText) {
    const text = item.querySelector(ITEM_TEXT_SEL)?.textContent;
    return !!text && LABELS[action].includes(norm(text));
  }
  for (const p of item.querySelectorAll('path[d]')) if (p.getAttribute('d')?.includes(ICON_SIGNATURES[action])) return true;
  return false;
}

/**
 * The menu item for `action` in an open dropdown: by icon path, or with `byText` by the built-in localized labels.
 * Never by position. Works for sheet menus (yt-list-item-view-model) and legacy menus (ytd-menu-service-item-renderer).
 */
export function findMenuItem(dropdown: Element, action: NativeAction, byText = false): Element | null {
  for (const item of dropdown.querySelectorAll(ITEM_SEL)) if (!item.closest('[hidden]') && isMenuItem(item, action, byText)) return item;
  return null;
}

/** The first visible menu item whose text is one of `labels`, compared lowercased and trimmed. */
export function findItemByText(dropdown: Element, labels: readonly string[]): Element | null {
  const wanted = labels.map(norm);
  for (const item of dropdown.querySelectorAll(ITEM_SEL)) {
    if (item.closest('[hidden]')) continue;
    const text = item.querySelector(ITEM_TEXT_SEL)?.textContent;
    if (text && wanted.includes(norm(text))) return item;
  }
  return null;
}

export const youtubeMenu: SiteMenu = {
  menus: (doc) => [...doc.querySelectorAll(DROPDOWN_SEL)],
  isOpen: isDropdownOpen,
  // One reused tp-yt-iron-dropdown serves every Tile. YouTube keeps the item elements and re-renders them in place
  // (observed 2026-10-10), and the menu of a Tile outside the viewport is clamped to the viewport edge, so two
  // consecutive menus can share both items and position.
  shared: true,
  signature(d): MenuSignature {
    const s = (d as HTMLElement).style;
    return { first: d.querySelector(ITEM_SEL), pos: `${s?.top}|${s?.left}` };
  },
  // Synthetic clicks (isTrusted=false) are accepted by YouTube (live test).
  open: (button) => button.click(),
  // Escape as a keydown on the focused element inside the dropdown.
  close(d) {
    const a = d.ownerDocument.activeElement;
    const target = a && d.contains(a) ? a : d;
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true, composed: true }));
  },
  findItem: findMenuItem,
  // A button in sheet menus, tp-yt-paper-item in legacy menus.
  clickTarget: (item) => item.querySelector<HTMLElement>('[role="menuitem"]') ?? (item.matches('[role="menuitem"]') ? (item as HTMLElement) : null),
};

export const youtubePlaceholder: SitePlaceholder = {
  find: (root) => root.querySelector(PLACEHOLDER_SEL),
  // Undo restores the same actionRoot element with fresh children.
  restored: (root) => !root.querySelector(PLACEHOLDER_SEL) && root.firstElementChild !== null,
  // YouTube swaps the actionRoot's children for the placeholder and back.
  observe: { childList: true },
  // The first button is Undo in every placeholder variant (language-independent).
  undoButton: (p) => p.querySelector<HTMLElement>('.ytNotificationMultiActionRendererButtonContainer button'),
  card: (p) => p.querySelector('notification-multi-action-renderer'),
  // The visible "Video removed" text: its container grows to fill the column, so the text inside it.
  sentence: (p) =>
    p.querySelector('.ytNotificationMultiActionRendererTextContainer > *') ??
    p.querySelector('.ytNotificationMultiActionRendererTextContainer') ??
    p.querySelector('notification-multi-action-renderer'),
  actions: (p) => [...p.querySelectorAll('button, a')],
  // "Don't recommend channel": the second action is a "Learn more" link, not a button (Section 5).
  isChannel: (p) => !!p.querySelector('.ytNotificationMultiActionRendererButtonContainer a'),
  overPicture: false,
};
