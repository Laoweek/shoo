// What every Site's content script runs: boot the pipeline for that Site (architecture.md Section 12, ADR 0011).
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { onMessage } from '~/messaging/protocol';
import type { Site } from '~/sites/site';
import { readEnabled } from '~/store/read';
import { boot } from './boot';
import { browserSend } from './send';

export async function startContent(ctx: ContentScriptContext, site: Site): Promise<void> {
  const booted = await boot({
    doc: document,
    site,
    send: browserSend,
    readEnabled: () => readEnabled(site.id),
    listen: (type, cb) => onMessage(type, (m) => cb(m.data as never) as never),
  });
  // Extension reloaded or updated: this orphaned script removes its UI and observers.
  ctx.onInvalidated(() => booted.dispose());
}
