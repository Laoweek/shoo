// Test helpers for engine/ tests only (never imported by runtime code): Rule and Tile factories, recorded
// OpenRouter fixtures (test/fixtures/openrouter, format in decision-engine.md Section 11) and a scripted fake fetch.
import type { Exception, Rule, Settings, SurfaceId, TileFacts } from '~/core/types';
import type { FetchLike } from './net';
import { CONSENT_VERSION } from '~/store/schema';

export interface OpenRouterFixture {
  name: string;
  handWritten?: boolean;
  request: { url: string; body: any };
  response: { status: number; headers: Record<string, string>; body: any };
}

const fixtures = import.meta.glob<OpenRouterFixture>('../../test/fixtures/openrouter/*.json', { eager: true, import: 'default' });

export function fixture(name: string): OpenRouterFixture {
  const f = fixtures[`../../test/fixtures/openrouter/${name}.json`];
  if (!f) throw new Error(`no fixture ${name}`);
  return structuredClone(f);
}

let seq = 0;
export function rule(ref: string, text: string, over: Partial<Rule> = {}): Rule {
  seq++;
  return {
    id: `rule-${ref}-${seq}`,
    ref,
    polarity: ref.startsWith('K') ? 'keep' : 'remove',
    kind: 'topic',
    text,
    enabled: true,
    origin: 'user',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

export function tile(videoId: string, title: string, over: Partial<TileFacts> = {}): TileFacts {
  return { videoId, surface: 'home', title, isShort: false, isLive: false, isUpcoming: false, isMembersOnly: false, ...over };
}

export function exception(videoId: string, title: string, channelName: string | undefined, at: number): Exception {
  return { videoId, title, ...(channelName ? { channelName } : {}), at };
}

export const SETTINGS: Settings = {
  generation: 1,
  enabled: true,
  mode: 'review',
  sites: { youtube: true, bilibili: true },
  surfaces: { home: true, watchSidebar: true, shortsShelf: true, search: false, channel: false, endScreen: false, bilibiliHome: true, bilibiliVideoSidebar: false },
  notificationStyle: 'summary',
  dailyCap: 5000,
  escalationMode: 'suggest',
  strength: { preset: 'balanced', custom: 0.6 },
  engine: 'openrouter',
  models: { text: 'cloudflare/clef-flash', image: 'cloudflare/clef-flash' },
  consent: { version: CONSENT_VERSION, acceptedAt: 1 },
  regexEnabled: false,
};

const SURFACES: Record<string, SurfaceId> = { 'home page': 'home', 'watch page sidebar': 'watchSidebar', 'Shorts shelf': 'shortsShelf' };

/** "18:42" → 1122. */
export function parseDuration(s: string): number {
  return s.split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
}

/** The Tiles behind a recorded text request's choice questions, with synthetic video ids v01, v02, … */
export function tilesFromFixture(f: OpenRouterFixture): TileFacts[] {
  const out: TileFacts[] = [];
  for (const [id, q] of Object.entries<any>(f.request.body.questions)) {
    if (!/^t\d\d$/.test(id)) continue;
    const v = q.instructions.video;
    out.push(
      tile(`vid${id.slice(1)}xxxxxx`.slice(0, 11), v.title, {
        surface: SURFACES[v.surface]!,
        ...(v.channel ? { channelName: v.channel } : {}),
        ...(v.duration ? { durationSec: parseDuration(v.duration) } : {}),
      }),
    );
  }
  return out;
}

export interface Scripted {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Reject like a network error or an abort. */
  throws?: boolean;
  /** Raw bytes for image responses. */
  bytes?: Uint8Array;
}

export interface RecordedRequest {
  url: string;
  init?: RequestInit;
  body?: any;
}

/**
 * A fetch that answers from a script, in order, per URL prefix. Records every request with its parsed
 * JSON body. Throws when a request has no scripted answer, so tests see unexpected calls.
 */
export function scriptedFetch(script: Record<string, (Scripted | ((req: RecordedRequest) => Scripted))[]>) {
  const requests: RecordedRequest[] = [];
  const queues = Object.entries(script).map(([prefix, list]) => ({ prefix, list: [...list] }));
  const fetchFn: FetchLike = async (input, init) => {
    const url = String(input);
    const req: RecordedRequest = { url, init, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined };
    requests.push(req);
    const q = queues.find((x) => url.startsWith(x.prefix));
    const next = q?.list.shift();
    if (!next) throw new Error(`unscripted request to ${url}`);
    const r = typeof next === 'function' ? next(req) : next;
    if (r.throws) throw new DOMException('The operation was aborted.', 'AbortError');
    const headers = new Headers(r.headers ?? { 'content-type': 'application/json' });
    if (r.bytes) return new Response(r.bytes as BodyInit, { status: r.status, headers });
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers });
  };
  return { fetch: fetchFn, requests };
}

export const fromFixture = (f: OpenRouterFixture): Scripted => ({ status: f.response.status, body: f.response.body, headers: { 'content-type': 'application/json', ...f.response.headers } });

/**
 * Answers any Decisions request with valid answers: text choice → `choose(title)`, nouls → `noul(title, question)`.
 * The thumbnail choice question has no title: `noul(undefined, ref)` scores each Thumbnail rule, and the answer
 * gives P(keep) = 1 - the top score, shared among the refs by score, so p and ref come out as the top score and ref.
 */
export function answerer(opts: {
  choose?: (title: string) => Record<string, number>;
  noul?: (title: string | undefined, questionId: string) => number;
  cost?: number;
}): (req: RecordedRequest) => Scripted {
  const thumbnail = (refs: string[]): Record<string, number> => {
    const scores = refs.map((ref) => opts.noul?.(undefined, ref) ?? 0.01);
    const top = Math.max(...scores);
    const sum = scores.reduce((a, b) => a + b, 0);
    return Object.fromEntries([['keep', 1 - top], ...refs.map((ref, i) => [ref, sum > 0 ? (top * scores[i]!) / sum : 0])]);
  };
  return (req) => {
    const answers: Record<string, unknown> = {};
    for (const [id, q] of Object.entries<any>(req.body.questions)) {
      const title = typeof q.instructions === 'string' ? undefined : q.instructions.video.title;
      if (q.type === 'choice') {
        const refs = Object.keys(q.criteria).filter((k) => k !== 'keep');
        const probabilities = title === undefined ? thumbnail(refs) : (opts.choose?.(title) ?? { keep: 1 });
        const full = Object.fromEntries(Object.keys(q.criteria).map((k) => [k, probabilities[k] ?? 0]));
        const choice = Object.entries(full).sort((a, b) => b[1] - a[1])[0]![0];
        answers[id] = { type: 'choice', choice, probabilities: full, confidence: 0.9 };
      } else {
        answers[id] = { type: 'noul', noul: opts.noul?.(title, id) ?? 0.01 };
      }
    }
    return {
      status: 200,
      body: { model: req.body.model, answers, usage: { input_tokens: 100, output_tokens: 0, cost: opts.cost ?? 0.0001 }, id: 'gen', provider: 'Cloudflare' },
    };
  };
}

/**
 * Strings found in request bodies that must never reach OpenRouter (REQ-PRIV-1): the given video ids and
 * other identifiers (channel ids, handles), and any URL fragment. Image data URLs are not URLs to a host.
 */
export function privateDataIn(bodies: unknown[], forbidden: string[]): string[] {
  const leaks: string[] = [];
  for (const b of bodies) {
    const s = JSON.stringify(b);
    for (const x of [...forbidden, 'youtube', 'ytimg', 'youtu.be', 'http://', 'https://']) if (s.includes(x)) leaks.push(x);
  }
  return leaks;
}
