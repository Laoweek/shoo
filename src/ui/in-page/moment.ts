import type { ColourCode } from '~/core/types';
import { prefersReducedMotion } from '../motion';

// The moment (docs/spec/ui-design.md Section 4): Rule-colour squares fly from removed Tiles to the
// summary's Rule swatches. Transforms and opacity only, 560 ms exponential ease-out, 40 ms stagger,
// at most 12 squares. All layout is read once before the first frame.

export const MOMENT_MS = 560;
export const MOMENT_STAGGER_MS = 40;
export const MOMENT_MAX_SQUARES = 12;
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const SQUARE = 8;
const ARC_STEPS = 8;

export interface MomentSource {
  /** Viewport rect of the removed Tile (getBoundingClientRect before YouTube replaced it). */
  rect: { left: number; top: number; width: number; height: number };
  colour?: ColourCode;
  /** Rule ref, to land on that Rule's swatch (`[data-ref]`), or the spot that stands for it (`[data-refs]`), inside the target. */
  ruleRef?: string;
}

export interface MomentOptions {
  /** Called as each square lands (and at once for every source under reduced motion). */
  onArrive?: (index: number) => void;
}

/** How many squares will fly for this many sources. */
export const flyingCount = (sources: number) => Math.min(sources, MOMENT_MAX_SQUARES);

/**
 * Fly one square per source (max 12) to `target`, landing on the matching `[data-ref]` swatch, or
 * the `[data-refs]` spot listing that ref (Rules the summary folds into "+N more Rules"), when there
 * is one. Resolves when every square has landed. Under prefers-reduced-motion, or without Web
 * Animations, nothing flies: every arrival is reported at once.
 */
export function playMoment(sources: readonly MomentSource[], target: Element, opts: MomentOptions = {}): Promise<void> {
  const flying = sources.slice(0, MOMENT_MAX_SQUARES);
  const doc = target.ownerDocument;
  const win = doc.defaultView;
  if (!win || prefersReducedMotion(win) || typeof target.animate !== 'function') {
    flying.forEach((_, i) => opts.onArrive?.(i));
    return Promise.resolve();
  }

  // Layout reads, all before the first frame.
  const vw = win.innerWidth;
  const vh = win.innerHeight;
  const fallback = target.getBoundingClientRect();
  const ends = flying.map((s) => {
    const sw = s.ruleRef ? target.querySelector(`[data-ref="${s.ruleRef}"], [data-refs~="${s.ruleRef}"]`) : null;
    const r = sw ? sw.getBoundingClientRect() : fallback;
    return { x: r.left + r.width / 2 - SQUARE / 2, y: r.top + r.height / 2 - SQUARE / 2 };
  });

  const root = target.getRootNode();
  const layer = doc.createElement('div');
  layer.className = 'moment';
  layer.setAttribute('aria-hidden', 'true');
  // A shadow root (DocumentFragment) keeps the squares inside Shoo's tokens. nodeType avoids
  // instanceof across Firefox's content-script Xray wrappers.
  (root !== doc && root.nodeType === 11 ? (root as ShadowRoot) : doc.body).append(layer);

  const runs = flying.map((s, i) => {
    // Off-screen Tiles start from the nearest viewport edge.
    const sx = clamp(s.rect.left + s.rect.width / 2, 0, vw) - SQUARE / 2;
    const sy = clamp(s.rect.top + s.rect.height / 2, 0, vh) - SQUARE / 2;
    const { x: ex, y: ey } = ends[i]!;
    // A gentle arc: quadratic Bezier with its control point lifted above the midpoint.
    const lift = Math.min(140, Math.hypot(ex - sx, ey - sy) * 0.3);
    const cx = (sx + ex) / 2;
    const cy = Math.min(sy, ey) - lift;
    const frames: Keyframe[] = [];
    for (let k = 0; k <= ARC_STEPS; k++) {
      const u = k / ARC_STEPS;
      const x = (1 - u) ** 2 * sx + 2 * (1 - u) * u * cx + u ** 2 * ex;
      const y = (1 - u) ** 2 * sy + 2 * (1 - u) * u * cy + u ** 2 * ey;
      const scale = k === 0 ? 0.6 : k === ARC_STEPS ? 1 : 1.15;
      frames.push({ offset: u, opacity: k === 0 ? 0 : 1, transform: `translate(${x}px, ${y}px) scale(${scale})` });
    }
    const sq = doc.createElement('div');
    sq.className = 'sq';
    if (s.colour) sq.style.background = `var(--${s.colour})`;
    layer.append(sq);
    const anim = sq.animate(frames, { duration: MOMENT_MS, delay: i * MOMENT_STAGGER_MS, easing: EASE, fill: 'both' });
    return anim.finished.then(
      () => {
        sq.remove();
        opts.onArrive?.(i);
      },
      () => sq.remove(),
    );
  });

  return Promise.all(runs).then(() => layer.remove());
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
