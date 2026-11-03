// The user's own Don't recommend channel (REQ-ACT-5). Source of truth: docs/spec/youtube-integration.md Section 5.
// Shoo's own clicks are synthetic (`isTrusted` false, actions.ts), so only the user's trusted clicks count here.
//
//   const off = watchUserBans({ doc, surfaceOf, onBan })
//
// A trusted click on a Tile's menu button remembers that Tile and its facts. Any other trusted click outside a
// dropdown, and any Tile menu button click by Shoo, forgets it. A trusted click on the Don't recommend channel item
// of a dropdown then waits up to 2 s for YouTube's placeholder in that Tile's actionRoot, which proves the menu was
// that Tile's, and calls onBan. Only Surfaces whose menus offer Don't recommend channel count.
import type { TileFacts } from '~/core/types';
import { DROPDOWN_SEL, ITEM_SEL, PLACEHOLDER_SEL, TIMING, isMenuItem } from './actions';
import { extract, tileVideoId } from './extract';
import { SURFACES } from './surfaces';
import type { Watcher } from './watcher';

export interface UserBanOptions {
  doc: Document;
  /** The watcher's Surface lookup: only Tiles on watched Surfaces of the visible page are known. */
  surfaceOf: Watcher['surfaceOf'];
  /** YouTube replaced the Tile with its Don't recommend channel placeholder after the user's click. */
  onBan(tileEl: Element, facts: TileFacts): void;
}

export function watchUserBans(opts: UserBanOptions): () => void {
  const { doc } = opts;
  let menuOf: { tile: Element; facts: TileFacts } | null = null;
  let confirming: (() => void) | null = null;

  function tileWithButton(target: Element): { tile: Element; facts: TileFacts | null } | null {
    for (let el: Element | null = target; el; el = el.parentElement) {
      const surface = opts.surfaceOf(el);
      if (!surface) continue;
      const def = SURFACES[surface];
      if (!def.menuButton(el)?.contains(target)) return null;
      return { tile: el, facts: def.actions.includes('dontRecommendChannel') ? extract(el, surface, doc) : null };
    }
    return null;
  }

  function confirm(tile: Element, facts: TileFacts): void {
    confirming?.();
    const root = SURFACES[facts.surface].actionRoot(tile);
    if (!root || tileVideoId(tile, facts.surface) !== facts.videoId) return;
    const done = () => {
      mo.disconnect();
      clearTimeout(timer);
      confirming = null;
    };
    const mo = new MutationObserver(() => {
      if (!root.querySelector(PLACEHOLDER_SEL)) return;
      done();
      opts.onBan(tile, facts);
    });
    const timer = setTimeout(done, TIMING.confirmMs);
    mo.observe(root, { childList: true });
    confirming = done;
  }

  const onClick = (ev: MouseEvent) => {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    const item = target.closest(DROPDOWN_SEL) && target.closest(ITEM_SEL);
    if (item) {
      if (!ev.isTrusted) return;
      const m = menuOf;
      menuOf = null;
      // By icon path, or by label while the icon has not rendered.
      if (m && (isMenuItem(item, 'dontRecommendChannel') || isMenuItem(item, 'dontRecommendChannel', true))) confirm(m.tile, m.facts);
      return;
    }
    const hit = tileWithButton(target);
    if (hit) menuOf = ev.isTrusted && hit.facts ? { tile: hit.tile, facts: hit.facts } : null;
    else if (ev.isTrusted && !target.closest(DROPDOWN_SEL)) menuOf = null;
  };

  doc.addEventListener('click', onClick, true);
  return () => {
    doc.removeEventListener('click', onClick, true);
    confirming?.();
    menuOf = null;
  };
}
