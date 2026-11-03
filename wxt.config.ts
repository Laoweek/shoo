import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';

/** The short commit hash, with "-dirty" for uncommitted changes, or undefined without git (the AMO sources zip). */
function commit(): string | undefined {
  try {
    const git = (args: string) => execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return git('rev-parse --short HEAD') + (git('status --porcelain') ? '-dirty' : '');
  } catch {
    return undefined;
  }
}

// Manifest decisions: docs/spec/cross-browser-and-stores.md, Section 1.
export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,
  modules: ['@wxt-dev/i18n/module'],
  vite: () => ({
    plugins: [preact(), tailwindcss()],
    build: { sourcemap: false },
  }),
  hooks: {
    // The bundle carries Preact, Lucide and the fonts, whose licences require their notices to ship with every copy.
    'build:publicAssets': (_wxt, files) => {
      files.push({ absoluteSrc: resolve('LICENSE'), relativeDest: 'LICENSE' });
      files.push({ absoluteSrc: resolve('THIRD_PARTY_NOTICES.md'), relativeDest: 'THIRD_PARTY_NOTICES.md' });
    },
  },
  zip: {
    // Replaces WXT's default ['**/*'], so list everything the build needs (cross-browser-and-stores.md Section 3).
    includeSources: [
      'src/**',
      'public/**',
      'scripts/**',
      'wxt.config.ts',
      'package.json',
      'pnpm-lock.yaml',
      'tsconfig.json',
      'README-SOURCES.md',
      'THIRD_PARTY_NOTICES.md',
      'LICENSE',
      '.nvmrc',
    ],
    excludeSources: [
      '.output/**',
      'node_modules/**',
      '.env*',
      '.impeccable/**',
      'test/**',
      'docs/**',
      'coverage/**',
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.bench.ts',
    ],
  },
  manifest: ({ browser }) => {
    const version: string = JSON.parse(readFileSync('package.json', 'utf8')).version;
    const hash = browser === 'firefox' ? undefined : commit();
    return {
      name: '__MSG_extName__',
      short_name: 'Shoo',
      description: '__MSG_extDescription__',
      default_locale: 'en',
      permissions: ['storage', 'alarms', 'identity'],
      host_permissions: ['https://www.youtube.com/*', 'https://openrouter.ai/*', 'https://i.ytimg.com/*'],
      optional_host_permissions: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
      action: { default_title: 'Shoo' },
      commands: {
        'toggle-shoo': {
          suggested_key: { default: 'Alt+Shift+S' },
          description: '__MSG_commandToggle__',
        },
      },
      ...(browser === 'firefox'
        ? {
            browser_specific_settings: {
              gecko: {
                id: 'shoo@shoo.extension',
                strict_min_version: '140.0',
                data_collection_permissions: {
                  required: ['none'],
                  optional: ['websiteContent', 'authenticationInfo'],
                },
              },
              // No gecko_android key: AMO treats it as an Android opt-in, and Shoo is desktop only (REQ-DIST-2).
              // web-ext lint then warns that data_collection_permissions needs Firefox for Android 142; that warning is expected.
            },
          }
        : {
            minimum_chrome_version: '120',
            // Chrome shows version_name on chrome://extensions, so a build names its commit. Firefox gets none: AMO
            // rebuilds from the sources zip, which has no .git, and the result must match the upload.
            ...(hash && { version_name: `${version} (${hash})` }),
          }),
    };
  },
});
