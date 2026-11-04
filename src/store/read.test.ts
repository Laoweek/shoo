import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { AreaLike } from './areas';
import { readActivity, readCounters, readEnabled, readExceptions, readRules, readSettings, watchExceptions, watchRules, watchSettings } from './read';
import { DEFAULT_SETTINGS } from './schema';
import { createMemoryArea } from './testing/quota-storage';
import { createWriter } from './writer';

beforeEach(() => fakeBrowser.reset());

describe('readEnabled (content script start-up)', () => {
  it('reads local:settings once and defaults to enabled', async () => {
    const get = vi.spyOn(fakeBrowser.storage.local, 'get');
    expect(await readEnabled('youtube')).toBe(true);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('settings');
    await fakeBrowser.storage.local.set({ settings: { ...DEFAULT_SETTINGS, enabled: false } });
    expect(await readEnabled('youtube')).toBe(false);
  });

  it('is off on a Site the user turned off, and on for the other', async () => {
    await fakeBrowser.storage.local.set({ settings: { ...DEFAULT_SETTINGS, sites: { youtube: true, bilibili: false } } });
    expect(await readEnabled('bilibili')).toBe(false);
    expect(await readEnabled('youtube')).toBe(true);
  });
});

describe('page readers', () => {
  it('read what the writer stored, through the real (fake) browser areas', async () => {
    let t = 1_760_000_000_000;
    const writer = createWriter({ now: () => ++t });
    await writer.mutateRules([
      { op: 'add', rule: { polarity: 'remove', kind: 'topic', text: 'crypto', enabled: true, origin: 'user' } },
      { op: 'add', rule: { polarity: 'keep', kind: 'topic', text: 'science', enabled: true, origin: 'user' } },
    ]);
    await writer.addException({ videoId: 'keepme00001', title: 'kept' });
    await writer.recordActivity([{ id: 'e1', kind: 'kept', at: t }]);
    await writer.bumpCounters('2026-10-10', { judged: 3 });
    await writer.flush();

    expect((await readRules()).map((r) => r.ref)).toEqual(['K1', 'R1']);
    expect((await readExceptions()).map((x) => x.videoId)).toEqual(['keepme00001']);
    expect((await readActivity()).map((e) => e.id)).toEqual(['e1']);
    expect((await readCounters('2026-10-10')).judged).toBe(3);
    expect(await readSettings()).toEqual(DEFAULT_SETTINGS);
    writer.dispose();
  });

  it('watchers fire for their own keys only and unsubscribe', async () => {
    const sync = createMemoryArea();
    const local = createMemoryArea();
    const onSettings = vi.fn();
    const onRules = vi.fn();
    const onExceptions = vi.fn();
    const offs = [watchSettings(onSettings, { sync, local }), watchRules(onRules, { sync, local }), watchExceptions(onExceptions, { sync, local })];
    await local.set({ settings: DEFAULT_SETTINGS });
    await sync.set({ 'rules:b0': {} });
    await local.set({ 'exceptions:archive:a': {} });
    await local.set({ unrelated: 1 });
    await Promise.resolve();
    expect([onSettings.mock.calls.length, onRules.mock.calls.length, onExceptions.mock.calls.length]).toEqual([1, 1, 1]);
    offs.forEach((off) => off());
    await local.set({ settings: DEFAULT_SETTINGS });
    await Promise.resolve();
    expect(onSettings).toHaveBeenCalledTimes(1);
  });

  it('accept injected areas', async () => {
    const local: AreaLike = createMemoryArea();
    await local.set({ settings: { enabled: false } });
    expect(await readEnabled('youtube', local)).toBe(false);
    expect((await readSettings({ local })).mode).toBe('review');
  });
});
