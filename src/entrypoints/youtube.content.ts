// YouTube content script: one bundle on every youtube.com page (ADR 0006). The pipeline lives in src/content/, the
// Site in src/sites/youtube/. The in-page UI is initialized only on first need.
import { startContent } from '~/content/start';
import { youtube } from '~/sites/youtube';

export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  runAt: 'document_idle',
  cssInjectionMode: 'manual',
  main: (ctx) => startContent(ctx, youtube),
});
