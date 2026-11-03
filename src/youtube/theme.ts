// YouTube theme. Dark mode sets a bare `dark` attribute on <html> (youtube-integration.md Section 6).

export function isDark(doc: Document): boolean {
  return doc.documentElement.hasAttribute('dark');
}

/** Calls `cb` with the new value whenever YouTube switches theme. Returns a disposer. */
export function observeTheme(doc: Document, cb: (dark: boolean) => void): () => void {
  let last = isDark(doc);
  const view = doc.defaultView ?? globalThis;
  const observer = new view.MutationObserver(() => {
    const now = isDark(doc);
    if (now !== last) cb((last = now));
  });
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['dark'] });
  return () => observer.disconnect();
}
