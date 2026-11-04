// RuntimeState and failure counters. Source of truth: docs/spec/architecture.md Section 7 (the precedence
// table is binding) and docs/spec/requirements.md REQ-COST-4.
import { SURFACE_SITE, type SiteId } from './sites';
import {
  SUPPORTED_SURFACES,
  SURFACE_IDS,
  type EyeState,
  type FailureCategory,
  type ReasonCode,
  type RuntimeReason,
  type RuntimeSnapshot,
  type RuntimeStages,
  type Settings,
  type SurfaceId,
} from './types';

export interface RuntimeInputs {
  settings: Settings;
  hasKey: boolean;
  keyRejected?: boolean;
  creditsExhausted?: boolean;
  migrating: boolean;
  hostYouTube: boolean;
  /** Host permission for the active model host: openrouter.ai, or the host of the direct or custom endpoint in use. */
  hostModel: boolean;
  tripped: { model?: number; nativeAction?: number; markup?: number };
  /** The Site whose failures tripped each category. Breakers are shared by every Site. */
  trippedSite?: Partial<Record<FailureCategory, SiteId>>;
  dailyCapReached: boolean;
  offline: boolean;
  rulesVersion: string;
  reviewPending?: number;
  judging?: boolean;
  /** CONSENT_VERSION (store/schema.ts). Consent recorded for an older version no longer counts. */
  consentVersion: number;
  /** Firefox: the optional `data_collection: ['websiteContent']` permission is granted. Always true on Chrome. */
  dataCollection: boolean;
}

/**
 * Base URL of the active endpoint when it is not OpenRouter: the direct Decision provider (engine
 * 'direct') or the custom chat endpoint (engine 'custom'). Undefined for OpenRouter.
 */
export function endpointBase(s: Settings): string | undefined {
  return s.engine === 'direct' ? s.direct?.baseUrl : s.engine === 'custom' ? s.customEndpoint?.baseUrl : undefined;
}

/** Host of a direct or custom endpoint base URL, as stored in `consent.customHost`. Undefined when the URL is invalid. */
export function endpointHost(baseUrl: string): string | undefined {
  try {
    return new URL(baseUrl).host;
  } catch {
    return undefined;
  }
}

/**
 * Host permission pattern for a direct or custom endpoint, the one the page requests and the background checks.
 * Chrome keeps the port: it grants exactly that pattern, and a portless one would ask about every port.
 * Firefox match patterns do not support ports (a pattern with one matches no URL, MDN Match patterns),
 * so Firefox uses the portless host, which the manifest's optional hosts cover.
 */
export function endpointPattern(baseUrl: string, firefox: boolean): string | undefined {
  try {
    const url = new URL(baseUrl);
    return firefox ? `${url.protocol}//${url.hostname}/*` : `${url.origin}/*`;
  } catch {
    return undefined;
  }
}

/**
 * Whether Shoo's own consent covers the active recipient. Consent names its recipient: consent without a
 * `customHost` covers OpenRouter only, consent with one covers that host only (a direct Decision provider
 * or a custom endpoint). Consent recorded for an older `version` than `currentVersion` no longer counts
 * (recipients may have changed).
 */
export function hasConsent(s: Settings, currentVersion: number): boolean {
  const c = s.consent;
  if (!c || c.version < currentVersion) return false;
  if (s.engine === 'openrouter') return c.customHost === undefined;
  const base = endpointBase(s);
  const host = base && endpointHost(base);
  return host !== undefined && c.customHost === host;
}

const ALL: RuntimeStages = { exact: true, model: true, nativeActions: true, ui: true };
const NONE: RuntimeStages = { exact: false, model: false, nativeActions: false, ui: false };
const NO_MODEL: RuntimeStages = { ...ALL, model: false };

interface Active {
  reason: RuntimeReason;
  stages: RuntimeStages;
  eye: EyeState;
  detail?: ReasonCode;
}

/** Active reasons in precedence order (architecture.md Section 7). */
function activeReasons(i: RuntimeInputs): Active[] {
  const s = i.settings;
  const out: Active[] = [];
  if (!s.enabled) out.push({ reason: 'off', stages: NONE, eye: 'paused' });
  if (!hasConsent(s, i.consentVersion) || !i.dataCollection) out.push({ reason: 'noConsent', stages: NO_MODEL, eye: 'watching' });
  if (i.migrating) out.push({ reason: 'migrating', stages: NONE, eye: 'judging' });
  if (!i.hostYouTube) out.push({ reason: 'hostRevoked', stages: NONE, eye: 'error' });
  else if (!i.hostModel) out.push({ reason: 'hostRevoked', stages: NO_MODEL, eye: 'error' });
  if (i.keyRejected) out.push({ reason: 'noKey', stages: NO_MODEL, eye: 'error', detail: 'keyRejected' });
  else if (!i.hasKey) out.push({ reason: 'noKey', stages: NO_MODEL, eye: 'paused' });
  if (i.tripped.nativeAction !== undefined) {
    out.push({ reason: 'breakerNativeAction', stages: { ...ALL, nativeActions: false }, eye: 'error' });
  }
  // Markup breaker: content stops extracting, only the notice shows.
  if (i.tripped.markup !== undefined) out.push({ reason: 'breakerMarkup', stages: { ...NONE, ui: true }, eye: 'error' });
  if (i.creditsExhausted) out.push({ reason: 'breakerModel', stages: NO_MODEL, eye: 'error', detail: 'creditsExhausted' });
  else if (i.tripped.model !== undefined) out.push({ reason: 'breakerModel', stages: NO_MODEL, eye: 'error' });
  if (i.dailyCapReached) out.push({ reason: 'dailyCap', stages: NO_MODEL, eye: 'paused' });
  if (i.offline) out.push({ reason: 'offline', stages: NO_MODEL, eye: 'paused' });
  return out;
}

/**
 * The RuntimeSnapshot: `reason` is the highest-precedence active reason, `stages` is the AND of what every
 * active reason allows, `eye` and `detail` come from the top reason. With no reason active the eye shows
 * 'judging' while a batch is in flight, else 'review' while chips wait, else 'watching'. Unsupported
 * Surfaces are always off.
 */
export function computeRuntime(i: RuntimeInputs): RuntimeSnapshot {
  const active = activeReasons(i);
  const top = active[0];
  const stages = active.reduce<RuntimeStages>(
    (acc, a) => ({
      exact: acc.exact && a.stages.exact,
      model: acc.model && a.stages.model,
      nativeActions: acc.nativeActions && a.stages.nativeActions,
      ui: acc.ui && a.stages.ui,
    }),
    ALL,
  );
  const okEye: EyeState = i.judging ? 'judging' : (i.reviewPending ?? 0) > 0 ? 'review' : 'watching';
  const surfaces = Object.fromEntries(
    SURFACE_IDS.map((id) => [id, SUPPORTED_SURFACES.includes(id) && i.settings.surfaces[id] === true && i.settings.sites[SURFACE_SITE[id]] === true]),
  ) as Record<SurfaceId, boolean>;

  const snapshot: RuntimeSnapshot = {
    enabled: i.settings.enabled,
    mode: i.settings.mode,
    reason: top ? top.reason : 'ok',
    stages,
    eye: top ? top.eye : okEye,
    settingsGeneration: i.settings.generation,
    rulesVersion: i.rulesVersion,
    surfaces,
  };
  if (top?.detail) snapshot.detail = top.detail;
  const site = top?.reason === 'breakerNativeAction' ? i.trippedSite?.nativeAction : top?.reason === 'breakerMarkup' ? i.trippedSite?.markup : undefined;
  if (site) snapshot.site = site;
  if (i.reviewPending !== undefined) snapshot.reviewPending = i.reviewPending;
  return snapshot;
}

export const FAILURE_TRIP_THRESHOLD = 5;

/** `local:runtime`: consecutive failures per category, when each category tripped, and on which Site. */
export interface FailureState {
  failures: Record<FailureCategory, number>;
  tripped: Partial<Record<FailureCategory, number>>;
  trippedSite?: Partial<Record<FailureCategory, SiteId>>;
}

/**
 * Counts one failure. The 5th consecutive failure trips the category (`tripped[cat] = now`, kept until
 * Resume), and records the `site` of that failure. `tripped` is whether the category is tripped after this call,
 * `newlyTripped` whether this call tripped it (show the notice once).
 */
export function recordFailure(
  state: FailureState,
  cat: FailureCategory,
  now: number,
  site?: SiteId,
): { state: FailureState; tripped: boolean; newlyTripped: boolean } {
  const count = state.failures[cat] + 1;
  const already = state.tripped[cat] !== undefined;
  const trips = !already && count >= FAILURE_TRIP_THRESHOLD;
  const next: FailureState = {
    failures: { ...state.failures, [cat]: count },
    tripped: trips ? { ...state.tripped, [cat]: now } : state.tripped,
  };
  if (trips && site) next.trippedSite = { ...state.trippedSite, [cat]: site };
  else if (state.trippedSite) next.trippedSite = state.trippedSite;
  return { state: next, tripped: already || trips, newlyTripped: trips };
}

/** A success resets only its own category's counter. A trip stays until Resume. */
export function recordSuccess(state: FailureState, cat: FailureCategory): { state: FailureState; tripped: boolean } {
  const next: FailureState = { failures: { ...state.failures, [cat]: 0 }, tripped: state.tripped };
  if (state.trippedSite) next.trippedSite = state.trippedSite;
  return { state: next, tripped: state.tripped[cat] !== undefined };
}
