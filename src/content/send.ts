// Content → background messaging with one retry (docs/spec/architecture.md Section 11, "Surviving restarts").
// The background is disposable on both browsers (Chrome service worker, Firefox event page). A message sent while
// it is starting finds no receiving end: wait 250 ms and send once more. A second failure is returned to the
// caller, which leaves its Tiles undecided for the next rescan. Only a message that was never delivered is retried:
// a closed port or a missing response can come after the background ran the handler, and repeating a write
// (reportActionResult, addException, reportUndo) would record it twice.
import type { GetDataType, GetReturnType } from '@webext-core/messaging';
import { sendMessage, type ProtocolMap } from '~/messaging/protocol';

export type Data<K extends keyof ProtocolMap> = GetDataType<ProtocolMap[K]>;
export type Reply<K extends keyof ProtocolMap> = GetReturnType<ProtocolMap[K]>;
export type Send = <K extends keyof ProtocolMap>(type: K, data: Data<K>) => Promise<Reply<K>>;

export const RETRY_MS = 250;

// Never delivered. Chrome: "Could not establish connection. Receiving end does not exist." Firefox uses the same
// wording. Not retried: "The message port closed before a response was received." and @webext-core/messaging's
// "No response" (the background may have stopped mid-call, after the handler ran).
const DROPPED = /receiving end does not exist|could not establish connection/i;

export const isDropped = (err: unknown): boolean => DROPPED.test(err instanceof Error ? err.message : String(err));

/** The real messenger. Tests pass their own `Send`. */
export const browserSend: Send = (type, data) => (sendMessage as (t: typeof type, d: typeof data) => Promise<never>)(type, data);

export function withRetry(send: Send, delayMs = RETRY_MS): Send {
  return async (type, data) => {
    try {
      return await send(type, data);
    } catch (err) {
      if (!isDropped(err)) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
      return send(type, data);
    }
  };
}
