// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActionQueue, TIMING, type ActionJob, type NativeActionQueue, type QueueOptions } from '~/content/actions';
import { mountAnnotationHost, mountChipHost } from '~/content/mount';
import { fakeIntersection, manualScheduler, microtasks, parse } from '~/content/test-dom';
import { createWatcher, type TileItem } from '~/content/watcher';
import { activeSurfaces } from '../site';
import { bilibili } from '.';
import { coverPath, extract } from './extract';
import { bilibiliMenu, bilibiliPlaceholder } from './menu';
import { SURFACES } from './surfaces';
import { FIXTURES, homeTileFor, loadHome, simulateBilibili, type BilibiliSim } from './test-harness';
import { isDark } from './theme';

const HOME = SURFACES.bilibiliHome;
const ALL = { bilibiliHome: true, bilibiliVideoSidebar: true };
const tilesOf = (container: Element) => HOME.tiles(container);

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('style');
  history.replaceState(null, '', '/');
});

describe('Bilibili Home: registry and extraction', () => {
  it('finds the video Tiles of the feed and skips the carousel, floors and loading skeletons', () => {
    const container = loadHome();
    expect(activeSurfaces(bilibili, location, document, ALL).map((d) => d.id)).toEqual(['bilibiliHome']);
    expect(HOME.containers(document.body)).toEqual([container]);
    expect(tilesOf(container).map((t) => t.className)).toEqual(['feed-card', 'feed-card', 'feed-card', 'bili-feed-card']);
  });

  it('reads a Tile: BV id, title, uploader name and id, duration and the cover path', () => {
    const tile = parse(FIXTURES.homeTile);
    expect(extract(tile, 'bilibiliHome', document)).toEqual({
      videoId: 'BV1FIXTURE01',
      surface: 'bilibiliHome',
      title: 'Fixture title 1',
      channelName: 'Fixture Uploader 1',
      channelId: '10000001',
      durationSec: 69,
      cover: '/bfs/archive/0000000000000000000000000000000000000001.jpg',
      isShort: false,
      isLive: false,
      isUpcoming: false,
      isMembersOnly: false,
    });
  });

  it('skips ads, which link to cm.bilibili.com, without a markup warning', () => {
    const warn = vi.fn();
    expect(extract(parse(FIXTURES.homeAdTile), 'bilibiliHome', document, warn)).toBeNull();
    expect(HOME.videoId(parse(FIXTURES.homeAdTile))).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('skips links that are not plain video pages, and warns when the title is missing', () => {
    const warn = vi.fn();
    const live = parse(FIXTURES.homeTile.replaceAll('https://www.bilibili.com/video/BV1FIXTURE01', 'https://live.bilibili.com/123'));
    expect(extract(live, 'bilibiliHome', document, warn)).toBeNull();
    const untitled = parse(FIXTURES.homeTile.replace('title="Fixture title 1"', '').replace('>Fixture title 1</a>', '></a>'));
    expect(extract(untitled, 'bilibiliHome', document, warn)).toBeNull();
    expect(warn).toHaveBeenCalledWith('title', 'bilibiliHome');
  });

  it('never takes a cover path off the archive shape, and never the video playing on its own page', () => {
    expect(coverPath(parse(FIXTURES.homeTile.replaceAll('/bfs/archive/0000000000000000000000000000000000000001.jpg', '/bfs/face/x.jpg')))).toBeUndefined();
    expect(coverPath(parse(FIXTURES.homeTile.replaceAll('//i0.hdslb.com', '//evil.test')))).toBeUndefined();
    history.replaceState(null, '', '/video/BV1FIXTURE01/');
    expect(extract(parse(FIXTURES.homeTile), 'bilibiliHome', document)).toBeNull();
    expect(bilibili.isPlayingOrQueued(parse(FIXTURES.homeTile), 'BV1FIXTURE01', document)).toBe(true);
  });

  it('resolves every role outside the cover link, and the stats row as badges', () => {
    const tile = parse(FIXTURES.homeTile);
    const link = tile.querySelector('a.bili-video-card__image--link')!;
    expect(HOME.actionRoot(tile)?.className).toBe('bili-video-card__wrap');
    expect(HOME.thumbnail(tile)?.className).toBe('bili-video-card__image');
    expect(HOME.mountParent(tile)?.className).toBe('bili-video-card is-rcmd');
    expect(link.contains(HOME.mountParent(tile))).toBe(false);
    expect(HOME.menuButton(tile)?.className).toBe('bili-video-card__info--no-interest');
    expect(HOME.focusReturn(tile)?.getAttribute('href')).toBe('https://www.bilibili.com/video/BV1FIXTURE01');
    expect(HOME.badges(HOME.thumbnail(tile)!)).toHaveLength(3);
  });

  it('keeps the video page sidebar listed but unsupported: it has no menu', () => {
    const side = SURFACES.bilibiliVideoSidebar;
    history.replaceState(null, '', '/video/BV1FIXTURE09/');
    expect(side.supported).toBe(false);
    expect(side.matches(location, document.body)).toBe(true);
    const box = document.createElement('div');
    box.append(parse(FIXTURES.videoSidebarTile));
    expect(side.tiles(box)).toHaveLength(1);
    expect(activeSurfaces(bilibili, location, document, ALL)).toEqual([]);
  });

  it('reads the dark theme from the --bg1 colour Bilibili paints its pages with', () => {
    document.documentElement.style.setProperty('--bg1', '#FFFFFF');
    expect(isDark(document)).toBe(false);
    document.documentElement.style.setProperty('--bg1', '#17181A');
    expect(isDark(document)).toBe(true);
  });

  it('reads an unpainted page as light, never a transparent background as black', () => {
    document.body.style.backgroundColor = 'rgba(0, 0, 0, 0)';
    expect(isDark(document)).toBe(false);
    document.body.style.backgroundColor = 'rgb(24, 25, 28)';
    expect(isDark(document)).toBe(true);
    document.body.removeAttribute('style');
  });
});

describe('Bilibili Home: the watcher', () => {
  it('sends the video Tiles once they are eligible, never the ad', async () => {
    loadHome();
    const io = fakeIntersection();
    const frames = manualScheduler();
    const batches: TileItem[][] = [];
    const w = createWatcher({ doc: document, site: bilibili, enabledSurfaces: ALL, onTiles: (b) => batches.push(b), schedule: frames.schedule, intersection: io.factory });
    w.start();
    io.trigger(true);
    await microtasks();
    frames.flush();
    expect(batches.flat().map((b) => b.facts.videoId)).toEqual(['BV1FIXTURE01', 'BV1FIXTURE02', 'BV1FIXTURE03']);
    w.stop();
  });
});

describe('Bilibili menu and placeholder', () => {
  it('finds both Native actions by their label and treats only no-interest popovers as Tile menus', () => {
    const menu = parse(FIXTURES.homeMenu);
    document.body.append(menu, parse('<div class="vui_popover"><div class="vui_popover-content">header</div></div>'));
    expect(bilibiliMenu.menus(document)).toEqual([menu]);
    expect(bilibiliMenu.findItem(menu, 'notInterested', false)?.textContent).toBe('内容不感兴趣');
    expect(bilibiliMenu.findItem(menu, 'dontRecommendChannel', false)?.textContent).toBe('不想看此UP主');
    (menu as HTMLElement).style.display = 'none';
    expect(bilibiliMenu.isOpen(menu)).toBe(false);
  });

  it('shows its placeholder only while it is displayed, and says when the channel was removed', () => {
    const tile = parse(FIXTURES.homeTile);
    document.body.append(tile);
    const root = HOME.actionRoot(tile)!;
    expect(bilibiliPlaceholder.find(root)).toBeNull();
    expect(bilibiliPlaceholder.restored(root)).toBe(true);
    const ph = root.querySelector('.bili-video-card__no-interest') as HTMLElement;
    ph.style.display = '';
    (root.querySelector('.bili-video-card__info') as HTMLElement).style.display = 'none';
    expect(bilibiliPlaceholder.find(root)).toBe(ph);
    expect(bilibiliPlaceholder.restored(root)).toBe(false);
    expect(bilibiliPlaceholder.undoButton(ph)?.textContent).toBe('撤销');
    expect(bilibiliPlaceholder.isChannel(ph)).toBe(false);
    ph.querySelector('.no-interest-title')!.textContent = '不想看此UP主';
    expect(bilibiliPlaceholder.isChannel(ph)).toBe(true);
  });

  it("drops a chip once Bilibili's placeholder covers the Tile (the user's own 不感兴趣), and mounts none over it", async () => {
    const tile = parse(FIXTURES.homeTile);
    document.body.append(tile);
    const onLost = vi.fn();
    const chip = mountChipHost(bilibili, tile, 'bilibiliHome', { onLost })!;
    expect(chip.live()).toBe(true);
    (tile.querySelector('.bili-video-card__no-interest') as HTMLElement).style.display = '';
    await microtasks();
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(chip.live()).toBe(false);
    chip.destroy();
    expect(mountChipHost(bilibili, tile, 'bilibiliHome')).toBeNull();
  });

  it('mounts the annotation with a surface of its own, live only while the placeholder shows', () => {
    const tile = parse(FIXTURES.homeTile);
    document.body.append(tile);
    const root = HOME.actionRoot(tile)!;
    expect(mountAnnotationHost(bilibili, root)).toBeNull();
    const ph = root.querySelector('.bili-video-card__no-interest') as HTMLElement;
    ph.style.display = '';
    const handle = mountAnnotationHost(bilibili, root)!;
    expect(handle.host.hasAttribute('data-surface')).toBe(true);
    expect(handle.live()).toBe(true);
    ph.style.display = 'none';
    expect(handle.live()).toBe(false);
    handle.destroy();
  });
});

describe('NativeActionQueue on Bilibili', () => {
  let q: NativeActionQueue;
  let sim: BilibiliSim;

  beforeEach(() => {
    vi.useFakeTimers();
    sim = simulateBilibili();
  });
  afterEach(() => q?.dispose());

  const queue = (over: Partial<QueueOptions> = {}) => (q = createActionQueue({ doc: document, site: bilibili, ...over }));
  function job(n: number, nativeAction: ActionJob['nativeAction'] = 'notInterested'): ActionJob {
    const tileEl = parse(homeTileFor(n));
    document.body.append(tileEl);
    sim.wire(tileEl);
    return { tileEl, videoId: `BV1FIXTURE${String(n).padStart(2, '0')}`, surface: 'bilibiliHome', nativeAction };
  }
  const shown = (j: ActionJob) => bilibiliPlaceholder.find(HOME.actionRoot(j.tileEl)!) !== null;

  it('hovers the menu button, clicks the item and confirms the placeholder, leaving no menu open', async () => {
    queue();
    const j = job(1);
    const done = q.enqueue(j);
    await vi.advanceTimersByTimeAsync(2000);
    expect((await done).status).toBe('ok');
    expect(sim.log).toEqual(['hover@BV1FIXTURE01', 'click:内容不感兴趣@BV1FIXTURE01', 'placeholder@BV1FIXTURE01']);
    expect(shown(j)).toBe(true);
    expect(bilibiliMenu.menus(document).filter((m) => bilibiliMenu.isOpen(m))).toEqual([]);
  });

  it('picks 不想看此UP主 for a Banned channel', async () => {
    queue();
    const done = q.enqueue(job(2, 'dontRecommendChannel'));
    await vi.advanceTimersByTimeAsync(2000);
    expect((await done).status).toBe('ok');
    expect(sim.log).toContain('click:不想看此UP主@BV1FIXTURE02');
  });

  it("tells Bilibili's own Undo from Shoo's", async () => {
    const onSiteUndo = vi.fn();
    queue({ onSiteUndo });
    const a = job(1);
    const b = job(2);
    const done = [q.enqueue(a), q.enqueue(b)];
    await vi.advanceTimersByTimeAsync(4000);
    expect((await Promise.all(done)).map((o) => o.status)).toEqual(['ok', 'ok']);
    (a.tileEl.querySelector('.revert-btn') as HTMLElement).click();
    await vi.advanceTimersByTimeAsync(100);
    expect(onSiteUndo).toHaveBeenCalledWith('BV1FIXTURE01', a);
    const undo = q.undo('BV1FIXTURE02');
    await vi.advanceTimersByTimeAsync(100);
    expect(await undo).toBe('ok');
    expect(onSiteUndo).toHaveBeenCalledTimes(1);
    expect(shown(b)).toBe(false);
  });

  it('waits while the user has a Tile menu open, and acts once it closes', async () => {
    queue();
    const other = job(3);
    const user = sim.hoverAsUser(other.tileEl) as HTMLElement;
    const done = q.enqueue(job(1));
    await vi.advanceTimersByTimeAsync(1000);
    expect(sim.log).not.toContain('hover@BV1FIXTURE01');
    user.style.display = 'none';
    await vi.advanceTimersByTimeAsync(2000);
    expect((await done).status).toBe('ok');
  });

  it("clicks nothing when the user's pointer enters another Tile's menu button while Shoo opens its own", async () => {
    queue();
    const other = job(2);
    (sim.hoverAsUser(other.tileEl) as HTMLElement).style.display = 'none'; // an earlier hover left its popover, hidden
    const done = q.enqueue(job(1));
    await vi.advanceTimersByTimeAsync(0); // Shoo hovers its own Tile's button
    const otherButton = HOME.menuButton(other.tileEl)!;
    otherButton.dispatchEvent(new Event('pointerover', { bubbles: true }));
    otherButton.dispatchEvent(new MouseEvent('mouseenter'));
    await vi.advanceTimersByTimeAsync(2000);
    expect((await done).status).toBe('stale');
    expect(sim.log.filter((l) => l.startsWith('click:'))).toEqual([]);
  });

  it('fails at openMenu when no popover opens, and leaves the Tile as Bilibili shows it', async () => {
    queue();
    const tileEl = parse(homeTileFor(4));
    document.body.append(tileEl);
    sim.wire(tileEl, { neverOpen: true });
    const done = q.enqueue({ tileEl, videoId: 'BV1FIXTURE04', surface: 'bilibiliHome', nativeAction: 'notInterested' });
    await vi.advanceTimersByTimeAsync(TIMING.dropdownMs + 500);
    expect(await done).toMatchObject({ status: 'failed', step: 'openMenu', selectorVersion: 'bilibili-2026-10-18' });
  });
});
