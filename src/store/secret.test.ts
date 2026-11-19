import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  clearCustomKey,
  clearOpenRouterKey,
  getCustomKey,
  getOpenRouterKey,
  hasOpenRouterKey,
  setCustomKey,
  setOpenRouterKey,
} from './secret';

beforeEach(() => fakeBrowser.reset());

describe('key accessors', () => {
  it('store, read and clear the OpenRouter key in local:secret:openrouterKey', async () => {
    expect(await hasOpenRouterKey()).toBe(false);
    await setOpenRouterKey({ key: 'sk-or-v1-test', source: 'oauth', label: 'Shoo', connectedAt: 5 });
    expect(await getOpenRouterKey()).toEqual({ key: 'sk-or-v1-test', source: 'oauth', label: 'Shoo', connectedAt: 5 });
    expect(await hasOpenRouterKey()).toBe(true);
    expect(Object.keys(await fakeBrowser.storage.local.get(null))).toEqual(['secret:openrouterKey']);
    await clearOpenRouterKey();
    expect(await getOpenRouterKey()).toBeUndefined();
  });

  it('rejects a malformed record and ignores a corrupt stored one', async () => {
    await expect(setOpenRouterKey({ key: '', source: 'pasted', connectedAt: 1 })).rejects.toThrow();
    await fakeBrowser.storage.local.set({ 'secret:openrouterKey': { key: 42 } });
    expect(await getOpenRouterKey()).toBeUndefined();
  });

  it('store, read and clear the custom endpoint key', async () => {
    await setCustomKey({ key: 'custom-secret' });
    expect(await getCustomKey()).toEqual({ key: 'custom-secret' });
    expect(Object.keys(await fakeBrowser.storage.local.get(null))).toEqual(['secret:customKey']);
    await clearCustomKey();
    expect(await getCustomKey()).toBeUndefined();
  });

  it('read.ts never touches the secret items', () => {
    const src = readFileSync(new URL('./read.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/from '\.\/secret'/);
    expect(src).not.toContain('secret:');
  });
});
