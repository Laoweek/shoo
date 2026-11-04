// Settings sections and links between pages.
import { sendMessage } from '~/messaging/protocol';

export const SECTIONS = ['rules', 'keep', 'banned', 'exceptions', 'activity', 'sites', 'connection', 'advanced'] as const;
export type Section = (typeof SECTIONS)[number];

export interface Route {
  section: Section;
  params: URLSearchParams;
}

/** '#activity?batch=b1' -> { section: 'activity', params: batch=b1 }. Unknown hashes open Rules. */
export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '');
  const [name = '', query = ''] = raw.split('?');
  const section = (SECTIONS as readonly string[]).includes(name) ? (name as Section) : 'rules';
  return { section, params: new URLSearchParams(query) };
}

/**
 * Opens Settings at a section, for example 'connection' or 'activity?batch=<id>'. The background opens
 * the tab (or focuses the open one), so the popup never navigates itself.
 */
export function openSettings(hash?: string): void {
  void sendMessage('openSettings', hash ? { hash } : {});
}

/** External links (openrouter.ai) open in a new tab. */
export function openExternal(url: string): void {
  void browser.tabs.create({ url });
}

export const OPENROUTER_KEYS_URL = 'https://openrouter.ai/keys';
/** Served by GitHub Pages from docs/release/privacy-policy.html. The store listings link the same URL. */
export const PRIVACY_POLICY_URL = 'https://laoweek.github.io/shoo/release/privacy-policy.html';
export const OPENROUTER_CREDITS_URL = 'https://openrouter.ai/settings/credits';
