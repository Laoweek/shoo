# Shoo requirements

Terms follow `CONTEXT.md` exactly. Decisions with lasting trade-offs are in `docs/adr/`. Requirement IDs (`REQ-…`) are referenced by the other specs in `docs/spec/`.

## 1. Product in one paragraph

Shoo watches recommendation Tiles on YouTube and Bilibili desktop, judges each one against the user's Rules, and for unwanted Tiles performs the Site's own Native action ("Not interested", or "Don't recommend channel" for Banned channels) so the Site's recommender learns. Topic rules and Thumbnail rules are judged by a Decision model: OpenRouter by default, or a direct Decision provider or a model on the user's computer (ADR 0007). Exact rules are matched by Shoo itself with no model call. Keep rules always win. Every Verdict names the Rule that caused it, and every Removal is one click to reverse.

## 2. Audience and distribution

- REQ-DIST-1: Built for personal use first, publish-ready for the Chrome Web Store and Firefox Add-ons (AMO). Store listing name "Shoo · Clear unwanted video recommendations". Never "YouTube" or "YT" in the product name.
- REQ-DIST-2: Chrome 120+ (MV3 service worker) and Firefox 140+ desktop (MV3 event page). No Firefox Android, no mobile YouTube (`m.youtube.com`), no mobile Bilibili (`m.bilibili.com`).
- REQ-DIST-3: Firefox builds must be AMO-signable (fixed `gecko.id`, `data_collection_permissions`, reproducible sources zip). Unlisted signing is enough for personal use.
- REQ-DIST-4: The UI ships in English and Simplified Chinese, picked by the browser's UI language with English as the default. Every user-facing string lives in a message catalogue, and each translated catalogue has the same keys, placeholders and plural forms as `en.yml`.

## 3. Sites, Surfaces and Tiles

- REQ-SITE-1: **Sites**: YouTube and Bilibili (www.bilibili.com), both on from install (ADR 0011). Settings, Sites turns each Site on or off. A Site that is off has no active Surfaces and its content script does nothing after one settings read. When the user took a Site's host access away in the browser, Settings, Sites and the popup say so while that Site is on, and Settings offers Allow access.
- REQ-SITE-2: Keep rules, Banned channels, Exceptions, Activity, Mode, the Daily cap and Filtering strength are shared by every Site. Rules work on all Sites unless they are Site-only rules (REQ-RULE-15).
- REQ-SITE-3: Bilibili Surfaces: Bilibili Home is supported (its menu has 内容不感兴趣 and 不想看此UP主). The video page's recommendations have no menu, so that Surface is shown disabled with the reason, like YouTube's Search. Bilibili Tiles have no Shorts, live or Artist channel flags and Shoo reads no view count there, so those Exact rules work on YouTube only (REQ-RULE-15). Shelf dismissal (REQ-ACT-6), Skip Subscribed channels (REQ-RULE-14) and the Banned channel from the user's own menu (REQ-ACT-5) are YouTube features: Bilibili has no such Shelves, Shoo reads no Bilibili follow list, and Bilibili's menu is not watched. Details: `docs/spec/bilibili-integration.md`.

- REQ-SURF-1: Supported Surfaces on YouTube in v1: Home, Watch sidebar, Shorts shelf on Home (Bilibili's in REQ-SITE-3). Each has its own on/off switch, all on by default. End screen was verified on 2026-10-09 and offers no Native action, so it is treated like Search (REQ-SURF-1a).
- REQ-SURF-1a: Search, Channel page and End screen offer no Native action on YouTube today (observed 2026-10-09), so Shoo does not judge Tiles there in v1. They appear in Settings as switches that are disabled with the reason, and the Surface registry keeps them so enabling them later is a configuration change, not a redesign.
- REQ-SURF-1b: Shorts shelf Tiles show no channel and offer only "Not interested". Channel-based Rules (Banned channels, channel and Artist channel Keep rules) cannot match there. Settings says so next to the Shorts shelf switch.
- REQ-SURF-2: Tile types judged: videos, Shorts, live streams. Upcoming streams are judged once a captured fixture shows how to recognize them (pending fixture). Until then a Tile without a duration is judged only if it carries a live badge and no upcoming marker. Mixes, playlists, podcasts, movies and ads are never judged or acted on.
- REQ-SURF-3: Never act on the currently playing video.
- REQ-SURF-4: New Tiles are reviewed as they appear (scrolling, in-app navigation). The same video is never sent to the Decision model twice for the same Rules (Verdict cache, REQ-COST-1). The same video shown in several places on one page gets the same Verdict everywhere, and in Auto mode the Native action runs once per video per page.
- REQ-SURF-5: Desktop only. Any desktop window width the Site supports.

## 4. Rules

- REQ-RULE-1: **Topic rule**: one plain-language sentence, judged by the Decision model against title, channel, duration and Surface.
- REQ-RULE-2: **Thumbnail rule**: one plain-language sentence about the thumbnail image, judged by an image-capable Decision model. Thumbnails are fetched only when at least one Thumbnail rule is on, and only for Tiles that no Topic rule or Topic Keep rule matched.
- REQ-RULE-3: **Exact rule**, matched by Shoo with no model call. Kinds: channel (makes a **Banned channel**), title keyword, title pattern, title regex (under Advanced), duration, views (REQ-RULE-13), is a Short, is live, and, for Keep rules only, is from an **Artist channel**. Upcoming and members-only kinds stay hidden until fixtures exist (pending fixture). Upload age is out of scope (localized text, fragile). Semantics per kind are in the table below.
- REQ-RULE-4: **Keep rule**: Topic or Exact kinds. Thumbnail Keep rules are not allowed in v1. A Keep rule beats every other Rule. An Artist channel Keep rule keeps every Tile from an Artist channel, and the Artist channel kind exists only as a Keep rule. It covers music a Topic Keep rule cannot see: on 2026-10-10 the Topic Keep rule "Music video" missed KAF's song "アポカリプスより", because its title, channel, duration and Surface say nothing about music.
- REQ-RULE-5: Priority: Keep rule → Exception → Banned channel → other Exact rules → Topic rules → Thumbnail rules. Exact Keep rules and Exceptions are checked before any model call. Topic Keep rules are judged by the Decision model and still beat every remove, including an Exact rule or Banned channel match. When an Exact remove matches while a Topic Keep rule is enabled and the model cannot be asked (no consent, no key, Daily cap, failures, offline), the Tile is held undecided: no Native action and no chip.
- REQ-RULE-6: Every Rule has a reference number (R1, R2, …, Keep rules K1, K2, …) that is never reused, an on/off switch, and a hit count (this week and all time, Keep rules included). A Keep rule's hits count only its Rescues: Tiles it kept that a remove Rule or Banned channel would otherwise have removed. For an exact Keep rule Shoo checks only Exact rules and Banned channels on the device, so a Tile it kept from a Topic rule is not counted. Keep rule hits recorded before Rescues existed counted every keep and are not migrated: they leave this week's count within a week, and stay in the all-time count and the last hit time. Old Kept by Keep rule rows stay in Activity until they age out (30 days, 7 days on the Keep rule's wall). A reference changes only when two devices or an import create the same number: the later-created Rule is renumbered and an Activity event records the change. Rules are global, not per Surface. The reference is the Rule's key for the Decision model and is shown beside each Rule in Settings. Everywhere else Shoo names a Rule by its Rule name, or by its text when it has none (REQ-RULE-11), because a bare number tells users nothing.
- REQ-RULE-7: Rules are never rewritten by Shoo. They change only when the user edits them.
- REQ-RULE-8: "Try a title" box in the Rules editor: enter a title and channel, optionally a YouTube video URL or an `i.ytimg.com` thumbnail URL (parsed on the device into a video ID, nothing else accepted), and see the Verdict, the deciding Rule and the probability, using one real model call. It needs consent (REQ-PRIV-2) like any other model call. Once a Site-only rule exists, it asks which Site the video is on, and a Bilibili title is tried without a URL.
- REQ-RULE-9: Import and export of Rules, Keep rules, Banned channels and Exceptions as one versioned JSON file. The API key is never exported. Import validates (including the regex check below) and shows a preview before replacing or merging.
- REQ-RULE-10: Rules, Keep rules, Banned channels and the newest Exceptions sync across the user's browsers through browser sync storage, within the byte budget in `docs/spec/architecture.md` (Storage). Older Exceptions stay on the device and still apply there. The API key, Activity and Verdict cache never sync.
- REQ-RULE-11: **Rule name**: optional, at most 40 characters, set when a Rule is added or edited in Settings. A Rule added from a Starter rule takes the Starter's label as its name. Shown with the Rule colour wherever a Rule is named, with the full Rule text as its tooltip. Never sent to a Decision model and not part of `rulesVersion`, so renaming a Rule never re-judges a video. Synced, exported and imported with the Rule. Older versions of Shoo keep the name through sync and drop it on import. A rename reaches open Site tabs with their next rescan (chips and labels). Annotations already shown and an open Batch summary keep the old name until the page reloads. Only an edited name is checked against the limit, so a longer name synced from elsewhere never blocks other edits.
- REQ-RULE-12: **How to write a Rule**: the Rules section offers a guide of seven tips, five of them with a Try and a Not example (collapsed, open while there are no Rules). While the user types a Topic rule, a soft hint points out an order ("No …", "Hide …") or a negation ("not", "except"), except where the word is part of a capitalised name ("No Man's Sky", "Not Just Bikes"). Hints never block saving. Every tip traces to the evidence in `decision-engine.md` Section 13.
- REQ-RULE-13: The views kind of Exact rule matches YouTube Tiles by their view count: fewer than, more than, or between two counts the user types as plain numbers or with k, m or b (`10k`, `1.5m`). View counts are localized text, so Shoo reads them only in English (`116 thousand views`, `1.1m views`) and a Tile shown in another language has no view count. Live streams show watchers, not views, and have none either. A Tile without a view count never matches a views Rule, so a remove views Rule fails safe. The view count stays on the device and is never sent to a model (`decision-engine.md` Section 10).
- REQ-RULE-14: **Skip Subscribed channels**: every remove Rule except a Banned channel has an option, off by default, so it never removes a Tile from a **Subscribed channel**. Other Rules still apply to that Tile, and a Tile from a Subscribed channel is asked only the Topic rules and Thumbnail rules that apply to it. A Tile matches the list by its channel id, handle or channel name, any one being enough. Tiles that show no channel (Shorts shelf) and Tiles from another Site never match. Shoo reads the list from youtube.com with the user's own YouTube session, only while an enabled Rule uses the option and about once a day (sooner after a failed read, backing off from 1 hour), keeps only the channel keys in `storage.local`, and never sends them to a Decision provider. Without a usable list (never read, signed out, the page changed, or the last read is over 7 days old), a YouTube Tile that such a Rule would remove and that shows a channel is held undecided (`subscriptionsUnavailable`): no Native action and no chip. An Exact rule without the option that also matches still removes it. Try a title ignores the option. The option syncs, exports and imports with the Rule (older versions keep it through sync and drop it on import).
- REQ-RULE-15: **Site-only rule** (ADR 0012): every Rule works on all Sites unless the user limits it to one, under "Works on" in Add a Rule and in the Rule's row, with one checkbox per Site, all checked by default, or with "Only on {site}" in the popup's quick add on that Site's tab. A channel Rule made from a Tile (Always keep this channel, Escalation) works on that Tile's Site only, and cannot be changed once it knows the channel's handle or id, which exist on one Site only. A channel Rule saved before Sites takes its Site from its handle or id. Short, Live, Members-only, Artist channel and views Rules work on YouTube only. A Tile is judged only against the Rules that work on its Site, and its model request carries only those Rules and leaves out Exceptions kept from a Rule for another Site. Settings shows "YouTube only" or "Bilibili only" on a Site-only rule's row, and the Site of every Banned channel, Exception and Activity row.

### Exact rule semantics

Text comparisons run on NFKC-normalized, casefolded, trimmed strings. A Rule never matches a field the Tile does not show (unknown field = no match).

| Kind | Params | Match |
|---|---|---|
| channel | channel name, plus handle and channel ID when known | Channel identity per `docs/spec/architecture.md` (ChannelKey): by ID or handle when both sides have one, otherwise by normalized name. Tiles without a channel never match. |
| keyword | text | Substring of the normalized title. |
| pattern | text with `*` (any run) and `?` (one character) | Unanchored: the pattern may match anywhere in the normalized title. |
| regex | expression, max 200 characters | Flags `iu`. Only a strict safe subset is accepted: no backreferences, no lookarounds, no nested or adjacent unbounded quantifiers. Validated on save, on import and on every compile. Runs in the background, never on YouTube's page. A device with regex Rules switched off in Advanced treats them as disabled and says so. |
| duration | `minSeconds` and/or `maxSeconds`, inclusive | Matches when the Tile's duration is inside the bounds. Tiles without a duration (Shorts without a badge, live) never match. |
| views | `minViews` and/or `maxViews`, inclusive | Matches when the Tile's view count is inside the bounds. Tiles without a view count (live streams, YouTube in another language) never match, and the kind works on YouTube only (REQ-RULE-13, REQ-RULE-15). |
| short | none | Tile is a Short. |
| live | none | Tile carries a live badge. |
| artistChannel | none. Keep rules only: saving or importing one as a remove Rule fails, and a remove one arriving through sync never matches | Tile's channel shows YouTube's Official Artist Channel badge (detection in `docs/spec/youtube-integration.md`). Tiles without a channel (Shorts shelf) never match. The badge is never sent to a model. |
| upcoming, membersOnly | none | Pending fixture, hidden in the UI until extraction exists. |

## 5. Native actions

- REQ-ACT-1: Removals use only the Site's own menu actions: "Not interested" for Topic, Thumbnail and non-channel Exact rules, "Don't recommend channel" for Banned channels (on Bilibili 内容不感兴趣 and 不想看此UP主). Shoo never hides, blurs or restyles a Tile to remove it (ADR 0001).
- REQ-ACT-2: One Native action at a time per tab (serialized queue), with menu matching that does not depend on English text. The queue never takes focus from the user: it waits while the user has a Tile menu of the Site open or is typing, and restores focus afterwards.
- REQ-ACT-3: A failed Native action leaves the Tile visible, is recorded in Activity, and is reported once per failure streak, not once per Tile.
- REQ-ACT-4: Undo: the Site's own "Undo" in the removed-Tile placeholder (Bilibili's 撤销) is the primary undo. Shoo also offers Undo from its batch summary and Activity while the Site's undo is still available on an open tab, and reports honestly when it has expired. An undo done with the Site's own button is detected and treated like Shoo's.
- REQ-ACT-5: When the user picks "Don't recommend channel" themselves on a YouTube Home or Watch sidebar Tile's menu while Shoo is on, Shoo adds that channel as a Banned channel and records it in Activity. It adds none when the channel already is one, when a Keep rule covers the channel (the user's Keep rule stays in charge), or in a private window (Rules sync). YouTube's Undo on that Tile, within an hour, removes the Banned channel again, with no Exception: the Removal was the user's own. Shoo's own clicks never count.
- REQ-ACT-6: **Shelf dismissal**: two switches under YouTube in Settings, Sites, Shorts shelf and games shelf, both off by default. When one is on, Shoo performs that Shelf's own dismiss control on YouTube's Home ("Show fewer Shorts", "Show fewer games"), once per Shelf kind per page, through the same one-at-a-time queue and focus safety as REQ-ACT-2. It runs in Auto and in Review, where the switch is the user's own choice, and never in Dry-run or while Native actions are tripped (REQ-COST-4, ADR 0010). No Rule or Verdict is involved and it is not a Removal: it adds one Activity event and no Removal count. Shoo offers no Undo of its own, YouTube's Undo in the Shelf stays the way back, and Shoo does not dismiss the same Shelf kind again on that page. The Shelf's controls are not yet seen in a captured fixture (pending fixture): when Shoo finds no control, or the control does not do what it expects, nothing happens and nothing is reported, so no breaker trips.

## 6. Modes

- REQ-MODE-1: **Auto**: Removals happen immediately.
- REQ-MODE-2: **Review** (default for new installs): a chip on each flagged Tile reads "Remove? · <Rule>" with Remove and Keep buttons. Nothing reaches the Site until the user clicks Remove.
- REQ-MODE-3: **Dry-run**: a passive label on flagged Tiles, "Would remove · <Rule>", no buttons. Recorded in Activity as a dry run. The model is still called.
- REQ-MODE-4: One global Mode, switchable from the popup.
- REQ-MODE-5: Switching Mode applies to Tiles already on screen as defined in `docs/spec/architecture.md` (Mode transitions). Switching from Review to Auto never removes Tiles whose chips are showing without one confirmation in the popup. Turning Shoo off cancels queued actions and removes all in-page UI.

## 7. Verdicts and Filtering strength

- REQ-VERD-1: A Verdict is Keep or Remove plus the deciding Rule, the probability (model Verdicts), and the source (Keep rule, Exception, Exact rule, model).
- REQ-VERD-2: **Filtering strength** applies to Topic rules and Thumbnail rules. Presets, with a separate cutoff for Topic rules and Thumbnail rules because the default model scores text higher than thumbnails: Cautious (remove at ≥90% for Topic rules, ≥85% for Thumbnail rules), Balanced (≥75% and ≥60%, default), Eager (≥55% and ≥35%). Advanced exposes an exact slider that sets one cutoff for both. Presets are starting points to tune against real undo data. Changing Filtering strength re-gates cached results and never triggers new model calls.

## 8. Exceptions and learning

- REQ-EXC-1: Undoing a Removal or clicking Keep (Review chip or Activity row) creates an **Exception** for that exact video. That video is never judged again on any Surface.
- REQ-EXC-2: The 10 most recent Exceptions are sent to the Decision model with the Rules as "examples the user kept anyway", within the ~2,000-token budget the model reads.
- REQ-EXC-3: "Always keep this channel" (from undo, chips, the removed-Tile annotation and Activity) creates a Keep rule for that channel. It is unavailable for Tiles without a channel. Adding a Keep rule for a Banned channel asks whether to lift the ban.
- REQ-EXC-4: No LLM prompt rewriting, no prompt versions (ADR 0004).

## 9. Escalation

- REQ-ESC-1: A channel qualifies for **Escalation** when, within 30 days, Topic rules removed at least 3 of its Tiles **and** at least 50% of its judged Tiles.
- REQ-ESC-2: Setting: Off / Suggest (default) / Automatic. Suggest shows the channel in the popup and Activity for one-click confirmation. Automatic adds it to Banned channels and says so in the batch summary. After "Not now", the same channel is suggested again only after 3 more removals.
- REQ-ESC-3: A channel with any Keep rule or Exception never escalates.

## 10. Feedback and notifications

- REQ-NOTE-1: Default (Auto mode): one quiet summary per batch ("Shooed 4 videos" with the Rules involved and a Review link) and a count on the toolbar icon.
- REQ-NOTE-2: Option: a notification per Removal. Option: silent, toolbar count only.
- REQ-NOTE-3: Errors (connection, quota, a Site's markup change) appear once, with the recovery action. Notices before a failure category trips never say "paused". Tripping is defined in REQ-COST-4.

## 11. Activity

- REQ-ACTV-1: Records Removals, Review choices, Dry-run "would remove" Verdicts, Tiles kept by a Keep rule, failures, Escalations, Banned channels the user made with YouTube's menu (REQ-ACT-5), Rule renumbering and Shelf dismissals (REQ-ACT-6). A Tile kept by a Keep rule (exact or Topic) is recorded only when it is a Rescue (REQ-RULE-6), once per Keep rule, video and day, at most 100 a day, already seen, so it never shows as new. Other Keep Verdicts (Exceptions, Keep rule keeps that are not Rescues, and Tiles no Rule removed) are not recorded.
- REQ-ACTV-2: Retention 30 days within a size cap (`docs/spec/architecture.md`, Storage). Tiles kept by a Keep rule count toward the cap. Search, and inline Undo (while possible), Keep, and "Always keep this channel". Rows of Tiles kept by a Keep rule offer none of these actions.
- REQ-ACTV-3: Private windows: nothing is persisted (no Activity, no Verdict cache, no sync). Exceptions and counters for the private session live in memory only, so Undo and Keep hold for that session and the Daily cap still counts. Shoo only runs there if the user enabled it in the browser.

## 12. Model and connection

- REQ-MODEL-1: Default Decision model `cloudflare/clef-flash` via OpenRouter's Decisions API, provider pinned to Cloudflare with no provider fallback (ADR 0002).
- REQ-MODEL-2: Fallback on error or timeout: text requests retry once with `typesafe/jev-1.13`. Image requests retry once with `openai/gpt-6-luna-decisions` (jev is text-only). Both fallbacks are named in the consent text (REQ-PRIV-1).
- REQ-MODEL-3: Model picker lists OpenRouter's current decision models live (`/api/v1/models?output_modalities=decisions`), marking which accept images.
- REQ-MODEL-4: Connection options: **Connect OpenRouter** (OAuth PKCE, key created and stored automatically) and **Paste a key**. Both are available. OpenRouter is the recommended, preselected choice in onboarding, next to the Decision providers of REQ-MODEL-7. **Disconnect** forgets the key on this device and links to https://openrouter.ai/keys to revoke it. Connection shows the key's label and connect date, and warns before reconnecting because each Connect creates a new key.
- REQ-MODEL-5: A custom OpenAI-compatible endpoint (base URL, optional key, chat model) using chat completions with a JSON schema, offered only in Settings, Connection, under a "Chat model" disclosure labelled "Less accurate", which says why (a chat model rates its own answers, and Filtering strength was not tuned for them). Ollama and LM Studio fill in their address on this computer. Text rules only in v1, and the form says so. Saving asks for consent again naming that host, after the browser's host-access prompt, which is shown from the Settings page (never the popup). A model on this computer is checked first with one synthetic title, so a missing `OLLAMA_ORIGINS` or model shows before consent. Details: `decision-engine.md` Section 6.
- REQ-MODEL-7: Decision providers reached directly, without OpenRouter, each set up in one step (ADR 0007): online, Cloudflare (clef-flash, account ID and API token), TypeSafe (jev, key) and Perplexity (pplx-decider, key). On this computer: Ollama, llama.cpp and LM Studio (no key, address and model prefilled, with the commands to start them). Offered on onboarding step 2 and in Settings, Connection, with the same host-access, local check and consent-naming-the-host flow as REQ-MODEL-5. Each says what it reads (thumbnails or titles only) and whether Filtering strength was tuned on its model. A provider that takes fewer Topic rules than are on (Ollama: 25) is never sent a request it would refuse, and Settings says so. No OpenRouter fallback chain applies. Details: `decision-engine.md` Section 12.
- REQ-MODEL-6: The API key is readable only by the background context, never by the content script or the page. Enforced by module structure, an import-boundary lint rule (`no-restricted-imports` in `eslint.config.js`) and a check of the built content-script bundle (`scripts/check-size.mjs`).

## 13. Cost and safety

- REQ-COST-1: **Verdict cache** keyed by video ID and Rules version (defined in `docs/spec/architecture.md`): a video is never sent to the model twice for the same Rules. Exact rule edits and Filtering strength changes never trigger model calls.
- REQ-COST-2: The popup shows today's judged count, removed count and spend.
- REQ-COST-3: **Daily cap**, default 5,000 judged Tiles. Reaching it stops model calls until local midnight with one notice. Exact rules, Keep rules and Exceptions keep working.
- REQ-COST-4: Failure categories: model calls, Native actions, and the Site markup check, each shared by every Site (a trip names the Site that caused it). 5 consecutive failures in one category trip it. A tripped model category stops model calls (Exact rules keep working). A tripped Native action or markup category stops Native actions. Either shows one notice with a "Resume" action. A success resets only its own category.

## 14. Data sent and consent

- REQ-PRIV-1 (canonical data list, copied verbatim into `PRODUCT.md`, store listings, the Chrome Web Store form and the privacy policy. Onboarding and Settings, Connection present these facts as structured sections that must contain every fact of REQ-PRIV-1 and nothing else, see `ui-design.md` Section 7):
  - **Per Tile:** title, channel name, duration, Surface (which names its Site, such as YouTube's Home or Bilibili's Home), and the thumbnail image only when a Thumbnail rule is on.
  - **Per request:** the text of the enabled Topic rules, Thumbnail rules and Topic Keep rules, and up to 10 Exception titles with their channel names.
  - **Recipients:** OpenRouter, and through it the model provider: Cloudflare (default, `cloudflare/clef-flash`), TypeSafe (text fallback, `typesafe/jev-1.13`), OpenAI (image fallback, `openai/gpt-6-luna-decisions`), or the provider of another model the user picks in Settings. Instead of OpenRouter, only when the user chooses one and after consent names its host: Cloudflare, TypeSafe or Perplexity reached directly, a Decision model on the user's computer (nothing leaves the device), or the user's own endpoint.
  - **Never:** URLs, video IDs (YouTube's and Bilibili's BV ids), cookies, watch history, comments, page HTML, or the user's YouTube or Bilibili account details.
- REQ-PRIV-2: First run asks for consent to send that data before anything is sent. Declining keeps Shoo usable with Exact rules only, and consent can be given later from Connection in Settings. Try a title also needs consent.
- REQ-PRIV-3: Firefox declares `data_collection_permissions` with nothing required and `websiteContent` optional, requested at runtime when the user agrees, so the decline path exists on Firefox too. Chrome Web Store privacy disclosures and Limited Use statement match REQ-PRIV-1. Both stores declare the API key the same way (`docs/spec/cross-browser-and-stores.md`).

## 15. First run

- REQ-ONB-1: Steps: (1) what Shoo does and consent (REQ-PRIV-2), (2) choose where Shoo checks videos, Decision models only: Connect OpenRouter or paste a key (preselected), or a Decision provider reached directly or on this computer (REQ-MODEL-7), (3) first Rules, with optional Starter rules to tap (Reaction videos, Clickbait, Get-rich-quick, Celebrity gossip, Shorts as an Exact rule), (4) pick a Mode, Review preselected.

## 16. Popup

- REQ-POP-1: On/off, Mode switch, today's counts (judged / removed / spend), Escalations waiting, last error if any, a quick "Add a rule" field, link to Settings. On a Site's tab: "Shoo is off on {site}" with Turn on when that Site is off, and "Only on {site}" under quick add. Elsewhere: "Open YouTube or Bilibili to see Shoo at work."

## 17. Settings sections

- REQ-SET-1: Rules (with Try a title), Keep rules, Banned channels, Exceptions, Activity, Sites (each Site's switch and its Surfaces, and under YouTube the Shelf dismissal switches), Connection (where Shoo checks videos: OpenRouter connect, paste or disconnect, or a Decision provider, then consent, model, Filtering strength, chat model), Advanced (regex rules, exact strength slider, notification style, Escalation setting, Daily cap, import/export, Reset). Reset erases every Rule, Exception, setting, the key, Activity and the Verdict cache on this device after one confirmation. Keep the total small: no setting ships that nothing reads.

## 18. Keyboard

- REQ-KEY-1: One command to turn Shoo off and on (it flips the enabled setting), default Alt+Shift+S, rebindable in the browser's shortcut settings.
- REQ-KEY-2: The in-page chips are fully keyboard operable, and keys pressed inside Shoo's UI never trigger the Site's own shortcuts.

## 19. Quality bar

- REQ-QUAL-1: WCAG 2.2 AA across popup, settings, onboarding and in-page UI (contrast, keyboard, visible focus, screen-reader labels, live region for batch summaries, reduced motion).
- REQ-QUAL-2: Each Site's content script does almost nothing on pages and Surfaces that are switched off, and nothing beyond reading one setting when Shoo or its Site is off. Each ships as a single bundle within the budget in `docs/spec/architecture.md` (ADR 0006, ADR 0011).
- REQ-QUAL-3: Voice is plain with a light wink (see `PRODUCT.md`).

## 20. Explicitly out of scope

- Hiding Tiles, judging Tiles on Search, Channel pages and End screens (no Native action there), Bilibili's video page and Search, Thumbnail Keep rules, Firefox Android, mobile YouTube and Bilibili, Sites other than YouTube and Bilibili, prompt rewriting, prompt versions, per-Surface Modes, per-Surface Rules, upload-age rules, user-defined menu labels, thumbnails on custom endpoints, languages other than English and Simplified Chinese (beyond being ready for them).
