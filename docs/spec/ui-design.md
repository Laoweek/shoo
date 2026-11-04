# Shoo UI design spec

Design direction: **Friendly App**, with the **Living Wordmark** eyes as the logo.

- Product record: `PRODUCT.md`. Glossary for every label: `CONTEXT.md`.
- This spec and `DESIGN.md` are the UI references. Where they disagree on tokens, behaviour or accessibility, **this spec wins**. The shipped build is the reference for composition and feel, and `DESIGN.md` records it.
- Runtime states, Mode transitions and messages are defined in `docs/spec/architecture.md`. Mount anchors ("Mounting Shoo's in-page UI"), `actionRoot` and focus safety on YouTube are defined in `docs/spec/youtube-integration.md`. This spec covers what the user sees.
- `DESIGN.md` is generated from the build with impeccable's documenter, not written by hand.

## 1. The idea

Shoo looks like a friendly consumer app: soft white cards on a warm grey ground, labels in plain speech, and one bright orange that only ever marks something you can press. Colour has jobs and nothing else: orange for what you can press, a pale red or green for a Verdict, and a small dot for each Rule. Functional first, with a light wink: the eyes peek over the Try a title card and read along while the user types, and nothing else is decoration. Every Rule owns a colour, and wherever a Verdict appears (chip, Activity row, popup, summary) its dot and the Rule's name show which Rule acted. When Shoo acts, Rule-colour dots fly into the batch summary and the logo's eyes blink once.

The **logo is alive**: the two o's of "Shoo" are eyes that show what Shoo is doing (watching, judging, waiting on you, paused, in trouble). It is the only character in the product.

Refuse (from `PRODUCT.md` and the craft floor): YouTube red on YouTube or anything that looks like a YouTube control, stat tiles, cards inside cards, eyebrow labels above headings, gradient text, glass, coloured panels or tinted cards behind the work, colour used as decoration, emoji or Unicode glyphs as icons, illustration or doodles standing in for content.

## 2. Tokens

Define on `:root, :host` (the content-script UI lives in a shadow root). Contrast ratios below are computed with the WCAG 2.x formula against `--paper` (cards) and `--ground` (the page) of the same theme.

| Token | Light | Dark | Ratio vs paper / ground (light; dark) | Use |
|---|---|---|---|---|
| `--ground` | `#F4F1EC` | `#1B1816` | | the page behind the cards, the Settings index, the popup |
| `--paper` | `#FFFFFF` | `#26221F` | | cards, fields, the chip and every floating surface |
| `--ink` | `#2B241F` | `#F2EDE8` | 15.3 / 13.6; 13.6 / 15.2 | text, logo, focus ring |
| `--muted` | `#6F625A` | `#B3A89F` | 5.9 / 5.2; 6.8 / 7.6 | secondary text, the budget meter's fill |
| `--edge` | `#938780` | `#7A6F67` | 3.5 / 3.1; 3.2 / 3.6 | every component boundary that must be seen: 1 px field and outline-button borders, checkboxes and radios, the off switch's track (WCAG 1.4.11) |
| `--stroke` | `#CFC6BD` | `#4E4640` | decorative | disabled outlines and tracks |
| `--line` | `rgb(43 36 31 / .09)` | `rgb(242 237 232 / .09)` | decorative | row rules inside cards, never the only boundary of a control |
| `--line-strong` | `rgb(43 36 31 / .18)` | `rgb(242 237 232 / .18)` | decorative | the rule under each table header, the chip's divider beside the eyes, link underlines at rest, meter tracks |
| `--tint` | `rgb(43 36 31 / .045)` | `rgb(242 237 232 / .05)` | | hover, the selected radio row, the Segmented track, disabled primary buttons |
| `--lit` | `#FFF3D6` | `rgb(255 196 92 / .10)` | muted text 5.3 (light) | "lit until seen" Activity rows and callouts that need attention |
| `--danger` | `#B4232A` | `#FF9A8F` | 6.5 / 5.8; 7.7 / 8.6 | errors only: as text, and as the fill of an over-budget meter |

The one bright colour, and the Verdict pills:

| Token | Fill (light; dark) | Text on it | Ratio | Use |
|---|---|---|---|---|
| `--action` / `--on-action` | `#E4572F`; `#FF7A50` | `#1A1411`; `#1B1816` | 4.9; 6.9 | only things you can press: primary buttons, the on switch, checked checkboxes and radios, the current section's dot, the chip's Remove button. Hover lightens to `--action-hover` (`#F06A40`; `#FF9370`) |
| `--remove-bg` / `--remove-fg` | `#FDE4E1`; `#4A2220` | `#B4232A`; `#FFB4AC` | 5.4; 8.0 | the Remove Verdict pill |
| `--keep-bg` / `--keep-fg` | `#DDF3E3`; `#1D3A28` | `#1E6B3E`; `#9EE0B5` | 5.6; 8.2 | the Keep Verdict pill |

Orange is never decoration: if it is orange, it can be pressed. Verdict pills sit on pale grounds so they never look like buttons. The light theme's orange is at least 3.0:1 on paper, the ground and tinted rows (3.7 on paper, 3.3 on the ground), so the on switch and checked boxes meet 3:1 wherever they sit, and its text is always `--on-action`, never white. The switch's knob is `--knob`: white on the light orange (3.7:1), `#1B1816` on the dark orange (6.9:1).

States: hover darkens a row or outline button with `--tint` (or the ground), the selected Segmented option is a paper pill ringed in `--edge` inside a tinted track (3:1 in both themes), the current section is a raised paper pill with an orange dot, and anything you press sinks to 96% with a short spring back (`--ease-spring`, 160 ms, none under reduced motion).

### Rule colour codes

Assigned in order when a Rule is created and stored with the Rule (never recomputed, so colours stay stable when Rules are deleted). Keep rules do not get colours (they show `K1`, `K2` beside a hollow ring). Orange and red stay out of the set, because they mean "press" and "Remove", and so does grey, which would read as a switched-off Rule.

| Code | Colour | Code | Colour |
|---|---|---|---|
| c1 blue | `#5B8DEF` | c6 brown | `#A97B54` |
| c2 green | `#3FAE6E` | c7 sky | `#4FB6DB` |
| c3 yellow | `#E3B23C` | c8 orchid | `#D57FCB` |
| c4 rose | `#E06B8B` | c9 violet | `#9677E0` |
| c5 lime | `#93C24F` | c10 teal | `#26A69A` |

After c10 the sequence repeats. The colours are the same in both themes. Rule colour is **decorative**: text always sits beside the dot and carries the meaning (WCAG 1.4.1). Outside the Settings tables that text is the Rule's label: its Rule name, or its text when it has none (REQ-RULE-11), in its own `dir="auto"` run, with the full Rule text as its tooltip. On YouTube it is bold and the first text to shrink on every surface, to an ellipsis. The R-number names a Rule in the Settings tables and never shows on YouTube, because a number alone does not say what the Rule is.

- **Dot** (the swatch): a 10 px circle in the Rule's colour, with a faint inner ring (`--dot-ring`, light theme only) so pale colours keep an edge on white. A switched-off Rule shows a hollow ring in its colour, a Keep rule a hollow ring in `--edge`. The moment's flying dots use the same size.
- **In the Settings tables**: the dot, then the R-number in 500 `--muted` tabular figures.

Never set text in a Rule colour: Rule colours are only ever dots.

### Type

- **Extension pages** (popup, settings, onboarding): **Figtree** (SIL OFL, variable 300 to 900) for everything: UI text, numbers, the wordmark letters (800) and headings (600: section and step headings at -0.025em tracking, sub-headings at -0.01em, card titles untracked). Bundle the Latin subset as one woff2 file in the extension. Never load fonts from the network.
- **In-page UI on YouTube** (chips, labels, annotation, summary, notices): the system UI font stack only, `system-ui, -apple-system, "Segoe UI", Ubuntu, sans-serif`, and the wordmark drawn as SVG. No `FontFace`, no bundled fonts, no `web_accessible_resources` (ADR 0006: single content bundle). The system stack still reads as distinct from YouTube's Roboto on macOS and Windows, and the eyes carry the identity.
- `font-variant-numeric: tabular-nums` on every count, cost and time. Figtree and the system fonts both have tabular figures.
- Scale (px): 12 meta and labels, 13 dense rows, hints and chips, 14 body, 15 section ledes and nav items, 16 inputs (every text field and select), 18 card titles (Try a title), 20 sub-headings, 22 popup headline numbers, 36 onboarding step headings, 48 section headings. No half-pixel sizes. Line height 1.35 for rows, 1.5 for prose.
- In the content script use **px, never rem**: YouTube sets `html { font-size: 10px }`.

### Space, shape, elevation

- 4 px base, in 4, 8, 12, 16 and 24 px steps, with 20 px inside cards and 32 to 48 px only between page regions. Hit targets: at least 44 px for the full chip, at least 24 px everywhere else including the compact chip and the popup (WCAG 2.5.8). The popup uses the Settings control sizes: a 30 px Segmented, and a 36 px field with a 36 px button beside it.
- Cards: white `--paper` at radius 16 on the `--ground`, holding one job each (Try a title, a table, a group of settings). Never a card or a framed panel inside a card: inside a card, groups are split by a 1 px `--line` rule, and lists of radio rows (the provider picker, the onboarding Mode step) are ruled rows under a `--line-strong` rule. Rows inside cards use 1 px `--line`, the rule under a table header 1 px `--line-strong`.
- Radii: buttons, Segmented, switches and nav items are pills (999 px), checkboxes 5 px, thumbnails 6 px, fields 12 px (8 px for the Rule table's inline edits), callouts 14 px, cards and floating panels 16 px, the chip and passive chips 12 px.
- Elevation, declared once per surface: cards and floating surfaces carry a soft offset shadow (`--shadow` on pages, `--shadow-float` in-page) and no border. In the dark theme the in-page chip, panels and collapsed pill add a 1 px `--line-strong` ring, because a shadow does not show on the Sites' dark grounds. Controls carry a 1 px `--edge` border instead (fields, outline buttons) and no shadow, except the selected Segmented option, which also lifts by a 1 px shadow.

### Focus

- Extension pages: 2 px `--ink` outline, 2 px offset. A focused field also darkens its border to `--ink`.
- In-page UI: two-tone ring so it shows over any thumbnail, `box-shadow: 0 0 0 2px var(--paper), 0 0 0 4px var(--ink)`.
- Never removed, on every interactive element.

### Icons

Lucide (`lucide-preact`, tree-shaken) at 16 px, stroke 2, `currentColor`. No other icon sources except the logo. Chip icons: `ban` for Remove, `check` for Keep, `user-check` for "Always keep this channel" on the compact kept note. In-page icons are hand-copied Lucide paths, so the content bundle does not import `lucide-preact`.

## 3. The logo (living wordmark)

- Wordmark: "Sh" in Figtree 800, followed by two eyes that replace "oo". Eye = ink-stroked circle (stroke matches the letter stem weight) with a solid ink pupil. Eyes are always `--ink`, never a Rule colour or the action colour, and their lids are filled with the ground they sit on (`--eyes-bg`: `--ground` on extension pages, `--paper` in-page). In-page, the eyes are drawn alone as SVG (no letters, no web font).
- Signature: in Settings, Rules, a second, larger pair of the same eyes (84 px wide) peeks over the top edge of the Try a title card, its lower edge hidden behind the card. They follow the pointer like the wordmark, sweep while the user types a title, and glance (judging) while the Verdict is pending.
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

## 4. In-page UI on YouTube and Bilibili

All in-page UI renders in shadow roots mounted lazily (no work until the first Verdict that needs UI). Hosts are inserted at the per-Surface mount anchors defined in `youtube-integration.md` ("Mounting Shoo's in-page UI") and `bilibili-integration.md` (Section 5), so Shoo never changes the site's layout. In-page copy names the Site it runs on ("Couldn't tell Bilibili about 1 video"). A breaker notice names the Site that tripped it, which may be the other one. Theme follows YouTube: `html[dark]` present means dark tokens (observed live, see `youtube-integration.md` Section 6). YouTube neutrals for reference only: light `#FFFFFF / #0F0F0F / #606060`, dark `#0F0F0F / #F1F1F1 / #AAAAAA`. Shoo's own tokens stay Shoo's.

Keyboard events inside every Shoo shadow root call `stopPropagation` so YouTube's hotkeys (Space, k, j, l, /) never fire while the user operates a chip (focus safety rules in `youtube-integration.md`).

### Review chip (Review mode)

Two variants, chosen by the width of the thumbnail anchor:

| Variant | When | Anatomy |
|---|---|---|
| Full | thumbnail anchor ≥ 320 px wide (Home at most window sizes, the Watch sidebar on wide windows) | tiny eyes, `Remove?`, Rule dot and Rule label (at most 200 px, cut with an ellipsis), probability `88%` for model Verdicts, then `Remove` (orange pill) and `Keep` (outlined pill) buttons, each ≥ 44 px high. The buttons wrap to a second row before the label shrinks |
| Compact | thumbnail anchor < 320 px wide (Watch sidebar at most window sizes, Shorts shelf, Home with 5 or more Tiles per row) | tiny eyes, dot and Rule label (at most 112 px), then two 24 px round icon buttons (`ban` = Remove, filled orange, and `check` = Keep, outlined) |

- Why 320 px (measured 2026-10-10 on YouTube's own stylesheet with the 28-character Rule text, English and 30% longer copy): next to the duration badge the full chip needs about 240 px of room to stay on two rows (eyes and `Remove? R1 Rule text 88%`, then the buttons). Below a 320 px thumbnail the full chip either wraps to three rows beside the badge (280 to 310 px, 35 to 37% of the thumbnail) or no longer fits beside it and sits above it (200 to 270 px, two or three rows, 41 to 68%). Live Watch sidebar thumbnails measured 200 to 330 px (1000 to 1920 px windows). The Rule label replaced the R-number and the 28-character cut. Capped at 200 px it is about as wide as the cut was, and the chip's narrowest width is unchanged.
- Placement: overlays the bottom-left of the thumbnail anchor, inset 8 px, and stays clear of YouTube's bottom-right badges (duration, LIVE): max width = the room left of the badges minus an 8 px gap, or, with no badge measured, anchor width minus 16 px minus a 64 px zone kept free for one. When the content needs more than that room (the compact chip, the compact kept note and the labels stay on one row), it sits 8 px above the badges at anchor width minus 16 px instead. While Shoo measures the narrowest width, the Rule label counts as 40 px. With less room than that beside the badge, the chip sits above it. Never restyles, hides or covers YouTube's badges. Never covers the title, channel or YouTube's own ⋮ button. There is no "below the metadata" placement. Geometry rules live in `youtube-integration.md` Section 6.
- Surface: a `--paper` card, radius 12, `--shadow-float` (plus the 1 px `--line-strong` ring in dark), 13 px text.
- Accessible name (both variants carry the full text): the chip is a `role="group"` named "Shoo: Remove? Rule: Reaction videos, 88 percent" (the Rule's label). Buttons are named "Remove this video" and "Keep this video", never by icon alone.
- Keyboard: both buttons are in the tab order at the host's position. On the Shorts shelf the chip lives in Shoo's page-level overlay so it stays above YouTube's hover preview, and its buttons come last in the tab order (`youtube-integration.md` Section 6). `Esc` while focus is in the chip returns focus to the Tile's title link: `a.ytLockupMetadataViewModelTitle` on Home and Watch sidebar, `a.shortsLockupViewModelHostOutsideMetadataEndpoint` on the Shorts shelf.
- After `Remove`: the chip disappears as YouTube's placeholder replaces the Tile, then the removed-Tile annotation appears.
- After `Keep`: an Exception is stored, the chip is replaced by a note for 4 s: `Kept · won't ask again` and a text button `Always keep this channel` (which creates a Keep rule for the channel). The compact variant keeps the note on one row: eyes, `Kept` (`chip.kept.short`) and a 24 px icon button (`user-check`) named "Always keep this channel" (also its tooltip), with the full sentence in the status text for screen readers. The channel button is hidden when the Tile has no channel (Shorts shelf, see REQ-SURF-1b).

### Dry-run label

Same position and size variants as the chip but passive: `Would remove ·` dot and Rule label (at most 200 px; compact: dot and Rule label, at most 112 px). No buttons, `--muted` text on `--paper` at 96%, no shadow, dashed 1 px `--muted` outline. Not focusable. The full text ("Shoo would remove this video, Rule: Celebrity gossip") lives inside the shadow root in reading order, so screen readers in browse mode reach it after the thumbnail. It takes no pointer events, so the label's tooltip does not show here. No `aria-describedby` (IDREFs do not cross shadow boundaries and Shoo never edits YouTube's attributes).

### Removed-Tile annotation

YouTube replaces the Tile's content with its own placeholder ("Video removed" with Undo and Tell us why, or "We won't recommend videos from this channel to you again" with Undo and Learn more). The placeholder markup was observed live on 2026-10-09 (fixture `test/fixtures/youtube/watch-removed-placeholder.html`). Shoo's lines read as part of YouTube's card, not a sticker on it: in Shoo's page-level overlay, they span YouTube's content column (the same left and right edges as YouTube's buttons) and are centred like YouTube's own stack of sentence and buttons. Where the band above YouTube's sentence leaves 8 px on both sides, they sit centred in it, with as much air above them as below. Otherwise they take YouTube's sentence's place, centred in the room between the card's top and its first button. Line one: eyes, `Shooed by`, swatch and Rule label (`Channel shooed by` on the "Don't recommend channel" placeholder, `annotation.channelShooedBy`, read as "Shoo: YouTube won't recommend this channel, Rule: …"), a `Keep` text button (undo through YouTube's Undo, then store an Exception) and `Always keep this channel` (hidden when the Tile has no channel). It takes no layout space and never covers YouTube's Undo, "Tell us why" or "Learn more" (placement rules in `youtube-integration.md` Section 6, "Removed-Tile annotation"). Never restyle YouTube's placeholder. The Rule label is the only text in line one that shrinks: it grows to its whole width, keeps room for a word, and has the full Rule text as its tooltip. On Bilibili the placeholder shows the blurred cover behind it and puts its sentence and 撤销 side by side, so the annotation gets the Dry-run label's surface (`data-surface`) and sits at the top of the placeholder, 8 px in, over neither (`bilibili-integration.md` Section 5).

On narrow placeholders the line stays one line (inside the cover it may wrap, since the cover is as tall as the room above YouTube's first button): each step comes where the Rule label would keep less than about 100 px. Below 432 px of annotation width `Always keep this channel` shows as its `user-check` icon (24 px, same accessible name and a tooltip), and below 288 px `Shooed by` is dropped (the screen-reader sentence keeps it). On the "Don't recommend channel" card, whose "Channel shooed by" is longer, the steps come below 475 px and 340 px. "Crypto & trading" shows whole on YouTube's real cards (443 px Home, 449 and 475 px Watch sidebar). Taking the sentence's place, the lines cover it with an opaque surface painted in the colour YouTube paints behind its card (read from the page, `rgb(15, 15, 15)` in dark mode, `--paper` only as a fallback), flat, no shadow, so the card shows no patch: "Shooed by Crypto & trading" or "Channel shooed by Crypto & trading" states the same fact as the sentence it covers, and screen readers still read YouTube's text. The cover never reaches Undo, "Tell us why" or "Learn more".

YouTube's placeholder no longer says which video it replaced, so a second line names it: the title, then `·` and the channel name, for example `Ten minute pasta · Fixture Channel`. On the "Don't recommend channel" placeholder the channel was what got shooed, so it leads: `Fixture Channel · Ten minute pasta`. What was shooed is `--ink`, the other name `--muted`, 13 px like line one, flush under it (row gap 0, line one's 24 px targets already leave air). The Shorts shelf has no channel, so the line is the title alone. It is always one line: the title truncates with an ellipsis, and the channel name never shrinks but is capped at half the width (60% when it leads), with its own ellipsis beyond that. The full text is the line's tooltip (`annotation.nameAndContext`), and each name is its own `dir="auto"` run, so an RTL or mixed-script title never reorders the separator. Screen readers hear it once, in the annotation's sentence (`annotation.titledChannelLabel`: "Shoo: removed {title} from {channel} by Rule: …", `annotation.titledLabel` without a channel, `annotation.channelNamedLabel`: "Shoo: removed {title}, and YouTube won't recommend {channel}, Rule: …"), and the visible line is `aria-hidden`. The title line keeps at least 8 px above YouTube's sentence, or the two read as one paragraph, so on the Watch sidebar, Home and the "Don't recommend channel" placeholder Shoo's lines replace YouTube's sentence visually (they state the same fact and name the video). Where both lines are taller than the room above YouTube's first button (Home at 5 or more Tiles per row), the title moves into line one in place of `Shooed by`, right after the eyes and without the channel: eyes, title…, swatch and Rule label (at most 40% of the line, the title comes first, and below 288 px the swatch alone, the Rule named by its tooltip and the screen-reader sentence, because the title is the only way to tell which video went), Keep, user-check icon (after the Rule tag the title would read as part of the Rule). On the "Don't recommend channel" placeholder at that width `Channel shooed by` is the fact that matters, so the title is dropped there and only the screen-reader sentence keeps it. The title and channel come from the Tile's facts already in the content script: they are shown on the page only, never sent or logged, and no video ID is ever in the text. "Already shooed above", the Dry-run label and the Review chip get no title line: they sit on a Tile whose own title still shows.

A duplicate copy of a removed video (`Already shooed above`, no actions) sits over its thumbnail like a Dry-run label, so it takes a passive chip surface: `--paper` at 96%, radius 12, no shadow, no outline. Its text contrast then comes from the tokens, never from the thumbnail. It shows the Rule tag after `Already shooed above`. On a narrow thumbnail the label moves to a second line rather than shrink under 40 px. Passive, so no tooltip.

### Batch summary (Auto mode)

- Bottom-right of the viewport, 24 px inset, lifted above YouTube's miniplayer when it is visible (miniplayer detection in `youtube-integration.md` Section 6). Width 320 px, a `--paper` card, radius 16, `--shadow-float` (plus the 1 px `--line-strong` ring in dark). Notices use the same panel.
- Content: eyes, `Shooed 4 videos` (system font, 600 weight, 16 px), then a short list with one row per Rule: dot, Rule label (600 weight, cut with an ellipsis, the full Rule text as tooltip) and its count right-aligned in muted tabular figures (`×2`). Most Removals first, then the order the Rules first acted. At most 3 rows: with 4 or more Rules, 2 rows and a muted `+3 more Rules` line (`summary.more`) aligned with the labels. Then `Review` (opens Activity filtered to this batch's `batchId`) plus `Undo all` while YouTube's undo is still available on this page.
- Stays 6 s, pauses while hovered or focused, then collapses into a small eyes-and-count pill for 30 s, then disappears. One summary at a time: new Removals update the open summary instead of stacking.
- Announced through an `aria-live="polite"` region: "Shoo removed 4 videos: 2 by Reaction videos, 1 by Crypto & trading, 1 by Hustle Daily." It uses the labels in the list's order and names every Rule, folded or not.
- Notification style setting: per-Removal (same component, one per Removal, still one at a time) or silent (toolbar badge only).

### The moment (signature motion)

When a batch of Removals lands in Auto mode:
1. Each removed Tile emits a Rule-colour dot (10 px, the dot's size) from its centre.
2. Dots travel to their Rule's dot in the summary (a Rule folded into "+N more Rules" lands on that line) along a gentle arc, 560 ms, `cubic-bezier(0.16, 1, 0.3, 1)` (exponential ease-out), staggered 40 ms, using transforms only. Off-screen Tiles start from the nearest viewport edge.
3. The summary's count ticks up as dots arrive, then the eyes blink once.
4. Reduced motion: no travel, the summary fades in over 150 ms.
5. Budget: at most 12 dots per moment (extra Removals count but do not fly). No layout reads after the first frame.

### Notices (in page)

Same position as the summary. One notice per failure streak, never one per Tile. Before a failure category trips, the notice describes the problem without saying "paused" ("Shoo couldn't reach OpenRouter. Retrying."). When a category trips (5 consecutive failures, owned by the background, see `architecture.md`), the notice says so and offers recovery: "Shoo paused: YouTube's menu changed" with `Open settings`, "Shoo paused: OpenRouter didn't answer" with `Retry`. `--danger` text for the headline only, eyes in the error state (every in-page notice is a failure or a tripped category).

### Mode switches while UI is showing

Shoo follows the Mode transition table in `architecture.md` ("Mid-flight changes"). Visually: Review to Dry-run turns chips into labels, Dry-run to Review turns labels into chips, Review to Auto asks once in the popup before acting on chips already showing ("Remove the 3 flagged videos now?"), and turning Shoo off removes every chip, label and summary at once.

## 5. Popup (360 px wide)

Top to bottom, all in compact rows. One rhythm: 16 px between groups and on both sides of every hairline, 8 px from a control to its caption. Today's three figures sit on equal thirds under the three Mode segments.
1. On the ground, no band: the wordmark (live eyes) on the left, the on/off switch on the right.
2. Mode segmented control: Auto / Review / Dry-run, the selected segment a paper pill ringed in `--edge`. One sentence under it explaining the selected Mode ("Shoo asks on the video before telling the site anything.").
3. Today, in one white card: `214` judged, `17` removed, `$0.002` spent, in 22 px 600 figures with 12 px labels. Daily cap progress only when above 80%, using the cap value from settings.
4. Waiting on you: Escalation suggestions (channel, "4 of 6 removed by" with the Rule's swatch and name, or its text when it has none, truncated, `Ban` / `Not now`), and the current notice with its fix. With nothing else to say, the tab's Site adds its own notice: "Shoo is off on Bilibili." with `Turn on` when the user turned that Site off, or, for any Site that is on, "Shoo has no access to Bilibili." with `Fix in Settings` (opens Sites) when the browser took the access away. That check does not depend on the tab, because the browser hides the address of a tab Shoo has no access to. On a tab that is no Site: "Open YouTube or Bilibili to see Shoo at work." Hidden when empty.
5. Quick "Add a rule" input (adds a Topic rule, Enter to save), placeholder "Unboxing videos and hauls". The help line under it, "Describe the videos, not an order." (`popup.addRule.hint`), turns into a soft hint while the text reads as an order or a negation (`rules.hint.*`, REQ-RULE-12). On a Site's tab a checkbox under the field, "Only on Bilibili" (`popup.addRule.onlyHere`), unticked by default, makes the Rule a Site-only rule for that Site (REQ-RULE-15). After saving: "Rule added" with the Rule's swatch and name or text.
6. Footer: connection status ("OpenRouter connected"), `Activity` and `Settings` links.

Host-permission requests never start from the popup (Firefox closes the popup when the permission prompt opens). The popup links to the Settings control that makes the request.

## 6. Settings

Two columns: a section index (248 px, on the bare ground, the current section a raised paper pill with an orange dot, Mode and Filtering strength at its foot) and the main column (max 960 px), where each job sits in its own card. One rhythm inside a section, as in the popup: 24 px between groups (heading block, How to write a Rule, Try a title, Escalation strip, budget meter, the table), except 48 px above Try a title, where the eyes peek over it, 8 px from a sub-heading to its table, 16 px from the table to Add a Rule, 8 px from a control to its caption. Sections and their content:

- **Rules**: heading plus one plain sentence. Under it, How to write a Rule (`rules.guide.title`, REQ-RULE-12, evidence in `decision-engine.md` Section 13): a native disclosure with a chevron, open when the section loads with no Rules and closed otherwise, and it does not fold away when the first Rule is added. Inside, in a card: the guide's lede in `--muted` (what the model reads and never sees), then seven ruled tips, the title in a 14rem left column once the guide is 36rem wide. The first five show a Try and a Not example side by side (stacked below 42rem), each led by its word and a 16 px icon (`check`, `x`), the Not example in `--muted`, never struck through or coloured. Last, the text button "Check a Rule with Try a title below." moves focus to the Try a title field (or its consent link). With a direct Decision provider in use that takes fewer Topic rules than are on (Ollama: 25), a danger notice under the Escalation strip says so (`rules.tooManyRules`), and the provider's setup in Connection shows the same warning with a `triangle-alert` icon (`connection.provider.tooManyRules`). Try-a-title card, with the eyes peeking over its top edge (Section 3) (title, channel, optional YouTube video URL or `i.ytimg.com` thumbnail URL, and, once a Site-only rule is on, "Try it as a video on" with a YouTube / Bilibili segmented control, Bilibili hiding the URL field; the Verdict pill `Remove · 91%` in the card's right column, or `Keep`, with "The Verdict shows up here." (`rules.try.idle`) there before the first try; under it, "Decided by" with the dot and "{name}: {text}" (`rules.try.decidedByNamed`), or the text alone for an unnamed Rule). Try a title needs consent: without it the slip shows `Give consent to try titles` linking to Connection. The URL field accepts only a YouTube video URL or an `i.ytimg.com` URL, parsed locally to a video ID, anything else shows `rules.try.urlInvalid`. Escalation strip when one is waiting. A state budget meter shows how much of the model's reading budget the Rules and kept examples use (`decision-engine.md`, state budget). The table sits in a card with Add a Rule. Rule table rows: the Rule's dot and R-number, kind (Topic, Thumbnail, Banned channel, Title keyword, Pattern, Duration, Short, Live) with "YouTube only" or "Bilibili only" under it for a Site-only rule (nothing for a Rule on all sites), the Rule cell, this-week hits, on/off switch, expand chevron. The Rule cell's first line is the Rule name (REQ-RULE-11): an inline input in 600 weight with the muted placeholder "Add a name", at most 40 characters, saved on blur or Enter, Escape reverts. Banned channels have none, their text is the channel name. Under it, the Rule text, inline editable. While a remove Topic or Thumbnail rule's text is being edited, a muted line under it points out an order (`rules.hint.order`) or a negation (`rules.hint.negation`) in a polite live region. Hints never block saving. Kinds marked "pending fixture" in `requirements.md` (upcoming, members-only) are not offered. A remove Rule (not a Banned channel) that skips Subscribed channels shows "Skips subscribed channels" under its kind. Expanded row: first "Works on" with a checkbox per Site (REQ-RULE-15), all checked for a Rule on all sites. The last checked box is disabled, because a Rule works on at least one Site. For a Rule that cannot change Site both boxes are disabled, with the reason under them in `--muted` ("This channel is on Bilibili, so the Rule works there only." for a channel Rule that knows its channel's handle or id, "Bilibili videos never match this kind, so it works on YouTube only." for Short, Live and Views). Then, for a remove Rule other than a Banned channel that works on YouTube, a switch "Never shoo YouTube channels I'm subscribed to" (REQ-RULE-14) over one muted line: while it is off, how Shoo reads the list and that Shorts shelf videos are never skipped (`rules.skipSubscribed.hint`), and while it is on, what Shoo knows of the list ("Skips 1,000 subscribed channels, read from YouTube today 09:12", not read yet, or could not be read and what the Rule removes on YouTube until then). Then "Removed this week", a thumbnail wall of the videos this Rule removed this week (up to 24 at 64×36 px, read from `removed` Activity events) with a "See all N in Activity" link to Activity filtered to the Rule (`#activity?rule=<id>`), all-time hits, last hit time, delete. Sorted by activity, switched-off Rules sink to the bottom in `--muted`. `Add a Rule` opens an inline row: kind picker and text field (placeholders: Topic "Unboxing videos and hauls", Topic Keep rule "Woodworking tutorials", Title keyword "A word in titles", Thumbnail "A person pointing at a red arrow", Banned channel "Channel name"), with the soft hints under the text. A second line holds the same "Works on" checkboxes (both checked by default, disabled with only YouTube checked for Short, Live, Views and Artist channel), the optional name field with "Shown on the video instead of the whole Rule. The model never sees it." beside it, then Save and Cancel.
- **Keep rules**: same table with K-numbers, no colours. A Keep rule's hits (this week, all time, last hit) count only its Rescues, the videos it kept that a remove Rule or Banned channel would otherwise have removed (`decision-engine.md` Section 1.1). Thumbnail Keep rules are not offered in v1. Kind picker: Topic, Channel, Artist channel, Title keyword, Pattern, Regular expression (while regex Rules are on), Duration, Short, Live. Artist channel is offered only here and has no text field: a muted hint says what it keeps and that Shorts shelf videos never match (`rules.artistChannel.hint`), and it saves "Artist channels" (`rules.text.artistChannel`) as its text, as Short and Live save a default text. Expanded row: the same wall titled "Kept this week", showing each video this Keep rule rescued this week once, newest first (read from `keptByRule` Activity events, one per video and day), with the same link. Adding a Keep rule for a Banned channel asks "Lift the ban on Hustle Daily too?".
- **Views rules** (Rules and Keep rules): both kind pickers offer Views after Duration, and the table's kind column says Views. The add row shows two fields, "At least (views)" and "At most (views)" (`rules.views.min`, `rules.views.max`), that take plain numbers, commas and k, m or b (`10k`, `1.5m`). Save stays disabled until one bound is a count and the lower is not above the upper. A muted hint under the row (`rules.views.hint`) says how to type the counts and that videos whose view count YouTube shows in another language, and live streams, never match. A Views rule works on YouTube only, so its "Works on" boxes show only YouTube checked, both disabled (REQ-RULE-15). With no text typed, the Rule saves "Fewer than 1k views", "More than 1m views" or "Between 10k and 1.5m views" (`rules.views.*`) as its text.
- **Banned channels**: channel name, its Site ("YouTube", "Bilibili", or "All sites" for a name typed for every Site), how it got there (you, or Escalation with date), videos removed, remove from list.
- **Exceptions**: dense list of kept videos (title, channel and Site, date, and the Rule that wanted it gone, "● Crypto wanted it gone", where only the Rule's name truncates), search, delete.
- **Activity**: sticky guide labels per day with the day's Removals ("Today · 17 shooed"). Rows: time, thumbnail, title over channel and Surface with its Site ("Bilibili Home", `settings.surfaces.where`), the Rule (swatch + name, or its text without one, truncated, full text as tooltip, a Keep rule with its hollow ring) over the Activity kind (Removed, Kept, Kept by Keep rule, Would remove, Failed, Escalated, Banned channel, Undone, Shelf dismissed), actions (Undo while the Site still offers it on an open tab, Keep, Always keep this channel). Unseen rows are `--lit` until scrolled into view for 1 s (persisted as `seenAt`). Kept by Keep rule rows are Rescues only, have no actions and are stored as seen, so they are never lit. Search and filters by Rule (grouped as Rules, Keep rules and Banned channels, each named by its name or text), Activity kind, Site and batch. Thumbnail-wall view toggle for Removals. Below 48rem of list width the row stacks: the Rule and Activity kind under the title, the actions under them, so neither squeezes the title.
- **Connection**:
  - Where Shoo checks videos (`connection.provider.title`): the same provider picker as onboarding step 2 (Section 7), with the provider in use selected and marked "In use". OpenRouter selected shows its block: `Connect OpenRouter` (OAuth) or `Paste a key`. When connected: key label, connect date, usage today and the key's limit from OpenRouter, `Disconnect` (forgets the key on this device and links to openrouter.ai/keys to revoke it). Reconnecting warns first: "Connecting again creates a new key. Revoke the old one at openrouter.ai/keys." A direct Decision provider selected shows its setup (`DirectSetup` in `src/ui/pages/EndpointSetup.tsx`, the same component as onboarding), starting from the saved model, with "Leave blank to keep the saved key." under the key field. For the provider in use the button reads `Save changes` and stays disabled until a field changes. Here the consent callout also repeats the compact "What Shoo sends" disclosure and its button reads `Give consent`.
  - With a direct provider or a chat model in use, a semibold line above the picker says what is in use: "Using {model} at {provider} ({host}).", "Using {model} on this computer ({host})." or "Using the chat model {model} at {host}.", and the consent line reads "You gave consent for {host} on {date}." Selecting OpenRouter then shows its block and, once an OpenRouter key is connected, "Switching back to OpenRouter asks for consent again." and a primary `Use OpenRouter`, the same place every other row has its `Use {provider}`. Without a key only `Connect OpenRouter` and `Paste a key` show. The popup names that host when it refuses Shoo or stops answering (`popup.state.endpointRejected`, `popup.state.breakerEndpoint`).
  - Consent: shows what is sent (the same disclosure as onboarding step 1, compact, Section 7), then a `Privacy policy` link to the hosted policy (`PRIVACY_POLICY_URL` in `src/ui/pages/nav.ts`, opens in a new tab), and, for users who chose Exact rules only, a `Give consent` button that runs the same consent flow as onboarding.
  - Model picker (live list, image-capable models marked, OpenRouter only), Filtering strength presets with one sentence each.
  - Chat model (a closed disclosure at the end, open while a chat model is in use, `connection.chat.title`, with "Less accurate" as plain muted text, like "Recommended" and "In use"): one sentence on why it is less accurate (it rates its own answers, and Filtering strength was not tuned for them), "Titles only. Thumbnail rules need a Decision model that reads images." with an `image-off` icon, then Base URL with "On this computer: Ollama · LM Studio" text buttons that fill in their address, key (optional), model, and `Use this chat model`. With Ollama's port, the `OLLAMA_ORIGINS` line shows as a numbered step. Same save flow as a direct provider.
- **Sites** (REQ-SITE-1): heading and "Where Shoo works. Every Rule works on all of them unless you limit it to one site." Then one card per Site: a row with the Site name (15 px bold), a hint ("Shoo works on YouTube wherever it's switched on below." or "Off. Shoo does nothing on Bilibili.") and its switch, over a `--line-strong` rule, then its Surfaces indented 24 px, each with its switch. YouTube: Home, Watch sidebar, Shorts shelf on, Search, Channel page and End screen disabled with the reason "YouTube offers no Not interested here", with the note beside the Shorts shelf switch: "Shorts show no channel, so channel Rules can't match here. Shoo uses Not interested only." Under YouTube's Surfaces, "Whole shelves on Home" (`settings.shelves.title`, with "Auto and Review only" at the sub-heading's right) holds the two Shelf dismissal switches (REQ-ACT-6), both off by default: Shorts shelf ("Shoo picks the shelf's own "Show fewer Shorts" for you.") and Games shelf ("Shoo picks the shelf's own "Show fewer games" for you."). They follow YouTube's switch like its Surfaces. A Shelf dismissal row in Activity shows the Shelf ("Shorts shelf", "Games shelf") as its title, YouTube Home as its Surface, no thumbnail, no Rule and no actions. Bilibili has no Shelves. Bilibili: Home on, Video page disabled with "Bilibili offers no Not interested here". While a Site is off its Surface labels are `--muted` and their switches disabled, keeping their own state. When the browser took a Site's host access away, a danger notice under its row says so ("Shoo has no access to Bilibili. It was taken away in your browser's settings.") with `Allow access`, which asks the browser in the click. A refused prompt changes the notice to "The browser didn't give Shoo access to Bilibili."
- **Advanced**: notification style, Escalation (Off / Suggest / Automatic), daily cap, exact Filtering strength slider, regex Rules switch, import/export, `Reset` (deletes everything Shoo stored, with a confirmation step).

Empty states use the light wink once each, for example Rules: "Nothing to shoo yet. Add a Rule, or start from one of these." with starter Rule chips. Activity: "Quiet so far. When Shoo acts, it shows up here."

## 7. Onboarding (extension page opened on install)

Four steps on one page, a progress line at the top (four 6 px bars, `--ink` up to the current step, not numbered section labels), and the step itself in one card. Closing the page mid-way resumes at the same step next time Settings opens.

1. **What Shoo does** and **what it sends**, the welcome screen. The step heading "Shoo the videos you don't want" (`onboarding.what.heading`, the progress line still says "What Shoo does"), three lines on what Shoo does, each with a 16 px ink Lucide icon (`list-checks` checks the videos YouTube and Bilibili recommend against your Rules, `ban` tells the site "Not interested" through its own menu, `undo-2` shows the Rule and takes it back, `onboarding.what.does.*`), then the "What Shoo sends" disclosure. The disclosure presents the facts of REQ-PRIV-1 in `requirements.md` as structured sections. It must contain every fact of REQ-PRIV-1 and nothing else, and REQ-PRIV-1 wins if they ever differ. The same component (`src/ui/pages/Disclosure.tsx`) renders it here and in Settings, Connection ("What Shoo sends" and the custom endpoint consent), compact there (13 px).

   Layout: a 15 px title "What Shoo sends" over a `--line-strong` rule, then four ruled rows. Each row has a 16 px Lucide icon and a semibold heading in an 11rem left column, and the content on the right. A container query sets the two columns only when the disclosure itself is at least 36rem wide, so it stacks heading above content on phones and inside the narrow custom endpoint callout. List items carry a muted 16 px icon. Every "Never sent" item carries `x`, so the row reads as a negation without colour.

   | Row (icon) | Content (copy keys under `onboarding.what.sends`) |
   |---|---|
   | For each video Shoo checks (`square-play`) | Title, Channel name, Length, "Where it appeared: YouTube's Home, Watch sidebar or Shorts shelf, or Bilibili's Home", "Thumbnail image, only if you create a Thumbnail rule" |
   | Also in each request (`file-text`) | "The text of your Topic and Thumbnail rules, and of Keep rules you wrote as a sentence, while they are on", "Titles and channel names of up to 10 videos you chose to keep" |
   | Who receives it (`send`) | `globe` "**OpenRouter** (openrouter.ai), which passes it to the model provider", then one indented `corner-down-right` line each: **Cloudflare** by default, with the model cloudflare/clef-flash, **TypeSafe** if Shoo falls back to the model typesafe/jev-1.13, **OpenAI** if a thumbnail check falls back to openai/gpt-6-luna-decisions, **The provider of another model** if you pick one in Settings. Then, at OpenRouter's level and not under it, `server` "**Instead of OpenRouter** only if you choose one, and Shoo names its address first", with one indented line each: **Cloudflare, TypeSafe or Perplexity** reached directly with your own key, **A model on this computer** (Ollama, llama.cpp or LM Studio), so nothing leaves your device, **Your own endpoint** if you set one up. These receive the data instead of OpenRouter, never as well |
   | Never sent (`eye-off`) | Web addresses, Video IDs, including Bilibili's BV ids, Your watch history, Cookies, Comments, The page's HTML, Your YouTube or Bilibili account details |

   Row headings are `h4` under the `h3` title (`h3` inside the custom endpoint consent, which has no title), and each row's items are a list, so screen readers can move by section. The store listings and the privacy policy keep their own prose (`docs/release/`). Any change to these rows raises `CONSENT_VERSION` (`src/store/schema.ts`, 2 since the recipients were widened, 3 since the rows name Bilibili), so everyone who agreed to the old text is asked again.

   Buttons, after the disclosure: `Agree and continue` and `Use Exact rules only`, with "You can change this later in Settings, Connection." beside them (`onboarding.what.later`). On Firefox, `Agree` first requests the optional `websiteContent` data-collection permission in the same click (see `cross-browser-and-stores.md`). Declining Firefox's prompt is treated as `Use Exact rules only`. The step is about 1,050 px tall, so in a 1280×800 window the buttons sit below the fold and the user scrolls past the whole disclosure to reach them. The store screenshot is captured at 1680×1050 and scaled to 1280×800 so it shows the whole step (`docs/release/chrome-web-store.md`, Screenshots).
2. **Connect**: heading "Choose where Shoo checks videos" (`onboarding.connect.heading`, the progress line still says "Connect") and one sentence. Decision models only: no chat model here (ADR 0007). Then the provider picker (`ProviderPicker`), one radio group named "Where Shoo sends videos" in two ruled columns, which stack below 640 px: **Online** (`cloud`) with OpenRouter (preselected, "Recommended"), Cloudflare, TypeSafe and Perplexity, and **On this computer, most private** (`laptop`) with Ollama, llama.cpp and LM Studio, whose hints end "No key needed." Each online hint says whether it reads thumbnails. Rows are the Mode step's ruled radio rows (name, one muted sentence, `tint` when selected). Arrow keys move through all seven.

   Under the picker, the selected choice:
   - OpenRouter: "Connecting creates a key for Shoo on your OpenRouter account." plus the cost note ("a few cents per thousand videos"), `Connect OpenRouter` primary, `Paste a key` secondary (REQ-MODEL-4).
   - A direct Decision provider (`DirectSetup`, REQ-MODEL-7): up to three muted facts with icons: "Shoo sends to {host}." (`cloud`, or `laptop` and ", on this computer"), what it reads (`image` "Reads thumbnails, so Thumbnail rules work too." or `image-off` "Titles only. Thumbnail rules need a model that reads images."), and, unless it is clef-flash at Cloudflare, how Filtering strength fits (`gauge`: "tuned on clef-flash at Cloudflare. A copy on this computer may score a little differently." or "tuned on clef-flash, so {model} may remove more or fewer videos."). Cloudflare: one sentence on where the dashboard shows the account ID and creates a token, with `Open Workers AI`, then Account ID (32 hex characters, checked inline), Cloudflare API token, and "Model clef-flash, the one Filtering strength was tuned on." TypeSafe and Perplexity: "{provider} API key" with `How to get a key`, and the model, prefilled and editable. On this computer: numbered steps with each command in a `lit` code block (radius 14) with a `Copy` button named for its command, which announces "Copied." (Ollama: `ollama pull <model>` and the `OLLAMA_ORIGINS` line for this install's origin and OS, with "Other ways to set it" linking Ollama's FAQ. llama.cpp: `llama-server -hf ggml-org/Clef-Flash-GGUF --alias clef-flash`. LM Studio: load a decision model, start the server), then Model and Address, prefilled.
   - The primary button `Use {provider}` says what is missing beside it while disabled ("Paste your TypeSafe API key to continue.", "Enter your Cloudflare account ID to continue."). It requests host access as the first statement of the click, checks a model on this computer with one synthetic title (fields locked meanwhile), then replaces itself with a `lit` consent callout that takes focus: "Shoo will send what's listed under What Shoo sends to {host}, instead of OpenRouter." (plus "{host} is this computer, so nothing leaves it." for a local one) with `Agree and continue` and `Cancel`, which returns focus to the button. The user read "What Shoo sends" one step earlier, so onboarding does not repeat it there. Agreeing records consent naming the host, saves the provider and moves to step 3.

   With the default OpenRouter choice the step fits 1280×800 without scrolling. Skipped when the user chose Exact rules only, who can pick any provider later in Settings, Connection.
3. **First Rules**: starter chips (Reaction videos, Clickbait, Get-rich-quick, Celebrity gossip, Shorts) plus a free field (placeholder "Unboxing videos and hauls", or "A word in titles" with Exact rules only). For Topic rules the tip "Describe the videos, like “Unboxing videos and hauls”. One idea per Rule." sits under it and turns into a soft hint while the text reads as an order or a negation. Each chip turns into its Rule as it is added, showing its colour and the chip label, which becomes the Rule name (REQ-RULE-11), with the Rule text as tooltip, and the eyes glance at it. Rules from the free field list under it by their text. With Exact rules only, the Topic starters are shown disabled with "Needs consent".
4. **Mode**: three options with one sentence each, Review preselected. `Start` closes onboarding. The text buttons `Open YouTube` and `Open Bilibili` close it and open that Site in the current tab.

## 8. Screen states

Every state has a copy key (Section 9 explains the key format). Runtime reasons come from `architecture.md` (RuntimeState). When several apply, the highest-precedence reason wins, as defined there.

### Popup

| State | What shows | Copy key |
|---|---|---|
| Loading (first paint) | wordmark, skeleton rows for Today, controls disabled | `popup.state.loading` |
| Not on a Site | everything works, a line "Open YouTube or Bilibili to see Shoo at work." | `popup.state.notOnSite` |
| Off | eyes closed, Mode control disabled, `Turn on` | `popup.state.off` |
| Site off | the tab's Site is turned off in Settings, Sites: "Shoo is off on {site}." with `Turn on` | `popup.state.siteOff` |
| No Site access | a Site that is still on lost Shoo's host access: "Shoo has no access to {site}." with `Fix in Settings` (opens Settings, Sites) | `popup.state.noSiteAccess` |
| noConsent | "Shoo only uses Exact rules." with `Give consent` (opens Settings, Connection) | `popup.state.noConsent` |
| migrating | "Updating Shoo's data…", controls disabled | `popup.state.migrating` |
| hostRevoked | eyes error, "Shoo lost access to YouTube or your Decision model." with `Fix in Settings` | `popup.state.hostRevoked` |
| noKey | "Connect OpenRouter to use Topic rules." with `Connect` (opens Settings) | `popup.state.noKey` |
| breakerNativeAction / breakerMarkup | eyes paused, "Shoo paused: {site}'s menu changed." naming the Site that tripped it, with `Retry` and `Open settings` | `popup.state.breakerSite` |
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
- Catalogues: `src/locales/en.yml` (the default) and `src/locales/zh_CN.yml`, with the same keys, placeholders and plural groups (a unit test checks it). The browser's UI language picks the catalogue, not the Site's language. Chinese copy uses one Chinese term per glossary concept, and quotes each Site's own menu labels as the Site shows them.
- Leave room for 30% longer text in chips (truncate the Rule text, never the buttons).

## 10. Accessibility checklist (WCAG 2.2 AA)

- Text contrast ≥ 4.5:1 (all text tokens above pass on paper and ground). Component boundaries that must be perceived use `--edge` (at least 3.1:1 on paper and ground in both themes), and the on switch's orange track and checked boxes are at least 3.0:1 wherever they sit. Disabled controls are exempt and use `--stroke`. Rule dots are decorative, the Rule's name or R-number beside it carries the meaning.
- Focus ring on every interactive element: ink outline on extension pages, two-tone ring in-page. Never removed.
- Full keyboard use: settings tables (Tab order mandatory, arrow keys between rows optional), Mode segments (radio group with arrow keys), switches (`role="switch"`), chips (Section 4).
- Live regions: batch summary (polite), notices (assertive only when a category trips).
- Reduced motion honoured everywhere (moment, eyes, row transitions).
- Theme the browser surfaces: `::selection` in the light theme's orange at 24% in both themes, under `--ink` text (10.5:1 or more in light), thin scrollbars in `--edge`, caret and `accent-color` in the action colour, and native checkboxes and radios redrawn with a 1.5 px `--edge` border (filled orange when checked), handed back to the native controls under `forced-colors: active`.
- Target size ≥ 24 px everywhere, ≥ 44 px for full-chip buttons.
- Shoo's in-page keyboard handling never triggers YouTube shortcuts (Section 4).

## 11. Implementation notes

- Preact + Tailwind v4 with the tokens above as CSS custom properties and Tailwind theme variables. Hand-built components (`Button`, `Switch`, `Segmented`, `RuleRow`, `Swatch`, `VerdictPill`, `Eyes`, `Chip`, `Summary`, `Notice`), no shadcn/Radix.
- The `Eyes` component is pure SVG plus a small state machine (`watching | judging | review | paused | error`), driven by the RuntimeState the background broadcasts (`architecture.md`).
- The content script is one bundle (ADR 0006). In-page UI modules are imported normally but initialize nothing until the first Verdict that needs UI. Fonts ship only with extension pages.
- Identifier names follow `CONTEXT.md` and `architecture.md`: `Verdict.outcome` (`keep | remove`), `nativeAction`, `removeCutoff(strength)`.
