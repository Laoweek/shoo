// Binding domain types. Source of truth: docs/spec/architecture.md, Sections 3, 6 and 8.
// Every other layer imports these from core/.
import type { DirectProviderId } from './providers';
import type { SiteId } from './sites';

export type { SiteId } from './sites';

// YouTube's Surfaces keep their original ids, so stored settings and Activity stay valid. Bilibili's carry its name.
export type SurfaceId = 'home' | 'watchSidebar' | 'shortsShelf' | 'search' | 'channel' | 'endScreen' | 'bilibiliHome' | 'bilibiliVideoSidebar';
export const SURFACE_IDS: readonly SurfaceId[] = ['home', 'watchSidebar', 'shortsShelf', 'search', 'channel', 'endScreen', 'bilibiliHome', 'bilibiliVideoSidebar'];
export const SUPPORTED_SURFACES: readonly SurfaceId[] = ['home', 'watchSidebar', 'shortsShelf', 'bilibiliHome'];

/** A Shelf on Home that a Shelf dismissal can act on (youtube-integration.md Section 10). */
export type ShelfId = 'shorts' | 'games';
export const SHELF_IDS: readonly ShelfId[] = ['shorts', 'games'];

/**
 * Firefox data collection categories Shoo asks for when the user agrees, all of which must stay granted
 * before anything is sent (cross-browser-and-stores.md Section 1, "Data collection and consent").
 */
export const DATA_COLLECTION = ['websiteContent', 'authenticationInfo'] as const;

/** A plain object, not null or an array. */
export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export type RuleKind =
  | 'topic'
  | 'thumbnail'
  | 'channel'
  | 'keyword'
  | 'pattern'
  | 'regex'
  | 'duration'
  | 'views'
  | 'short'
  | 'live'
  | 'membersOnly'
  | 'artistChannel';
// 'membersOnly' and the upcoming half of 'live' stay hidden in the UI until fixtures exist.
export const RULE_KINDS: readonly RuleKind[] = [
  'topic',
  'thumbnail',
  'channel',
  'keyword',
  'pattern',
  'regex',
  'duration',
  'views',
  'short',
  'live',
  'membersOnly',
  'artistChannel',
];
export const EXACT_KINDS: readonly RuleKind[] = ['channel', 'keyword', 'pattern', 'regex', 'duration', 'views', 'short', 'live', 'membersOnly', 'artistChannel'];
export const MODEL_KINDS: readonly RuleKind[] = ['topic', 'thumbnail'];

export type Polarity = 'remove' | 'keep'; // thumbnail + keep is invalid in v1
export type NativeAction = 'notInterested' | 'dontRecommendChannel';
export type Mode = 'auto' | 'review' | 'dryRun';
export type EyeState = 'watching' | 'judging' | 'review' | 'paused' | 'error';
export type ColourCode = `c${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10}`;

export interface RuleParams {
  channelName?: string;
  channelId?: string;
  handle?: string;
  minSeconds?: number;
  maxSeconds?: number;
  minViews?: number;
  maxViews?: number;
}

export interface Rule {
  id: string; // random UUID, stable across devices. Stats and Activity key on this
  ref: string; // 'R12' or 'K3'. Changes only on a sync or import collision (REQ-RULE-6)
  polarity: Polarity;
  kind: RuleKind;
  text: string; // the user's words, never rewritten (REQ-RULE-7)
  name?: string; // Rule name: the user's short label, shown instead of the text. Never sent to a model (REQ-RULE-11)
  params?: RuleParams;
  /** The one Site the Rule works on, unset for every Site (Site-only rule, ADR 0012). A channel Rule made from a Tile has its Tile's Site. */
  site?: SiteId;
  colour?: ColourCode; // remove Rules only
  skipSubscribed?: boolean; // remove Rules only: never removes a Tile from a Subscribed channel (REQ-RULE-14)
  enabled: boolean;
  origin: 'user' | 'escalation' | 'starter';
  createdAt: number;
  updatedAt: number;
  deletedAt?: number; // tombstone for sync merge, purged after 30 days
}
// Banned channel = Rule { kind: 'channel', polarity: 'remove' } -> nativeAction 'dontRecommendChannel'

export interface TileFacts {
  videoId: string;
  surface: SurfaceId;
  title: string;
  channelName?: string;
  channelHandle?: string;
  channelId?: string;
  durationSec?: number;
  viewCount?: number; // set only when YouTube shows the count in English. Live Tiles show watchers, not views. Never sent to a model
  isShort: boolean;
  isLive: boolean;
  isUpcoming: boolean;
  isMembersOnly: boolean;
  isArtistChannel?: boolean; // set only when YouTube shows the Official Artist Channel badge
  /** Bilibili only: the cover image's path on Bilibili's image host (BILIBILI_COVER_PATH). Never sent to a model. */
  cover?: string;
}

/**
 * Longest title and channel field a Tile carries, far above what YouTube and Bilibili allow. Content cuts a longer
 * title or channel name and drops a longer handle or channel ID, and the background rejects a batch with one.
 */
export const TILE_TITLE_MAX = 1000;
export const TILE_CHANNEL_MAX = 120;

export type VerdictSource = 'keepRule' | 'exception' | 'exact' | 'model' | 'modelThumbnail';

export interface Verdict {
  videoId: string;
  outcome: 'keep' | 'remove';
  ruleId?: string;
  ruleRef?: string; // display only
  probability?: number; // P(remove) for model Verdicts
  source: VerdictSource;
  nativeAction?: NativeAction; // set when outcome is 'remove'
  rescuedFrom?: string; // Rescue: ruleId of the remove Rule or Banned channel a Keep rule beat. Keep Verdicts with source 'keepRule' only
  rulesVersion: string;
  at: number;
}

export interface Exception {
  videoId: string;
  title: string;
  channelName?: string;
  channelKey?: string;
  ruleId?: string;
  at: number;
}

// banned: the user's own Don't recommend channel made a Banned channel (REQ-ACT-5).
export type ActivityKind = 'removed' | 'kept' | 'keptByRule' | 'wouldRemove' | 'failed' | 'escalated' | 'undone' | 'renumbered' | 'banned' | 'shelfDismissed';
export type ActionStep = 'openMenu' | 'findItem' | 'clickItem' | 'confirmPlaceholder' | 'undo';

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  at: number;
  videoId?: string;
  title?: string; // truncated to 120 chars
  channelName?: string;
  channelKey?: string;
  surface?: SurfaceId;
  ruleId?: string;
  source?: VerdictSource;
  p?: number;
  mode?: Mode;
  batchId?: string;
  nativeAction?: NativeAction;
  step?: ActionStep;
  selectorVersion?: string;
  detail?: string;
  shelf?: ShelfId; // shelfDismissed only
  seenAt?: number;
  /** Bilibili only: the cover path, so Activity can show a thumbnail (YouTube's is derived from the videoId). */
  cover?: string;
  /** The Site of an event about no video (an Escalation's channel). Events about a video take it from the video. */
  site?: SiteId;
}

// Messages contract types (architecture.md Section 6)

export type RuntimeReason =
  | 'off'
  | 'noConsent'
  | 'migrating'
  | 'hostRevoked'
  | 'noKey'
  | 'breakerNativeAction'
  | 'breakerMarkup'
  | 'breakerModel'
  | 'dailyCap'
  | 'offline';

export type ReasonCode =
  | RuntimeReason
  | 'keyRejected'
  | 'creditsExhausted'
  | 'rateLimited'
  | 'modelError'
  | 'apiShapeChanged'
  | 'keepCheckUnavailable'
  | 'privateWindow'
  | 'unsupportedSurface'
  | 'cancelled'
  | 'invalidInput'
  /** More enabled remove Topic rules than the direct Decision provider's choice question takes (decision-engine.md §12.1). */
  | 'tooManyRules'
  /** A Rule with skipSubscribed would remove the Tile, and Shoo has no list of Subscribed channels to check it against. */
  | 'subscriptionsUnavailable'
  /** A judgeTiles reply's Tile whose thumbnail check is still running: its Verdict follows in tileVerdicts. */
  | 'thumbnailPending';

export type FailureCategory = 'model' | 'nativeAction' | 'markup';

export interface RuntimeStages {
  exact: boolean;
  model: boolean;
  nativeActions: boolean;
  ui: boolean;
}

export interface RuntimeSnapshot {
  enabled: boolean;
  mode: Mode;
  reason: RuntimeReason | 'ok';
  detail?: ReasonCode; // e.g. noKey + keyRejected
  stages: RuntimeStages;
  eye: EyeState;
  settingsGeneration: number;
  rulesVersion: string;
  reviewPending?: number;
  surfaces: Record<SurfaceId, boolean>;
  notificationStyle?: Settings['notificationStyle']; // content applies summary / perRemoval / silent
  shelfDismissal?: Settings['shelfDismissal']; // content starts the Shelf watcher only while one is on
  /** The Site whose failures tripped the breaker in `reason` (breakerNativeAction, breakerMarkup), when known. */
  site?: SiteId;
}

export interface TileResult {
  videoId: string;
  status: 'decided' | 'undecided';
  verdict?: Verdict;
  reason?: ReasonCode;
}

export type RuleOp =
  | { op: 'add'; rule: Omit<Rule, 'id' | 'ref' | 'colour' | 'createdAt' | 'updatedAt'> }
  // name '' clears it. site null makes the Rule work on every Site again.
  | { op: 'update'; id: string; patch: Partial<Pick<Rule, 'text' | 'name' | 'params' | 'enabled' | 'kind' | 'skipSubscribed'>> & { site?: SiteId | null } }
  | { op: 'delete'; id: string };

export type StrengthPreset = 'cautious' | 'balanced' | 'eager' | 'custom';

export interface DirectEndpoint {
  provider: DirectProviderId;
  baseUrl: string;
  model: string;
}

export interface Settings {
  generation: number; // +1 on every change, drives settingsGeneration
  enabled: boolean;
  mode: Mode;
  /** Sites Shoo works on. A Site that is off has no active Surfaces. */
  sites: Record<SiteId, boolean>;
  surfaces: Record<SurfaceId, boolean>;
  notificationStyle: 'summary' | 'perRemoval' | 'silent';
  dailyCap: number;
  escalationMode: 'off' | 'suggest' | 'automatic';
  strength: { preset: StrengthPreset; custom: number };
  /** openrouter: the Decisions API through OpenRouter. direct: a Decision provider without OpenRouter. custom: a chat model. */
  engine: 'openrouter' | 'direct' | 'custom';
  models: { text: string; image: string };
  /** The Decision provider reached without OpenRouter (core/providers.ts), used when engine is 'direct'. */
  direct?: DirectEndpoint;
  customEndpoint?: { baseUrl: string; model: string };
  consent?: { version: number; acceptedAt: number; customHost?: string };
  regexEnabled: boolean;
  /** Shelf dismissal per Shelf, off by default. A missing Shelf counts as off. */
  shelfDismissal?: Partial<Record<ShelfId, boolean>>;
  onboarding?: { step: number; done: boolean }; // resume point for the onboarding page (ui-design.md Section 7)
}

export interface ShooExport {
  format: 'shoo-rules';
  version: 1;
  exportedAt: string;
  rules: Rule[];
  exceptions: Exception[];
}
