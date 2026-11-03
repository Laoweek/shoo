import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

// Two projects: `unit` (default, hermetic) and `live` (opt-in, real OpenRouter calls, reads .env.local).
export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.bench.ts'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          setupFiles: ['test/setup.ts'],
          include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
          exclude: ['**/*.live.test.ts', 'node_modules/**'],
          benchmark: { include: ['src/**/*.bench.ts'] },
        },
      },
      {
        extends: true,
        test: {
          name: 'live',
          setupFiles: ['test/setup.ts'],
          include: ['src/**/*.live.test.ts', 'test/**/*.live.test.ts'],
          testTimeout: 60_000,
        },
      },
    ],
  },
});
