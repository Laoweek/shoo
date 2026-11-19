// The content script entrypoints' manifest options (cross-browser-and-stores.md Section 1).
import { describe, expect, it } from 'vitest';
import { SITE_IDS } from '~/core/sites';
import { SURFACES } from '~/sites/bilibili/surfaces';

interface ContentScriptOptions {
  matches: string[];
  noScriptStartedPostMessage?: boolean;
}

const entrypoints = import.meta.glob<{ default: ContentScriptOptions }>('../entrypoints/*.content.ts', { eager: true });

// Chrome and Firefox match a pattern's path against the URL's path and query, with `*` as the only wildcard.
function patternMatches(pattern: string, url: string): boolean {
  const [, origin, path] = /^(https:\/\/[^/]+)(\/.*)$/.exec(pattern) ?? [];
  const u = new URL(url);
  const glob = new RegExp(`^${(path ?? '').split('*').map((part) => part.replace(/[.?+^$()[\]{}|\\]/g, '\\$&')).join('.*')}$`);
  return u.origin === origin && glob.test(u.pathname + u.search);
}

describe('content script entrypoints', () => {
  it('none posts WXT\'s start-up message, which names the extension ID, to the page', () => {
    expect(Object.keys(entrypoints)).toHaveLength(SITE_IDS.length);
    for (const [path, mod] of Object.entries(entrypoints)) expect(mod.default.noScriptStartedPostMessage, path).toBe(true);
  });

  it("Bilibili's runs on exactly the pages of its supported Surfaces", () => {
    const { matches } = entrypoints['../entrypoints/bilibili.content.ts']!.default;
    const urls = [
      'https://www.bilibili.com/',
      'https://www.bilibili.com/?spm_id_from=333.1007.0.0',
      'https://www.bilibili.com/video/BV1xx411c7mD',
      'https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=333.1007',
      'https://www.bilibili.com/v/popular/all',
      'https://www.bilibili.com/anime/',
    ];
    const supported = Object.values(SURFACES).filter((s) => s.supported);
    const page = {} as Element; // Bilibili's page detection reads the location alone
    for (const url of urls) {
      const served = supported.some((s) => s.matches(new URL(url) as unknown as Location, page));
      expect(matches.some((m) => patternMatches(m, url)), url).toBe(served);
    }
  });
});
