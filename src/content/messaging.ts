// Content's end of the messages in src/messaging/protocol.ts, over the shared transport in src/messaging/wire.ts.
import { onWire, sendWire } from '~/messaging/wire';
import type { Data, Reply, Send } from './send';

/** The background → content messages (src/entrypoints/background/platform.ts, ToTab). */
export type ToContent = 'runtimeStateChanged' | 'settingsChanged' | 'undoRemoval' | 'tileVerdicts';
export type Handler<K extends ToContent> = (data: Data<K>) => Reply<K> | Promise<Reply<K>>;

export const sendMessage: Send = (type, data) => sendWire(type, data) as never;

/** One handler per message type, a later one replaces it. Returns the function that removes it. */
export const onMessage = <K extends ToContent>(type: K, handler: Handler<K>): (() => void) => onWire(type, handler as (data: never) => unknown);
