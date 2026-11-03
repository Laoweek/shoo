import { describe, expect, it } from 'vitest';
import { CONSENT_VERSION, DEFAULT_SETTINGS } from '~/store/schema';
import { hasConsent } from './consent';

describe('hasConsent (pages)', () => {
  const at = 1;
  it('needs consent at the current version', () => {
    expect(hasConsent(undefined)).toBe(false);
    expect(hasConsent(DEFAULT_SETTINGS)).toBe(false);
    expect(hasConsent({ ...DEFAULT_SETTINGS, consent: { version: CONSENT_VERSION, acceptedAt: at } })).toBe(true);
    expect(hasConsent({ ...DEFAULT_SETTINGS, consent: { version: CONSENT_VERSION - 1, acceptedAt: at } })).toBe(false);
  });

  it('does not count consent for a custom host as consent for OpenRouter', () => {
    const consent = { version: CONSENT_VERSION, acceptedAt: at, customHost: 'llm.example.com' };
    expect(hasConsent({ ...DEFAULT_SETTINGS, engine: 'openrouter', consent })).toBe(false);
    const customEndpoint = { baseUrl: 'https://llm.example.com/v1', model: 'm' };
    expect(hasConsent({ ...DEFAULT_SETTINGS, engine: 'custom', customEndpoint, consent })).toBe(true);
  });
});
