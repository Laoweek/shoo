// Test double for messaging/protocol.ts: `sendMessage` is a spy that answers from `replies`.
import { vi } from 'vitest';
import type { ProtocolMap } from '~/messaging/protocol';

type Name = keyof ProtocolMap;
type Reply<K extends Name> = (data: Parameters<ProtocolMap[K]>[0]) => ReturnType<ProtocolMap[K]> | Promise<ReturnType<ProtocolMap[K]>>;

export const replies: { [K in Name]?: Reply<K> } = {};

export const sendMessage = vi.fn(async (name: Name, data?: unknown) => {
  const reply = replies[name] as ((d: unknown) => unknown) | undefined;
  return reply ? reply(data) : undefined;
});

export function resetMessages(): void {
  sendMessage.mockClear();
  for (const k of Object.keys(replies)) delete replies[k as Name];
}

/** The payloads sent for one message name, in order. */
export const sent = (name: Name): unknown[] => sendMessage.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

export const onMessage = vi.fn();
