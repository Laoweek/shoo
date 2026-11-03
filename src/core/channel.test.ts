import { describe, expect, it } from 'vitest';
import { channelIdentity, channelKey, channelsMatch, ruleChannelIdentity, tileChannelIdentity, type ChannelIdentity } from './channel';
import type { Rule, TileFacts } from './types';

describe('channelKey', () => {
  it.each([
    ['  Jake   Reacts ', 'jake reacts'],
    ['ＪＡＫＥ', 'jake'], // NFKC folds full-width letters
    ['Café Tour', 'café tour'],
    ['İstanbul', 'i̇stanbul'], // fixed 'en' casing, not the user's locale
    ['', ''],
  ])('%j -> %j', (name, key) => {
    expect(channelKey(name)).toBe(key);
  });
});

describe('channelIdentity', () => {
  it('normalizes each part and drops empty ones', () => {
    expect(channelIdentity(' Code Bites ', ' @CodeBites ', ' UC123 ')).toEqual({ key: 'code bites', handle: 'codebites', id: 'UC123' });
    expect(channelIdentity('Name', '', '  ')).toEqual({ key: 'name' });
    expect(channelIdentity(undefined, '@h')).toEqual({ handle: 'h' });
    expect(channelIdentity(undefined, undefined, 'UC1')).toEqual({ id: 'UC1' });
  });

  it('is undefined when nothing is known', () => {
    expect(channelIdentity()).toBeUndefined();
    expect(channelIdentity('  ', '@', '')).toBeUndefined();
  });
});

describe('channelsMatch', () => {
  const cases: [string, ChannelIdentity, ChannelIdentity, boolean][] = [
    ['same id', { id: 'UC1', key: 'a' }, { id: 'UC1', key: 'b' }, true],
    ['different ids win over equal handles and keys', { id: 'UC1', handle: 'h', key: 'k' }, { id: 'UC2', handle: 'h', key: 'k' }, false],
    ['one id only falls back to handle', { id: 'UC1', handle: 'h' }, { handle: 'h' }, true],
    ['different handles win over equal keys', { handle: 'a', key: 'k' }, { handle: 'b', key: 'k' }, false],
    ['one handle only falls back to key', { handle: 'a', key: 'k' }, { key: 'k' }, true],
    ['different keys', { key: 'a' }, { key: 'b' }, false],
    ['nothing in common to compare', { id: 'UC1' }, { key: 'k' }, false],
    ['handle vs key only', { handle: 'k' }, { key: 'k' }, false],
  ];
  it.each(cases)('%s', (_, a, b, expected) => {
    expect(channelsMatch(a, b)).toBe(expected);
    expect(channelsMatch(b, a)).toBe(expected);
  });
});

describe('Rule and Tile identities', () => {
  const rule = (params?: Rule['params'], text = 'Jake Reacts'): Rule => ({
    id: 'r',
    ref: 'R1',
    polarity: 'remove',
    kind: 'channel',
    text,
    params,
    enabled: true,
    origin: 'user',
    createdAt: 0,
    updatedAt: 0,
  });

  it('reads Rule params and falls back to the Rule text for the name', () => {
    expect(ruleChannelIdentity(rule({ channelName: 'Jake  Reacts', handle: '@JakeReacts', channelId: 'UC9' }))).toEqual({
      key: 'jake reacts',
      handle: 'jakereacts',
      id: 'UC9',
    });
    expect(ruleChannelIdentity(rule())).toEqual({ key: 'jake reacts' });
    expect(ruleChannelIdentity(rule({}, ' '))).toBeUndefined();
  });

  it('reads Tile facts, and a Tile without a channel has no identity', () => {
    const tile: TileFacts = {
      videoId: 'v',
      surface: 'home',
      title: 't',
      channelName: 'Jake Reacts',
      channelHandle: '@jakereacts',
      isShort: false,
      isLive: false,
      isUpcoming: false,
      isMembersOnly: false,
    };
    expect(tileChannelIdentity(tile)).toEqual({ key: 'jake reacts', handle: 'jakereacts' });
    expect(tileChannelIdentity({ ...tile, channelName: undefined, channelHandle: undefined })).toBeUndefined();
  });
});
