// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SurfaceId } from '~/core/types';
import { TIMING, createActionQueue, isDropdownOpen, type ActionJob, type NativeActionQueue, type QueueOptions } from './actions';
import { mountChipHost } from './mount';
import { SELECTOR_VERSION, SURFACES } from './surfaces';
import { FIXTURES, mountTile, parse, simulateYouTube, withLazyIcons, type WireOptions, type YouTubeSim } from './test-harness';

let q: NativeActionQueue;
let sim: YouTubeSim;
let hidden = false;

beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  sim = simulateYouTube();
});
afterEach(() => {
  q?.dispose();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

const MENUS: Record<SurfaceId, string> = {
  home: FIXTURES.homeMenu,
  watchSidebar: FIXTURES.watchMenu,
  shortsShelf: FIXTURES.shortsMenu,
  search: FIXTURES.searchMenu,
  channel: FIXTURES.channelMenu,
  endScreen: '',
};
const TILES: Partial<Record<SurfaceId, string>> = { home: FIXTURES.homeTile, watchSidebar: FIXTURES.watchTile, shortsShelf: FIXTURES.shortsTile };

/** A Tile with its own fake video ID, wired to the simulated menu. */
function tileFor(surface: SurfaceId, id: string, wire: Partial<WireOptions> = {}): ActionJob {
  const html = (TILES[surface] as string).replaceAll('FIXTUREvid1', id);
  const tileEl = mountTile(html, surface);
  sim.wire(tileEl, surface, { menuHtml: MENUS[surface], ...wire });
  return { tileEl, videoId: id, surface, nativeAction: 'notInterested' };
}
const queue = (over: Partial<QueueOptions> = {}) => (q = createActionQueue({ doc: document, ...over }));
const placeholderIn = (job: ActionJob) => SURFACES[job.surface].actionRoot(job.tileEl)?.querySelector('.ytDismissibleItemReplacedContent') ?? null;
const outside = () => {
  const b = document.createElement('button');
  b.id = 'outside';
  document.body.append(b);
  return b;
};

describe('NativeActionQueue: happy paths', () => {
  it('Not interested on Home: opens the menu, clicks by icon, confirms the placeholder, restores focus', async () => {
    const job = tileFor('home', 'HOMEvideo01');
    const keep = outside();
    keep.focus();
    const onDropdownCheck = vi.fn();
    const p = queue({ onDropdownCheck }).enqueue(job);
    await vi.advanceTimersByTimeAsync(500);
    expect(await p).toEqual({ status: 'ok', job });
    expect(sim.log).toEqual(['open@HOMEvideo01', 'click:Not interested@HOMEvideo01', 'placeholder@HOMEvideo01']);
    expect(placeholderIn(job)).not.toBeNull();
    expect(document.activeElement).toBe(keep);
    expect(onDropdownCheck).toHaveBeenCalledWith(true);
  });

  it("Don't recommend channel on the Watch sidebar", async () => {
    const job = { ...tileFor('watchSidebar', 'WATCHvideo1'), nativeAction: 'dontRecommendChannel' as const };
    const p = queue().enqueue(job);
    await vi.advanceTimersByTimeAsync(500);
    expect((await p).status).toBe('ok');
    expect(sim.log).toContain("click:Don't recommend channel@WATCHvideo1");
  });

  it("downgrades Don't recommend channel to Not interested on the Shorts shelf", async () => {
    const job = { ...tileFor('shortsShelf', 'SHORTvideo1'), nativeAction: 'dontRecommendChannel' as const };
    const p = queue().enqueue(job);
    await vi.advanceTimersByTimeAsync(500);
    const out = await p;
    expect(out.status).toBe('ok');
    expect(out.job.nativeAction).toBe('notInterested');
    expect(sim.log).toContain('click:Not interested@SHORTvideo1');
  });

  it('waits for lazily rendered icons (about 1 s) and still matches by icon', async () => {
    const job = tileFor('home', 'HOMEvideo01', { iconDelayMs: 1000 });
    const p = queue().enqueue(job);
    await vi.advanceTimersByTimeAsync(900);
    expect(sim.log).toEqual(['open@HOMEvideo01']);
    await vi.advanceTimersByTimeAsync(400);
    expect((await p).status).toBe('ok');
  });

  it('falls back to the localized label after 3 s without icons', async () => {
    const job = tileFor('home', 'HOMEvideo01', { iconDelayMs: 60_000 });
    const p = queue().enqueue(job);
    await vi.advanceTimersByTimeAsync(TIMING.iconWaitMs - 100);
    expect(sim.log).toEqual(['open@HOMEvideo01']);
    await vi.advanceTimersByTimeAsync(500);
    expect((await p).status).toBe('ok');
    expect(sim.log).toContain('click:Not interested@HOMEvideo01');
  });
});

describe('NativeActionQueue: failures name the step and selector version', () => {
  it('missing item (Channel-style menu): fails at findItem, presses Escape on its own dropdown, restores focus', async () => {
    const job = tileFor('home', 'HOMEvideo01');
    sim.wire(job.tileEl, 'home', { menuHtml: FIXTURES.channelMenu }); // the second listener re-renders the Channel menu
    const keep = outside();
    keep.focus();
    const p = queue().enqueue(job);
    await vi.advanceTimersByTimeAsync(TIMING.iconWaitMs + 500);
    expect(await p).toEqual({ status: 'failed', job, step: 'findItem', selectorVersion: SELECTOR_VERSION });
    expect(sim.log.at(-1)).toBe('escape');
    expect(sim.dropdown()?.getAttribute('aria-hidden')).toBe('true');
    expect(document.activeElement).toBe(keep);
    expect(placeholderIn(job)).toBeNull(); // the Tile stays visible
  });

  it('dropdown never opens: fails at openMenu after 1.5 s and the markup check reports it', async () => {
    const job = tileFor('home', 'HOMEvideo01', { neverOpen: true });
    const onDropdownCheck = vi.fn();
    const p = queue({ onDropdownCheck }).enqueue(job);
    await vi.advanceTimersByTimeAsync(TIMING.dropdownMs - 50);
    expect(onDropdownCheck).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(await p).toMatchObject({ status: 'failed', step: 'openMenu' });
    expect(onDropdownCheck).toHaveBeenCalledWith(false);
    expect(sim.log).not.toContain('escape'); // nothing of Shoo's is open
  });

  it('no menu button: fails at openMenu without clicking anything', async () => {
    const job = tileFor('home', 'HOMEvideo01');
    SURFACES.home.menuButton(job.tileEl)?.remove();
    const p = queue().enqueue(job);
    await vi.advanceTimersByTimeAsync(100);
    expect(await p).toMatchObject({ status: 'failed', step: 'openMenu' });
    expect(sim.log).toEqual([]);
  });

  it('item without a menuitem target: fails at clickItem', async () => {
    const job = tileFor('home', 'HOMEvideo01', { menuHtml: FIXTURES.homeMenu.replaceAll('role="menuitem"', '') });
    const p = queue().enqueue(job);
    await vi.advanceTimersByTimeAsync(500);
    expect(await p).toMatchObject({ status: 'failed', step: 'clickItem' });
    expect(sim.log.at(-1)).toBe('escape');
  });

  it('no placeholder: fails at confirmPlaceholder after 2 s', async () => {
    const job = tileFor('home', 'HOMEvideo01', { noPlaceholder: true });
    const p = queue().enqueue(job);
    await vi.advanceTimersByTimeAsync(TIMING.confirmMs);
    expect(sim.log).toContain('click:Not interested@HOMEvideo01');
    await vi.advanceTimersByTimeAsync(200);
    expect(await p).toMatchObject({ status: 'failed', step: 'confirmPlaceholder' });
  });
});

describe('NativeActionQueue: dropdown evidence (hidden tabs)', () => {
  const dropdownWith = (attrs: { ariaHidden?: string; display?: string; items?: boolean }) => {
    const d = document.createElement('tp-yt-iron-dropdown');
    if (attrs.ariaHidden !== undefined) d.setAttribute('aria-hidden', attrs.ariaHidden);
    if (attrs.display) d.style.display = attrs.display;
    if (attrs.items !== false) d.innerHTML = FIXTURES.homeMenu;
    document.body.append(d);
    return d;
  };

  it('isDropdownOpen needs positive evidence: not aria-hidden, displayed, and holding menu items', () => {
    expect(isDropdownOpen(dropdownWith({}))).toBe(true);
    expect(isDropdownOpen(dropdownWith({ ariaHidden: 'false' }))).toBe(true);
    expect(isDropdownOpen(dropdownWith({ ariaHidden: 'true' }))).toBe(false);
    expect(isDropdownOpen(dropdownWith({ display: 'none' }))).toBe(false); // toggled in a hidden tab, not drawn yet
    expect(isDropdownOpen(dropdownWith({ items: false }))).toBe(false);
  });

  it('an undrawn dropdown left without aria-hidden is not taken for a user menu: the next job runs', async () => {
    sim.openAsUser(FIXTURES.homeMenu);
    sim.close();
    const d = sim.dropdown() as HTMLElement;
    d.removeAttribute('aria-hidden'); // what YouTube left in the hidden tab: toggled, still display:none
    d.style.display = 'none';
    const job = tileFor('home', 'HOMEvideo01');
    sim.wire(job.tileEl, 'home', { menuHtml: FIXTURES.homeMenu }); // YouTube draws it on the next open
    job.tileEl.querySelector('.ytLockupMetadataViewModelMenuButton button')?.addEventListener('click', () => setTimeout(() => (d.style.display = ''), 20));
    const p = queue().enqueue(job);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await p).status).toBe('ok');
  });

  it('never reports a dropdown markup failure while the tab is hidden, and checks again on a later job', async () => {
    const onDropdownCheck = vi.fn();
    const job = tileFor('home', 'HOMEvideo01', { neverOpen: true });
    const p = queue({ onDropdownCheck }).enqueue(job);
    await vi.advanceTimersByTimeAsync(10); // the menu button was clicked
    hidden = true; // the user switched tabs: no frames, the dropdown never draws
    await vi.advanceTimersByTimeAsync(TIMING.dropdownMs + 100);
    expect(await p).toEqual({ status: 'stale', job }); // not a failure: tab switches never count toward the breaker
    expect(onDropdownCheck).not.toHaveBeenCalled();
    hidden = false;
    const next = tileFor('home', 'HOMEvideo02');
    const p2 = q.enqueue(next);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await p2).status).toBe('ok');
    expect(onDropdownCheck).toHaveBeenCalledWith(true);
  });
});

describe('NativeActionQueue: a tab hidden mid-job is stale, not failed', () => {
  it('items that never render because the tab was hidden for a moment: stale, Escape on its own dropdown, focus restored', async () => {
    const job = tileFor('home', 'HOMEvideo01', { menuHtml: FIXTURES.channelMenu }); // no matching item ever renders
    const keep = outside();
    keep.focus();
    const onDropdownCheck = vi.fn();
    const p = queue({ onDropdownCheck }).enqueue(job);
    await vi.advanceTimersByTimeAsync(200); // the menu is open, the item poll runs
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(500);
    hidden = false; // visible again before the step times out: the job still went hidden
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(TIMING.iconWaitMs + 500);
    expect(await p).toEqual({ status: 'stale', job });
    expect(sim.log.at(-1)).toBe('escape');
    expect(sim.dropdown()?.getAttribute('aria-hidden')).toBe('true');
    expect(document.activeElement).toBe(keep);
    expect(onDropdownCheck).toHaveBeenCalledWith(true); // the dropdown did open
  });

  it('the same timeout in a tab that stayed visible is still a failure', async () => {
    const job = tileFor('home', 'HOMEvideo01', { neverOpen: true });
    const p = queue().enqueue(job);
    await vi.advanceTimersByTimeAsync(TIMING.dropdownMs + 100);
    expect(await p).toMatchObject({ status: 'failed', step: 'openMenu' });
  });
});

describe('NativeActionQueue: reused dropdown and serialization', () => {
  it('ignores the previous Tile\'s items while the reused dropdown is stale', async () => {
    const a = tileFor('home', 'HOMEvideo01');
    const b = tileFor('home', 'HOMEvideo02', { staleMs: 400 });
    queue();
    const pa = q.enqueue(a);
    const pb = q.enqueue(b);
    await vi.advanceTimersByTimeAsync(3000);
    expect((await pa).status).toBe('ok');
    expect((await pb).status).toBe('ok');
    expect(sim.log.filter((l) => l.startsWith('click:'))).toEqual(['click:Not interested@HOMEvideo01', 'click:Not interested@HOMEvideo02']);
  });

  // Observed in Chrome on 2026-10-10: YouTube re-renders the reused dropdown's items in place, and the menu of a Tile
  // outside the viewport is clamped to the viewport edge, so consecutive menus keep their position and item elements.
  function reusedMenu(rerender: 'content' | 'attributes') {
    const popup = document.createElement('ytd-popup-container');
    const d = document.createElement('tp-yt-iron-dropdown');
    d.setAttribute('aria-hidden', 'true');
    d.setAttribute('style', 'top: 733px; left: 1222px;');
    d.innerHTML = parse(FIXTURES.watchMenu).innerHTML;
    popup.append(d);
    document.body.append(popup);
    let current: ActionJob | null = null;
    const log: string[] = [];
    d.addEventListener('click', (ev) => {
      if (!(ev.target as Element).closest('[role="menuitem"]') || !current) return;
      log.push(`click@${current.videoId}`);
      d.setAttribute('aria-hidden', 'true');
      const root = current.tileEl;
      setTimeout(() => root.replaceChildren(...parse(FIXTURES.watchPlaceholder).childNodes), 15);
    });
    d.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return;
      log.push('escape');
      d.setAttribute('aria-hidden', 'true');
    });
    const job = (id: string): ActionJob => {
      const tileEl = mountTile(FIXTURES.watchTile.replaceAll('FIXTUREvid1', id), 'watchSidebar');
      const j: ActionJob = { tileEl, videoId: id, surface: 'watchSidebar', nativeAction: 'notInterested' };
      SURFACES.watchSidebar.menuButton(tileEl)?.addEventListener('click', () =>
        setTimeout(() => {
          current = j;
          const title = d.querySelector('.ytListItemViewModelTitle');
          if (rerender === 'content' && title) title.replaceChildren(title.textContent ?? ''); // the in-place re-render
          d.querySelector('yt-sheet-view-model')?.setAttribute('tabindex', '-1'); // focus state, on any opening
          d.removeAttribute('aria-hidden');
          d.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
        }, 30),
      );
      return j;
    };
    return { d, log, job };
  }

  it('recognises a menu that reopens at the same place with the same item elements (Tiles below the fold)', async () => {
    const menu = reusedMenu('content');
    const a = menu.job('WATCHvideo1');
    const b = menu.job('WATCHvideo2');
    queue();
    const pa = q.enqueue(a);
    const pb = q.enqueue(b);
    await vi.advanceTimersByTimeAsync(3000);
    expect((await pa).status).toBe('ok');
    expect((await pb).status).toBe('ok');
    expect(menu.log).toEqual(['click@WATCHvideo1', 'click@WATCHvideo2']);
    expect(menu.d.getAttribute('aria-hidden')).toBe('true');
  });

  it('never acts on a reopened menu whose content did not change, and closes it instead of leaving it open', async () => {
    const menu = reusedMenu('attributes');
    const p = queue().enqueue(menu.job('WATCHvideo1'));
    await vi.advanceTimersByTimeAsync(TIMING.dropdownMs + 500);
    expect(await p).toMatchObject({ status: 'failed', step: 'openMenu' });
    expect(menu.log).toEqual(['escape']);
    expect(menu.d.getAttribute('aria-hidden')).toBe('true');
  });

  it('runs one job at a time, at least 350 ms apart', async () => {
    const jobs = [tileFor('home', 'HOMEvideo01'), tileFor('home', 'HOMEvideo02'), tileFor('watchSidebar', 'WATCHvideo1')];
    queue();
    const times: Record<string, number> = {};
    const t0 = Date.now();
    const opens: number[] = [];
    for (const j of jobs) SURFACES[j.surface].menuButton(j.tileEl)?.addEventListener('click', () => opens.push(Date.now() - t0));
    const done = jobs.map((j) => q.enqueue(j).then((o) => ((times[j.videoId] = Date.now() - t0), o)));
    await vi.advanceTimersByTimeAsync(5000);
    expect((await Promise.all(done)).map((o) => o.status)).toEqual(['ok', 'ok', 'ok']);
    const order = sim.log.filter((l) => l.startsWith('open@') || l.startsWith('placeholder@'));
    expect(order).toEqual([
      'open@HOMEvideo01', 'placeholder@HOMEvideo01',
      'open@HOMEvideo02', 'placeholder@HOMEvideo02',
      'open@WATCHvideo1', 'placeholder@WATCHvideo1',
    ]);
    expect(opens[1]! - times.HOMEvideo01!).toBeGreaterThanOrEqual(TIMING.gapMs);
    expect(opens[2]! - times.HOMEvideo02!).toBeGreaterThanOrEqual(TIMING.gapMs);
  });

  it('acts once per videoId per page: a second copy is a duplicate', async () => {
    const a = tileFor('home', 'HOMEvideo01');
    const copy = tileFor('home', 'HOMEvideo01');
    queue();
    const pa = q.enqueue(a);
    const pc = q.enqueue(copy);
    expect(await pc).toEqual({ status: 'duplicate', job: copy });
    await vi.advanceTimersByTimeAsync(500);
    expect((await pa).status).toBe('ok');
    expect(sim.log.filter((l) => l.startsWith('open@'))).toHaveLength(1);
  });
});

describe('NativeActionQueue: focus safety', () => {
  it('waits while the user has a YouTube menu open, and never presses Escape on it', async () => {
    const job = tileFor('home', 'HOMEvideo01');
    sim.openAsUser(FIXTURES.homeMenu);
    const p = queue().enqueue(job);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sim.log).toEqual(['open@user']);
    sim.close();
    await vi.advanceTimersByTimeAsync(TIMING.focusPollMs + 500);
    expect((await p).status).toBe('ok');
    expect(sim.log).not.toContain('escape');
  });

  it('never presses Escape on, or pulls focus from, a menu the user opens while Shoo waits for the placeholder', async () => {
    const job = tileFor('home', 'HOMEvideo01', { noPlaceholder: true });
    const keep = outside();
    keep.focus();
    const p = queue().enqueue(job);
    await vi.advanceTimersByTimeAsync(300); // Shoo clicked the item, YouTube closed the reused dropdown
    expect(sim.log).toContain('click:Not interested@HOMEvideo01');
    const userMenu = sim.openAsUser(FIXTURES.homeMenu); // the same dropdown element, reopened by the user
    const userFocus = document.activeElement;
    await vi.advanceTimersByTimeAsync(TIMING.confirmMs);
    expect(await p).toMatchObject({ status: 'failed', step: 'confirmPlaceholder' });
    expect(sim.log).not.toContain('escape');
    expect(userMenu.getAttribute('aria-hidden')).toBeNull();
    expect(document.activeElement).toBe(userFocus);
  });

  it('drops the job as stale, clicking nothing, when the user opens another menu during the icon poll', async () => {
    const job = tileFor('home', 'HOMEvideo01', { iconDelayMs: 2000 });
    const p = queue().enqueue(job);
    await vi.advanceTimersByTimeAsync(300); // Shoo's menu is open, icons not rendered yet
    const userMenu = sim.openAsUser(FIXTURES.homeMenu); // same reused element, new items and position
    await vi.advanceTimersByTimeAsync(TIMING.iconWaitMs + 500);
    expect(await p).toEqual({ status: 'stale', job });
    expect(sim.log.filter((l) => l.startsWith('click:'))).toEqual([]);
    expect(sim.log).not.toContain('escape');
    expect(userMenu.getAttribute('aria-hidden')).toBeNull();
  });

  it('treats a reopening of the reused dropdown after a job as the user\'s menu', async () => {
    const a = tileFor('home', 'HOMEvideo01');
    const b = tileFor('home', 'HOMEvideo02');
    queue();
    const pa = q.enqueue(a);
    await vi.advanceTimersByTimeAsync(500);
    expect((await pa).status).toBe('ok');
    sim.reopenAsUser(); // same item elements, same position
    const pb = q.enqueue(b);
    await vi.advanceTimersByTimeAsync(3000);
    expect(sim.log).not.toContain('open@HOMEvideo02');
    expect(sim.log).not.toContain('escape');
    sim.close();
    await vi.advanceTimersByTimeAsync(TIMING.focusPollMs + 500);
    expect((await pb).status).toBe('ok');
  });

  it('step 2 presses Escape on Shoo\'s own leftover dropdown before the next job', async () => {
    const a = tileFor('home', 'HOMEvideo01', { menuHtml: FIXTURES.channelMenu }); // no item: fails at findItem
    const b = tileFor('home', 'HOMEvideo02');
    sim.ignoreEscapes = 1; // the failure's Escape does not close it
    queue();
    const pa = q.enqueue(a);
    const pb = q.enqueue(b);
    await vi.advanceTimersByTimeAsync(TIMING.iconWaitMs + 2000);
    expect((await pa)).toMatchObject({ status: 'failed', step: 'findItem' });
    expect((await pb).status).toBe('ok');
    const i = sim.log.indexOf('escape(ignored)');
    expect(sim.log.slice(i, i + 3)).toEqual(['escape(ignored)', 'escape', 'open@HOMEvideo02']);
  });

  it('re-checks after the Escape wait: a job cancelled in those 50 ms opens no menu', async () => {
    const a = tileFor('home', 'HOMEvideo01', { menuHtml: FIXTURES.channelMenu }); // no item: fails at findItem
    const b = tileFor('home', 'HOMEvideo02');
    sim.ignoreEscapes = 1;
    queue();
    const pa = q.enqueue(a);
    const pb = q.enqueue(b);
    for (let i = 0; i < 1000 && !sim.log.includes('escape'); i++) await vi.advanceTimersByTimeAsync(10);
    expect(sim.log.at(-1)).toBe('escape'); // step 2 closed Shoo's leftover dropdown, the 50 ms settle runs
    q.cancelAll(); // Mode left Auto during the 50 ms settle
    await vi.advanceTimersByTimeAsync(1000);
    expect((await pa).status).toBe('failed');
    expect((await pb).status).toBe('cancelled');
    expect(sim.log).not.toContain('open@HOMEvideo02');
  });

  it('waits while focus is inside an iframe (live chat)', async () => {
    const job = tileFor('watchSidebar', 'WATCHvideo1');
    const frame = document.createElement('iframe');
    document.body.append(frame);
    frame.focus();
    expect(document.activeElement).toBe(frame);
    const p = queue().enqueue(job);
    await vi.advanceTimersByTimeAsync(2000);
    expect(sim.log).toEqual([]);
    frame.remove();
    await vi.advanceTimersByTimeAsync(TIMING.focusPollMs + 500);
    expect((await p).status).toBe('ok');
  });

  it('blurs when the element focused before the job is gone', async () => {
    const job = tileFor('home', 'HOMEvideo01');
    const keep = outside();
    keep.focus();
    SURFACES.home.menuButton(job.tileEl)?.addEventListener('click', () => keep.remove());
    const p = queue().enqueue(job);
    await vi.advanceTimersByTimeAsync(500);
    expect((await p).status).toBe('ok');
    expect(document.activeElement).toBe(document.body);
  });

  it('waits while focus is in an input, then restores it there', async () => {
    const job = tileFor('home', 'HOMEvideo01');
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    const p = queue().enqueue(job);
    await vi.advanceTimersByTimeAsync(5000);
    expect(sim.log).toEqual([]);
    input.blur();
    await vi.advanceTimersByTimeAsync(TIMING.focusPollMs + 500);
    expect((await p).status).toBe('ok');
  });

  it('waits while focus is inside the target Tile or one of Shoo\'s chips', async () => {
    const job = tileFor('home', 'HOMEvideo01');
    const title = SURFACES.home.focusReturn(job.tileEl) as HTMLElement;
    title.focus();
    const p = queue().enqueue(job);
    await vi.advanceTimersByTimeAsync(2000);
    expect(sim.log).toEqual([]);
    const chip = document.createElement('shoo-chip-host');
    chip.tabIndex = 0;
    document.body.append(chip);
    chip.focus();
    await vi.advanceTimersByTimeAsync(2000);
    expect(sim.log).toEqual([]);
    chip.blur();
    await vi.advanceTimersByTimeAsync(TIMING.focusPollMs + 500);
    expect((await p).status).toBe('ok');
  });

  it("a Review Remove does not wait for focus on its own chip, and hands focus over when YouTube destroys the chip", async () => {
    const job: ActionJob = { ...tileFor('home', 'HOMEvideo01'), origin: 'review' };
    const chip = mountChipHost(job.tileEl, 'home', { forceOverlay: false });
    const remove = document.createElement('button');
    chip?.shadow.append(remove);
    remove.focus();
    expect(document.activeElement).toBe(chip?.host); // focus in a shadow root reports the host
    const onFocusLost = vi.fn();
    const p = queue({ onFocusLost }).enqueue(job);
    await vi.advanceTimersByTimeAsync(500);
    expect((await p).status).toBe('ok');
    expect(chip?.host.isConnected).toBe(false); // the placeholder swap destroyed it
    expect(onFocusLost).toHaveBeenCalledWith(job.tileEl);
  });

  it('a Review Remove still waits for focus on another Tile\'s chip; an Auto job waits for its own', async () => {
    const other = tileFor('home', 'HOMEvideo02');
    const otherChip = mountChipHost(other.tileEl, 'home', { forceOverlay: false });
    const button = document.createElement('button');
    otherChip?.shadow.append(button);
    button.focus();
    const review: ActionJob = { ...tileFor('home', 'HOMEvideo01'), origin: 'review' };
    const p = queue().enqueue(review);
    await vi.advanceTimersByTimeAsync(2000);
    expect(sim.log).toEqual([]);
    button.blur();
    await vi.advanceTimersByTimeAsync(TIMING.focusPollMs + 500);
    expect((await p).status).toBe('ok');

    const auto = tileFor('home', 'HOMEvideo03');
    const ownChip = mountChipHost(auto.tileEl, 'home', { forceOverlay: false });
    const own = document.createElement('button');
    ownChip?.shadow.append(own);
    own.focus();
    const pa = q.enqueue(auto);
    await vi.advanceTimersByTimeAsync(2000);
    expect(sim.log).not.toContain('open@HOMEvideo03');
    own.blur();
    await vi.advanceTimersByTimeAsync(TIMING.focusPollMs + 500);
    expect((await pa).status).toBe('ok');
  });

  it('a Review Remove from a chip in the page-level overlay names its host', async () => {
    const job = tileFor('home', 'HOMEvideo01');
    const chip = mountChipHost(job.tileEl, 'home', { forceOverlay: true });
    const remove = document.createElement('button');
    chip?.shadow.append(remove);
    remove.focus();
    const p = queue().enqueue({ ...job, origin: 'review', chipHost: chip?.host });
    await vi.advanceTimersByTimeAsync(500);
    expect((await p).status).toBe('ok');
    expect(document.activeElement).toBe(chip?.host); // the overlay host survives: focus goes back into it
    expect(chip?.shadow.activeElement).toBe(remove);
  });

  it('waits while the pointer is pressed', async () => {
    const job = tileFor('home', 'HOMEvideo01');
    queue();
    document.dispatchEvent(new Event('pointerdown'));
    const p = q.enqueue(job);
    await vi.advanceTimersByTimeAsync(2000);
    expect(sim.log).toEqual([]);
    document.dispatchEvent(new Event('pointerup'));
    await vi.advanceTimersByTimeAsync(TIMING.focusPollMs + 500);
    expect((await p).status).toBe('ok');
  });

  it('blurs instead when nothing was focused before the menu opened', async () => {
    const job = tileFor('home', 'HOMEvideo01');
    const p = queue().enqueue(job);
    await vi.advanceTimersByTimeAsync(500);
    expect((await p).status).toBe('ok');
    expect(document.activeElement).toBe(document.body);
  });
});

// Measured in Chrome on 2026-10-10 (Watch sidebar, Auto, Tiles one viewport below the fold): YouTube calls focus()
// without preventScroll twice around a Native action, and Chrome scrolls the element into view before the focus
// events fire. tp-yt-iron-dropdown's `_applyFocus` gives focus back on close to the element focused when the menu
// opened, and the "Video removed" placeholder's `_.W0` focuses its first button one animation frame after rendering.
describe("NativeActionQueue: YouTube's own focus calls never move the page", () => {
  let pos = { x: 0, y: 0 };
  const saved: Partial<Record<'scrollX' | 'scrollY', PropertyDescriptor>> = {};
  const cleanups: Array<() => void> = [];
  /** ResizeObserver stand-in: one notification after the frame's animation frame callbacks, before it paints. */
  class FrameEndObserver {
    private on = false;
    constructor(private readonly cb: () => void) {}
    observe() {
      this.on = true;
      setTimeout(() => this.on && this.cb(), 0);
    }
    unobserve() {}
    disconnect() {
      this.on = false;
    }
  }
  beforeEach(() => {
    pos = { x: 0, y: 0 };
    // Browsers have ResizeObserver, jsdom does not: the guard's frame-end check runs in every test here.
    Object.defineProperty(window, 'ResizeObserver', { configurable: true, writable: true, value: FrameEndObserver });
    for (const k of ['scrollX', 'scrollY'] as const) {
      saved[k] = Object.getOwnPropertyDescriptor(window, k);
      Object.defineProperty(window, k, { configurable: true, get: () => (k === 'scrollX' ? pos.x : pos.y) });
    }
    vi.spyOn(window, 'scrollTo').mockImplementation(((o: ScrollToOptions) => {
      pos = { x: o.left ?? pos.x, y: o.top ?? pos.y };
    }) as typeof window.scrollTo);
  });
  afterEach(() => {
    for (const c of cleanups.splice(0)) c();
    vi.restoreAllMocks();
    delete (window as unknown as Record<string, unknown>).ResizeObserver;
    for (const k of ['scrollX', 'scrollY'] as const) {
      const d = saved[k];
      if (d) Object.defineProperty(window, k, d);
      else delete (window as unknown as Record<string, unknown>)[k];
    }
  });

  let eventless = false;
  /**
   * Chrome's focus() without preventScroll: the page scrolls to the element, then the focus events fire. In a window
   * without system focus (`unfocusedWindow`) no focus event fires and the scroll event comes with the next frame.
   */
  const focusScrolling = (el: HTMLElement, y: number) => {
    const moved = y !== pos.y;
    pos = { ...pos, y };
    el.focus();
    if (eventless && moved) requestAnimationFrame(() => document.dispatchEvent(new Event('scroll')));
  };
  /**
   * A visible window without system focus (Chrome, measured 2026-10-10): focus() still scrolls and moves
   * document.activeElement, but no focus event fires. Returns the position each frame paints, sampled after the
   * frame's animation frame callbacks and ResizeObserver notifications.
   */
  function unfocusedWindow(): number[] {
    const swallow = (ev: Event) => ev.stopImmediatePropagation();
    const types = ['focus', 'blur', 'focusin', 'focusout'];
    for (const t of types) window.addEventListener(t, swallow, true);
    eventless = true;
    const painted: number[] = [];
    let on = true;
    const frame = () => {
      if (!on) return;
      setTimeout(() => setTimeout(() => painted.push(pos.y), 0), 0);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    cleanups.push(() => {
      on = false;
      eventless = false;
      for (const t of types) window.removeEventListener(t, swallow, true);
    });
    return painted;
  }
  /** The user's wheel: the page moves and its scroll event comes with the next frame. */
  const userWheel = (y: number) => {
    document.body.dispatchEvent(new WheelEvent('wheel', { deltaY: y - pos.y, bubbles: true }));
    pos = { ...pos, y };
    requestAnimationFrame(() => document.dispatchEvent(new Event('scroll')));
  };
  /** The user scrolls: the position changes and the document fires its scroll event. */
  const userScroll = (y: number) => {
    pos = { ...pos, y };
    document.dispatchEvent(new Event('scroll'));
  };
  /**
   * YouTube's placeholder focuses its first button a frame after it renders (kevlar `_.W0`). `'frame'`: from an
   * animation frame callback, as YouTube does (through the web-animations polyfill), registered after Shoo's.
   * `'task'`: from a task halfway between two frames.
   */
  function placeholderFocuses(job: ActionJob, y: number, afterMs: number | 'frame' | 'task' = 16): { count: number } {
    const seen = { count: 0 };
    const root = SURFACES[job.surface].actionRoot(job.tileEl) as Element;
    const mo = new MutationObserver(() => {
      const button = root.querySelector<HTMLElement>('.ytDismissibleItemReplacedContent button');
      if (!button || seen.count > 0) return;
      seen.count += 1;
      if (afterMs === 'frame') requestAnimationFrame(() => focusScrolling(button, y));
      else if (afterMs === 'task') requestAnimationFrame(() => setTimeout(() => focusScrolling(button, y), 8));
      else setTimeout(() => focusScrolling(button, y), afterMs);
    });
    mo.observe(root, { childList: true });
    cleanups.push(() => mo.disconnect());
    return seen;
  }
  /** tp-yt-iron-dropdown gives focus back on close to the element focused when the menu opened. */
  function dropdownRestoresFocusOnClose(y: number, inFrame = false): void {
    let opener: HTMLElement | null = null;
    const onClick = () => (opener ??= document.activeElement as HTMLElement);
    document.addEventListener('click', onClick, true);
    const d = sim.dropdown;
    const mo = new MutationObserver(() => {
      const open = d();
      if (!opener || open?.getAttribute('aria-hidden') !== 'true' || !open.contains(document.activeElement)) return;
      const back = opener;
      if (inFrame) requestAnimationFrame(() => focusScrolling(back, y)); // `__openedChanged` runs from an animation frame
      else focusScrolling(back, y);
    });
    mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-hidden'] });
    cleanups.push(() => {
      mo.disconnect();
      document.removeEventListener('click', onClick, true);
    });
  }

  it('the placeholder focusing itself for a Tile below the fold: the page stays and focus goes back', async () => {
    const job = tileFor('watchSidebar', 'WATCHvideo1');
    const keep = outside();
    keep.focus();
    const yt = placeholderFocuses(job, 635);
    const p = queue().enqueue(job);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await p).status).toBe('ok');
    expect(yt.count).toBe(1);
    expect(window.scrollY).toBe(0);
    expect(document.activeElement).toBe(keep);
  });

  it('the dropdown giving focus back on close to an element outside the viewport: the page stays', async () => {
    const job = tileFor('home', 'HOMEvideo01');
    const keep = outside(); // say the player, scrolled out of view above
    keep.focus();
    userScroll(1400);
    dropdownRestoresFocusOnClose(0);
    const p = queue().enqueue(job);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await p).status).toBe('ok');
    expect(window.scrollY).toBe(1400);
    expect(document.activeElement).toBe(keep);
  });

  it("the user's own scrolling wins: the page stays where the user scrolled to", async () => {
    const job = tileFor('watchSidebar', 'WATCHvideo1');
    placeholderFocuses(job, 635);
    const p = queue().enqueue(job);
    await vi.advanceTimersByTimeAsync(40); // the menu is open
    userScroll(300);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await p).status).toBe('ok');
    expect(window.scrollY).toBe(300);
    expect(document.activeElement).toBe(document.body);
  });

  it('a late placeholder focus gives focus back to what had it, such as the annotation Shoo focused after the job', async () => {
    const job = tileFor('watchSidebar', 'WATCHvideo1');
    const yt = placeholderFocuses(job, 635, 150); // a late frame, after the job ended
    let annotation: HTMLElement | null = null;
    const p = queue().enqueue(job);
    void p.then(() => {
      annotation = outside();
      annotation.focus({ preventScroll: true });
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect((await p).status).toBe('ok');
    expect(yt.count).toBe(1);
    expect(window.scrollY).toBe(0);
    expect(document.activeElement).toBe(annotation);
  });

  it(`ends ${TIMING.guardFrames} frames after the job: a later focus scroll is not Shoo's to undo`, async () => {
    const job = tileFor('watchSidebar', 'WATCHvideo1');
    const p = queue().enqueue(job);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await p).status).toBe('ok');
    focusScrolling(placeholderIn(job)?.querySelector('button') as HTMLElement, 635);
    await vi.advanceTimersByTimeAsync(50);
    expect(window.scrollY).toBe(635);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it.each(['pointer', 'Tab'])('focus the user moves into the placeholder right after the job (%s) stays there', async (how) => {
    const job = tileFor('watchSidebar', 'WATCHvideo1');
    const p = queue().enqueue(job);
    await vi.advanceTimersByTimeAsync(110); // the job ends at the 100 ms placeholder poll, the guard is still on
    expect((await p).status).toBe('ok');
    const undo = placeholderIn(job)?.querySelector('button') as HTMLElement;
    if (how === 'pointer') document.dispatchEvent(new Event('pointerdown'));
    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    focusScrolling(undo, 120); // the browser brings the element the user moved to into view
    document.dispatchEvent(new Event('pointerup'));
    await vi.advanceTimersByTimeAsync(100);
    expect(document.activeElement).toBe(undo);
    expect(window.scrollY).toBe(120);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('a press or key earlier in the job does not switch the guard off: YouTube focusing later still moves nothing', async () => {
    const job = tileFor('watchSidebar', 'WATCHvideo1', { iconDelayMs: 300 });
    const keep = outside();
    keep.focus();
    userScroll(1400);
    dropdownRestoresFocusOnClose(0);
    placeholderFocuses(job, 635);
    const p = queue().enqueue(job);
    await vi.advanceTimersByTimeAsync(100); // the menu is open, its icons not rendered yet
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    await vi.advanceTimersByTimeAsync(1000);
    expect((await p).status).toBe('ok');
    expect(window.scrollY).toBe(1400);
    expect(document.activeElement).toBe(keep);
  });

  it("leaves other focus moves alone: an earlier Removal's placeholder, or an element neither YouTube's menu nor Shoo touched", async () => {
    const earlier = tileFor('watchSidebar', 'WATCHvideo2');
    earlier.tileEl.replaceChildren(...parse(FIXTURES.watchPlaceholder).childNodes);
    const job = tileFor('watchSidebar', 'WATCHvideo1', { iconDelayMs: 300 });
    const elsewhere = outside();
    const p = queue().enqueue(job);
    await vi.advanceTimersByTimeAsync(100);
    focusScrolling(elsewhere, 900); // say a screen reader moved focus
    await vi.advanceTimersByTimeAsync(10);
    expect(window.scrollY).toBe(900);
    focusScrolling(placeholderIn(earlier)?.querySelector('button') as HTMLElement, 1200);
    await vi.advanceTimersByTimeAsync(10);
    expect(window.scrollY).toBe(1200);
    expect(window.scrollTo).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect((await p).status).toBe('ok');
  });

  it('navigation ends the guard', async () => {
    const job = tileFor('watchSidebar', 'WATCHvideo1');
    const p = queue().enqueue(job);
    await vi.advanceTimersByTimeAsync(110);
    expect((await p).status).toBe('ok');
    document.dispatchEvent(new Event('yt-navigate-start'));
    focusScrolling(placeholderIn(job)?.querySelector('button') as HTMLElement, 635);
    await vi.advanceTimersByTimeAsync(10);
    expect(window.scrollY).toBe(635);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  // Live 2026-10-10: in a visible window without system focus the page jumped to centre the placeholder's Undo, and
  // no focus event fired.
  describe('in a window without system focus (no focus events)', () => {
    it('the placeholder focusing itself from an animation frame: no frame paints the page moved, and focus goes back', async () => {
      const painted = unfocusedWindow();
      const job = tileFor('watchSidebar', 'WATCHvideo1');
      const keep = outside();
      keep.focus();
      const yt = placeholderFocuses(job, 635, 'frame');
      const p = queue().enqueue(job);
      await vi.advanceTimersByTimeAsync(1000);
      expect((await p).status).toBe('ok');
      expect(yt.count).toBe(1);
      expect(window.scrollY).toBe(0);
      expect(painted).not.toContain(635);
      expect(document.activeElement).toBe(keep);
    });

    it('the dropdown giving focus back on close to an element outside the viewport: no frame paints the page moved', async () => {
      const painted = unfocusedWindow();
      const job = tileFor('home', 'HOMEvideo01');
      const keep = outside(); // say the player, scrolled out of view above
      keep.focus();
      userScroll(1400);
      dropdownRestoresFocusOnClose(0, true);
      const p = queue().enqueue(job);
      await vi.advanceTimersByTimeAsync(1000);
      expect((await p).status).toBe('ok');
      expect(window.scrollY).toBe(1400);
      expect(new Set(painted)).toEqual(new Set([1400]));
      expect(document.activeElement).toBe(keep);
    });

    it('a focus move from a task is judged at the next scroll event, before that position counts as the page\'s', async () => {
      const painted = unfocusedWindow();
      const job = tileFor('watchSidebar', 'WATCHvideo1');
      const keep = outside();
      keep.focus();
      placeholderFocuses(job, 635, 'task');
      const p = queue().enqueue(job);
      await vi.advanceTimersByTimeAsync(1000);
      expect((await p).status).toBe('ok');
      expect(window.scrollY).toBe(0);
      expect(painted).not.toContain(635);
      expect(document.activeElement).toBe(keep);
    });

    it('a focus move made right before the job ends is judged before Shoo moves focus (no frame in between)', async () => {
      unfocusedWindow();
      const job = tileFor('home', 'HOMEvideo01', { iconDelayMs: 300 });
      const keep = outside();
      keep.focus();
      userScroll(1400);
      dropdownRestoresFocusOnClose(0);
      const p = queue().enqueue(job);
      await vi.advanceTimersByTimeAsync(100); // the menu is open, its icons not rendered yet
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0); // then frames stall, say a hidden tab
      await vi.advanceTimersByTimeAsync(1000);
      expect((await p).status).toBe('ok');
      expect(window.scrollY).toBe(1400);
      expect(document.activeElement).toBe(keep);
    });

    it("Shoo's own focus return is not taken for YouTube's: a scroll anchoring shift in the next frame stays", async () => {
      unfocusedWindow();
      const job = tileFor('watchSidebar', 'WATCHvideo1');
      const keep = outside();
      keep.focus();
      const p = queue().enqueue(job);
      // Content above the viewport changes height and Chrome's scroll anchoring moves the page in that frame's layout.
      void p.then(() =>
        requestAnimationFrame(() => {
          pos = { ...pos, y: 40 };
          requestAnimationFrame(() => document.dispatchEvent(new Event('scroll')));
        }),
      );
      await vi.advanceTimersByTimeAsync(1000);
      expect((await p).status).toBe('ok');
      expect(window.scrollY).toBe(40);
      expect(window.scrollTo).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(keep);
    });

    it("the user's wheel scroll is never undone, though YouTube moved focus into the placeholder in the same frame", async () => {
      unfocusedWindow();
      const job = tileFor('watchSidebar', 'WATCHvideo1');
      const keep = outside();
      keep.focus();
      const p = queue().enqueue(job);
      await vi.advanceTimersByTimeAsync(110); // the job ends at the 100 ms placeholder poll, the guard is still on
      expect((await p).status).toBe('ok');
      userWheel(300);
      focusScrolling(placeholderIn(job)?.querySelector('button') as HTMLElement, 300); // the Undo is in view by then
      await vi.advanceTimersByTimeAsync(100);
      expect(window.scrollY).toBe(300);
      expect(document.activeElement).toBe(keep);
    });

    it("the user's wheel, then YouTube's focus from the next animation frame: the page goes back to where the user scrolled", async () => {
      const painted = unfocusedWindow();
      const job = tileFor('watchSidebar', 'WATCHvideo1');
      const keep = outside();
      keep.focus();
      const p = queue().enqueue(job);
      await vi.advanceTimersByTimeAsync(110); // the job ends at the 100 ms placeholder poll, the guard is still on
      expect((await p).status).toBe('ok');
      const undo = placeholderIn(job)?.querySelector('button') as HTMLElement;
      userWheel(300);
      requestAnimationFrame(() => focusScrolling(undo, 935)); // YouTube's late placeholder focus
      await vi.advanceTimersByTimeAsync(100);
      expect(window.scrollY).toBe(300);
      expect(painted).not.toContain(935);
      expect(document.activeElement).toBe(keep);
    });

    const LATE_FOCUS = {
      'from an animation frame in the same frame': (f: () => void) => requestAnimationFrame(f),
      'from an animation frame a frame later': (f: () => void) => requestAnimationFrame(() => requestAnimationFrame(f)),
      'from a task a frame later': (f: () => void) => requestAnimationFrame(() => setTimeout(f, 8)),
    };
    it.each(Object.keys(LATE_FOCUS) as Array<keyof typeof LATE_FOCUS>)(
      'a wheel that scrolled something other than the page (a panel, the page end) lets no jump through: YouTube focuses %s',
      async (when) => {
        const painted = unfocusedWindow();
        const job = tileFor('watchSidebar', 'WATCHvideo1');
        const keep = outside();
        keep.focus();
        const p = queue().enqueue(job);
        await vi.advanceTimersByTimeAsync(110); // the job ends at the 100 ms placeholder poll, the guard is still on
        expect((await p).status).toBe('ok');
        const undo = placeholderIn(job)?.querySelector('button') as HTMLElement;
        const panel = document.createElement('div');
        document.body.append(panel);
        panel.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true })); // the document does not scroll
        LATE_FOCUS[when](() => focusScrolling(undo, 635)); // YouTube's late placeholder focus
        await vi.advanceTimersByTimeAsync(100);
        expect(window.scrollY).toBe(0);
        expect(painted).not.toContain(635);
        expect(document.activeElement).toBe(keep);
      },
    );
  });
});

// Observed in Chrome on 2026-10-10: while a YouTube dropdown is open it holds the page still (wheel events cancelled,
// the scroll position put back), so a menu Shoo opens must never outlast the user's scrolling.
describe("NativeActionQueue: the user's scrolling comes first", () => {
  it('opens no menu while the user scrolls (wheel, touch or a scroll key), then runs once the page is quiet', async () => {
    const job = tileFor('home', 'HOMEvideo01');
    queue();
    document.body.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true }));
    const p = q.enqueue(job);
    await vi.advanceTimersByTimeAsync(TIMING.scrollQuietMs - 100);
    document.body.dispatchEvent(new Event('touchmove', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(TIMING.scrollQuietMs - 100);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
    await vi.advanceTimersByTimeAsync(TIMING.scrollQuietMs - 100);
    expect(sim.log).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await p).status).toBe('ok');
  });

  const SCROLLS = {
    wheel: () => document.body.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true })),
    touch: () => document.body.dispatchEvent(new Event('touchstart', { bubbles: true })),
    PageDown: () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true })),
    scrollbar: () => document.documentElement.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true })),
  };
  it.each(Object.keys(SCROLLS) as Array<keyof typeof SCROLLS>)(
    "a scroll (%s) while Shoo's menu is open closes it before YouTube sees the event; the job tries again once the page is quiet",
    async (kind) => {
      const job = tileFor('home', 'HOMEvideo01', { iconDelayMs: 1000 });
      const keep = outside();
      keep.focus();
      const p = queue().enqueue(job);
      await vi.advanceTimersByTimeAsync(200); // the menu is open, its icons not rendered yet
      expect(sim.dropdown()?.getAttribute('aria-hidden')).toBeNull();
      let openWhenYouTubeSawIt: boolean | null = null;
      const youTube = (ev: Event) => {
        if ((ev as KeyboardEvent).key === 'Escape' || openWhenYouTubeSawIt !== null) return; // Shoo's own Escape
        openWhenYouTubeSawIt = sim.dropdown()?.getAttribute('aria-hidden') !== 'true';
      };
      for (const t of ['wheel', 'touchstart', 'keydown', 'pointerdown']) document.addEventListener(t, youTube, true);
      SCROLLS[kind]();
      document.dispatchEvent(new Event('pointerup'));
      for (const t of ['wheel', 'touchstart', 'keydown', 'pointerdown']) document.removeEventListener(t, youTube, true);
      expect(openWhenYouTubeSawIt).toBe(false);
      expect(sim.log).toEqual(['open@HOMEvideo01', 'escape']);
      await vi.advanceTimersByTimeAsync(TIMING.scrollQuietMs - 100);
      expect(sim.log).toEqual(['open@HOMEvideo01', 'escape']); // nothing reopens while the page is not quiet
      expect(document.activeElement).toBe(keep);
      await vi.advanceTimersByTimeAsync(3000);
      expect((await p).status).toBe('ok');
      expect(sim.log).toEqual(['open@HOMEvideo01', 'escape', 'open@HOMEvideo01', 'click:Not interested@HOMEvideo01', 'placeholder@HOMEvideo01']);
      expect(document.activeElement).toBe(keep);
    },
  );

  it('a job waiting to try again after a scroll can still be cancelled', async () => {
    const job = tileFor('home', 'HOMEvideo01', { iconDelayMs: 1000 });
    const p = queue().enqueue(job);
    await vi.advanceTimersByTimeAsync(200);
    SCROLLS.wheel();
    await vi.advanceTimersByTimeAsync(100);
    q.cancelAll();
    await vi.advanceTimersByTimeAsync(2000);
    expect((await p).status).toBe('cancelled');
    expect(sim.log).toEqual(['open@HOMEvideo01', 'escape']);
  });

  it.each(['field', 'chip'])('Space pressed in a %s does not count as scrolling', async (where) => {
    const job = tileFor('home', 'HOMEvideo01');
    let target: Element = document.createElement('input');
    if (where === 'field') document.body.append(target);
    else {
      const chip = mountChipHost(job.tileEl, 'home', { forceOverlay: false });
      target = document.createElement('button');
      chip?.shadow.append(target);
    }
    queue();
    target.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, composed: true }));
    const p = q.enqueue(job);
    await vi.advanceTimersByTimeAsync(100);
    expect(sim.log).toContain('open@HOMEvideo01'); // no wait for a quiet page
    await vi.advanceTimersByTimeAsync(500);
    expect((await p).status).toBe('ok');
  });
});

describe('NativeActionQueue: hidden tabs, staleness and cancellation', () => {
  it('pauses while the tab is hidden and resumes on visibilitychange', async () => {
    const job = tileFor('home', 'HOMEvideo01');
    hidden = true;
    const p = queue().enqueue(job);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sim.log).toEqual([]);
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(500);
    expect((await p).status).toBe('ok');
  });

  it('drops a job as stale when the background precheck says no, without clicking', async () => {
    const job = tileFor('home', 'HOMEvideo01');
    const precheck = vi.fn(async () => false);
    const p = queue({ precheck }).enqueue(job);
    await vi.advanceTimersByTimeAsync(100);
    expect(await p).toEqual({ status: 'stale', job });
    expect(precheck).toHaveBeenCalledWith(job);
    expect(sim.log).toEqual([]);
  });

  it('drops a job as stale, clicking nothing, when its Tile sits in a hidden subtree such as a dismissed Shelf', async () => {
    const job = tileFor('home', 'HOMEvideo01');
    const wrapper = document.createElement('div');
    wrapper.setAttribute('hidden', '');
    job.tileEl.before(wrapper);
    wrapper.append(job.tileEl);
    const onDropdownCheck = vi.fn();
    const p = queue({ onDropdownCheck }).enqueue(job);
    await vi.advanceTimersByTimeAsync(100);
    expect(await p).toEqual({ status: 'stale', job });
    expect(onDropdownCheck).not.toHaveBeenCalled();
    expect(sim.log).toEqual([]);
  });

  it('drops a job as stale when the element now shows another video or is gone', async () => {
    const job = tileFor('home', 'HOMEvideo01');
    const gone = tileFor('home', 'HOMEvideo02');
    const host = job.tileEl.querySelector('.ytLockupViewModelHost') as Element;
    host.classList.replace('content-id-HOMEvideo01', 'content-id-OTHERvideo1');
    gone.tileEl.remove();
    queue();
    const [a, b] = [q.enqueue(job), q.enqueue(gone)];
    await vi.advanceTimersByTimeAsync(100);
    expect((await a).status).toBe('stale');
    expect((await b).status).toBe('stale');
  });

  it('a background precheck that never answers makes the job stale after 5 s and the queue moves on', async () => {
    const a = tileFor('home', 'HOMEvideo01');
    const b = tileFor('home', 'HOMEvideo02');
    const precheck = vi.fn((job: ActionJob) => (job === a ? new Promise<boolean>(() => {}) : Promise.resolve(true)));
    queue({ precheck });
    const pa = q.enqueue(a);
    const pb = q.enqueue(b);
    await vi.advanceTimersByTimeAsync(TIMING.precheckMs + 1000);
    expect((await pa).status).toBe('stale');
    expect((await pb).status).toBe('ok');
  });

  it('re-checks the Tile after the background precheck (it may have changed meanwhile)', async () => {
    const job = tileFor('home', 'HOMEvideo01');
    const precheck = async () => {
      job.tileEl.querySelector('.ytLockupViewModelHost')?.classList.replace('content-id-HOMEvideo01', 'content-id-OTHERvideo1');
      return true;
    };
    const p = queue({ precheck }).enqueue(job);
    await vi.advanceTimersByTimeAsync(100);
    expect((await p).status).toBe('stale');
    expect(sim.log).toEqual([]);
  });

  it('registers no Undo watch for a job that finishes after navigation', async () => {
    const job = tileFor('home', 'HOMEvideo01');
    const p = queue().enqueue(job);
    await vi.advanceTimersByTimeAsync(10); // the menu button was clicked
    q.navigated();
    await vi.advanceTimersByTimeAsync(500);
    expect((await p).status).toBe('ok');
    expect(await q.undo(job.videoId)).toBe('notFound');
  });

  it('cancelAll drops queued jobs and the waiting one; navigated() makes them stale', async () => {
    const jobs = [tileFor('home', 'HOMEvideo01'), tileFor('home', 'HOMEvideo02'), tileFor('home', 'HOMEvideo03')];
    hidden = true;
    queue();
    const ps = jobs.map((j) => q.enqueue(j));
    await vi.advanceTimersByTimeAsync(1000);
    q.cancelAll();
    await vi.advanceTimersByTimeAsync(TIMING.focusPollMs);
    expect((await Promise.all(ps)).map((o) => o.status)).toEqual(['cancelled', 'cancelled', 'cancelled']);
    expect(q.size()).toBe(0);
    const again = q.enqueue(jobs[0]!); // cancelled videoIds can be queued again
    q.navigated();
    await vi.advanceTimersByTimeAsync(TIMING.focusPollMs);
    expect((await again).status).toBe('stale');
    expect(sim.log).toEqual([]);
  });
});

describe('Undo', () => {
  async function removed(over: Partial<QueueOptions> = {}, surface: SurfaceId = 'home') {
    const job = tileFor(surface, surface === 'home' ? 'HOMEvideo01' : 'WATCHvideo1');
    const original = SURFACES[surface].actionRoot(job.tileEl)?.innerHTML;
    const p = queue(over).enqueue(job);
    await vi.advanceTimersByTimeAsync(500);
    expect((await p).status).toBe('ok');
    return { job, original };
  }

  it("Shoo's Undo clicks the first placeholder button and confirms the original content is back", async () => {
    const onYouTubeUndo = vi.fn();
    const { job, original } = await removed({ onYouTubeUndo });
    expect(q.canUndo(job.videoId)).toBe(true);
    const u = q.undo(job.videoId);
    await vi.advanceTimersByTimeAsync(100);
    expect(await u).toBe('ok');
    expect(placeholderIn(job)).toBeNull();
    expect(SURFACES.home.actionRoot(job.tileEl)?.innerHTML).toBe(original);
    expect(onYouTubeUndo).not.toHaveBeenCalled();
    expect(sim.log.at(-1)).toBe('restored@HOMEvideo01');
    expect(q.canUndo(job.videoId)).toBe(false);
  });

  it("detects YouTube's own Undo on the Watch sidebar and reports it", async () => {
    const onYouTubeUndo = vi.fn();
    const { job } = await removed({ onYouTubeUndo }, 'watchSidebar');
    (job.tileEl.querySelector('.ytNotificationMultiActionRendererButtonContainer button') as HTMLElement).click(); // the user
    await vi.advanceTimersByTimeAsync(50);
    expect(onYouTubeUndo).toHaveBeenCalledWith('WATCHvideo1', job);
    expect(await q.undo(job.videoId)).toBe('notFound');
  });

  it("detects YouTube's own Undo on Home (same yt-lockup-view-model, fresh children)", async () => {
    const onYouTubeUndo = vi.fn();
    const { job } = await removed({ onYouTubeUndo });
    expect(placeholderIn(job)?.classList.contains('ytDismissibleItemAspectRatio16By9')).toBe(true);
    (job.tileEl.querySelector('.ytNotificationMultiActionRendererButtonContainer button') as HTMLElement).click();
    await vi.advanceTimersByTimeAsync(50);
    expect(onYouTubeUndo).toHaveBeenCalledWith('HOMEvideo01', job);
  });

  it('removes and restores a Shorts shelf Tile through its -v2 actionRoot', async () => {
    const onYouTubeUndo = vi.fn();
    const job = tileFor('shortsShelf', 'SHORTvideo1');
    const p = queue({ onYouTubeUndo }).enqueue(job);
    await vi.advanceTimersByTimeAsync(500);
    expect((await p).status).toBe('ok');
    const root = SURFACES.shortsShelf.actionRoot(job.tileEl) as Element;
    expect(root.localName).toBe('ytm-shorts-lockup-view-model-v2');
    expect(root.querySelector('.ytDismissibleItemAspectRatio2By3')).not.toBeNull();
    expect(root.querySelector('ytm-shorts-lockup-view-model')).toBeNull(); // the inner lockup is gone meanwhile
    const u = q.undo(job.videoId);
    await vi.advanceTimersByTimeAsync(100);
    expect(await u).toBe('ok');
    expect(root.querySelector('ytm-shorts-lockup-view-model')).not.toBeNull();
    expect(onYouTubeUndo).not.toHaveBeenCalled();
    // YouTube's own Undo on Shorts is detected too.
    q.navigated();
    const again = q.enqueue(job);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await again).status).toBe('ok');
    (root.querySelector('.ytNotificationMultiActionRendererButtonContainer button') as HTMLElement).click();
    await vi.advanceTimersByTimeAsync(50);
    expect(onYouTubeUndo).toHaveBeenCalledWith('SHORTvideo1', expect.anything());
  });

  it('does not mistake element reuse for an Undo', async () => {
    const onYouTubeUndo = vi.fn();
    const { job } = await removed({ onYouTubeUndo }, 'watchSidebar');
    job.tileEl.innerHTML = (job.tileEl.innerHTML.length ? FIXTURES.watchTile : '').replace(/^[\s\S]*?<yt-lockup-view-model[^>]*>/, '').replace(/<\/yt-lockup-view-model>\s*$/, '').replaceAll('FIXTUREvid1', 'NEWvideo001');
    await vi.advanceTimersByTimeAsync(50);
    expect(job.tileEl.querySelector('.content-id-NEWvideo001')).not.toBeNull();
    expect(onYouTubeUndo).not.toHaveBeenCalled();
  });

  // Seen in a live test: YouTube restores or clears placeholders on the page being left before Shoo sees the navigation.
  const youTubeRestores = (job: ActionJob) => (job.tileEl.querySelector('.ytNotificationMultiActionRendererButtonContainer button') as HTMLElement).click();

  it('navigation never reports Undo: yt-navigate-start disarms the watch', async () => {
    const onYouTubeUndo = vi.fn();
    const { job } = await removed({ onYouTubeUndo });
    document.dispatchEvent(new Event('yt-navigate-start'));
    youTubeRestores(job); // YouTube puts the content back on the page being left
    await vi.advanceTimersByTimeAsync(50);
    expect(SURFACES.home.actionRoot(job.tileEl)?.querySelector('.ytDismissibleItemReplacedContent')).toBeNull();
    expect(onYouTubeUndo).not.toHaveBeenCalled();
    expect(q.canUndo(job.videoId)).toBe(false);
    expect(await q.undo(job.videoId)).toBe('notFound');
  });

  it('yt-navigate-finish disarms the watch too', async () => {
    const onYouTubeUndo = vi.fn();
    const { job } = await removed({ onYouTubeUndo });
    document.dispatchEvent(new Event('yt-navigate-finish'));
    youTubeRestores(job);
    await vi.advanceTimersByTimeAsync(50);
    expect(onYouTubeUndo).not.toHaveBeenCalled();
  });

  it('a restore on a page that is no longer visible, or after the URL changed, is not an Undo', async () => {
    const onYouTubeUndo = vi.fn();
    const { job } = await removed({ onYouTubeUndo });
    const page = job.tileEl.closest('ytd-page-manager > *') as Element;
    page.setAttribute('hidden', '');
    page.parentElement?.append(document.createElement('ytd-watch-flexy'));
    youTubeRestores(job);
    await vi.advanceTimersByTimeAsync(50);
    expect(onYouTubeUndo).not.toHaveBeenCalled();

    document.body.innerHTML = '';
    sim = simulateYouTube();
    const second = tileFor('home', 'HOMEvideo02');
    const p = q.enqueue(second);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await p).status).toBe('ok');
    history.replaceState(null, '', '/watch?v=OTHERvideo1');
    youTubeRestores(second);
    await vi.advanceTimersByTimeAsync(50);
    history.replaceState(null, '', '/');
    expect(onYouTubeUndo).not.toHaveBeenCalled();
  });

  it('a placeholder that goes away without the original content (cleared or detached) is not an Undo', async () => {
    const onYouTubeUndo = vi.fn();
    const { job } = await removed({ onYouTubeUndo });
    const root = SURFACES.home.actionRoot(job.tileEl) as Element;
    root.replaceChildren(document.createElement('div'));
    await vi.advanceTimersByTimeAsync(50);
    expect(onYouTubeUndo).not.toHaveBeenCalled();
  });

  it('reports expired when the placeholder is gone, and notFound for unknown videos or after navigation', async () => {
    const { job } = await removed();
    expect(await q.undo('UNKNOWNvid1')).toBe('notFound');
    const root = SURFACES.home.actionRoot(job.tileEl) as Element;
    root.querySelector('.ytNotificationMultiActionRendererButtonContainer')?.remove();
    expect(await q.undo(job.videoId)).toBe('expired');
    const second = tileFor('home', 'HOMEvideo02');
    const p = q.enqueue(second);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await p).status).toBe('ok');
    q.navigated();
    expect(await q.undo(second.videoId)).toBe('notFound');
  });
});

describe('withLazyIcons', () => {
  it('strips every svg and re-inserts them after the delay', async () => {
    const menu = document.createElement('div');
    menu.innerHTML = FIXTURES.homeMenu;
    const count = menu.querySelectorAll('svg').length;
    expect(count).toBeGreaterThan(0);
    withLazyIcons(menu, 1000);
    expect(menu.querySelectorAll('svg')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(menu.querySelectorAll('svg')).toHaveLength(count);
  });
});
