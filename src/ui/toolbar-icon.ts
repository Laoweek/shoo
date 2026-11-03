import type { EyeState } from '~/core/types';

// Toolbar icon files per EyeState (public/icon/, made by scripts/make-icons.mjs). Ink eyes for light
// toolbars, '-dark' files (paper eyes) for dark toolbars. Pass the result to action.setIcon({ path }).
export const TOOLBAR_ICON_SIZES = [16, 32, 48, 128] as const;

export function toolbarIconPaths(state: EyeState, darkToolbar = false): Record<number, string> {
  const suffix = darkToolbar ? '-dark' : '';
  return Object.fromEntries(TOOLBAR_ICON_SIZES.map((s) => [s, `/icon/${state}-${s}${suffix}.png`]));
}
