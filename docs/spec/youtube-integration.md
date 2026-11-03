# YouTube integration spec (`src/youtube/`)

How Shoo finds Tiles, reads them, performs Native actions and notices Undo on youtube.com desktop. Build `src/youtube/` from this file. Every selector here was observed on 2026-10-09 (en-GB, signed in) unless marked [inf], [unverified] or "pending fixture". Fixtures: `test/fixtures/youtube/`. Names (`SurfaceId`, `TileFacts`, `NativeActionQueue`, message names) follow `docs/spec/architecture.md`.

This file is the single source of truth for: the Surface registry (including `actionRoot` and mount anchors), extraction, NativeActionQueue timings, focus safety, decoration state, the markup self-test, and Shelf dismissal (Section 10). Other specs link here instead of restating them.

Rules that override convenience:
- Never hide, restyle or remove a Tile (REQ-ACT-1, ADR 0001). Shoo only clicks YouTube's own menu items.
- One Native action at a time per tab (REQ-ACT-2).
- Key judging by video ID, keep decoration state per element (Section 3).
- Never act on the currently playing video (REQ-SURF-3), ads, Mixes, playlists, podcasts or movies (REQ-SURF-2).
- The content script never judges Tiles. It finds, extracts and decorates Tiles, sends batches with `judgeTiles`, and performs Native actions. The background owns the whole judging pipeline (`docs/spec/architecture.md`, Tile lifecycle).

## 1. Surface registry (`src/youtube/surfaces.ts`)

One frozen object per `SurfaceId`. Unsupported Surfaces stay in the registry with `supported: false` and a `reason` so Settings can show them disabled (REQ-SURF-1a) and enabling them later is a data change.

| SurfaceId | Page detection | Container to observe (`childList`) | Tile root | v1 | Native actions | Fixtures |
|---|---|---|---|---|---|---|
| `home` | `location.pathname === '/'` and visible `ytd-browse[page-subtype="home"]` | `ytd-browse[page-subtype="home"]:not([hidden]) ytd-rich-grid-renderer > #contents` | `ytd-rich-grid-renderer > #contents > ytd-rich-item-renderer` whose content holds a `yt-lockup-view-model`, minus ads | yes | Not interested, Don't recommend channel | `home-tile.html`, `home-live-tile.html`, `home-mix-tile.html`, `home-ad-tile.html`, `home-menu.html` |
| `shortsShelf` | inside `home` only | each `ytd-rich-shelf-renderer[is-shorts] #contents` (shelves arrive as new `ytd-rich-section-renderer` children of the Home grid) | `ytd-rich-item-renderer[is-shelf-item]` holding `ytm-shorts-lockup-view-model` | yes | Not interested only (REQ-SURF-1b) | `shorts-tile.html`, `shorts-menu.html` |
| `watchSidebar` | `location.pathname === '/watch'` and visible `ytd-watch-flexy` | `ytd-watch-next-secondary-results-renderer ytd-item-section-renderer > #contents` | `yt-lockup-view-model.lockup` as a direct child of that `#contents` | yes | Not interested, Don't recommend channel | `watch-tile.html`, `watch-menu.html`, `watch-removed-placeholder.html` |
| `search` | `/results` and visible `ytd-search` | not observed in v1 | `ytd-video-renderer[is-search]` | no: Search menus have no Not interested and no Don't recommend channel (all 17 Tiles checked) | none | `search-tile.html`, `search-menu.html`, `search-shorts-tile.html` |
| `channel` | `/@…`, `/channel/…`, `/c/…`, `/user/…` with visible `ytd-browse[page-subtype="channels"]` | not observed in v1 | Home tab `yt-horizontal-list-renderer #items > yt-lockup-view-model`, Videos tab `ytd-rich-grid-renderer > #contents > ytd-rich-item-renderer` | no: channel menus only offer queue, Watch Later, playlist, download, share | none | `channel-tile.html`, `channel-videos-tile.html`, `channel-menu.html` |
| `endScreen` | `/watch` player | not observed in v1 | `.ytp-ce-element`, `.ytp-modern-videowall-still` | no: end-screen cards and the end grid contain no menu buttons (live test 2026-10-09) | none | none |

Per-Surface element roles for the supported Surfaces:

| Role | `home` | `watchSidebar` | `shortsShelf` |
|---|---|---|---|
| `actionRoot(tile)`: the element whose children YouTube swaps for the placeholder | the `yt-lockup-view-model` inside the Tile root (verified 2026-10-10) | the Tile root itself (`yt-lockup-view-model`) | `ytm-shorts-lockup-view-model-v2`, the parent of `ytm-shorts-lockup-view-model` (verified 2026-10-10: the inner lockup is removed while the placeholder shows) |
| `thumbnail(tile)`: geometry source for the chip | `yt-thumbnail-view-model` inside `a.ytLockupViewModelContentImage` | same | `.shortsLockupViewModelHostThumbnailParentContainer` |
| `mountParent(tile)`: where Shoo's host element is appended | `.ytLockupViewModelHost` (vertical layout, thumbnail first) | `.ytLockupViewModelHost` (horizontal layout, thumbnail left) | `ytm-shorts-lockup-view-model` |
| `menuButton(tile)` | `.ytLockupMetadataViewModelMenuButton button` | `.ytLockupMetadataViewModelMenuButton button` (the container also carries `.ytLockupMetadataViewModelBottomRight`) | `.shortsLockupViewModelHostOutsideMetadataMenu > button` |
| `focusReturn(tile)`: where focus goes on Esc from a chip | `a.ytLockupMetadataViewModelTitle` | `a.ytLockupMetadataViewModelTitle` | `a.shortsLockupViewModelHostOutsideMetadataEndpoint` |

Registry shape:

```ts
interface SurfaceDef {
  id: SurfaceId;
  supported: boolean;
  reason?: string;                         // i18n key shown in Settings when unsupported, the shared 'settings.surfaces.unsupported'
  matches(loc: Location, page: Element): boolean;
  containers(page: Element): Element[];    // resolved fresh after every navigation
  tiles(container: Element): Element[];
  actionRoot(tile: Element): Element | null;
  thumbnail(tile: Element): Element | null;
  mountParent(tile: Element): Element | null;
  menuButton(tile: Element): HTMLElement | null;
  focusReturn(tile: Element): HTMLElement | null;
  actions: Array<'notInterested' | 'dontRecommendChannel'>;
  selectorVersion: string;                 // e.g. '2026-10-09'
}
```

## 2. Page scoping, navigation and observers (`src/youtube/watcher.ts`)

### Scope to the visible page

- `ytd-page-manager#page-manager` keeps one element per visited page type (`ytd-browse[page-subtype="home"]`, `ytd-browse[page-subtype="channels"]`, `ytd-search`, `ytd-watch-flexy`). Pages you leave stay connected with a `hidden` attribute.
- Always resolve the current page as `document.querySelector('ytd-page-manager > :not([hidden])')` and run every query inside it. A document-wide `querySelectorAll` returns Tiles from hidden pages.
- Returning to Home from another page type can create a new `ytd-browse[page-subtype="home"]`. Never cache a container across navigations.

### Navigation

- Listen on `document` for `yt-navigate-finish` (fires on search submit, opening a result, channel tab switches and logo clicks) and observe `ytd-page-manager` (`childList`, `attributes: ['hidden']`, `subtree: false`) as a backup.
- Data is not ready at `yt-navigate-finish`. The order of `yt-page-data-updated` and `yt-navigate-finish` varies. On either event: disconnect old observers, cancel queued jobs for the old page (they become `stale`), resolve the visible page, find the containers for enabled and supported Surfaces, attach new observers, then scan existing children once.
- If no container exists yet, observe the visible page element with `childList, subtree` until the container appears, then switch to the narrow observer. Give up after 10 s of visible time (becoming visible restarts the wait) and wait for the next navigation.
- `yt-navigate-start` (and `yt-navigate-finish` as a backstop) ends every Undo watch at once: YouTube restores or clears the placeholders of the page being left about 1 s after the click, before the watcher rebinds (live test 2026-10-10). Section 5.

### Observers

- One `MutationObserver` per active container, `childList` only, no `subtree`.
- One `MutationObserver` per acted-on Tile on its `actionRoot` (`childList`, no `subtree`) to see placeholder swaps and YouTube's own Undo (Section 5). Disconnect it on navigation or when the element shows a different video.
- Coalesce records per animation frame: push added nodes into a `Set`, process once in `requestAnimationFrame`.
- An `IntersectionObserver` (`rootMargin: '100% 0px'`, threshold 0) marks Tiles as eligible. Only eligible Tiles are extracted and sent for judging (batch rule in `docs/spec/architecture.md`).
- **Badge wait.** No observer sees an icon render inside a Tile (container observers have no `subtree`). So a Tile whose channel-row badge icon has not rendered and whose label does not tell what it is (`channelBadgePending`, Section 3) is not sent at once: it may carry the Artist channel badge. A timer reads every waiting Tile again each 100 ms (`BADGE_POLL_MS`, the menu icon poll cadence of Section 4). The Tile is sent once, with fresh facts, as soon as the icon renders, or without the flag after 15 visible polls (`BADGE_WAIT_MS`, about 1.5 s), so no Tile stays unjudged. Polls in a hidden tab do not count, though they still send a Tile whose icon rendered: [inf] a hidden tab draws no frames, so its channel-row icons may not render there (menu icons did, Section 4). The browser throttles the poll in a hidden tab. The wait ends without a send on navigation (rebind), when the Tile leaves the eligible area or the page, and on `stop()`. A Tile that shows another video starts its own wait. A poll that finds no readable video ID (content mid-render) keeps the wait and reads the Tile again next time. A container mutation or rescan that meets a waiting Tile reads it again without restarting its wait. Only first sends wait: re-sent Tiles are read as they are. Tiles with a rendered icon, a known label or no badge are sent at once.
- Zero observers when Shoo is off or no enabled and supported Surface matches the page (REQ-QUAL-2). The content script learns this from `local:settings.enabled` at load and from the background's `runtimeStateChanged` and `settingsChanged` broadcasts afterwards (architecture.md, Messages).
- Rescan visible Tiles (re-send the eligible, undecorated ones) when the background reports a return to `ok` from another runtime state (resume, `online`, reconnect, new day) or a `settingsChanged` with a new `rulesVersion` (architecture.md, Runtime state).

### Hidden tabs

- In a hidden tab timers are throttled hard and the player does not load. Send only Tiles that are visible, and pause the `NativeActionQueue` while `document.hidden` is true. Resume on `visibilitychange`.

## 3. Extraction and decoration state (`src/youtube/extract.ts`, `src/youtube/watcher.ts`)

`extract(tile)` returns `TileFacts` or `null` (skip). Skip order matters: ad check first, then type checks, then the current-video guard.

### Skip rules

| Skip | How to detect |
|---|---|
| Ad (Home) | `tile.querySelector('ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, feed-ad-metadata-view-model, ad-badge-view-model, .ytBadgeShapeAd')` is not null. Home ads contain a real lockup with `content-id-<id>` and a `/watch` link, so the ad slot is a descendant, not an ancestor. The Home "Sponsored" badge has no `aria-label`. |
| Ad (Watch sidebar) | Same descendant check, plus skip anything under `#player-ads`. |
| Radio or Mix start | Thumbnail link `href` contains `list=RD` or `start_radio=1`. |
| Playlist, podcast, movie, real Mix collection | [unverified] markup. Skip when the thumbnail link has a `list=` parameter or when the lockup lacks `content-id-*`. Add fixtures and exact rules the first time one is seen. |
| Duration-less Tile | Skip when there is no duration badge, no live badge and no upcoming marker. The upcoming marker is **pending fixture**: until a fixture of an upcoming Tile is captured, every duration-less, non-live Tile is skipped, so upcoming streams are not judged yet (REQ-SURF-2 and REQ-RULE-3 mark them pending). Candidate markers to check when one appears: a `badge-shape` whose text or `aria-label` says Upcoming or Premieres, a clock icon overlay, a scheduled-time metadata row. |
| Currently playing video | Video ID equals `document.querySelector('ytd-watch-flexy')?.getAttribute('video-id')` or the `v` URL parameter. Also ignore everything inside `ytd-playlist-panel-renderer#playlist`. |
| Missing title or video ID | Skip silently, report a `markup` warning (Section 7). |

### Fields: lockup Tiles (`home`, `watchSidebar`)

| `TileFacts` field | Selector |
|---|---|
| `videoId` | `content-id-<11 chars>` class on `.ytLockupViewModelHost`. A lockup without it is skipped (see the skip table), even when its thumbnail link has a `v` parameter, because playlists, podcasts and movies can link to `/watch` too |
| `title` | `h3.ytLockupMetadataViewModelHeadingReset[aria-label]` or `[title]`, else text of `a.ytLockupMetadataViewModelTitle span.ytAttributedStringHost` |
| `channelName` | Home: text of `.ytContentMetadataViewModelMetadataRow a.ytAttributedStringLink` (first row). Watch sidebar: text of the first `.ytContentMetadataViewModelMetadataText` in the first row (plain text, no link). Collaboration Tiles (`yt-avatar-stack-view-model`): plain text names, take the first |
| `channelHandle` | Home: link `href` when it starts with `/@` |
| `channelId` | Home: link `href` when it is `/channel/UC…`. Not in the DOM on the Watch sidebar |
| `durationSec` | Parse `yt-thumbnail-badge-view-model badge-shape .ytBadgeShapeText` (`13:54`, `1:02:03`). Language-independent because it is digits and colons |
| `viewCount` | The first `.ytContentMetadataViewModelMetadataText[aria-label]` whose label parses as English views (`parseViews`: `116 thousand views`, `3.5 million views`, `1,234 views`, `1 view`, `No views`). The visible text (`116k`) has no word to tell it from other counts, and the channel name carries no label. Absent in another language and on live Tiles (`18 thousand watching`). Home: `home-tile.html`. Watch sidebar: `watch-tile.html` (second row). [unverified] `No views` and the `billion` label have no fixture. Never sent to a model (`decision-engine.md` Section 10) |
| `isLive` | `badge-shape.ytBadgeShapeThumbnailLive` present |
| `isArtistChannel` | `true` when the first `.ytContentMetadataViewModelMetadataRow` (the channel row) holds a `.ytContentMetadataViewModelIcon` with a `path[d]` containing `L14.001 9.7v4.55a2.75 2.75 0 11-2-2.646` (the music note, `ARTIST_ICON_SIGNATURE`) or an `aria-label` in `ARTIST_BADGE_LABELS`. Absent otherwise. An icon with no `path[d]` yet and a label in neither `ARTIST_BADGE_LABELS` nor `VERIFIED_BADGE_LABELS` makes the Tile wait for it (badge wait, Section 2). Home: `home-live-tile.html` and `page-home.html`. Watch sidebar: [inf], see below |
| `isUpcoming` | pending fixture (see skip rules). Always `false` in v1 until a selector is verified |
| `isMembersOnly` | pending fixture. Always `false` in v1 until a selector is verified. The `membersOnly` Rule kind stays hidden until then (REQ-RULE-3) |
| `isShort` | `false` for lockups |

Channel identity: extraction only supplies the raw inputs (`channelName`, `channelHandle`, `channelId`). The `ChannelKey` normalization and matching order (ID or handle when both sides have one, else the normalized name) are defined in `docs/spec/architecture.md` (ChannelKey). On the Watch sidebar only the name exists, so matching there is by name. A Tile with no channel inputs has no ChannelKey, and its channel actions (Ban, Always keep this channel) are disabled.

Artist channel badge: the Official Artist Channel badge and the Verified badge both render as a `.ytContentMetadataViewModelIcon` beside the channel name, one drawing a music note and the other a check mark, so a Verified badge never makes an Artist channel. The icon path matches in any language. The label is the fallback for an icon that has not rendered when the Tile is read, and `ARTIST_BADGE_LABELS` holds only "Official Artist Channel" (en-GB, the only label verified). `VERIFIED_BADGE_LABELS` holds only "Verified" (en-GB, `watch-tile.html`): an unrendered icon with that label is never the Artist channel badge. Any other unrendered icon in the channel row, labelled in another language or not at all, could be either badge, so the watcher holds the Tile in the badge wait (Section 2) and sends it once the icon renders, or after 1.5 s of visible time without the flag. [inf] With the en-GB UI no Tile waits, since every badge seen so far carries one of the two labels (an unlabelled unrendered icon would wait). With another language every Tile whose badge icon is unrendered waits, Verified ones included, until the icon renders. [unverified] whether and how late channel-row icons render on youtube.com, and whether they wait until the Tile is on screen (the eligible area reaches one viewport past it): the 1.5 s wait follows the menu icons, which rendered about 1 s after the menu opened (Section 4). An icon later than the wait is missed, and in Auto that Tile can be removed despite an Artist channel Keep rule. [inf] Watch sidebar: its Verified badge sits in the same row element (`watch-tile.html`), so the Artist badge should read the same way, but no Watch sidebar fixture of an Artist channel exists yet. YouTube's page data names the badge `BADGE_STYLE_TYPE_VERIFIED_ARTIST` (KAF's channel in search data, checked 2026-10-10), but only a MAIN-world script can read page data (ADR 0005), so Shoo reads the rendered badge. `isArtistChannel` is not part of what Shoo sends (`decision-engine.md` Section 10).

### Fields: Shorts shelf (`shortsShelf`)

| Field | Selector |
|---|---|
| `videoId` | `a.shortsLockupViewModelHostEndpoint[href^="/shorts/"]`, take the 11 characters after `/shorts/` |
| `title` | `h3.shortsLockupViewModelHostMetadataTitle a[title]` |
| `channelName` | none (not in the DOM). Channel Rules and Banned channels cannot match here (REQ-SURF-1b) |
| `durationSec` | none (Shorts are never skipped for a missing duration) |
| `viewCount` | `.shortsLockupViewModelHostMetadataSubhead`: an `aria-label` inside it when present, else its text (`1.1m views`, no label in `shorts-tile.html`), parsed by `parseViews`. Absent in another language |
| `isArtistChannel` | never set (no channel row). Artist channel Keep rules cannot match here |
| `isShort` | `true` |

### Decoration state and duplicate copies

- Judging is keyed by `videoId`. Decoration is keyed by element: `WeakMap<Element, { videoId: string; state: 'pending' | 'chip' | 'label' | 'acting' | 'removed' | 'none' }>`.
- The same video can appear more than once on a page (Home and its Shorts shelf, or a re-rendered Tile after navigating back). The Verdict applies to every element showing that video: each gets its own chip or label.
- In Auto, act once per `videoId` per page. Other copies get the removed-Tile annotation style without a Native action ("Already shooed above"), so YouTube receives one signal.
- On every coalesced mutation and on attribute changes to `content-id-*` or the thumbnail `href`, compare the element's current `videoId` with the map. If it changed, unmount Shoo's UI for that element, drop its entry, and treat it as a new Tile.
- A Tile already decorated on this page is not re-sent unless the background announces a new `rulesVersion` or `settingsGeneration` (stale replies are dropped as defined in architecture.md, Mid-flight changes).

## 4. NativeActionQueue (`src/youtube/actions.ts`)

A per-tab FIFO queue. One job at a time, at least 350 ms between jobs, paused while `document.hidden`. A job is `{ tileEl, videoId, nativeAction: 'notInterested' | 'dontRecommendChannel', verdict }`. On a Shorts shelf Tile a `dontRecommendChannel` job is downgraded to `notInterested` before it is queued. A Shelf dismissal (Section 10) is a `TargetJob` in the same queue: the same spacing, focus safety, scroll guard, prechecks and steps, with the Shelf's own roles in place of the Surface's, no Undo watch and no markup check.

### Focus safety (runs before step 1 of every job)

Shoo must never take a menu or focus away from the user (WCAG 2.4.3, 3.2.1).

- **Wait** (re-check every 250 ms, no timeout, no failure) while any of these hold:
  - a YouTube dropdown is open that Shoo did not open (`ytd-popup-container tp-yt-iron-dropdown` that is open by step 4's rule),
  - `document.activeElement` is an `input`, `textarea`, `select`, `iframe` or `[contenteditable]` element (search box, comment box, the Watch page live chat frame),
  - focus is inside the target Tile or inside one of Shoo's chips,
  - the pointer is pressed (between `pointerdown` and `pointerup` on the document),
  - the user scrolled in the last 500 ms (`TIMING.scrollQuietMs`): `wheel`, `touchstart`, `touchmove`, a scroll key (ArrowUp, ArrowDown, PageUp, PageDown, Home, End, Space) outside a text field and outside Shoo's own UI, a middle-button press, or a press on the root element (its scrollbar, [unverified] live). While a YouTube dropdown is open it holds the page still: it cancels wheel events and puts the scroll position back (`__restoreScrollPosition`, observed 2026-10-10).
- **Save** `document.activeElement` before opening a menu and **restore** it with `focus({ preventScroll: true })` after the job ends, success or failure. If the saved element is gone, blur the active element instead.
- **Yield to scrolling.** A scroll (as above) between the menu button click and the item click closes Shoo's own dropdown at once, with Escape from a window capture listener that runs before YouTube's document listeners. Shoo restores focus, waits for a quiet page and starts the job again from step 1. Nothing was clicked, so the job is neither stale nor failed. Cancellation and navigation still apply while it waits.
- **Never move the page (scroll guard).** YouTube calls `focus()` without `preventScroll` twice around a Native action (Chrome, 2026-10-10), both from animation frame callbacks. `tp-yt-iron-dropdown` gives focus back on close to the element focused when the menu opened (`_applyFocus`). The "Video removed" placeholder focuses its first button (Undo) one animation frame after it renders (`notification-multi-action-renderer`, kevlar `_.W0`). Chrome and Firefox scroll that element into view, and centre it when it was fully out of view, so the page jumped on its own after youtube.com opened (observed 2026-10-10). From the menu button click until 10 animation frames after the job (`TIMING.guardFrames`), when focus lands on the element focused when Shoo opened a menu, or inside a placeholder of a Tile Shoo acted on, Shoo scrolls back (`behavior: 'instant'`) to the last position the document's `scroll` events reported, before the frame paints. In a window with system focus `focusin` fires inside the `focus()` call, after the scroll, and Shoo scrolls back in a microtask. In a visible window without system focus (the user works in another app or on another screen) Chrome still scrolls and moves `document.activeElement` but fires no focus events (observed live 2026-10-10: the page jumped to centre Undo on a signed-in Home page). Shoo then compares the deep active element with the last one it judged: in a `ResizeObserver` notification re-armed every frame, which comes after the frame's animation frame callbacks and before it paints; on the document's `scroll` event before that position counts (a focus call from a task); and right before Shoo moves focus at the end of a job. Shoo's own focus calls count as judged. By a frame's end the `scroll` events have reported all of the user's scrolling (measured), so there the page always goes back. At the other two points it goes back only if the user has not scrolled (as in "the user scrolled" above) since the last `scroll` event or frame end. Measured in Chrome in both window states: no painted frame shows the moved position. A hidden tab draws no frames, so the guard outlasts it. Focus that YouTube put in the placeholder goes back to the element that had it just before, or blurs. Shoo leaves alone focus changes made in the same task as a user pointer or key press, its own `preventScroll` focus calls, and focus moves to any other element. `yt-navigate-start` ends the guard. Known limit: when content above the viewport grows in the same frame as YouTube's focus call, going back to the reported position shifts that content, where scroll anchoring alone would have held it (measured on a test page, unmeasured on YouTube).
- Escape is dispatched only while the dropdown Shoo opened is the open one, as a `keydown` on the focused element inside that dropdown.
- Keyboard events inside Shoo's shadow roots call `stopPropagation()` so YouTube hotkeys (Space, k, j, l, /) never fire from a chip. This is implemented in the UI layer (`docs/spec/ui-design.md`, In-page UI) and tested in the harness.

### Steps and timeouts

1. **Precheck.** The Tile element is connected, still shows the same video ID, is not inside a `[hidden]` subtree (a dismissed Shelf may keep its Shorts), is not the playing video and not inside `ytd-playlist-panel-renderer` (checked again here because a watch-to-watch navigation changes the playing video but keeps the page element), is not already replaced (`.ytDismissibleItemReplacedContent` absent in `actionRoot`), and the page and URL are still those the job was created on. The background re-validation also passes: Mode is still Auto (or the job came from a Review click), Shoo is enabled, and no Keep rule or Exception now covers the video (architecture.md, Mid-flight changes). Otherwise drop the job as `stale` (not a failure).
2. **Clear Shoo's own leftovers.** If the dropdown Shoo opened for a previous job is still open, press Escape on it and wait 50 ms, then repeat the cancellation check, the local precheck and focus safety before opening the next menu (Shoo may have been turned off, the Mode changed or the user acted meanwhile). Never close a dropdown the user opened (focus safety waits for it instead).
3. **Open the menu.** `menuButton(tile).click()`. Synthetic clicks (`isTrusted=false`) are accepted by YouTube (live test).
4. **Wait for the dropdown, up to 1.5 s.** The dropdown is one reused `tp-yt-iron-dropdown` inside `ytd-popup-container`. It is open only on positive evidence: `aria-hidden` is not `"true"`, its computed `display` is not `none`, and it holds menu items. `aria-hidden` decides between open and closed (a closed dropdown keeps `display:block` and its full height), but in a hidden tab YouTube removes `aria-hidden` and leaves the dropdown `display:none` with the previous items until a frame renders (live test 2026-10-10). Because it is reused, also require evidence that it opened for this click, so you never act on the previous Tile's menu. Either its first item element or its `style.top`/`style.left` changed since the click, or it was closed at the click and its content changed since: a `childList` or `characterData` mutation anywhere inside it. Attribute changes (`aria-hidden`, `style`, `tabindex`) happen on any opening and do not count. YouTube keeps the item elements and re-renders them in place, and the menu of a Tile below the viewport is clamped to the viewport's bottom edge (`top: innerHeight - 24px`, height 0), so consecutive menus for Tiles below the fold share position and items (observed 2026-10-10). If the dropdown Shoo's click opened cannot be confirmed within 1.5 s, press Escape on it (unless the pointer was pressed since the click) before failing at `openMenu`. Never leave it open holding focus and the page still.
5. **Find the item, polling every 100 ms for up to 3 s.** Icons render lazily (the SVG appeared about 1 s after opening in a hidden tab, and the `span.yt-icon-shape` is empty before that). For each visible `yt-list-item-view-model` (sheet menu) or `ytd-menu-service-item-renderer` (legacy menu):
   - Not interested: any `path[d]` containing `8.246 12.605L4.755 6.661`
   - Don't recommend channel: any `path[d]` containing `Zm4 8H8a1 1 0 000 2h8`
   - Match on these substrings only. The first 40 characters of the path are shared by Watch Later, Not interested and Don't recommend channel.
   - Match by icon, never by position. Not interested was item 6 on Home and Watch and item 2 on the Shorts shelf.
6. **Text fallback after the 3 s poll.** Compare the item text (`.ytListItemViewModelTitle`, or `yt-formatted-string` in the legacy menu), lowercased and trimmed, against the built-in localized label lists below. There is no user-editable label list.
7. **Click** `[role="menuitem"]` inside the matched item (a `button` in sheet menus, `tp-yt-paper-item` in legacy menus).
8. **Confirm, up to 2 s.** `actionRoot(tile)` must contain `.ytDismissibleItemReplacedContent` (observed 15 to 20 ms after the click). On success send `reportActionResult` (architecture.md, Messages) and keep watching `actionRoot` for Undo (Section 5).
9. **Hidden mid-job.** If `document.hidden` was true at any point between clicking the menu button and a step's timeout, the timeout says nothing about YouTube (no frames are drawn): press Escape on Shoo's own dropdown if it is open, restore focus, and drop the job as `stale`, not failed. Switching tabs never counts toward the `nativeAction` breaker or the markup check. The pipeline queues it again once visible while the Verdict holds, like other stale Auto jobs; a Review Remove shows its chip again.
10. **Failure.** If any step times out in a tab that stayed visible: press Escape on Shoo's dropdown, restore focus, leave the Tile visible, and send `reportFailure` with `category: 'nativeAction'`, the step name and `selectorVersion`. The background counts consecutive failures per category and decides when to trip (architecture.md, Failure counters). The first failures produce a "Shoo couldn't use YouTube's menu" notice, never "paused" (REQ-ACT-3, REQ-COST-4).

Localized label fallback (extend as languages are verified):

```ts
export const NOT_INTERESTED_LABELS = ['Not interested', 'No me interesa', 'Pas intéressé', "Ça ne m'intéresse pas", 'Kein Interesse', 'Non mi interessa', 'Não tenho interesse', '興味なし', '관심 없음', '不感兴趣', '不感興趣', 'Не интересует', 'Geen interesse', 'Brak zainteresowania', 'لست مهتمًا'];
// Don't recommend channel: only "Don't recommend channel" is verified (en-GB). Add others only after observing them.
```

Never log or store anything from YouTube's page data such as `feedbackToken` or `undoToken`.

## 5. Undo (REQ-ACT-4)

Observed placeholder on the Watch sidebar (fixture `watch-removed-placeholder.html`):

```
yt-lockup-view-model (same element as before, the actionRoot)
  div.ytDismissibleItemReplacedContent
    div > notification-multi-action-renderer.ytNotificationMultiActionRendererHost
      span.ytNotificationMultiActionRendererTextContainer   "Video removed" | "We won't recommend videos from this channel to you again"
      div.ytNotificationMultiActionRendererButtonContainer
        div > button-view-model > button   "Undo"  (first, Tonal)
        div > button-view-model > button   "Tell us why" (Not interested) | a "Learn more" (Don't recommend channel)
```

Home and Shorts shelf placeholders were captured live on 2026-10-10 (fixtures `home-removed-placeholder.html`, `home-removed-channel-placeholder.html`, `shorts-removed-placeholder.html`). Home uses the same structure as the Watch sidebar inside its `yt-lockup-view-model` (`ytDismissibleItemAspectRatio16By9`). Don't recommend channel shows "We won't recommend videos from this channel to you again" with `Undo` (a `button`) and `Learn more` (an `a`). The Shorts placeholder (`ytDismissibleItemAspectRatio2By3`) sits in `ytm-shorts-lockup-view-model-v2` and offers only `Undo`. In every variant Undo is the first `button` in the button container, and Undo restores the same `actionRoot` element with fresh children. Timings in a background tab (throttled timers): menu open about 0.6 s, icon present when the menu opens, placeholder 1.0 to 1.7 s after the click on the menu button, Undo restored in 0.45 to 1.0 s.

- **Shoo's Undo** (from the batch summary, Activity via the background's `undoRemoval` message, or the removed-Tile annotation): click the first `button` in `.ytNotificationMultiActionRendererButtonContainer` inside `actionRoot`. Language-independent by position in both variants. Confirm within 2 s that `.ytDismissibleItemReplacedContent` is gone and the original content is back in the same element (observed about 15 ms). Then report `undone` and ask the background to add an Exception (REQ-EXC-1).
- **Availability.** Undo was still enabled 62 s after removal. Treat it as available while the `actionRoot` is connected and still shows the placeholder. After navigation the placeholder is gone and UI Undo is impossible: the background marks Activity rows as "Undo expired" and offers Keep (Exception only) instead.
- **YouTube's own Undo.** For each Tile Shoo removed, keep the `actionRoot` observer (Section 2) until navigation, which starts at `yt-navigate-start`. When `.ytDismissibleItemReplacedContent` disappears without Shoo clicking Undo, the user used YouTube's button: report `undone` and ask for an Exception, exactly like Shoo's Undo. It counts as Undo only when the `actionRoot` is still connected, its page is still the visible page, the URL is unchanged since the Removal, and the element shows the same video's content again. Anything else ends the watch without a report: navigating away is never Undo (live test 2026-10-10).
- "Tell us why" and "Learn more" are never clicked.

### The user's own Don't recommend channel (REQ-ACT-5, `src/youtube/user-ban.ts`)

When the user picks Don't recommend channel on a Tile themselves, the content script sends `banChannel` with the Tile's facts and the background adds the channel as a Banned channel (architecture.md, Messages). Shoo's own clicks are synthetic (`isTrusted` false, Section 4, step 3), so only trusted clicks count. One `click` capture listener on the document exists while the pipeline runs (Shoo on), and it does nothing for clicks outside Tile menu buttons and dropdowns.

1. **Which Tile's menu.** A trusted click inside `menuButton(tile)` of a Tile the watcher knows (enabled Surface, visible page) remembers that Tile and its `extract()` facts, when the Surface offers Don't recommend channel (`home`, `watchSidebar`). Any click on a Tile menu button by Shoo (untrusted), a Shorts shelf menu button, or any other trusted click outside a dropdown forgets it, so Shoo's own menu is never taken for the user's.
2. **Which item.** A trusted click inside a menu item (`yt-list-item-view-model`, `ytd-menu-service-item-renderer`) of a `ytd-popup-container tp-yt-iron-dropdown` counts when the item matches Don't recommend channel by icon path, or by label (Section 4, steps 5 and 6) while the icon has not rendered. Every trusted item click forgets the remembered Tile.
3. **Confirm, up to 2 s.** The remembered Tile still shows the same video, and its `actionRoot` gets `.ytDismissibleItemReplacedContent`. Only then is `banChannel` sent. This proves the menu belonged to that Tile.
4. **Undo.** The queue keeps the same `actionRoot` observer as for Shoo's Removals (`watchRemoval`, job origin `'user'`). YouTube's Undo there sends `liftChannelBan` when `banChannel` answered `added: true`, never `reportUndo`: the Removal was the user's, so there is no Exception. The video is kept in this tab like any undone Removal.

Known limits: a menu item chosen with the keyboard counts only when the browser turns the key press into a trusted `click` (a `button` in sheet menus does) [unverified live]. Nothing is detected in a private window, on Surfaces Shoo does not watch, or while Shoo is off.

## 6. Mounting Shoo's in-page UI

- **Never inside the thumbnail link.** `a.ytLockupViewModelContentImage` and `a.shortsLockupViewModelHostEndpoint` are `aria-hidden="true" tabindex="-1"`, so anything inside them is hidden from assistive technology, and clicks would navigate. Mount outside them.
- **Host element.** One `<shoo-chip-host>` per decorated element, appended as the last child of `mountParent(tile)` (table in Section 1), with an open shadow root. The host uses `position: absolute` and is placed over the bottom-left of `thumbnail(tile)`: compute `left` and `top` from `thumbnail.getBoundingClientRect()` minus `mountParent.getBoundingClientRect()`, inset 8 px, and recompute with a `ResizeObserver` on the thumbnail. Only the chip itself takes `pointer-events`. While the thumbnail has no box (not laid out yet, or its page is hidden) the host stays hidden and keeps its variant, and the first real size decides the variant and position (live test 2026-10-10).
- **Shorts shelf chips use the page-level overlay.** After about 1 s of hover, YouTube plays a muted preview in `ytd-video-preview`, a page-level element outside the Tile drawn over the thumbnail, and a click there opens the Short (live test 2026-10-10). No `z-index` on a host inside the Tile can rise above an element outside the Tile's stacking context, so Shorts shelf chips mount in the page-level overlay (below), whose `z-index: 2000` competes at page level. Home lockups play their preview inside the lockup and keep the in-Tile host. [unverified] the computed `z-index` of `ytd-video-preview` and of the masthead: the fixtures carry no CSS, so re-check in a visible tab that the chip stays clickable over the preview and scrolls under the masthead (Section 8 checklist). Trade-off: an overlay chip comes last in the tab order instead of at the Tile's position.
- **Containing block.** This requires `mountParent` to be a containing block (computed `position` not `static`). Checked live on 2026-10-10: `.ytLockupViewModelHost` on Home and `ytm-shorts-lockup-view-model` on the Shorts shelf are `position: relative`. If it is `static`, use the fallback: a single page-level overlay layer (`<shoo-overlay>`, `position: absolute` in document coordinates, appended to `document.body`) that positions each chip from the thumbnail's document rect, updated by a `ResizeObserver` on the thumbnail and on `document.body` (content inserted above the Tile) and on `yt-navigate-finish`. The same layer holds Shorts shelf chips and the removed-Tile annotation. Never set `position` on YouTube's elements.
- **Badge clearance.** YouTube draws its duration badge (`badge-shape` inside `yt-thumbnail-bottom-overlay-view-model`, 36 to 42 px wide, 18 px tall, inset 4 or 8 px, observed 2026-10-10) at the thumbnail's bottom-right. Shoo reads the left and top edge of every `badge-shape` over the bottom half of `thumbnail(tile)` (a "New" or LIVE badge at the top-left is ignored) and never covers them: the host's `max-width` is the room left of the badges minus an 8 px gap (with no badge, the anchor width minus 16 px minus a 64 px zone). It measures the content's narrowest width (`width: min-content` while `data-measuring` lets the truncatable Rule text count as zero) and, when that does not fit, places the host's bottom edge 8 px above the badges at the anchor width minus 16 px. The host is `width: max-content`, so it sizes the same in the 0 px wide page-level overlay. A `ResizeObserver` on the host re-runs the placement when its content changes (variant flip, kept note). Never restyle or hide YouTube's badges.
- **Compact chip.** When `thumbnail(tile)` is narrower than 320 px (the Watch sidebar at most window sizes, the Shorts shelf, Home with 5 or more Tiles per row), render the compact chip variant from `docs/spec/ui-design.md` (eyes, Rule ref, two icon buttons of at least 24 px, full text in the accessible name). Re-evaluate on resize. There is no "move below the metadata" option: Shoo never changes YouTube's layout.
- **Disposable hosts.** YouTube swaps the inner content of the `actionRoot` on removal and on Undo, and re-renders Tile content on its own (Back navigation, feed updates), which destroys anything mounted inside it or replaces the thumbnail a host tracks. Each host watches the ancestor chain of its host and anchor up to the Tile (`childList`, no subtree). When the host or anchor is gone, Shoo drops it and mounts the chip or label again from `judged` (no new request), or treats the element as a new Tile when it now shows another video. A watcher scan, navigation or rescan that meets a decorated Tile without its UI does the same. `reviewPending` counts only chips that are showing (live test 2026-10-10).
- **Removed-Tile annotation.** Mounted in the page-level overlay while `.ytDismissibleItemReplacedContent` exists, never inside YouTube's placeholder, so it takes no layout space (live test 2026-10-10: inside the placeholder it grew Home's placeholder from 264 to 296 px and sat on "Tell us why", and on the Shorts shelf on Undo). It reads as part of YouTube's card, so the annotation and the placeholder look like one thing. YouTube's card is `notification-multi-action-renderer` with a 1 px outline, 8 px radius and 20 / 12 / 8 px padding, a centred stack of sentence and buttons (measured live on the Watch sidebar 2026-10-10: a 475 × 168 placeholder, buttons 13 px in from each side, Undo 61 px from the top, 12 px between buttons). Placement:
  - **Column.** The host spans YouTube's content column: from the card's left outline and padding to its right ones, the same edges as Undo and "Tell us why". Without measurable card styles it falls back to an 8 px inset.
  - **Band.** The band is measured from just inside the card's top outline to the visible "Video removed" text (`.ytNotificationMultiActionRendererTextContainer > *`; its container is `flex: 1` and starts right under the 20 px padding). Where the band leaves at least 8 px above and below the annotation, the annotation sits centred in it, so the air above it equals the air down to YouTube's sentence, which stays visible (among the placeholder fixtures only the Shorts shelf has such a band).
  - **Cover.** Otherwise (the Watch sidebar, Home at 411 px and below, and the "Don't recommend channel" card, whose sentence wraps) the host gets `data-cramped`, `--shoo-cover` and `--shoo-ground`: it covers the whole room from inside the card's top outline to 4 px above YouTube's first placeholder button or link, with its lines centred in it, over YouTube's sentence. The cover is painted in the colour YouTube paints behind its card, so no patch shows: the first opaque background up the tree from `notification-multi-action-renderer` (`rgb(15, 15, 15)` on `ytd-app` in dark mode), with any see-through fills on the way blended over it. Paper is only the fallback. It is read once per theme, and the in-page UI places annotations again when YouTube switches theme. If YouTube's sentence overflows above the card (Home at 5 or more Tiles per row), a strip as wide as the sentence covers it above the card's outline (`--shoo-cap`), since YouTube already paints there, and the outline beside it stays. If no button or link is measured, the cover ends at the sentence's last line, so it never reaches an action Shoo could not find.
  - **Title line.** With the annotation's second line (the removed video's title and channel, `ui-design.md`), the annotation is measured at the column's width. When two lines are taller than the room inside the card, the host gets `data-tight`, the CSS folds the title into line one (or drops it on the channel placeholder), and the host is placed again as one line. When even that is taller than the room, it also gets `data-min` and "Shooed by" goes (the screen-reader sentence keeps it).
  - **Fallback.** With no measurable sentence, or a button that is not below the sentence (unknown markup), the host sits 8 px below the placeholder's top with no cover, as before, so it never paints over an action or through the sentence.

  The host also reports `channel` when the placeholder's second action is the "Learn more" link (the "Don't recommend channel" variant above), and the line then reads `Channel shooed by`. The host takes no pointer events, only Shoo's buttons do. It follows the placeholder with a `ResizeObserver`, hides while the placeholder has no box (its page is hidden), and is removed when YouTube removes the placeholder. Checked in a rendered fixture gallery on the three placeholder fixtures plus `home-removed-channel-placeholder.html` at 475, 411, 402, 360, 300, 241 and 210 px, light and dark: two lines everywhere except folded at Home 241 and dropped at channel 241, no overlap with YouTube's buttons, no cut line of YouTube's text (2026-10-10).
- **Never change YouTube's layout**: no margins, no changes to YouTube's elements' styles or attributes, no wrappers around YouTube nodes, no `aria-*` attributes on YouTube's elements. The Dry-run label's text lives inside Shoo's shadow root in reading order (`docs/spec/ui-design.md`).
- **Focus return.** Esc inside a chip returns focus to `focusReturn(tile)` (Section 1 table). The Shorts target `a.shortsLockupViewModelHostOutsideMetadataEndpoint` carries no `tabindex` or `aria-hidden`, so it is focusable (checked 2026-10-10).
- The batch summary and error notice mount once per page in a host appended to `document.body` with `position: fixed`.
- Theme: read `document.documentElement.hasAttribute('dark')` (observed live) and observe `attributes: ['dark']` on `<html>` to switch Shoo's tokens live.
- Miniplayer: `ytd-miniplayer` always exists. When it is not shown it has only `class` and `style` and computes to `display: none` (2026-10-10). Treat it as visible when its computed `display` is not `none` and its rect has a height, and lift the summary above it.

## 7. Resilience

- **Selector versioning.** Each `SurfaceDef` carries `selectorVersion`. Failure reports carry it so a markup break is attributable in Activity.
- **Markup self-test.** When a supported Surface becomes active, verify within 5 s that at least one container resolves and at least one Tile yields a `videoId` and `title`. While the watcher still waits for a container (Section 2), a missing container is reported only when that wait ends: after 10 s of visible time. A failing check is never reported from a hidden tab (live test 2026-10-10: a Watch page in a background tab reported `watchSidebar.container` before YouTube drew the sidebar). On the first Native action of a page, verify the dropdown opened. A dropdown that did not open while `document.hidden` is not reported: the check waits for a later job. Each failed check sends `reportFailure` with `category: 'markup'`, each passing check reports success for that category. The background owns the counter and the trip rule (architecture.md, Failure counters). The pre-trip notice says "Shoo can't read this YouTube page" and never "paused". Never fall back to hiding.
- **Fixture refresh procedure** when YouTube changes markup:
  1. Open the affected Surface in a signed-in desktop browser.
  2. In DevTools, clone the Tile (or open menu) node and sanitize it in page before copying: titles to `Fixture title N`, channel names to `Fixture Channel N`, handles to `@fixturechannelN`, video IDs to fake 11-character IDs such as `FIXTUREvid1` used consistently within a Tile, channel IDs to `UCFIXTURE000000000000001`, every image `src`/`srcset` to `https://example.invalid/img.jpg`, ad links to `https://example.invalid/link`, remove `pp=` tracking parameters and any tokens. Keep tag names, classes, ids, aria attributes and svg paths. If the browser tooling blocks copying attributes with query strings, capture a structural skeleton instead (tags, `class`, `role`, `aria-*` only), as done for `watch-removed-placeholder.html`.
  3. Drop irrelevant subtrees (inline preview players, hover overlays) and leave an HTML comment saying what was dropped. Keep each file under about 30 KB.
  4. Start the file with `<!-- captured <date> from youtube.com <surface>, lang=<lang>, anonymized -->`.
  5. Run the fixture tests, fix selectors in `surfaces.ts`, bump `selectorVersion`.
  6. Scan the new files for real names or IDs before committing.

## 8. Test plan

- **jsdom fixture tests** (`// @vitest-environment jsdom`), one per fixture: the registry finds the Tile, `extract()` returns the expected `TileFacts` or `null` (ads, radio Tiles, duration-less non-live Tiles), `isArtistChannel` is read from the icon path whatever the label's language and from the label when the icon is missing, and is absent without the badge or with a Verified badge, `channelBadgePending` is true only for an unrendered channel-row icon with an unknown or missing label, `viewCount` is read from each Surface's fixture and is absent for a live Tile or a label in another language, `actionRoot`, `thumbnail`, `mountParent`, `menuButton` and `focusReturn` resolve, the icon-path matcher picks the right item in `home-menu.html`, `watch-menu.html` and `shorts-menu.html` and finds nothing in `search-menu.html` and `channel-menu.html`.
- **Composed page fixture** `test/fixtures/youtube/page-home.html` and `page-watch.html`, built by a documented script from the single-Tile fixtures: a `ytd-page-manager` with one visible page and one `hidden` page holding decoy Tiles, a rich grid `#contents` with several Tiles, a `ytd-rich-section-renderer` holding a Shorts shelf, a continuation batch appended later, and a Watch sidebar `#contents`. Used by watcher tests and the extraction benchmark. Record how it was composed in an HTML comment at the top.
- **Badge wait** (watcher tests, fake timers): a channel-row icon with a non-English label that renders 300 ms late sends the Tile once, with `isArtistChannel`, and not before. One that never renders sends it once after 1.5 s without the flag. Hidden time does not count. A Verified badge (rendered in any language, or unrendered with its en-GB label), no badge, and an unrendered icon with the en-GB Artist label send at once. A rebind, leaving the eligible area, leaving the page and `stop()` end the wait without a send, a Tile reused for another video starts its own wait, and a moment without a readable video ID keeps it.
- **SVG-delay harness helper** `withLazyIcons(menuEl, delayMs)`: strips every `<svg>` from a menu fixture and re-inserts them after `delayMs`, to reproduce YouTube's lazy icons (the menu fixtures already contain the SVGs).
- **Simulated YouTube harness** (`simulateYouTube` in `src/youtube/test-harness.ts`): load a Tile fixture and a menu fixture, wire the menu button to reveal the reused dropdown after a delay, apply `withLazyIcons`, and on item click swap the `actionRoot` children for the placeholder fixture. Test: happy path for both actions, lazy icons, text fallback, stale reused dropdown, timeouts at each step, Escape only on Shoo's dropdown, focus saved and restored, waiting while a user dropdown is open or focus is in an input, Undo by Shoo, YouTube's own Undo detection, queue serialization (two jobs never overlap), pause while hidden, one Native action per `videoId` with duplicate copies annotated, element reuse with a changed video ID unmounting the chip. The user's own Don't recommend channel (`userClick` in the harness gives a trusted click through a label): reported on `home` and `watchSidebar` once the placeholder shows, not for untrusted clicks, not after Shoo opened a menu, not for Not interested.
- **Benchmark**: extraction (`extract()` plus `channelBadgePending`, the watcher's first read of a Tile) over the composed Home page fixture ×50, compared against a stored Vitest bench baseline (relative regression check). Absolute per-Tile timing is to be measured manually on real hardware before release (architecture.md, Performance budgets).
- **Manual live checklist** (before each release, signed-in account with a populated Home feed that the tester is willing to change):
  1. Home, Watch sidebar and Shorts shelf each produce chips in Review mode, compact on narrow thumbnails.
  2. Remove on a Home Tile shows YouTube's placeholder, Shoo's annotation, and Activity records it.
  3. Undo from Shoo's summary restores the Tile and creates an Exception.
  4. YouTube's own Undo is detected on Home and on the Watch sidebar.
  5. Don't recommend channel on a Banned channel Tile.
  6. Search, Channel pages and End screens show nothing and stay idle.
  7. Currently playing video and ads are never chipped.
  8. Hidden-tab behaviour: actions wait until the tab is visible.
  9. Auto mode never closes a menu you opened, never moves focus out of the search box, and YouTube hotkeys do not fire from chips.
  10. Shorts shelf: hover a chipped Short for 2 s, then click the chip's Remove: it removes the Short instead of opening it (chip above `ytd-video-preview`). Scroll the shelf under the masthead: chips and annotations pass under it.
  11. Removed-Tile annotation on Home, the Shorts shelf and the Watch sidebar: YouTube's Undo and "Tell us why" stay fully clickable, and the placeholder keeps its height.
  12. Dark and light theme switch live.
  13. Auto mode with a Rule matching Tiles below the fold, on Home and on the Watch sidebar: the page never moves by itself while Shoo removes them. Wheel, key and touch scrolling during a batch work at once and are never undone. Focus never stays on a placeholder's Undo, and no menu stays open. Repeat after scrolling down, so removed Tiles are above the viewport.
  14. Pick Don't recommend channel yourself on a Home Tile and on a Watch sidebar Tile, with the mouse and with the keyboard: the channel appears under Banned channels and in Activity. YouTube's Undo on the placeholder removes it again.
  15. Shelf dismissal (Section 10): with the Shorts shelf switch on, in Auto and in Review, Home's Shorts shelf is dismissed once, the page does not move, focus does not stay on YouTube's notice, and Activity shows "Shelf dismissed". The same for the games shelf. Capture the fixtures listed in Section 10 at the same time.
  16. Repeat in Firefox.

## 9. Subscribed channels (`src/engine/subscriptions.ts`, `src/core/subscriptions.ts`)

Read only for REQ-RULE-14, by the background, never by the content script.

- **Request.** `GET https://www.youtube.com/feed/channels` with `credentials: 'include'`, through the existing `https://www.youtube.com/*` host permission, with `redirect: 'error'` and a 20 s timeout (`engine/net.ts`). A redirect (signed out), a non-200 status, a timeout or a page without Subscribed channels is a failed read.
- **Page shape** (observed 2026-11-04 in a signed-in Chrome, same-origin fetch from a youtube.com page): about 11 MB of HTML for 1,000 channels, with no continuation items. `var ytInitialData = {...};</script>` holds one `channelRenderer` per channel, with `channelId`, `navigationEndpoint.browseEndpoint.canonicalBaseUrl` (`/@handle`) and `subscriptionButton.subscribed === true`. Shoo also reads `title.simpleText` (or the first run of `title.runs`) as the channel name, because Watch sidebar Tiles show only a name.
- **Parse.** `parseSubscribedChannels` slices `ytInitialData` out of the page and runs `JSON.parse` with a reviver that keeps only the id, the handle (decoded, lowercased, without `@`) and the ChannelKey of each subscribed `channelRenderer`. The page string is dropped when the read returns, and only the sorted, deduplicated channel keys are stored (`local:subscriptions`, `architecture.md` Section 8).
- **Not verified.** The page was read live only through a same-origin fetch in Chrome. Whether a background fetch carries the YouTube session on Chrome (service worker) and on Firefox (event page, Total Cookie Protection) is not checked yet. When it does not, every read fails and the fail safe in `architecture.md` Section 5 holds the Tiles. Accounts with many more channels may get continuation items, which Shoo does not follow, so channels past the first page count as not subscribed.
- **Tests.** `src/core/subscriptions.test.ts` parses a synthetic page shaped like the observed one (no captured fixture), `src/engine/subscriptions.test.ts` covers the refresh and back-off.

## 10. Shelf dismissal (`src/youtube/shelves.ts`, REQ-ACT-6)

A Shelf dismissal performs a Shelf's own dismiss control on Home for a Shelf the user switched on in Settings (`settings.shelfDismissal`). It acts on the Shelf as a whole and is separate from the `shortsShelf` Surface, which judges the Shorts inside a Shelf one by one. Both can run on the same Shelf: Tile jobs and the Shelf dismissal share the queue, so they never overlap.

**Fixtures.** The Shorts shelf header and its menu were captured live on 2026-11-04 (`home-shorts-shelf-header.html`, `home-shorts-shelf-menu.html`; `useCapturedShortsShelf` in `test-harness.ts` puts the header on `page-home.html`'s Shorts). No captured fixture shows a dismissed Shelf or a games shelf on Home: three Home loads of up to 320 Tiles showed none. Everything marked [unverified] below is a guess to check against live markup, and those tests use SYNTHETIC markup (`addSyntheticShelfControl`, `addSyntheticGamesShelf`, `wireShelf`, `syntheticShelfMenu`). "Show fewer games" comes from what the user reported seeing on youtube.com.

| Role | Selector or rule | Status |
|---|---|---|
| Shelf | `ytd-rich-grid-renderer > #contents > ytd-rich-section-renderer ytd-rich-shelf-renderer`, on the visible Home page only | verified for the Shorts shelf (`page-home.html`), [unverified] for the games shelf |
| Shorts shelf | the Shelf has `is-shorts` | verified |
| Games shelf | a Tile in the Shelf links to `a[href^="/playables"]`, else the Shelf's `#title` reads "YouTube Playables" or "Playables" (`GAMES_TITLES`) | [unverified] on Home. Game Tiles on `/playables` link to `/playables/<id>` from `ytd-mini-game-card-view-model` inside `ytd-rich-item-renderer` (observed 2026-11-04) |
| Shelf buttons | `button, [role="button"]` inside the Shelf and outside its `#contents` and its `ytd-rich-item-renderer` Tiles | verified for the Shorts shelf: the header menu button, plus hidden "Show more" and "Show less" buttons that match neither rule below |
| Direct dismiss control | a Shelf button whose `aria-label`, else `title`, else text is one of `SHELF_LABELS` for that Shelf ("Show fewer Shorts", "Show fewer games") or `NOT_INTERESTED_LABELS` | the Shorts shelf has none (verified), [unverified] for the games shelf |
| Shelf menu button | else a Shelf button matching `ytd-menu-renderer button, #menu button, button[aria-haspopup]` | verified for the Shorts shelf: `#rich-shelf-header #menu ytd-menu-renderer yt-icon-button > button#button`, `aria-label="Shorts – More actions"`. [unverified] for the games shelf |
| Menu item | in the reused dropdown (Section 4): first an item whose text is one of the Shelf's `SHELF_LABELS`, else the Not interested icon (`8.246 12.605L4.755 6.661`), polled while icons render (3 s), then the `NOT_INTERESTED_LABELS` text fallback | verified for the Shorts shelf: the menu holds one `ytd-menu-service-item-renderer` with the text "Show fewer Shorts" and a circled-X icon (`M12 1C5.925 1 1 5.925`), which is not the Not interested icon, so the label matches first. [unverified] for the games shelf |
| Dismissed | the Shelf is disconnected, or its `ytd-rich-section-renderer` holds `.ytDismissibleItemReplacedContent`, `notification-multi-action-renderer` or `ytd-notification-multi-action-renderer` outside its Tiles (a removed Short carries the same placeholder class inside its own Tile, verified in `shorts-removed-placeholder.html`), or the Shelf's `#dismissible` has `hidden`, or the Shelf holds no Tile | [unverified]. The captured Shelf has an empty `div#dismissed` beside `#dismissible`, where YouTube's notice likely goes [inf] |
| Focus scope | the Shelf's `ytd-rich-section-renderer` (the Shelf itself without one): focus inside holds the job, and focus YouTube moves into it during the job goes back (scroll guard) | [inf] |

Flow:

- **Watcher.** The content pipeline creates the Shelf watcher only while Shoo runs and at least one Shelf is switched on, and drops it otherwise (REQ-QUAL-2). It offers Shelves only while the Mode acts (Auto or Review, Native actions not tripped). In Dry-run or with the breaker tripped it stays, offering nothing, so what this page already dismissed is remembered across Mode changes. It binds on `yt-navigate-finish` and `yt-page-data-updated`: on the visible Home page it waits up to 10 s (20 tries, 500 ms apart) for the Home grid `#contents`, observes it with one `childList` observer, and scans for Shelves at once, on every mutation, and five more times 1 s apart after each, because a Shelf's heading and Tiles render after the Shelf is added.
- **Once per Shelf kind per page.** A Shelf is offered to the queue only when it holds a Tile and its control is found. Each kind is offered once per page: a later Shelf of the same kind on that page, or the same Shelf after the user pressed YouTube's Undo, is left alone. A navigation to another page or URL starts over. YouTube fires both navigation events for one navigation, so an event that leaves the page and URL unchanged keeps what was tried. A job that ends `stale` or `cancelled` (the page changed, Mode left Auto, the tab was hidden) gives the kind back and the watcher offers it again on its next scan.
- **Queue job.** `shelfTarget(shelf, id, precheck)`: the local precheck requires the Shelf to still be there, not dismissed, with its control, on the same page and URL. The background precheck (`getRuntimeState`) requires Shoo on, Native actions and in-page stages allowed, Mode not Dry-run, and that Shelf still switched on. A direct control is clicked and confirmed (step 8) without a dropdown. A menu button follows steps 3 to 8 of Section 4 with the menu item rule above.
- **Fail safe.** No control found means the Shelf is never offered. A job that fails (`openMenu`, `findItem`, `clickItem`, `confirmPlaceholder`) presses Escape on Shoo's own dropdown and restores focus like a Tile job, and it is not reported: no `reportFailure`, no `nativeAction` count, no markup check, no notice, so an unverified Shelf selector never trips a breaker or pauses Tile work (ADR 0010). The kind counts as tried for that page.
- **Success.** Content sends `reportShelfDismissal({ shelf })`, and the background writes one `shelfDismissed` Activity event (`surface: 'home'`, `shelf`). It counts no Removal. Shoo offers no Undo of its own: YouTube's notice in the Shelf keeps its Undo.

Fixtures still to capture (signed in, en-GB, a Home page that shows the Shelf): the dismissed Shorts shelf (`home-shorts-shelf-dismissed.html`), and the header, menu and dismissed state of the games shelf. Then replace each [unverified] row above and drop the guesses that did not hold.
