// Lint config. The import-boundary rules enforce docs/spec/architecture.md Section 4 (module rules)
// and key isolation (REQ-MODEL-6): only src/engine/** and the background router may import store/secret.
import tseslint from 'typescript-eslint';

const secret = { group: ['**/store/secret', '**/store/secret.ts', '~/store/secret', '@/store/secret'], message: 'Key isolation: only src/engine/ and the background router may import store/secret.ts (REQ-MODEL-6).' };
const youtube = { group: ['**/youtube/*', '~/youtube/*', '@/youtube/*'], message: 'youtube/ is imported only from entrypoints/content (architecture.md Section 4).' };
const engine = { group: ['**/engine/*', '~/engine/*', '@/engine/*'], message: 'engine/ is imported only from entrypoints/background/ (architecture.md Section 4).' };
const writer = { group: ['**/store/writer', '~/store/writer', '@/store/writer'], message: 'store/writer.ts is imported only from entrypoints/background/.' };
const coreOut = { group: ['~/*', '@/*', '../*', '!../core/*'], message: 'core/ imports nothing outside core/ (architecture.md Section 4).' };

const restrict = (...patterns) => ({ 'no-restricted-imports': ['error', { patterns }] });

export default tseslint.config(
  { ignores: ['.output/**', '.wxt/**', 'node_modules/**', 'coverage/**', '.impeccable/**', 'docs/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      'no-eval': 'error',
      'no-new-func': 'error',
    },
  },
  // Default for all source files: no secret, no youtube, no engine, no writer.
  { files: ['src/**/*.{ts,tsx}'], rules: restrict(secret, youtube, engine, writer) },
  // core/ is pure.
  { files: ['src/core/**/*.ts'], rules: restrict(secret, youtube, engine, writer, coreOut) },
  // engine/ may import secret.
  { files: ['src/engine/**/*.ts'], rules: restrict(youtube, writer) },
  // youtube/ internals import each other.
  { files: ['src/youtube/**/*.ts'], rules: restrict(secret, engine, writer) },
  // store/ internals: writer and secret are store's own files.
  { files: ['src/store/**/*.ts'], rules: restrict(youtube, engine) },
  // The background router may import engine, writer and secret.
  { files: ['src/entrypoints/background/**/*.ts'], rules: restrict(youtube) },
  // The content script may import youtube/.
  { files: ['src/entrypoints/content/**/*.{ts,tsx}'], rules: restrict(secret, engine, writer) },
  // Tests may reach across boundaries to set up fixtures.
  { files: ['**/*.test.{ts,tsx}', '**/*.bench.ts', 'test/**/*.ts'], rules: { 'no-restricted-imports': 'off' } },
);
