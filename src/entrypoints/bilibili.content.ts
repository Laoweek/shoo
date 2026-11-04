// Bilibili content script: one bundle on Bilibili's Home, the only page with a supported Surface (ADR 0006,
// ADR 0011, bilibili-integration.md Section 1). Home is a page of its own, so no in-app navigation brings the user
// there from a page without the script. Widen `matches` when a Surface on another page becomes supported. The pipeline
// lives in src/content/, the Site in src/sites/bilibili/. The in-page UI is initialized only on first need.
import { startContent } from '~/content/start';
import { bilibili } from '~/sites/bilibili';

export default defineContentScript({
  // A match pattern's path is matched against the path and query, so Home with a query (`/?spm_id_from=…`) needs its own.
  matches: ['https://www.bilibili.com/', 'https://www.bilibili.com/?*'],
  runAt: 'document_idle',
  cssInjectionMode: 'manual',
  // WXT's start-up window.postMessage names the extension ID to every page script. Invalidation works without it:
  // WXT also signals a newer copy of this script with a document event only content scripts listen for.
  noScriptStartedPostMessage: true,
  main: (ctx) => startContent(ctx, bilibili),
});
