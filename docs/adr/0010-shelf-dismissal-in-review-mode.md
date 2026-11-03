# Shelf dismissal runs in Review mode, and its failures are not reported

A Shelf dismissal performs a Shelf's own "Show fewer Shorts" or "Show fewer games" on Home when the user switched that Shelf on in Settings (REQ-ACT-6). Review mode exists because a Verdict can be wrong, so Shoo asks on each flagged Tile. A Shelf dismissal has no Verdict to be wrong about: the switch is the user's own choice, made for one known Shelf. So it runs in Auto and in Review, the default Mode, and never in Dry-run. Asking on the Shelf in Review would need new in-page UI in the size-limited content bundle (ADR 0006) for a question the user already answered.

Only the Shorts shelf's header menu is captured. Its dismissed state and the whole games shelf are still guesses (`youtube-integration.md` Section 10). A failed Shelf dismissal is therefore not reported: it moves no failure counter, runs no markup check and shows no notice, so a wrong guess can never trip a breaker and stop Tile Removals.

**Consequences**: in Review mode Shoo acts on YouTube without a click on the page, for Shelves only. If YouTube changes or never had the guessed controls, the switch silently does nothing and nothing in Activity says so. Reporting Shelf failures, in their own category or as Activity rows, is the step to take once fixtures confirm the selectors.
