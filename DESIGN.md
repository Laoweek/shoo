---
name: Shoo
description: Calm ink beside YouTube, with colour only where a Rule acts.
colors:
  paper: "#fbfbfa"
  ink: "#121214"
  muted: "#5e5e65"
  muted-dark: "#a6a6ad"
  edge: "#8a8a8f"
  stroke: "#8a8a8f"
  line: "rgb(18 18 20 / 0.11)"
  line-strong: "rgb(18 18 20 / 0.22)"
  tint: "rgb(18 18 20 / 0.035)"
  lit: "rgb(18 18 20 / 0.06)"
  danger: "#c2410c"
  danger-dark: "#fb923c"
  c1-violet: "#6e4bff"
  c2-teal: "#00b39f"
  c3-amber: "#ffb000"
  c4-pink: "#ff4fa3"
  c5-lime: "#8bd100"
  c6-orange: "#ff8a3d"
  c7-sky: "#2ea8ff"
  c8-plum: "#b04bd8"
  c9-olive: "#9a9a2e"
  c10-slate: "#6b7a8f"
typography:
  wordmark:
    fontFamily: "Bricolage Grotesque, Geist, sans-serif"
    fontSize: "26px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.03em"
  display:
    fontFamily: "Bricolage Grotesque, Geist, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  numeral:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
    fontFeature: "tnum"
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: "-0.01em"
  lede:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  input:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
  dense:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.35
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.35
  inpage-headline:
    fontFamily: "system-ui, -apple-system, Segoe UI, Ubuntu, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.25
    fontFeature: "tnum"
  inpage-body:
    fontFamily: "system-ui, -apple-system, Segoe UI, Ubuntu, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.35
rounded:
  swatch: "2px"
  link: "4px"
  control: "6px"
  surface: "10px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  row: "40px"
  hit-min: "24px"
  hit-primary: "44px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "30px"
  button-primary-large:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "44px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "30px"
  button-outline-hover:
    backgroundColor: "{colors.tint}"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.link}"
    height: "24px"
  segmented:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "2px"
  segmented-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
  switch-off:
    backgroundColor: "transparent"
    rounded: "{rounded.pill}"
    width: "34px"
    height: "20px"
  switch-on:
    backgroundColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    width: "34px"
    height: "20px"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.input}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "36px"
  rule-swatch:
    rounded: "{rounded.swatch}"
    size: "8px"
  verdict-pill:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    padding: "0 12px 0 10px"
    height: "34px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "36px"
  nav-item-current:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "36px"
  inline-callout:
    backgroundColor: "{colors.lit}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "12px 16px"
  review-chip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.inpage-body}"
    rounded: "{rounded.surface}"
    padding: "6px 6px 6px 10px"
  dry-run-label:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.muted}"
    typography: "{typography.inpage-body}"
    rounded: "{rounded.surface}"
    padding: "4px 10px 4px 8px"
  duplicate-note:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.muted}"
    typography: "{typography.inpage-body}"
    rounded: "{rounded.surface}"
    padding: "4px 10px 4px 8px"
  batch-summary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "14px 14px 12px 16px"
    width: "320px"
---

# Design System: Shoo

## Overview

**Creative North Star: "Quiet Ink, Loud Moments"**

Shoo sits next to YouTube's busy feed, so it stays calm. Everything is near-black ink on a near-white paper, or the exact inversion in dark mode. Pages are built from compact ruled rows, tabular figures and plain sentences. There are no cards as page structure, no brand accent and no decoration. The feed stays the star.

Colour has one job. Every Rule owns a colour code, and its swatch appears beside the Rule's name (or its text when it has none) wherever a Verdict does: the Review chip, Try a title, Activity and the Batch summary. In the Settings tables the swatch sits beside the Rule's permanent R-number. The interface gets loud only at moments, when Rule colours fly into the Batch summary and the logo's eyes blink once.

The only character in the product is the living wordmark: "Sh" followed by two eyes that show what Shoo is doing. Density is high but unhurried: 13 to 14 px text, 40 px rows, generous whitespace around a single 880 px column.

**Key Characteristics:**
- Ink on paper, dark mode is the exact inversion, never a second palette.
- Colour belongs only to Rules, and to `danger` text for errors.
- State changes by inversion: selected, pressed and current are ink-filled with paper text.
- Ruled rows instead of containers. Shadows only on surfaces that float over YouTube.
- Two type voices on extension pages (Bricolage Grotesque for the wordmark and section headings, Geist for everything else) and the system stack inside YouTube.
- The eyes are the logo, the status light and the only personality.

## Colors

A monochrome ink system with ten saturated Rule colours held in reserve for one purpose.

### Primary
- **Press Ink** (`ink`): text, primary buttons, the selected segment, the current nav item, switch tracks when on, the Verdict pill, focus rings and the eyes. In dark mode it swaps with paper.

### Neutral
- **Ledger Paper** (`paper`): the ground of every page, popup and floating in-page surface. In dark mode it becomes the ink value.
- **Pencil Grey** (`muted`, `muted-dark` in dark mode): secondary text, ledes, hints, table headers, timestamps.
- **Edge Grey** (`edge`): boundaries that must be seen (WCAG 1.4.11): input borders, outline buttons, switch tracks when off, Segmented outline, the dashed Dry-run label.
- **Stroke Grey** (`stroke`, same value as edge): icons at rest, disabled outlines, the disabled primary button fill, scrollbar thumbs.
- **Hairline** (`line`): row rules and dividers. Decorative only, never the only boundary of a control.
- **Strong Hairline** (`line-strong`): table header rules, the swatch ring, the dashed border of the Try a title slip.
- **Tint** (`tint`): hover, expanded Rule rows, the Add a Rule draft row.
- **Lit** (`lit`): "lit until seen" Activity rows, inline callouts (Escalation strip, confirm prompts), skeleton bars.
- **Burnt Signal** (`danger`, `danger-dark` in dark mode): error text only, never a fill or a border.

### Rule colour codes
Ten codes (`c1-violet` through `c10-slate`), assigned in order when a Rule is created and stored with it, so a Rule keeps its colour forever. After c10 the sequence repeats. Keep rules get no colour and show a hollow ink square with `K1`, `K2`.

### Named Rules
**The Colour Belongs to Rules Rule.** A Rule colour appears only as an 8 px swatch or as a flying square in the moment, always next to the Rule's name, text or R-number. Nothing else in the interface is coloured except `danger` text. Never set text in a Rule colour.

**The Inversion Rule.** Selection and current state are shown by swapping ink and paper, never by an accent colour.

**The Exact Inversion Rule.** Dark mode swaps paper and ink and raises the alpha of the hairlines and tints slightly. It never introduces new hues. Only `muted` and `danger` take a lighter dark value, for contrast.

## Typography

**Display Font:** Bricolage Grotesque (with Geist, sans-serif), variable, optical sizing on
**Body Font:** Geist (with ui-sans-serif, system-ui, sans-serif)
**In-page Font:** the system UI stack (system-ui, -apple-system, Segoe UI, Ubuntu, sans-serif)

**Character:** Bricolage Grotesque gives the wordmark and section headings a slightly quirky, inky weight. Geist keeps every working label crisp and neutral. Inside YouTube, the system stack reads as distinct from YouTube's Roboto without shipping a font, and the eyes carry the identity.

### Hierarchy
- **Wordmark** (Bricolage 800, 26 px in Settings, 22 px in the popup, tracking -0.03em): the letters "Sh" only. The eyes replace "oo".
- **Display** (Bricolage 700, 30 px, line height 1.1, tracking -0.025em): one per view, the Settings section heading and the onboarding step heading.
- **Numeral** (Geist 600, 20 px, line height 1.1, tracking -0.02em, tabular): the popup's Today counts.
- **Title** (Geist 700, 15 px, tracking -0.01em): sub-headings such as "Your Rules", over a strong hairline.
- **Lede** (Geist 400, 15 px, line height 1.55, max 60 to 64ch): onboarding body copy and the one plain sentence under a section heading.
- **Body** (Geist 400, 14 px, line height 1.5): default text on extension pages, buttons at medium size.
- **Input** (Geist 400, 16 px): every text field, so nothing zooms and typed Rules read clearly.
- **Dense** (13 px, line height 1.35): hints, status lines, in-row metadata, small buttons and the whole in-page UI.
- **Label** (Geist 600, 12 px, `muted`): field labels, table headers, nav counts, meta. Sentence case, never uppercase.
- **In-page headline** (system 600, 16 px): "Shooed 4 videos" in the Batch summary, 14 px for notices.

### Named Rules
**The Two Voices Rule.** Bricolage Grotesque is for the wordmark letters and the single 30 px heading per view. Every other string on extension pages is Geist. In-page UI uses the system stack and no bundled font at all.

**The Tabular Rule.** Every count, cost, percentage, R-number and time uses tabular figures.

**The Px Only Rule.** In-page UI sizes everything in px, never rem, because YouTube sets the root font size to 10 px.

## Layout

Settings is a two-column ledger: a 200 px sticky section index on the left, separated by a hairline, and a main column capped at 880 px inside a 1200 px frame. Below the `md` breakpoint the index becomes a wrapping row above the content with a hairline below it. The popup is a fixed 360 px column with 16 px side padding and one rhythm: 16 px between groups and on both sides of every hairline, 8 px from a control to its caption, 12 px above the header row and around the footer row. Its type keeps to 12 px (figure labels), 13 px (captions, status lines, footer), 14 px (controls and notices), 16 px (the field), 20 px (Today counts) and the 22 px wordmark. The three Today figures sit on equal thirds, under the three Mode segments. Onboarding is a single 760 px column with a four-step progress bar of 4 px ink segments. Its first step, the welcome screen, sets the "What Shoo sends" disclosure as four ruled rows (icon and heading left, items right), which Settings, Connection reuses at 13 px. Its second step sets the Decision provider picker as one radio group in two ruled columns, "Online" and "On this computer, most private", each under a 12 px muted label with a 14 px icon, stacking below 640 px. Settings, Connection opens with the same picker under "Where Shoo checks videos", and ends with the chat model in a closed disclosure.

Spacing follows a 4 px base in 4, 8, 12, 16 and 24 px steps, with 32 to 48 px only between page-level regions. Inside a Settings section: 24 px between groups, 16 px between a heading and its content and on both sides of a hairline, 8 px from a sub-heading to its table and from a control to its caption, 16 px from a table to the add button after it, 12 px inside ruled settings and tip rows. Lists and tables inset their cells 8 px. The Activity list, the Exceptions list and the Banned channels table respond to their own width, not the window's. An Activity row goes on one line only where the list is at least 48rem wide. Narrower, the Rule and its Activity kind take a line under the title and the actions a line under that, and below 32rem the thumbnail drops. Exceptions drops the Rule and date below 42rem. Banned channels drops Added below 42rem and Removed below 32rem. Lists are dense: 40 px rows, 30 px table headers, 44 px settings rows. Hit targets are at least 44 px for the full Review chip, at least 24 px everywhere else (WCAG 2.5.8). Small visual controls reach the larger target with an invisible overlay rather than growing.

The Rules table is a real table with fixed column widths. On narrow windows the Kind column collapses to zero width and the kind moves under the Rule text.

## Elevation & Depth

Flat by default. Pages separate content with hairline rules and tonal fills (`tint`, `lit`), never with shadows or borders around sections. Only surfaces that float above YouTube or the page carry a shadow, and they carry no border.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 18px 48px -18px rgb(18 18 20 / 0.28), 0 2px 6px rgb(18 18 20 / 0.06)`, dark: `0 18px 48px -18px rgb(0 0 0 / 0.7), 0 2px 6px rgb(0 0 0 / 0.4)`): the Review chip, the Batch summary, in-page notices and the collapsed summary pill.
- **Float ring, dark only** (`box-shadow: 0 0 0 1px var(--line-strong), var(--shadow)`): the Batch summary, notices and the collapsed summary pill in dark mode. On YouTube's `#0F0F0F` ground the dark Float barely shows under a `#121214` panel, so a 1 px `line-strong` ring becomes the first layer of the same shadow. The Review chip keeps the plain Float.

### Named Rules
**The One Method Rule.** Each element uses exactly one way to show depth. Rows use rules. Floating surfaces use the Float shadow and no border. Inline callouts use a `lit` fill and no shadow. The dark Float ring is the one recorded exception in look, not in method: it is drawn inside the shadow, never as a border.

## Shapes

Small, consistent corners on a strict ladder: 2 px on Rule swatches, 4 px on text-button focus areas and thumbnails, 6 px on every control (buttons, inputs, selects, nav items, icon buttons), 10 px on surfaces (Review chip, Dry-run label, the "Already shooed above" note, Batch summary, notices, the Try a title slip, the Escalation strip), and full pills for the Verdict pill, Segmented, switches, Starter rule chips, progress bars and the collapsed summary pill. Borders are 1 px, or 1.5 px on Segmented and switch tracks. Dashed outlines mark things that are tentative: the Dry-run label (`edge`) and the Try a title slip (`line-strong`).

**The Radius Ladder Rule.** Pick the radius by role, not by taste: 6 px for anything you press, 10 px for anything that holds content, a full pill only for small status shapes and binary or segmented controls.

## Components

### Buttons
Plain, firm and ink-led.
- **Shape:** gently squared (6 px), 1 px border.
- **Primary:** ink fill, paper text, Geist 600. Sizes 24 px (dense rows, 13 px text), 30 px (default, 14 px), 44 px (onboarding's primary actions). Beside a 36 px field, a button takes the field's height. Icon and label sit 8 px apart. Hover drops opacity to 90%. Disabled fills with `stroke`.
- **Outline:** transparent with an `edge` border and ink text. Hover fills with `tint`.
- **Text:** ink text underlined at 1 px with a 3 px offset, thickening to 2 px on hover. Keeps a 24 px hit target. Used for fixes inside notices and secondary actions such as "Undo all".
- **Icon button (in-page compact chip):** 24 px square, 6 px radius, `edge` border, 16 px Lucide icon at stroke 1.75: `ban` for Remove (ink-filled), `check` for Keep, `user-check` for "Always keep this channel". Each carries an accessible name.
- **Focus:** a 2 px ink outline at 2 px offset on extension pages. In-page, a two-tone ring (2 px paper then 2 px ink) so it shows over any thumbnail.

### Segmented control and Switch
- **Segmented:** a pill with a 1.5 px `edge` outline and 2 px inner padding. The selected segment is an ink pill with paper text. 30 px tall everywhere, the popup included. Arrow keys move the selection.
- **Switch:** a 34 by 20 px pill track. Off is an `edge` outline with an ink knob. On is an ink track with a paper knob that slides 14 px with the expo ease.

### Inputs / Fields
- **Style:** transparent, 1 px `edge` border, 6 px radius, 36 px tall, 16 px text, `muted` placeholder.
- **Labels:** 12 px semibold `muted`, above the field.
- **Inline edit:** Rule text in the table is a borderless field that shows a `line-strong` border on hover and an `edge` border on focus. The name and text lines are 24 px tall at 14 px (30 px when the Rule has no name).
- **Error / Disabled:** errors appear as 13 px `danger` text 8 px below the field. Disabled fields drop to 55% opacity.

### Navigation
- **Settings index:** 14 px Geist 500 items, 36 px tall and 4 px apart, with 6 px radius and text 24 px from the frame (16 px on narrow windows, in line with the content). Hover fills with `tint`. The current section is ink-filled with paper text and its count turns paper at 70%. Counts sit right-aligned in 12 px tabular `muted`. A hairline footer shows the Mode and Filtering strength.

### Rule reference (signature)
The swatch and label pair that names a Rule. An 8 px square with a 2 px radius and a 1 px `line-strong` ring, then the Rule name (or its text when it has none) on one line, in its own bidi run, cut with an ellipsis before anything else shrinks, with the full Rule text as tooltip. Inside a sentence ("■ Crypto wanted it gone") only the name truncates. On YouTube the label is bold and no R-number shows. In the Settings tables (Rules, Keep rules, Banned channels) the pair is the swatch and the R-number in bold tabular ink. Switched-off Rules grey the swatch and mute the number.

### Verdict pill (signature)
A 34 px ink pill with paper text that reads "Remove · 91%" ("Remove" for Exact rules), "Keep" or "…" while judging. The swatch inside gets a 2 px paper outline so it reads on ink. Its accessible name spells out the Rule ("Verdict: Remove, Rule: Crypto, 91 percent"), and the line under it names the deciding Rule with its swatch.

### How to write a Rule
A native disclosure under the Rules lede (chevron and 14 px semibold summary), open while there are no Rules. Ruled tip rows in 14 px body text with 12 px above and below, the tip title in a 14rem left column. Try and Not examples sit side by side, told apart by word and icon (`check`, `x`), the Not example in `muted`, never by colour and never struck through.

### Inline callouts
The Escalation strip and confirm prompts are `lit` fills with a 10 px radius and no border or shadow. Commands to copy (the Ollama setup lines) use the same `lit` 10 px block with 13 px monospace text, because they are code, and a small outline `Copy` button at the right. The Try a title slip is the one bordered container: a dashed `line-strong` outline, 10 px radius, with the Verdict pill at its right.

### In-page Review chip, Dry-run label and Batch summary
- **Placement:** the Review chip, the Dry-run label and the kept note sit at the thumbnail's bottom-left, inset 8 px, clear of YouTube's bottom-right duration badge. Max width is the room left of the badge minus an 8 px gap (a 64 px zone is kept free when no badge shows). When the content's narrowest width does not fit there, it sits 8 px above the badge at thumbnail width minus 16 px (with no badge, it keeps the corner at that width). YouTube's badge is never restyled, hidden or covered.
- **Review chip:** paper at 96% opacity, Float shadow, 10 px radius, 13 px system text. Tiny eyes behind a hairline divider, then "Remove?", the Rule reference (swatch and label) and probability, then Remove (primary) and Keep (outline). Below a 320 px thumbnail width the compact variant stays on one row (no wrapping) and swaps the buttons for 24 px icon buttons.
- **Kept note:** replaces the chip for 4 s after Keep. The compact note is one row: eyes, "Kept" at 600 weight and the `user-check` icon button named "Always keep this channel". The full sentence stays for screen readers.
- **Removed-Tile annotation:** reads as part of YouTube's own placeholder card, no surface of its own. It spans YouTube's content column (the edges of YouTube's buttons) and is centred like YouTube's stack, with as much air above it as below. Line one: eyes, `muted` "Shooed by" ("Channel shooed by" on YouTube's "Don't recommend channel" placeholder), the Rule reference (swatch and label, the one text that shrinks), then Keep and "Always keep this channel" as text buttons. On narrow placeholders the channel action becomes the `user-check` icon button and then "Shooed by" drops, so line one stays one line (on the narrowest "Don't recommend channel" card it may wrap inside the cover). Where the band above YouTube's sentence leaves less than 8 px on a side, it takes the sentence's place: it covers the room above YouTube's first button, centred in it, in the colour YouTube paints there (read from the page, paper only as a fallback), so the card shows no patch. It never covers YouTube's buttons. A second line, flush under the first, names what was removed: the title in `ink`, then a `·` and the channel in `muted` (the channel leads, in `ink`, on the "Don't recommend channel" placeholder, and the Shorts shelf shows the title alone). It is one line with an ellipsis, the title truncating first, at least 8 px above YouTube's sentence (or inside the cover). Where two lines would reach YouTube's buttons, the title takes the place of "Shooed by" in line one.
- **Dry-run label:** same shape, passive. `muted` text, a dashed 1 px `edge` outline, no shadow, not focusable.
- **"Already shooed above" note:** a duplicate of a removed video sits over its thumbnail, so it takes the chip surface: paper at 96%, 10 px radius, padding 4 px 10 px 4 px 8 px, no shadow and no outline. Its contrast comes from the tokens, never from the picture.
- **Batch summary and notices:** a 320 px paper panel with the Float shadow docked bottom-right (dark mode adds the Float ring). Eyes plus a 16 px headline, a short list of Rules, one row each (swatch, label, count right-aligned in muted tabular figures), at most 3, or 2 and a muted "+N more Rules" line, then actions. It rises 8 px over 240 ms with the expo ease and only fades when motion is reduced. Notices use `danger` for the headline only.

### Living wordmark and eyes (signature)
Two ink-stroked circles with solid ink pupils, always ink on paper, never coloured. States: watching (open, slow drift), judging (glance), review (squint), paused (closed) and error (wide). On extension pages the pupils follow the pointer and widen over a hovered Rule row. In-page the eyes stay still except for one glance when a Verdict lands and one blink when the Batch summary appears. Reduced motion stops all eye motion. The state always has a text equivalent.

### Moment (signature motion)
When Auto mode removes Tiles, each Tile sends an 8 px square in its Rule colour along an arc to its Rule's swatch in the summary (560 ms, `cubic-bezier(0.16, 1, 0.3, 1)`, 40 ms stagger, at most 12 squares), then the eyes blink once.

### Skeleton
Static 40 px rows with `lit` and `tint` bars on hairlines. No shimmer.

## Do's and Don'ts

### Do:
- **Do** pair every Rule colour with the Rule's name, text or R-number, at 8 px with a 2 px radius and a `line-strong` ring.
- **Do** show selected, pressed and current states by ink fill with paper text.
- **Do** separate rows with `line` hairlines and keep page sections free of containers.
- **Do** use `edge` for any boundary a user must see to operate a control.
- **Do** set every count, cost, time and R-number in tabular figures.
- **Do** keep one 30 px Bricolage heading per view, followed by one plain sentence in `muted`.
- **Do** give floating in-page surfaces the Float shadow, paper ground and a 10 px radius, with no border.
- **Do** use px only, the system font stack and the two-tone focus ring inside YouTube.
- **Do** respect reduced motion: no pointer tracking, no blink, no flight, a 150 ms fade at most.

### Don't:
- **Don't** colour anything except Rule swatches, the moment's squares and `danger` error text.
- **Don't** set text in a Rule colour or tint a button, link or selection with one.
- **Don't** use YouTube red or anything that could pass for a YouTube control.
- **Don't** restyle, hide or cover YouTube's thumbnail badges. In-page UI moves out of their way.
- **Don't** add a brand accent, gradients, gradient text or glass.
- **Don't** wrap sections or settings rows in cards or stat tiles.
- **Don't** put an uppercase label or eyebrow above a heading.
- **Don't** combine a border and a shadow on one element.
- **Don't** use emoji or Unicode glyphs as icons. Icons are Lucide at 16 px, stroke 1.75, in `currentColor`.
- **Don't** colour the eyes or let them carry information that is not also in text.
- **Don't** add shimmer to loading states.
