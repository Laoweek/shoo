# WXT with Preact, hand-built components, and extension storage instead of IndexedDB

Shoo targets Chrome and Firefox desktop with one MV3 codebase built by WXT, which handles Firefox's event-page background, the per-browser manifest, and the sources zip AMO reviewers rebuild. The UI uses Preact (about 6 KB gzipped) instead of React (about 69 KB) because the content script loads on every youtube.com page, and components are hand-built to Shoo's design instead of shadcn/Radix, whose Preact compatibility is unproven. Activity and the Verdict cache live in capped `storage.local` instead of Dexie/IndexedDB, because Firefox cannot open IndexedDB in "always use private browsing" mode and `storage.local` is reachable from every context.

**Consequences**: React component libraries such as shadcn are not reusable. Anyone proposing to "upgrade" to React or IndexedDB should first measure content-script cost and test Firefox private mode.
