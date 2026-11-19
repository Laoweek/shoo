// Content's messenger and the background's end of src/messaging/wire.ts over a runtime that behaves like Chrome's:
// messages and replies are JSON-cloned, a listener keeps the channel open by returning true, and a send that no
// listener takes rejects.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { onWire, sendWire } from '~/messaging/wire';
import { onMessage, sendMessage } from './messaging';
import { isDropped } from './send';

type Listener = (message: unknown, sender: object, sendResponse: (r: unknown) => void) => unknown;

const listeners = new Set<Listener>();
const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const SENDER = { id: 'shoo', tab: { id: 7, url: 'https://www.youtube.com/' } };

function deliver(message: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (listeners.size === 0) return reject(new Error('Could not establish connection. Receiving end does not exist.'));
    let open = false;
    for (const l of [...listeners]) if (l(clone(message), SENDER, (r) => resolve(clone(r))) === true) open = true;
    if (!open) reject(new Error('The message port closed before a response was received.'));
  });
}

const offs: Array<() => void> = [];

beforeEach(() => {
  vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation(((message: unknown) => deliver(message)) as never);
  vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockImplementation(((_tab: number, message: unknown) => deliver(message)) as never);
  vi.spyOn(fakeBrowser.runtime.onMessage, 'addListener').mockImplementation((l) => void listeners.add(l as Listener));
  vi.spyOn(fakeBrowser.runtime.onMessage, 'removeListener').mockImplementation((l) => void listeners.delete(l as Listener));
});

afterEach(() => {
  for (const off of offs.splice(0)) off();
  vi.restoreAllMocks();
  listeners.clear();
});

describe('content to background', () => {
  const background = (type: string, handler: (data: never, sender: unknown) => unknown) => offs.push(onWire(type, handler));

  it("returns the background's reply", async () => {
    background('openSettings', (data: { hash: string }) => ({ got: data.hash }));
    await expect(sendMessage('openSettings', { hash: 'rules' })).resolves.toEqual({ got: 'rules' });
  });

  it("gives the background handler the browser's sender", async () => {
    background('openSettings', (_data, sender) => sender);
    await expect(sendMessage('openSettings', {})).resolves.toEqual(SENDER);
  });

  it('resolves a handler that returns nothing', async () => {
    background('reportUndo', () => undefined);
    await expect(sendMessage('reportUndo', { videoId: 'aaaaaaaaaaa', via: 'shoo' })).resolves.toBeUndefined();
  });

  it('rejects with the message the background handler threw', async () => {
    background('reportUndo', () => {
      throw new Error('storage full');
    });
    await expect(sendMessage('reportUndo', { videoId: 'aaaaaaaaaaa', via: 'shoo' })).rejects.toThrow('storage full');
  });

  it('rejects a send nothing received in a way send.ts retries, and an unanswered one in a way it does not', async () => {
    const neverDelivered = await sendMessage('openSettings', {}).catch((e: unknown) => e);
    expect(isDropped(neverDelivered)).toBe(true);
    background('reportUndo', () => undefined);
    const unanswered = await sendMessage('openSettings', {}).catch((e: unknown) => e);
    expect(unanswered).toBeInstanceOf(Error);
    expect(isDropped(unanswered)).toBe(false);
    listeners.clear();
    listeners.add((_m, _s, sendResponse) => sendResponse(undefined));
    const empty = await sendMessage('openSettings', {}).catch((e: unknown) => e);
    expect((empty as Error).message).toBe('No response');
    expect(isDropped(empty)).toBe(false);
  });
});

describe('background to content', () => {
  it("returns the content handler's reply, also from a promise", async () => {
    offs.push(onMessage('undoRemoval', async (req) => ({ ok: req.videoId === 'aaaaaaaaaaa' }) as never));
    await expect(sendWire('undoRemoval', { videoId: 'aaaaaaaaaaa' }, 7)).resolves.toEqual({ ok: true });
  });

  it('resolves a handler that returns nothing, so the background does not see "No response"', async () => {
    offs.push(onMessage('settingsChanged', () => undefined));
    await expect(sendWire('settingsChanged', { settingsGeneration: 2, rulesVersion: 'r' }, 7)).resolves.toBeUndefined();
  });

  it('rejects with the message the content handler threw', async () => {
    offs.push(
      onMessage('runtimeStateChanged', () => {
        throw new TypeError('bad snapshot');
      }),
    );
    const err = await sendWire('runtimeStateChanged', {}, 7).catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'TypeError', message: 'bad snapshot' });
  });

  it('stops listening once every handler is removed', async () => {
    const off = onMessage('settingsChanged', () => undefined);
    expect(listeners.size).toBe(1);
    off();
    expect(listeners.size).toBe(0);
  });
});
