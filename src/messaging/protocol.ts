// Messages contract. Source of truth: docs/spec/architecture.md, Section 6.
import type {
  ActionStep,
  ColourCode,
  DirectEndpoint,
  Mode,
  NativeAction,
  ReasonCode,
  Rule,
  RuleOp,
  RuntimeSnapshot,
  Settings,
  ShooExport,
  ShelfId,
  SiteId,
  SurfaceId,
  TileFacts,
  TileResult,
  VerdictSource,
} from '~/core/types';
import type { ParsedImport } from '~/store/import';
import { sendWire } from './wire';

export type DirectEndpointRequest = DirectEndpoint & { key?: string };

export type ActionReport =
  | {
      ok: true;
      videoId: string;
      surface: SurfaceId;
      ruleId?: string;
      nativeAction: NativeAction;
      batchId: string;
      title: string;
      channelName?: string;
      channelHandle?: string;
      channelId?: string;
      cover?: string; // Bilibili: the cover path, for Activity's thumbnail
      source?: VerdictSource;
      p?: number;
      mode?: Mode;
    }
  | { ok: false; videoId: string; surface: SurfaceId; nativeAction: NativeAction; step: ActionStep; selectorVersion: string; title?: string; ruleId?: string };

export interface RuleDisplay {
  ref: string;
  text: string;
  name?: string; // shown instead of the text when set (REQ-RULE-11)
  colour?: ColourCode;
}

/** The stored OpenRouter key. Usage and limit come from OpenRouter, so they are left out until consent allows asking it. */
export interface KeyUsage {
  label?: string;
  source?: 'oauth' | 'pasted';
  connectedAt: number;
  usage?: number;
  /** Spend so far today (UTC), when OpenRouter reports it. */
  usageDaily?: number;
  limit?: number | null;
  limitRemaining?: number | null;
  /** The fallback model that answered while the chosen model could not, until the chosen one answers again. */
  fallbackModel?: string;
}

export interface ModelInfo {
  id: string;
  images: boolean;
  pricePerMInput: number;
}

export interface ImportPreview {
  add: number;
  update: number;
  renumber: number;
  invalid: string[];
  remove?: { rules: number; exceptions: number }; // replace mode: what disappears
  syncQuota?: true; // the result would not fit browser sync
}

export interface ProtocolMap {
  // content -> background (sender: a tab on a Site's origin, core/sites.ts). getRuntimeState is also allowed from pages.
  getRuntimeState(): RuntimeSnapshot;
  judgeTiles(req: { items: TileFacts[]; settingsGeneration: number }): {
    results: TileResult[];
    rulesVersion: string;
    settingsGeneration: number;
    runtime: RuntimeSnapshot;
    rules?: Record<string, RuleDisplay>; // display data for every ruleId in results (content holds no Rules)
    private?: boolean; // sender tab is incognito: Keep notes say "Kept for this session"
  };
  // escalated: this Removal made an automatic Escalation, the batch summary says so (REQ-ESC-2).
  reportActionResult(req: ActionReport): RuntimeSnapshot & { escalated?: { ruleId: string; channelName: string } };
  // via 'site': the site's own Undo button; 'shoo': Shoo clicked it.
  reportUndo(req: { videoId: string; via: 'site' | 'shoo' }): void;
  recordWouldRemove(req: { results: TileResult[]; batchId: string; tiles?: TileFacts[] }): void;
  reviewPending(req: { count: number }): void;
  reportMarkupCheck(req: { ok: boolean; selectorVersion: string; missing: string[] }): RuntimeSnapshot;
  // The user picked Don't recommend channel on this Tile's YouTube menu (REQ-ACT-5). added: a new Banned channel.
  banChannel(req: { tile: TileFacts }): { ruleId: string; added: boolean } | { error: 'noChannel' | 'privateWindow' | 'off' | 'keptChannel' };
  // YouTube's Undo on that Tile: removes the Banned channel banChannel added for it.
  liftChannelBan(req: { ruleId: string; videoId: string }): void;
  /** A Shelf dismissal succeeded: one shelfDismissed Activity event. Failures are not reported (youtube-integration.md Section 10). */
  reportShelfDismissal(req: { shelf: ShelfId }): void;

  // content or pages -> background
  addException(req: {
    videoId: string;
    title: string;
    channelName?: string;
    ruleId?: string;
    origin: 'reviewKeep' | 'undo' | 'activityKeep';
  }): void;
  openSettings(req: { hash?: string }): void; // background opens the options page at a section, e.g. 'activity?batch=<id>'
  keepChannel(req: {
    channelName?: string;
    channelHandle?: string;
    channelId?: string;
    /** The Site of the Tile the channel was seen on, so the Keep rule matches that Site only. */
    site?: SiteId;
    liftBan?: boolean;
  }): { ruleId: string; liftedBanRuleId?: string; bannedRuleId?: string } | { error: 'noChannel' } | { error: 'privateWindow' };

  // background -> content (one tab)
  runtimeStateChanged(snapshot: RuntimeSnapshot): void;
  settingsChanged(req: { settingsGeneration: number; rulesVersion: string; actOnShowingChips?: boolean }): void;
  undoRemoval(req: { videoId: string }): { ok: true } | { ok: false; reason: 'expired' | 'notFound' };

  // pages -> background (sender: extension page URL)
  updateSettings(req: { patch: Partial<Settings> }): { settings: Settings };
  setMode(req: { mode: Mode; actOnShowingChips?: boolean }): RuntimeSnapshot;
  mutateRules(req: { ops: RuleOp[] }): { rules: Rule[]; rulesVersion: string } | { error: 'syncQuota' | 'invalidInput'; detail: string };
  removeException(req: { videoId: string }): void;
  undoFromActivity(req: { videoId: string }): { ok: true } | { ok: false; reason: 'expired' | 'notFound' };
  confirmEscalation(req: { channelKey: string }): { ruleId: string };
  dismissEscalation(req: { channelKey: string }): void;
  markActivitySeen(req: { ids: string[] }): void;
  resumeFromBreaker(req: { category?: 'model' | 'nativeAction' | 'markup' }): RuntimeSnapshot;
  giveConsent(req: { version: number; customHost?: string }): RuntimeSnapshot;
  withdrawConsent(): RuntimeSnapshot;
  tryTitle(req: { title: string; channelName?: string; durationSec?: number; thumbnailUrl?: string; site?: SiteId }):
    | { result: TileResult; costUsd: number }
    | { error: 'noConsent' | 'noKey' | 'invalidInput' | ReasonCode };
  connectOpenRouter(): { ok: true; label: string } | { ok: false; error: 'cancelled' | 'exchangeFailed' | 'unsupported' };
  exchangeHeadlessCode(req: { code: string }): { ok: true; label: string } | { ok: false; error: 'exchangeFailed' | 'expired' };
  setKey(req: { key: string }): { ok: true; label?: string } | { ok: false; error: 'keyRejected' | 'offline' };
  disconnect(): void;
  getKeyUsage(): KeyUsage | { error: ReasonCode };
  /** Whether a non-empty key is stored for a Decision provider reached directly and for the custom endpoint. */
  getStoredKeys(): { direct: boolean; custom: boolean };
  forgetKey(req: { endpoint: 'direct' | 'custom' }): void;
  /** `key` left out keeps the stored key, only when the saved endpoint has the same origin (else no key). */
  setCustomEndpoint(req: { baseUrl: string; model: string; key?: string }): { ok: true } | { ok: false; error: string };
  testCustomEndpoint(req: { baseUrl: string; model: string; key?: string }): { ok: true; latencyMs: number } | { ok: false; error: string };
  /** A Decision provider without OpenRouter (decision-engine.md §12). `key` left out keeps the stored key, only for the same origin. */
  setDirectEndpoint(req: DirectEndpointRequest): { ok: true } | { ok: false; error: string };
  /** One synthetic Tile, for a model on this computer before consent. Same error strings as testCustomEndpoint. */
  testDirectEndpoint(req: DirectEndpointRequest): { ok: true; latencyMs: number } | { ok: false; error: string };
  listModels(req: { refresh?: boolean }): { models: ModelInfo[]; fetchedAt: number } | { error: ReasonCode };
  exportData(): ShooExport;
  /** `file` is the export file as store/import.ts parseImportFile accepted it, in the options page. */
  importData(req: { file: ParsedImport; mode: 'merge' | 'replace'; dryRun: boolean }): { preview: ImportPreview } | { error: 'invalidInput'; detail: string };
  /** Deletes what Shoo saw and did (Activity, Verdict cache, counts, Escalation, Subscribed channels), keeping Rules, Exceptions and settings. */
  clearHistory(): void;
  resetAll(): void;
}

export type Data<K extends keyof ProtocolMap> = Parameters<ProtocolMap[K]>[0];
export type Reply<K extends keyof ProtocolMap> = ReturnType<ProtocolMap[K]>;

/** Sends a message to the background. Messages without a payload take no `data`. */
export const sendMessage = <K extends keyof ProtocolMap>(type: K, ...data: Data<K> extends undefined ? [data?: undefined] : [data: Data<K>]) =>
  sendWire(type, data[0]) as Promise<Reply<K>>;
