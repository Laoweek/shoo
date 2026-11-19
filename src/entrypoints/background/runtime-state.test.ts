import { beforeEach, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { harness } from './testing';

beforeEach(() => fakeBrowser.reset());

it('repaints a Site tab icon only when its eye changed or the tab moved to another page', async () => {
  const h = harness({ tabs: [{ id: 1, url: 'https://www.youtube.com/' }, { id: 2, url: 'https://www.youtube.com/' }] });
  const setIcon = vi.mocked(h.platform.action.setIcon);
  const paintsOf = (tabId: number) => setIcon.mock.calls.filter(([d]) => d.tabId === tabId).length;
  const state = h.bg.services.state;
  await h.connect(); // consent and a key: no reason outranks the review eye
  setIcon.mockClear();

  h.tabs.set(2, { id: 2, url: 'https://www.youtube.com/feed/subscriptions' });
  await state.refresh();
  expect(paintsOf(2)).toBe(1);
  await state.refresh();
  expect(paintsOf(2)).toBe(1);

  // A navigation drops the tab-specific icon, so the new address is painted again.
  h.tabs.set(2, { id: 2, url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' });
  await state.refresh();
  expect(paintsOf(2)).toBe(2);

  await state.setReviewPending(2, 3);
  expect(paintsOf(2)).toBe(3);
  expect(setIcon).toHaveBeenLastCalledWith({ tabId: 2, path: expect.objectContaining({ 16: '/icon/review-16.png' }) });
  expect(paintsOf(1)).toBe(0);
});
