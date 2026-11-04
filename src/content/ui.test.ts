// @vitest-environment jsdom
import '~/ui/test/catalogue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIXTURES, parse } from '~/sites/youtube/test-harness';
import { youtube } from '~/sites/youtube';
import { createPageUi } from './ui';

const rect = (left: number, top: number, width: number, height: number) => new DOMRect(left, top, width, height);

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  document.documentElement.removeAttribute('dark');
});

describe('page UI theme', () => {
  it("re-places annotations when YouTube switches theme, so the cover takes the new ground colour", async () => {
    const tile = document.createElement('ytd-rich-item-renderer');
    tile.style.backgroundColor = 'rgb(255, 255, 255)'; // stands in for ytd-app's light ground
    const root = parse(FIXTURES.homePlaceholder);
    tile.append(root);
    document.body.append(tile);
    const placeholder = root.querySelector('.ytDismissibleItemReplacedContent') as Element;
    // The Watch sidebar's short band (live 2026-10-10): the annotation covers YouTube's sentence.
    vi.spyOn(placeholder, 'getBoundingClientRect').mockReturnValue(rect(1237, 346, 475, 168));
    vi.spyOn(root.querySelector('.ytNotificationMultiActionRendererTextContainer > *') as Element, 'getBoundingClientRect').mockReturnValue(rect(1421, 367, 107, 22));
    vi.spyOn(placeholder.querySelector('button') as Element, 'getBoundingClientRect').mockReturnValue(rect(1250, 407, 449, 40));
    const ui = createPageUi(document, youtube);
    expect(ui.annotation(tile, 'home', { ruleRef: 'R1', ruleName: 'Crypto & trading', ruleText: 'Crypto', hasChannel: true, onKeep: () => {}, onAlwaysKeepChannel: () => {} })).toBe(true);
    const host = document.querySelector('shoo-chip-host') as HTMLElement;
    expect(host.hasAttribute('data-cramped')).toBe(true);
    expect(host.style.getPropertyValue('--shoo-ground')).toBe('rgb(255, 255, 255)');

    tile.style.backgroundColor = 'rgb(15, 15, 15)';
    document.documentElement.setAttribute('dark', '');
    await new Promise((r) => setTimeout(r, 0)); // the theme MutationObserver
    expect(host.hasAttribute('data-dark')).toBe(true);
    expect(host.style.getPropertyValue('--shoo-ground')).toBe('rgb(15, 15, 15)');
    ui.clearAll();
  });
});
