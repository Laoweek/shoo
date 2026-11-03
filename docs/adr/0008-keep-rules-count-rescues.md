# Keep rules count Rescues, checked locally for exact Keep rules

A Keep rule's hit count, its "Kept this week" wall and its Activity rows used to include every Tile it matched, so "Music Performance: 33 this week" mostly counted videos no remove Rule would have touched. They now count only Rescues: Tiles a remove Rule or Banned channel would otherwise have removed (CONTEXT.md).

An exact Keep rule ends judging at stage 1, before any remove Rule runs. To tell whether it rescued a Tile, Shoo checks only Exceptions, Banned channels and Exact rules on the device. Asking the Decision model as well would show Rescues from Topic rules, but it would send every exact-kept Tile to a provider and spend Daily cap only for a count, so the user chose the local check (2026-10-11).

**Consequences**: an exact Keep rule never counts a Tile it kept from a Topic rule, so a channel Keep rule made with "Always keep this channel" after a Topic-rule Removal often reads 0. On the custom endpoint a Topic Keep rule counts only Rescues from Exact removes. Hits stored before the change are not migrated and stay in all-time totals. Showing Topic-rule Rescues for exact Keep rules later means asking the model for reporting, or reading an earlier model answer from the Verdict cache.
