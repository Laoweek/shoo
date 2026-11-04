// The transport under src/messaging/protocol.ts, shared by the background, the content scripts and the extension
// pages (docs/spec/architecture.md Section 6). A message is { type, data, timestamp }, a reply is { res } or
// { err } with err a plain { name, message }. Chrome ignores a Promise returned from an onMessage listener, so a
// handler answers through sendResponse and its listener returns true to keep the channel open.
import { browser } from 'wxt/browser';

interface Wire {
  type: string;
  data: unknown;
  timestamp: number;
}

export type WireSender = Parameters<Parameters<typeof browser.runtime.onMessage.addListener>[0]>[1];
type Handler = (data: never, sender: WireSender) => unknown;

function toError(err: unknown): unknown {
  if (typeof err !== 'object' || err === null || typeof (err as Error).message !== 'string') return err;
  const out = new Error((err as Error).message);
  if (typeof (err as Error).name === 'string') out.name = (err as Error).name;
  return out;
}

/**
 * Sends to the background, or to a tab's content scripts with `tabId`. The browser rejects with its own message
 * when nothing received it ("Receiving end does not exist", content/send.ts).
 */
export async function sendWire(type: string, data: unknown, tabId?: number): Promise<unknown> {
  const message: Wire = { type, data, timestamp: Date.now() };
  const reply = (await (tabId === undefined ? browser.runtime.sendMessage(message) : browser.tabs.sendMessage(tabId, message))) as
    | { res?: unknown; err?: unknown }
    | undefined;
  // The receiver ran no handler, or stopped before answering. content/send.ts does not retry this.
  if (reply == null) throw new Error('No response');
  if (reply.err != null) throw toError(reply.err);
  return reply.res;
}

const handlers = new Map<string, Handler>();
let removeRoot: (() => void) | null = null;

function onRoot(message: Partial<Wire> | null, sender: WireSender, sendResponse: (reply: unknown) => void): boolean {
  if (typeof message?.type !== 'string' || typeof message.timestamp !== 'number') return false;
  const handler = handlers.get(message.type);
  if (!handler) return false;
  new Promise((resolve) => resolve(handler(message.data as never, sender))).then(
    (res) => sendResponse({ res }),
    (err: unknown) => sendResponse({ err: err instanceof Error ? { name: err.name, message: err.message } : err }),
  );
  return true;
}

/** One handler per message type, a later one replaces it. Returns the function that removes it. */
export function onWire(type: string, handler: Handler): () => void {
  handlers.set(type, handler);
  if (!removeRoot) {
    browser.runtime.onMessage.addListener(onRoot);
    removeRoot = () => browser.runtime.onMessage.removeListener(onRoot);
  }
  return () => {
    if (handlers.get(type) !== handler) return;
    handlers.delete(type);
    if (handlers.size > 0) return;
    removeRoot?.();
    removeRoot = null;
  };
}
