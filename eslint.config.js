// Lint config. The import-boundary rules enforce docs/spec/architecture.md Section 4 (module rules)
// and key isolation (REQ-MODEL-6): only src/engine/** and the background router may import store/secret.
import tseslint from 'typescript-eslint';

const secretMessage = 'Key isolation: only src/engine/ and the background router may import store/secret.ts (REQ-MODEL-6).';
// Any specifier that resolves to store/secret, with or without an extension, index path or Vite query.
const secretSpecifier = String.raw`(^|\/)store\/secret(\.[cm]?[jt]sx?)?([\/?#]|$)`;
const secret = { regex: secretSpecifier, message: secretMessage };
// no-restricted-imports never sees import(), so a dynamic import of the key store needs its own rules: one for a
// quoted or backtick specifier, and one that refuses any specifier the lint cannot read, such as a concatenation.
const secretDynamicImport = [
  { selector: `ImportExpression > Literal.source[value=/${secretSpecifier}/]`, message: secretMessage },
  { selector: `ImportExpression > TemplateLiteral.source[expressions.length=0] > TemplateElement[value.cooked=/${secretSpecifier}/]`, message: secretMessage },
  {
    selector: 'ImportExpression > .source:not(Literal, TemplateLiteral[expressions.length=0])',
    message: 'Key isolation: outside src/engine/ and the background router, import() takes a plain string, so the lint can check it (REQ-MODEL-6).',
  },
];
const sites = { group: ['~/sites/**', '@/sites/**', '**/sites/**'], message: 'sites/ is imported only by the content engine (src/content/) and the content entrypoints (architecture.md Section 4).' };
const content = { group: ['~/content/**', '@/content/**', '**/content/**'], message: 'content/ is imported only by the content entrypoints (architecture.md Section 4).' };
const engine = { group: ['**/engine/*', '~/engine/*', '@/engine/*'], message: 'engine/ is imported only from entrypoints/background/ (architecture.md Section 4).' };
const writer = { group: ['**/store/writer', '~/store/writer', '@/store/writer'], message: 'store/writer.ts is imported only from entrypoints/background/.' };
const coreOut = { group: ['~/*', '@/*', '../*', '!../core/*'], message: 'core/ imports nothing outside core/ (architecture.md Section 4).' };

const restrict = (...patterns) => ({
  'no-restricted-imports': ['error', { patterns }],
  'no-restricted-syntax': patterns.includes(secret) ? ['error', ...secretDynamicImport] : 'off',
});

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
  // Default for all source files: no secret, no Site adapters, no content engine, no engine, no writer.
  { files: ['src/**/*.{ts,tsx}'], rules: restrict(secret, sites, content, engine, writer) },
  // core/ is pure.
  { files: ['src/core/**/*.ts'], rules: restrict(secret, sites, content, engine, writer, coreOut) },
  // engine/ may import secret.
  { files: ['src/engine/**/*.ts'], rules: restrict(sites, content, writer) },
  // A Site knows its own markup and nothing of the engine that drives it.
  { files: ['src/sites/**/*.ts'], rules: restrict(secret, content, engine, writer) },
  // The content engine drives any Site.
  { files: ['src/content/**/*.{ts,tsx}'], rules: restrict(secret, engine, writer) },
  // store/ internals: writer and secret are store's own files.
  { files: ['src/store/**/*.ts'], rules: restrict(sites, content, engine) },
  // The background router may import engine, writer and secret.
  { files: ['src/entrypoints/background/**/*.ts'], rules: restrict(sites, content) },
  // A content entrypoint starts the engine for its Site.
  { files: ['src/entrypoints/*.content.ts'], rules: restrict(secret, engine, writer) },
  // Tests may reach across boundaries to set up fixtures.
  { files: ['**/*.test.{ts,tsx}', '**/*.bench.ts', 'test/**/*.ts', 'src/sites/*/test-harness.ts'], rules: { 'no-restricted-imports': 'off', 'no-restricted-syntax': 'off' } },
);
