# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Browser extension for Chrome (MV3, 120+) and Firefox desktop (MV3, 140+), built with WXT, Preact and Tailwind v4, with hand-built components (no shadcn/Radix). See `docs/adr/0003-wxt-preact-storage-local.md` for why.

## Users

Primary: heavy YouTube users who click "Not interested" by hand often and want that chore automated without losing control. Also Bilibili users: Shoo works on both from install, and the user turns either off in Settings, Sites. They are comfortable connecting a model provider with their own key, or running a model on their own computer. Built publish-ready for the Chrome Web Store and Firefox Add-ons.

Situations: browsing YouTube on desktop where Shoo works inside the page on Home, the Watch sidebar and the Shorts shelf on Home. Search, Channel pages and End screens offer no Native action on YouTube today, so Shoo shows them as disabled Surfaces in Settings with the reason. On Bilibili, Shoo works on its Home. Its video page offers no Native action and shows disabled. Occasionally opening the toolbar popup for a quick glance or switch, and rarely the full settings page to write or tune Rules and review Activity.

## Product Purpose

Shoo tells YouTube, through YouTube's own "Not interested" and "Don't recommend channel" actions, which recommendations the user does not want, judged against the user's own Rules. On Bilibili it does the same through 内容不感兴趣 and 不想看此UP主. Success means the feed gets better over time with less manual clicking, the user always knows why a Tile was removed, and a wrong call is one click to reverse.

## Positioning

Existing extensions in this space ("Not Interested!", "Nah", "Nope", "UnFeed") add a faster manual button or hide content. Shoo judges every Tile automatically against plain-language Rules using a decision model, acts only through the site's native menu so the site's recommender learns, and names the Rule behind every removal.

## Operating Context

- In-page UI lives inside the site's own layout (YouTube's light and dark themes and dense tile grids, Bilibili's card feed) and must never obscure or imitate the site's controls.
- Three Modes: Auto (removes immediately, quiet batch summary), Review (chip on the Tile with Remove / Keep, the default for new installs), Dry-run (passive label, recorded in Activity only).
- A Rule describes the user's taste, so it works on every Site unless the user limits it to one or it can only work on one (a Site-only rule, ADR 0012).
- The user writes Topic rules and Thumbnail rules in plain language, Exact rules for channels, keywords, patterns, duration, view count and format, Keep rules that always win, and accumulates Exceptions from undo or Keep clicks.
- Activity keeps 30 days of Removals, Review choices, Dry-run verdicts, videos a Keep rule kept from a removal (Rescues), failures and Escalations.
- Topic and Thumbnail rules need a Decision model: OpenRouter (OAuth "Connect" or a pasted key), a direct provider (Cloudflare, TypeSafe or Perplexity) with the user's own key, or a model on the user's computer (Ollama, llama.cpp or LM Studio). Exact rules need none. Costs are small (a few cents per thousand Tiles: calibration with 10 Topic rules on OpenRouter measured about 2.5 US cents per 1,000) but shown.
- First run must obtain consent before sending anything, as both stores require. What is sent (canonical list, REQ-PRIV-1 in `docs/spec/requirements.md`, keep this copy identical):
  - Per Tile: title, channel name, duration, Surface (which names its Site, such as YouTube's Home or Bilibili's Home), and the thumbnail image only when a Thumbnail rule is on.
  - Per request: the text of the enabled Topic rules, Thumbnail rules and Topic Keep rules, and up to 10 Exception titles with their channel names.
  - Recipients: OpenRouter, and through it the model provider: Cloudflare (default, `cloudflare/clef-flash`), TypeSafe (text fallback, `typesafe/jev-1.13`), OpenAI (image fallback, `openai/gpt-6-luna-decisions`), or the provider of another model the user picks in Settings. Instead of OpenRouter, only when the user chooses one and after consent names its host: Cloudflare, TypeSafe or Perplexity reached directly, a Decision model on the user's computer (nothing leaves the device), or the user's own endpoint.
  - Never: URLs, video IDs (YouTube's and Bilibili's BV ids), cookies, watch history, comments, page HTML, or the user's YouTube or Bilibili account details.

## Capabilities and Constraints

- Glossary in `CONTEXT.md` is binding for UI copy: Site, Surface, Rule, Site-only rule, Topic rule, Thumbnail rule, Exact rule, Banned channel, Escalation, Keep rule, Exception, Verdict, Removal, Native action, Mode, Filtering strength, Activity, Decision model, Daily cap, Review chip, Batch summary, Starter rule. User-facing copy says "video" where code and docs say Tile.
- Never hides Tiles. Failures leave the Tile visible and are reported once, not per Tile.
- English and Simplified Chinese. Every string lives in a message catalogue (`src/locales/en.yml`, `src/locales/zh_CN.yml`), and the browser's language picks one.
- Content-script UI renders in a shadow root, ships in one small bundle per site with the system font stack and an SVG wordmark, and must stay tiny because it loads on every page of the site (ADR 0006, ADR 0011).
- Popup and options are extension pages, desktop only. No Firefox Android.

## Brand Commitments

- Name: **Shoo**. Store listing: "Shoo · Clear unwanted video recommendations". Never "YouTube" or "YT" in the product name itself.
- Voice: plain, with a light wink. Labels, settings and errors are short and factual. The name's playfulness appears only in a few places such as empty states, first run, and the batch summary ("Shooed 4 videos").

## Evidence on Hand

No real users, testimonials or usage metrics exist yet. The five store screenshots in `docs/release/screenshots/` use synthetic Tiles, Rules and Activity on rebuilt YouTube pages (`docs/release/chrome-web-store.md`, Screenshots). The README's `mock-*.png` screenshots were taken on a real youtube.com Watch page with every title, channel, view count, age, thumbnail and avatar replaced by made-up ones before the page loaded, video streams blocked and the player's controls, play button and watermark hidden, and the README says so. Any other demonstration content must be synthetic and labelled as such. Cost and latency figures come from the calibration harness on synthetic Tiles (`scripts/calibration/`), not from real use.

## Product Principles

1. The site learns or nothing happens: every Removal is a Native action, never a cosmetic hide.
2. Every Verdict explains itself: the Rule that caused it is always one glance away.
3. Reversal is cheaper than prevention: undo, Keep, and "Always keep this channel" are always one click.
4. Quiet by default: Shoo works in the background and speaks once per batch, not once per Tile.
5. The user's words are never rewritten: Rules change only when the user edits them.

## Accessibility & Inclusion

WCAG 2.2 AA: contrast, full keyboard operation including the in-page chips on YouTube and Bilibili, visible focus, screen-reader labels and live-region announcements for batch summaries, and respect for reduced motion.
