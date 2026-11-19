// Consent, keys, OAuth, custom endpoint and the model list. Source of truth: docs/spec/decision-engine.md
// Section 7 (paste a key, OAuth PKCE, Disconnect, model picker), docs/spec/requirements.md §12 and §14.
// Never log keys, Authorization headers, OAuth codes or verifiers, or error bodies.
import { directProvider } from '~/core/providers';
import { hasConsent } from '~/core/runtime';
import type { DirectEndpoint } from '~/core/types';
import { testEndpoint } from '~/engine/chat';
import { testDirect } from '~/engine/decisions';
import { checkKey } from '~/engine/key';
import { defaultSleep } from '~/engine/net';
import type { ModelsCache } from '~/engine/models';
import { connectOpenRouter, exchangeHeadlessCode, KEY_LABEL, startHeadless } from '~/engine/oauth';
import { getOne } from '~/store/areas';
import { MODELS_KEY } from '~/store/local';
import { CONSENT_VERSION } from '~/store/schema';
import {
  clearCustomKey,
  clearDirectKey,
  clearOpenRouterKey,
  getCustomKey,
  getDirectKey,
  getOpenRouterKey,
  setCustomKey,
  setDirectKey,
  setOpenRouterKey,
} from '~/store/secret';
import { isBool, isEndpointUrl, isHttpUrl, isLocalHost, isNonEmpty, isNum, isRecord, isShortStr, isStr, optional } from '../guards';
import type { Routes } from '../router';
import type { RuntimeRecord } from '../runtime-state';
import type { Services } from '../services';
import { applySettings } from './settings';

const KEY_MAX = 500;
const isKey = (v: unknown): v is string => isNonEmpty(v) && v.length <= KEY_MAX;
const isEndpoint = (v: unknown) =>
  isRecord(v) && isEndpointUrl(v.baseUrl) && isNonEmpty(v.model) && isShortStr(v.model) && optional(v.key, (k): k is string => isStr(k) && k.length <= KEY_MAX);

/**
 * A direct endpoint (decision-engine.md §12): a known provider, and an address on that provider's own
 * host (a cloud provider) or on this computer (a local one), so a key can only go where the user chose.
 */
const isDirect = (v: unknown): v is DirectEndpoint & { key?: string } => {
  if (!isRecord(v) || !isHttpUrl(v.baseUrl) || !isShortStr(v.model) || !optional(v.key, (k): k is string => isStr(k) && k.length <= KEY_MAX)) return false;
  const p = directProvider(v.provider as string);
  if (!p || !isNonEmpty(v.model)) return false;
  const url = new URL(v.baseUrl);
  return p.local ? url.protocol === 'http:' && isLocalHost(url) : url.origin === new URL(p.baseUrl).origin;
};

const originOf = (url: string): string | undefined => {
  try {
    return new URL(url.trim()).origin;
  } catch {
    return undefined;
  }
};

export function connectionRoutes(
  s: Services,
): Pick<
  Routes,
  | 'giveConsent'
  | 'withdrawConsent'
  | 'setKey'
  | 'connectOpenRouter'
  | 'exchangeHeadlessCode'
  | 'disconnect'
  | 'getKeyUsage'
  | 'getStoredKeys'
  | 'forgetKey'
  | 'setCustomEndpoint'
  | 'testCustomEndpoint'
  | 'setDirectEndpoint'
  | 'testDirectEndpoint'
  | 'listModels'
> {
  const { platform, state } = s;
  const { local } = platform.areas;

  /** A new key: key state and usage memo start fresh, RuntimeState is recomputed. */
  async function keyChanged(): Promise<void> {
    s.keyUsage.clear();
    await state.clearFlags('keyRejected', 'creditsExhausted');
    await state.refresh();
  }

  /**
   * Whether Shoo may send anything to OpenRouter on its own: OpenRouter is the Decision provider in use, consent
   * names it at the current version and, on Firefox, the data collection permission is still granted. Without
   * consent the privacy policy promises nothing goes to OpenRouter, so the key is neither checked nor used.
   */
  async function openRouterAllowed(): Promise<boolean> {
    const settings = await s.writer.getSettings();
    return settings.engine === 'openrouter' && hasConsent(settings, CONSENT_VERSION) && platform.dataCollection().catch(() => false);
  }

  /** OAuth step 6: store with label 'Shoo' and the connect date, then confirm with GET /api/v1/key once consent allows it. */
  async function storeOAuthKey(key: string): Promise<boolean> {
    await setOpenRouterKey({ key, source: 'oauth', label: KEY_LABEL, connectedAt: s.now() }, local);
    const check = (await openRouterAllowed()) ? await checkKey(platform.fetch, key) : undefined;
    if (check && !check.ok && check.error === 'keyRejected') {
      await clearOpenRouterKey(local);
      await keyChanged();
      return false;
    }
    await keyChanged();
    return true;
  }

  /** What testCustomEndpoint and testDirectEndpoint call the endpoint with. */
  const testDeps = { fetch: platform.fetch, sleep: platform.sleep ?? defaultSleep, now: s.now };

  const snapshotForPage = async () => state.snapshot(await state.activeTabId());

  /**
   * The key for a custom or direct endpoint request. Left out, the stored key is reused only when that saved
   * endpoint has the same origin, so a stored key never reaches another host. Otherwise the endpoint gets no key.
   */
  async function requestKey(endpoint: 'custom' | 'direct', baseUrl: string, key: string | undefined): Promise<string> {
    if (key !== undefined) return key.trim();
    const settings = await s.writer.getSettings();
    const saved = endpoint === 'custom' ? settings.customEndpoint : settings.direct;
    if (!saved || originOf(saved.baseUrl) !== originOf(baseUrl)) return '';
    return (await (endpoint === 'custom' ? getCustomKey : getDirectKey)(local))?.key ?? '';
  }

  const directOf = (r: DirectEndpoint): DirectEndpoint => ({ provider: r.provider, baseUrl: r.baseUrl.trim(), model: r.model.trim() });

  return {
    giveConsent: {
      from: 'page',
      valid: (v) => isRecord(v) && isNum(v.version) && v.version >= 1 && optional(v.customHost, isNonEmpty),
      async run({ version, customHost }) {
        await applySettings(s, { consent: { version, acceptedAt: s.now(), ...(customHost && { customHost }) } });
        return snapshotForPage();
      },
    },

    withdrawConsent: {
      from: 'page',
      valid: () => true,
      async run() {
        await applySettings(s, { consent: undefined });
        return snapshotForPage();
      },
    },

    setKey: {
      from: 'page',
      valid: (v) => isRecord(v) && isKey(v.key),
      invalid: { ok: false, error: 'keyRejected' },
      async run({ key }) {
        const trimmed = key.trim();
        // Before consent the key is stored unchecked. getKeyUsage checks it once consent allows it.
        if (!(await openRouterAllowed())) {
          await setOpenRouterKey({ key: trimmed, source: 'pasted', connectedAt: s.now() }, local);
          await keyChanged();
          return { ok: true };
        }
        const check = await checkKey(platform.fetch, trimmed);
        // A 5xx from /api/v1/key is not a verdict on the key: report it like a network problem.
        if (!check.ok) return { ok: false, error: check.error === 'keyRejected' ? 'keyRejected' : 'offline' };
        const label = check.info.label;
        await setOpenRouterKey({ key: trimmed, source: 'pasted', connectedAt: s.now(), ...(label && { label }) }, local);
        await keyChanged();
        return label ? { ok: true, label } : { ok: true };
      },
    },

    connectOpenRouter: {
      from: 'page',
      valid: () => true,
      async run() {
        const r = await connectOpenRouter(s.oauth);
        if (!r.ok) {
          // Step 7: the browser flow failed, open OpenRouter's headless page. The page offers the code box.
          if (r.error === 'unsupported') await platform.tabs.create({ url: await startHeadless(s.oauth) });
          return r;
        }
        return (await storeOAuthKey(r.key)) ? { ok: true, label: r.label } : { ok: false, error: 'exchangeFailed' };
      },
    },

    exchangeHeadlessCode: {
      from: 'page',
      valid: (v) => isRecord(v) && isNonEmpty(v.code) && v.code.length <= KEY_MAX,
      invalid: { ok: false, error: 'exchangeFailed' },
      async run({ code }) {
        const r = await exchangeHeadlessCode(s.oauth, code);
        if (!r.ok) return r;
        return (await storeOAuthKey(r.key)) ? { ok: true, label: r.label } : { ok: false, error: 'exchangeFailed' };
      },
    },

    disconnect: {
      from: 'page',
      valid: () => true,
      async run() {
        await clearOpenRouterKey(local);
        await keyChanged();
      },
    },

    getKeyUsage: {
      from: 'page',
      valid: () => true,
      async run() {
        const stored = await getOpenRouterKey(local);
        if (!stored) return { error: 'noKey' };
        if (!(await openRouterAllowed())) return { ...(stored.label && { label: stored.label }), source: stored.source, connectedAt: stored.connectedAt };
        const check = await s.keyUsage.get(stored.key);
        if (!check.ok) {
          if (check.error === 'keyRejected') {
            await state.setFlag('keyRejected');
            await state.refresh();
          }
          return { error: check.error };
        }
        const record = (await s.writer.getRuntime()) as RuntimeRecord;
        // A 200 proves the key works: lift a rejected-key state (a 403 can also come from the Decisions API).
        if (record.keyRejected !== undefined) {
          await state.clearFlags('keyRejected');
          await state.refresh();
        }
        const label = stored.label ?? check.info.label;
        return {
          ...(label && { label }),
          source: stored.source,
          connectedAt: stored.connectedAt,
          usage: check.info.usage,
          ...(check.info.usageDaily !== undefined && { usageDaily: check.info.usageDaily }),
          limit: check.info.limit,
          limitRemaining: check.info.limitRemaining,
          ...(record.fallbackModel && { fallbackModel: record.fallbackModel }),
        };
      },
    },

    getStoredKeys: {
      from: 'page',
      valid: () => true,
      async run() {
        const [direct, custom] = await Promise.all([getDirectKey(local), getCustomKey(local)]);
        return { direct: !!direct?.key, custom: !!custom?.key };
      },
    },

    /** Forgets a Decision provider's or the custom endpoint's key on this device. Its endpoint stays saved, without a key. */
    forgetKey: {
      from: 'page',
      valid: (v) => isRecord(v) && (v.endpoint === 'direct' || v.endpoint === 'custom'),
      async run({ endpoint }) {
        await (endpoint === 'direct' ? clearDirectKey(local) : clearCustomKey(local));
        await state.refresh();
      },
    },

    /**
     * Saves the custom endpoint (base URL, chat model, key) and switches the engine to it. Consent names a
     * host, so the model stays off (noConsent) until giveConsent runs again with this endpoint's host.
     */
    setCustomEndpoint: {
      from: 'page',
      valid: isEndpoint,
      invalid: { ok: false, error: 'invalidInput' },
      async run({ baseUrl, model, key }) {
        await setCustomKey({ key: await requestKey('custom', baseUrl, key) }, local);
        s.keyUsage.clear();
        // A new endpoint and key: a rejected-key or credits state from the previous engine no longer applies.
        await state.clearFlags('keyRejected', 'creditsExhausted');
        await applySettings(s, { customEndpoint: { baseUrl: baseUrl.trim(), model: model.trim() }, engine: 'custom' });
        return { ok: true };
      },
    },

    testCustomEndpoint: {
      from: 'page',
      valid: isEndpoint,
      invalid: { ok: false, error: 'invalidInput' },
      // Only an endpoint on this computer is checked, before consent: a call online spends the user's credit.
      // Trimmed like setCustomEndpoint saves them, so the test checks what will be stored.
      run: async (req) =>
        isLocalHost(new URL(req.baseUrl))
          ? testEndpoint(
              testDeps,
              { baseUrl: req.baseUrl.trim(), model: req.model.trim(), key: await requestKey('custom', req.baseUrl, req.key) },
            )
          : { ok: false, error: 'invalidInput' },
    },

    /**
     * Saves a direct Decision provider (§12) and switches the engine to it. Consent names a host, so the
     * model stays off (noConsent) until giveConsent runs with this endpoint's host.
     */
    setDirectEndpoint: {
      from: 'page',
      valid: isDirect,
      invalid: { ok: false, error: 'invalidInput' },
      async run(req) {
        const key = await requestKey('direct', req.baseUrl, req.key);
        // A provider online needs its key: saved without one, every request would come back 401.
        if (!key && !directProvider(req.provider)!.local) return { ok: false, error: 'noKey' };
        await setDirectKey({ key }, local);
        s.keyUsage.clear();
        await state.clearFlags('keyRejected', 'creditsExhausted');
        await applySettings(s, { direct: directOf(req), engine: 'direct' });
        return { ok: true };
      },
    },

    testDirectEndpoint: {
      from: 'page',
      valid: isDirect,
      invalid: { ok: false, error: 'invalidInput' },
      // Only a model on this computer is checked before consent: a call online spends the user's credit.
      run: async (req) =>
        directProvider(req.provider)!.local
          ? testDirect(testDeps, directOf(req), await requestKey('direct', req.baseUrl, req.key))
          : { ok: false, error: 'invalidInput' },
    },

    listModels: {
      from: 'page',
      valid: (v) => v === undefined || (isRecord(v) && optional(v.refresh, isBool)),
      invalid: { error: 'invalidInput' },
      // GET /api/v1/models goes to OpenRouter too, so before consent only the stored list is served.
      run: async (req) => {
        if (await openRouterAllowed()) return s.catalog.list(req?.refresh ? { refresh: true } : {});
        return (await getOne<ModelsCache>(local, MODELS_KEY)) ?? { error: 'noConsent' };
      },
    },
  };
}
