// The in-page stylesheet carries only what the shadow roots use (tokens-shared.css, eyes-shared.css), and the
// extension pages' files keep the rest.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COLOUR_COUNT } from '~/core/rules';

const UI = resolve(__dirname, '..');

/** The CSS file with its relative @imports inlined, as Vite builds it. */
function inlined(path: string): string {
  return readFileSync(path, 'utf8').replace(/@import '(\.[^']+)';/g, (_, rel: string) => inlined(join(dirname(path), rel)));
}

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The rules inside the prefers-color-scheme dark block, and everything else. */
function splitDarkMedia(css: string): { outside: string; inside: string } {
  const text = stripComments(css);
  const start = text.indexOf('@media (prefers-color-scheme: dark)');
  if (start === -1) return { outside: text, inside: '' };
  const open = text.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (; end < text.length; end += 1) {
    if (text[end] === '{') depth += 1;
    if (text[end] === '}' && --depth === 0) break;
  }
  return { outside: text.slice(0, start) + text.slice(end + 1), inside: text.slice(open + 1, end) };
}

/** Custom properties declared by every rule whose selector list contains `selector`. */
function declared(css: string, selector: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!m[1]!.split(',').some((s) => s.trim() === selector)) continue;
    for (const d of m[2]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(d[1]!, d[2]!.trim());
  }
  return out;
}

const inPageCss = inlined(join(UI, 'in-page.css'));
const inPageSources = readdirSync(join(UI, 'in-page'))
  .filter((f) => /\.tsx?$/.test(f) && !f.includes('.test.'))
  .map((f) => readFileSync(join(UI, 'in-page', f), 'utf8'));

describe('in-page CSS', () => {
  it('has a rule for every eye state and motion the in-page components pass to EyesSvg', () => {
    const uses = inPageSources.flatMap((src) => [...src.matchAll(/<EyesSvg\b([^>]*)\/>/g)].map((m) => m[1]!));
    expect(uses.length).toBeGreaterThan(0);
    const css = stripComments(inPageCss);
    for (const attrs of uses) {
      const state = /\bstate="(\w+)"/.exec(attrs)?.[1];
      expect(state, `EyesSvg${attrs}: pass the state as a literal, so this test can check it`).toBeDefined();
      const needs: string[] = state === 'watching' ? [] : [`.eyes[data-state='${state}']`];
      const width = Number(/\bwidth=\{(\d+)\}/.exec(attrs)?.[1] ?? 22);
      if (width < 28) needs.push(".eyes[data-size='tiny']");
      if (/\bwide\b/.test(attrs)) needs.push('.eyes[data-wide]');
      if (/\breading\b/.test(attrs)) needs.push('.eyes[data-reading]');
      if (/\bdrift\b/.test(attrs)) needs.push('.eyes[data-drift]');
      if (/\bglanceKey=/.test(attrs)) needs.push('.eyes[data-glance] .pupil', '@keyframes shoo-eyes-glance');
      if (/\bblinkKey=/.test(attrs)) needs.push('.eyes .blink.lid-top', '@keyframes shoo-eyes-blink-top');
      for (const rule of needs) expect(css, `EyesSvg${attrs} needs ${rule}`).toContain(rule);
    }
  });

  it('defines every token the shadow roots read', () => {
    const css = stripComments(inPageCss);
    const light = declared(css, ':host');
    const dark = declared(css, ':host([data-dark])');
    // Properties outside the token blocks, such as .eyes { --eye-bg }, count too.
    const tokenBlock = (sel: string) => sel.split(',').some((x) => x.trim() === ':host' || x.trim() === ':host([data-dark])');
    const rest = css.replace(/([^{}]+)\{[^{}]*\}/g, (rule, sel: string) => (tokenBlock(sel) ? '' : rule));
    const defined = new Set([...light.keys(), ...[...rest.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!)]);
    for (const name of dark.keys()) expect([...light.keys()], `${name} has a dark value but no light one`).toContain(name);
    // var() without a fallback, in the CSS and in inline styles the components set (Rule colours: var(--c1) to var(--c10)).
    const read = new Set([...css.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]!));
    for (let i = 1; i <= COLOUR_COUNT; i += 1) read.add(`--c${i}`);
    for (const name of read) expect(defined, `${name} is read in a shadow root but not defined on :host`).toContain(name);
  });

  it('keeps the system dark theme in step with the dark theme extension pages pick in Settings', () => {
    const pages = splitDarkMedia(inlined(join(UI, 'tokens.css')));
    const picked = declared(pages.outside, ":root[data-theme='dark']");
    const system = declared(pages.inside, ":root:not([data-theme='light'])");
    expect(picked.size).toBeGreaterThan(10);
    expect(Object.fromEntries(system)).toEqual(Object.fromEntries(picked));
  });
});
