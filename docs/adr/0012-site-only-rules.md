---
status: accepted
---

# Rules work on every Site unless limited to one

A Rule describes what the user does not want to see, and that taste belongs to the person, not to a site: "Reaction videos" or "Clickbait" means the same on YouTube and Bilibili, and a Decision model judges a Chinese title against an English Rule. Some Rules still belong to one Site: a genre the user wants gone from one feed only, a channel (a channel is an account on one Site), or a format only YouTube marks (Shorts, live, members-only, Artist channels). So every Rule works on all Sites by default, and a **Site-only rule** carries one `site` (`Rule.site`, CONTEXT.md).

Where the Site comes from:
- The user unchecks a Site under "Works on" when adding a Rule (Settings, or "Only on {site}" in the popup's quick add on that Site's tab) and can change it from the Rule's row.
- A channel Rule made from a Tile (Escalation, "Always keep this channel") takes the Tile's Site. Once it knows the channel's id or handle, which exist only on that Site, the Site cannot be changed. A channel known by name alone can work on all Sites, matching that name on each.
- A channel Rule saved before Sites has no `site`, but its handle or id tells it: only YouTube has handles and `UC…` ids, Bilibili's ids are numbers (`channelIdSite`). So no stored Rule needs migrating, as with video IDs (ADR 0011).
- Short, Live, Members-only, Artist channel and views Rules work on YouTube only, from their kind (`ruleSite` in `core/rules.ts`), whatever is stored. Shoo reads view counts only from YouTube Tiles.

A Tile is judged only against the Rules that work on its Site (`rulesOn`): its Exact stages, its model request, and the kept examples in that request, which leave out Exceptions kept from a Rule for another Site. One batch is one Site, which the router checks.

**Considered options**: separate Rule lists per Site (simple to explain, but most Rules would be written twice and drift apart), a set of Sites per Rule (covers "two of three Sites", which nothing needs with two Sites, and costs a list control on every Rule), and Site profiles that each pick Rules (more structure than the taste it describes).

**Consequences**:
- The Verdict cache keys on the Rules that work on the Tile's Site, so adding or editing a Bilibili-only Rule never re-asks YouTube's cached Tiles. The `rulesVersion` content compares still covers every Rule, so tabs re-judge on any change and the cache answers.
- A Rule for every Site hashes as it did before Sites, so existing caches stay valid.
- The state budget meter and a direct provider's Topic rule limit count the fullest Site's Rules.
- A third Site later is automatically covered by every Rule for all Sites. A Rule for two of three Sites would need `site` to become a list.
