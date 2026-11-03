// @vitest-environment jsdom
// Content pipeline integration tests with mocked messaging: every Mode, every Mode transition in architecture.md
// Section 5, mid-flight Rule edits, failure notices, the Daily cap, dropped background messages, toggle off,
// duplicates and element reuse.
import '~/ui/test/catalogue';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TileFacts } from '~/core/types';
import { removeOverlay } from '~/ui/in-page';
import { addSyntheticShelfControl, appendContinuation, wireShelf } from '~/youtube/test-harness';
import { OFF, grid, overlayRoot, setupHome, shooHosts, snapshot, tilesOf, wireAll, type Env } from './testing';

let hidden = false;
let env: Env | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
});
afterEach(() => {
  env?.p.dispose();
  env = undefined;
  act(() => removeOverlay());
  vi.useRealTimers();
  document.body.innerHTML = '';
  history.replaceState(null, '', '/');
});

const start = (...args: Parameters<typeof setupHome>) => (env = setupHome(...args));
const judgedIds = (e: Env, call = -1) => (e.bg.of('judgeTiles').at(call)?.items ?? []).map((f: TileFacts) => f.videoId).sort();
const opens = (e: Env) => e.sim.log.filter((l) => l.startsWith('open@'));
const click = (root: ShadowRoot, sel: string) => (root.querySelector(sel) as HTMLElement).click();
async function navigate(e: Env, path = '/?nav=1') {
  history.replaceState(null, '', path);
  document.dispatchEvent(new Event('yt-navigate-finish'));
  await e.settle();
}
/** Append the next Home batch and wire it to the simulated menu. */
async function more(e: Env) {
  const added = appendContinuation(grid());
  wireAll(e.sim);
  await e.settle();
  e.io.trigger(true);
  return added;
}

describe('bootstrapped pipeline: judging', () => {
  it('sends eligible Tiles in one batch after 400 ms, each video once, with the latest settingsGeneration', async () => {
    const e = start();
    e.io.trigger(true);
    await vi.advanceTimersByTimeAsync(399);
    expect(e.bg.of('judgeTiles')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    const [req] = e.bg.of('judgeTiles');
    expect(req?.settingsGeneration).toBe(1);
    // 13 elements, 12 videos: FIXTURE0001 twice on Home, FIXTURE0002 on Home and on the Shorts shelf.
    expect(judgedIds(e)).toEqual(
      ['FIXTURE0001', 'FIXTURE0002', 'FIXTURE0004', 'FIXTURE0006', 'FIXTURE0007', 'FIXTURE0008', 'FIXTURE0009', 'FIXTURE0010', 'FIXTURE0101', 'FIXTURE0102', 'FIXTURE0103'].sort(),
    );
  });

  it('never re-sends a decorated Tile without a settingsChanged, and decorates re-rendered copies from `judged`', async () => {
    const e = start();
    e.bg.outcomes.set('FIXTURE0007', { ruleId: 'r1' });
    await e.showAll();
    e.io.trigger(false);
    e.io.trigger(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(e.bg.of('judgeTiles')).toHaveLength(1);
    // YouTube re-renders a copy of FIXTURE0007 (for example after navigating back): chipped without a request.
    const copy = tilesOf('FIXTURE0007')[0]!.cloneNode(true) as Element;
    grid().append(copy);
    await e.settle();
    e.io.trigger(true, [copy]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(e.bg.of('judgeTiles')).toHaveLength(1);
    expect(e.ui.kindOf(copy)).toBe('chip');
  });

  it('a dropped background message is retried once after 250 ms', async () => {
    const e = start();
    e.bg.outcomes.set('FIXTURE0006', { ruleId: 'r1' });
    e.bg.drop = 1;
    e.io.trigger(true);
    await vi.advanceTimersByTimeAsync(400);
    expect(e.bg.of('judgeTiles')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(249);
    expect(e.bg.of('judgeTiles')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(e.bg.of('judgeTiles')).toHaveLength(2);
    expect(e.kinds('FIXTURE0006')).toEqual(['chip']);
  });

  it('a second failure leaves the Tiles undecided until the next rescan', async () => {
    const e = start({ reason: 'offline', stages: { exact: true, model: false, nativeActions: true, ui: true } });
    e.bg.outcomes.set('FIXTURE0006', { ruleId: 'r1' });
    e.bg.drop = 2;
    await e.showAll();
    await vi.advanceTimersByTimeAsync(300);
    expect(e.bg.of('judgeTiles')).toHaveLength(2);
    expect(e.kinds('FIXTURE0006')).toEqual([undefined]);
    // Back online: the background broadcasts and content re-sends the undecided visible Tiles.
    e.broadcast({ reason: 'ok', stages: { exact: true, model: true, nativeActions: true, ui: true } });
    await vi.advanceTimersByTimeAsync(400);
    expect(e.bg.of('judgeTiles')).toHaveLength(3);
    expect(e.kinds('FIXTURE0006')).toEqual(['chip']);
  });

  it('a Rule edited while a batch is in flight: the stale reply is dropped and the Tile re-judged', async () => {
    const e = start();
    const chip = vi.spyOn(e.ui, 'chip');
    e.bg.outcomes.set('FIXTURE0006', { ruleId: 'r1' });
    e.bg.hold = true;
    e.io.trigger(true);
    await vi.advanceTimersByTimeAsync(400);
    expect(e.bg.held).toHaveLength(1); // judged under R1, reply still in flight
    // The user edits the Rules: R1 no longer matches, R2 does.
    e.bg.state = { ...e.bg.state, settingsGeneration: 2, rulesVersion: 'rv2' };
    e.bg.outcomes.set('FIXTURE0006', { ruleId: 'r2' });
    e.p.settingsChanged({ settingsGeneration: 2, rulesVersion: 'rv2' });
    await vi.advanceTimersByTimeAsync(400);
    expect(e.bg.of('judgeTiles')).toHaveLength(2);
    expect(e.bg.of('judgeTiles')[1]?.settingsGeneration).toBe(2);
    expect(judgedIds(e)).toContain('FIXTURE0006');
    // Old reply arrives late: dropped.
    e.bg.held.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(chip).not.toHaveBeenCalled();
    expect(e.kinds('FIXTURE0006')).toEqual([undefined]);
    e.bg.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(chip.mock.calls.map(([, , props]) => [props.ruleRef, props.ruleName])).toEqual([['R2', 'Crypto & trading']]);
    expect(e.kinds('FIXTURE0006')).toEqual(['chip']);
  });

  it('settingsChanged re-judges decorated Tiles and withdraws chips that no longer hold', async () => {
    const e = start();
    e.bg.outcomes.set('FIXTURE0006', { ruleId: 'r1' });
    await e.showAll();
    expect(e.kinds('FIXTURE0006')).toEqual(['chip']);
    // An Exact Keep rule: rulesVersion and generation stay, the verdict changes.
    e.bg.outcomes.set('FIXTURE0006', 'keep');
    e.p.settingsChanged({ settingsGeneration: 1, rulesVersion: 'rv1' });
    await vi.advanceTimersByTimeAsync(400);
    expect(judgedIds(e)).toContain('FIXTURE0006');
    expect(e.kinds('FIXTURE0006')).toEqual([undefined]);
    expect(e.bg.of('reviewPending').at(-1)).toEqual({ count: 0 });
  });

  it('the markup self-test reports an existing but empty container as ok', async () => {
    const e = start();
    grid().replaceChildren();
    await navigate(e);
    await vi.advanceTimersByTimeAsync(5000);
    expect(e.bg.of('reportMarkupCheck').at(-1)).toEqual({ ok: true, selectorVersion: expect.any(String), missing: [] });
  });

  it('the markup self-test reports a missing container', async () => {
    const e = start();
    grid().closest('ytd-rich-grid-renderer')?.remove();
    await navigate(e);
    await vi.advanceTimersByTimeAsync(5000);
    expect(e.bg.of('reportMarkupCheck').at(-1)).not.toMatchObject({ ok: false }); // the 10 s container wait runs first
    await vi.advanceTimersByTimeAsync(5000);
    expect(e.bg.of('reportMarkupCheck').at(-1)).toMatchObject({ ok: false, missing: ['home.container'] });
  });
});

describe('Review mode', () => {
  it('chips remove Verdicts on every copy, reports reviewPending, and Remove acts through the queue', async () => {
    const e = start({ mode: 'review' });
    e.bg.outcomes.set('FIXTURE0001', { ruleId: 'r1', source: 'model', p: 0.88 });
    e.bg.outcomes.set('FIXTURE0102', { ruleId: 'r2' });
    await e.showAll();
    expect(e.kinds('FIXTURE0001')).toEqual(['chip', 'chip']);
    expect(e.kinds('FIXTURE0102')).toEqual(['chip']);
    expect(e.kinds('FIXTURE0004')).toEqual([undefined]);
    expect(e.ui.mounted).toBe(true);
    expect(e.bg.of('reviewPending')).toEqual([{ count: 3 }]);
    expect(opens(e)).toEqual([]);

    const [first] = tilesOf('FIXTURE0001');
    const root = e.shadowOf(first!);
    expect(root.querySelector('.chip')?.getAttribute('aria-label')).toBe('Shoo: Remove? Rule: Reaction videos, 88 percent');
    click(root, 'button.solid');
    await vi.advanceTimersByTimeAsync(1000);
    expect(opens(e)).toEqual(['open@FIXTURE0001']);
    expect(e.ui.kindOf(first!)).toBe('annotation');
    expect(e.bg.of('reportActionResult')).toEqual([
      expect.objectContaining({ ok: true, videoId: 'FIXTURE0001', surface: 'home', ruleId: 'r1', nativeAction: 'notInterested', source: 'model', p: 0.88, mode: 'review', title: expect.any(String) }),
    ]);
    expect(e.bg.of('reviewPending').at(-1)).toEqual({ count: 2 });
    expect(overlayRoot()?.querySelector('.panel:not(.notice)') ?? null).toBeNull(); // no batch summary in Review
  });

  it('names each Rule by its Rule name, else its text, else its ref, with the text as the tooltip and no ref shown', async () => {
    const e = start({ mode: 'review' });
    e.bg.outcomes.set('FIXTURE0001', { ruleId: 'r1' });
    e.bg.outcomes.set('FIXTURE0006', { ruleId: 'r2' });
    e.bg.outcomes.set('FIXTURE0007', { ruleId: 'r9', ref: 'R9' }); // the reply carries no display data for it
    await e.showAll();
    const tag = (videoId: string) => e.shadowOf(tilesOf(videoId)[0]!).querySelector('.tag');
    expect([tag('FIXTURE0001'), tag('FIXTURE0006'), tag('FIXTURE0007')].map((t) => [t?.textContent, t?.getAttribute('title')])).toEqual([
      ['Reaction videos', 'Reaction videos'],
      ['Crypto & trading', 'Videos about cryptocurrency or trading'],
      ['R9', 'R9'],
    ]);
    expect(e.shadowOf(tilesOf('FIXTURE0006')[0]!).querySelector('.chip')?.getAttribute('aria-label')).toBe('Shoo: Remove? Rule: Crypto & trading');
    expect(e.shadowOf(tilesOf('FIXTURE0006')[0]!).textContent).not.toContain('R2');
  });

  it('Keep stores an Exception (reviewKeep), shows the kept note, and withdraws the other copy', async () => {
    const e = start({ mode: 'review' });
    e.bg.outcomes.set('FIXTURE0001', { ruleId: 'r1' });
    await e.showAll();
    const [a, b] = tilesOf('FIXTURE0001');
    act(() => click(e.shadowOf(a!), 'button:not(.solid)'));
    await vi.advanceTimersByTimeAsync(0);
    expect(e.bg.of('addException')).toEqual([expect.objectContaining({ videoId: 'FIXTURE0001', ruleId: 'r1', origin: 'reviewKeep' })]);
    expect(e.ui.kindOf(a!)).toBe('kept');
    expect(e.shadowOf(a!).textContent).toContain("won't ask again");
    expect(e.ui.kindOf(b!)).toBeUndefined();
    expect(e.bg.of('reviewPending').at(-1)).toEqual({ count: 0 });
    // "Always keep this channel" from the kept note.
    act(() => click(e.shadowOf(a!), 'button.link'));
    expect(e.bg.of('keepChannel')).toEqual([expect.objectContaining({ channelName: expect.any(String) })]);
    await act(async () => void (await vi.advanceTimersByTimeAsync(4000)));
    expect(e.ui.kindOf(a!)).toBeUndefined();
  });

  it('"Always keep this channel" on a Banned channel sends again with liftBan false', async () => {
    const e = start({ mode: 'review' });
    e.bg.banned = true;
    e.bg.outcomes.set('FIXTURE0006', { ruleId: 'r1' });
    await e.showAll();
    const [el] = tilesOf('FIXTURE0006');
    act(() => click(e.shadowOf(el!), 'button:not(.solid)'));
    await vi.advanceTimersByTimeAsync(0);
    act(() => click(e.shadowOf(el!), 'button.link'));
    await vi.advanceTimersByTimeAsync(0);
    const sent = e.bg.of('keepChannel');
    expect(sent).toHaveLength(2);
    expect(sent[0]).not.toHaveProperty('liftBan');
    expect(sent[1]).toEqual({ ...sent[0], liftBan: false });
  });

  it('a private window offers no "Always keep this channel" on the kept note or the annotation', async () => {
    const e = start({ mode: 'review' });
    e.bg.private = true;
    e.bg.outcomes.set('FIXTURE0006', { ruleId: 'r1' });
    e.bg.outcomes.set('FIXTURE0007', { ruleId: 'r1' });
    await e.showAll();
    const [kept] = tilesOf('FIXTURE0006');
    act(() => click(e.shadowOf(kept!), 'button:not(.solid)'));
    await vi.advanceTimersByTimeAsync(0);
    expect(e.shadowOf(kept!).textContent).toContain('Kept for this session');
    expect(e.shadowOf(kept!).querySelector('button.link')).toBeNull();
    const [removed] = tilesOf('FIXTURE0007');
    click(e.shadowOf(removed!), 'button.solid');
    await vi.advanceTimersByTimeAsync(1000);
    expect(e.ui.kindOf(removed!)).toBe('annotation');
    expect([...e.shadowOf(removed!).querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Keep']);
    expect(e.bg.of('keepChannel')).toEqual([]);
  });

  it('Shorts shelf chips have no "Always keep this channel"', async () => {
    const e = start({ mode: 'review' });
    e.bg.outcomes.set('FIXTURE0102', { ruleId: 'r1' });
    await e.showAll();
    const [s] = tilesOf('FIXTURE0102');
    act(() => click(e.shadowOf(s!), 'button:not(.solid)'));
    await vi.advanceTimersByTimeAsync(0);
    expect(e.shadowOf(s!).querySelector('button.link')).toBeNull();
  });

  it('element reuse unmounts the chip and treats the element as a new Tile', async () => {
    const e = start({ mode: 'review' });
    e.bg.outcomes.set('FIXTURE0006', { ruleId: 'r1' });
    await e.showAll();
    const [el] = tilesOf('FIXTURE0006');
    const host = e.ui.hostOf(el!);
    expect(host?.isConnected).toBe(true);
    const lockup = el!.querySelector('.ytLockupViewModelHost')!;
    lockup.className = lockup.className.replace('content-id-FIXTURE0006', 'content-id-FIXTURE0099');
    await e.settle();
    expect(e.ui.kindOf(el!)).toBeUndefined();
    expect(host?.isConnected).toBe(false);
    await vi.advanceTimersByTimeAsync(400);
    expect(judgedIds(e)).toEqual(['FIXTURE0099']);
  });
});

describe('chips YouTube destroys', () => {
  it('a chip whose Tile content YouTube re-renders is mounted again from `judged`, without a new request', async () => {
    const e = start({ mode: 'review' });
    e.bg.outcomes.set('FIXTURE0102', { ruleId: 'r1' });
    await e.showAll();
    const [s] = tilesOf('FIXTURE0102');
    const old = e.ui.hostOf(s!);
    const requests = e.bg.of('judgeTiles').length;
    const inner = s!.querySelector('ytm-shorts-lockup-view-model') as Element;
    inner.replaceWith(inner.cloneNode(true)); // YouTube re-renders the inner Shorts lockup
    await e.settle();
    expect(old?.isConnected).toBe(false);
    expect(e.ui.kindOf(s!)).toBe('chip');
    expect(e.ui.isLive(s!)).toBe(true);
    expect(e.bg.of('judgeTiles')).toHaveLength(requests);
    expect(e.bg.of('reviewPending').at(-1)).toEqual({ count: 1 });
  });

  it('reviewPending counts only chips that are showing', async () => {
    const e = start({ mode: 'review' });
    e.bg.outcomes.set('FIXTURE0102', { ruleId: 'r1' });
    e.bg.outcomes.set('FIXTURE0006', { ruleId: 'r1' });
    await e.showAll();
    expect(e.bg.of('reviewPending').at(-1)).toEqual({ count: 2 });
    const [s] = tilesOf('FIXTURE0102');
    s!.querySelector('ytm-shorts-lockup-view-model')?.remove(); // content gone, nothing to mount on
    await e.settle();
    expect(e.bg.of('reviewPending').at(-1)).toEqual({ count: 1 });
  });

  it('a Tile that comes back after its chip was dropped (Back navigation re-render) gets its chip again', async () => {
    const e = start({ mode: 'review' });
    e.bg.outcomes.set('FIXTURE0006', { ruleId: 'r1' });
    await e.showAll();
    const [el] = tilesOf('FIXTURE0006');
    const slot = el!.nextSibling;
    el!.remove();
    await e.settle();
    await more(e); // a later batch prunes UI of Tiles that left
    await vi.advanceTimersByTimeAsync(400);
    expect(e.ui.kindOf(el!)).toBeUndefined();
    grid().insertBefore(el!, slot);
    await e.settle();
    expect(e.ui.kindOf(el!)).toBe('chip');
    expect(e.ui.isLive(el!)).toBe(true);
  });

  it('a re-render that brings another video into the element is a new Tile, not the old chip', async () => {
    const e = start({ mode: 'review' });
    e.bg.outcomes.set('FIXTURE0102', { ruleId: 'r1' });
    await e.showAll();
    const [s] = tilesOf('FIXTURE0102');
    const inner = s!.querySelector('ytm-shorts-lockup-view-model') as Element;
    const next = inner.cloneNode(true) as Element;
    for (const a of next.querySelectorAll('a[href*="FIXTURE0102"]')) a.setAttribute('href', a.getAttribute('href')!.replace('FIXTURE0102', 'FIXTURE0199'));
    inner.replaceWith(next);
    await e.settle();
    await vi.advanceTimersByTimeAsync(400);
    expect(e.ui.kindOf(s!)).toBeUndefined();
    expect(judgedIds(e)).toEqual(['FIXTURE0199']);
  });
});

describe('Dry-run mode', () => {
  it('labels remove Verdicts and records them once, nothing reaches YouTube', async () => {
    const e = start({ mode: 'dryRun' });
    e.bg.outcomes.set('FIXTURE0001', { ruleId: 'r1' });
    e.bg.outcomes.set('FIXTURE0007', { ruleId: 'r2' });
    await e.showAll();
    expect(e.kinds('FIXTURE0001')).toEqual(['label', 'label']);
    expect(e.kinds('FIXTURE0007')).toEqual(['label']);
    expect(e.shadowOf(tilesOf('FIXTURE0007')[0]!).querySelector('.sr')?.textContent).toBe('Shoo would remove this video, Rule: Crypto & trading');
    const records = e.bg.of('recordWouldRemove');
    expect(records).toHaveLength(1);
    expect(records[0]?.results.map((r) => r.videoId).sort()).toEqual(['FIXTURE0001', 'FIXTURE0007']);
    expect(records[0]?.tiles?.map((t) => t.videoId).sort()).toEqual(['FIXTURE0001', 'FIXTURE0007']);
    expect(records[0]?.batchId).toEqual(expect.any(String));
    await vi.advanceTimersByTimeAsync(5000);
    expect(opens(e)).toEqual([]);
    expect(e.bg.of('reportActionResult')).toEqual([]);
  });

  it('a tripped Native action breaker shows remove Verdicts as Dry-run labels', async () => {
    const e = start({ mode: 'auto', reason: 'breakerNativeAction', stages: { exact: true, model: true, nativeActions: false, ui: true } });
    e.bg.outcomes.set('FIXTURE0006', { ruleId: 'r1' });
    await e.showAll();
    await vi.advanceTimersByTimeAsync(2000);
    expect(e.kinds('FIXTURE0006')).toEqual(['label']);
    expect(opens(e)).toEqual([]);
  });
});

describe('Auto mode', () => {
  it('acts once per video per page, annotates the removed Tile and the duplicate copy, shows the summary', async () => {
    const e = start({ mode: 'auto' });
    e.bg.outcomes.set('FIXTURE0001', { ruleId: 'r1' });
    e.bg.outcomes.set('FIXTURE0007', { ruleId: 'r2' });
    const [a, b] = tilesOf('FIXTURE0001');
    const [c] = tilesOf('FIXTURE0007');
    await e.showAll();
    await vi.advanceTimersByTimeAsync(3000);
    expect(opens(e)).toEqual(['open@FIXTURE0001', 'open@FIXTURE0007']);
    expect(e.ui.kindOf(a!)).toBe('annotation');
    expect(e.ui.kindOf(b!)).toBe('duplicate');
    expect(e.shadowOf(b!).textContent).toContain('Already shooed above');
    // Each removed card names its Rule: its name (r2), or its text when it has none (r1).
    expect([a!, b!, c!].map((el) => e.shadowOf(el).querySelector('.tag')?.textContent)).toEqual(['Reaction videos', 'Reaction videos', 'Crypto & trading']);
    const reports = e.bg.of('reportActionResult');
    expect(reports.map((r) => r.videoId)).toEqual(['FIXTURE0001', 'FIXTURE0007']);
    expect(reports[0]).toMatchObject({ ok: true, mode: 'auto', source: 'exact' });
    // Both Removals share one batch: the summary shows the running total.
    expect(reports[0]).toHaveProperty('batchId', (reports[1] as { batchId: string }).batchId);
    expect(overlayRoot()?.textContent).toMatch(/2 videos/);
    expect([...overlayRoot()!.querySelectorAll('.rules .tag')].map((t) => [t.textContent, t.getAttribute('title')])).toEqual([
      ['Reaction videos', 'Reaction videos'],
      ['Crypto & trading', 'Videos about cryptocurrency or trading'],
    ]);
  });

  it('the annotation names the removed video: title and channel, the title alone on the Shorts shelf', async () => {
    const e = start({ mode: 'auto' });
    e.bg.outcomes.set('FIXTURE0006', { ruleId: 'r1' });
    e.bg.outcomes.set('FIXTURE0102', { ruleId: 'r1' });
    const [home] = tilesOf('FIXTURE0006');
    const [short] = tilesOf('FIXTURE0102');
    await e.showAll();
    await vi.advanceTimersByTimeAsync(3000);
    expect([e.ui.kindOf(home!), e.ui.kindOf(short!)]).toEqual(['annotation', 'annotation']);
    const line = (el: Element) => e.shadowOf(el).querySelector('.vid');
    expect([...line(home!)!.querySelectorAll('bdi')].map((b) => b.textContent)).toEqual(['Fixture title 6', 'Fixture Channel 6']);
    expect(e.shadowOf(home!).querySelector('.sr')?.textContent).toContain('removed Fixture title 6 from Fixture Channel 6 by Rule');
    expect(e.shadowOf(short!).querySelector('.sr')?.textContent).toContain('removed Fixture title 102 by Rule');
    expect([...line(short!)!.querySelectorAll('bdi')].map((b) => b.textContent)).toEqual(['Fixture title 102']);
    expect(line(short!)?.querySelector('.sep')).toBeNull();
    // Shown on the page only: the video ID never appears in Shoo's text.
    for (const el of [home!, short!]) expect(e.shadowOf(el).textContent).not.toMatch(/FIXTURE0/);
  });

  it("YouTube's own Undo reports undone via 'youtube'", async () => {
    const e = start({ mode: 'auto' });
    e.bg.outcomes.set('FIXTURE0006', { ruleId: 'r1' });
    const [el] = tilesOf('FIXTURE0006');
    await e.showAll();
    await vi.advanceTimersByTimeAsync(1000);
    (el!.querySelector('.ytNotificationMultiActionRendererButtonContainer button') as HTMLElement).click();
    await vi.advanceTimersByTimeAsync(100);
    expect(e.bg.of('reportUndo')).toEqual([{ videoId: 'FIXTURE0006', via: 'youtube' }]);
    expect(e.ui.kindOf(el!)).toBeUndefined();
  });

  it("undoRemoval from the background undoes through YouTube's Undo, then reports undone via 'shoo'", async () => {
    const e = start({ mode: 'auto' });
    e.bg.outcomes.set('FIXTURE0006', { ruleId: 'r1' });
    await e.showAll();
    await vi.advanceTimersByTimeAsync(1000);
    const undo = e.p.undoRemoval({ videoId: 'FIXTURE0006' });
    await vi.advanceTimersByTimeAsync(100);
    expect(await undo).toEqual({ ok: true });
    expect(e.sim.log.at(-1)).toBe('restored@FIXTURE0006');
    expect(e.bg.of('reportUndo')).toEqual([{ videoId: 'FIXTURE0006', via: 'shoo' }]);
    expect(e.bg.of('addException')).toEqual([]);
    expect(await e.p.undoRemoval({ videoId: 'FIXTURE0007' })).toEqual({ ok: false, reason: 'notFound' });
  });

  it("the annotation's Keep undoes and reports undone via 'shoo'", async () => {
    const e = start({ mode: 'auto' });
    e.bg.outcomes.set('FIXTURE0006', { ruleId: 'r1' });
    const [el] = tilesOf('FIXTURE0006');
    await e.showAll();
    await vi.advanceTimersByTimeAsync(1000);
    click(e.shadowOf(el!), 'button.link');
    await vi.advanceTimersByTimeAsync(100);
    expect(e.bg.of('reportUndo')).toEqual([{ videoId: 'FIXTURE0006', via: 'shoo' }]);
    expect(e.sim.log.at(-1)).toBe('restored@FIXTURE0006');
  });

  it('summary Undo all undoes every still-undoable Removal; Review opens Settings Activity for the batch', async () => {
    const e = start({ mode: 'auto' });
    e.bg.outcomes.set('FIXTURE0006', { ruleId: 'r1' });
    e.bg.outcomes.set('FIXTURE0007', { ruleId: 'r1' });
    await e.showAll();
    await vi.advanceTimersByTimeAsync(2000);
    const buttons = [...(overlayRoot()?.querySelectorAll('button') ?? [])] as HTMLElement[];
    const batchId = (e.bg.of('reportActionResult')[0] as { batchId: string }).batchId;
    act(() => buttons.find((b) => /review/i.test(b.textContent ?? ''))!.click());
    expect(e.bg.of('openSettings')).toEqual([{ hash: `activity?batch=${batchId}` }]);
    act(() => buttons.find((b) => /undo/i.test(b.textContent ?? ''))!.click());
    await vi.advanceTimersByTimeAsync(500);
    expect(e.bg.of('reportUndo')).toEqual([
      { videoId: 'FIXTURE0006', via: 'shoo' },
      { videoId: 'FIXTURE0007', via: 'shoo' },
    ]);
  });

  it('Undo all goes away once nothing is undoable, even when the summary was reopened late', async () => {
    const e = start({ mode: 'auto' });
    e.bg.outcomes.set('FIXTURE0006', { ruleId: 'r1' });
    await e.showAll();
    await vi.advanceTimersByTimeAsync(1000);
    const panel = () => overlayRoot()?.querySelector('.panel:not(.notice)') as HTMLElement | null;
    const undoAll = () => [...(panel()?.querySelectorAll('button') ?? [])].find((b) => /undo/i.test(b.textContent ?? '')) ?? null;
    act(() => void panel()!.dispatchEvent(new MouseEvent('mouseenter'))); // the user holds the summary open
    await act(async () => void (await vi.advanceTimersByTimeAsync(40_000))); // past SUMMARY_SPAN_MS
    expect(undoAll()).not.toBeNull();
    act(() => undoAll()!.click());
    await act(async () => void (await vi.advanceTimersByTimeAsync(500)));
    expect(e.bg.of('reportUndo')).toEqual([{ videoId: 'FIXTURE0006', via: 'shoo' }]);
    expect(panel()).not.toBeNull();
    expect(undoAll()).toBeNull();
  });

  it("YouTube's own Undo of the last Removal takes Undo all away without reopening a collapsed summary", async () => {
    const e = start({ mode: 'auto' });
    e.bg.outcomes.set('FIXTURE0006', { ruleId: 'r1' });
    const [el] = tilesOf('FIXTURE0006');
    await e.showAll();
    await vi.advanceTimersByTimeAsync(1000);
    await act(async () => void (await vi.advanceTimersByTimeAsync(7000))); // collapsed into the pill
    expect(overlayRoot()?.querySelector('.pill')).not.toBeNull();
    (el!.querySelector('.ytNotificationMultiActionRendererButtonContainer button') as HTMLElement).click();
    await act(async () => void (await vi.advanceTimersByTimeAsync(100)));
    expect(e.bg.of('reportUndo')).toEqual([{ videoId: 'FIXTURE0006', via: 'youtube' }]);
    expect(overlayRoot()?.querySelector('.pill')).not.toBeNull(); // still collapsed
    act(() => (overlayRoot()?.querySelector('.pill') as HTMLElement).click());
    const panel = overlayRoot()?.querySelector('.panel:not(.notice)');
    expect([...(panel?.querySelectorAll('button') ?? [])].some((b) => /undo/i.test(b.textContent ?? ''))).toBe(false);
  });

  it('an automatic Escalation from a Removal is said in the batch summary and its announcement', async () => {
    const e = start({ mode: 'auto' });
    e.bg.escalated = { ruleId: 'b1', channelName: 'Hustle Daily' };
    e.bg.outcomes.set('FIXTURE0006', { ruleId: 'r1', source: 'model', p: 0.9 });
    await e.showAll();
    await vi.advanceTimersByTimeAsync(2000);
    expect(overlayRoot()?.querySelector('.esc')?.textContent).toBe('Banned Hustle Daily too');
    expect(overlayRoot()?.querySelector('[aria-live="polite"]')?.textContent).toMatch(/Banned Hustle Daily too\.$/);
  });

  it("notificationStyle 'perRemoval' shows each Removal on its own, 'silent' shows no summary", async () => {
    const e = start({ mode: 'auto', notificationStyle: 'perRemoval' });
    const summary = vi.spyOn(e.ui, 'summary');
    e.bg.outcomes.set('FIXTURE0006', { ruleId: 'r1' });
    e.bg.outcomes.set('FIXTURE0007', { ruleId: 'r1' });
    await e.showAll();
    await vi.advanceTimersByTimeAsync(2000);
    expect(summary.mock.calls.map(([d]) => d.count)).toEqual([1, 1]);
    expect(new Set(summary.mock.calls.map(([d]) => d.batchId)).size).toBe(2);
    summary.mockClear();
    e.broadcast({ notificationStyle: 'silent' });
    e.bg.outcomes.set('FIXTURE0011', { ruleId: 'r1' });
    await more(e);
    await vi.advanceTimersByTimeAsync(1500);
    expect(e.bg.of('reportActionResult').map((r) => r.videoId)).toContain('FIXTURE0011');
    expect(summary).not.toHaveBeenCalled();
  });

  it('Native action failures show one notice per streak, report each failure, and never say paused', async () => {
    const e = start({ mode: 'auto' }, { neverOpen: true });
    const notice = vi.spyOn(e.ui, 'notice');
    for (const id of ['FIXTURE0006', 'FIXTURE0007', 'FIXTURE0008']) e.bg.outcomes.set(id, { ruleId: 'r1' });
    await e.showAll();
    await vi.advanceTimersByTimeAsync(6000);
    const fails = e.bg.of('reportActionResult');
    expect(fails).toHaveLength(3);
    expect(fails[0]).toMatchObject({ ok: false, step: 'openMenu', selectorVersion: expect.any(String) });
    expect(notice.mock.calls.map(([n]) => [n.kind, n.count])).toEqual([
      ['failureNativeAction', 1],
      ['failureNativeAction', 2],
      ['failureNativeAction', 3],
    ]);
    expect(overlayRoot()?.querySelectorAll('.notice')).toHaveLength(1);
    expect(overlayRoot()?.querySelector('.notice')?.textContent).not.toMatch(/paused/i);
    expect(e.bg.of('reportMarkupCheck')).toContainEqual({ ok: false, selectorVersion: expect.any(String), missing: ['dropdown'] });
    expect(tilesOf('FIXTURE0006').map((t) => e.ui.kindOf(t))).toEqual([undefined]);
  });

  it('a tab hidden while the menu opens: the job is stale, nothing is reported, and it runs again once visible', async () => {
    const e = start({ mode: 'auto' }, { neverOpen: true });
    e.bg.outcomes.set('FIXTURE0006', { ruleId: 'r1' });
    await e.showAll();
    await vi.advanceTimersByTimeAsync(400); // the menu button was clicked
    expect(opens(e)).toEqual(['open@FIXTURE0006']);
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(3000);
    expect(e.bg.of('reportActionResult')).toEqual([]);
    expect(e.bg.of('reportMarkupCheck').some((r) => r.missing?.includes('dropdown'))).toBe(false);
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(opens(e)).toEqual(['open@FIXTURE0006', 'open@FIXTURE0006']); // re-queued while the Verdict holds
  });

  it('hidden tabs: actions wait until the tab is visible', async () => {
    const e = start({ mode: 'auto' });
    e.bg.outcomes.set('FIXTURE0006', { ruleId: 'r1' });
    hidden = true;
    await e.showAll();
    await vi.advanceTimersByTimeAsync(3000);
    expect(opens(e)).toEqual([]);
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(opens(e)).toEqual(['open@FIXTURE0006']);
  });
});

describe('the playing video is never acted on (REQ-SURF-3)', () => {
  /** A watch-to-watch navigation: the URL and the player's video-id change, the page elements stay. */
  const play = (videoId: string) => {
    history.replaceState(null, '', `/watch?v=${videoId}`);
    document.querySelector('ytd-watch-flexy')?.setAttribute('video-id', videoId);
  };

  it('a judge reply that lands after a watch-to-watch navigation to that video does not act on it', async () => {
    const e = start({ mode: 'auto' });
    e.bg.outcomes.set('FIXTURE0006', { ruleId: 'r1' });
    e.bg.outcomes.set('FIXTURE0007', { ruleId: 'r1' });
    e.bg.hold = true;
    await e.showAll();
    play('FIXTURE0006'); // the user opened FIXTURE0006, the page element stays
    e.bg.release();
    await vi.advanceTimersByTimeAsync(3000);
    expect(opens(e)).not.toContain('open@FIXTURE0006');
    expect(e.kinds('FIXTURE0006')).toEqual([undefined]);
  });

  it('a queued job whose video started playing is dropped right before the menu opens', async () => {
    const e = start({ mode: 'auto' });
    e.bg.outcomes.set('FIXTURE0006', { ruleId: 'r1' });
    hidden = true; // the job waits in the queue
    await e.showAll();
    await vi.advanceTimersByTimeAsync(1000);
    play('FIXTURE0006');
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(3000);
    expect(opens(e)).toEqual([]);
  });

  it('a queued job is dropped when the URL changed although the page element stayed', async () => {
    const e = start({ mode: 'review' });
    e.bg.outcomes.set('FIXTURE0007', { ruleId: 'r1' });
    hidden = true;
    await e.showAll();
    const [el] = tilesOf('FIXTURE0007');
    click(e.shadowOf(el!), 'button.solid');
    await vi.advanceTimersByTimeAsync(500);
    history.replaceState(null, '', '/?other=1');
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(opens(e)).toEqual([]);
  });
});

describe('Mode transitions (architecture.md Section 5 table)', () => {
  const removes = (e: Env) => {
    e.bg.outcomes.set('FIXTURE0006', { ruleId: 'r1' });
    e.bg.outcomes.set('FIXTURE0007', { ruleId: 'r2' });
  };

  it('Review → Dry-run: chips become labels, new Tiles get labels', async () => {
    const e = start({ mode: 'review' });
    removes(e);
    await e.showAll();
    e.broadcast({ mode: 'dryRun' });
    expect([...e.kinds('FIXTURE0006'), ...e.kinds('FIXTURE0007')]).toEqual(['label', 'label']);
    expect(e.bg.of('recordWouldRemove')).toHaveLength(1);
    e.bg.outcomes.set('FIXTURE0011', { ruleId: 'r1' });
    const [added] = await more(e);
    await vi.advanceTimersByTimeAsync(400);
    expect(e.ui.kindOf(added!)).toBe('label');
  });

  it('Review → Dry-run: queued Removes the user clicked are cancelled unless already clicking; their chips become labels', async () => {
    const e = start({ mode: 'review' });
    removes(e);
    await e.showAll();
    hidden = true; // the clicked Removes wait in the queue
    for (const id of ['FIXTURE0006', 'FIXTURE0007']) click(e.shadowOf(tilesOf(id)[0]!), 'button.solid');
    await vi.advanceTimersByTimeAsync(500);
    e.broadcast({ mode: 'dryRun' });
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(3000);
    expect(opens(e)).toEqual([]);
    expect(e.bg.of('reportActionResult')).toEqual([]);
    expect([...e.kinds('FIXTURE0006'), ...e.kinds('FIXTURE0007')]).toEqual(['label', 'label']);
  });

  it('Dry-run → Review: labels become chips', async () => {
    const e = start({ mode: 'dryRun' });
    removes(e);
    await e.showAll();
    e.broadcast({ mode: 'review' });
    expect([...e.kinds('FIXTURE0006'), ...e.kinds('FIXTURE0007')]).toEqual(['chip', 'chip']);
    await vi.advanceTimersByTimeAsync(0);
    expect(e.bg.of('reviewPending').at(-1)).toEqual({ count: 2 });
  });

  it('Review → Auto: chips stay, new Tiles are acted on', async () => {
    const e = start({ mode: 'review' });
    removes(e);
    await e.showAll();
    e.broadcast({ mode: 'auto' });
    await vi.advanceTimersByTimeAsync(2000);
    expect([...e.kinds('FIXTURE0006'), ...e.kinds('FIXTURE0007')]).toEqual(['chip', 'chip']);
    expect(opens(e)).toEqual([]);
    e.bg.outcomes.set('FIXTURE0011', { ruleId: 'r1' });
    await more(e);
    await vi.advanceTimersByTimeAsync(1500);
    expect(opens(e)).toEqual(['open@FIXTURE0011']);
  });

  it('Review → Auto confirmed in the popup ("Remove the N flagged videos now?"): showing chips are acted on', async () => {
    const e = start({ mode: 'review' });
    removes(e);
    const els = [...tilesOf('FIXTURE0006'), ...tilesOf('FIXTURE0007')];
    await e.showAll();
    e.bg.state = { ...e.bg.state, mode: 'auto', settingsGeneration: 2 };
    e.p.settingsChanged({ settingsGeneration: 2, rulesVersion: 'rv1', actOnShowingChips: true });
    e.p.apply(e.bg.state);
    await vi.advanceTimersByTimeAsync(3000);
    expect(opens(e).sort()).toEqual(['open@FIXTURE0006', 'open@FIXTURE0007']);
    expect(els.map((el) => e.ui.kindOf(el))).toEqual(['annotation', 'annotation']);
  });

  it('Dry-run → Auto: labels withdrawn, nothing acted retroactively, new Tiles acted on', async () => {
    const e = start({ mode: 'dryRun' });
    removes(e);
    await e.showAll();
    e.broadcast({ mode: 'auto' });
    expect([...e.kinds('FIXTURE0006'), ...e.kinds('FIXTURE0007')]).toEqual([undefined, undefined]);
    // A later settingsChanged re-judges them: still nothing acted for the withdrawn labels.
    e.p.settingsChanged({ settingsGeneration: 1, rulesVersion: 'rv1' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(opens(e)).toEqual([]);
    e.bg.outcomes.set('FIXTURE0011', { ruleId: 'r1' });
    await more(e);
    await vi.advanceTimersByTimeAsync(1500);
    expect(opens(e)).toEqual(['open@FIXTURE0011']);
  });

  it('Auto → Review: queued actions are cancelled unless already clicking, their Tiles get chips', async () => {
    const e = start({ mode: 'auto' });
    for (const id of ['FIXTURE0006', 'FIXTURE0007', 'FIXTURE0008', 'FIXTURE0009']) e.bg.outcomes.set(id, { ruleId: 'r1' });
    const [first] = tilesOf('FIXTURE0006');
    await e.showAll();
    await vi.advanceTimersByTimeAsync(10); // the first job is clicking the menu
    expect(opens(e)).toEqual(['open@FIXTURE0006']);
    e.broadcast({ mode: 'review' });
    await vi.advanceTimersByTimeAsync(3000);
    expect(opens(e)).toEqual(['open@FIXTURE0006']);
    expect(e.ui.kindOf(first!)).toBe('annotation');
    expect([...e.kinds('FIXTURE0007'), ...e.kinds('FIXTURE0008'), ...e.kinds('FIXTURE0009')]).toEqual(['chip', 'chip', 'chip']);
  });

  it('Auto → Dry-run: queued actions are cancelled, their Tiles get labels', async () => {
    const e = start({ mode: 'auto' });
    for (const id of ['FIXTURE0006', 'FIXTURE0007']) e.bg.outcomes.set(id, { ruleId: 'r1' });
    await e.showAll();
    await vi.advanceTimersByTimeAsync(10);
    e.broadcast({ mode: 'dryRun' });
    await vi.advanceTimersByTimeAsync(3000);
    expect(opens(e)).toEqual(['open@FIXTURE0006']);
    expect(e.kinds('FIXTURE0007')).toEqual(['label']);
  });

  it('Auto → Review with duplicate copies queued: every copy of a cancelled video gets a chip', async () => {
    const e = start({ mode: 'auto' });
    e.bg.outcomes.set('FIXTURE0001', { ruleId: 'r1' }); // two Home copies, acted first
    e.bg.outcomes.set('FIXTURE0002', { ruleId: 'r1' }); // on Home and on the Shorts shelf, queued second
    const [a1, a2] = tilesOf('FIXTURE0001');
    await e.showAll();
    await vi.advanceTimersByTimeAsync(10);
    expect(opens(e)).toEqual(['open@FIXTURE0001']);
    e.broadcast({ mode: 'review' });
    await vi.advanceTimersByTimeAsync(3000);
    expect(opens(e)).toEqual(['open@FIXTURE0001']);
    expect([e.ui.kindOf(a1!), e.ui.kindOf(a2!)]).toEqual(['annotation', 'duplicate']);
    expect(e.kinds('FIXTURE0002')).toEqual(['chip', 'chip']);
  });

  it('Auto with queued actions and a settingsChanged: every Tile is re-judged and acted on', async () => {
    const e = start({ mode: 'auto' });
    const els = ['FIXTURE0006', 'FIXTURE0007', 'FIXTURE0008'].flatMap((id) => (e.bg.outcomes.set(id, { ruleId: 'r1' }), tilesOf(id)));
    await e.showAll();
    await vi.advanceTimersByTimeAsync(10);
    e.bg.state = { ...e.bg.state, settingsGeneration: 2 };
    e.p.settingsChanged({ settingsGeneration: 2, rulesVersion: 'rv1' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(opens(e).sort()).toEqual(['open@FIXTURE0006', 'open@FIXTURE0007', 'open@FIXTURE0008']);
    expect(els.map((el) => e.ui.kindOf(el))).toEqual(['annotation', 'annotation', 'annotation']);
  });

  it('the Native action breaker tripping mid-queue: queued Tiles get Dry-run labels', async () => {
    const e = start({ mode: 'auto' });
    for (const id of ['FIXTURE0006', 'FIXTURE0007']) e.bg.outcomes.set(id, { ruleId: 'r1' });
    await e.showAll();
    await vi.advanceTimersByTimeAsync(10);
    e.broadcast({ reason: 'breakerNativeAction', stages: { exact: true, model: true, nativeActions: false, ui: true }, eye: 'error' });
    await vi.advanceTimersByTimeAsync(3000);
    expect(opens(e)).toEqual(['open@FIXTURE0006']);
    expect(e.kinds('FIXTURE0007')).toEqual(['label']);
    expect(overlayRoot()?.querySelector('.notice')?.textContent).toMatch(/paused/i);
  });

  it('a judgeTiles reply whose snapshot changed the Mode gates its Tiles in that Mode', async () => {
    const e = start({ mode: 'review' });
    e.bg.outcomes.set('FIXTURE0006', { ruleId: 'r1' });
    e.bg.state = { ...e.bg.state, mode: 'auto', settingsGeneration: 2 }; // the broadcast has not arrived yet
    await e.showAll();
    await vi.advanceTimersByTimeAsync(1000);
    expect(opens(e)).toEqual(['open@FIXTURE0006']);
  });

  it('a snapshot from an older settings generation is ignored', async () => {
    const e = start({ mode: 'review', settingsGeneration: 3 });
    e.p.apply(snapshot({ enabled: false, reason: 'off', settingsGeneration: 2, stages: { exact: false, model: false, nativeActions: false, ui: false } }));
    expect(e.p.running).toBe(true);
  });

  it('turning Shoo off while a job is clicking: the Removal is still reported, without UI or an Undo watch', async () => {
    const e = start({ mode: 'auto' });
    e.bg.outcomes.set('FIXTURE0006', { ruleId: 'r1' });
    const [el] = tilesOf('FIXTURE0006');
    await e.showAll();
    await vi.advanceTimersByTimeAsync(10); // menu button clicked
    e.p.apply({ ...OFF, settingsGeneration: 2 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(e.bg.of('reportActionResult')).toEqual([expect.objectContaining({ ok: true, videoId: 'FIXTURE0006' })]);
    expect(shooHosts()).toBe(0);
    (el!.querySelector('.ytNotificationMultiActionRendererButtonContainer button') as HTMLElement).click();
    await vi.advanceTimersByTimeAsync(100);
    expect(e.bg.of('reportUndo')).toEqual([]);
  });

  it('any → Off (toggle-shoo): all UI unmounted, queued actions cancelled, observers disconnected within 1 s', async () => {
    const e = start({ mode: 'auto' });
    for (const id of ['FIXTURE0006', 'FIXTURE0007', 'FIXTURE0008']) e.bg.outcomes.set(id, { ruleId: 'r1' });
    e.bg.outcomes.set('FIXTURE0102', { ruleId: 'r1' });
    await e.showAll();
    await vi.advanceTimersByTimeAsync(800); // one removed (annotation + summary), others queued
    expect(shooHosts()).toBeGreaterThan(0);
    e.p.apply(OFF); // the background flipped settings.enabled and broadcast runtimeStateChanged
    expect(shooHosts()).toBe(0);
    expect(e.p.running).toBe(false);
    const before = opens(e).length;
    const calls = e.bg.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(opens(e)).toHaveLength(before);
    await more(e);
    await vi.advanceTimersByTimeAsync(1000);
    expect(e.io.observed()).toEqual([]);
    expect(e.bg.calls.slice(calls).map((c) => c.type)).toEqual([]);
    // Toggle back on: the visible Tiles are judged again.
    e.p.apply(snapshot({ mode: 'review' }));
    e.io.trigger(true);
    await vi.advanceTimersByTimeAsync(400);
    expect(e.bg.of('judgeTiles').length).toBeGreaterThan(1);
  });
});

describe('Runtime states and notices', () => {
  it('model failure: one pre-trip notice for the streak, then the trip replaces it (exactly one notice showing)', async () => {
    const e = start({ mode: 'review' });
    const notice = vi.spyOn(e.ui, 'notice');
    for (const id of ['FIXTURE0006', 'FIXTURE0007']) e.bg.outcomes.set(id, { undecided: 'modelError' });
    await e.showAll();
    for (let gen = 2; gen <= 5; gen++) {
      if (gen === 5) e.bg.state = { ...e.bg.state, reason: 'breakerModel', stages: { exact: true, model: false, nativeActions: true, ui: true }, eye: 'error' };
      e.bg.state = { ...e.bg.state, settingsGeneration: gen };
      e.p.settingsChanged({ settingsGeneration: gen, rulesVersion: 'rv1' });
      await vi.advanceTimersByTimeAsync(400);
    }
    expect(e.bg.of('judgeTiles')).toHaveLength(5);
    expect(notice.mock.calls.map(([n]) => n.kind)).toEqual(['failureModel', 'breakerModel']);
    expect(overlayRoot()?.querySelectorAll('.notice')).toHaveLength(1);
    expect(overlayRoot()?.querySelector('.notice')?.textContent).toMatch(/paused/i);
    // Retry resumes the model category through the background.
    e.bg.state = { ...e.bg.state, reason: 'ok', stages: { exact: true, model: true, nativeActions: true, ui: true } };
    act(() => (overlayRoot()?.querySelector('.notice button.btn') as HTMLElement).click());
    await vi.advanceTimersByTimeAsync(0);
    expect(e.bg.of('resumeFromBreaker')).toEqual([{ category: 'model' }]);
    expect(overlayRoot()?.querySelectorAll('.notice')).toHaveLength(0);
    // A new streak after Resume gets its own pre-trip notice.
    e.bg.state = { ...e.bg.state, settingsGeneration: 6 };
    e.p.settingsChanged({ settingsGeneration: 6, rulesVersion: 'rv1' });
    await vi.advanceTimersByTimeAsync(400);
    expect(notice.mock.calls.map(([n]) => n.kind)).toEqual(['failureModel', 'breakerModel', 'failureModel']);
  });

  it('a pre-trip notice says nothing about pausing and clears when the model answers again', async () => {
    const e = start({ mode: 'review' });
    e.bg.outcomes.set('FIXTURE0006', { undecided: 'rateLimited' });
    await e.showAll();
    expect(overlayRoot()?.querySelector('.notice')?.textContent).not.toMatch(/paused/i);
    e.bg.outcomes.set('FIXTURE0006', { ruleId: 'r1', source: 'model', p: 0.9 });
    e.p.settingsChanged({ settingsGeneration: 1, rulesVersion: 'rv1' });
    await vi.advanceTimersByTimeAsync(400);
    expect(overlayRoot()?.querySelectorAll('.notice')).toHaveLength(0);
  });

  it('Daily cap: Exact rules keep working, model Tiles stay undecided with no in-page notice, judged again on a new day', async () => {
    const e = start({ mode: 'review', reason: 'dailyCap', stages: { exact: true, model: false, nativeActions: true, ui: true }, eye: 'paused' });
    const notice = vi.spyOn(e.ui, 'notice');
    for (const id of ['FIXTURE0002', 'FIXTURE0007', 'FIXTURE0101']) e.bg.outcomes.set(id, { undecided: 'dailyCap' });
    e.bg.outcomes.set('FIXTURE0006', { ruleId: 'r1', source: 'exact' });
    await e.showAll();
    expect(e.kinds('FIXTURE0006')).toEqual(['chip']);
    expect(e.kinds('FIXTURE0007')).toEqual([undefined]);
    expect(notice).not.toHaveBeenCalled();
    // Local midnight: the background broadcasts the state without the cap.
    e.bg.outcomes.set('FIXTURE0007', { ruleId: 'r2', source: 'model', p: 0.9 });
    e.broadcast({ reason: 'ok', stages: { exact: true, model: true, nativeActions: true, ui: true }, eye: 'watching' });
    await vi.advanceTimersByTimeAsync(400);
    expect(e.bg.of('judgeTiles')).toHaveLength(2);
    const resent = judgedIds(e);
    expect(resent).toContain('FIXTURE0007');
    expect(resent).not.toContain('FIXTURE0006'); // already decided and chipped
    expect(e.kinds('FIXTURE0007')).toEqual(['chip']);
  });

  it('markup breaker: content stops extracting and shows only the notice', async () => {
    const e = start({ mode: 'review' });
    e.bg.outcomes.set('FIXTURE0006', { ruleId: 'r1' });
    await e.showAll();
    e.broadcast({ reason: 'breakerMarkup', stages: { exact: false, model: false, nativeActions: false, ui: true }, eye: 'error' });
    expect(e.kinds('FIXTURE0006')).toEqual([undefined]);
    expect(overlayRoot()?.querySelector('.notice')?.textContent).toMatch(/paused/i);
    const calls = e.bg.of('judgeTiles').length;
    await more(e);
    await vi.advanceTimersByTimeAsync(1000);
    expect(e.bg.of('judgeTiles')).toHaveLength(calls);
    act(() => (overlayRoot()?.querySelector('.notice button.btn') as HTMLElement).click());
    expect(e.bg.of('openSettings')).toEqual([{}]);
  });

  it('theme: every Shoo host follows html[dark] live', async () => {
    const e = start({ mode: 'review' });
    e.bg.outcomes.set('FIXTURE0006', { ruleId: 'r1' });
    await e.showAll();
    const [el] = tilesOf('FIXTURE0006');
    expect(e.ui.hostOf(el!)?.hasAttribute('data-dark')).toBe(false);
    document.documentElement.setAttribute('dark', '');
    await e.settle();
    expect(e.ui.hostOf(el!)?.hasAttribute('data-dark')).toBe(true);
    document.documentElement.removeAttribute('dark');
  });

  it('navigation resets per-page state: Undo of the old page is no longer possible', async () => {
    const e = start({ mode: 'auto' });
    e.bg.outcomes.set('FIXTURE0006', { ruleId: 'r1' });
    await e.showAll();
    await vi.advanceTimersByTimeAsync(1000);
    expect(opens(e)).toEqual(['open@FIXTURE0006']);
    await navigate(e);
    expect(await e.p.undoRemoval({ videoId: 'FIXTURE0006' })).toEqual({ ok: false, reason: 'notFound' });
  });
});

describe('Shelf dismissal (youtube-integration.md Section 10)', () => {
  /** The Home page's first Shorts shelf, given a SYNTHETIC menu button that offers "Show fewer Shorts". */
  function shortsShelfWithMenu(e: Env) {
    const shelf = grid().querySelector('ytd-rich-shelf-renderer[is-shorts]') as Element;
    wireShelf(e.sim, shelf, addSyntheticShelfControl(shelf, 'menu'), 'Show fewer Shorts');
    return shelf;
  }

  it.each(['auto', 'review'] as const)('in %s, a switched-on Shelf is dismissed once and recorded', async (mode) => {
    const e = start({ mode });
    shortsShelfWithMenu(e);
    e.broadcast({ shelfDismissal: { shorts: true }, settingsGeneration: 2 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(e.sim.log.filter((l) => l === 'shelfDismissed')).toHaveLength(1);
    expect(e.bg.of('reportShelfDismissal')).toEqual([{ shelf: 'shorts' }]);
  });

  it("after YouTube's Undo, a Mode round trip on the same page does not dismiss the Shelf again", async () => {
    const e = start({ mode: 'auto', shelfDismissal: { shorts: true } });
    const shelf = shortsShelfWithMenu(e);
    await vi.advanceTimersByTimeAsync(3000);
    expect(e.sim.log.filter((l) => l === 'shelfDismissed')).toHaveLength(1);
    // YouTube's Undo brings the Shelf back.
    shelf.closest('ytd-rich-section-renderer')?.querySelector('notification-multi-action-renderer')?.remove();
    shelf.querySelector('#dismissible')?.removeAttribute('hidden');
    e.broadcast({ mode: 'dryRun', settingsGeneration: 2 });
    e.broadcast({ mode: 'review', settingsGeneration: 3 });
    await vi.advanceTimersByTimeAsync(6000);
    expect(e.sim.log.filter((l) => l === 'shelfDismissed')).toHaveLength(1);
  });

  it('does nothing in Dry-run, or while the Shelf is switched off', async () => {
    const e = start({ mode: 'dryRun', shelfDismissal: { shorts: true } });
    shortsShelfWithMenu(e);
    await vi.advanceTimersByTimeAsync(3000);
    e.broadcast({ mode: 'auto', shelfDismissal: { shorts: false }, settingsGeneration: 2 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(e.sim.log).not.toContain('open@shelf');
    expect(e.bg.of('reportShelfDismissal')).toEqual([]);
  });
});

