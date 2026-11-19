// Bilibili's theme. Bilibili colours its pages from CSS variables on :root (`--bg1` is #FFFFFF in the light theme,
// observed 2026-10-18), so Shoo reads how dark that background is instead of a class name. [unverified] which
// attribute a theme switch changes: Shoo watches class, style and data-theme on <html> and <body>.

type Rgb = [number, number, number];

function parseColour(c: string): Rgb | null {
  const v = c.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((d) => d + d).join('') : hex;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
  }
  // A see-through fill (Chrome computes an unpainted <body> as rgba(0, 0, 0, 0)) says nothing about the theme.
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?/.exec(v);
  if (!rgb || (rgb[4] !== undefined && parseFloat(rgb[4]) === 0)) return null;
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
}

/** Relative luminance (WCAG) of an sRGB colour, 0 for black to 1 for white. */
function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function isDark(doc: Document): boolean {
  const win = doc.defaultView;
  if (!win) return false;
  const bg1 = win.getComputedStyle(doc.documentElement).getPropertyValue('--bg1');
  const colour = parseColour(bg1) ?? (doc.body ? parseColour(win.getComputedStyle(doc.body).backgroundColor) : null);
  return colour !== null && luminance(colour) < 0.2;
}

/** Calls `cb` with the new value whenever Bilibili switches theme. Returns a disposer. */
export function observeTheme(doc: Document, cb: (dark: boolean) => void): () => void {
  let last = isDark(doc);
  const view = doc.defaultView ?? globalThis;
  const observer = new view.MutationObserver(() => {
    const now = isDark(doc);
    if (now !== last) cb((last = now));
  });
  const watched = { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] };
  observer.observe(doc.documentElement, watched);
  if (doc.body) observer.observe(doc.body, watched);
  return () => observer.disconnect();
}
