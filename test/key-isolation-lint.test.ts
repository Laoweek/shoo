// Key isolation (REQ-MODEL-6) rests on the lint rule in eslint.config.js, so check it against
// every way a module can reach store/secret.
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: new URL('..', import.meta.url).pathname });

async function keyIsolationErrors(code: string, filePath: string): Promise<number> {
  const results = await eslint.lintText(code, { filePath });
  return results.flatMap((r) => r.messages).filter((m) => m.message.includes('Key isolation')).length;
}

const reaches = [
  `import { getOpenRouterKey } from '~/store/secret'; getOpenRouterKey();`,
  `import { getOpenRouterKey } from '../../store/secret.js'; getOpenRouterKey();`,
  `import { getOpenRouterKey } from '../../store/secret.ts'; getOpenRouterKey();`,
  `export { getOpenRouterKey } from '@/store/secret';`,
  `export const load = () => import('~/store/secret');`,
  `export const load = () => import('../../store/secret.js');`,
  'export const load = () => import(`~/store/secret`);',
  `const dir = '~/store/'; export const load = () => import(dir + 'secret');`,
  'const name = "secret"; export const load = () => import(`~/store/${name}`);',
];

describe('key isolation lint', () => {
  it.each(reaches)('rejects %s outside the engine and the background router', async (code) => {
    expect(await keyIsolationErrors(code, 'src/ui/pages/Probe.tsx')).toBe(1);
    expect(await keyIsolationErrors(code, 'src/content/probe.ts')).toBe(1);
  });

  it.each(reaches)('allows %s in the engine and the background router', async (code) => {
    expect(await keyIsolationErrors(code, 'src/engine/probe.ts')).toBe(0);
    expect(await keyIsolationErrors(code, 'src/entrypoints/background/probe.ts')).toBe(0);
  });
});
