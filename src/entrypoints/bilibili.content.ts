// Bilibili content script: one bundle on every www.bilibili.com page (ADR 0006, ADR 0011). The pipeline lives in
// src/content/, the Site in src/sites/bilibili/. The in-page UI is initialized only on first need.
import { startContent } from '~/content/start';
import { bilibili } from '~/sites/bilibili';

export default defineContentScript({
  matches: ['https://www.bilibili.com/*'],
  runAt: 'document_idle',
  cssInjectionMode: 'manual',
  main: (ctx) => startContent(ctx, bilibili),
});
