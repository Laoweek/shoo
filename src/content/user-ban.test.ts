// @vitest-environment jsdom
// The pipeline's side of the user's own Don't recommend channel (REQ-ACT-5): banChannel, then YouTube's Undo.
import '~/ui/test/catalogue';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeOverlay } from '~/ui/in-page';
import { findMenuItem } from '~/sites/youtube/menu';
import { SURFACES } from '~/sites/youtube/surfaces';
import { userClick } from '~/sites/youtube/test-harness';
import { setupHome, tilesOf, type Env } from './testing';

let env: Env | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
});
afterEach(() => {
  env?.p.dispose();
  env = undefined;
  act(() => removeOverlay());
  vi.useRealTimers();
  document.body.innerHTML = '';
  history.replaceState(null, '', '/');
});

async function dontRecommendAsUser(e: Env, videoId: string): Promise<Element> {
  const tile = tilesOf(videoId)[0]!;
  userClick(SURFACES.home.menuButton(tile)!);
  await vi.advanceTimersByTimeAsync(100);
  userClick(findMenuItem(e.sim.dropdown()!, 'dontRecommendChannel')!.querySelector<HTMLElement>('[role="menuitem"]')!);
  await vi.advanceTimersByTimeAsync(100);
  return tile;
}

async function youtubeUndo(tile: Element): Promise<void> {
  tile.querySelector<HTMLElement>('.ytNotificationMultiActionRendererButtonContainer button')!.click();
  await vi.advanceTimersByTimeAsync(100);
}

describe("the user's own Don't recommend channel", () => {
  it("bans the channel, and YouTube's Undo lifts that ban without an Exception", async () => {
    const e = (env = setupHome());
    await e.showAll();
    const tile = await dontRecommendAsUser(e, 'FIXTURE0006');
    expect(e.bg.of('banChannel')).toEqual([{ tile: expect.objectContaining({ videoId: 'FIXTURE0006', channelName: expect.any(String) }) }]);
    await youtubeUndo(tile);
    expect(e.sim.log.at(-1)).toBe('restored@FIXTURE0006');
    expect(e.bg.of('liftChannelBan')).toEqual([{ ruleId: 'u1', videoId: 'FIXTURE0006' }]);
    expect(e.bg.of('reportUndo')).toEqual([]);
  });

  it("YouTube's Undo leaves a ban that existed before alone", async () => {
    const e = (env = setupHome());
    e.bg.banned = true;
    await e.showAll();
    await youtubeUndo(await dontRecommendAsUser(e, 'FIXTURE0006'));
    expect(e.bg.of('banChannel')).toHaveLength(1);
    expect(e.bg.of('liftChannelBan')).toEqual([]);
  });
});
