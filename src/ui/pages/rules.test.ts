import '~/ui/test/catalogue';
import { describe, expect, it } from 'vitest';
import type { Rule } from '~/core/types';
import { STARTERS, addOp, namePatch, ruleHints, starterOp, takesHints } from './rules';

describe('ruleHints (REQ-RULE-12)', () => {
  it.each([
    'No unboxing videos',
    "Don't show me unboxing videos",
    'Don’t show me unboxing videos',
    'Do not recommend unboxing videos',
    'hide unboxing videos',
    'Remove unboxing videos',
    'BLOCK unboxing videos',
    'Stop showing unboxing videos',
    'Never unboxing videos',
    'Avoid unboxing videos',
    '  No unboxing videos',
  ])('points out an order: %s', (text) => {
    expect(ruleHints(text)).toEqual(['order']);
  });

  it.each([
    'Gaming videos except speedruns',
    'Gaming videos, but not speedruns',
    'Gaming videos that are not tutorials',
    'Cooking videos unless they are vegan',
    'Sports highlights excluding cricket',
  ])('points out a negation: %s', (text) => {
    expect(ruleHints(text)).toEqual(['negation']);
  });

  it('points out both in one Rule, and never counts the "not" of a leading "Do not" as a negation', () => {
    expect(ruleHints('No gaming videos except speedruns')).toEqual(['order', 'negation']);
    expect(ruleHints('Do not show gaming videos')).toEqual(['order']);
    expect(ruleHints('Do not show gaming, except speedruns')).toEqual(['order', 'negation']);
  });

  it.each([
    'Unboxing videos and hauls',
    'Nostalgia compilations',
    'No-code app tutorials',
    'Notebook reviews',
    'Not-for-profit fundraising appeals',
    'Blockchain explainers',
    'Hidden camera pranks',
    'Removal van vlogs',
    'Exceptional plays compilations',
    'Videos about how to say no',
    '',
  ])('stays quiet on a description: %s', (text) => {
    expect(ruleHints(text)).toEqual([]);
  });

  it.each([
    ["No Man's Sky gameplay", []],
    ["Don't Starve gameplay", []],
    ['Not Just Bikes videos', []],
    ['Videos about Not Just Bikes', []],
    ['Do not show crypto', ['order']],
    ['Gaming videos but not Minecraft', ['negation']],
  ])('reads a capitalised word as part of a name: %s', (text, hints) => {
    expect(ruleHints(text)).toEqual(hints);
  });

  it('applies to remove Topic and Thumbnail rules only', () => {
    expect(takesHints('remove', 'topic')).toBe(true);
    expect(takesHints('remove', 'thumbnail')).toBe(true);
    expect(takesHints('keep', 'topic')).toBe(false);
    expect(takesHints('remove', 'keyword')).toBe(false);
  });
});

describe('Rule names (REQ-RULE-11)', () => {
  it('Starter rules take their chip label as name', () => {
    expect(STARTERS.map((s) => starterOp(s))).toEqual([
      { op: 'add', rule: expect.objectContaining({ kind: 'topic', name: 'Reaction videos', origin: 'starter' }) },
      { op: 'add', rule: expect.objectContaining({ kind: 'topic', name: 'Clickbait' }) },
      { op: 'add', rule: expect.objectContaining({ kind: 'topic', name: 'Get-rich-quick' }) },
      { op: 'add', rule: expect.objectContaining({ kind: 'topic', name: 'Celebrity gossip' }) },
      { op: 'add', rule: expect.objectContaining({ kind: 'short', name: 'Shorts' }) },
    ]);
  });

  it('a draft adds its trimmed name, leaves out a blank one, and channel Rules take none', () => {
    expect(addOp('remove', { kind: 'topic', text: 'Unboxing videos', name: '  Unboxing  ' })).toEqual({
      op: 'add',
      rule: { polarity: 'remove', kind: 'topic', text: 'Unboxing videos', name: 'Unboxing', enabled: true, origin: 'user' },
    });
    expect(addOp('remove', { kind: 'topic', text: 'Unboxing videos', name: ' ' })).toEqual({
      op: 'add',
      rule: { polarity: 'remove', kind: 'topic', text: 'Unboxing videos', enabled: true, origin: 'user' },
    });
    const channel = addOp('remove', { kind: 'channel', text: 'Hustle Daily', name: 'Hustle' });
    expect(channel?.op === 'add' && 'name' in channel.rule).toBe(false);
  });

  it('renaming sends a trimmed name, and an empty one clears it', () => {
    const rule = { id: 'a' } as Rule;
    expect(namePatch(rule, ' Crypto ')).toEqual({ op: 'update', id: 'a', patch: { name: 'Crypto' } });
    expect(namePatch(rule, '  ')).toEqual({ op: 'update', id: 'a', patch: { name: '' } });
  });
});
