// Consent and permission prompts. Browsers only show a permission prompt for a user gesture, and
// Firefox rejects `permissions.request` once the click handler has awaited anything
// (docs/spec/cross-browser-and-stores.md Section 2). So every helper here calls
// `browser.permissions.request` synchronously and returns its promise for the caller to await.
import { hasConsent as coreHasConsent } from '~/core/runtime';
import { SITE_HOSTS, type SiteId } from '~/core/sites';
import type { ReasonCode, Settings } from '~/core/types';
import { sendMessage, type KeyUsage } from '~/messaging/protocol';
import { CONSENT_VERSION } from '~/store/schema';

/** Firefox data collection categories Shoo asks for when the user agrees (cross-browser-and-stores.md Section 1, "Data collection and consent"). */
export const DATA_COLLECTION = ['websiteContent', 'authenticationInfo'] as const;

/** YouTube's and OpenRouter's hosts, which Connection checks and asks for again after a revoke. Each Site's hosts are handled in Settings, Sites. */
export const REQUIRED_ORIGINS = ['https://www.youtube.com/*', 'https://openrouter.ai/*', 'https://i.ytimg.com/*'];

type PermissionsWithDataCollection = { data_collection?: readonly string[]; origins?: string[] };

/**
 * Firefox only: asks for the optional data collection permission. Must be the first statement of a
 * click handler. Chrome has no such API and resolves true.
 */
export function requestDataCollection(isFirefox: boolean = IS_FIREFOX): Promise<boolean> {
  if (!isFirefox) return Promise.resolve(true);
  const request = browser.permissions.request as (p: PermissionsWithDataCollection) => Promise<boolean>;
  return request({ data_collection: DATA_COLLECTION });
}

/** The Firefox build. Compares BROWSER because FIREFOX is a string, not a boolean, in tests. */
export const IS_FIREFOX = import.meta.env.BROWSER === 'firefox';

/** Host access for one origin, e.g. a custom endpoint. Must be the first statement of a click handler. */
export function requestOrigins(origins: string[]): Promise<boolean> {
  return browser.permissions.request({ origins });
}

/**
 * Whether Shoo still has access to the Site's pages: the user can take it away in the browser's settings. Without
 * the image host only Thumbnail rules lose their thumbnails, so it is not checked here.
 */
export function hasSiteAccess(site: SiteId): Promise<boolean> {
  return browser.permissions.contains({ origins: [SITE_HOSTS[site][0]!] });
}

/** Asks for a Site's host access again. Must be the first statement of a click handler. */
export function requestSiteAccess(site: SiteId): Promise<boolean> {
  return browser.permissions.request({ origins: [...SITE_HOSTS[site]] });
}

/** Calls `cb` when any permission is added or removed (here, in the browser's settings, or by the background). */
export function watchPermissions(cb: () => void): () => void {
  browser.permissions.onAdded.addListener(cb);
  browser.permissions.onRemoved.addListener(cb);
  return () => {
    browser.permissions.onAdded.removeListener(cb);
    browser.permissions.onRemoved.removeListener(cb);
  };
}

/**
 * Whether Shoo may send Tile data, the same check as core/runtime.ts: consent at the current version,
 * and for a custom endpoint, consent that names its host.
 */
export function hasConsent(s: Settings | undefined): boolean {
  return !!s && coreHasConsent(s, CONSENT_VERSION);
}

/** Origin of a custom endpoint base URL. https anywhere, http only for localhost (the manifest's optional hosts). */
export function endpointOrigin(baseUrl: string): string | undefined {
  try {
    const url = new URL(baseUrl.trim());
    if (url.protocol === 'https:') return url.origin;
    if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return url.origin;
  } catch {
    // fall through
  }
  return undefined;
}

/**
 * What getKeyUsage says about the OpenRouter key: 'connected' (usage may still be unavailable, for
 * example offline), 'rejected' (OpenRouter answered 401), 'none', or 'unknown' while loading.
 */
export function keyState(key: KeyUsage | { error: ReasonCode } | undefined): 'connected' | 'rejected' | 'none' | 'unknown' {
  if (!key) return 'unknown';
  if (!('error' in key)) return 'connected';
  if (key.error === 'noKey') return 'none';
  if (key.error === 'keyRejected') return 'rejected';
  return 'connected';
}

export interface ConsentClickOptions {
  /** Defaults to the build target. Tests pass true to exercise the Firefox path. */
  isFirefox?: boolean;
  /** Custom endpoint host the consent names (Connection, custom endpoint). */
  customHost?: string;
  /** granted false: the browser prompt was declined, Shoo stays on Exact rules only. */
  onDone: (granted: boolean) => void;
  onError?: () => void;
}

/**
 * Click handler for "Agree and continue" and "Give consent": on Firefox the data collection prompt is
 * requested as the very first statement, before any await, then Shoo records its own consent with
 * giveConsent. Declining the browser prompt records nothing.
 */
export function consentClick(o: ConsentClickOptions): () => void {
  return () => {
    const permission = requestDataCollection(o.isFirefox);
    void (async () => {
      let granted: boolean;
      try {
        granted = await permission;
      } catch {
        granted = false;
      }
      if (!granted) return o.onDone(false);
      try {
        await sendMessage('giveConsent', { version: CONSENT_VERSION, ...(o.customHost ? { customHost: o.customHost } : {}) });
        o.onDone(true);
      } catch {
        o.onError?.();
      }
    })();
  };
}
