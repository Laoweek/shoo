// Render helpers for page tests (no @testing-library): mount into a container, settle promises, find
// elements by text, and click or type the way a user does.
import { render, type ComponentChild } from 'preact';
import { act } from 'preact/test-utils';
import type { RuntimeSnapshot } from '~/core/types';

let hosts: HTMLElement[] = [];

export function mount(vnode: ComponentChild): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  act(() => render(vnode, host));
  return host;
}

export function unmountAll(): void {
  for (const h of hosts) {
    act(() => render(null, h));
    h.remove();
  }
  hosts = [];
}

/** Lets pending promises and the renders they cause settle. */
export async function settle(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

export const text = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The first button whose text or accessible name contains `label`. */
export function button(root: Element, label: string): HTMLButtonElement {
  const all = [...root.querySelectorAll('button')] as HTMLButtonElement[];
  const found = all.find((b) => text(b).includes(label) || (b.getAttribute('aria-label') ?? '').includes(label));
  if (!found) throw new Error(`No button "${label}" in: ${all.map((b) => text(b) || b.getAttribute('aria-label')).join(' | ')}`);
  return found;
}

export const hasButton = (root: Element, label: string): boolean => {
  try {
    button(root, label);
    return true;
  } catch {
    return false;
  }
};

/** The radio input whose label text starts with `label`. */
export function radio(root: Element, label: string): HTMLInputElement {
  const all = [...root.querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
  const found = all.find((r) => text(r.closest('label') ?? r).startsWith(label));
  if (!found) throw new Error(`No radio "${label}" in: ${all.map((r) => text(r.closest('label') ?? r)).join(' | ')}`);
  return found;
}

export function click(el: Element): void {
  act(() => (el as HTMLElement).click());
}

export function type(input: HTMLInputElement, value: string): void {
  act(() => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

export function key(el: Element, k: string): void {
  act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })));
}

export function snapshot(over: Partial<RuntimeSnapshot> = {}): RuntimeSnapshot {
  return {
    enabled: true,
    mode: 'review',
    reason: 'ok',
    stages: { exact: true, model: true, nativeActions: true, ui: true },
    eye: 'watching',
    settingsGeneration: 1,
    rulesVersion: 'v1',
    surfaces: { home: true, watchSidebar: true, shortsShelf: true, search: false, channel: false, endScreen: false },
    ...over,
  };
}
