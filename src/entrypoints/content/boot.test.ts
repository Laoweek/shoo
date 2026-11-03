// @vitest-environment jsdom
// Bootstrap, batching and message retry (docs/spec/architecture.md Sections 11 and 12).
import '~/ui/test/catalogue';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { removeOverlay } from '~/ui/in-page';
import { FIXTURES, fakeIntersection, loadPage, manualScheduler } from '~/youtube/test-harness';
import { createBatcher } from './batcher';
import { boot, type BootDeps, type Booted } from './boot';
import contentScript from './index';
import { RETRY_MS, withRetry } from './send';
import { DROPPED, OFF, fakeBackground, shooHosts, snapshot } from './testing';

let observers = 0;
let booted: Booted | undefined;

beforeEach(() => {
  observers = 0;
  const Real = window.MutationObserver;
  vi.stubGlobal(
    'MutationObserver',
    class extends Real {
      constructor(cb: MutationCallback) {
        super(cb);
        observers += 1;
      }
    },
  );
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  loadPage(FIXTURES.pageHome, '/');
});
afterEach(() => {
  booted?.dispose();
  booted = undefined;
  act(() => removeOverlay());
  vi.unstubAllGlobals();
  vi.stubGlobal('chrome', fakeBrowser);
  vi.stubGlobal('browser', fakeBrowser);
  vi.useRealTimers();
  fakeBrowser.reset();
  document.body.innerHTML = '';
});

type Handler = (data: unknown) => unknown;

function bootDeps(enabled: boolean) {
  const bg = fakeBackground();
  const handlers = new Map<string, Handler>();
  const deps: BootDeps = {
    doc: document,
    send: bg.send,
    readEnabled: vi.fn(async () => enabled),
    listen: ((type: string, cb: Handler) => {
      handlers.set(type, cb);
      return () => handlers.delete(type);
    }) as BootDeps['listen'],
    watcher: { schedule: manualScheduler().schedule, intersection: fakeIntersection().factory },
  };
  return { bg, deps, handlers };
}

describe('content script entry with Shoo off at load', () => {
  it('reads settings once, then registers no observers and sends no messages', async () => {
    await fakeBrowser.storage.local.set({ settings: { enabled: false } });
    const get = vi.spyOn(fakeBrowser.storage.local, 'get');
    const send = vi.spyOn(fakeBrowser.runtime, 'sendMessage');
    const listen = vi.spyOn(fakeBrowser.runtime.onMessage, 'addListener');
    const onInvalidated = vi.fn();
    await contentScript.main({ onInvalidated } as never);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('settings');
    expect(observers).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(listen).toHaveBeenCalledTimes(1); // the messaging root listener: runtimeStateChanged and settingsChanged
    expect(shooHosts()).toBe(0);
    expect(document.querySelector('shoo-placeholder')).toBeNull();
    expect(onInvalidated).toHaveBeenCalledTimes(1);
  });
});

describe('boot', () => {
  it('off at load: only the two broadcast listeners, nothing else; turning on later starts the pipeline', async () => {
    const { bg, deps, handlers } = bootDeps(false);
    booted = await boot(deps);
    expect([...handlers.keys()].sort()).toEqual(['runtimeStateChanged', 'settingsChanged']);
    expect(bg.calls).toEqual([]);
    expect(observers).toBe(0);
    expect(booted.pipeline()).toBeNull();
    // A broadcast that keeps Shoo off changes nothing.
    handlers.get('runtimeStateChanged')?.(OFF);
    expect(booted.pipeline()).toBeNull();
    // toggle-shoo turns it on.
    handlers.get('runtimeStateChanged')?.(snapshot());
    expect(booted.pipeline()?.running).toBe(true);
    expect(handlers.has('undoRemoval')).toBe(true);
    expect(observers).toBeGreaterThan(0);
  });

  it('off at load: a settingsChanged sends nothing (turning on comes as runtimeStateChanged)', async () => {
    const { bg, deps, handlers } = bootDeps(false);
    booted = await boot(deps);
    handlers.get('settingsChanged')?.({ settingsGeneration: 2, rulesVersion: 'rv1' });
    await Promise.resolve();
    expect(bg.calls).toEqual([]);
    expect(booted.pipeline()).toBeNull();
  });

  it('toggle-shoo off through the runtimeStateChanged listener unmounts everything', async () => {
    const { deps, handlers } = bootDeps(true);
    booted = await boot(deps);
    handlers.get('runtimeStateChanged')?.({ ...OFF, settingsGeneration: 2 });
    expect(booted.pipeline()?.running).toBe(false);
    expect(shooHosts()).toBe(0);
  });

  it('on at load: asks for the RuntimeSnapshot and starts, without mounting any UI (mountUi not called)', async () => {
    const { bg, deps } = bootDeps(true);
    booted = await boot(deps);
    expect(bg.calls.map((c) => c.type)).toEqual(['getRuntimeState', 'reportMarkupCheck']); // the self-test passed at bind
    const p = booted.pipeline();
    expect(p?.running).toBe(true);
    expect(p?.ui.mounted).toBe(false);
    expect(shooHosts()).toBe(0);
  });

  it('on at load with an unreachable background: retries after 1 s, 5 s and 30 s, then when the tab is shown', async () => {
    vi.useFakeTimers();
    const { bg, deps } = bootDeps(true);
    bg.drop = 2 * 4; // the first attempt and three back-off attempts each fail twice
    const started = boot(deps);
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    booted = await started;
    expect(booted.pipeline()).toBeNull();
    const attempts = () => bg.of('getRuntimeState').length;
    expect(attempts()).toBe(2);
    await vi.advanceTimersByTimeAsync(1000 + RETRY_MS);
    expect(attempts()).toBe(4);
    await vi.advanceTimersByTimeAsync(5000 + RETRY_MS);
    expect(attempts()).toBe(6);
    await vi.advanceTimersByTimeAsync(30_000 + RETRY_MS);
    expect(attempts()).toBe(8);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(attempts()).toBe(8); // no endless polling
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(booted.pipeline()?.running).toBe(true);
  });

  it('a malformed broadcast is ignored', async () => {
    const { deps, handlers } = bootDeps(false);
    booted = await boot(deps);
    handlers.get('runtimeStateChanged')?.({ enabled: 'yes' });
    expect(booted.pipeline()).toBeNull();
  });

  it('undoRemoval while the page has nothing to undo answers notFound or expired', async () => {
    const { deps, handlers } = bootDeps(true);
    booted = await boot(deps);
    expect(await handlers.get('undoRemoval')?.({ videoId: 'FIXTURE0001' })).toEqual({ ok: false, reason: 'notFound' });
    handlers.get('runtimeStateChanged')?.(OFF);
    expect(await handlers.get('undoRemoval')?.({ videoId: 'FIXTURE0001' })).toEqual({ ok: false, reason: 'expired' });
  });
});

describe('batcher', () => {
  it('flushes at 16 items at once', () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    const b = createBatcher<number>(flush);
    for (let i = 0; i < 16; i++) b.add(i);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush.mock.calls[0]?.[0]).toHaveLength(16);
    expect(b.size()).toBe(0);
  });

  it('flushes 400 ms after the first queued item, not the last', () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    const b = createBatcher<number>(flush);
    b.add(1);
    vi.advanceTimersByTime(300);
    b.add(2);
    vi.advanceTimersByTime(99);
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(flush).toHaveBeenCalledWith([1, 2]);
    b.add(3);
    b.clear();
    vi.advanceTimersByTime(1000);
    expect(flush).toHaveBeenCalledTimes(1);
  });
});

describe('withRetry', () => {
  it(`retries once after ${RETRY_MS} ms when the receiving end does not exist`, async () => {
    vi.useFakeTimers();
    const raw = vi.fn().mockRejectedValueOnce(new Error(DROPPED)).mockResolvedValueOnce('ok');
    const p = withRetry(raw as never)('getRuntimeState', undefined);
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(await p).toBe('ok');
    expect(raw).toHaveBeenCalledTimes(2);
  });

  it('a second failure is returned to the caller', async () => {
    vi.useFakeTimers();
    const raw = vi.fn().mockRejectedValue(new Error(DROPPED));
    const p = withRetry(raw as never)('getRuntimeState', undefined);
    const caught = p.catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(await caught).toMatch(/receiving end/i);
    expect(raw).toHaveBeenCalledTimes(2);
  });

  it.each(['The message port closed before a response was received.', 'No response'])(
    'a failure after the message may have been delivered (%s) is not retried, so writes never repeat',
    async (message) => {
      const raw = vi.fn().mockRejectedValue(new Error(message));
      await expect(withRetry(raw as never)('reportActionResult', {} as never)).rejects.toThrow(message);
      expect(raw).toHaveBeenCalledTimes(1);
    },
  );

  it('other errors are not retried', async () => {
    const raw = vi.fn().mockRejectedValue(new Error('invalidInput'));
    await expect(withRetry(raw as never)('getRuntimeState', undefined)).rejects.toThrow('invalidInput');
    expect(raw).toHaveBeenCalledTimes(1);
  });
});
