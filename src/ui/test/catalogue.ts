// Test helper, imported first by UI tests for its side effect: serve the real catalogue
// (src/locales/en.yml) through browser.i18n.getMessage with Chrome's $1..$9 rules, so tests assert
// the shipped copy. It must run before ~/i18n loads, because @wxt-dev/browser picks the global
// browser or chrome object at import time. Creates a minimal chrome global when none is stubbed.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateChromeMessages, parseMessagesText } from '@wxt-dev/i18n/build';

const text = readFileSync(resolve(__dirname, '../../locales/en.yml'), 'utf8');
const messages = generateChromeMessages(parseMessagesText(text, 'YAML'));

function getMessage(key: string, subs?: string | string[]): string {
  const message = messages[key]?.message ?? '';
  const list = subs === undefined ? [] : Array.isArray(subs) ? subs : [subs];
  return message.replace(/\$(\$|[1-9])/g, (_, c: string) => (c === '$' ? '$' : (list[Number(c) - 1] ?? '')));
}

type Api = { runtime?: { id?: string }; i18n?: { getMessage?: unknown } };
const g = globalThis as { browser?: Api; chrome?: Api };
g.chrome ??= { runtime: { id: 'shoo-test' } };
for (const api of [g.browser, g.chrome]) {
  if (!api) continue;
  api.i18n = { ...api.i18n, getMessage };
}
