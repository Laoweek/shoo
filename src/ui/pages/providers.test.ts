import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { CHAT_LOCAL, desktopOs, isLocalUrl, isOllamaUrl, LOCAL, ollamaOriginsCommand, ONLINE } from './providers';
import { directProvider, DIRECT_PROVIDERS } from '~/core/providers';

const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

describe('provider choice', () => {
  it('offers every direct Decision provider once, online ones online and local ones on this computer', () => {
    expect([...ONLINE, ...LOCAL].filter((id) => id !== 'openrouter').sort()).toEqual(DIRECT_PROVIDERS.map((p) => p.id).sort());
    for (const id of LOCAL) expect(directProvider(id)!.local).toBe(true);
    for (const id of ONLINE) if (id !== 'openrouter') expect(directProvider(id)!.local).toBe(false);
  });

  it('fills in chat addresses on this computer, and knows Ollama by its port', () => {
    expect(CHAT_LOCAL.every((c) => isLocalUrl(c.baseUrl))).toBe(true);
    expect(isOllamaUrl('http://localhost:11434/v1')).toBe(true);
    expect(isOllamaUrl('http://127.0.0.1:11434')).toBe(true);
    expect(isOllamaUrl('http://localhost:1234/v1')).toBe(false);
    expect(isOllamaUrl('https://example.com:11434')).toBe(false);
  });

  it('detects the desktop OS from the user agent', () => {
    expect(desktopOs('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('mac');
    expect(desktopOs('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows');
    expect(desktopOs('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux');
  });

  it('allows exactly this extension origin in OLLAMA_ORIGINS on each OS', () => {
    expect(ollamaOriginsCommand(ORIGIN, 'mac')).toBe(`launchctl setenv OLLAMA_ORIGINS "${ORIGIN}"`);
    expect(ollamaOriginsCommand(ORIGIN, 'windows')).toBe(`setx OLLAMA_ORIGINS "${ORIGIN}"`);
    const linux = ollamaOriginsCommand(ORIGIN, 'linux');
    expect(linux).not.toContain('\n');
    // The printf part writes a valid systemd drop-in.
    const printf = linux.match(/printf '([^']+)'/)![1]!;
    expect(execFileSync('printf', [printf]).toString()).toBe(`[Service]\nEnvironment="OLLAMA_ORIGINS=${ORIGIN}"\n`);
  });
});
