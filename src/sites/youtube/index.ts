// YouTube as a Site (docs/spec/youtube-integration.md). Imported only by the YouTube content script and tests.
import type { Site } from '../site';
import { isPlayingOrQueued } from './extract';
import { youtubeMenu, youtubePlaceholder } from './menu';
import { youtubeShelves } from './shelves';
import { SELECTOR_VERSION, SURFACES, visiblePage } from './surfaces';
import { isDark, observeTheme } from './theme';
import { watchUserBans } from './user-ban';

/**
 * Distance from the bottom of the viewport to the top of a visible miniplayer, 0 when none shows. `ytd-miniplayer`
 * always exists: hidden, it has only `class` and `style` and computes to `display: none` (Section 6, 2026-10-10).
 */
export function miniplayerLift(doc: Document): number {
  const mp = doc.querySelector('ytd-miniplayer');
  const win = doc.defaultView;
  if (!mp || !win || win.getComputedStyle(mp).display === 'none') return 0;
  const r = mp.getBoundingClientRect();
  return r.height > 0 ? Math.max(0, Math.round(win.innerHeight - r.top)) : 0;
}

export const youtube: Site = {
  id: 'youtube',
  selectorVersion: SELECTOR_VERSION,
  surfaces: SURFACES,
  visiblePage,
  // Data is not ready at yt-navigate-finish, and the order of the two events varies (Section 2).
  navigatedEvents: ['yt-navigate-finish', 'yt-page-data-updated'],
  // YouTube restores or clears the placeholders of the page being left about 1 s after the click (live test 2026-10-10).
  leavingEvents: ['yt-navigate-start', 'yt-navigate-finish'],
  pageSwitcher: (doc) => doc.querySelector('ytd-page-manager'),
  isPlayingOrQueued,
  menu: youtubeMenu,
  placeholder: youtubePlaceholder,
  isDark,
  observeTheme,
  dockLift: miniplayerLift,
  watchUserBans,
  shelves: youtubeShelves,
};
