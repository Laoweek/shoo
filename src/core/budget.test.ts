import { describe, expect, it } from 'vitest';
import { estimateTokens, fitState, STATE_TOKEN_BUDGET, textBatchSize } from './budget';
import type { Exception, Rule } from './types';

const rule = (ref: string, text: string, over: Partial<Rule> = {}): Rule => ({
  id: `id-${ref}`,
  ref,
  polarity: ref.startsWith('K') ? 'keep' : 'remove',
  kind: 'topic',
  text,
  enabled: true,
  origin: 'user',
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

const exception = (n: number, over: Partial<Exception> = {}): Exception => ({
  videoId: `v${n}`,
  title: `Kept video ${n}`,
  channelName: `Channel ${n}`,
  at: n,
  ...over,
});

describe('textBatchSize', () => {
  it.each([
    [0, 16],
    [3, 16],
    [4, 12],
    [5, 10],
    [15, 4],
    [63, 1],
    [100, 1],
    [-2, 16],
  ])('%i Topic Keep rules -> %i Tiles', (keep, tiles) => {
    expect(textBatchSize(keep)).toBe(tiles);
  });
});

describe('estimateTokens', () => {
  it('is ceil(JSON length / 4) for ASCII', () => {
    expect(estimateTokens({})).toBe(1);
    expect(estimateTokens('abcdef')).toBe(2); // "abcdef" is 8 characters of JSON
  });

  it('counts each Chinese character as a whole token', () => {
    // "不要推荐游戏直播" is 8 characters plus 2 ASCII quotes.
    expect(estimateTokens('不要推荐游戏直播')).toBe(9);
  });

  it('trims a Chinese state the four-characters rule would have let through', () => {
    const rules = Array.from({ length: 8 }, (_, i) => rule(`R${i + 1}`, `${i}${'游戏直播和电子竞技比赛的精彩集锦'.repeat(14)}`));
    const out = fitState(rules, [], []);
    expect(Math.ceil(JSON.stringify(out.state).length / 4)).toBeLessThan(STATE_TOKEN_BUDGET);
    expect(out.truncatedRefs.length).toBeGreaterThan(0);
  });
});

describe('fitState', () => {
  it('builds the state in ref order with the 10 newest Exceptions, newest first', () => {
    const exceptions = Array.from({ length: 12 }, (_, i) => exception(i + 1));
    exceptions.push(exception(13, { channelName: undefined, title: 'No channel' }));
    const out = fitState([rule('R2', 'Crypto'), rule('R1', 'Reaction videos'), rule('R3', 'off', { enabled: false })], [rule('K1', 'Programming')], exceptions);
    expect(Object.keys(out.state.viewer_does_not_want)).toEqual(['R1', 'R2']);
    expect(out.state.viewer_always_wants).toEqual({ K1: 'Programming' });
    expect(out.state.viewer_kept_anyway).toHaveLength(10);
    expect(out.state.viewer_kept_anyway?.[0]).toBe('No channel');
    expect(out.state.viewer_kept_anyway?.[1]).toBe('Kept video 12 (channel: Channel 12)');
    expect(out).toMatchObject({ droppedExceptions: 0, truncatedRefs: [], budget: STATE_TOKEN_BUDGET });
    expect(out.usedTokens).toBe(estimateTokens(out.state));
  });

  it('omits empty optional keys', () => {
    const out = fitState([], [], []);
    expect(out.state).toEqual({ viewer_does_not_want: {} });
  });

  it('drops Exceptions oldest first before touching Rules', () => {
    const long = 'x'.repeat(290);
    const exceptions = Array.from({ length: 10 }, (_, i) => exception(i, { title: `${i} ${long}` }));
    const rules = Array.from({ length: 10 }, (_, i) => rule(`R${i + 1}`, String(i).repeat(500)));
    const out = fitState(rules, [], exceptions);
    expect(out.droppedExceptions).toBeGreaterThan(0);
    expect(out.truncatedRefs).toEqual([]);
    expect(out.usedTokens).toBeLessThanOrEqual(STATE_TOKEN_BUDGET);
    const kept = out.state.viewer_kept_anyway ?? [];
    expect(kept.length).toBe(10 - out.droppedExceptions);
    expect(kept[0]?.startsWith('9 ')).toBe(true); // newest survives
  });

  it('cuts a kept example to 300 characters of title and 100 of channel name', () => {
    const out = fitState([rule('R1', 'Crypto')], [], [exception(1, { title: 'T'.repeat(1000), channelName: 'C'.repeat(1000) })]);
    expect(out.state.viewer_kept_anyway).toEqual([`${'T'.repeat(300)} (channel: ${'C'.repeat(100)})`]);
  });

  it('then truncates the longest Rule texts to 160 characters, longest first, without mutating Rules', () => {
    const rules = Array.from({ length: 20 }, (_, i) => rule(`R${i + 1}`, `${i}`.padEnd(400 + i, 'r')));
    const keep = [rule('K1', 'k'.repeat(500))];
    const snapshot = JSON.stringify([rules, keep]);
    const out = fitState(rules, keep, [exception(1)]);
    expect(out.droppedExceptions).toBe(1);
    expect(out.state.viewer_kept_anyway).toBeUndefined();
    expect(out.truncatedRefs[0]).toBe('K1');
    expect(out.truncatedRefs[1]).toBe('R20');
    for (const ref of out.truncatedRefs) {
      const text = out.state.viewer_does_not_want[ref] ?? out.state.viewer_always_wants?.[ref];
      expect(Array.from(text!)).toHaveLength(160);
    }
    expect(out.usedTokens).toBeLessThanOrEqual(STATE_TOKEN_BUDGET);
    expect(JSON.stringify([rules, keep])).toBe(snapshot);
  });

  it('reports when even truncated Rules do not fit', () => {
    const rules = Array.from({ length: 60 }, (_, i) => rule(`R${i + 1}`, 'y'.repeat(200)));
    const out = fitState(rules, [], []);
    expect(out.truncatedRefs).toHaveLength(60);
    expect(out.usedTokens).toBeGreaterThan(out.budget);
  });

  it('truncates by code points, never splitting an emoji', () => {
    const rules = Array.from({ length: 12 }, (_, i) => rule(`R${i + 1}`, '😀'.repeat(400)));
    const out = fitState(rules, [], []);
    const text = out.state.viewer_does_not_want[out.truncatedRefs[0]!]!;
    expect(text).toBe('😀'.repeat(160));
  });
});
