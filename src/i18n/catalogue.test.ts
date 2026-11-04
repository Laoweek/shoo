// Every translated catalogue carries the same messages as en.yml, so a new key never shows in English inside a
// translated UI, and every placeholder and plural form still gets filled.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateChromeMessages, parseMessagesText } from '@wxt-dev/i18n/build';
import { describe, expect, it } from 'vitest';

const read = (locale: string) => generateChromeMessages(parseMessagesText(readFileSync(resolve(__dirname, `../locales/${locale}.yml`), 'utf8'), 'YAML'));

/** Plural groups become "1 form | n form". */
const shape = (message: string) => ({
  forms: message.split(' | ').length,
  placeholders: [...new Set(message.match(/\{\w+\}|\$1/g) ?? [])].sort(),
});

describe('translated catalogues', () => {
  const en = read('en');
  for (const locale of ['zh_CN']) {
    it(`${locale} has every message of en.yml, with the same placeholders and plural forms`, () => {
      const translated = read(locale);
      expect(Object.keys(translated).sort()).toEqual(Object.keys(en).sort());
      for (const [key, { message }] of Object.entries(en)) {
        expect({ key, ...shape(translated[key]?.message ?? '') }).toEqual({ key, ...shape(message) });
      }
    });
  }
});
