// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findMenuItem } from './actions';
import { channelBadgePending, extract, parseDuration, parseViews, tileVideoId } from './extract';
import { SELECTOR_VERSION, SURFACES, activeSurfaces, visiblePage } from './surfaces';
import { FIXTURES, loadPage, mountTile, parse } from './test-harness';

const base = { isShort: false, isLive: false, isUpcoming: false, isMembersOnly: false };

afterEach(() => {
  document.body.innerHTML = '';
  history.replaceState(null, '', '/');
});

describe('extract() on the captured fixtures', () => {
  it('reads a Home Tile with a handle link and its view count label', () => {
    const tile = mountTile(FIXTURES.homeTile, 'home');
    expect(extract(tile, 'home', document)).toEqual({
      ...base,
      videoId: 'FIXTUREvid1',
      surface: 'home',
      title: 'Fixture title 1',
      channelName: 'Fixture Channel 1',
      channelHandle: '@fixturechannel1',
      durationSec: 13 * 60 + 54,
      viewCount: 116_000,
    });
  });

  it('reads a live Home Tile without a duration or view count, with a /channel/UC link and the Artist channel badge', () => {
    const tile = mountTile(FIXTURES.homeLiveTile, 'home');
    expect(extract(tile, 'home', document)).toEqual({
      ...base,
      isLive: true,
      videoId: 'FIXTUREvid1',
      surface: 'home',
      title: 'Fixture title 1',
      channelName: 'Fixture Channel 1',
      channelId: 'UCFIXTURE000000000000001',
      isArtistChannel: true,
    });
  });

  it('reads the Artist channel badge by its icon in any language, or by its label before the icon renders', () => {
    const badge = () => document.querySelector('.ytContentMetadataViewModelIcon[aria-label="Official Artist Channel"]')!;
    let tile = mountTile(FIXTURES.homeLiveTile, 'home');
    badge().setAttribute('aria-label', 'Chaîne officielle d’artiste');
    expect(extract(tile, 'home', document)?.isArtistChannel).toBe(true);

    document.body.innerHTML = '';
    tile = mountTile(FIXTURES.homeLiveTile, 'home');
    badge().querySelector('svg')!.remove();
    expect(extract(tile, 'home', document)?.isArtistChannel).toBe(true);

    document.body.innerHTML = '';
    tile = mountTile(FIXTURES.homeLiveTile, 'home');
    badge().remove();
    expect(extract(tile, 'home', document)).not.toHaveProperty('isArtistChannel');
  });

  it('reports a channel badge as pending only while its icon has not rendered and its label is unknown', () => {
    const icon = (tile: Element) => tile.querySelector('.ytContentMetadataViewModelIcon')!;
    const artist = mountTile(FIXTURES.homeLiveTile, 'home');
    expect(channelBadgePending(artist, 'home')).toBe(false); // rendered
    icon(artist).setAttribute('aria-label', 'Chaîne officielle d’artiste');
    expect(channelBadgePending(artist, 'home')).toBe(false); // rendered, any language
    icon(artist).querySelector('svg')!.remove();
    expect(channelBadgePending(artist, 'home')).toBe(true); // unrendered, unknown label
    icon(artist).removeAttribute('aria-label');
    expect(channelBadgePending(artist, 'home')).toBe(true); // unrendered, no label
    icon(artist).setAttribute('aria-label', 'Official Artist Channel');
    expect(channelBadgePending(artist, 'home')).toBe(false); // the known Artist channel label
    const row = artist.querySelector('.ytContentMetadataViewModelMetadataRow')!;
    const unknown = icon(artist).cloneNode(true) as Element;
    unknown.setAttribute('aria-label', 'Validé');
    const secondRow = row.cloneNode(false) as Element;
    secondRow.append(unknown);
    row.after(secondRow);
    expect(channelBadgePending(artist, 'home')).toBe(false); // only the channel row counts
    row.append(unknown);
    expect(channelBadgePending(artist, 'home')).toBe(true); // any unknown icon in it

    document.body.innerHTML = '';
    const verified = mountTile(FIXTURES.watchTile, 'watchSidebar');
    icon(verified).querySelector('svg')!.remove();
    expect(channelBadgePending(verified, 'watchSidebar')).toBe(false); // the known Verified label
    icon(verified).setAttribute('aria-label', 'Validé');
    expect(channelBadgePending(verified, 'watchSidebar')).toBe(true);

    document.body.innerHTML = '';
    expect(channelBadgePending(mountTile(FIXTURES.homeTile, 'home'), 'home')).toBe(false); // no badge
    expect(channelBadgePending(mountTile(FIXTURES.shortsTile, 'shortsShelf'), 'shortsShelf')).toBe(false); // no channel row
  });

  it('reads a Watch sidebar Tile (plain-text channel name, no handle or ID, a Verified badge is no Artist channel)', () => {
    const tile = mountTile(FIXTURES.watchTile, 'watchSidebar');
    expect(extract(tile, 'watchSidebar', document)).toEqual({
      ...base,
      videoId: 'FIXTUREvid1',
      surface: 'watchSidebar',
      title: 'Fixture title 1',
      channelName: 'Fixture Channel 1',
      durationSec: 17 * 60 + 42,
      viewCount: 3_500_000,
    });
  });

  it('reads a Shorts shelf Tile: no channel, no duration, isShort, views from the subhead text', () => {
    const tile = mountTile(FIXTURES.shortsTile, 'shortsShelf');
    expect(extract(tile, 'shortsShelf', document)).toEqual({ ...base, isShort: true, videoId: 'FIXTUREvid1', surface: 'shortsShelf', title: 'Fixture title 1', viewCount: 1_100_000 });
  });

  it('leaves the view count unset when YouTube shows it in another language', () => {
    const home = mountTile(FIXTURES.homeTile.replace('aria-label="116 thousand views"', 'aria-label="116 k vues"'), 'home');
    expect(extract(home, 'home', document)).not.toHaveProperty('viewCount');
    document.body.innerHTML = '';
    const shorts = mountTile(FIXTURES.shortsTile.replace('1.1m views', '1,1 Mio. Aufrufe'), 'shortsShelf');
    expect(extract(shorts, 'shortsShelf', document)).not.toHaveProperty('viewCount');
  });

  it.each<[string, number | undefined]>([
    ['116 thousand views', 116_000],
    ['3.5 million views', 3_500_000],
    ['1.2 billion views', 1_200_000_000],
    ['1,234 views', 1234],
    ['1 view', 1],
    ['No views', 0],
    ['1.1m views', 1_100_000],
    ['1.2K views', 1200],
    ['18 thousand watching', undefined],
    ['116k', undefined],
    ['116 k vues', undefined],
    ['', undefined],
  ])('parseViews(%j) is %s', (text, expected) => {
    expect(parseViews(text)).toBe(expected);
  });

  it('skips ads, radio Mix starts and playlist links', () => {
    expect(extract(mountTile(FIXTURES.homeAdTile, 'home'), 'home', document)).toBeNull();
    expect(extract(mountTile(FIXTURES.homeMixTile, 'home'), 'home', document)).toBeNull();
    const playlist = mountTile(FIXTURES.homeTile.replace('href="/watch?v=FIXTUREvid1"', 'href="/watch?v=FIXTUREvid1&amp;list=PLFIXTURE"'), 'home');
    expect(extract(playlist, 'home', document)).toBeNull();
  });

  it('skips a lockup whose content-id is not an 11-character video ID', () => {
    const tile = mountTile(FIXTURES.homeTile.replace('content-id-FIXTUREvid1', 'content-id-PLFIXTUREplaylist01'), 'home');
    expect(extract(tile, 'home', document)).toBeNull();
  });

  it('skips duration-less Tiles without a live badge, silently', () => {
    const tile = mountTile(FIXTURES.homeTile, 'home');
    tile.querySelector('yt-thumbnail-badge-view-model')?.remove();
    const warn = vi.fn();
    expect(extract(tile, 'home', document, warn)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('skips the currently playing video (ytd-watch-flexy[video-id] or the v parameter)', () => {
    const tile = mountTile(FIXTURES.watchTile, 'watchSidebar');
    expect(extract(tile, 'watchSidebar', document)).not.toBeNull();
    document.querySelector('ytd-watch-flexy')?.setAttribute('video-id', 'FIXTUREvid1');
    expect(extract(tile, 'watchSidebar', document)).toBeNull();
    document.querySelector('ytd-watch-flexy')?.removeAttribute('video-id');
    history.replaceState(null, '', '/watch?v=FIXTUREvid1');
    expect(extract(tile, 'watchSidebar', document)).toBeNull();
  });

  it('skips everything inside the playlist panel', () => {
    const panel = document.createElement('ytd-playlist-panel-renderer');
    panel.id = 'playlist';
    document.body.append(panel);
    const tile = parse(FIXTURES.watchTile);
    panel.append(tile);
    expect(extract(tile, 'watchSidebar', document)).toBeNull();
  });

  it('skips a Tile with a missing title or video ID and reports a markup warning', () => {
    const warn = vi.fn();
    const noTitle = mountTile(FIXTURES.homeTile, 'home');
    noTitle.querySelector('h3')?.remove();
    expect(extract(noTitle, 'home', document, warn)).toBeNull();
    expect(warn).toHaveBeenLastCalledWith('title', 'home');

    const noId = mountTile(FIXTURES.shortsTile.replaceAll('/shorts/FIXTUREvid1', '/shorts/'), 'shortsShelf');
    expect(extract(noId, 'shortsShelf', document, warn)).toBeNull();
    expect(warn).toHaveBeenLastCalledWith('videoId', 'shortsShelf');
  });

  it('skips a lockup without a content-id class (podcasts and movies may still link to /watch) and warns', () => {
    const tile = mountTile(FIXTURES.homeTile.replace('content-id-FIXTUREvid1', ''), 'home');
    const warn = vi.fn();
    expect(tileVideoId(tile, 'home')).toBeNull();
    expect(extract(tile, 'home', document, warn)).toBeNull();
    expect(warn).toHaveBeenCalledWith('videoId', 'home');
  });

  it('parses durations language-independently', () => {
    expect(parseDuration('13:54')).toBe(834);
    expect(parseDuration('1:02:03')).toBe(3723);
    expect(parseDuration(' 0:07 ')).toBe(7);
    expect(parseDuration('LIVE')).toBeUndefined();
    expect(parseDuration('')).toBeUndefined();
    expect(parseDuration(null)).toBeUndefined();
  });
});

describe('Surface registry', () => {
  it('is frozen and keeps unsupported Surfaces with a reason and no actions', () => {
    expect(Object.isFrozen(SURFACES)).toBe(true);
    expect(Object.isFrozen(SURFACES.home)).toBe(true);
    for (const id of ['search', 'channel', 'endScreen'] as const) {
      expect(SURFACES[id]).toMatchObject({ supported: false, reason: 'settings.surfaces.unsupported', actions: [] });
    }
    expect(SURFACES.home.actions).toEqual(['notInterested', 'dontRecommendChannel']);
    expect(SURFACES.watchSidebar.actions).toEqual(['notInterested', 'dontRecommendChannel']);
    expect(SURFACES.shortsShelf.actions).toEqual(['notInterested']); // REQ-SURF-1b
    for (const def of Object.values(SURFACES)) expect(def.selectorVersion).toBe(SELECTOR_VERSION);
  });

  it.each([
    ['home', FIXTURES.homeTile, 'yt-lockup-view-model', 'yt-thumbnail-view-model', 'ytLockupViewModelHost', 'More actions', 'ytLockupMetadataViewModelTitle'],
    ['watchSidebar', FIXTURES.watchTile, 'yt-lockup-view-model', 'yt-thumbnail-view-model', 'ytLockupViewModelHost', 'More actions', 'ytLockupMetadataViewModelTitle'],
    ['shortsShelf', FIXTURES.shortsTile, 'ytm-shorts-lockup-view-model-v2', 'div', 'shortsLockupViewModelHost', 'More actions', 'shortsLockupViewModelHostOutsideMetadataEndpoint'],
  ] as const)('resolves the element roles on %s', (surface, html, rootTag, thumbTag, parentClass, menuLabel, focusClass) => {
    const tile = mountTile(html, surface);
    const def = SURFACES[surface];
    const root = def.actionRoot(tile);
    expect(root?.localName).toBe(rootTag);
    if (surface === 'watchSidebar') expect(root).toBe(tile);
    if (surface === 'home') expect(root).toBe(tile.querySelector('yt-lockup-view-model'));
    if (surface === 'shortsShelf') expect(def.mountParent(tile)?.parentElement).toBe(root); // mountParent sits inside actionRoot
    expect(def.thumbnail(tile)?.localName).toBe(thumbTag);
    expect(def.thumbnail(tile)?.closest('a')).not.toBeNull(); // geometry source sits inside the thumbnail link
    expect(def.mountParent(tile)?.classList.contains(parentClass)).toBe(true);
    expect(def.mountParent(tile)?.closest('a')).toBeNull(); // never mount inside the aria-hidden link
    expect(def.menuButton(tile)?.getAttribute('aria-label')).toBe(menuLabel);
    expect(def.focusReturn(tile)?.classList.contains(focusClass)).toBe(true);
  });

  it('finds Tiles in containers and leaves ads out of the Home Tile list', () => {
    const grid = document.createElement('div');
    grid.id = 'contents';
    grid.append(parse(FIXTURES.homeTile), parse(FIXTURES.homeAdTile), parse(FIXTURES.homeLiveTile));
    expect(SURFACES.home.tiles(grid)).toHaveLength(2);
    const sidebar = document.createElement('div');
    sidebar.append(parse(FIXTURES.watchTile));
    expect(SURFACES.watchSidebar.tiles(sidebar)).toHaveLength(1);
    const shelf = document.createElement('div');
    shelf.append(parse(FIXTURES.shortsTile));
    expect(SURFACES.shortsShelf.tiles(shelf)).toHaveLength(1);
  });

  it('finds Tiles on unsupported Surfaces but observes no container there', () => {
    const section = document.createElement('div');
    section.append(parse(FIXTURES.searchTile));
    expect(SURFACES.search.tiles(section)).toHaveLength(1);
    const shelf = document.createElement('div');
    shelf.innerHTML = '<yt-horizontal-list-renderer><div id="items"></div></yt-horizontal-list-renderer>';
    shelf.querySelector('#items')?.append(parse(FIXTURES.channelTile));
    expect(SURFACES.channel.tiles(shelf)).toHaveLength(1);
    expect(SURFACES.search.containers(document.body)).toEqual([]);
    expect(SURFACES.channel.containers(document.body)).toEqual([]);
  });

  it('scopes the visible page and the active Surfaces to the page that is not hidden', () => {
    const all = { home: true, watchSidebar: true, shortsShelf: true, search: true, channel: true, endScreen: true };
    loadPage(FIXTURES.pageHome, '/');
    expect(visiblePage(document)?.getAttribute('page-subtype')).toBe('home');
    expect(activeSurfaces(location, document, all).map((d) => d.id)).toEqual(['home', 'shortsShelf']);
    expect(activeSurfaces(location, document, { ...all, shortsShelf: false }).map((d) => d.id)).toEqual(['home']);
    loadPage(FIXTURES.pageWatch, '/watch?v=FIXTURE0201');
    expect(visiblePage(document)?.localName).toBe('ytd-watch-flexy');
    expect(activeSurfaces(location, document, all).map((d) => d.id)).toEqual(['watchSidebar']);
    history.replaceState(null, '', '/results?search_query=x');
    expect(activeSurfaces(location, document, all)).toEqual([]);
  });

  it('extracts nothing from hidden pages because containers resolve only inside the visible page', () => {
    loadPage(FIXTURES.pageHome, '/');
    const page = visiblePage(document) as Element;
    const ids = SURFACES.home.containers(page).flatMap((c) => SURFACES.home.tiles(c)).map((t) => tileVideoId(t, 'home'));
    expect(ids).not.toContain('DECOY000001');
    expect(ids).toContain('FIXTURE0001');
  });
});

describe('menu item matcher', () => {
  const dropdown = (html: string) => parse(html);
  const label = (el: Element | null) => el?.querySelector('.ytListItemViewModelTitle, yt-formatted-string')?.textContent?.trim() ?? null;

  it.each([
    ['home', FIXTURES.homeMenu],
    ['watch', FIXTURES.watchMenu],
  ])('picks both actions by icon path in the %s menu', (_name, html) => {
    const d = dropdown(html);
    expect(label(findMenuItem(d, 'notInterested'))).toBe('Not interested');
    expect(label(findMenuItem(d, 'dontRecommendChannel'))).toBe("Don't recommend channel");
  });

  it('picks Not interested and nothing for Don\'t recommend channel in the Shorts menu', () => {
    const d = dropdown(FIXTURES.shortsMenu);
    expect(label(findMenuItem(d, 'notInterested'))).toBe('Not interested');
    expect(findMenuItem(d, 'dontRecommendChannel')).toBeNull();
    expect(findMenuItem(d, 'dontRecommendChannel', true)).toBeNull();
  });

  it.each([
    ['search', FIXTURES.searchMenu],
    ['channel', FIXTURES.channelMenu],
  ])('finds nothing in the %s menu, by icon or by text', (_name, html) => {
    const d = dropdown(html);
    for (const action of ['notInterested', 'dontRecommendChannel'] as const) {
      expect(findMenuItem(d, action)).toBeNull();
      expect(findMenuItem(d, action, true)).toBeNull();
    }
  });

  it('never matches Watch Later, which shares the first 40 characters of the icon path', () => {
    const d = dropdown(FIXTURES.homeMenu);
    for (const item of d.querySelectorAll('yt-list-item-view-model')) if (label(item) !== 'Save to Watch Later') item.remove();
    expect(d.querySelectorAll('yt-list-item-view-model path[d]')).toHaveLength(1);
    expect(findMenuItem(d, 'notInterested')).toBeNull();
    expect(findMenuItem(d, 'dontRecommendChannel')).toBeNull();
  });

  it('falls back to the localized label list when icons are missing', () => {
    const d = dropdown(FIXTURES.homeMenu);
    d.querySelectorAll('svg').forEach((s) => s.remove());
    expect(findMenuItem(d, 'notInterested')).toBeNull();
    expect(label(findMenuItem(d, 'notInterested', true))).toBe('Not interested');
    expect(label(findMenuItem(d, 'dontRecommendChannel', true))).toBe("Don't recommend channel");
    d.querySelectorAll('.ytListItemViewModelTitle').forEach((s) => {
      if (s.textContent === 'Not interested') s.textContent = 'Kein Interesse';
    });
    expect(label(findMenuItem(d, 'notInterested', true))).toBe('Kein Interesse');
  });
});
