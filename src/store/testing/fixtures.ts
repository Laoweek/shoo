// Realistic test data and simulated devices for store tests.
import type { Exception, Rule, RuleKind } from '~/core/types';
import type { AreaLike, Areas } from '../areas';
import { parseImportFile, type ParsedImport } from '../import';
import { createWriter, type WriterDeps } from '../writer';
import { createMemoryArea } from './quota-storage';

/** Small deterministic PRNG (mulberry32), so sizes are realistic but stable. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = 'videos about crypto trading reaction drama celebrity gossip prank challenge clickbait mukbang unboxing asmr shorts compilation fails news politics gaming speedrun tier list ranking hot takes podcast clips'.split(' ');

export function sentence(rand: () => number, len: number): string {
  let s = '';
  while (s.length < len) s += (s ? ' ' : '') + WORDS[Math.floor(rand() * WORDS.length)];
  return s.slice(0, len);
}

const uuid = (rand: () => number) =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(rand() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
export const videoId = (rand: () => number) => Array.from({ length: 11 }, () => ID_CHARS[Math.floor(rand() * 64)]).join('');

const KINDS: RuleKind[] = ['topic', 'topic', 'topic', 'keyword', 'channel', 'pattern', 'thumbnail'];

/** A full Rule as the store would hold it, text 20 to `maxText` characters. */
export function makeRule(rand: () => number, n: number, maxText = 200, at = 1_760_000_000_000): Rule {
  const kind = KINDS[Math.floor(rand() * KINDS.length)]!;
  const polarity = kind === 'thumbnail' || rand() < 0.8 ? 'remove' : 'keep';
  const text = sentence(rand, 20 + Math.floor(rand() * (maxText - 19)));
  const rule: Rule = {
    id: uuid(rand),
    ref: `${polarity === 'remove' ? 'R' : 'K'}${n}`,
    polarity,
    kind,
    text,
    enabled: rand() < 0.9,
    origin: 'user',
    createdAt: at + n,
    updatedAt: at + n,
  };
  if (kind === 'channel') rule.params = { channelName: sentence(rand, 12), handle: '@' + sentence(rand, 10).replace(/ /g, '') };
  if (polarity === 'remove') rule.colour = `c${(n % 10) + 1}` as Rule['colour'];
  return rule;
}

/** An Exception with a title up to 80 characters, a channel and usually a ruleId. */
export function makeException(rand: () => number, at: number, ruleIds: string[] = []): Exception {
  const x: Exception = { videoId: videoId(rand), title: sentence(rand, 20 + Math.floor(rand() * 61)), at };
  if (rand() < 0.85) {
    x.channelName = sentence(rand, 5 + Math.floor(rand() * 20));
  }
  if (ruleIds.length > 0 && rand() < 0.5) x.ruleId = ruleIds[Math.floor(rand() * ruleIds.length)]!;
  return x;
}

export interface Device {
  areas: Areas;
  writer: ReturnType<typeof createWriter>;
  clock: { t: number };
}

/** A simulated browser profile: its own local and session areas, sharing `sync` with other devices. */
export function makeDevice(sync: AreaLike, t0: number, deps: Partial<WriterDeps> = {}): Device {
  const clock = { t: t0 };
  const areas: Areas = { sync, local: createMemoryArea(), session: createMemoryArea() };
  const writer = createWriter({ areas, now: () => clock.t, ...deps });
  return { areas, writer, clock };
}

/** An export file as the options page hands it to the writer: checked by parseImportFile, which must accept it. */
export function checked(file: unknown): ParsedImport {
  const parsed = parseImportFile(file);
  if (!parsed.ok) throw new Error(`import file rejected: ${parsed.detail}`);
  return parsed.value;
}
