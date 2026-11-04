# Bilibili integration spec (`src/sites/bilibili/`)

How Shoo finds Tiles on www.bilibili.com, reads them, performs Native actions and notices Undo. The content engine (watcher, NativeActionQueue, chip and annotation hosts) is shared with YouTube and specified in `docs/spec/youtube-integration.md`. This file covers only what the Bilibili Site supplies through `src/sites/site.ts`. Every selector here was observed on 2026-10-18 (zh-CN, signed out, desktop Chrome) unless marked [inf] or [unverified]. Fixtures: `test/fixtures/bilibili/`. Why Bilibili has its own content script and is on from install: ADR 0011.

Rules that override convenience are the same as YouTube's: never hide, restyle or remove a Tile, one Native action at a time per tab, key judging by video ID, never act on the playing video or on ads, and the content script never judges.

## 0. Bilibili in the manifest

- The manifest's content scripts run `content-scripts/bilibili.js` on `https://www.bilibili.com/*`, and `host_permissions` holds `https://www.bilibili.com/*` and `https://i0.hdslb.com/*` (covers for Thumbnail rules). Bilibili is on from install.
- Settings, Sites turns Bilibili off (`settings.sites.bilibili`). The script then reads settings once at load and does nothing more. Its Surfaces have their own switches under it.
- When the user takes the access away in the browser, the browser stops running the script. Settings, Sites says so with Allow access (`permissions.request` for both origins, first statement of the click handler), and the popup says so while Bilibili is on, linking there.

## 1. Surface registry (`src/sites/bilibili/surfaces.ts`)

| SurfaceId | Page detection | Container (`childList`) | Tile root | Supported | Native actions | Fixtures |
|---|---|---|---|---|---|---|
| `bilibiliHome` | `location.pathname === '/'` | `.recommended-container_floor-aside > .container` | a child `.feed-card` (first rows) or `.bili-feed-card` (infinite feed) holding `.bili-video-card.is-rcmd` | yes | Not interested, Don't recommend channel | `home-tile.html`, `home-ad-tile.html`, `home-menu.html` |
| `bilibiliVideoSidebar` | `/video/…` | not observed | `.video-page-card-small` | no: no menu button, not even on hover | none | `video-sidebar-tile.html` |

The container also holds the top carousel (`.recommended-swipe`), floors for live rooms, bangumi and courses (`.floor-single-card`) and loading skeletons (`.bili-video-card` without content). None of them is a Tile. The "换一换" button replaces the first rows' `.feed-card` elements outright (a container `childList` change), so no element reuse was seen. Search (`search.bilibili.com`) is another origin and not in scope.

Element roles on `bilibiliHome`:

| Role | Element |
|---|---|
| `actionRoot` | `.bili-video-card__wrap` (holds the placeholder and the info row) |
| `thumbnail` | `.bili-video-card__image` (inside the cover link, geometry only) |
| `badges` | `.bili-video-card__stats--item` (plays, danmaku) and `.bili-video-card__stats__duration`, the stats row over the cover's bottom edge |
| `mountParent` | `.bili-video-card`, `position: relative`, outside the cover link |
| `menuButton` | `.bili-video-card__info--no-interest` (`display: none` until the card is hovered) |
| `focusReturn` | `h3.bili-video-card__info--tit a` |
| `reuseTargets` | `href` of `a.bili-video-card__image--link` |

Bilibili's Home is a page of its own: no hidden copies of other pages and no in-app navigation (video links open new tabs). `visiblePage` is `<body>`, and the Site lists no navigation events.

## 2. Extraction (`src/sites/bilibili/extract.ts`)

| Field | Source |
|---|---|
| `videoId` | `BV` id from `a.bili-video-card__image--link[href]` when it points to `www.bilibili.com/video/BV…` (12 characters: `BV` and 10 letters or digits) |
| `title` | `h3.bili-video-card__info--tit[title]`, else its text |
| `channelName` | `.bili-video-card__info--author[title]`, else its text |
| `channelId` | the numeric id in `a.bili-video-card__info--owner[href]` (`//space.bilibili.com/<id>`) |
| `durationSec` | `.bili-video-card__stats__duration` (`01:09`, `01:02:03`, zero-padded) |
| `cover` | path of `picture.bili-video-card__cover img[src]` on `i<n>.hdslb.com`, without the `@…` size suffix, only in the shape `/bfs/archive/<40 hex>.jpg|png` |
| `isShort`, `isLive`, `isUpcoming`, `isMembersOnly` | always `false`: live rooms come as floors, and no Short or upcoming Tile exists in the feed |
| `isArtistChannel` | never set: Bilibili has no Artist channel badge |
| `viewCount` | never set: the stats row shows plays, which Shoo does not read, so views Rules work on YouTube only (REQ-RULE-13, REQ-RULE-15) |

Skips, in order:

| Skip | How to detect |
|---|---|
| Ads | The cover link goes to `cm.bilibili.com` (2 of 10 Home Tiles on 2026-10-18). Ads look like video Tiles, menu button included, carry `rel` and `data-target-url` on their links and show an icon instead of a duration. They are skipped by the video link rule below, silently |
| Not a plain video | The cover link is not a `www.bilibili.com/video/BV…` page (live rooms, bangumi, courses, ads): skipped silently |
| No duration | Skipped |
| The playing video | On a video page, its own `BV` id (REQ-SURF-3) |
| No cover link, no title | Skipped with a markup warning |

The cover path is sent to the background so the thumbnail pass can fetch the image from Bilibili's image host (`decision-engine.md` Section 4), and Activity keeps it so Settings can show the thumbnail. It never reaches a model.

## 3. Menu (`src/sites/bilibili/menu.ts`)

- **Opening.** The menu is a popover (`.vui_popover` holding `.bili-video-card__info--no-interest-panel`) appended to `<body>`, one per Tile, created the first time it opens and hidden with `display: none` when it closes. It opens on `mouseenter` on the menu button and closes about 0.6 s after `mouseleave`. A synthetic `click` on the button or its icon opens nothing. A synthetic `mouseenter` opens it even while the button is `display: none` (live test 2026-10-18). Shoo dispatches `mouseenter` to open, and `mouseleave` to close and after every attempt (`release`), so the button's hover state never lingers.
- **Which popover is Shoo's.** Popovers are per Tile (`shared: false`): the one that was closed when Shoo hovered and is open now. A popover that was already open belongs to the user, and focus safety waits until it closes. Popper moves an open popover's `transform`, so position is not part of its signature.
- **Items.** `.bili-video-card__info--no-interest-panel--item`, text only, no icon: "内容不感兴趣" (Not interested) and "不想看此UP主" (Don't recommend channel). "不感兴趣" is also accepted for Not interested [unverified]. [inf] Bilibili's web UI offers no other language, so text matching holds. A click on the item itself works and removes the popover.

## 4. Placeholder and Undo

- The placeholder `.bili-video-card__no-interest` is inside every Tile from the start, hidden with an inline `display: none`. After a menu item is clicked it shows within 100 ms (live test), the info row `.bili-video-card__info` gets `display: none`, and the cover stays behind a blurred, darkened copy. Its title repeats the item clicked ("内容不感兴趣"), its description reads "将减少此类内容推荐", and `.revert-btn` ("撤销") is Undo.
- `find` is the placeholder while it is displayed. `restored` is a hidden placeholder with a displayed info row. The Undo watch observes `style` and `class` changes in the `actionRoot` subtree, because nothing is added or removed.
- **Shoo's Undo** clicks `.revert-btn`. The Tile was back within about 0.1 to 0.4 s (the placeholder fades out). **Bilibili's own Undo** is detected the same way as YouTube's and reported with `via: 'site'` (live test 2026-10-18).
- **Don't recommend channel** placeholder: [inf] the title then reads "不想看此UP主", which `isChannel` checks for "UP主". Not clicked live, to leave the test account's recommendations alone.
- Availability: [unverified] how long Undo stays available, and what a signed-in account's placeholder looks like. Signed out, the menu, the placeholder and Undo worked as above.

## 5. In-page UI

- Chips sit in `.bili-video-card`, above the stats row (the row starts at the cover's left edge, so the chip lifts above it at the cover's width minus 16 px). Checked live with the built bundle: the chip stays above Bilibili's hover preview player and stays clickable.
- The removed-Tile annotation sits at the top of the placeholder with its own surface (`data-surface`), because the placeholder shows the blurred cover behind it. Bilibili's sentence and 撤销 sit side by side, so the annotation never covers: it takes the top 8 px inset of the card column, and both stay visible and clickable (checked live).
- Theme: Bilibili colours its pages from `--bg1` on `:root` (`#FFFFFF` in the light theme). Shoo treats a `--bg1`, or else a `<body>` background, darker than 0.2 relative luminance as dark, and re-reads it when `class`, `style` or `data-theme` changes on `<html>` or `<body>` [unverified]: the dark theme was not checked live.
- No site layer at the viewport's bottom: no dock lift.
- The Bilibili Site has no `shelves` and no `watchUserBans` member: Bilibili's Home has no Shelf to dismiss (REQ-ACT-6), and a 不想看此UP主 the user picks themselves adds no Banned channel (REQ-ACT-5). Skip Subscribed channels never applies to Bilibili Tiles (REQ-RULE-14).

## 6. Resilience

- `selectorVersion` is `bilibili-2026-10-18`, so Activity's failure rows tell Bilibili's markup from YouTube's.
- The markup self-test runs as on YouTube. The menu check on the first Native action of a page reports `dropdown` when no popover opened.
- Failures count toward the shared breakers (`architecture.md` Section 7). A breaker tripped by Bilibili names Bilibili in the popup and in-page notices.
- Fixture refresh: as in `youtube-integration.md` Section 7. The browser tooling blocks copying attributes with query strings on bilibili.com, so the fixtures are structural skeletons with anonymized titles, channels, `BV1FIXTURE01`-style ids, `space.bilibili.com/1000000N` channel ids and a fake cover hash.

## 7. Test plan

- **jsdom tests** (`src/sites/bilibili/bilibili.test.ts`): the registry finds the feed's video Tiles and skips the carousel, floors and skeletons; extraction of every field; ads and non-video links skipped silently; a missing title warns; covers off the archive shape and off Bilibili's image host refused; the playing video skipped; every role resolves outside the cover link; the video page sidebar listed but unsupported; the dark theme from `--bg1`; the watcher sends the video Tiles and never the ad; the menu's items by label; the placeholder only while displayed, Undo button, channel variant; the annotation's surface and liveness.
- **Simulated Bilibili** (`simulateBilibili` in `src/sites/bilibili/test-harness.ts`): a popover per Tile on `mouseenter`, closing after `mouseleave`, a click showing the hidden placeholder, 撤销 restoring the Tile. Tests: Not interested and Don't recommend channel end to end, Bilibili's own Undo told from Shoo's, waiting while the user has a Tile menu open, failing at `openMenu` when no popover opens.
- **Background tests**: a Bilibili tab judged against Bilibili's Rules only; a batch with another Site's Tiles refused; content messages from a Bilibili tab; covers in Activity; the breaker naming Bilibili; a channel Keep rule kept on its Site.
- **Manual live checklist** (before each release, in a browser with Shoo installed):
  1. Turning Bilibili off in Settings, Sites leaves an open Home tab without chips, and turning it on brings them back.
  2. Home: Review chips on flagged Tiles, above the stats row, clickable over the hover preview.
  3. Remove shows Bilibili's placeholder and Shoo's annotation. Keep restores the Tile through 撤销. Bilibili's own 撤销 is detected.
  4. Auto: the page never moves while Shoo removes Tiles below the fold, no popover stays open.
  5. A Banned channel's Tile gets 不想看此UP主.
  6. Ads (links to cm.bilibili.com) are never chipped.
  7. Dark theme, if the account offers one.
  8. Removing Shoo's access to www.bilibili.com in the browser shows the no-access notice in Settings, Sites and in the popup. Allow access restores it, and Bilibili tabs opened without access show nothing.
  9. Repeat in Firefox.
