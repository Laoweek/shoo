// Bilibili as a Site (docs/spec/bilibili-integration.md). Imported only by the Bilibili content script and tests.
import type { Site } from '../site';
import { isPlayingOrQueued } from './extract';
import { bilibiliMenu, bilibiliPlaceholder } from './menu';
import { SELECTOR_VERSION, SURFACES } from './surfaces';
import { isDark, observeTheme } from './theme';

export const bilibili: Site = {
  id: 'bilibili',
  selectorVersion: SELECTOR_VERSION,
  surfaces: SURFACES,
  // Home is a page of its own: no hidden copies of other pages to scope away from.
  visiblePage: (doc) => doc.body,
  // Leaving Home loads a new page (video links open new tabs), so there is no in-app navigation to follow.
  navigatedEvents: [],
  leavingEvents: [],
  isPlayingOrQueued,
  menu: bilibiliMenu,
  placeholder: bilibiliPlaceholder,
  isDark,
  observeTheme,
};
