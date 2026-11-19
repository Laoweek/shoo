// Builds the composed page fixtures test/fixtures/youtube/page-home.html and page-watch.html from the captured
// single-Tile fixtures (docs/spec/youtube-integration.md Section 8). Run: node scripts/compose-fixtures.mjs
// The page skeleton (ytd-app, ytd-page-manager, grid, shelf, sidebar wrappers) is hand-written from the structure
// observed on youtube.com in October 2026 (containers in docs/spec/youtube-integration.md Section 1). Tile markup is
// copied verbatim; only fake IDs and names are renumbered.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'youtube');
const read = (name) => readFileSync(join(dir, name), 'utf8').replace(/^<!--[\s\S]*?-->\s*/, '').trim();

// Renumber a captured Tile: video ID (11 chars), title and channel. IDs must stay 11 characters.
function tile(name, { id, n, ch = n }) {
  if (id.length !== 11) throw new Error(`video ID must be 11 characters: ${id}`);
  return read(name)
    .replaceAll('FIXTUREvid1', id)
    .replace(/Fixture title 1(?!\d)/g, `Fixture title ${n}`)
    .replace(/Fixture Channel 1(?!\d)/g, `Fixture Channel ${ch}`)
    .replace(/fixturechannel1(?!\d)/g, `fixturechannel${ch}`);
}

const shelf = (items) =>
  `<ytd-rich-section-renderer class="style-scope ytd-rich-grid-renderer"><div id="content" class="style-scope ytd-rich-section-renderer"><ytd-rich-shelf-renderer is-shorts="" class="style-scope ytd-rich-section-renderer"><div id="dismissible" class="style-scope ytd-rich-shelf-renderer"><span id="title" class="style-scope ytd-rich-shelf-renderer">Shorts</span><div id="contents" class="style-scope ytd-rich-shelf-renderer">\n${items.join('\n')}\n</div></div></ytd-rich-shelf-renderer></div></ytd-rich-section-renderer>`;
const continuation = '<ytd-continuation-item-renderer class="style-scope ytd-rich-grid-renderer"></ytd-continuation-item-renderer>';
const grid = (children) =>
  `<ytd-two-column-browse-results-renderer class="style-scope ytd-browse"><div id="primary" class="style-scope ytd-two-column-browse-results-renderer"><ytd-rich-grid-renderer class="style-scope ytd-two-column-browse-results-renderer"><div id="contents" class="style-scope ytd-rich-grid-renderer">\n${children.join('\n')}\n</div></ytd-rich-grid-renderer></div></ytd-two-column-browse-results-renderer>`;
const sidebar = (children) =>
  `<div id="columns" class="style-scope ytd-watch-flexy"><div id="secondary" class="style-scope ytd-watch-flexy"><div id="secondary-inner" class="style-scope ytd-watch-flexy">PLAYLIST<div id="related" class="style-scope ytd-watch-flexy"><ytd-watch-next-secondary-results-renderer class="style-scope ytd-watch-flexy"><div id="items" class="style-scope ytd-watch-next-secondary-results-renderer"><ytd-item-section-renderer class="style-scope ytd-watch-next-secondary-results-renderer"><div id="contents" class="style-scope ytd-item-section-renderer">\n${children.join('\n')}\n</div></ytd-item-section-renderer></div></ytd-watch-next-secondary-results-renderer></div></div></div></div>`;
const app = (pages) =>
  `<ytd-app><div id="content" class="style-scope ytd-app"><ytd-page-manager id="page-manager" class="style-scope ytd-app">\n${pages.join('\n')}\n</ytd-page-manager></div><ytd-popup-container class="style-scope ytd-app"></ytd-popup-container></ytd-app>`;

const home = (n, id = `FIXTURE${String(n).padStart(4, '0')}`) => tile('home-tile.html', { id, n });
const short = (n, id = `FIXTURE${String(n).padStart(4, '0')}`) => tile('shorts-tile.html', { id, n });
const watch = (n, id = `FIXTURE${String(n).padStart(4, '0')}`) => tile('watch-tile.html', { id, n });

const homeHeader = `<!-- composed by scripts/compose-fixtures.mjs from the captured fixtures in this folder (anonymized, lang=en-GB). Do not edit by hand: change the script and re-run it.
     Page manager: hidden ytd-browse[channels] (decoys DECOY000001-2, channel-videos-tile.html), hidden ytd-watch-flexy video-id=DECOY000009
     (decoy DECOY000003, watch-tile.html), visible ytd-browse[home].
     Home grid #contents: FIXTURE0001-0002 (home-tile), ad holding FIXTURE0003 (home-ad-tile, renumbered), FIXTURE0004 live with a /channel/UC link
     (home-live-tile), FIXTURE0005 radio start (home-mix-tile), FIXTURE0006, a Shorts shelf section (FIXTURE0101-0103 and a copy of FIXTURE0002,
     shorts-tile), a second copy of FIXTURE0001, FIXTURE0007-0010, one continuation item.
     template#continuation-batch holds the next batch to append: FIXTURE0011-0016, a second Shorts shelf (FIXTURE0104-0105), a new continuation item. -->`;

const homeContinuation = [...[11, 12, 13, 14, 15, 16].map((n) => home(n)), shelf([short(104), short(105)]), continuation];
const pageHome = `${homeHeader}
${app([
  `<ytd-browse page-subtype="channels" hidden="" class="style-scope ytd-page-manager">${grid([
    tile('channel-videos-tile.html', { id: 'DECOY000001', n: 901 }),
    tile('channel-videos-tile.html', { id: 'DECOY000002', n: 902 }),
  ])}</ytd-browse>`,
  `<ytd-watch-flexy hidden="" video-id="DECOY000009" class="style-scope ytd-page-manager">${sidebar([tile('watch-tile.html', { id: 'DECOY000003', n: 903 })]).replace('PLAYLIST', '')}</ytd-watch-flexy>`,
  `<ytd-browse page-subtype="home" class="style-scope ytd-page-manager">${grid([
    home(1),
    home(2),
    tile('home-ad-tile.html', { id: 'FIXTURE0003', n: 3 }),
    tile('home-live-tile.html', { id: 'FIXTURE0004', n: 4 }),
    tile('home-mix-tile.html', { id: 'FIXTURE0005', n: 5 }),
    home(6),
    shelf([short(101), short(102), short(103), short(2, 'FIXTURE0002')]),
    home(1),
    home(7),
    home(8),
    home(9),
    home(10),
    continuation,
  ])}</ytd-browse>`,
])}
<template id="continuation-batch">
${homeContinuation.join('\n')}
</template>
`;

const watchHeader = `<!-- composed by scripts/compose-fixtures.mjs from the captured fixtures in this folder (anonymized, lang=en-GB). Do not edit by hand: change the script and re-run it.
     Page manager: hidden ytd-browse[home] (decoys DECOY000011-12, home-tile.html), visible ytd-watch-flexy video-id=FIXTURE0201.
     #secondary-inner holds a ytd-playlist-panel-renderer#playlist with a decoy lockup FIXTURE0299 (never a Tile), then the sidebar
     ytd-watch-next-secondary-results-renderer #items > ytd-item-section-renderer > #contents with watch-tile.html copies:
     FIXTURE0202-0204, FIXTURE0201 (the playing video, must be skipped), a second copy of FIXTURE0202, FIXTURE0205-0207, one continuation item.
     template#continuation-batch holds the next batch to append: FIXTURE0208-0210 and a new continuation item.
     The sidebar markup skeleton (#columns, #secondary, #related) follows YouTube's markup observed in October 2026; the playlist panel skeleton is [inf]. -->`;

const playlist = `<ytd-playlist-panel-renderer id="playlist" class="style-scope ytd-watch-flexy"><div id="items" class="style-scope ytd-playlist-panel-renderer">${tile('watch-tile.html', { id: 'FIXTURE0299', n: 299 })}</div></ytd-playlist-panel-renderer>`;
const pageWatch = `${watchHeader}
${app([
  `<ytd-browse page-subtype="home" hidden="" class="style-scope ytd-page-manager">${grid([home(911, 'DECOY000011'), home(912, 'DECOY000012')])}</ytd-browse>`,
  `<ytd-watch-flexy video-id="FIXTURE0201" class="style-scope ytd-page-manager">${sidebar([
    watch(202),
    watch(203),
    watch(204),
    watch(201),
    watch(202),
    watch(205),
    watch(206),
    watch(207),
    continuation,
  ]).replace('PLAYLIST', playlist)}</ytd-watch-flexy>`,
])}
<template id="continuation-batch">
${[watch(208), watch(209), watch(210), continuation].join('\n')}
</template>
`;

writeFileSync(join(dir, 'page-home.html'), pageHome);
writeFileSync(join(dir, 'page-watch.html'), pageWatch);
console.log(`wrote page-home.html (${(pageHome.length / 1024).toFixed(1)} KB), page-watch.html (${(pageWatch.length / 1024).toFixed(1)} KB)`);
