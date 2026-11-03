// The background router assembled: services, routes for every inbound message, and lifecycle handlers.
// index.ts registers the browser listeners. Source of truth: docs/spec/architecture.md Sections 6, 7 and 11.
import { forgetRemovalTabsOf, clearPrivateTab } from '~/store/session';
import { actionRoutes } from './handlers/actions';
import { connectionRoutes } from './handlers/connection';
import { createEscalation, escalationRoutes } from './handlers/escalation';
import { judgingRoutes } from './handlers/judging';
import { applySettings, settingsRoutes } from './handlers/settings';
import { userBanRoutes } from './handlers/user-ban';
import { shelfRoutes } from './handlers/shelves';
import type { Platform } from './platform';
import { createDispatch, type Routes } from './router';
import { createServices } from './services';

export const RETENTION_ALARM = 'shoo:retention';
export const TOGGLE_COMMAND = 'toggle-shoo';

/** Must run synchronously at background start (the writer registers storage.sync.onChanged). */
export function createBackground(platform: Platform) {
  const s = createServices(platform);
  const esc = createEscalation(s);
  // Remote Rule merges (other devices) and imports: new rulesVersion, tell the tabs.
  s.onRulesChanged = () => {
    void s.state
      .broadcastSettings()
      .then(() => s.state.refresh())
      .catch(() => undefined);
  };

  const routes: Routes = {
    ...judgingRoutes(s),
    ...actionRoutes(s, esc),
    ...escalationRoutes(s, esc),
    ...connectionRoutes(s),
    ...settingsRoutes(s),
    ...userBanRoutes(s),
    ...shelfRoutes(s),
  };
  const dispatch = createDispatch(routes, platform);

  async function ensureAlarm(): Promise<void> {
    if (!(await platform.alarms.get(RETENTION_ALARM))) await platform.alarms.create(RETENTION_ALARM, { periodInMinutes: 1440, delayInMinutes: 1 });
  }

  async function start(): Promise<void> {
    await s.ensureInit();
    await ensureAlarm();
    await s.state.refresh();
  }

  return {
    services: s,
    routes,
    dispatch,

    async onInstalled(reason: string): Promise<void> {
      if (reason === 'install') await platform.tabs.create({ url: platform.getURL('/onboarding.html') });
      await start();
    },

    onStartup: start,

    async onAlarm(name: string): Promise<void> {
      if (name !== RETENTION_ALARM) return;
      await s.writer.runRetention();
      await s.state.refresh(); // a new day may clear the Daily cap and the badge
    },

    /** REQ-KEY-1: flips `enabled` through the same path as updateSettings. */
    async onCommand(command: string): Promise<void> {
      if (command !== TOGGLE_COMMAND) return;
      const { enabled } = await s.writer.getSettings();
      await applySettings(s, { enabled: !enabled });
    },

    /**
     * A closed tab: its Removals can no longer be undone, its private Exceptions and review count go.
     * Exclusive with recordRemovalTab and forgetRemovalTab, which read-modify-write the same session key.
     * Running it twice for one tab is harmless.
     */
    async onTabRemoved(tabId: number): Promise<void> {
      const { session } = platform.areas;
      await s.exclusive(async () => {
        await forgetRemovalTabsOf(session, tabId);
        await clearPrivateTab(session, tabId);
      });
      await s.state.forgetTab(tabId);
    },

    /**
     * permissions.onAdded and onRemoved: a host or (Firefox) the data collection permission changed.
     * The refresh sends runtimeStateChanged when the snapshot changed, so a re-grant rescans at once.
     */
    async onPermissionsChanged(): Promise<void> {
      await s.state.refresh();
    },

    /** `online` and `offline` events on the background global. */
    async onNetwork(online: boolean): Promise<void> {
      s.state.setOfflineEvent(!online);
      await s.state.refresh();
    },
  };
}

export type Background = ReturnType<typeof createBackground>;
