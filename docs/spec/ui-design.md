# Shoo UI design spec

Design direction: **Quiet Ink, Loud Moments**, with the **Living Wordmark** eyes as the logo.

- Product record: `PRODUCT.md`. Glossary for every label: `CONTEXT.md`.
- This spec and `DESIGN.md` are the UI references. Where they disagree on tokens, behaviour or accessibility, **this spec wins**. The shipped build is the reference for composition and feel, and `DESIGN.md` records it.
- Runtime states, Mode transitions and messages are defined in `docs/spec/architecture.md`. Mount anchors ("Mounting Shoo's in-page UI"), `actionRoot` and focus safety on YouTube are defined in `docs/spec/youtube-integration.md`. This spec covers what the user sees.
- `DESIGN.md` is generated from the build with impeccable's documenter, not written by hand.

## 1. The idea

Shoo lives next to YouTube, so it stays calm: ink on near-white (or its exact inversion), compact ruled rows, no decoration. **Colour belongs only to Rules.** Every Rule owns a colour code, and wherever a Verdict appears (chip, Activity row, popup, summary) its swatch and the Rule's name show which Rule acted. The interface is loud only at **moments**: when Shoo acts, Rule colours burst into the batch summary and the logo's eyes blink once.

The **logo is alive**: the two o's of "Shoo" are eyes that show what Shoo is doing (watching, judging, waiting on you, paused, in trouble). It is the only character in the product.

Refuse (from `PRODUCT.md` and the craft floor): YouTube red or anything that looks like a YouTube control, generic SaaS cards and stat tiles, eyebrow labels above headings, gradient text, glass, emoji or Unicode glyphs as icons, colour used for anything other than Rules and errors.

## 2. Tokens

Define on `:root, :host` (the content-script UI lives in a shadow root). Dark is the exact inversion, not a separate palette. Contrast ratios below are computed with the WCAG 2.x formula against `--paper` of the same theme.

| Token | Light | Dark | Ratio vs paper (light / dark) | Use |
|---|---|---|---|---|
| `--paper` | `#FBFBFA` | `#121214` | | ground |
| `--ink` | `#121214` | `#FBFBFA` | 18.1 / 18.1 | text, primary controls, logo, focus ring |
| `--muted` | `#5E5E65` | `#A6A6AD` | 6.2 / 7.7 | secondary text |
| `--edge` | `#8A8A8F` | `#8A8A8F` | 3.3 / 5.5 | component boundaries that must be seen: input borders, outlined buttons, switch tracks, checkbox borders, the Dry-run label outline (WCAG 1.4.11) |
| `--stroke` | `#8A8A8F` | `#8A8A8F` | 3.3 / 5.5 | icons at rest, disabled outlines |
| `--line` | `rgb(18 18 20 / .11)` | `rgb(251 251 250 / .12)` | decorative | row rules only, never the only boundary of a control |
| `--line-strong` | `rgb(18 18 20 / .22)` | `rgb(251 251 250 / .24)` | decorative | table header rule, swatch ring |
| `--tint` | `rgb(18 18 20 / .035)` | `rgb(251 251 250 / .045)` | | hover, expanded rows |
| `--lit` | `rgb(18 18 20 / .06)` | `rgb(251 251 250 / .08)` | | "lit until seen" rows |
| `--danger` | `#C2410C` | `#FB923C` | 5.0 / 8.3 | errors only, as text |
| `--shadow` | `0 18px 48px -18px rgb(18 18 20 / .28), 0 2px 6px rgb(18 18 20 / .06)` | `0 18px 48px -18px rgb(0 0 0 / .7), 0 2px 6px rgb(0 0 0 / .4)` | | floating surfaces only (popover, summary, chip) |

States change by **inversion**: selected segment, pressed button and the active section are ink-filled with paper text. No accent colour for selection.

### Rule colour codes

Assigned in order when a Rule is created and stored with the Rule (never recomputed, so colours stay stable when Rules are deleted). Keep rules do not get colours (they show `K1`, `K2` in ink).

| Code | Hex | Code | Hex |
|---|---|---|---|
| c1 violet | `#6E4BFF` | c6 orange | `#FF8A3D` |
| c2 teal | `#00B39F` | c7 sky | `#2EA8FF` |
| c3 amber | `#FFB000` | c8 plum | `#B04BD8` |
| c4 pink | `#FF4FA3` | c9 olive | `#9A9A2E` |
| c5 lime | `#8BD100` | c10 slate | `#6B7A8F` |

After c10 the sequence repeats. Rule colour is **decorative**: text always sits beside the swatch and carries the meaning (WCAG 1.4.1), so the swatch needs no contrast minimum. Outside the Settings tables that text is the Rule's label: its Rule name, or its text when it has none (REQ-RULE-11), in its own `dir="auto"` run, with the full Rule text as its tooltip. On YouTube it is bold and the first text to shrink on every surface, to an ellipsis. The R-number names a Rule in the Settings tables and never shows on YouTube, because a number alone does not say what the Rule is. It shows as an 8 px square (radius 2) with a 1 px `--line-strong` ring, and as fills in the moment animation. Never set text in a Rule colour.

### Type

- **Extension pages** (popup, settings, onboarding): **Geist** (SIL OFL) for all UI text, **Bricolage Grotesque** (SIL OFL, opsz axis) for the wordmark letters and section headings, weights 700 to 800, tracking -0.025em to -0.03em. Numbers, including the popup's headline counts, are set in Geist. Bundle both as subset woff2 files in the extension. Never load fonts from the network.
- **In-page UI on YouTube** (chips, labels, annotation, summary, notices): the system UI font stack only, `system-ui, -apple-system, "Segoe UI", Ubuntu, sans-serif`, and the wordmark drawn as SVG. No `FontFace`, no bundled fonts, no `web_accessible_resources` (ADR 0006: single content bundle). The system stack still reads as distinct from YouTube's Roboto on macOS and Windows, and the eyes carry the identity.
- `font-variant-numeric: tabular-nums` on every count, cost and time, in both contexts.
- Scale (px): 12 meta and labels, 13 dense rows, hints and chips, 14 body, 15 sub-headings and section ledes, 16 inputs (every text field and select), 20 popup headline numbers, 30 section headings. No half-pixel sizes. Line height 1.35 for rows, 1.5 for prose.
- In the content script use **px, never rem**: YouTube sets `html { font-size: 10px }`.

### Space, shape, elevation

- 4 px base, in 4, 8, 12, 16 and 24 px steps, with 32 to 48 px only between page regions. Row height 40 px (dense lists). Hit targets: at least 44 px for the full chip, at least 24 px everywhere else including the compact chip and the popup (WCAG 2.5.8). The popup uses the Settings control sizes: a 30 px Segmented, and a 36 px field with a 36 px button beside it.
- Radii: 6 px controls, 10 px floating surfaces, 999 px only for small pills (Verdict pill, Mode segments). No card containers as page structure.
- One elevation method per element: rows use rules (`--line`), floating surfaces use `--shadow` with no border.
- Dark exception: on YouTube's `#0F0F0F` ground the dark shadow under a `#121214` panel barely shows, so in dark only the page-level floating panels (batch summary, notices, collapsed summary pill) add a 1 px `--line-strong` ring as the first layer of the same `box-shadow` (`0 0 0 1px var(--line-strong), var(--shadow)`). It is part of the shadow, not a border, so these panels still use one method. Chips float over thumbnails and keep the plain shadow.

### Focus

- Extension pages: 2 px `--ink` outline, 2 px offset.
- In-page UI: two-tone ring so it shows over any thumbnail, `box-shadow: 0 0 0 2px var(--paper), 0 0 0 4px var(--ink)`.
- Never removed, on every interactive element.

### Icons

Lucide (`lucide-preact`, tree-shaken) at 16 px, stroke 1.75, `currentColor`. No other icon sources except the logo. Chip icons: `ban` for Remove, `check` for Keep, `user-check` for "Always keep this channel" on the compact kept note. In-page icons are hand-copied Lucide paths, so the content bundle does not import `lucide-preact`.

## 3. The logo (living wordmark)

- Wordmark: "Sh" in Bricolage Grotesque 800, followed by two eyes that replace "oo". Eye = ink-stroked circle (stroke matches the letter stem weight) with a solid ink pupil. Eyes are ink on paper in every context, never coloured. In-page, the eyes are drawn alone as SVG (no letters, no web font).
- Toolbar icon: the two eyes alone, drawn for 16, 32, 48 and 128 px with a small hand-tuned pixel grid at 16 px. Set per state with `action.setIcon` (pre-rendered `ImageData`, no canvas work on every change).

| State | Eyes | When (runtime reasons are defined in `architecture.md`) |
|---|---|---|
| watching | open, pupils centred, slow idle drift (settings only) | Shoo on, nothing happening |
| judging | quick glance toward the Tile or list being judged | a batch is in flight |
| review | squint (lids at 40%) | Review chips are waiting for the user |
| paused | closed (single lid line) | Shoo off, daily cap reached, a failure category tripped |
| error | wide (pupils small, lids up) | connection, quota (402), revoked host or YouTube markup failure |

Behaviour:
- Settings and popup: pupils follow the pointer (lerp 0.18 per frame, max offset 30% of the eye radius), widen on the hovered Rule row, sweep left to right while the user types in Try a title.
- On YouTube: tiny eyes in chips are still except for one glance toward the Tile when its Verdict lands. The batch summary eyes blink once (lids 120 ms down, 80 ms up) when it appears.
- `prefers-reduced-motion: reduce`: no pointer tracking, no blink animation, states switch instantly.
- Accessibility: the wordmark is an image with `aria-label="Shoo"` plus a visually hidden status text ("Shoo is paused") wherever the state matters. Eyes never carry information that is not also in text.

## 4. In-page UI on YouTube

All in-page UI renders in shadow roots mounted lazily (no work until the first Verdict that needs UI). Hosts are inserted at the per-Surface mount anchors defined in `youtube-integration.md` ("Mounting Shoo's in-page UI"), so Shoo never changes YouTube's layout. Theme follows YouTube: `html[dark]` present means dark tokens (observed live, see `youtube-integration.md` Section 6). YouTube neutrals for reference only: light `#FFFFFF / #0F0F0F / #606060`, dark `#0F0F0F / #F1F1F1 / #AAAAAA`. Shoo's own tokens stay Shoo's.

Keyboard events inside every Shoo shadow root call `stopPropagation` so YouTube's hotkeys (Space, k, j, l, /) never fire while the user operates a chip (focus safety rules in `youtube-integration.md`).

### Review chip (Review mode)

Two variants, chosen by the width of the thumbnail anchor:

| Variant | When | Anatomy |
|---|---|---|
| Full | thumbnail anchor ≥ 320 px wide (Home at most window sizes, the Watch sidebar on wide windows) | tiny eyes, `Remove?`, Rule swatch and Rule label (at most 200 px, cut with an ellipsis), probability `88%` for model Verdicts, then `Remove` (ink-filled) and `Keep` (outlined with `--edge`) buttons, each ≥ 44 px high. The buttons wrap to a second row before the label shrinks |
| Compact | thumbnail anchor < 320 px wide (Watch sidebar at most window sizes, Shorts shelf, Home with 5 or more Tiles per row) | tiny eyes, swatch and Rule label (at most 112 px), then two icon buttons ≥ 24 px (`ban` = Remove, `check` = Keep) |

- Why 320 px (measured 2026-10-10 on YouTube's own stylesheet with the 28-character Rule text, English and 30% longer copy): next to the duration badge the full chip needs about 240 px of room to stay on two rows (eyes and `Remove? R1 Rule text 88%`, then the buttons). Below a 320 px thumbnail the full chip either wraps to three rows beside the badge (280 to 310 px, 35 to 37% of the thumbnail) or no longer fits beside it and sits above it (200 to 270 px, two or three rows, 41 to 68%). Live Watch sidebar thumbnails measured 200 to 330 px (1000 to 1920 px windows). The Rule label replaced the R-number and the 28-character cut. Capped at 200 px it is about as wide as the cut was, and the chip's narrowest width is unchanged.
- Placement: overlays the bottom-left of the thumbnail anchor, inset 8 px, and stays clear of YouTube's bottom-right badges (duration, LIVE): max width = the room left of the badges minus an 8 px gap, or, with no badge measured, anchor width minus 16 px minus a 64 px zone kept free for one. When the content needs more than that room (the compact chip, the compact kept note and the labels stay on one row), it sits 8 px above the badges at anchor width minus 16 px instead. While Shoo measures the narrowest width, the Rule label counts as 40 px. With less room than that beside the badge, the chip sits above it. Never restyles, hides or covers YouTube's badges. Never covers the title, channel or YouTube's own ⋮ button. There is no "below the metadata" placement. Geometry rules live in `youtube-integration.md` Section 6.
- Surface: `--paper` at 96% opacity, `--shadow`, radius 10, 13 px text.
- Accessible name (both variants carry the full text): the chip is a `role="group"` named "Shoo: Remove? Rule: Reaction videos, 88 percent" (the Rule's label). Buttons are named "Remove this video" and "Keep this video", never by icon alone.
- Keyboard: both buttons are in the tab order at the host's position. On the Shorts shelf the chip lives in Shoo's page-level overlay so it stays above YouTube's hover preview, and its buttons come last in the tab order (`youtube-integration.md` Section 6). `Esc` while focus is in the chip returns focus to the Tile's title link: `a.ytLockupMetadataViewModelTitle` on Home and Watch sidebar, `a.shortsLockupViewModelHostOutsideMetadataEndpoint` on the Shorts shelf.
- After `Remove`: the chip disappears as YouTube's placeholder replaces the Tile, then the removed-Tile annotation appears.
- After `Keep`: an Exception is stored, the chip is replaced by a note for 4 s: `Kept · won't ask again` and a text button `Always keep this channel` (which creates a Keep rule for the channel). The compact variant keeps the note on one row: eyes, `Kept` (`chip.kept.short`) and a 24 px icon button (`user-check`) named "Always keep this channel" (also its tooltip), with the full sentence in the status text for screen readers. The channel button is hidden when the Tile has no channel (Shorts shelf, see REQ-SURF-1b).

### Dry-run label

Same position and size variants as the chip but passive: `Would remove ·` swatch and Rule label (at most 200 px; compact: swatch and Rule label, at most 112 px). No buttons, `--muted` text, no shadow, dashed 1 px `--edge` outline. Not focusable. The full text ("Shoo would remove this video, Rule: Celebrity gossip") lives inside the shadow root in reading order, so screen readers in browse mode reach it after the thumbnail. It takes no pointer events, so the label's tooltip does not show here. No `aria-describedby` (IDREFs do not cross shadow boundaries and Shoo never edits YouTube's attributes).

### Removed-Tile annotation

YouTube replaces the Tile's content with its own placeholder ("Video removed" with Undo and Tell us why, or "We won't recommend videos from this channel to you again" with Undo and Learn more). The placeholder markup was observed live on 2026-10-09 (fixture `test/fixtures/youtube/watch-removed-placeholder.html`). Shoo's lines read as part of YouTube's card, not a sticker on it: in Shoo's page-level overlay, they span YouTube's content column (the same left and right edges as YouTube's buttons) and are centred like YouTube's own stack of sentence and buttons. Where the band above YouTube's sentence leaves 8 px on both sides, they sit centred in it, with as much air above them as below. Otherwise they take YouTube's sentence's place, centred in the room between the card's top and its first button. Line one: eyes, `Shooed by`, swatch and Rule label (`Channel shooed by` on the "Don't recommend channel" placeholder, `annotation.channelShooedBy`, read as "Shoo: YouTube won't recommend this channel, Rule: …"), a `Keep` text button (undo through YouTube's Undo, then store an Exception) and `Always keep this channel` (hidden when the Tile has no channel). It takes no layout space and never covers YouTube's Undo, "Tell us why" or "Learn more" (placement rules in `youtube-integration.md` Section 6, "Removed-Tile annotation"). Never restyle YouTube's placeholder. The Rule label is the only text in line one that shrinks: it grows to its whole width, keeps room for a word, and has the full Rule text as its tooltip.

On narrow placeholders the line stays one line (inside the cover it may wrap, since the cover is as tall as the room above YouTube's first button): each step comes where the Rule label would keep less than about 100 px. Below 432 px of annotation width `Always keep this channel` shows as its `user-check` icon (24 px, same accessible name and a tooltip), and below 288 px `Shooed by` is dropped (the screen-reader sentence keeps it). On the "Don't recommend channel" card, whose "Channel shooed by" is longer, the steps come below 475 px and 340 px. "Crypto & trading" shows whole on YouTube's real cards (443 px Home, 449 and 475 px Watch sidebar). Taking the sentence's place, the lines cover it with an opaque surface painted in the colour YouTube paints behind its card (read from the page, `rgb(15, 15, 15)` in dark mode, `--paper` only as a fallback), flat, no shadow, so the card shows no patch: "Shooed by Crypto & trading" or "Channel shooed by Crypto & trading" states the same fact as the sentence it covers, and screen readers still read YouTube's text. The cover never reaches Undo, "Tell us why" or "Learn more".

YouTube's placeholder no longer says which video it replaced, so a second line names it: the title, then `·` and the channel name, for example `Ten minute pasta · Fixture Channel`. On the "Don't recommend channel" placeholder the channel was what got shooed, so it leads: `Fixture Channel · Ten minute pasta`. What was shooed is `--ink`, the other name `--muted`, 13 px like line one, flush under it (row gap 0, line one's 24 px targets already leave air). The Shorts shelf has no channel, so the line is the title alone. It is always one line: the title truncates with an ellipsis, and the channel name never shrinks but is capped at half the width (60% when it leads), with its own ellipsis beyond that. The full text is the line's tooltip (`annotation.nameAndContext`), and each name is its own `dir="auto"` run, so an RTL or mixed-script title never reorders the separator. Screen readers hear it once, in the annotation's sentence (`annotation.titledChannelLabel`: "Shoo: removed {title} from {channel} by Rule: …", `annotation.titledLabel` without a channel, `annotation.channelNamedLabel`: "Shoo: removed {title}, and YouTube won't recommend {channel}, Rule: …"), and the visible line is `aria-hidden`. The title line keeps at least 8 px above YouTube's sentence, or the two read as one paragraph, so on the Watch sidebar, Home and the "Don't recommend channel" placeholder Shoo's lines replace YouTube's sentence visually (they state the same fact and name the video). Where both lines are taller than the room above YouTube's first button (Home at 5 or more Tiles per row), the title moves into line one in place of `Shooed by`, right after the eyes and without the channel: eyes, title…, swatch and Rule label (at most 40% of the line, the title comes first, and below 288 px the swatch alone, the Rule named by its tooltip and the screen-reader sentence, because the title is the only way to tell which video went), Keep, user-check icon (after the Rule tag the title would read as part of the Rule). On the "Don't recommend channel" placeholder at that width `Channel shooed by` is the fact that matters, so the title is dropped there and only the screen-reader sentence keeps it. The title and channel come from the Tile's facts already in the content script: they are shown on the page only, never sent or logged, and no video ID is ever in the text. "Already shooed above", the Dry-run label and the Review chip get no title line: they sit on a Tile whose own title still shows.

A duplicate copy of a removed video (`Already shooed above`, no actions) sits over its thumbnail like a Dry-run label, so it takes the chip surface: `--paper` at 96%, radius 10, no shadow, no outline. Its text contrast then comes from the tokens, never from the thumbnail. It shows the Rule tag after `Already shooed above`. On a narrow thumbnail the label moves to a second line rather than shrink under 40 px. Passive, so no tooltip.

### Batch summary (Auto mode)

- Bottom-right of the viewport, 24 px inset, lifted above YouTube's miniplayer when it is visible (miniplayer detection in `youtube-integration.md` Section 6). Width 320 px.
- Content: eyes, `Shooed 4 videos` (system font, 600 weight, 16 px), then a short list with one row per Rule: swatch, Rule label (600 weight, cut with an ellipsis, the full Rule text as tooltip) and its count right-aligned in muted tabular figures (`×2`). Most Removals first, then the order the Rules first acted. At most 3 rows: with 4 or more Rules, 2 rows and a muted `+3 more Rules` line (`summary.more`) aligned with the labels. Then `Review` (opens Activity filtered to this batch's `batchId`) plus `Undo all` while YouTube's undo is still available on this page.
- Stays 6 s, pauses while hovered or focused, then collapses into a small eyes-and-count pill for 30 s, then disappears. One summary at a time: new Removals update the open summary instead of stacking.
- Announced through an `aria-live="polite"` region: "Shoo removed 4 videos: 2 by Reaction videos, 1 by Crypto & trading, 1 by Hustle Daily." It uses the labels in the list's order and names every Rule, folded or not.
- Notification style setting: per-Removal (same component, one per Removal, still one at a time) or silent (toolbar badge only).

### The moment (signature motion)

When a batch of Removals lands in Auto mode:
1. Each removed Tile emits a Rule-colour square (8 px, the Rule's colour) from its centre.
2. Squares travel to their Rule's swatch in the summary (a Rule folded into "+N more Rules" lands on that line) along a gentle arc, 560 ms, `cubic-bezier(0.16, 1, 0.3, 1)` (exponential ease-out), staggered 40 ms, using transforms only. Off-screen Tiles start from the nearest viewport edge.
3. The summary's count ticks up as squares arrive, then the eyes blink once.
4. Reduced motion: no travel, the summary fades in over 150 ms.
5. Budget: at most 12 squares per moment (extra Removals count but do not fly). No layout reads after the first frame.

### Notices (in page)

Same position as the summary. One notice per failure streak, never one per Tile. Before a failure category trips, the notice describes the problem without saying "paused" ("Shoo couldn't reach OpenRouter. Retrying."). When a category trips (5 consecutive failures, owned by the background, see `architecture.md`), the notice says so and offers recovery: "Shoo paused: YouTube's menu changed" with `Open settings`, "Shoo paused: OpenRouter didn't answer" with `Retry`. `--danger` text for the headline only, eyes in the error state (every in-page notice is a failure or a tripped category).

### Mode switches while UI is showing

Shoo follows the Mode transition table in `architecture.md` ("Mid-flight changes"). Visually: Review to Dry-run turns chips into labels, Dry-run to Review turns labels into chips, Review to Auto asks once in the popup before acting on chips already showing ("Remove the 3 flagged videos now?"), and turning Shoo off removes every chip, label and summary at once.

## 5. Popup (360 px wide)

Top to bottom, all in compact rows. One rhythm: 16 px between groups and on both sides of every hairline, 8 px from a control to its caption. Today's three figures sit on equal thirds under the three Mode segments.
1. Wordmark (live eyes) left, on/off switch right.
2. Mode segmented control: Auto / Review / Dry-run, selected segment ink-filled. One sentence under it explaining the selected Mode ("Shoo asks on the video before telling YouTube anything.").
3. Today: `214` judged, `17` removed, `$0.002` spent, in 20 px tabular figures with 12 px labels. Daily cap progress only when above 80%, using the cap value from settings.
4. Waiting on you: Escalation suggestions (channel, "4 of 6 removed by" with the Rule's swatch and name, or its text when it has none, truncated, `Ban` / `Not now`), and the current notice with its fix. Hidden when empty.
5. Quick "Add a rule" input (adds a Topic rule, Enter to save), placeholder "Unboxing videos and hauls". The help line under it, "Describe the videos, not an order." (`popup.addRule.hint`), turns into a soft hint while the text reads as an order or a negation (`rules.hint.*`, REQ-RULE-12). After saving: "Rule added" with the Rule's swatch and name or text.
6. Footer: connection status ("OpenRouter connected"), `Activity` and `Settings` links.

Host-permission requests never start from the popup (Firefox closes the popup when the permission prompt opens). The popup links to the Settings control that makes the request.

## 6. Settings

Two columns: a section index (200 px, current section ink-filled) and the main column (max 880 px). One rhythm inside a section, as in the popup: 24 px between groups (heading block, How to write a Rule, Try a title, Escalation strip, budget meter, the table), 8 px from a sub-heading to its table, 16 px from the table to Add a Rule, 8 px from a control to its caption. Sections and their content:

- **Rules**: heading plus one plain sentence. Under it, How to write a Rule (`rules.guide.title`, REQ-RULE-12, evidence in `decision-engine.md` Section 13): a native disclosure with a chevron, open when the section loads with no Rules and closed otherwise, and it does not fold away when the first Rule is added. Inside, over a strong hairline: the guide's lede in `--muted` (what the model reads and never sees), then seven ruled tips, the title in a 14rem left column once the guide is 36rem wide. The first five show a Try and a Not example side by side (stacked below 42rem), each led by its word and a 16 px icon (`check`, `x`), the Not example in `--muted`, never struck through or coloured. Last, the text button "Check a Rule with Try a title below." moves focus to the Try a title field (or its consent link). With a direct Decision provider in use that takes fewer Topic rules than are on (Ollama: 25), a danger notice under the Escalation strip says so (`rules.tooManyRules`), and the provider's setup in Connection shows the same warning with a `triangle-alert` icon (`connection.provider.tooManyRules`). Try-a-title slip (title, channel, optional YouTube video URL or `i.ytimg.com` thumbnail URL, the Verdict pill `Remove · 91%` at right, or `Keep`; under it, "Decided by" with the swatch and "{name}: {text}" (`rules.try.decidedByNamed`), or the text alone for an unnamed Rule). Try a title needs consent: without it the slip shows `Give consent to try titles` linking to Connection. The URL field accepts only a YouTube video URL or an `i.ytimg.com` URL, parsed locally to a video ID, anything else shows `rules.try.urlInvalid`. Escalation strip when one is waiting. A state budget meter shows how much of the model's reading budget the Rules and kept examples use (`decision-engine.md`, state budget). Rule table rows: swatch + R-number, kind (Topic, Thumbnail, Banned channel, Title keyword, Pattern, Duration, Short, Live), the Rule cell, this-week hits, on/off switch, expand chevron. The Rule cell's first line is the Rule name (REQ-RULE-11): an inline input in 600 weight with the muted placeholder "Add a name", at most 40 characters, saved on blur or Enter, Escape reverts. Banned channels have none, their text is the channel name. Under it, the Rule text, inline editable. While a remove Topic or Thumbnail rule's text is being edited, a muted line under it points out an order (`rules.hint.order`) or a negation (`rules.hint.negation`) in a polite live region. Hints never block saving. Kinds marked "pending fixture" in `requirements.md` (upcoming, members-only) are not offered. A remove Rule (not a Banned channel) that skips Subscribed channels shows "Skips subscribed channels" under its kind. Expanded row: for a remove Rule other than a Banned channel, a switch "Never shoo channels I'm subscribed to" (REQ-RULE-14) over one muted line: while it is off, how Shoo reads the list and that Shorts shelf videos are never skipped (`rules.skipSubscribed.hint`), and while it is on, what Shoo knows of the list ("Skips 1,000 subscribed channels, read from YouTube today 09:12", not read yet, or could not be read and what the Rule removes until then). Then "Removed this week", a thumbnail wall of the videos this Rule removed this week (up to 24 at 64×36 px, read from `removed` Activity events) with a "See all N in Activity" link to Activity filtered to the Rule (`#activity?rule=<id>`), all-time hits, last hit time, delete. Sorted by activity, switched-off Rules sink to the bottom in `--muted`. `Add a Rule` opens an inline row: kind picker and text field (placeholders: Topic "Unboxing videos and hauls", Topic Keep rule "Woodworking tutorials", Title keyword "A word in titles", Thumbnail "A person pointing at a red arrow", Banned channel "Channel name"), with the soft hints under the text. A second line holds the optional name field with "Shown on YouTube instead of the whole Rule. The model never sees it." beside it, then Save and Cancel.
- **Keep rules**: same table with K-numbers, no colours. A Keep rule's hits (this week, all time, last hit) count only its Rescues, the videos it kept that a remove Rule or Banned channel would otherwise have removed (`decision-engine.md` Section 1.1). Thumbnail Keep rules are not offered in v1. Kind picker: Topic, Channel, Artist channel, Title keyword, Pattern, Regular expression (while regex Rules are on), Duration, Short, Live. Artist channel is offered only here and has no text field: a muted hint says what it keeps and that Shorts shelf videos never match (`rules.artistChannel.hint`), and it saves "Artist channels" (`rules.text.artistChannel`) as its text, as Short and Live save a default text. Expanded row: the same wall titled "Kept this week", showing each video this Keep rule rescued this week once, newest first (read from `keptByRule` Activity events, one per video and day), with the same link. Adding a Keep rule for a Banned channel asks "Lift the ban on Hustle Daily too?".
- **Views rules** (Rules and Keep rules): both kind pickers offer Views after Duration, and the table's kind column says Views. The add row shows two fields, "At least (views)" and "At most (views)" (`rules.views.min`, `rules.views.max`), that take plain numbers, commas and k, m or b (`10k`, `1.5m`). Save stays disabled until one bound is a count and the lower is not above the upper. A muted hint under the row (`rules.views.hint`) says how to type the counts and that videos whose view count YouTube shows in another language, and live streams, never match. With no text typed, the Rule saves "Fewer than 1k views", "More than 1m views" or "Between 10k and 1.5m views" (`rules.views.*`) as its text.
- **Banned channels**: channel name, how it got there (you, or Escalation with date), videos removed, remove from list.
- **Exceptions**: dense list of kept videos (title, channel, date, and the Rule that wanted it gone, "■ Crypto wanted it gone", where only the Rule's name truncates), search, delete.
- **Activity**: sticky guide labels per day with the day's Removals ("Today · 17 shooed"). Rows: time, thumbnail, title over channel and Surface, the Rule (swatch + name, or its text without one, truncated, full text as tooltip, a Keep rule with its hollow ink swatch) over the Activity kind (Removed, Kept, Kept by Keep rule, Would remove, Failed, Escalated, Banned channel, Undone, Shelf dismissed), actions (Undo while YouTube still offers it on an open tab, Keep, Always keep this channel). Unseen rows are `--lit` until scrolled into view for 1 s (persisted as `seenAt`). Kept by Keep rule rows are Rescues only, have no actions and are stored as seen, so they are never lit. Search and filters by Rule (grouped as Rules, Keep rules and Banned channels, each named by its name or text), Activity kind and batch. Thumbnail-wall view toggle for Removals. Below 48rem of list width the row stacks: the Rule and Activity kind under the title, the actions under them, so neither squeezes the title.
- **Connection**:
  - Where Shoo checks videos (`connection.provider.title`): the same provider picker as onboarding step 2 (Section 7), with the provider in use selected and marked "In use". OpenRouter selected shows its block: `Connect OpenRouter` (OAuth) or `Paste a key`. When connected: key label, connect date, usage today and the key's limit from OpenRouter, `Disconnect` (forgets the key on this device and links to openrouter.ai/keys to revoke it). Reconnecting warns first: "Connecting again creates a new key. Revoke the old one at openrouter.ai/keys." A direct Decision provider selected shows its setup (`DirectSetup` in `src/ui/pages/EndpointSetup.tsx`, the same component as onboarding), starting from the saved model, with "Leave blank to keep the saved key." under the key field. For the provider in use the button reads `Save changes` and stays disabled until a field changes. Here the consent callout also repeats the compact "What Shoo sends" disclosure and its button reads `Give consent`.
  - With a direct provider or a chat model in use, a semibold line above the picker says what is in use: "Using {model} at {provider} ({host}).", "Using {model} on this computer ({host})." or "Using the chat model {model} at {host}.", and the consent line reads "You gave consent for {host} on {date}." Selecting OpenRouter then shows its block and, once an OpenRouter key is connected, "Switching back to OpenRouter asks for consent again." and a primary `Use OpenRouter`, the same place every other row has its `Use {provider}`. Without a key only `Connect OpenRouter` and `Paste a key` show. The popup names that host when it refuses Shoo or stops answering (`popup.state.endpointRejected`, `popup.state.breakerEndpoint`).
  - Consent: shows what is sent (the same disclosure as onboarding step 1, compact, Section 7), then a `Privacy policy` link to the hosted policy (`PRIVACY_POLICY_URL` in `src/ui/pages/nav.ts`, opens in a new tab), and, for users who chose Exact rules only, a `Give consent` button that runs the same consent flow as onboarding.
  - Model picker (live list, image-capable models marked, OpenRouter only), Filtering strength presets with one sentence each.
  - Chat model (a closed disclosure at the end, open while a chat model is in use, `connection.chat.title`, with "Less accurate" as plain muted text, like "Recommended" and "In use"): one sentence on why it is less accurate (it rates its own answers, and Filtering strength was not tuned for them), "Titles only. Thumbnail rules need a Decision model that reads images." with an `image-off` icon, then Base URL with "On this computer: Ollama · LM Studio" text buttons that fill in their address, key (optional), model, and `Use this chat model`. With Ollama's port, the `OLLAMA_ORIGINS` line shows as a numbered step. Same save flow as a direct provider.
- **Advanced**: Surfaces switches (Home, Watch sidebar, Shorts shelf on, Search, Channel page and End screen disabled with the reason "YouTube offers no Not interested here"), with the note beside the Shorts shelf switch: "Shorts show no channel, so channel Rules can't match here. Shoo uses Not interested only." Under them, "Whole shelves on Home" (`settings.shelves.title`, with "Auto and Review only" at the sub-heading's right) holds the two Shelf dismissal switches (REQ-ACT-6), both off by default: Shorts shelf ("Shoo picks the shelf's own "Show fewer Shorts" for you.") and Games shelf ("Shoo picks the shelf's own "Show fewer games" for you."). A Shelf dismissal row in Activity shows the Shelf ("Shorts shelf", "Games shelf") as its title, Home as its Surface, no thumbnail, no Rule and no actions. Notification style, Escalation (Off / Suggest / Automatic), daily cap, exact Filtering strength slider, regex Rules switch, import/export, `Reset` (deletes everything Shoo stored, with a confirmation step).

Empty states use the light wink once each, for example Rules: "Nothing to shoo yet. Add a Rule, or start from one of these." with starter Rule chips. Activity: "Quiet so far. When Shoo acts, it shows up here."

## 7. Onboarding (extension page opened on install)

Four steps on one page, a progress line at the top (not numbered section labels). Closing the page mid-way resumes at the same step next time Settings opens.

1. **What Shoo does** and **what it sends**, the welcome screen. The step heading "Shoo the videos you don't want" (`onboarding.what.heading`, the progress line still says "What Shoo does"), three lines on what Shoo does, each with a 16 px ink Lucide icon (`list-checks` checks against your Rules, `ban` tells YouTube "Not interested" through its own menu, `undo-2` shows the Rule and takes it back, `onboarding.what.does.*`), then the "What Shoo sends" disclosure. The disclosure presents the facts of REQ-PRIV-1 in `requirements.md` as structured sections. It must contain every fact of REQ-PRIV-1 and nothing else, and REQ-PRIV-1 wins if they ever differ. The same component (`src/ui/pages/Disclosure.tsx`) renders it here and in Settings, Connection ("What Shoo sends" and the custom endpoint consent), compact there (13 px).

   Layout: a 15 px title "What Shoo sends" over a strong hairline, then four ruled rows. Each row has a 16 px Lucide icon and a semibold heading in an 11rem left column, and the content on the right. A container query sets the two columns only when the disclosure itself is at least 36rem wide, so it stacks heading above content on phones and inside the narrow custom endpoint callout. List items carry a muted 16 px icon. Every "Never sent" item carries `x`, so the row reads as a negation without colour.

   | Row (icon) | Content (copy keys under `onboarding.what.sends`) |
   |---|---|
   | For each video Shoo checks (`square-play`) | Title, Channel name, Length, "Where it appeared: Home, the Watch sidebar or the Shorts shelf", "Thumbnail image, only if you create a Thumbnail rule" |
   | Also in each request (`file-text`) | "The text of your Topic and Thumbnail rules, and of Keep rules you wrote as a sentence, while they are on", "Titles and channel names of up to 10 videos you chose to keep" |
   | Who receives it (`send`) | `globe` "**OpenRouter** (openrouter.ai), which passes it to the model provider", then one indented `corner-down-right` line each: **Cloudflare** by default, with the model cloudflare/clef-flash, **TypeSafe** if Shoo falls back to the model typesafe/jev-1.13, **OpenAI** if a thumbnail check falls back to openai/gpt-6-luna-decisions, **The provider of another model** if you pick one in Settings. Then, at OpenRouter's level and not under it, `server` "**Instead of OpenRouter** only if you choose one, and Shoo names its address first", with one indented line each: **Cloudflare, TypeSafe or Perplexity** reached directly with your own key, **A model on this computer** (Ollama, llama.cpp or LM Studio), so nothing leaves your device, **Your own endpoint** if you set one up. These receive the data instead of OpenRouter, never as well |
   | Never sent (`eye-off`) | Web addresses, Video IDs, Your watch history, Cookies, Comments, The page's HTML, Your YouTube account details |

   Row headings are `h4` under the `h3` title (`h3` inside the custom endpoint consent, which has no title), and each row's items are a list, so screen readers can move by section. The store listings and the privacy policy keep their own prose (`docs/release/`). Any change to these rows raises `CONSENT_VERSION` (`src/store/schema.ts`, 2 since the recipients were widened), so everyone who agreed to the old text is asked again.

   Buttons, after the disclosure: `Agree and continue` and `Use Exact rules only`, with "You can change this later in Settings, Connection." beside them (`onboarding.what.later`). On Firefox, `Agree` first requests the optional `websiteContent` data-collection permission in the same click (see `cross-browser-and-stores.md`). Declining Firefox's prompt is treated as `Use Exact rules only`. The step is about 1,050 px tall, so in a 1280×800 window the buttons sit below the fold and the user scrolls past the whole disclosure to reach them. The store screenshot is captured at 1680×1050 and scaled to 1280×800 so it shows the whole step (`docs/release/chrome-web-store.md`, Screenshots).
2. **Connect**: heading "Choose where Shoo checks videos" (`onboarding.connect.heading`, the progress line still says "Connect") and one sentence. Decision models only: no chat model here (ADR 0007). Then the provider picker (`ProviderPicker`), one radio group named "Where Shoo sends videos" in two ruled columns, which stack below 640 px: **Online** (`cloud`) with OpenRouter (preselected, "Recommended"), Cloudflare, TypeSafe and Perplexity, and **On this computer, most private** (`laptop`) with Ollama, llama.cpp and LM Studio, whose hints end "No key needed." Each online hint says whether it reads thumbnails. Rows are the Mode step's ruled radio rows (name, one muted sentence, `tint` when selected). Arrow keys move through all seven.

   Under the picker, the selected choice:
   - OpenRouter: "Connecting creates a key for Shoo on your OpenRouter account." plus the cost note ("a few cents per thousand videos"), `Connect OpenRouter` primary, `Paste a key` secondary (REQ-MODEL-4).
   - A direct Decision provider (`DirectSetup`, REQ-MODEL-7): up to three muted facts with icons: "Shoo sends to {host}." (`cloud`, or `laptop` and ", on this computer"), what it reads (`image` "Reads thumbnails, so Thumbnail rules work too." or `image-off` "Titles only. Thumbnail rules need a model that reads images."), and, unless it is clef-flash at Cloudflare, how Filtering strength fits (`gauge`: "tuned on clef-flash at Cloudflare. A copy on this computer may score a little differently." or "tuned on clef-flash, so {model} may remove more or fewer videos."). Cloudflare: one sentence on where the dashboard shows the account ID and creates a token, with `Open Workers AI`, then Account ID (32 hex characters, checked inline), Cloudflare API token, and "Model clef-flash, the one Filtering strength was tuned on." TypeSafe and Perplexity: "{provider} API key" with `How to get a key`, and the model, prefilled and editable. On this computer: numbered steps with each command in a `lit` 10 px code block with a `Copy` button named for its command, which announces "Copied." (Ollama: `ollama pull <model>` and the `OLLAMA_ORIGINS` line for this install's origin and OS, with "Other ways to set it" linking Ollama's FAQ. llama.cpp: `llama-server -hf ggml-org/Clef-Flash-GGUF --alias clef-flash`. LM Studio: load a decision model, start the server), then Model and Address, prefilled.
   - The primary button `Use {provider}` says what is missing beside it while disabled ("Paste your TypeSafe API key to continue.", "Enter your Cloudflare account ID to continue."). It requests host access as the first statement of the click, checks a model on this computer with one synthetic title (fields locked meanwhile), then replaces itself with a `lit` consent callout that takes focus: "Shoo will send what's listed under What Shoo sends to {host}, instead of OpenRouter." (plus "{host} is this computer, so nothing leaves it." for a local one) with `Agree and continue` and `Cancel`, which returns focus to the button. The user read "What Shoo sends" one step earlier, so onboarding does not repeat it there. Agreeing records consent naming the host, saves the provider and moves to step 3.

   With the default OpenRouter choice the step fits 1280×800 without scrolling. Skipped when the user chose Exact rules only, who can pick any provider later in Settings, Connection.
3. **First Rules**: starter chips (Reaction videos, Clickbait, Get-rich-quick, Celebrity gossip, Shorts) plus a free field (placeholder "Unboxing videos and hauls", or "A word in titles" with Exact rules only). For Topic rules the tip "Describe the videos, like “Unboxing videos and hauls”. One idea per Rule." sits under it and turns into a soft hint while the text reads as an order or a negation. Each chip turns into its Rule as it is added, showing its colour and the chip label, which becomes the Rule name (REQ-RULE-11), with the Rule text as tooltip, and the eyes glance at it. Rules from the free field list under it by their text. With Exact rules only, the Topic starters are shown disabled with "Needs consent".
4. **Mode**: three options with one sentence each, Review preselected. `Start` closes onboarding and opens youtube.com in the current tab only if the user asks.

## 8. Screen states

Every state has a copy key (Section 9 explains the key format). Runtime reasons come from `architecture.md` (RuntimeState). When several apply, the highest-precedence reason wins, as defined there.

### Popup

| State | What shows | Copy key |
|---|---|---|
| Loading (first paint) | wordmark, skeleton rows for Today, controls disabled | `popup.state.loading` |
| Not on YouTube | everything works, a line "Open YouTube to see Shoo at work." | `popup.state.notOnYouTube` |
| Off | eyes closed, Mode control disabled, `Turn on` | `popup.state.off` |
| noConsent | "Shoo only uses Exact rules." with `Give consent` (opens Settings, Connection) | `popup.state.noConsent` |
| migrating | "Updating Shoo's data…", controls disabled | `popup.state.migrating` |
| hostRevoked | eyes error, "Shoo lost access to YouTube or your Decision model." with `Fix in Settings` | `popup.state.hostRevoked` |
| noKey | "Connect OpenRouter to use Topic rules." with `Connect` (opens Settings) | `popup.state.noKey` |
| breakerNativeAction / breakerMarkup | eyes paused, "Shoo paused: YouTube's menu changed." with `Open settings` | `popup.state.breakerYouTube` |
| breakerModel | eyes paused, "Shoo paused: OpenRouter didn't answer." with `Retry` | `popup.state.breakerModel` |
| dailyCap | eyes paused, "Daily limit of {cap} videos reached. Judging resumes at midnight." | `popup.state.dailyCap` |
| offline | "You're offline. Exact rules still work." | `popup.state.offline` |
| Out of credits (402) | eyes error, "OpenRouter says the key is out of credits." with `Open OpenRouter` | `popup.state.noCredits` |
| Empty Today | zeros shown as `0`, no cap bar | n/a |

### Settings

| Section | Empty | Loading | Error | Disabled |
|---|---|---|---|---|
| Rules | wink copy plus starter chips (`rules.empty`) | skeleton rows | save failed: "Couldn't save the Rule. Try again." (`rules.error.save`) | Topic and Thumbnail kinds disabled without consent or key (`rules.disabled.needsModel`) |
| Try a title | placeholder text | eyes judging, pill shows `…` | `rules.try.error` (names the reason: no key, offline, cap, OpenRouter error) | `rules.try.needsConsent` |
| Keep rules | "Nothing is protected yet. Keep rules always win." (`keep.empty`) | skeleton rows | `keep.error.save` | n/a |
| Banned channels | "No banned channels. Ban one from a chip, Activity or an Escalation." (`banned.empty`) | skeleton rows | `banned.error.save` | n/a |
| Exceptions | "No Exceptions yet. Videos you keep show up here." (`exceptions.empty`) | skeleton rows | `exceptions.error.load` | n/a |
| Activity | wink copy (`activity.empty`) | skeleton rows | `activity.error.load` | n/a |
| Connection | not connected: `Connect OpenRouter` / `Paste a key` | "Connecting…" during OAuth, "Checking {provider}…" during a local check (`connection.provider.checking`) | OAuth cancelled: "Connection cancelled. Nothing changed." (`connection.oauth.cancelled`). Invalid key: "OpenRouter rejected this key." (`connection.key.invalid`). Offline: `connection.offline`. Model list failed: "Couldn't load models. Using clef-flash." with `Retry` (`connection.models.error`). Host access denied for a direct provider or chat model: "Shoo needs access to {host} to use it." (`connection.custom.permissionDenied`). Local check failed: Ollama refused (`connection.provider.error.ollamaOrigins`), not running (`…unreachable`), model missing (`…noModel`), wrong format (`…format`) | noConsent shows `Give consent` |
| Advanced, import | n/a | "Checking file…" | "This file isn't a Shoo export, or it's from a newer version." (`advanced.import.error`) with details | n/a |

### Onboarding

| State | What shows | Copy key |
|---|---|---|
| OAuth cancelled | back on step 2, "Connection cancelled. Try again or paste a key." | `onboarding.connect.cancelled` |
| Invalid key | inline under the key field | `onboarding.connect.invalidKey` |
| Offline | step 2 disabled with "You're offline. You can connect later in Settings." and `Skip for now` | `onboarding.connect.offline` |
| Local model check failed | step 2 stays on the provider with the cause and fix under the button, no consent asked | `connection.provider.error.*` |
| Host access declined | step 2 stays, "Shoo needs access to {host} to use it." | `connection.custom.permissionDenied` |
| Resumed | the step the user left, with completed steps checked | `onboarding.resumed` |

### In-page

| State | What shows |
|---|---|
| Tile waiting for a Verdict | nothing (no spinners on YouTube) |
| Tile held undecided (Topic Keep rule could not be asked) | nothing, the Tile stays as YouTube shows it |
| Native action failed | nothing on the Tile, one notice per streak |
| Private window | chips and labels work. The post-Keep note reads "Kept for this session" (`chip.kept.session`) because nothing is stored |

## 9. Copy and localization

- Use `CONTEXT.md` terms exactly in labels: Rule, Topic rule, Thumbnail rule, Exact rule, Keep rule, Banned channel, Exception, Verdict, Mode, Activity, Filtering strength, Escalation. Never "filter", "AI", "prompt", "allowlist", "history".
- In user-facing copy a Tile is a "video" ("Shooed 4 videos", "Remove this video"). "Tile" is for code and docs only. Store copy may say "recommendation".
- Voice: plain with a light wink. "Shooed" appears only in summaries, the Activity day label and empty states. Settings and errors are strictly plain.
- Errors name the problem and the fix: "OpenRouter rejected the key. Reconnect in Connection." not "Something went wrong".
- Localization uses `@wxt-dev/i18n`. Key format `area.component.message`, for example `chip.remove`, `chip.kept.note`, `summary.shooed`, `notice.breakerModel`, `popup.state.dailyCap`. Counts use the library's plural forms (for example `summary.shooed` with forms for 1 and n), never string concatenation. Placeholders are named (`{cap}`, `{host}`, `{count}`). All copy in this spec moves into the catalogue as each screen is built.
- Leave room for 30% longer text in chips (truncate the Rule text, never the buttons).

## 10. Accessibility checklist (WCAG 2.2 AA)

- Text contrast ≥ 4.5:1 (all text tokens above pass on their ground). Component boundaries that must be perceived use `--edge` (3.3:1 light, 5.5:1 dark). Rule swatches are decorative, the Rule's name or R-number beside it carries the meaning.
- Focus ring on every interactive element: ink outline on extension pages, two-tone ring in-page. Never removed.
- Full keyboard use: settings tables (Tab order mandatory, arrow keys between rows optional), Mode segments (radio group with arrow keys), switches (`role="switch"`), chips (Section 4).
- Live regions: batch summary (polite), notices (assertive only when a category trips).
- Reduced motion honoured everywhere (moment, eyes, row transitions).
- Theme the browser surfaces: `::selection` with ink on a darkened paper tint, thin scrollbars in `--stroke`, caret `--ink`, `accent-color: var(--ink)`.
- Target size ≥ 24 px everywhere, ≥ 44 px for full-chip buttons.
- Shoo's in-page keyboard handling never triggers YouTube shortcuts (Section 4).

## 11. Implementation notes

- Preact + Tailwind v4 with the tokens above as CSS custom properties and Tailwind theme variables. Hand-built components (`Button`, `Switch`, `Segmented`, `RuleRow`, `Swatch`, `VerdictPill`, `Eyes`, `Chip`, `Summary`, `Notice`), no shadcn/Radix.
- The `Eyes` component is pure SVG plus a small state machine (`watching | judging | review | paused | error`), driven by the RuntimeState the background broadcasts (`architecture.md`).
- The content script is one bundle (ADR 0006). In-page UI modules are imported normally but initialize nothing until the first Verdict that needs UI. Fonts ship only with extension pages.
- Identifier names follow `CONTEXT.md` and `architecture.md`: `Verdict.outcome` (`keep | remove`), `nativeAction`, `removeCutoff(strength)`.
