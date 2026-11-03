// prefers-reduced-motion, read at the moment of use (never at import time).
export function prefersReducedMotion(win: Window = window): boolean {
  return win.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
