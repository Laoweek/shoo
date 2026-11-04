---
name: Shoo
description: "Friendly App: soft white cards on a warm grey ground, plain-speech labels, and one bright orange that only marks what you can press."
colors:
  action: "#e4572f"
  action-hover: "#f06a40"
  on-action: "#1a1411"
  knob: "#ffffff"
  remove-bg: "#fde4e1"
  remove-fg: "#b4232a"
  keep-bg: "#ddf3e3"
  keep-fg: "#1e6b3e"
  ground: "#f4f1ec"
  paper: "#ffffff"
  ink: "#2b241f"
  muted: "#6f625a"
  edge: "#938780"
  stroke: "#cfc6bd"
  line: "rgb(43 36 31 / 0.09)"
  line-strong: "rgb(43 36 31 / 0.18)"
  tint: "rgb(43 36 31 / 0.045)"
  lit: "#fff3d6"
  danger: "#b4232a"
  dot-ring: "rgb(43 36 31 / 0.14)"
  action-dark: "#ff7a50"
  action-hover-dark: "#ff9370"
  on-action-dark: "#1b1816"
  knob-dark: "#1b1816"
  remove-bg-dark: "#4a2220"
  remove-fg-dark: "#ffb4ac"
  keep-bg-dark: "#1d3a28"
  keep-fg-dark: "#9ee0b5"
  ground-dark: "#1b1816"
  paper-dark: "#26221f"
  ink-dark: "#f2ede8"
  muted-dark: "#b3a89f"
  edge-dark: "#7a6f67"
  stroke-dark: "#4e4640"
  line-dark: "rgb(242 237 232 / 0.09)"
  line-strong-dark: "rgb(242 237 232 / 0.18)"
  tint-dark: "rgb(242 237 232 / 0.05)"
  lit-dark: "rgb(255 196 92 / 0.1)"
  danger-dark: "#ff9a8f"
  c1: "#5b8def"
  c2: "#3fae6e"
  c3: "#e3b23c"
  c4: "#e06b8b"
  c5: "#93c24f"
  c6: "#a97b54"
  c7: "#4fb6db"
  c8: "#d57fcb"
  c9: "#9677e0"
  c10: "#26a69a"
typography:
  wordmark:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.02em"
  display:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "48px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "36px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  numeral:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
    fontFeature: "tnum"
  subhead:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
  verdict:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    fontFeature: "tnum"
  lede:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  nav:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 500
  body:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  control:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
  input:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
  dense:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.35
  label:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
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
  inpage-control:
    fontFamily: "system-ui, -apple-system, Segoe UI, Ubuntu, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.35
rounded:
  link: "4px"
  checkbox: "5px"
  thumb: "6px"
  inline: "8px"
  field: "12px"
  chip: "12px"
  callout: "14px"
  card: "16px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  card: "20px"
  xl: "24px"
  region-sm: "32px"
  region-lg: "48px"
  hit-min: "24px"
  hit-chip: "44px"
  control: "36px"
  table-head: "34px"
  setting-row: "44px"
  rule-row: "60px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.on-action}"
    typography: "{typography.control}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.action-hover}"
    textColor: "{colors.on-action}"
  button-primary-disabled:
    backgroundColor: "{colors.tint}"
    textColor: "{colors.muted}"
  button-outline:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "36px"
  button-outline-hover:
    backgroundColor: "{colors.ground}"
  button-small:
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "28px"
  button-large:
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "44px"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.link}"
    height: "24px"
  button-add-rule:
    backgroundColor: "{colors.action}"
    textColor: "{colors.on-action}"
    typography: "{typography.control}"
    rounded: "{rounded.pill}"
    padding: "0 18px 0 14px"
    height: "40px"
  switch-on:
    backgroundColor: "{colors.action}"
    rounded: "{rounded.pill}"
    width: "36px"
    height: "20px"
  switch-off:
    backgroundColor: "{colors.edge}"
    rounded: "{rounded.pill}"
    width: "36px"
    height: "20px"
  switch-disabled:
    backgroundColor: "{colors.stroke}"
  switch-knob:
    backgroundColor: "{colors.knob}"
    rounded: "{rounded.pill}"
    size: "16px"
  segmented:
    backgroundColor: "{colors.tint}"
    rounded: "{rounded.pill}"
    padding: "3px"
  segmented-option:
    textColor: "{colors.muted}"
    typography: "{typography.control}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "30px"
  segmented-option-selected:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
  field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.input}"
    rounded: "{rounded.field}"
    padding: "0 12px"
    height: "36px"
  card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "20px"
  callout:
    backgroundColor: "{colors.lit}"
    textColor: "{colors.ink}"
    rounded: "{rounded.callout}"
    padding: "12px 16px"
  nav-item:
    textColor: "{colors.ink}"
    typography: "{typography.nav}"
    rounded: "{rounded.pill}"
    padding: "0 16px 0 14px"
    height: "40px"
  nav-item-hover:
    backgroundColor: "{colors.tint}"
  nav-item-current:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
  nav-dot-current:
    backgroundColor: "{colors.action}"
    rounded: "{rounded.pill}"
    size: "7px"
  swatch:
    rounded: "{rounded.pill}"
    size: "10px"
  rule-number:
    textColor: "{colors.muted}"
    typography: "{typography.body}"
  verdict-remove:
    backgroundColor: "{colors.remove-bg}"
    textColor: "{colors.remove-fg}"
    typography: "{typography.verdict}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "36px"
  verdict-keep:
    backgroundColor: "{colors.keep-bg}"
    textColor: "{colors.keep-fg}"
    typography: "{typography.verdict}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "36px"
  verdict-pending:
    backgroundColor: "{colors.tint}"
    textColor: "{colors.muted}"
    typography: "{typography.verdict}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "36px"
  starter-chip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 16px 0 12px"
    height: "34px"
  starter-chip-added:
    backgroundColor: "{colors.tint}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 16px 0 12px"
    height: "34px"
  review-chip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.inpage-body}"
    rounded: "{rounded.chip}"
    padding: "4px 4px 4px 8px"
  chip-button:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.inpage-control}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "30px"
  chip-button-remove:
    backgroundColor: "{colors.action}"
    textColor: "{colors.on-action}"
  chip-icon-button:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    size: "24px"
  dry-run-label:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.muted}"
    typography: "{typography.inpage-body}"
    rounded: "{rounded.chip}"
    padding: "3px 9px 3px 7px"
  batch-summary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.inpage-body}"
    rounded: "{rounded.card}"
    padding: "14px 14px 12px 16px"
    width: "320px"
  summary-pill:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.inpage-control}"
    rounded: "{rounded.pill}"
    padding: "0 12px 0 10px"
    height: "32px"
---

# Design System: Shoo

## Overview

**Creative North Star: "Friendly App"**

Shoo looks like a friendly consumer app. Soft white cards sit on a warm grey ground, labels are plain speech, and one bright orange marks only what you can press. Colour has jobs and nothing else: orange for pressing, a pale red or green pill for a Verdict, and a small dot for each Rule.

The wink is the eyes. The two o's of the wordmark are eyes that show what Shoo is doing, and in Settings a larger pair peeks over the top edge of the Try a title card and reads along while the user types. Nothing else is decoration, and dark mode is first-class: the ground and cards turn a warm near-black, the orange lightens, and the Rule colours stay the same.

Inside YouTube and Bilibili the same world travels without a bundled font. The Review chip, Dry-run label, removed-Tile annotation, Batch summary and notices are white cards on the system font stack, sized in px, with the eyes drawn as SVG. Density is moderate: 14 px body text, 13 px dense rows, 60 px Rule rows and one main column of at most 960 px.

**Key Characteristics:**
- One bright orange, only on things you can press, always with dark text on it.
- White cards at a 16 px radius with one soft shadow and no border, one job per card.
- Pills for everything you press, 12 px corners for fields and the in-page chip.
- Verdicts as pale red or pale green pills that never look pressable.
- Rule colours only as 10 px dots, a switched-off Rule as a hollow ring.
- Figtree on extension pages, the system stack and px in-page.
- The living wordmark's eyes are the logo, the status light and the only character.

## Colors

Warm neutrals, one orange, two pale Verdict pills and ten Rule dots. Every token has a light value and a `-dark` twin: extension pages switch with `prefers-color-scheme` or `data-theme`, and in-page UI switches with the `data-dark` attribute that follows the Site's own theme.

### Primary
- **Press Orange** (`action`, #e4572f, dark #ff7a50): the only bright colour. It fills primary buttons, Add a Rule, the on switch, checked checkboxes and radios, the current section's dot and the chip's Remove button. It holds at least 3:1 on paper, the ground and tinted rows in both themes (3.7 and 3.3 in light), so the on switch and checked boxes are visible wherever they sit.
- **Press Orange Hover** (`action-hover`, #f06a40, dark #ff9370): hover on every orange control.
- **On Orange** (`on-action`, #1a1411, dark #1b1816): text, icons and check marks on orange (4.9:1 in light, 6.9:1 in dark).
- **Switch Knob** (`knob`, white in light, #1b1816 in dark): the switch's knob, 3.7:1 and 6.9:1 against the orange track.

### Secondary
- **Remove Pill** (`remove-bg` #fde4e1 with `remove-fg` #b4232a, dark #4a2220 with #ffb4ac): the Remove Verdict pill (5.4:1 in light, 8.0:1 in dark).
- **Keep Pill** (`keep-bg` #ddf3e3 with `keep-fg` #1e6b3e, dark #1d3a28 with #9ee0b5): the Keep Verdict pill (5.6:1 in light, 8.2:1 in dark).

### Tertiary
- **Rule colours** (`c1` to `c10`: blue, green, yellow, rose, lime, brown, sky, orchid, violet, teal, the same in both themes): one per remove Rule, assigned in order when the Rule is created and stored with it, repeating after c10. They fill the 10 px dot and nothing else. Keep rules get no colour. Orange, red and grey stay out of the set because they mean press, Remove and off.
- **Dot Ring** (`dot-ring`, ink at 14% in light, none in dark): a 1 px inner ring that keeps pale dots visible on white.

### Neutral
- **Warm Grey Ground** (`ground`, #f4f1ec, dark #1b1816): the page behind the cards, the Settings index and the popup. Also fills the eyes' lids on extension pages.
- **Card White** (`paper`, #ffffff, dark #26221f): cards, fields, the chip and every floating surface. Also fills the eyes' lids in-page.
- **Espresso Ink** (`ink`, #2b241f, dark #f2ede8): text, the wordmark, the eyes, focus rings and onboarding's progress bars (15.3:1 on paper).
- **Taupe** (`muted`, #6f625a, dark #b3a89f): secondary text, hints, column headers, R-numbers and meter fills (5.9:1 on paper, 5.2:1 on the ground).
- **Control Edge** (`edge`, #938780, dark #7a6f67): every boundary that must be seen, such as field and outline-button borders, checkboxes, radios and the off switch's track (at least 3.1:1 in both themes).
- **Disabled Stroke** (`stroke`, #cfc6bd, dark #4e4640): disabled outlines and tracks only.
- **Row Hairline** (`line`, ink at 9%): rules between rows inside cards. Never the only boundary of a control.
- **Header Rule** (`line-strong`, ink at 18%): the rule under table headers, the chip's divider beside the eyes, link underlines at rest, meter tracks and the dark-theme ring around in-page surfaces.
- **Hover Tint** (`tint`, ink at 4.5% in light, 5% in dark): hover, the selected radio row, the Segmented track, the expanded Rule row and disabled primary buttons.
- **Attention Cream** (`lit`, #fff3d6, dark amber at 10%): callouts that need attention and Activity rows not yet seen.
- **Error Red** (`danger`, #b4232a, dark #ff9a8f): error text and the fill of an over-budget meter, nothing else.

### Named Rules
**The Orange Means Press Rule.** If it is orange, it can be pressed. Orange never fills a Verdict, a heading, a count or a background, and text on orange is always `on-action`, never white. The browser's own text selection (orange at 24% under ink text), caret and `accent-color` are the only other places it appears.

**The Dots Only Rule.** Rule colours are only ever 10 px dots. Never set text, borders or fills in a Rule colour, and always put the Rule's name or R-number beside the dot, because the colour is decorative.

**The Pale Verdict Rule.** A Verdict is a pale pill with dark coloured text, red for Remove and green for Keep. It never uses orange and never looks like a button.

## Typography

**Display Font:** Figtree (variable 300 to 900, one bundled Latin woff2, with ui-sans-serif, system-ui, sans-serif)
**Body Font:** Figtree on extension pages, the system stack (system-ui, -apple-system, Segoe UI, Ubuntu, sans-serif) in-page
**Label/Mono Font:** the platform monospace stack, only for commands to copy and import error details

**Character:** One friendly sans with open, rounded forms carries everything on extension pages, from the 48 px section headings down to 12 px labels. In-page text uses the system stack so the content bundle ships no font, and the eyes carry the identity there.

### Hierarchy
- **Wordmark** (800, 26 px in Settings, 22 px in the popup, 30 px in onboarding, line-height 1, -0.02em): "Sh" followed by the eyes.
- **Display** (600, 48 px, 1, -0.025em): one section heading per Settings section.
- **Headline** (600, 36 px, 1.1, -0.025em): onboarding step headings.
- **Numeral** (600, 22 px, 1.1, -0.02em, tabular): the popup's Today figures.
- **Subhead** (600, 20 px, -0.01em): headings above tables and settings groups.
- **Title** (600, 18 px): card titles such as Try a title.
- **Verdict** (700, 16 px, tabular): the Verdict pill.
- **Lede** (400, 15 px, 1.5, at most 64ch): the plain sentence under a section heading and onboarding body copy. Index items use 15 px at 500, and 600 when current.
- **Body** (400, 14 px, 1.5): default text. Buttons and Segmented options set it at 600.
- **Input** (400, 16 px): every text field and select.
- **Dense** (400, 13 px, 1.35): table rows, hints, captions and status lines. In-page body text uses the same size and line height on the system stack.
- **Label** (600, 12 px): field labels and the popup's figure captions, in sentence case.
- **Site name** (700, 15 px): the Site's name on its row in Settings, Sites.
- **Group heading** (600, 14 px): a sub-heading inside a card, such as "Whole shelves on Home", with its 12 px muted hint at the right.
- **In-page headline** (system stack, 600, 16 px, 1.25, tabular): "Shooed 4 videos". Notice headlines use 14 px.
- **In-page control** (system stack, 600, 13 px): chip and summary buttons, the Rule name in summary rows.

### Named Rules
**The Fixed Scale Rule.** Sizes come only from 12, 13, 14, 15, 16, 18, 20, 22, 36 and 48 px. No half pixels, and in-page sizes are px, never rem, because YouTube sets `html { font-size: 10px }`.

**The Tabular Count Rule.** Every count, cost, percentage and time uses tabular figures.

## Layout

Settings is two columns inside a page of at most 1280 px: a 248 px section index on the bare ground, sticky at full height, and a main column of at most 960 px where each job sits in its own card. Below 768 px it becomes one column and the index wraps into a row of pills above the content. The popup is 360 px wide on the ground with 16 px side gutters. Onboarding is one 880 px column: the wordmark, a four-bar progress line, and the current step in one card.

Spacing sits on a 4 px base (4, 8, 12, 16 and 24 px), with 32 to 48 px only between page regions. Inside a Settings section, groups are 24 px apart, Try a title has 48 px above it so the eyes can peek, a sub-heading sits 8 px above its table, and Add a Rule sits 16 px under the table. The popup keeps 16 px between groups and on both sides of each hairline, and 8 px from a control to its caption. Cards pad 20 px, Try a title 24 px from 640 px wide, and the onboarding card 24 by 32 px.

Sites puts each Site in its own card, 32 px apart, with its Surfaces and Shelves indented 24 px under the Site's row.

Rows are 34 px for table headers, 60 px for Rule rows, 44 px for settings rows and 40 px for index items. Hit targets are at least 24 px everywhere and 44 px for the full chip's buttons. Lists of radio choices (the provider picker, the onboarding Mode step) are ruled rows under a `line-strong` rule, with the selected row tinted.

## Elevation & Depth

Depth is one soft shadow under each card on the warm ground, and nothing more. Cards and floating surfaces carry a shadow and no border, while controls carry a 1 px `edge` border and no shadow, except the selected Segmented option, which also lifts by a 1 px shadow. Outside cards, the only raised elements are the current section in the index and the batch filter in Activity, paper pills with the Card shadow. In the dark theme the in-page chip, panels and collapsed pill add a 1 px `line-strong` ring, because a shadow does not show on the Sites' dark grounds.

### Shadow Vocabulary
- **Card** (`box-shadow: 0 1px 2px rgb(43 36 31 / 0.06), 0 8px 24px rgb(43 36 31 / 0.07)`, dark `0 1px 2px rgb(0 0 0 / 0.3), 0 10px 28px rgb(0 0 0 / 0.35)`): every card on extension pages, the current index pill and Activity's batch filter pill.
- **Float** (`box-shadow: 0 1px 3px rgb(0 0 0 / 0.1), 0 10px 28px rgb(0 0 0 / 0.16)`, dark `0 1px 3px rgb(0 0 0 / 0.4), 0 12px 32px rgb(0 0 0 / 0.5)`): in-page surfaces over the Sites' pages, namely the Review chip, the Batch summary, notices and the collapsed pill.
- **Knob** (`box-shadow: 0 1px 2px rgb(0 0 0 / 0.25)`): the switch's knob only.
- **Lift** (`box-shadow: inset 0 0 0 1px var(--edge), 0 1px 2px rgb(0 0 0 / 0.12)`): the selected Segmented option only, its `edge` ring and a 1 px lift.

### Named Rules
**The Float Or Frame Rule.** A surface either floats (a card or in-page panel with one soft shadow and no border) or is a control (a 1 px `edge` border and no shadow, the selected Segmented option's Lift aside). Never a card inside a card.

**The Passive Is Flat Rule.** Passive in-page surfaces (the Dry-run label, "Already shooed above", the annotation on Bilibili's cover) get paper at 96% opacity and no shadow, so they never read as something to press.

## Shapes

The form language is soft and round. Everything you press is a full pill (999 px): buttons, Add a Rule, Segmented options and their track, switches, index items, starter chips and in-page buttons. Containers have gentler corners that grow with their size: 4 px around a text button, 5 px checkboxes, 6 px thumbnails, 8 px for the Rule table's inline edits, 12 px for fields and the in-page chip and labels, 14 px callouts, 16 px cards and floating panels. Radios, Rule dots and the eyes are circles. Borders are 1 px (`edge` on controls, dashed `muted` on the Dry-run label), except the 1.5 px border on checkboxes and radios.

## Components

### Buttons
Soft, rounded, and they sink a little when pressed.
- **Shape:** full pill (999 px), 600 weight. Sizes 28 px (dense rows, 12 px padding, 13 px text), 36 px (default, 16 px padding, 14 px text) and 44 px (onboarding's main actions, 20 px padding, 15 px text).
- **Primary:** orange with `on-action` text. Hover lightens to `action-hover`. Disabled turns to the tint with muted text.
- **Hover / Focus:** pressing scales to 96% over 80 ms and springs back over 160 ms on `--ease-spring`, colour changes take 120 ms ease-out, and none of it runs under reduced motion. Focus is the page's 2 px ink outline at 2 px offset.
- **Outline:** paper with ink text and a 1 px `edge` border. Hover fills with the ground. Disabled keeps paper with a `stroke` border and muted text.
- **Text:** ink at 600, underlined at rest in `line-strong` (1.5 px, 4 px offset), and the underline turns orange on hover. It keeps a 24 px hit target.
- **Add a Rule:** a 40 px orange pill led by a 16 px Lucide `plus`.

### Switch and Segmented control
- **Switch:** `role="switch"`, a 36 by 20 px track inside a 40 by 24 px hit target. On is the orange track (lighter on hover), off is the `edge` track, disabled is `stroke`, and the track's colour changes over 150 ms. The 16 px `knob` slides 16 px over 200 ms on the exponential ease-out.
- **Segmented:** a radio group with arrow keys. A tinted pill track with 3 px padding and an inset `line` ring holds 30 px pill options in 600. The selected option is a paper pill ringed in `edge` with ink text and the 1 px Lift shadow, the others are muted and turn ink on hover. A disabled Segmented drops to 50% opacity.

### Chips
- **Starter chips:** 34 px outline pills with a `plus` icon and 500 text, the border turning ink on hover. Once added, the chip becomes a tint pill showing the new Rule's dot and name.
- **Batch filter pill:** in Activity, a filtered batch shows as a paper pill with the Card shadow, 13 px text and a 24 px round `x` button that clears the filter.
- **In-page chips:** see In-page surfaces below.

### Cards / Containers
- **Corner Style:** 16 px.
- **Background:** `paper` on the `ground`.
- **Shadow Strategy:** the Card shadow and no border (see Elevation & Depth).
- **Border:** none. Inside a card, groups are split by 1 px `line` rules and radio lists sit under a `line-strong` rule.
- **Internal Padding:** 20 px (24 px for Try a title from 640 px wide).
- **Callouts:** `lit` fill, 14 px radius, about 12 by 16 px padding, no shadow, for confirmations, consent and commands to copy.

### Inputs / Fields
- **Style:** paper, 1 px `edge` border, 12 px radius, 16 px text, 36 px tall (42 px in Try a title), muted placeholder.
- **Focus:** the border darkens to ink on hover and focus, together with the 2 px ink focus outline.
- **Error / Disabled:** errors are 13 px `danger` text under the field. Disabled borders turn `stroke` and the text muted.
- **Search field:** a field frame with a 16 px muted Lucide `search` icon before the input (Activity, Exceptions). The frame takes the ink border and the 2 px ink outline while its input has focus.
- **Select:** the native select with its arrow replaced by a 16 px muted Lucide `chevron-down` 12 px from the right edge.
- **Checkbox and radio:** redrawn at 16 px with a 1.5 px `edge` border on paper, 5 px corners or round. Checked fills orange with an `on-action` tick, or shows an 8 px orange dot for a radio. Under forced colours the native controls return.
- **Inline edits (Rule table):** borderless until hovered (`line-strong` border) or focused (ink border on paper), 8 px radius. The Rule name line is 600 with a muted "Add a name" placeholder.

### Navigation
- **Settings index:** the wordmark on the bare ground, then 40 px pill rows in 15 px 500 ink with each count right-aligned in 13 px muted tabular figures. The current section is a paper pill with the Card shadow, 600 text and a 7 px orange dot, and other rows take the tint on hover. Mode and Filtering strength sit at the foot under a `line-strong` rule. Below 768 px the rows wrap into 36 px pills and the foot hides.
- **Onboarding progress:** four 6 px bars, ink up to the current step and `line-strong` after it, with 12 px step names under them.
- **Popup footer:** the connection status in muted text on the left, `Activity` and `Settings` on the right, under a `line-strong` rule.

### Rule number and dot (signature)
The Rule's 10 px dot, then its R-number (a K-number for Keep rules) in 500 muted tabular figures, 10 px apart. A switched-off Rule shows a 2 px hollow ring in its colour, a Keep rule a hollow ring in `edge`. Outside the Settings tables the dot sits 8 px before the Rule's name (6 px in-page), which truncates with the full Rule text as its tooltip.

### Verdict pill (signature)
A 36 px pill with 16 px padding and 16 px 700 tabular text: "Remove · 91%" in `remove-fg` on `remove-bg`, "Keep" in `keep-fg` on `keep-bg`, or "…" in muted on the tint while judging. It is an image with the full sentence as its accessible name. Under it, "Decided by" names the Rule with its dot.

### Try a title with the peeking eyes (signature)
A card with 48 px of air above it, where an 84 px pair of the wordmark's eyes sits 48 px in from the right and 30 px above the card's top, its lower edge hidden behind the card. The eyes follow the pointer, sweep while the user types and glance while the Verdict is pending. The left column holds the 18 px title, the title and channel fields, the URL field and the orange Try button, all 42 px tall. Once a Site-only rule is on, a 13 px muted label and a YouTube / Bilibili Segmented control sit under them. From 1024 px a 16rem right column, split off by a `line` rule, holds the Verdict pill, or "The Verdict shows up here." in 13 px muted before the first try.

### Rule table
A 34 px header row in 13 px muted 500 over a `line-strong` rule, then 60 px rows on `line` rules. Hover and the expanded row take the tint. Columns: the dot and R-number, the Kind (with 12 px notes under it, such as "YouTube only" for a Site-only rule), the name over the editable Rule text, this week's count in 15 px 600 tabular figures, the switch, and a 30 px round chevron button. Switched-off Rules sink to the bottom in muted text.

### Sites and Shelves
One card per Site. Its first row is a settings row with the Site name in 15 px 700, an on or off hint in 13 px muted and the Site's switch, over a `line-strong` rule. Under it, indented 24 px, each Surface is a settings row with its switch, and an unsupported Surface shows its switch disabled with the reason as the hint. YouTube's card then adds Whole shelves on Home: a 14 px 600 group heading with "Auto and Review only" in 12 px muted at the right, over a `line` rule, then one settings row per Shelf, also indented 24 px. While a Site is off, its Surface and Shelf names turn muted and their switches disabled. When the browser took a Site's access away, a danger Notice with an `Allow access` text button sits under the Site's row.

### In-page surfaces
- **Review chip:** a paper card with a 12 px radius, the Float shadow (plus the dark ring) and 13 px system text, padded 4 px (8 px on the left). Tiny eyes behind a 1 px `line-strong` divider, "Remove?", the Rule's dot and bold name, the muted percentage, then a 30 px orange `Remove` pill and an outline `Keep` pill, each with a 44 px hit area. The compact chip uses 24 px round icon buttons (`ban` filled orange, `check` outlined).
- **Dry-run label:** passive. Paper at 96%, a dashed 1 px `muted` border, muted text, no shadow and no pointer events.
- **Removed-Tile annotation:** no surface of its own over YouTube's placeholder. Muted 13 px text, with what was shooed, the Rule name and the text buttons in ink. Where there is no room above YouTube's sentence it covers that room in the colour YouTube paints there, flat with a 6 px radius. Over Bilibili's blurred cover, and as "Already shooed above" over a thumbnail, it takes the Dry-run label's surface: paper at 96%, a 12 px radius, 4 by 10 px padding and no shadow.
- **Batch summary and notices:** a 320 px paper panel with a 16 px radius and the Float shadow, 24 px from the viewport's bottom-right corner. Eyes and a 16 px 600 headline, rows of dot, Rule name and a muted count such as `×2`, then an outline `Review` and a text `Undo all`. It rises 8 px over 240 ms when it appears (a 150 ms fade under reduced motion) and later collapses into a 32 px pill with the eyes and the count.
- **Focus:** a two-tone ring (`0 0 0 2px` paper, then `0 0 0 4px` ink) that shows over any thumbnail.

### Living wordmark and eyes (signature)
Two ink rings with solid ink pupils, drawn in a 52 by 26 viewBox (ring stroke 3.6, 4.6 when tiny, 5.4 in the wordmark). Their lids are filled with whatever they sit on: `ground` on extension pages, `paper` in-page. States are watching, judging (a glance), review (a squint), paused (closed) and error (wide). On extension pages the pupils ease toward the pointer (lerp 0.18 per frame, at most 30% of the eye radius). In-page eyes stay still except for one glance when a Verdict lands, and the summary's eyes blink once (120 ms down, 80 ms up). The eyes are always ink, never a Rule colour or orange.

### The moment (signature motion)
When Auto removes a batch, each removed Tile sends a 10 px dot in its Rule's colour along a gentle arc to that Rule's dot in the summary: 560 ms on the exponential ease-out, 40 ms apart, at most 12 dots, transforms only. Under reduced motion nothing flies and the summary fades in.

### Skeleton
Static 40 px rows on `line` rules with rounded `line-strong` and `line` bars. No shimmer.

## Do's and Don'ts

### Do:
- **Do** use `action` orange only on things you can press, with `on-action` text, lightening to `action-hover` on hover.
- **Do** give each job its own 16 px paper card with the Card shadow on the ground, and split groups inside it with 1 px `line` rules.
- **Do** make every control you press a full pill that sinks to 96% on press with `--ease-spring`, and drop the motion under reduced motion.
- **Do** give every boundary that must be seen a 1 px `edge` border, and keep `line` and `line-strong` for decoration.
- **Do** name the Rule behind every Verdict with its 10 px dot and its name or R-number beside it.
- **Do** show the 2 px ink focus outline at 2 px offset on extension pages, and the two-tone paper and ink ring in-page, on every interactive element.
- **Do** use Lucide icons at 16 px, stroke 2, in `currentColor`, hand-copied as paths in the content script.
- **Do** keep in-page UI on the system font stack in px, on paper with the Float shadow, plus the 1 px `line-strong` ring in dark.

### Don't:
- **Don't** use orange for a Verdict, a heading, a count, a border or a background, or put white text on it.
- **Don't** set text in a Rule colour or use a Rule colour anywhere but the dot.
- **Don't** put a card or a framed panel inside a card.
- **Don't** tint a panel behind ordinary content: `lit` is only for callouts and unseen Activity rows that need attention.
- **Don't** use YouTube red, or anything that looks like a YouTube or Bilibili control, in page.
- **Don't** add eyebrow labels above headings, stat tiles, gradient text, glass, or illustration standing in for content.
- **Don't** use emoji or Unicode glyphs as icons.
- **Don't** add a second character. The eyes are the only one, and they are always ink.
- **Don't** put a shadow on a field or button, or on a Segmented option other than the selected one's Lift, or a border on a card.
