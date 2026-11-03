import { describe, expect, it } from 'vitest';
import { compileExact, matchesRule, normalizeText, patternToMatcher } from './exact';
import type { Rule, RuleKind, TileFacts } from './types';

const tile = (over: Partial<TileFacts> = {}): TileFacts => ({
  videoId: 'vid00000001',
  surface: 'home',
  title: 'Reacting to the WORST cooking fails of 2026',
  channelName: 'Jake Reacts',
  channelHandle: '@JakeReacts',
  channelId: 'UCjake',
  durationSec: 18 * 60 + 42,
  isShort: false,
  isLive: false,
  isUpcoming: false,
  isMembersOnly: false,
  ...over,
});

let seq = 0;
const rule = (kind: RuleKind | string, text: string, over: Partial<Rule> = {}): Rule => ({
  id: `rule-${++seq}`,
  ref: `R${seq}`,
  polarity: 'remove',
  kind: kind as RuleKind,
  text,
  enabled: true,
  origin: 'user',
  createdAt: seq,
  updatedAt: seq,
  ...over,
});

describe('normalizeText', () => {
  it('applies NFKC, casefolding, trimming and whitespace collapsing', () => {
    expect(normalizeText('  ＢＩＧ\t\nNews  ')).toBe('big news');
    expect(normalizeText('ﬁne')).toBe('fine');
  });
});

describe('patternToMatcher', () => {
  it.each([
    ['top * of 2026', 'top 10 of 2026 ranked', true],
    ['top * of 2026', 'the top of 2026', false], // '* ' needs the space
    ['top ? tips', 'my top 5 tips', true],
    ['top ? tips', 'top 10 tips', false],
    ['*', 'anything', true],
    ['a**b', 'axxb', true],
    ['?', 'x', true],
    ['??', 'x', false],
    ['abc', 'xxabcxx', true], // unanchored
    ['a*c', 'abd', false],
    ['(1+1)', 'math (1+1) explained', true], // regex characters are literal
    ['.*', 'abc', false],
    ['\\d', 'a \\d b', true],
    ['$5 [deal]', 'get $5 [deal] now', true],
    ['😀?', '😀x', true], // one code point
    ['ＴＯＰ', 'top', true], // the pattern is normalized too
    ['a*a*a*a*a*a*a*a*b', 'a'.repeat(300), false], // linear backtracking, no blow-up
  ])('%j on %j -> %s', (pattern, title, expected) => {
    expect(patternToMatcher(pattern)(normalizeText(title))).toBe(expected);
  });

  it('treats a literal * in the title as an ordinary character', () => {
    expect(patternToMatcher('a*b')('a*xb')).toBe(true);
    expect(patternToMatcher('5 * 5')('5 * 5')).toBe(true);
  });
});

describe('matchesRule, one table per Exact kind', () => {
  type Row = [string, Rule, TileFacts, boolean];
  const rows: Row[] = [
    // channel: id, then handle, then key; Tiles without a channel never match
    ['channel by id', rule('channel', 'x', { params: { channelName: 'Other', channelId: 'UCjake' } }), tile(), true],
    ['channel id differs', rule('channel', 'x', { params: { channelName: 'Jake Reacts', channelId: 'UCother' } }), tile(), false],
    ['channel by handle', rule('channel', 'x', { params: { channelName: 'Other', handle: 'jakereacts' } }), tile({ channelId: undefined }), true],
    ['channel by key', rule('channel', 'x', { params: { channelName: '  JAKE reacts' } }), tile(), true],
    ['channel key differs', rule('channel', 'x', { params: { channelName: 'Jake' } }), tile(), false],
    [
      'channel on a Tile without channel',
      rule('channel', 'x', { params: { channelName: 'Jake Reacts' } }),
      tile({ channelName: undefined, channelHandle: undefined, channelId: undefined }),
      false,
    ],
    ['channel Rule without any identity', rule('channel', ' ', { params: {} }), tile(), false],
    // keyword: substring of the normalized title
    ['keyword substring', rule('keyword', 'Cooking Fails'), tile(), true],
    ['keyword full-width', rule('keyword', 'ＣＯＯＫＩＮＧ'), tile(), true],
    ['keyword absent', rule('keyword', 'crypto'), tile(), false],
    ['keyword on an empty title', rule('keyword', 'a'), tile({ title: '  ' }), false],
    ['keyword empty', rule('keyword', '   '), tile(), false],
    // pattern
    ['pattern', rule('pattern', 'worst * fails'), tile(), true],
    ['pattern miss', rule('pattern', 'best * fails'), tile(), false],
    ['pattern empty', rule('pattern', ''), tile(), false],
    ['pattern on an empty title', rule('pattern', '*'), tile({ title: '' }), false],
    // regex (regexEnabled is passed as true in this table)
    ['regex', rule('regex', '\\bfails? of \\d{4}$'), tile(), true],
    ['regex is case-insensitive', rule('regex', 'WORST'), tile(), true],
    ['regex miss', rule('regex', '^live'), tile(), false],
    ['regex unsafe', rule('regex', '(a|aa)+'), tile({ title: 'aaaa' }), false],
    ['regex empty', rule('regex', ' '), tile(), false],
    ['regex runs on the first 300 characters only', rule('regex', 'tail$'), tile({ title: 'x'.repeat(300) + ' tail' }), false],
    ['regex within the cap', rule('regex', 'tail'), tile({ title: 'x'.repeat(295) + 'tail' }), true],
    // duration: inclusive, never without a duration
    ['duration inside', rule('duration', 'd', { params: { minSeconds: 600, maxSeconds: 1200 } }), tile(), true],
    ['duration at min', rule('duration', 'd', { params: { minSeconds: 1122 } }), tile(), true],
    ['duration at max', rule('duration', 'd', { params: { maxSeconds: 1122 } }), tile(), true],
    ['duration above max', rule('duration', 'd', { params: { maxSeconds: 1121 } }), tile(), false],
    ['duration below min', rule('duration', 'd', { params: { minSeconds: 1123 } }), tile(), false],
    ['duration unknown', rule('duration', 'd', { params: { minSeconds: 0 } }), tile({ durationSec: undefined }), false],
    ['duration without bounds', rule('duration', 'd', { params: {} }), tile(), false],
    ['duration without params', rule('duration', 'd'), tile(), false],
    ['duration min > max', rule('duration', 'd', { params: { minSeconds: 10, maxSeconds: 5 } }), tile({ durationSec: 7 }), false],
    ['duration negative', rule('duration', 'd', { params: { minSeconds: -5 } }), tile(), false],
    // views: inclusive, never without a view count
    ['views inside', rule('views', 'v', { params: { minViews: 1000, maxViews: 1_000_000 } }), tile({ viewCount: 116_000 }), true],
    ['views at min', rule('views', 'v', { params: { minViews: 116_000 } }), tile({ viewCount: 116_000 }), true],
    ['views at max', rule('views', 'v', { params: { maxViews: 116_000 } }), tile({ viewCount: 116_000 }), true],
    ['views above max', rule('views', 'v', { params: { maxViews: 10_000 } }), tile({ viewCount: 116_000 }), false],
    ['views below min', rule('views', 'v', { params: { minViews: 1_000_000 } }), tile({ viewCount: 116_000 }), false],
    ['views zero', rule('views', 'v', { params: { maxViews: 100 } }), tile({ viewCount: 0 }), true],
    ['views unknown (live, other language)', rule('views', 'v', { params: { minViews: 0 } }), tile(), false],
    ['views without bounds', rule('views', 'v', { params: {} }), tile({ viewCount: 5 }), false],
    ['views min > max', rule('views', 'v', { params: { minViews: 10, maxViews: 5 } }), tile({ viewCount: 7 }), false],
    // flags
    ['short', rule('short', 's'), tile({ isShort: true }), true],
    ['short miss', rule('short', 's'), tile(), false],
    ['live', rule('live', 'l'), tile({ isLive: true }), true],
    ['live ignores upcoming', rule('live', 'l'), tile({ isUpcoming: true }), false],
    ['membersOnly', rule('membersOnly', 'm'), tile({ isMembersOnly: true }), true],
    ['membersOnly miss', rule('membersOnly', 'm'), tile(), false],
    ['artistChannel', rule('artistChannel', 'a', { polarity: 'keep' }), tile({ isArtistChannel: true }), true],
    ['artistChannel miss (flag absent)', rule('artistChannel', 'a', { polarity: 'keep' }), tile(), false],
    ['artistChannel as a remove Rule (synced, never validated)', rule('artistChannel', 'a'), tile({ isArtistChannel: true }), false],
    // not Exact kinds
    ['topic never matches locally', rule('topic', 'Reacting'), tile(), false],
    ['thumbnail never matches locally', rule('thumbnail', 'Reacting'), tile(), false],
    ['unknown kind from a newer device', rule('upcoming', 'u'), tile({ isUpcoming: true }), false],
  ];
  it.each(rows)('%s', (_, r, t, expected) => {
    expect(matchesRule(r, t, true)).toBe(expected);
  });

  it('regex Rules never match while regex is switched off', () => {
    expect(matchesRule(rule('regex', 'worst'), tile(), false)).toBe(false);
  });
});

describe('compileExact', () => {
  const keepKw = rule('keyword', 'tutorial', { polarity: 'keep', ref: 'K2' });
  const keepCh = rule('channel', 'x', { polarity: 'keep', ref: 'K1', params: { channelName: 'Code Bites' } });
  const banned = rule('channel', 'x', { ref: 'R5', params: { channelName: 'Jake Reacts' } });
  const kwLate = rule('keyword', 'fails', { ref: 'R10' });
  const kwEarly = rule('keyword', 'worst', { ref: 'R2' });
  const rx = rule('regex', '(a|aa)+', { ref: 'R3' });
  const rxOk = rule('regex', 'cooking', { ref: 'R4' });
  const off = rule('keyword', 'reacting', { ref: 'R1', enabled: false });
  const gone = rule('keyword', 'reacting', { ref: 'R6', deletedAt: 9 });
  const topic = rule('topic', 'Reaction videos', { ref: 'R7' });
  const future = rule('upcoming', 'u', { ref: 'R8' });
  const all = [kwLate, keepKw, banned, rx, rxOk, off, gone, topic, future, keepCh, kwEarly];

  it('partitions enabled Exact rules by role in ref order and reports invalid ones', () => {
    const c = compileExact(all, false);
    expect(c.keepRules.map((r) => r.ref)).toEqual(['K1', 'K2']);
    expect(c.bannedChannels.map((r) => r.ref)).toEqual(['R5']);
    expect(c.removeRules.map((r) => r.ref)).toEqual(['R2', 'R10']);
    expect(c.invalid).toEqual([
      { ruleId: rx.id, reason: 'regexDisabled' },
      { ruleId: rxOk.id, reason: 'regexDisabled' },
    ]);
  });

  it('with regex on, keeps valid regex Rules and reports unsafe ones with the validator reason', () => {
    const c = compileExact(all, true);
    expect(c.removeRules.map((r) => r.ref)).toEqual(['R2', 'R4', 'R10']);
    expect(c.invalid).toEqual([{ ruleId: rx.id, reason: 'alternationInQuantifiedGroup' }]);
    expect(c.version).not.toBe(compileExact(all, false).version);
  });

  it('returns the first match by ref order for each role', () => {
    const c = compileExact(all, true);
    expect(c.matchRemove(tile())?.ref).toBe('R2');
    expect(c.matchRemove(tile({ title: 'cooking fails' }))?.ref).toBe('R4');
    expect(c.matchBanned(tile())?.ref).toBe('R5');
    expect(c.matchKeep(tile())).toBeUndefined();
    expect(c.matchKeep(tile({ channelName: 'Code Bites', channelHandle: undefined, channelId: undefined, title: 'a tutorial' }))?.ref).toBe('K1');
    expect(c.matchKeep(tile({ title: 'Rust tutorial' }))?.ref).toBe('K2');
    expect(c.matchRemove(tile({ title: 'reacting' }))).toBeUndefined(); // disabled and deleted Rules never match
  });

  it('reports other invalid kinds', () => {
    const c = compileExact(
      [rule('channel', ' ', { params: {} }), rule('keyword', ' '), rule('pattern', '  '), rule('duration', 'd')],
      true,
    );
    expect(c.invalid.map((i) => i.reason)).toEqual(['noChannel', 'empty', 'empty', 'durationBounds']);
  });
});
