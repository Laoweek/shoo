// Versioned schema, migrations and defaults. Source of truth: docs/spec/architecture.md Section 8
// ("Schema and migrations", "Settings and defaults").
import { INITIAL_COUNTERS, type RefCounters } from '~/core/rules';
import type { Settings } from '~/core/types';
import { getOne, isRecord, type Areas } from './areas';

export const SCHEMA = 1;
export const CONSENT_VERSION = 2;

export const DEFAULT_SETTINGS: Settings = {
  generation: 0,
  enabled: true,
  mode: 'review',
  surfaces: { home: true, watchSidebar: true, shortsShelf: true, search: false, channel: false, endScreen: false },
  notificationStyle: 'summary',
  dailyCap: 5000,
  escalationMode: 'suggest',
  strength: { preset: 'balanced', custom: 0.6 },
  engine: 'openrouter',
  models: { text: 'cloudflare/clef-flash', image: 'cloudflare/clef-flash' },
  regexEnabled: false,
  onboarding: { step: 0, done: false },
};

/** `sync:meta`. Ref counters live next to the schema so they outlive purged tombstones (REQ-RULE-6). */
export interface SyncMeta extends RefCounters {
  schema: number;
}

export const META_KEY = 'meta';
export const SETTINGS_KEY = 'settings';

export type MigratedArea = 'local' | 'sync';
/** Step `i` migrates an area from schema `i` to `i + 1`. Within a version only fields are added. */
export type MigrationStep = (areas: Areas) => Promise<void>;

export const MIGRATIONS: Record<MigratedArea, MigrationStep[]> = {
  local: [
    // 0 -> 1: first install. Seed settings, keep any that exist.
    async (areas) => {
      const settings = await getOne<Settings>(areas.local, SETTINGS_KEY);
      if (!settings) await areas.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
    },
  ],
  sync: [
    // 0 -> 1: first device. Ref counters start at 1. Rule buckets need no change.
    async () => {},
  ],
};

/** Stored schema version of an area, 0 when the area has never been written. */
export async function storedSchema(areas: Areas, area: MigratedArea): Promise<number> {
  const meta = await getOne<unknown>(areas[area], META_KEY);
  return isRecord(meta) && typeof meta.schema === 'number' ? meta.schema : 0;
}

/** Whether `migrate` has work to do (the RuntimeState is `migrating` while it runs). */
export async function needsMigration(areas: Areas): Promise<boolean> {
  return (await storedSchema(areas, 'local')) < SCHEMA || (await storedSchema(areas, 'sync')) < SCHEMA;
}

/**
 * Runs the ordered steps for one area from `fromVersion` to SCHEMA and records the new version in the
 * area's meta. An area ahead of SCHEMA (a newer Shoo on another device) is left alone.
 */
export async function migrate(areas: Areas, area: MigratedArea, fromVersion: number): Promise<number> {
  if (fromVersion >= SCHEMA) return fromVersion;
  for (let v = fromVersion; v < SCHEMA; v++) {
    const step = MIGRATIONS[area][v];
    if (!step) throw new Error(`No ${area} migration from schema ${v}`);
    await step(areas);
  }
  const meta = await getOne<unknown>(areas[area], META_KEY);
  const base = isRecord(meta) ? meta : {};
  // Same key order as the sync writer, so the first load finds nothing to rewrite.
  const next: Record<string, unknown> = area === 'sync' ? { schema: SCHEMA, ...INITIAL_COUNTERS, ...base } : { ...base };
  next.schema = SCHEMA;
  await areas[area].set({ [META_KEY]: next });
  return SCHEMA;
}

/** Brings both areas to SCHEMA. Run from onInstalled and onStartup in the background. */
export async function runMigrations(areas: Areas): Promise<void> {
  await migrate(areas, 'local', await storedSchema(areas, 'local'));
  await migrate(areas, 'sync', await storedSchema(areas, 'sync'));
}

/** Stored settings with defaults filled in for fields added since they were written. */
export function withDefaults(stored: unknown): Settings {
  if (!isRecord(stored)) return DEFAULT_SETTINGS;
  return { ...DEFAULT_SETTINGS, ...(stored as Partial<Settings>) };
}
