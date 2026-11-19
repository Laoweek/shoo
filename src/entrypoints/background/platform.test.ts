import { afterEach, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { browserPlatform } from './platform';

afterEach(() => {
  vi.unstubAllEnvs();
  fakeBrowser.reset();
});

it('Firefox: sending needs every data collection category Shoo asked for, so revoking one stops it', async () => {
  vi.stubEnv('BROWSER', 'firefox');
  const asked: unknown[] = [];
  const granted = new Set(['websiteContent']);
  Object.assign(fakeBrowser.permissions, {
    contains: async (p: { data_collection: string[] }) => {
      asked.push(p);
      return p.data_collection.every((c) => granted.has(c));
    },
  });
  expect(await browserPlatform().dataCollection()).toBe(false);
  expect(asked).toEqual([{ data_collection: ['websiteContent', 'authenticationInfo'] }]);
});
