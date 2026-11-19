import { describe, expect, it } from 'vitest';
import { compileSafeRegex, validateRegex } from './regex';

describe('validateRegex accepts the safe subset', () => {
  it.each([
    '^\\[?live\\]?',
    '\\b(crypto|bitcoin)\\b',
    'top \\d+ ',
    '[a-z]{2,5}',
    'colou?r',
    '(?:ab)+',
    '((ab){2})+', // fixed inner count, no ambiguity
    '(?<word>abc)',
    '[^a-z\\d]+',
    '[\\w\\-.]+@',
    '[\\b]',
    '\\s?-?\\s?', // two bounded optional terms over spaces
    'a?b?', // no overlap
    'a+b+c+',
    'a?a?a?', // bounded chain, 8 combinations
    '.*foo.*', // two unbounded terms are quadratic at most
    '.+ .+',
    '.*foo.*bar',
    '\\w+ \\w+ \\w+ \\w+ \\w+', // the spaces separate them
    '(?:a|bc)d+', // group spans per branch
    '\\d+x\\d+', // a required literal separates them
    '\\x41\\u0042\\u{1F600}\\cJ\\0\\n\\r\\t\\v\\f\\/',
    '\\p{L}+',
    '\\P{L}\\D\\W\\S',
    'a*?b',
    'a{2}?',
    '[]',
    '[^]',
    'x{3,}y',
    '(a|b)?c', // alternation in an optional group is fine
    'ǅ?x', // non-ASCII case variants
    '😀+',
    'a|b',
    '^$',
    '[^\\D]+x', // double complement
    '[\\D\\d]', // overlapping ranges
    'a\\0',
    '',
  ])('%s', (src) => {
    expect(validateRegex(src)).toEqual({ ok: true });
  });
});

describe('validateRegex rejects', () => {
  it.each([
    ['a'.repeat(201), 'tooLong'],
    ['(a|aa)+', 'alternationInQuantifiedGroup'],
    ['(?:x(a|b))*', 'alternationInQuantifiedGroup'],
    ['(a+)+', 'nestedQuantifier'],
    ['(a*)*', 'nestedQuantifier'],
    ['(a?){30}', 'nestedQuantifier'],
    ['(x(a+))*', 'nestedQuantifier'],
    ['\\1', 'backreference'],
    ['(a)\\1', 'backreference'],
    ['(?<n>a)\\k<n>', 'backreference'],
    ['(?=x)', 'lookaround'],
    ['(?!x)', 'lookaround'],
    ['(?<=x)', 'lookaround'],
    ['(?<!x)', 'lookaround'],
    ['(?i)abc', 'flags'],
    ['(?i:abc)', 'flags'],
    ['a*a*', 'adjacentQuantifier'],
    ['.*.*', 'adjacentQuantifier'],
    ['a*b?a*', 'adjacentQuantifier'], // only a nullable term between
    ['\\w+\\d+', 'adjacentQuantifier'],
    ['A*a+', 'adjacentQuantifier'], // case-insensitive overlap
    ['[a-z]+[^0-9]*', 'adjacentQuantifier'],
    ['(ab)+(ab)+', 'adjacentQuantifier'],
    ['(foo\\d+)\\d+', 'adjacentQuantifier'],
    ['\\b\\d+\\b\\d+', 'adjacentQuantifier'], // anchors are nullable
    ['a?'.repeat(20), 'adjacentQuantifier'], // exponential chain of bounded terms
    ['.+ .+ .+', 'adjacentQuantifier'], // cubic: each .+ can absorb the space
    ['.* .* .* .* .*', 'adjacentQuantifier'],
    ['[^!]+ [^!]+ [^!]+', 'adjacentQuantifier'],
    ['a.*b.*c.*d', 'adjacentQuantifier'],
    ['.{0,99} .{0,99} .{0,99}', 'adjacentQuantifier'],
    ['(?:x.+)? .+ .+', 'adjacentQuantifier'], // optional group counts as unbounded
  ])('%s -> %s', (src, reason) => {
    expect(validateRegex(src)).toEqual({ ok: false, reason });
  });

  it('allows an unbounded term next to a non-overlapping group', () => {
    expect(validateRegex('\\d+(?:x(a+))')).toEqual({ ok: true });
  });

  it.each([
    'a**',
    '*a',
    '+',
    '?',
    '{2}',
    'a{2,1}',
    'a{,2}',
    'a{x}',
    '}',
    ']',
    '(a',
    'a)',
    '[a',
    '[z-a]',
    '[\\d-z]',
    '[a-\\d]',
    '\\',
    '[\\',
    '\\-',
    '\\e',
    '[\\B]',
    '[\\1]',
    '\\01',
    '\\c1',
    '\\c',
    '\\xZ1',
    '\\x4',
    '\\u12',
    '\\u{110000}',
    '\\u{zz}',
    '\\p',
    '\\p{NotAProperty}',
    '^*',
    '\\b+',
    '(?<1a>x)',
    '(?<n>a)(?<n>b)',
  ])('syntax: %s', (src) => {
    expect(validateRegex(src)).toEqual({ ok: false, reason: 'syntax' });
  });
});

describe('compileSafeRegex', () => {
  it('compiles accepted sources with flags iu', () => {
    const re = compileSafeRegex('\\b(crypto|bitcoin)\\b');
    expect(re?.flags).toBe('iu');
    expect(re?.test('Why BITCOIN will win')).toBe(true);
  });

  it('returns null for rejected sources', () => {
    expect(compileSafeRegex('(a|aa)+')).toBeNull();
  });

  it('accepted patterns stay fast on adversarial 300-character titles', () => {
    for (const src of ['a+b+c+', '(?:ab)+$', 'x{3,}y', '\\s?-?\\s?z', '.*foo.*!$', '.+ .+!$', 'a?a?a?!$']) {
      const re = compileSafeRegex(src)!;
      const start = performance.now();
      re.test('a'.repeat(300));
      re.test('ab'.repeat(150) + '!');
      re.test(' a'.repeat(150));
      re.test('foo '.repeat(75));
      expect(performance.now() - start).toBeLessThan(50);
    }
  });
});
