// Background entrypoint (Chrome service worker, Firefox event page). Everything that matters lives in
// storage, so every listener is registered synchronously here and the router can be rebuilt on any wake-up.
// Source of truth: docs/spec/architecture.md Section 11 (lifecycle) and Section 6 (messages).
import { onMessage } from '~/messaging/protocol';
import { createBackground } from './app';
import { browserPlatform } from './platform';
import type { Inbound } from './router';

export default defineBackground(() => {
  const bg = createBackground(browserPlatform());
  const quiet = (what: string) => (e: unknown) => bg.services.platform.log?.(what, { name: e instanceof Error ? e.name : 'unknown' });

  for (const type of Object.keys(bg.routes) as Inbound[]) {
    (onMessage as (t: Inbound, cb: (m: { data: unknown; sender: Parameters<typeof bg.dispatch>[2] }) => Promise<unknown>) => void)(type, (m) =>
      bg.dispatch(type, m.data, m.sender),
    );
  }

  browser.runtime.onInstalled.addListener(({ reason }) => void bg.onInstalled(reason).catch(quiet('onInstalled')));
  browser.runtime.onStartup.addListener(() => void bg.onStartup().catch(quiet('onStartup')));
  browser.alarms.onAlarm.addListener((alarm) => void bg.onAlarm(alarm.name).catch(quiet('onAlarm')));
  browser.commands.onCommand.addListener((command) => void bg.onCommand(command).catch(quiet('onCommand')));
  browser.tabs.onRemoved.addListener((tabId) => void bg.onTabRemoved(tabId).catch(quiet('onTabRemoved')));
  browser.permissions.onAdded.addListener(() => void bg.onPermissionsChanged().catch(quiet('permissionsAdded')));
  browser.permissions.onRemoved.addListener(() => void bg.onPermissionsChanged().catch(quiet('permissionsRemoved')));
  globalThis.addEventListener?.('online', () => void bg.onNetwork(true).catch(quiet('online')));
  globalThis.addEventListener?.('offline', () => void bg.onNetwork(false).catch(quiet('offline')));
});
