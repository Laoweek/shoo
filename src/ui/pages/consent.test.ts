import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateChromeMessages, parseMessagesText } from '@wxt-dev/i18n/build';
import { describe, expect, it } from 'vitest';
import { fnv1a64 } from '~/core/ids';
import { CONSENT_VERSION, DEFAULT_SETTINGS } from '~/store/schema';
import { hasConsent } from './consent';

describe('CONSENT_VERSION', () => {
  it('is raised with every change to the consent rows (ui-design.md Section 7)', () => {
    const en = generateChromeMessages(parseMessagesText(readFileSync(resolve(__dirname, '../../locales/en.yml'), 'utf8'), 'YAML'));
    const rows = Object.entries(en)
      .filter(([key]) => key.startsWith('onboarding_what_sends_'))
      .map(([key, { message }]) => `${key}=${message}`)
      .sort()
      .join('\n');
    // A failure here means the rows changed: raise CONSENT_VERSION, say why in schema.ts, then record the new hash.
    expect({ version: CONSENT_VERSION, rows: fnv1a64(rows) }).toEqual({ version: 4, rows: '8a7bd36286b546b6' });
  });
});

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
