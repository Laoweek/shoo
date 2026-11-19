import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { harness } from './testing';

const registered: string[] = [];
vi.mock('~/messaging/wire', () => ({
  onWire: (type: string) => void registered.push(type),
  sendWire: vi.fn(),
}));

describe('background entrypoint', () => {
  it('registers one listener per inbound message and the lifecycle listeners synchronously', async () => {
    fakeBrowser.reset();
    const onCommand = vi.spyOn(fakeBrowser.commands.onCommand, 'addListener').mockImplementation(() => undefined);
    // fakeBrowser does not implement permissions events. Both are needed to refresh on host and data collection changes.
    const permissionEvents = [fakeBrowser.permissions.onAdded, fakeBrowser.permissions.onRemoved].map((e) => {
      const listen = vi.fn();
      Object.defineProperty(e, 'addListener', { value: listen, configurable: true });
      return listen;
    });
    const { default: background } = await import('./index');
    background.main();
    expect(onCommand).toHaveBeenCalledTimes(1);
    for (const listen of permissionEvents) expect(listen).toHaveBeenCalledTimes(1);
    const routes = Object.keys(harness().bg.routes);
    expect([...registered].sort()).toEqual(routes.sort());
    expect(registered).toHaveLength(new Set(registered).size);
    expect(registered).not.toContain('runtimeStateChanged');
  });
});
