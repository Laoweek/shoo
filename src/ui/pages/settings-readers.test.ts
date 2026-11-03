// "No dead settings" (REQ-SET-1): every Settings field has a reader that acts on it, either a
// page or the background/content pipeline. The map names the reader files. A reader file (or, for a
// directory, one of its non-test files) must read the field as a property (`.key`), so a validator that
// only lists the key, or the page control that writes it, does not count. 'a|b' accepts either path.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Settings } from '~/core/types';
import { DEFAULT_SETTINGS } from '~/store/schema';

const ROOT = resolve(__dirname, '../../..');

/** The background router and its modules. */
const BACKGROUND = 'src/entrypoints/background.ts|src/entrypoints/background';

const READERS: Record<keyof Settings, string[]> = {
  generation: ['src/core/runtime.ts'], // settingsGeneration in every RuntimeSnapshot
  enabled: ['src/core/runtime.ts', 'src/store/read.ts'], // RuntimeState 'off', content start-up (readEnabled)
  mode: ['src/core/runtime.ts', 'src/entrypoints/content/pipeline.ts'],
  surfaces: ['src/core/runtime.ts', 'src/entrypoints/content/pipeline.ts'],
  notificationStyle: ['src/entrypoints/content/pipeline.ts'],
  dailyCap: [BACKGROUND, 'src/entrypoints/popup/state.ts'], // judgeTiles stops model calls at the cap
  escalationMode: [BACKGROUND], // Suggest lists, Automatic bans (REQ-ESC-2)
  strength: ['src/engine/judge.ts'], // removeCutoff on read
  engine: ['src/core/runtime.ts', 'src/engine/judge.ts'],
  models: ['src/engine/judge.ts'],
  direct: ['src/engine/judge.ts'],
  customEndpoint: ['src/engine/judge.ts'],
  consent: ['src/core/runtime.ts'],
  regexEnabled: ['src/engine/judge.ts'],
  shelfDismissal: ['src/entrypoints/content/pipeline.ts'], // through RuntimeSnapshot.shelfDismissal
  onboarding: ['src/entrypoints/onboarding/App.tsx', 'src/entrypoints/options/App.tsx'],
};

function sources(path: string): string[] {
  const full = join(ROOT, path);
  if (!statSync(full, { throwIfNoEntry: false })) return [];
  if (statSync(full).isFile()) return [full];
  return readdirSync(full, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => join(full, f));
}

describe('no dead settings', () => {
  it('every DEFAULT_SETTINGS key has a named reader', () => {
    const missing = Object.keys(DEFAULT_SETTINGS).filter((k) => !(k in READERS));
    expect(missing).toEqual([]);
  });

  it.each(Object.entries(READERS))('%s is read by its readers', (key, paths) => {
    const read = new RegExp(`\\.${key}\\b`);
    const reads = (p: string) => p.split('|').some((alt) => sources(alt).some((f) => read.test(readFileSync(f, 'utf8'))));
    const unread = paths.filter((p) => !reads(p));
    expect(unread, `no file under these paths reads settings.${key}`).toEqual([]);
  });
});
