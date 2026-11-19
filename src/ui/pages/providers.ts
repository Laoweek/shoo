// The provider choice on onboarding step 2 and Settings, Connection (docs/spec/ui-design.md Sections 6
// and 7): OpenRouter, or a Decision provider reached directly (core/providers.ts), online or on this
// computer. Commands and sources: docs/spec/decision-engine.md Sections 6.1 and 12.4.
import type { DirectProviderId } from '~/core/providers';

export type ProviderId = 'openrouter' | DirectProviderId;

export const ONLINE: readonly ProviderId[] = ['openrouter', 'cloudflare', 'typesafe', 'perplexity'];
export const LOCAL: readonly ProviderId[] = ['ollama', 'llamacpp', 'lmstudio'];

/** Each provider's display name, a brand name, not translated. */
export const PROVIDER_NAMES: Record<ProviderId, string> = {
  openrouter: 'OpenRouter',
  cloudflare: 'Cloudflare',
  typesafe: 'TypeSafe',
  perplexity: 'Perplexity',
  ollama: 'Ollama',
  llamacpp: 'llama.cpp',
  lmstudio: 'LM Studio',
};

/** Where an online Decision provider explains how to get a key. */
export const KEY_URLS: Partial<Record<DirectProviderId, string>> = {
  cloudflare: 'https://developers.cloudflare.com/workers-ai/get-started/rest-api/',
  typesafe: 'https://docs.typesafe.ai/api',
  perplexity: 'https://docs.perplexity.ai/docs/decisions/quickstart',
};

/** Addresses the chat model form can fill in for a chat model on this computer (decision-engine.md Section 6.1). */
export const CHAT_LOCAL = [
  { name: 'Ollama', baseUrl: 'http://localhost:11434/v1' },
  { name: 'LM Studio', baseUrl: 'http://localhost:1234/v1' },
] as const;

export const OLLAMA_FAQ_URL = 'https://docs.ollama.com/faq#how-can-i-allow-additional-web-origins-to-access-ollama';

/** The command that starts llama.cpp's server with Clef Flash under the model name Shoo sends. */
export const LLAMACPP_COMMAND = 'llama-server -hf ggml-org/Clef-Flash-GGUF --alias clef-flash';

/** localhost and 127.0.0.1: the endpoint runs on this computer. */
export function isLocalUrl(baseUrl: string): boolean {
  try {
    const { hostname } = new URL(baseUrl.trim());
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

/** Ollama's default port on this computer, where its Origin check applies. */
export function isOllamaUrl(baseUrl: string): boolean {
  try {
    return isLocalUrl(baseUrl) && new URL(baseUrl.trim()).port === '11434';
  } catch {
    return false;
  }
}

export type DesktopOs = 'mac' | 'windows' | 'linux';

export function desktopOs(ua: string = navigator.userAgent): DesktopOs {
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'mac';
  return 'linux';
}

/**
 * The one line that lets Shoo reach Ollama, for this extension's own origin. Ollama answers 403 to any
 * Origin outside OLLAMA_ORIGINS, and its defaults include no extension origin (Ollama envconfig).
 */
export function ollamaOriginsCommand(origin: string, os: DesktopOs): string {
  switch (os) {
    case 'mac':
      return `launchctl setenv OLLAMA_ORIGINS "${origin}"`;
    case 'windows':
      return `setx OLLAMA_ORIGINS "${origin}"`;
    case 'linux':
      // Ollama's Linux installer runs it as the systemd service `ollama`, so the variable goes in a drop-in.
      return `sudo mkdir -p /etc/systemd/system/ollama.service.d && printf '[Service]\\nEnvironment="OLLAMA_ORIGINS=${origin}"\\n' | sudo tee /etc/systemd/system/ollama.service.d/shoo.conf && sudo systemctl daemon-reload && sudo systemctl restart ollama`;
  }
}
