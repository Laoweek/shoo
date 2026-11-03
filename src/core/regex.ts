// Safe-subset validator for regex Rules. Source of truth: docs/spec/requirements.md "Exact rule semantics"
// and docs/spec/architecture.md Section 13. A small hand-written parser builds a syntax tree, then the
// tree is checked for constructs that can backtrack catastrophically. No eval, no new Function.

export type RegexCheck =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'tooLong'
        | 'syntax'
        | 'backreference'
        | 'lookaround'
        | 'nestedQuantifier'
        | 'adjacentQuantifier'
        | 'alternationInQuantifiedGroup'
        | 'flags';
    };

type RejectReason = Extract<RegexCheck, { ok: false }>['reason'];

export const REGEX_MAX_LENGTH = 200;
export const REGEX_FLAGS = 'iu';

// Character sets as inclusive code point ranges, used only to decide whether two terms can match the
// same character. Over-approximating is safe (it can only reject more).
type Range = readonly [number, number];
type CharSet = Range[];

const MAX_CP = 0x10ffff;
const ALL: CharSet = [[0, MAX_CP]];
const DIGIT: CharSet = [[48, 57]];
const WORD: CharSet = [[48, 57], [65, 90], [95, 95], [97, 122]];
const SPACE: CharSet = [
  [9, 13],
  [32, 32],
  [160, 160],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x2028, 0x2029],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
  [0xfeff, 0xfeff],
];

function complement(set: CharSet): CharSet {
  const sorted = [...set].sort((a, b) => a[0] - b[0]);
  const out: CharSet = [];
  let next = 0;
  for (const [lo, hi] of sorted) {
    if (lo > next) out.push([next, lo - 1]);
    next = Math.max(next, hi + 1);
  }
  if (next <= MAX_CP) out.push([next, MAX_CP]);
  return out;
}

/** Adds the other ASCII case of every letter range, since Rules always run with the `i` flag. */
function foldCase(set: CharSet): CharSet {
  const out: CharSet = [...set];
  for (const [lo, hi] of set) {
    const upLo = Math.max(lo, 65);
    const upHi = Math.min(hi, 90);
    if (upLo <= upHi) out.push([upLo + 32, upHi + 32]);
    const lowLo = Math.max(lo, 97);
    const lowHi = Math.min(hi, 122);
    if (lowLo <= lowHi) out.push([lowLo - 32, lowHi - 32]);
  }
  return out;
}

function overlaps(a: CharSet, b: CharSet): boolean {
  const fa = foldCase(a);
  const fb = foldCase(b);
  return fa.some(([alo, ahi]) => fb.some(([blo, bhi]) => alo <= bhi && blo <= ahi));
}

/** A single literal code point plus its non-ASCII case variants. */
function literal(cp: number): CharSet {
  const ch = String.fromCodePoint(cp);
  const set: CharSet = [[cp, cp]];
  for (const variant of [ch.toLowerCase(), ch.toUpperCase()]) {
    const v = variant.codePointAt(0)!;
    if (variant.length === ch.length && v !== cp) set.push([v, v]);
  }
  return set;
}

interface Term {
  atom: Atom;
  min: number;
  max: number;
}
type Atom = { type: 'chars'; set: CharSet } | { type: 'anchor' } | { type: 'group'; branches: Term[][] };

class Reject extends Error {
  constructor(readonly reason: RejectReason) {
    super(reason);
  }
}

const SYNTAX_CHARS = new Set('^$\\.*+?()[]{}|/');
const HEX = /^[0-9a-fA-F]+$/;

class Parser {
  i = 0;
  constructor(readonly src: string) {}

  parse(): Term[][] {
    const branches = this.alternation();
    if (this.i < this.src.length) throw new Reject('syntax'); // stray ')'
    return branches;
  }

  private peek(): string | undefined {
    return this.src[this.i];
  }

  private alternation(): Term[][] {
    const branches = [this.sequence()];
    while (this.peek() === '|') {
      this.i++;
      branches.push(this.sequence());
    }
    return branches;
  }

  private sequence(): Term[] {
    const terms: Term[] = [];
    for (let c = this.peek(); c !== undefined && c !== '|' && c !== ')'; c = this.peek()) {
      const atom = this.atom();
      const [min, max] = this.quantifier();
      if (atom.type === 'anchor' && !(min === 1 && max === 1)) throw new Reject('syntax');
      terms.push({ atom, min, max });
    }
    return terms;
  }

  private quantifier(): [number, number] {
    const c = this.peek();
    let q: [number, number];
    if (c === '*') q = [0, Infinity];
    else if (c === '+') q = [1, Infinity];
    else if (c === '?') q = [0, 1];
    else if (c === '{') {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(this.src.slice(this.i));
      if (!m) throw new Reject('syntax');
      const min = Number(m[1]);
      const max = m[2] === undefined ? min : m[3] === '' ? Infinity : Number(m[3]);
      if (max < min) throw new Reject('syntax');
      this.i += m[0].length - 1;
      q = [min, max];
    } else return [1, 1];
    this.i++;
    if (this.peek() === '?') this.i++; // lazy
    return q;
  }

  private atom(): Atom {
    const c = this.peek()!;
    if (c === '^' || c === '$') {
      this.i++;
      return { type: 'anchor' };
    }
    if (c === '.') {
      this.i++;
      return { type: 'chars', set: ALL };
    }
    if (c === '(') return this.group();
    if (c === '[') return { type: 'chars', set: this.charClass() };
    if (c === '\\') return this.escape();
    if ('*+?{}]'.includes(c)) throw new Reject('syntax'); // nothing to repeat, or a lone bracket under `u`
    const cp = this.src.codePointAt(this.i)!;
    this.i += String.fromCodePoint(cp).length;
    return { type: 'chars', set: literal(cp) };
  }

  private group(): Atom {
    this.i++; // '('
    const rest = this.src.slice(this.i);
    if (rest.startsWith('?:')) this.i += 2;
    else if (/^\?(=|!|<=|<!)/.test(rest)) throw new Reject('lookaround');
    else if (rest.startsWith('?<')) {
      const m = /^\?<([A-Za-z_$][\w$]*)>/.exec(rest);
      if (!m) throw new Reject('syntax');
      this.i += m[0].length;
    } else if (rest.startsWith('?')) throw new Reject('flags'); // inline modifiers such as (?i) or (?-i:x)
    const branches = this.alternation();
    if (this.peek() !== ')') throw new Reject('syntax');
    this.i++;
    return { type: 'group', branches };
  }

  /** Escape outside a class. */
  private escape(): Atom {
    this.i++; // '\'
    const c = this.peek();
    if (c === 'b' || c === 'B') {
      this.i++;
      return { type: 'anchor' };
    }
    if (c !== undefined && /[1-9k]/.test(c)) throw new Reject('backreference');
    return { type: 'chars', set: this.escapedChars(false) };
  }

  /** Character class escapes and single escaped characters, shared by both contexts. `this.i` sits after '\'. */
  private escapedChars(inClass: boolean): CharSet {
    const c = this.peek();
    if (c === undefined) throw new Reject('syntax');
    this.i++;
    switch (c) {
      case 'd':
        return DIGIT;
      case 'D':
        return complement(DIGIT);
      case 'w':
        return WORD;
      case 'W':
        return complement(WORD);
      case 's':
        return SPACE;
      case 'S':
        return complement(SPACE);
      case 'n':
        return literal(10);
      case 'r':
        return literal(13);
      case 't':
        return literal(9);
      case 'v':
        return literal(11);
      case 'f':
        return literal(12);
      case '0':
        if (/\d/.test(this.peek() ?? '')) throw new Reject('syntax');
        return literal(0);
      case 'c': {
        const letter = this.peek() ?? '';
        if (!/[A-Za-z]/.test(letter)) throw new Reject('syntax');
        this.i++;
        return literal(letter.charCodeAt(0) % 32);
      }
      case 'x':
        return literal(this.hex(2));
      case 'u':
        return literal(this.unicodeEscape());
      case 'p':
      case 'P':
        if (!/^\{[\w=]+\}/.test(this.src.slice(this.i))) throw new Reject('syntax');
        this.i = this.src.indexOf('}', this.i) + 1;
        return ALL;
    }
    if (inClass && c === 'b') return literal(8);
    if (inClass && c === '-') return literal(45);
    if (SYNTAX_CHARS.has(c)) return literal(c.codePointAt(0)!);
    throw new Reject('syntax'); // `u` forbids identity escapes of other characters
  }

  private hex(len: number): number {
    const digits = this.src.slice(this.i, this.i + len);
    if (digits.length !== len || !HEX.test(digits)) throw new Reject('syntax');
    this.i += len;
    return parseInt(digits, 16);
  }

  private unicodeEscape(): number {
    if (this.peek() !== '{') return this.hex(4);
    const m = /^\{([0-9a-fA-F]+)\}/.exec(this.src.slice(this.i));
    const cp = m ? parseInt(m[1]!, 16) : NaN;
    if (!m || cp > MAX_CP) throw new Reject('syntax');
    this.i += m[0].length;
    return cp;
  }

  private charClass(): CharSet {
    this.i++; // '['
    const negate = this.peek() === '^';
    if (negate) this.i++;
    const set: CharSet = [];
    while (this.peek() !== ']') {
      const lo = this.classAtom();
      if (this.peek() === '-' && this.src[this.i + 1] !== ']') {
        this.i++;
        const hi = this.classAtom();
        if (typeof lo !== 'number' || typeof hi !== 'number' || hi < lo) throw new Reject('syntax');
        set.push([lo, hi]);
      } else if (typeof lo === 'number') set.push([lo, lo]);
      else set.push(...lo);
    }
    this.i++; // ']'
    return negate ? complement(set) : set;
  }

  /** One class member: a code point, or a set for class escapes such as \d. */
  private classAtom(): number | CharSet {
    const c = this.peek();
    if (c === undefined) throw new Reject('syntax');
    if (c !== '\\') {
      const cp = this.src.codePointAt(this.i)!;
      this.i += String.fromCodePoint(cp).length;
      return cp;
    }
    this.i++;
    if (/[1-9k]/.test(this.peek() ?? '')) throw new Reject('syntax');
    const set = this.escapedChars(true);
    return set.length === 1 && set[0]![0] === set[0]![1] ? set[0]![0] : set;
  }
}

// --- Safety analysis ---

const isVariable = (t: Term) => t.min !== t.max;
const repeats = (t: Term) => t.max > 1;

function hasVariableTerm(branches: Term[][]): boolean {
  return branches.some((seq) =>
    seq.some((t) => isVariable(t) || (t.atom.type === 'group' && hasVariableTerm(t.atom.branches))),
  );
}

function hasAlternation(branches: Term[][]): boolean {
  return branches.length > 1 || branches.some((seq) => seq.some((t) => t.atom.type === 'group' && hasAlternation(t.atom.branches)));
}

/** Titles are capped at 300 characters, so a term never has more than 301 ways to choose its length. */
const SPAN_CAP = 301;
/** Most backtracking work a chain may cost: two unbounded terms, as in `.*foo.*`. */
const MAX_CHAIN_WORK = SPAN_CAP * SPAN_CAP;

interface TermInfo {
  variable: boolean; // can match a varying number of characters
  unbounded: boolean;
  nullable: boolean;
  span: number; // how many lengths it can choose from, capped at SPAN_CAP
  chars: CharSet;
}

function groupInfo(branches: Term[][]): TermInfo {
  const infos = branches.map((seq) => seq.map(termInfo));
  const flat = infos.flat();
  return {
    variable: flat.some((t) => t.variable),
    unbounded: flat.some((t) => t.unbounded),
    nullable: infos.some((seq) => seq.every((t) => t.nullable)),
    span: Math.max(...infos.map((seq) => Math.min(SPAN_CAP, seq.reduce((n, t) => n * t.span, 1)))),
    chars: flat.flatMap((t) => t.chars),
  };
}

function termInfo(t: Term): TermInfo {
  if (t.atom.type === 'anchor') return { variable: false, unbounded: false, nullable: true, span: 1, chars: [] };
  const inner =
    t.atom.type === 'group'
      ? groupInfo(t.atom.branches)
      : { variable: false, unbounded: false, nullable: false, span: 1, chars: t.atom.set };
  const unbounded = t.max === Infinity || inner.unbounded;
  return {
    variable: isVariable(t) || inner.variable,
    unbounded,
    nullable: t.min === 0 || inner.nullable,
    span: unbounded ? SPAN_CAP : Math.min(SPAN_CAP, (t.max - t.min + 1) * inner.span),
    chars: inner.chars,
  };
}

/**
 * Checks one sequence for polynomial and exponential backtracking. For variable terms a < b over
 * overlapping characters:
 * - Adjacent (only nullable terms between) and either unbounded: rejected (`a*a*`, `.*.*`).
 * - Chained (a can also absorb every term between, so the split point is ambiguous): the work along a
 *   chain is the product of the terms' spans. Over MAX_CHAIN_WORK is rejected (`.+ .+ .+` is cubic,
 *   twenty `a?` in a row are exponential). Both report 'adjacentQuantifier'.
 */
function checkSequence(seq: Term[]): void {
  const infos = seq.map(termInfo);
  const bestBefore = infos.map(() => 1);
  for (let a = 0; a < infos.length; a++) {
    const ia = infos[a]!;
    if (!ia.variable) continue;
    const work = ia.span * bestBefore[a]!;
    if (work > MAX_CHAIN_WORK) throw new Reject('adjacentQuantifier');
    let adjacent = true;
    let absorbs = true;
    for (let b = a + 1; b < infos.length && absorbs; b++) {
      const ib = infos[b]!;
      if (ib.variable && overlaps(ia.chars, ib.chars)) {
        if (adjacent && (ia.unbounded || ib.unbounded)) throw new Reject('adjacentQuantifier');
        bestBefore[b] = Math.max(bestBefore[b]!, work);
      }
      adjacent &&= ib.nullable; // adjacent implies absorbs
      absorbs &&= ib.nullable || overlaps(ia.chars, ib.chars);
    }
  }
}

function checkBranches(branches: Term[][]): void {
  for (const seq of branches) {
    for (const t of seq) {
      if (t.atom.type !== 'group') continue;
      if (repeats(t) && hasVariableTerm(t.atom.branches)) throw new Reject('nestedQuantifier');
      if (repeats(t) && hasAlternation(t.atom.branches)) throw new Reject('alternationInQuantifiedGroup');
      checkBranches(t.atom.branches);
    }
    checkSequence(seq);
  }
}

/**
 * Accepts only a strict safe subset (requirements.md "Exact rule semantics", architecture.md Section 13):
 * at most 200 characters, valid under flags `iu`, no backreferences, no lookarounds, no inline flags, no
 * quantified group (max > 1) that contains a quantifier or an alternation, no adjacent unbounded
 * quantifiers over overlapping characters, and no chain of overlapping quantifiers whose backtracking
 * work exceeds two unbounded terms (see `checkSequence`).
 */
export function validateRegex(source: string): RegexCheck {
  if (source.length > REGEX_MAX_LENGTH) return { ok: false, reason: 'tooLong' };
  try {
    const tree = new Parser(source).parse();
    new RegExp(source, REGEX_FLAGS); // the engine is the final word on syntax
    checkBranches(tree);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Reject ? e.reason : 'syntax' };
  }
}

/** Validates, then compiles with flags `iu`. Null when the source is rejected. */
export function compileSafeRegex(source: string): RegExp | null {
  return validateRegex(source).ok ? new RegExp(source, REGEX_FLAGS) : null;
}
