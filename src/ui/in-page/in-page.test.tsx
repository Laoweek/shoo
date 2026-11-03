// @vitest-environment jsdom
import '../test/catalogue';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hideNotice,
  installKeyContainment,
  playMoment,
  removeOverlay,
  renderAnnotation,
  renderChip,
  renderLabel,
  showNotice,
  showSummary,
  unmount,
  type ChipProps,
  type SummaryData,
} from './index';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

afterEach(() => {
  act(() => removeOverlay());
  vi.useRealTimers();
  document.body.innerHTML = '';
});

function shadow(): ShadowRoot {
  const host = document.createElement('shoo-chip-host');
  document.body.append(host);
  return host.attachShadow({ mode: 'open' });
}

function chipProps(over: Partial<ChipProps> = {}): ChipProps {
  return {
    variant: 'full',
    ruleRef: 'R1',
    colour: 'c1',
    ruleText: 'Reaction videos',
    probability: 0.88,
    hasChannel: true,
    onRemove: vi.fn(),
    onKeep: vi.fn(),
    onAlwaysKeepChannel: vi.fn(),
    onEscape: vi.fn(),
    onNoteDone: vi.fn(),
    ...over,
  };
}

const buttons = (root: ParentNode) => [...root.querySelectorAll('button')];
const names = (root: ParentNode) => buttons(root).map((b) => b.getAttribute('aria-label') ?? b.textContent);

describe('module load', () => {
  it('does no DOM work at import time', async () => {
    vi.resetModules();
    const before = document.body.childElementCount;
    await import('./index');
    expect(document.body.childElementCount).toBe(before);
    expect(document.querySelector('shoo-summary-host')).toBeNull();
  });
});

describe('Review chip', () => {
  it('full variant carries the whole accessible name and named buttons', () => {
    const root = shadow();
    act(() => renderChip(root, chipProps()));
    const group = root.querySelector('[role="group"]')!;
    expect(group.getAttribute('aria-label')).toBe('Shoo: Remove? Rule: Reaction videos, 88 percent');
    expect(names(root)).toEqual(['Remove this video', 'Keep this video']);
    expect(group.textContent).toBe('Remove?Reaction videos88%RemoveKeep'); // the Rule by its label, never its ref
  });

  it('compact variant has the same accessible name and icon-only buttons with names', () => {
    const root = shadow();
    act(() => renderChip(root, chipProps({ variant: 'compact' })));
    expect(root.querySelector('[role="group"]')!.getAttribute('aria-label')).toBe('Shoo: Remove? Rule: Reaction videos, 88 percent');
    expect(names(root)).toEqual(['Remove this video', 'Keep this video']);
    expect(buttons(root).every((b) => b.textContent === '')).toBe(true);
    // Swatch and label, hidden from screen readers (the group's name says it).
    const tag = root.querySelector('.tag')!;
    expect(tag.getAttribute('aria-hidden')).toBe('true');
    expect(tag.textContent).toBe('Reaction videos');
  });

  it('names Exact-rule Verdicts without a percentage and leaves a long Rule text whole for CSS to cut, with a tooltip', () => {
    const root = shadow();
    const long = 'Reaction videos where someone watches and reacts';
    act(() => renderChip(root, chipProps({ probability: undefined, ruleText: long })));
    expect(root.querySelector('[role="group"]')!.getAttribute('aria-label')).toBe(`Shoo: Remove? Rule: ${long}`);
    expect(root.querySelector('.what .lb')!.textContent).toBe(long);
    expect(root.querySelector('.what .tag')!.getAttribute('title')).toBe(long);
    expect(root.querySelector('.cut')).toBeNull();
  });

  it('names the Rule by its name when it has one, with the full Rule text as the tooltip, in both variants', () => {
    const text = 'Videos about cryptocurrency, trading or get-rich-quick schemes';
    for (const variant of ['full', 'compact'] as const) {
      const root = shadow();
      act(() => renderChip(root, chipProps({ variant, ruleRef: 'R2', colour: 'c2', ruleName: 'Crypto & trading', ruleText: text })));
      expect(root.querySelector('[role="group"]')!.getAttribute('aria-label')).toBe('Shoo: Remove? Rule: Crypto & trading, 88 percent');
      const tag = root.querySelector('.tag')!;
      expect(tag.getAttribute('title')).toBe(text);
      expect(tag.querySelector('.lb')!.textContent).toBe('Crypto & trading');
      expect(tag.querySelector('.lb')!.getAttribute('dir')).toBe('auto'); // its own bidi run
      // The swatch keeps the ref the moment lands on, but the ref never shows.
      expect(tag.querySelector('.sw')!.getAttribute('data-ref')).toBe('R2');
      expect(root.textContent).not.toContain('R2');
    }
  });

  it('falls back to the Rule text when the name is blank, and to the ref when there is no display data at all', () => {
    const root = shadow();
    act(() => renderChip(root, chipProps({ ruleName: '  ', ruleText: 'Reaction videos' })));
    expect(root.querySelector('.lb')!.textContent).toBe('Reaction videos');
    // pipeline.ts ruleOf: a Verdict whose Rule the background sent no display data for carries its ref as the text.
    act(() => renderChip(root, chipProps({ ruleRef: 'R7', ruleName: undefined, ruleText: 'R7' })));
    expect(root.querySelector('.lb')!.textContent).toBe('R7');
    expect(root.querySelector('[role="group"]')!.getAttribute('aria-label')).toBe('Shoo: Remove? Rule: R7, 88 percent');
  });

  it('calls onRemove, and onEscape on Esc', () => {
    const root = shadow();
    const props = chipProps();
    act(() => renderChip(root, props));
    act(() => buttons(root)[0]!.click());
    expect(props.onRemove).toHaveBeenCalledOnce();
    buttons(root)[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    expect(props.onEscape).toHaveBeenCalledOnce();
  });

  it('after Keep shows the note for 4 s with the channel button, then reports done', () => {
    vi.useFakeTimers();
    const root = shadow();
    const props = chipProps();
    act(() => renderChip(root, props));
    act(() => buttons(root)[1]!.click());
    expect(props.onKeep).toHaveBeenCalledOnce();
    expect(root.textContent).toContain("Kept · won't ask again");
    expect(buttons(root).map((b) => b.textContent)).toEqual(['Always keep this channel']);
    act(() => buttons(root)[0]!.click());
    expect(props.onAlwaysKeepChannel).toHaveBeenCalledOnce();
    act(() => void vi.advanceTimersByTime(3999));
    expect(props.onNoteDone).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(props.onNoteDone).toHaveBeenCalledOnce();
  });

  it('hides the channel button without a channel, and says "Kept for this session" in a private window', () => {
    const a = shadow();
    act(() => renderChip(a, chipProps({ hasChannel: false })));
    act(() => buttons(a)[1]!.click());
    expect(buttons(a)).toHaveLength(0);

    const b = shadow();
    act(() => renderChip(b, chipProps({ privateWindow: true })));
    act(() => buttons(b)[1]!.click());
    expect(b.textContent).toContain('Kept for this session');
    expect(buttons(b)).toHaveLength(0);
  });

  it('compact kept note: "Kept" on one row, the full sentence for screen readers, the channel action as a named icon button', () => {
    const root = shadow();
    const props = chipProps({ variant: 'compact' });
    act(() => renderChip(root, props));
    act(() => buttons(root)[1]!.click());
    const note = root.querySelector('[role="status"]')!;
    expect(note.classList.contains('compact')).toBe(true);
    expect(note.querySelector('.sr')?.textContent).toBe("Kept · won't ask again");
    expect(note.querySelector('.note > [aria-hidden="true"]')?.textContent).toBe('Kept');
    const [channel] = buttons(root);
    expect(channel!.classList.contains('ib')).toBe(true);
    expect(channel!.getAttribute('aria-label')).toBe('Always keep this channel');
    expect(channel!.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    act(() => channel!.click());
    expect(props.onAlwaysKeepChannel).toHaveBeenCalledOnce();

    const priv = shadow();
    act(() => renderChip(priv, chipProps({ variant: 'compact', privateWindow: true })));
    act(() => buttons(priv)[1]!.click());
    expect(priv.querySelector('.sr')?.textContent).toBe('Kept for this session');
    expect(buttons(priv)).toHaveLength(0);
  });

  it('unmount removes everything Shoo rendered', () => {
    const root = shadow();
    act(() => renderChip(root, chipProps()));
    act(() => unmount(root));
    expect(root.querySelector('[data-shoo-mount]')).toBeNull();
    expect(buttons(root)).toHaveLength(0);
  });
});

describe('keyboard containment', () => {
  it('a keydown inside a Shoo shadow root never reaches the document', () => {
    const root = shadow();
    act(() => renderChip(root, chipProps()));
    const onDocument = vi.fn();
    document.addEventListener('keydown', onDocument);
    buttons(root)[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true, composed: true }));
    document.removeEventListener('keydown', onDocument);
    expect(onDocument).not.toHaveBeenCalled();
  });

  it('is idempotent and also works on a bare root', () => {
    const root = shadow();
    installKeyContainment(root);
    installKeyContainment(root);
    const input = document.createElement('input');
    root.append(input);
    const onDocument = vi.fn();
    document.addEventListener('keyup', onDocument);
    input.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true, composed: true }));
    document.removeEventListener('keyup', onDocument);
    expect(onDocument).not.toHaveBeenCalled();
  });
});

describe('Dry-run label', () => {
  it('is passive: nothing focusable, full sentence in reading order', () => {
    const root = shadow();
    act(() => renderLabel(root, { variant: 'full', ruleRef: 'R3', colour: 'c3', ruleText: 'Celebrity gossip' }));
    expect(root.querySelectorAll('button, a, input, [tabindex]')).toHaveLength(0);
    expect(root.querySelector('.sr')!.textContent).toBe('Shoo would remove this video, Rule: Celebrity gossip');
    expect(root.querySelector('[aria-describedby]')).toBeNull();
    const visible = [...root.querySelectorAll('[aria-hidden="true"]:not(svg)')].map((n) => n.textContent).join('');
    expect(visible).toBe('Would remove ·Celebrity gossip');
  });

  it('compact shows only the swatch and the Rule label, its name when it has one', () => {
    const root = shadow();
    act(() => renderLabel(root, { variant: 'compact', ruleRef: 'R3', ruleText: 'Celebrity gossip and tabloid drama', ruleName: 'Gossip' }));
    expect(root.querySelector('.label.compact')).not.toBeNull();
    const visible = [...root.querySelectorAll('[aria-hidden="true"]:not(svg)')].map((n) => n.textContent).join('');
    expect(visible).toBe('Gossip');
    expect(root.querySelector('.tag')!.getAttribute('title')).toBe('Celebrity gossip and tabloid drama');
    expect(root.querySelector('.sr')!.textContent).toBe('Shoo would remove this video, Rule: Gossip');
  });
});

describe('Removed-Tile annotation', () => {
  const base = { ruleRef: 'R2', colour: 'c2' as const, ruleText: 'Crypto', onKeep: vi.fn(), onAlwaysKeepChannel: vi.fn() };

  it('offers Keep and Always keep this channel', () => {
    const root = shadow();
    act(() => renderAnnotation(root, { ...base, hasChannel: true }));
    expect(root.textContent).toContain('Shooed by');
    expect(buttons(root).map((b) => b.textContent)).toEqual(['Keep', 'Always keep this channel']);
    // Narrow placeholders show the channel action as its icon: the name never depends on the visible text.
    const ch = buttons(root)[1]!;
    expect(ch.getAttribute('aria-label')).toBe('Always keep this channel');
    expect(ch.querySelector('.ib svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('on YouTube\'s "Don\'t recommend channel" placeholder says the channel was shooed, visibly and to screen readers', () => {
    const root = shadow();
    act(() => renderAnnotation(root, { ...base, hasChannel: true, channel: true }));
    expect(root.querySelector('.by')?.textContent).toBe('Channel shooed by');
    expect(root.querySelector('.sr')?.textContent).toBe("Shoo: YouTube won't recommend this channel, Rule: Crypto");
  });

  it('names the Rule by its label next to "Shooed by", with the full text as the tooltip and never the ref', () => {
    const root = shadow();
    const text = 'Videos about cryptocurrency, trading or get-rich-quick schemes';
    act(() => renderAnnotation(root, { ...base, ruleName: 'Crypto & trading', ruleText: text, hasChannel: true }));
    const tag = root.querySelector('.tag')!;
    expect(tag.previousElementSibling?.textContent).toBe('Shooed by');
    expect(tag.textContent).toBe('Crypto & trading');
    expect(tag.getAttribute('title')).toBe(text);
    expect(tag.getAttribute('aria-hidden')).toBe('true'); // the sentence names it
    expect(root.querySelector('.sr')?.textContent).toBe('Shoo: removed by Rule: Crypto & trading');
    expect(root.textContent).not.toContain('R2');
    // Without a name the label is the text, and the duplicate note names it the same way.
    act(() => renderAnnotation(root, { ...base, ruleText: text, hasChannel: true, duplicate: true }));
    expect(root.querySelector('.tag')?.textContent).toBe(text);
    expect(root.querySelector('.sr')?.textContent).toBe(`Shoo: already removed above, Rule: ${text}`);
  });

  it('names the removed video on a second line: title, then channel, full text as a tooltip and in the sr sentence', () => {
    const root = shadow();
    const title = 'A very long title about mechanical keyboards that will not fit on one line of a placeholder';
    act(() => renderAnnotation(root, { ...base, hasChannel: true, title, channelName: 'Fixture Channel' }));
    const line = root.querySelector('.vid')!;
    expect([...line.querySelectorAll('bdi')].map((b) => [b.textContent, b.getAttribute('dir'), b.className])).toEqual([
      [title, 'auto', 'nm'],
      ['Fixture Channel', 'auto', 'chn'],
    ]);
    expect(line.getAttribute('title')).toBe(`${title} · Fixture Channel`);
    expect(line.getAttribute('aria-hidden')).toBe('true'); // read once, through the sr sentence
    expect(root.querySelector('.sr')?.textContent).toBe(`Shoo: removed ${title} from Fixture Channel by Rule: Crypto`);
  });

  it('on the "Don\'t recommend channel" placeholder leads with the channel and names it to screen readers', () => {
    const root = shadow();
    act(() => renderAnnotation(root, { ...base, hasChannel: true, channel: true, title: 'Fixture title', channelName: 'Fixture Channel' }));
    expect([...root.querySelectorAll('.vid bdi')].map((b) => [b.textContent, b.className])).toEqual([
      ['Fixture Channel', 'nm chn'],
      ['Fixture title', ''],
    ]);
    expect(root.querySelector('.vid')?.getAttribute('title')).toBe('Fixture Channel · Fixture title');
    expect(root.querySelector('.sr')?.textContent).toBe("Shoo: removed Fixture title, and YouTube won't recommend Fixture Channel, Rule: Crypto");
    expect(root.querySelector('.annot.chan')).not.toBeNull(); // keeps "Channel shooed by" when space is tight
    // Each name the Tile had stays in the sentence.
    act(() => renderAnnotation(root, { ...base, hasChannel: true, channel: true, channelName: 'Fixture Channel' }));
    expect(root.querySelector('.sr')?.textContent).toBe("Shoo: YouTube won't recommend Fixture Channel, Rule: Crypto");
    act(() => renderAnnotation(root, { ...base, hasChannel: true, channel: true, title: 'Fixture title' }));
    expect(root.querySelector('.sr')?.textContent).toBe("Shoo: removed Fixture title, and YouTube won't recommend this channel, Rule: Crypto");
  });

  it('shows the title alone without a channel (Shorts shelf), and no second line without a title or on duplicates', () => {
    const root = shadow();
    act(() => renderAnnotation(root, { ...base, hasChannel: false, title: 'كيف تصنع خبزًا' }));
    expect([...root.querySelectorAll('.vid bdi')].map((b) => b.textContent)).toEqual(['كيف تصنع خبزًا']);
    expect(root.querySelector('.vid .sep')).toBeNull();
    expect(root.querySelector('.vid')?.getAttribute('title')).toBe('كيف تصنع خبزًا');
    act(() => renderAnnotation(root, { ...base, hasChannel: true, title: '  ' }));
    expect(root.querySelector('.vid')).toBeNull();
    expect(root.querySelector('.sr')?.textContent).toBe('Shoo: removed by Rule: Crypto');
    act(() => renderAnnotation(root, { ...base, hasChannel: true, duplicate: true, title: 'Fixture title', channelName: 'Fixture Channel' }));
    expect(root.querySelector('.vid')).toBeNull();
    expect(root.textContent).not.toContain('Fixture');
  });

  it('hides the channel button when the Tile has no channel', () => {
    const root = shadow();
    act(() => renderAnnotation(root, { ...base, hasChannel: false }));
    expect(buttons(root).map((b) => b.textContent)).toEqual(['Keep']);
  });

  it('duplicate copies say "Already shooed above" without actions', () => {
    const root = shadow();
    act(() => renderAnnotation(root, { ...base, hasChannel: true, duplicate: true }));
    expect(root.textContent).toContain('Already shooed above');
    expect(buttons(root)).toHaveLength(0);
    // It sits over a thumbnail, so it carries its own surface (contrast from tokens, not the picture).
    expect(root.querySelector('.annot.dup')).not.toBeNull();
    act(() => renderAnnotation(root, { ...base, hasChannel: true }));
    expect(root.querySelector('.annot.dup')).toBeNull();
  });
});

function summary(over: Partial<SummaryData> = {}): SummaryData {
  return {
    batchId: 'b1',
    count: 4,
    rules: [
      { ruleRef: 'R1', colour: 'c1', ruleText: 'Reaction videos', count: 2 },
      { ruleRef: 'R2', colour: 'c2', ruleText: 'Crypto', count: 1 },
      { ruleRef: 'R5', colour: 'c5', ruleText: 'Hustle Daily', count: 1 },
    ],
    undoAvailable: true,
    onReview: vi.fn(),
    onUndoAll: vi.fn(),
    ...over,
  };
}

const overlayRoot = () => document.querySelector('shoo-summary-host')!.shadowRoot!;
/** The summary's Rule rows as [label, count]. */
const rows = (root: ShadowRoot) => [...root.querySelectorAll('.rules li:not(.more)')].map((li) => [li.querySelector('.lb')?.textContent, li.querySelector('.n')?.textContent]);

describe('Batch summary', () => {
  it('shows plural copy, one row per Rule with its count, both actions, and announces politely', () => {
    vi.useFakeTimers();
    const data = summary();
    act(() => void showSummary(data));
    const root = overlayRoot();
    expect(root.querySelector('h2')!.textContent).toBe('Shooed 4 videos');
    expect(rows(root)).toEqual([
      ['Reaction videos', '×2'],
      ['Crypto', '×1'],
      ['Hustle Daily', '×1'],
    ]);
    expect(root.querySelector('.rules')!.textContent).not.toMatch(/R\d/);
    expect(buttons(root.querySelector('.panel')!).map((b) => b.textContent)).toEqual(['Review', 'Undo all']);
    act(() => void vi.advanceTimersByTime(100));
    expect(root.querySelector('[aria-live="polite"]')!.textContent).toBe(
      'Shoo removed 4 videos: 2 by Reaction videos, 1 by Crypto, 1 by Hustle Daily.',
    );
    act(() => buttons(root.querySelector('.panel')!)[0]!.click());
    expect(data.onReview).toHaveBeenCalledWith('b1');
  });

  it('names each Rule by its label with the full text as its tooltip, most Removals first, then first seen', () => {
    vi.useFakeTimers();
    const text = 'Videos about cryptocurrency, trading or get-rich-quick schemes';
    const rules = [
      { ruleRef: 'R1', colour: 'c1' as const, ruleText: 'Reaction videos', count: 1 },
      { ruleRef: 'R2', colour: 'c2' as const, ruleText: text, ruleName: 'Crypto & trading', count: 2 },
      { ruleRef: 'R5', colour: 'c5' as const, ruleText: 'Hustle Daily', count: 1 },
    ];
    act(() => void showSummary(summary({ rules })));
    const root = overlayRoot();
    expect(rows(root)).toEqual([
      ['Crypto & trading', '×2'],
      ['Reaction videos', '×1'],
      ['Hustle Daily', '×1'],
    ]);
    expect(root.querySelector('.rules .tag')!.getAttribute('title')).toBe(text);
    expect([...root.querySelectorAll('.rules [data-ref]')].map((s) => s.getAttribute('data-ref'))).toEqual(['R2', 'R1', 'R5']);
    expect(root.querySelector('.more')).toBeNull();
    act(() => void vi.advanceTimersByTime(100));
    expect(root.querySelector('[aria-live="polite"]')!.textContent).toBe(
      'Shoo removed 4 videos: 2 by Crypto & trading, 1 by Reaction videos, 1 by Hustle Daily.',
    );
  });

  it('with 4 or more Rules shows the 2 with the most Removals and a "+N more Rules" line, and announces them all', () => {
    vi.useFakeTimers();
    const rules = [
      { ruleRef: 'R1', ruleText: 'Reaction videos', count: 1 },
      { ruleRef: 'R2', ruleText: 'Crypto', count: 3 },
      { ruleRef: 'R4', ruleText: 'Pranks', count: 1 },
      { ruleRef: 'R5', ruleText: 'Hustle Daily', count: 2 },
      { ruleRef: 'R6', ruleText: 'Celebrity gossip', count: 1 },
    ];
    act(() => void showSummary(summary({ count: 8, rules })));
    const root = overlayRoot();
    expect(rows(root)).toEqual([
      ['Crypto', '×3'],
      ['Hustle Daily', '×2'],
    ]);
    const more = root.querySelector('.rules .more')!;
    expect(more.textContent).toBe('+3 more Rules');
    // The moment's squares for the folded Rules land on the spot in line with the swatches.
    expect(more.querySelector('.sw')!.getAttribute('data-refs')).toBe('R1 R4 R6');
    act(() => void vi.advanceTimersByTime(100));
    expect(root.querySelector('[aria-live="polite"]')!.textContent).toBe(
      'Shoo removed 8 videos: 3 by Crypto, 2 by Hustle Daily, 1 by Reaction videos, 1 by Pranks, 1 by Celebrity gossip.',
    );
    // Four Rules fold two of them.
    act(() => void showSummary(summary({ count: 7, rules: rules.slice(0, 4) })));
    expect(rows(root)).toHaveLength(2);
    expect(root.querySelector('.rules .more')!.textContent).toBe('+2 more Rules');
  });

  it('uses the singular for one video and hides Undo all when YouTube no longer offers it', () => {
    act(() => void showSummary(summary({ count: 1, rules: [{ ruleRef: 'R2', ruleText: 'Crypto', count: 1 }], undoAvailable: false })));
    const root = overlayRoot();
    expect(root.querySelector('h2')!.textContent).toBe('Shooed 1 video');
    expect(buttons(root.querySelector('.panel')!).map((b) => b.textContent)).toEqual(['Review']);
  });

  it('stays 6 s, collapses to a pill for 30 s, then disappears', () => {
    vi.useFakeTimers();
    act(() => void showSummary(summary()));
    const root = overlayRoot();
    act(() => void vi.advanceTimersByTime(5999));
    expect(root.querySelector('.panel')).not.toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(root.querySelector('.panel')).toBeNull();
    const pill = root.querySelector('.pill')!;
    expect(pill.textContent).toBe('4');
    expect(pill.getAttribute('aria-label')).toBe('Shooed 4 videos. Show the summary');
    act(() => void vi.advanceTimersByTime(29999));
    expect(root.querySelector('.pill')).not.toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(root.querySelector('.pill, .panel')).toBeNull();
  });

  it('pauses while hovered and resumes with the time left', () => {
    vi.useFakeTimers();
    act(() => void showSummary(summary()));
    const root = overlayRoot();
    act(() => void vi.advanceTimersByTime(2000));
    const panel = root.querySelector('.panel')!;
    act(() => void panel.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    act(() => void panel.dispatchEvent(new MouseEvent('mouseenter')));
    act(() => void vi.advanceTimersByTime(20000));
    expect(root.querySelector('.panel')).not.toBeNull();
    act(() => void panel.dispatchEvent(new MouseEvent('mouseleave')));
    act(() => void vi.advanceTimersByTime(3999));
    expect(root.querySelector('.panel')).not.toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(root.querySelector('.pill')).not.toBeNull();
  });

  it('pauses while focused', () => {
    vi.useFakeTimers();
    act(() => void showSummary(summary()));
    const root = overlayRoot();
    act(() => buttons(root.querySelector('.panel')!)[0]!.focus());
    act(() => void vi.advanceTimersByTime(20000));
    expect(root.querySelector('.panel')).not.toBeNull();
  });

  it('updates the open summary instead of stacking, and restarts its timer', () => {
    vi.useFakeTimers();
    act(() => void showSummary(summary()));
    act(() => void vi.advanceTimersByTime(5000));
    act(() => void showSummary(summary({ count: 5 })));
    const root = overlayRoot();
    expect(document.querySelectorAll('shoo-summary-host')).toHaveLength(1);
    expect(root.querySelectorAll('.panel')).toHaveLength(1);
    expect(root.querySelector('h2')!.textContent).toBe('Shooed 5 videos');
    act(() => void vi.advanceTimersByTime(5999));
    expect(root.querySelector('.panel')).not.toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(root.querySelector('.pill')).not.toBeNull();
    act(() => void showSummary(summary({ count: 6 })));
    expect(root.querySelector('.panel h2')!.textContent).toBe('Shooed 6 videos');
  });
});

describe('the moment', () => {
  const rect = { left: 10, top: 10, width: 300, height: 170 };
  const sources = Array.from({ length: 15 }, (_, i) => ({ rect, colour: 'c1' as const, ruleRef: i % 2 ? 'R1' : 'R2' }));

  function withMatchMedia(reduce: boolean) {
    window.matchMedia = ((q: string) => ({ matches: reduce && q.includes('reduce') })) as unknown as typeof window.matchMedia;
  }
  afterEach(() => {
    delete (window as { matchMedia?: unknown }).matchMedia;
    delete (Element.prototype as { animate?: unknown }).animate;
  });

  it('under reduced motion flies nothing and reports every arrival at once', async () => {
    withMatchMedia(true);
    const animate = vi.fn();
    (Element.prototype as { animate?: unknown }).animate = animate;
    const target = document.createElement('div');
    document.body.append(target);
    const arrived: number[] = [];
    await playMoment(sources, target, { onArrive: (i) => arrived.push(i) });
    expect(animate).not.toHaveBeenCalled();
    expect(document.querySelector('.sq')).toBeNull();
    expect(arrived).toHaveLength(12);
  });

  it('flies at most 12 squares with transforms, staggered 40 ms, 560 ms each', async () => {
    withMatchMedia(false);
    const calls: { frames: Keyframe[]; timing: KeyframeAnimationOptions }[] = [];
    (Element.prototype as { animate?: unknown }).animate = function (frames: Keyframe[], timing: KeyframeAnimationOptions) {
      calls.push({ frames, timing });
      return { finished: Promise.resolve() };
    };
    const target = document.createElement('div');
    target.innerHTML = '<span data-ref="R1"></span><span data-ref="R2"></span>';
    document.body.append(target);
    const arrived: number[] = [];
    await playMoment(sources, target, { onArrive: (i) => arrived.push(i) });
    expect(calls).toHaveLength(12);
    expect(calls[3]!.timing).toMatchObject({ duration: 560, delay: 120, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    expect(calls.every((c) => c.frames.every((f) => Object.keys(f).every((k) => ['offset', 'opacity', 'transform'].includes(k))))).toBe(true);
    expect(arrived).toHaveLength(12);
    expect(document.querySelector('.moment')).toBeNull();
  });

  it("lands each square on its Rule's swatch in the summary, or on the spot of the Rules folded into \"+N more\"", async () => {
    withMatchMedia(false);
    const ends: unknown[] = [];
    (Element.prototype as { animate?: unknown }).animate = function (frames: Keyframe[]) {
      ends.push(frames.at(-1)?.transform);
      return { finished: Promise.resolve() };
    };
    const rules = ['R1', 'R2', 'R4', 'R5'].map((ruleRef, i) => ({ ruleRef, ruleText: `Rule ${ruleRef}`, count: 4 - i }));
    act(() => void showSummary(summary({ count: 10, rules })));
    const target = overlayRoot().querySelector('.rules')!;
    // jsdom has no layout: the two swatches and the folded spot each get a place of their own.
    const place = (sel: string, top: number) => vi.spyOn(target.querySelector(sel)!, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, top, 8, 8));
    place('[data-ref="R1"]', 200);
    place('[data-ref="R2"]', 220);
    place('[data-refs]', 240);
    await playMoment(['R2', 'R5', 'R1', 'R4'].map((ruleRef) => ({ rect, ruleRef })), target);
    expect(ends).toEqual(['translate(100px, 220px) scale(1)', 'translate(100px, 240px) scale(1)', 'translate(100px, 200px) scale(1)', 'translate(100px, 240px) scale(1)']);
  });

  it('with reduced motion the summary shows the full count at once', () => {
    withMatchMedia(true);
    act(() => void showSummary(summary(), { from: sources }));
    expect(overlayRoot().querySelector('h2')!.textContent).toBe('Shooed 4 videos');
  });
});

describe('in-page notice', () => {
  it('before a trip: no "paused", polite, no recovery button', () => {
    vi.useFakeTimers();
    act(() => showNotice({ kind: 'failureNativeAction', count: 2 }));
    const root = overlayRoot();
    const text = root.querySelector('.notice h2')!.textContent!;
    expect(text).toBe("Couldn't tell YouTube about 2 videos. They stay visible.");
    expect(text).not.toMatch(/paused/i);
    expect(buttons(root.querySelector('.notice')!).map((b) => b.textContent)).toEqual(['Dismiss']);
    act(() => void vi.advanceTimersByTime(100));
    expect(root.querySelector('[aria-live="polite"]')!.textContent).toBe(text);
    expect(root.querySelector('[aria-live="assertive"]')!.textContent).toBe('');
  });

  it('tripped: danger headline, recovery action, assertive, one notice per streak', () => {
    vi.useFakeTimers();
    const onAction = vi.fn();
    act(() => showNotice({ kind: 'breakerModel', onAction }));
    act(() => void vi.advanceTimersByTime(100));
    act(() => showNotice({ kind: 'breakerModel', onAction }));
    const root = overlayRoot();
    expect(root.querySelectorAll('.notice')).toHaveLength(1);
    const h2 = root.querySelector('.notice h2')!;
    expect(h2.textContent).toBe("Shoo paused: OpenRouter didn't answer.");
    expect(h2.classList.contains('danger')).toBe(true);
    expect(root.querySelector('[aria-live="assertive"]')!.textContent).toBe(h2.textContent);
    act(() => buttons(root.querySelector('.notice')!)[0]!.click());
    expect(onAction).toHaveBeenCalledOnce();
    expect(buttons(root.querySelector('.notice')!)[0]!.textContent).toBe('Retry');
    act(() => hideNotice());
    expect(root.querySelector('.notice')).toBeNull();
  });

  it('YouTube breakers offer Open settings', () => {
    act(() => showNotice({ kind: 'breakerNativeAction', onAction: vi.fn() }));
    expect(buttons(overlayRoot().querySelector('.notice')!)[0]!.textContent).toBe('Open settings');
  });
});

describe('overlay robustness', () => {
  it('a summary right after a tripped notice keeps both announcements', () => {
    vi.useFakeTimers();
    act(() => showNotice({ kind: 'breakerModel', onAction: vi.fn() }));
    act(() => void showSummary(summary()));
    act(() => void vi.advanceTimersByTime(100));
    const root = overlayRoot();
    expect(root.querySelector('[aria-live="assertive"]')!.textContent).toBe("Shoo paused: OpenRouter didn't answer.");
    expect(root.querySelector('[aria-live="polite"]')!.textContent).toMatch(/^Shoo removed 4 videos/);
  });

  it('notice and summary are separately named regions', () => {
    act(() => showNotice({ kind: 'failureModel' }));
    act(() => void showSummary(summary()));
    const labels = [...overlayRoot().querySelectorAll('section')].map((s) => s.getAttribute('aria-label'));
    expect(labels).toEqual(['Shoo notice', 'Shoo']);
  });

  it('hands focus back when a focused notice is dismissed', () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    act(() => showNotice({ kind: 'breakerNativeAction', onAction: vi.fn() }));
    const notice = overlayRoot().querySelector('.notice')!;
    act(() => buttons(notice)[0]!.focus());
    act(() => buttons(notice)[1]!.click());
    expect(overlayRoot().querySelector('.notice')).toBeNull();
    expect(document.activeElement).toBe(outside);
  });

  it('does not stay open forever when the focused control disappears', () => {
    vi.useFakeTimers();
    act(() => void showSummary(summary()));
    const root = overlayRoot();
    act(() => buttons(root.querySelector('.panel')!)[1]!.focus());
    act(() => void showSummary(summary({ undoAvailable: false })));
    act(() => void vi.advanceTimersByTime(6000));
    expect(root.querySelector('.pill')).not.toBeNull();
  });

  it('the pill pauses while hovered and expanding it from the keyboard keeps focus in the panel', () => {
    vi.useFakeTimers();
    act(() => void showSummary(summary()));
    act(() => void vi.advanceTimersByTime(6000));
    const root = overlayRoot();
    const pill = root.querySelector<HTMLButtonElement>('.pill')!;
    act(() => void pill.dispatchEvent(new MouseEvent('mouseenter')));
    act(() => void vi.advanceTimersByTime(60000));
    expect(root.querySelector('.pill')).not.toBeNull();
    act(() => pill.focus());
    act(() => pill.click());
    expect(root.querySelector('.panel')).not.toBeNull();
    expect(root.activeElement?.textContent).toBe('Review');
  });

  it('an update reopens a collapsed summary in the same call', () => {
    vi.useFakeTimers();
    act(() => void showSummary(summary()));
    act(() => void vi.advanceTimersByTime(6000));
    showSummary(summary({ count: 7 }));
    expect(overlayRoot().querySelector('.panel h2')!.textContent).toBe('Shooed 7 videos');
  });

  it('a removed overlay never touches the next one', () => {
    vi.useFakeTimers();
    act(() => void showSummary(summary()));
    act(() => removeOverlay());
    act(() => void showSummary(summary({ count: 2 })));
    act(() => void vi.advanceTimersByTime(5000));
    expect(overlayRoot().querySelector('.panel h2')!.textContent).toBe('Shooed 2 videos');
  });

  it('the annotation can take focus on Keep after the chip was replaced', () => {
    const root = shadow();
    act(() => renderAnnotation(root, { ruleRef: 'R2', ruleText: 'Crypto', hasChannel: false, onKeep: vi.fn(), focusKeep: true }));
    expect(root.activeElement?.textContent).toBe('Keep');
  });
});

describe('in-page CSS decisions', () => {
  const inPageCss = readFileSync(join(__dirname, 'components.css'), 'utf8');
  const rule = (selector: string) => inPageCss.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

  it('keeps the compact chip on one row, so its width decides beside or above the duration badge', () => {
    expect(rule('.chip.compact')).toMatch(/flex-wrap:\s*nowrap/);
  });

  it('gives "Already shooed above" the chip surface so its contrast never depends on the thumbnail', () => {
    expect(rule('.annot.dup')).toMatch(/background:\s*color-mix\(in srgb, var\(--paper\) 96%, transparent\)/);
  });

  it('edges floating panels with a --line-strong ring in dark only', () => {
    expect(inPageCss).toMatch(/:host\(\[data-dark\]\) \.panel,\s*:host\(\[data-dark\]\) \.pill\s*\{\s*box-shadow:\s*0 0 0 1px var\(--line-strong\), var\(--shadow\);/);
    expect(rule('.panel')).not.toMatch(/border:/);
  });

  it("gives the removed-Tile annotation YouTube's own ground only when it covers YouTube's sentence", () => {
    // Opaque, so YouTube's text never ghosts through, and in the colour YouTube paints there, so no patch shows.
    expect(rule(':host([data-cramped]) .annot')).toMatch(/--shoo-fill:\s*var\(--shoo-ground, var\(--paper\)\);/);
    expect(rule(':host([data-cramped]) .annot')).toMatch(/background:\s*linear-gradient\(var\(--shoo-fill\), var\(--shoo-fill\)\) var\(--shoo-cap-x, 0px\) 0 \/ var\(--shoo-cap-w, 100%\) var\(--shoo-cap, 0px\) no-repeat,\s*linear-gradient\(var\(--shoo-fill\), var\(--shoo-fill\)\) 0 var\(--shoo-cap, 0px\) \/ 100% 100% no-repeat;/);
    expect(rule(':host([data-cramped]) .annot')).toMatch(/padding-top:\s*var\(--shoo-cap, 0px\)/);
    expect(rule(':host([data-cramped]) .annot')).toMatch(/min-height:\s*var\(--shoo-cover, 24px\)/);
    expect(rule(':host([data-cramped]) .annot')).not.toMatch(/box-shadow|border:|margin:/);
  });

  it("centres the removed-Tile annotation's lines like YouTube's card (sentence, then buttons)", () => {
    expect(rule('.annot:not(.dup)')).toMatch(/justify-content:\s*center/);
    expect(rule('.annot:not(.dup) .vid')).toMatch(/justify-content:\s*center/);
    expect(rule('.annot.dup')).not.toMatch(/justify-content/);
  });

  it("keeps the annotation's title line to one truncated line, dropped where the placeholder has no room", () => {
    expect(rule('.annot .vid')).toMatch(/white-space:\s*nowrap/);
    expect(rule('.annot .vid bdi')).toMatch(/overflow:\s*hidden;[\s\S]*text-overflow:\s*ellipsis/);
    // Tight: the title replaces "Shooed by" in line one, right after the eyes (after the swatch it would read as the
    // Rule's text). The channel placeholder keeps "Channel shooed by".
    expect(rule(':host([data-tight]) .annot .vid')).toMatch(/flex:\s*0 1 auto;[\s\S]*min-width:\s*48px;[\s\S]*order:\s*-1/);
    // Folded, the line never wraps and never grows, so it stays centred (the channel card's line may still wrap).
    expect(rule(':host([data-tight]) .annot:not(.chan)')).toMatch(/flex-wrap:\s*nowrap/);
    // Still too tall for the room: "Shooed by" goes too.
    expect(rule(':host([data-min]) .annot .by')).toMatch(/display:\s*none/);
    expect(rule(':host([data-tight]) .annot > .eyes')).toMatch(/order:\s*-2/);
    expect(inPageCss).toMatch(/:host\(\[data-tight\]\) \.annot:not\(\.chan\) \.by,[^{]*:host\(\[data-tight\]\) \.annot\.chan \.vid\s*\{\s*display:\s*none/);
  });

  it('keeps the removed-Tile annotation on one line on narrow placeholders, each step where the Rule label would keep under ~100 px', () => {
    expect(rule('.annot:not(.dup)')).toMatch(/container-type:\s*inline-size/);
    // Line one is ~323 px plus the label: "Crypto & trading" (~107 px) still shows whole beside the text action at 432 px.
    expect(inPageCss).toMatch(/@container \(max-width: 431px\)\s*\{[^@]*\.annot \.ch \.tx\s*\{\s*display:\s*none/);
    expect(inPageCss).toMatch(/@container \(max-width: 287px\)\s*\{\s*\.annot \.by\s*\{\s*display:\s*none/);
    // "Channel shooed by" is longer, so each step comes sooner on the channel placeholder.
    expect(inPageCss).toMatch(/@container \(max-width: 474px\)\s*\{[^@]*\.annot\.chan \.ch \.tx\s*\{\s*display:\s*none/);
    expect(inPageCss).toMatch(/@container \(max-width: 339px\)\s*\{\s*\.annot\.chan \.by\s*\{\s*display:\s*none/);
  });

  it('makes the Rule label the text that shrinks, to an ellipsis, on every surface', () => {
    expect(rule('.lb')).toMatch(/min-width:\s*0;[\s\S]*overflow:\s*hidden;[\s\S]*text-overflow:\s*ellipsis;[\s\S]*white-space:\s*nowrap/);
    expect(rule('.tag')).toMatch(/flex:\s*0 1 auto;[\s\S]*min-width:\s*0/);
    expect(rule('.tag')).not.toMatch(/tabular-nums/);
    // Annotation: grows from nothing to its whole width, so it never pushes Keep to a second line.
    expect(inPageCss).toMatch(/\n\.annot \.tag\s*\{\s*flex:\s*1 1 0%;\s*min-width:\s*54px;\s*max-width:\s*max-content;/);
    expect(rule('.annot.dup')).not.toMatch(/flex-wrap/); // on a narrow thumbnail the label wraps rather than show a stub
    // Folded into the title's line, the title comes first and the label takes at most 40%.
    expect(rule(':host([data-tight]) .annot:not(.chan) .tag')).toMatch(/flex:\s*0 1 auto;[\s\S]*max-width:\s*40%/);
    // Folded below 288 px the title keeps the room and the Rule shows as its swatch only.
    expect(inPageCss).toMatch(/@container \(max-width: 287px\)\s*\{[^@]*:host\(\[data-tight\]\) \.annot:not\(\.chan\) \.tag \.lb\s*\{\s*display:\s*none/);
    expect(inPageCss).toMatch(/@container \(max-width: 287px\)\s*\{[^@]*:host\(\[data-tight\]\) \.annot:not\(\.chan\) \.tag\s*\{\s*flex:\s*none;\s*min-width:\s*0/);
    // Compact chip and label: a short label between the eyes and the buttons.
    expect(inPageCss).toMatch(/\.chip\.compact \.lb,\s*\.label\.compact \.lb\s*\{\s*max-width:\s*112px/);
  });

  it('lets the Rule label count only as a word\'s room while mount.ts measures', () => {
    expect(rule(':host([data-measuring]) .lb')).toMatch(/contain:\s*inline-size;[\s\S]*min-width:\s*40px/);
    expect(inPageCss).not.toMatch(/\.cut\b/);
  });

  it('lists the summary\'s Rules one per row with the count right-aligned', () => {
    expect(rule('.rules')).toMatch(/display:\s*grid/);
    expect(rule('.rules .n')).toMatch(/margin-left:\s*auto/);
    expect(rule('.rules .more .sw')).toMatch(/visibility:\s*hidden/);
  });
});
