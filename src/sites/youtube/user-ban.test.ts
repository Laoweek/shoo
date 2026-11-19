// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SurfaceId } from '~/core/types';
import { findMenuItem } from './menu';
import { SURFACES } from './surfaces';
import { FIXTURES, mountTile, simulateYouTube, userClick, type YouTubeSim } from './test-harness';
import { watchUserBans } from './user-ban';

let sim: YouTubeSim;
let off: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  sim = simulateYouTube();
});
afterEach(() => {
  off?.();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

const CASES = [
  { surface: 'home', tile: FIXTURES.homeTile, menu: FIXTURES.homeMenu, placeholder: FIXTURES.homeChannelPlaceholder },
  { surface: 'watchSidebar', tile: FIXTURES.watchTile, menu: FIXTURES.watchMenu, placeholder: FIXTURES.watchPlaceholder },
] as const;

function setup(c: (typeof CASES)[number]) {
  const tile = mountTile(c.tile, c.surface);
  sim.wire(tile, c.surface, { menuHtml: c.menu, placeholderHtml: c.placeholder });
  const onBan = vi.fn();
  off = watchUserBans({ doc: document, surfaceOf: (el) => (el === tile ? (c.surface as SurfaceId) : undefined), onBan });
  const menuButton = () => SURFACES[c.surface].menuButton(tile)!;
  const item = (action: 'notInterested' | 'dontRecommendChannel') =>
    findMenuItem(sim.dropdown()!, action)!.querySelector<HTMLElement>('[role="menuitem"]')!;
  return { tile, onBan, menuButton, item };
}

describe("the user's own Don't recommend channel", () => {
  it.each(CASES)('$surface: reports the Tile and its channel once YouTube shows the placeholder', async (c) => {
    const { tile, onBan, menuButton, item } = setup(c);
    userClick(menuButton());
    await vi.advanceTimersByTimeAsync(100);
    userClick(item('dontRecommendChannel'));
    expect(onBan).not.toHaveBeenCalled(); // not before the placeholder
    await vi.advanceTimersByTimeAsync(100);
    expect(onBan).toHaveBeenCalledOnce();
    expect(onBan).toHaveBeenCalledWith(tile, expect.objectContaining({ videoId: 'FIXTUREvid1', surface: c.surface, channelName: 'Fixture Channel 1' }));
  });

  it('ignores an untrusted click on the menu item, like the ones Shoo makes', async () => {
    const { onBan, menuButton, item } = setup(CASES[0]);
    userClick(menuButton());
    await vi.advanceTimersByTimeAsync(100);
    item('dontRecommendChannel').click();
    await vi.advanceTimersByTimeAsync(100);
    expect(sim.log).toContain("click:Don't recommend channel@FIXTUREvid1");
    expect(onBan).not.toHaveBeenCalled();
  });

  it("forgets the user's Tile once Shoo opens a menu, so Shoo's menu is never taken for the user's", async () => {
    const { onBan, menuButton, item } = setup(CASES[0]);
    userClick(menuButton());
    await vi.advanceTimersByTimeAsync(100);
    menuButton().click();
    await vi.advanceTimersByTimeAsync(100);
    userClick(item('dontRecommendChannel'));
    await vi.advanceTimersByTimeAsync(100);
    expect(onBan).not.toHaveBeenCalled();
  });

  it('ignores Not interested', async () => {
    const { onBan, menuButton, item } = setup(CASES[0]);
    userClick(menuButton());
    await vi.advanceTimersByTimeAsync(100);
    userClick(item('notInterested'));
    await vi.advanceTimersByTimeAsync(100);
    expect(onBan).not.toHaveBeenCalled();
  });
});
