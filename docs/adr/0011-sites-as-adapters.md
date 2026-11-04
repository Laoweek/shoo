---
status: accepted
---

# Sites as adapters, each with its own content script, and Bilibili on from install

Shoo was built for YouTube, with its page knowledge and its content engine (watcher, NativeActionQueue, chip hosts) in one `src/youtube/` module. Bilibili's Home feed works the same way at heart: recommendation cards with a menu that holds "Not interested" (内容不感兴趣) and "Don't recommend channel" (不想看此UP主), then a placeholder with Undo (撤销). So Shoo splits what a site knows from what Shoo does. A **Site** (`src/sites/<site>/`) supplies its Surfaces, extraction, menu and placeholder through one contract (`src/sites/site.ts`). The engine (`src/content/`) runs unchanged on any Site. The background, Rules, Exceptions, Activity and the Decision model stay shared.

Each Site has its own content script in the manifest (`src/entrypoints/<site>.content.ts`), and both Sites are on from install. The manifest asks for `https://www.bilibili.com/*` and its image host `https://i0.hdslb.com/*` (covers for Thumbnail rules) next to YouTube's. A Site the user does not want is turned off in Settings, Sites, which keeps its content script idle after one settings read.

**Considered options**: Bilibili as an opt-in behind optional host access, with the background registering its content script at runtime (no new install warning for YouTube-only users, but Bilibili becomes a hidden extra that most of its users never find, and Shoo has no installed base yet that a new required permission would disable on update), one content script matching both sites (one bundle, but both sites' code on every page), and an abstract "site" setting without per-site code (Bilibili's hover menu, per-Tile popovers and hidden placeholder differ too much from YouTube's click menu and swapped placeholder).

**Consequences**:
- The install prompt names bilibili.com for every user, and the store listings must justify it. Adding a third Site after release would be a new required host, which Chrome answers by disabling Shoo until the user accepts. That Site should then be opt-in instead.
- One content bundle per Site, each within the content script budget in `architecture.md` Section 12 (ADR 0006 still holds per bundle).
- Stored data keeps its shape: video IDs tell their Site (YouTube's are 11 characters, Bilibili's `BV` and 10 more), YouTube's Surface ids keep their names, and Bilibili's carry its name. Bilibili ids spread over the Verdict cache and archive buckets by hash instead of crowding into "B".
- The model is told which Site a Tile is from ("recommended Bilibili video"). YouTube's request words are unchanged, so its cached Verdicts and calibration stand. Filtering strength was not tuned on Bilibili's titles, which are mostly Chinese.
- Failure breakers stay shared: five Native action failures on Bilibili also stop YouTube's Native actions until Resume. The snapshot names the Site that tripped them, so the copy is right. Per-Site breakers are the step to take if one Site's markup breaks often.
- The consent names Bilibili's Home among the places Shoo checks, so `CONSENT_VERSION` went up to 3 (2 had named the widened recipients of ADR 0007). REQ-PRIV-1 names Bilibili account details among the never-sent data.
- Features only YouTube has reach the engine as optional `Site` members (`shelves` for Shelf dismissal, `watchUserBans` for the user's own Don't recommend channel), and Skip Subscribed channels checks only YouTube Tiles, so shared code holds no Site checks for them.
- Which Rules work on which Site is ADR 0012.
