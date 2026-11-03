// Content script entry: one bundle on every youtube.com page (ADR 0006). The pipeline lives in ./pipeline.ts,
// the bootstrap in ./boot.ts, the in-page UI adapter in ./ui.ts (initialized only on first need).
import { onMessage } from '~/messaging/protocol';
import { readEnabled } from '~/store/read';
import { boot } from './boot';
import { browserSend } from './send';

export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  runAt: 'document_idle',
  cssInjectionMode: 'manual',
  async main(ctx) {
    const booted = await boot({
      doc: document,
      send: browserSend,
      readEnabled: () => readEnabled(),
      listen: (type, cb) => onMessage(type, (m) => cb(m.data as never) as never),
    });
    // Extension reloaded or updated: this orphaned script removes its UI and observers.
    ctx.onInvalidated(() => booted.dispose());
  },
});
