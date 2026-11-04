// Hand-written payload guards for every inbound message (docs/spec/architecture.md Section 13: validate payload
// shapes in the router). A failed guard runs nothing: the route answers its `invalid` reply, or router.ts rejects
// the message with InvalidInput.
import { BILIBILI_COVER_PATH, SITE_IDS } from '~/core/sites';
import { SHELF_IDS, SURFACE_IDS, type ActionStep, type Mode, type NativeAction, type Settings, type ShelfId, type SiteId, type SurfaceId, type TileFacts, type TileResult } from '~/core/types';

export type Guard<T> = (v: unknown) => v is T;

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const isStr = (v: unknown): v is string => typeof v === 'string';
export const isNonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
export const optional = (v: unknown, g: (x: unknown) => boolean) => v === undefined || g(v);
const oneOf =
  <T extends string>(list: readonly T[]) =>
  (v: unknown): v is T =>
    typeof v === 'string' && (list as readonly string[]).includes(v);

const MODES = ['auto', 'review', 'dryRun'] as const satisfies readonly Mode[];
const ACTIONS = ['notInterested', 'dontRecommendChannel'] as const satisfies readonly NativeAction[];
const STEPS = ['openMenu', 'findItem', 'clickItem', 'confirmPlaceholder', 'undo'] as const satisfies readonly ActionStep[];
const SOURCES = ['keepRule', 'exception', 'exact', 'model', 'modelThumbnail'] as const;
export const isMode = oneOf(MODES);
export const isSurface = oneOf(SURFACE_IDS as readonly SurfaceId[]);
export const isShelf = oneOf(SHELF_IDS as readonly ShelfId[]);
export const isSite = oneOf(SITE_IDS as readonly SiteId[]);
/** A Bilibili cover path from a page (core/sites.ts BILIBILI_COVER_PATH), or absent. */
export const isCover = (v: unknown) => v === undefined || (typeof v === 'string' && BILIBILI_COVER_PATH.test(v));
export const isNativeAction = oneOf(ACTIONS);
export const isStep = oneOf(STEPS);
export const isSource = oneOf(SOURCES);
export const isCategory = oneOf(['model', 'nativeAction', 'markup'] as const);

const MAX_BATCH = 64;
const MAX_TEXT = 1000;
export const isShortStr = (v: unknown): v is string => isStr(v) && v.length <= MAX_TEXT;
export const optionalStr = (v: unknown) => optional(v, isShortStr);
export const isVideoId = (v: unknown): v is string => isNonEmpty(v) && v.length <= 64;

export function isTileFacts(v: unknown): v is TileFacts {
  return (
    isRecord(v) &&
    isVideoId(v.videoId) &&
    isSurface(v.surface) &&
    isShortStr(v.title) &&
    optionalStr(v.channelName) &&
    optionalStr(v.channelHandle) &&
    optionalStr(v.channelId) &&
    optional(v.durationSec, isNum) &&
    optional(v.viewCount, isNum) &&
    isBool(v.isShort) &&
    isBool(v.isLive) &&
    isBool(v.isUpcoming) &&
    isBool(v.isMembersOnly) &&
    optional(v.isArtistChannel, isBool) &&
    isCover(v.cover)
  );
}

export function isTileResult(v: unknown): v is TileResult {
  if (!isRecord(v) || !isVideoId(v.videoId) || (v.status !== 'decided' && v.status !== 'undecided')) return false;
  if (v.verdict === undefined) return true;
  const d = v.verdict;
  return (
    isRecord(d) &&
    (d.outcome === 'keep' || d.outcome === 'remove') &&
    isSource(d.source) &&
    optionalStr(d.ruleId) &&
    optional(d.probability, isNum) &&
    optional(d.nativeAction, isNativeAction)
  );
}

const listOf =
  <T>(g: Guard<T>, max = MAX_BATCH) =>
  (v: unknown): v is T[] =>
    Array.isArray(v) && v.length <= max && v.every(g);

export const isTileList = listOf(isTileFacts);
const WOULD_REMOVE_MAX = 1000;
export const isWouldRemoveList = listOf(isTileResult, WOULD_REMOVE_MAX);
export const isWouldRemoveTiles = listOf(isTileFacts, WOULD_REMOVE_MAX);
export const isIdList = listOf(isVideoId, 500);

/** Checks a channel triple: every part optional, but present parts must be short strings. */
export const isChannelParts = (v: Record<string, unknown>) => optionalStr(v.channelName) && optionalStr(v.channelHandle) && optionalStr(v.channelId);

// Settings patch ------------------------------------------------------------------------------------

type Patch = Partial<Settings>;
/** A record of on/off switches whose keys pass `key`. */
const flags = (key: (k: unknown) => boolean) => (v: unknown) => isRecord(v) && Object.entries(v).every(([k, b]) => key(k) && isBool(b));
const PATCH_GUARDS: { [K in keyof Settings]?: (v: unknown) => boolean } = {
  enabled: isBool,
  mode: isMode,
  sites: flags(isSite),
  surfaces: flags(isSurface),
  notificationStyle: oneOf(['summary', 'perRemoval', 'silent'] as const),
  dailyCap: (v) => isNum(v) && v >= 0 && Number.isInteger(v),
  escalationMode: oneOf(['off', 'suggest', 'automatic'] as const),
  strength: (v) => isRecord(v) && oneOf(['cautious', 'balanced', 'eager', 'custom'] as const)(v.preset) && isNum(v.custom) && v.custom >= 0 && v.custom <= 1,
  engine: oneOf(['openrouter', 'custom'] as const),
  models: (v) => isRecord(v) && isNonEmpty(v.text) && isNonEmpty(v.image) && isShortStr(v.text) && isShortStr(v.image),
  customEndpoint: (v) => v === undefined || (isRecord(v) && isHttpUrl(v.baseUrl) && isNonEmpty(v.model) && isShortStr(v.model)),
  regexEnabled: isBool,
  shelfDismissal: flags(isShelf),
  onboarding: (v) => isRecord(v) && isNum(v.step) && isBool(v.done),
};

/**
 * Keeps the known, writable keys of a settings patch. `generation` belongs to the writer and `consent` to
 * giveConsent and withdrawConsent, so both are stripped with unknown keys. Returns undefined when a known
 * key has a value of the wrong shape.
 */
export function cleanSettingsPatch(v: unknown): Patch | undefined {
  if (!isRecord(v)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, value] of Object.entries(v)) {
    const guard = PATCH_GUARDS[k as keyof Settings];
    if (!guard) continue;
    if (!guard(value)) return undefined;
    out[k] = value;
  }
  return out as Patch;
}

export function isHttpUrl(v: unknown): v is string {
  if (!isStr(v) || v.length > MAX_TEXT) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}
