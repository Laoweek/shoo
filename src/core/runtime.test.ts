import { describe, expect, it } from 'vitest';
import { computeRuntime, endpointBase, endpointHost, endpointPattern, FAILURE_TRIP_THRESHOLD, hasConsent, recordFailure, recordSuccess, type FailureState, type RuntimeInputs } from './runtime';
import type { EyeState, RuntimeReason, RuntimeStages, Settings } from './types';

const settings = (over: Partial<Settings> = {}): Settings => ({
  generation: 7,
  enabled: true,
  mode: 'review',
  surfaces: { home: true, watchSidebar: true, shortsShelf: false, search: true, channel: true, endScreen: true },
  notificationStyle: 'summary',
  dailyCap: 5000,
  escalationMode: 'suggest',
  strength: { preset: 'balanced', custom: 0.6 },
  engine: 'openrouter',
  models: { text: 'cloudflare/clef-flash', image: 'cloudflare/clef-flash' },
  consent: { version: 1, acceptedAt: 1 },
  regexEnabled: false,
  ...over,
});

const inputs = (over: Partial<RuntimeInputs> = {}): RuntimeInputs => ({
  settings: settings(),
  hasKey: true,
  migrating: false,
  hostYouTube: true,
  hostModel: true,
  tripped: {},
  dailyCapReached: false,
  offline: false,
  rulesVersion: 'rv',
  consentVersion: 1,
  dataCollection: true,
  ...over,
});

const S = (exact: boolean, model: boolean, nativeActions: boolean, ui: boolean): RuntimeStages => ({ exact, model, nativeActions, ui });

describe('computeRuntime: each reason alone (architecture.md Section 7)', () => {
  it.each<[string, Partial<RuntimeInputs>, RuntimeReason | 'ok', RuntimeStages, EyeState, string?]>([
    ['off', { settings: settings({ enabled: false }) }, 'off', S(false, false, false, false), 'paused'],
    ['noConsent', { settings: settings({ consent: undefined }) }, 'noConsent', S(true, false, true, true), 'watching'],
    ['migrating', { migrating: true }, 'migrating', S(false, false, false, false), 'judging'],
    ['hostRevoked youtube.com', { hostYouTube: false }, 'hostRevoked', S(false, false, false, false), 'error'],
    ['hostRevoked openrouter.ai', { hostModel: false }, 'hostRevoked', S(true, false, true, true), 'error'],
    ['noKey', { hasKey: false }, 'noKey', S(true, false, true, true), 'paused'],
    ['noKey after a 401', { keyRejected: true }, 'noKey', S(true, false, true, true), 'error', 'keyRejected'],
    ['breakerNativeAction', { tripped: { nativeAction: 1 } }, 'breakerNativeAction', S(true, true, false, true), 'error'],
    ['breakerMarkup', { tripped: { markup: 1 } }, 'breakerMarkup', S(false, false, false, true), 'error'],
    ['breakerModel', { tripped: { model: 1 } }, 'breakerModel', S(true, false, true, true), 'error'],
    ['breakerModel on 402', { creditsExhausted: true }, 'breakerModel', S(true, false, true, true), 'error', 'creditsExhausted'],
    ['dailyCap', { dailyCapReached: true }, 'dailyCap', S(true, false, true, true), 'paused'],
    ['offline', { offline: true }, 'offline', S(true, false, true, true), 'paused'],
    ['ok', {}, 'ok', S(true, true, true, true), 'watching'],
  ])('%s', (_, over, reason, stages, eye, detail) => {
    const snap = computeRuntime(inputs(over));
    expect(snap.reason).toBe(reason);
    expect(snap.stages).toEqual(stages);
    expect(snap.eye).toBe(eye);
    expect(snap.detail).toBe(detail);
  });
});

describe('computeRuntime: combinations', () => {
  const all: Partial<RuntimeInputs> = {
    settings: settings({ enabled: false, consent: undefined }),
    migrating: true,
    hostYouTube: false,
    hasKey: false,
    keyRejected: true,
    tripped: { model: 1, nativeAction: 1, markup: 1 },
    creditsExhausted: true,
    dailyCapReached: true,
    offline: true,
  };
  const order: RuntimeReason[] = [
    'off',
    'noConsent',
    'migrating',
    'hostRevoked',
    'noKey',
    'breakerNativeAction',
    'breakerMarkup',
    'breakerModel',
    'dailyCap',
    'offline',
  ];
  // Clears reasons from the top one at a time and checks the next one takes over.
  const clearers: Partial<RuntimeInputs>[] = [
    { settings: settings({ consent: undefined }) },
    { settings: settings() },
    { migrating: false },
    { hostYouTube: true },
    { hasKey: true, keyRejected: false },
    { tripped: { model: 1, markup: 1 } },
    { tripped: { model: 1 } },
    { tripped: {}, creditsExhausted: false },
    { dailyCapReached: false },
    { offline: false },
  ];

  it('reports the highest-precedence reason as each one clears', () => {
    let state: Partial<RuntimeInputs> = { ...all };
    for (let i = 0; i < order.length; i++) {
      expect(computeRuntime(inputs(state)).reason).toBe(order[i]);
      state = { ...state, ...clearers[i] };
    }
    expect(computeRuntime(inputs(state)).reason).toBe('ok');
  });

  it('ANDs the stages of every active reason', () => {
    // breakerNativeAction allows the model, dailyCap does not: neither runs.
    const snap = computeRuntime(inputs({ tripped: { nativeAction: 1 }, dailyCapReached: true }));
    expect(snap.reason).toBe('breakerNativeAction');
    expect(snap.stages).toEqual(S(true, false, false, true));
    // noConsent allows Exact stages, breakerMarkup does not.
    expect(computeRuntime(inputs({ settings: settings({ consent: undefined }), tripped: { markup: 1 } })).stages).toEqual(S(false, false, false, true));
  });

  it('takes eye and detail from the top reason only', () => {
    const snap = computeRuntime(inputs({ offline: true, creditsExhausted: true }));
    expect(snap).toMatchObject({ reason: 'breakerModel', detail: 'creditsExhausted', eye: 'error' });
    const covered = computeRuntime(inputs({ settings: settings({ enabled: false }), keyRejected: true }));
    expect(covered).toMatchObject({ reason: 'off', eye: 'paused' });
    expect(covered.detail).toBeUndefined();
  });
});

describe('computeRuntime: ok details', () => {
  it.each<[Partial<RuntimeInputs>, EyeState]>([
    [{ judging: true }, 'judging'],
    [{ reviewPending: 3 }, 'review'],
    [{ reviewPending: 3, judging: true }, 'judging'],
    [{ reviewPending: 0 }, 'watching'],
  ])('%j -> eye %s', (over, eye) => {
    expect(computeRuntime(inputs(over)).eye).toBe(eye);
  });

  it('copies settings, forces unsupported Surfaces off and passes reviewPending through', () => {
    const snap = computeRuntime(inputs({ reviewPending: 2 }));
    expect(snap).toMatchObject({ enabled: true, mode: 'review', settingsGeneration: 7, rulesVersion: 'rv', reviewPending: 2 });
    expect(snap.surfaces).toEqual({ home: true, watchSidebar: true, shortsShelf: false, search: false, channel: false, endScreen: false });
    expect('reviewPending' in computeRuntime(inputs())).toBe(false);
  });
});

describe('consent for a custom endpoint', () => {
  const custom = (consentHost: string | undefined, baseUrl: string | null) =>
    settings({
      engine: 'custom',
      ...(baseUrl === null ? {} : { customEndpoint: { baseUrl, model: 'm' } }),
      consent: { version: 1, acceptedAt: 1, ...(consentHost === undefined ? {} : { customHost: consentHost }) },
    });

  it.each<[string, Settings, RuntimeReason | 'ok']>([
    ['host matches', custom('llm.example:8443', 'https://LLM.example:8443/v1'), 'ok'],
    ['host differs', custom('other.example', 'https://llm.example/v1'), 'noConsent'],
    ['consent names no host', custom(undefined, 'https://llm.example/v1'), 'noConsent'],
    ['endpoint missing', custom('llm.example', null), 'noConsent'],
    ['endpoint URL invalid', custom('llm.example', 'not a url'), 'noConsent'],
  ])('%s', (_, s, reason) => {
    expect(computeRuntime(inputs({ settings: s })).reason).toBe(reason);
  });

  it('a direct Decision provider needs consent naming its host, like a custom endpoint', () => {
    const direct = (consentHost: string | undefined) =>
      settings({
        engine: 'direct',
        direct: { provider: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'clef-flash' },
        consent: { version: 1, acceptedAt: 1, ...(consentHost === undefined ? {} : { customHost: consentHost }) },
      });
    expect(computeRuntime(inputs({ settings: direct('localhost:11434') })).reason).toBe('ok');
    expect(computeRuntime(inputs({ settings: direct(undefined) })).reason).toBe('noConsent');
    expect(computeRuntime(inputs({ settings: direct('llm.example') })).reason).toBe('noConsent');
    expect(computeRuntime(inputs({ settings: settings({ engine: 'direct', consent: { version: 1, acceptedAt: 1, customHost: 'x' } }) })).reason).toBe('noConsent');
    expect(endpointBase(direct('x'))).toBe('http://localhost:11434/v1');
    expect(endpointBase(settings())).toBeUndefined();
  });

  it('endpointHost returns host with port, or undefined', () => {
    expect(endpointHost('https://a.example:1/x')).toBe('a.example:1');
    expect(endpointHost('nope')).toBeUndefined();
  });
});

describe('consent names its recipient and its version', () => {
  it('consent given for a custom host is not consent for OpenRouter', () => {
    const s = settings({ consent: { version: 1, acceptedAt: 1, customHost: 'llm.example' } });
    expect(computeRuntime(inputs({ settings: s })).reason).toBe('noConsent');
    expect(hasConsent(s, 1)).toBe(false);
    expect(hasConsent(settings(), 1)).toBe(true);
  });

  it('consent recorded for an older version counts as noConsent, a newer one still counts', () => {
    expect(computeRuntime(inputs({ consentVersion: 2 })).reason).toBe('noConsent');
    expect(computeRuntime(inputs({ settings: settings({ consent: { version: 3, acceptedAt: 1 } }), consentVersion: 2 })).reason).toBe('ok');
    const custom = settings({ engine: 'custom', customEndpoint: { baseUrl: 'https://llm.example/v1', model: 'm' }, consent: { version: 1, acceptedAt: 1, customHost: 'llm.example' } });
    expect(hasConsent(custom, 1)).toBe(true);
    expect(hasConsent(custom, 2)).toBe(false);
  });

  it('a revoked Firefox data collection permission counts as noConsent', () => {
    const snap = computeRuntime(inputs({ dataCollection: false }));
    expect(snap.reason).toBe('noConsent');
    expect(snap.stages).toEqual(S(true, false, true, true));
  });
});

describe('failure counters (REQ-COST-4)', () => {
  const fresh: FailureState = { failures: { model: 0, nativeAction: 0, markup: 0 }, tripped: {} };

  it('trips a category on the 5th consecutive failure, once', () => {
    let state = fresh;
    for (let i = 1; i < FAILURE_TRIP_THRESHOLD; i++) {
      const out = recordFailure(state, 'model', i);
      expect(out).toMatchObject({ tripped: false, newlyTripped: false });
      state = out.state;
    }
    const fifth = recordFailure(state, 'model', 500);
    expect(fifth).toMatchObject({ tripped: true, newlyTripped: true });
    expect(fifth.state.tripped).toEqual({ model: 500 });
    const sixth = recordFailure(fifth.state, 'model', 600);
    expect(sixth).toMatchObject({ tripped: true, newlyTripped: false });
    expect(sixth.state.tripped.model).toBe(500);
    expect(state.tripped).toEqual({}); // inputs untouched
  });

  it('a success resets only its own category and keeps a trip until Resume', () => {
    const state: FailureState = { failures: { model: 3, nativeAction: 4, markup: 5 }, tripped: { markup: 9 } };
    expect(recordSuccess(state, 'model')).toEqual({ state: { failures: { model: 0, nativeAction: 4, markup: 5 }, tripped: { markup: 9 } }, tripped: false });
    expect(recordSuccess(state, 'markup').tripped).toBe(true);
    expect(state.failures.model).toBe(3);
  });
});

describe('endpointPattern', () => {
  it('keeps the port on Chrome and drops it on Firefox, where a pattern with a port matches no URL', () => {
    expect(endpointPattern('http://localhost:11434/v1', false)).toBe('http://localhost:11434/*');
    expect(endpointPattern('http://localhost:11434/v1', true)).toBe('http://localhost/*');
    expect(endpointPattern('http://127.0.0.1:1234/v1', true)).toBe('http://127.0.0.1/*');
    expect(endpointPattern('https://api.groq.com/openai/v1', false)).toBe('https://api.groq.com/*');
    expect(endpointPattern('https://api.groq.com/openai/v1', true)).toBe('https://api.groq.com/*');
    expect(endpointPattern('not a url', false)).toBeUndefined();
  });
});
