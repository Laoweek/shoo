// @vitest-environment jsdom
// A page script that defines Shoo's host tag first. Its own file: a custom element definition lasts for the document.
import '~/ui/test/catalogue';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { removeOverlay } from '~/ui/in-page';
import { CHIP_HOST_TAG } from './mount';
import { collectUnhandled, setupHome, type Env } from './testing';

let env: Env | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
});
afterEach(() => {
  env?.p.dispose();
  act(() => removeOverlay());
  vi.useRealTimers();
  document.body.innerHTML = '';
});

it('a page that makes attachShadow throw on Shoo\'s host tag cannot keep an Auto Removal out of Activity', async () => {
  customElements.define(CHIP_HOST_TAG, class extends HTMLElement {
    static disabledFeatures = ['shadow'];
  });
  const e = (env = setupHome({ mode: 'auto' }));
  e.bg.outcomes.set('FIXTURE0006', { ruleId: 'r1' });
  const unhandled = await collectUnhandled(async () => {
    await e.showAll();
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(e.sim.log).toContain('placeholder@FIXTURE0006');
  expect(e.bg.of('reportActionResult')).toEqual([expect.objectContaining({ ok: true, videoId: 'FIXTURE0006' })]);
  expect(unhandled).toHaveLength(1);
});
