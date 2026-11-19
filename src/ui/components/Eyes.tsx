import { useEffect, useRef } from 'preact/hooks';
import { EyesSvg, type EyesSvgProps } from '../eyes/EyesSvg';
import { prefersReducedMotion } from '../motion';

export interface EyesProps extends Omit<EyesSvgProps, 'svgRef'> {
  /** Follow the pointer while watching (extension pages only). */
  track?: boolean;
}

const LERP = 0.18; // per frame (ui-design.md Section 3)
const REACH = 160; // px of pointer distance for a full look
const REST_Y = 0.15;

/**
 * The eyes with pointer tracking for extension pages: pupils ease toward the pointer
 * (lerp 0.18 per frame, travel capped at 30% of the eye radius by eyes.css). Tracking runs only in
 * the watching state and never with prefers-reduced-motion. States switch through data-state.
 */
export function Eyes({ track, ...svg }: EyesProps) {
  const el = useRef<SVGSVGElement | null>(null);
  const active = !!track && svg.state === 'watching';

  useEffect(() => {
    if (!active || prefersReducedMotion()) return;
    let tx = 0;
    let ty = REST_Y;
    let x = 0;
    let y = REST_Y;
    let raf = 0;
    const frame = () => {
      x += (tx - x) * LERP;
      y += (ty - y) * LERP;
      const node = el.current;
      if (node) {
        node.classList.add('tracking');
        node.style.setProperty('--px', x.toFixed(3));
        node.style.setProperty('--py', y.toFixed(3));
      }
      raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.004 ? requestAnimationFrame(frame) : 0;
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const move = (e: PointerEvent) => {
      const node = el.current;
      if (!node) return;
      const r = node.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / REACH);
      tx = (dx / d) * k;
      ty = (dy / d) * k;
      kick();
    };
    const leave = () => {
      tx = 0;
      ty = REST_Y;
      kick();
    };
    document.addEventListener('pointermove', move);
    document.documentElement.addEventListener('pointerleave', leave);
    return () => {
      document.removeEventListener('pointermove', move);
      document.documentElement.removeEventListener('pointerleave', leave);
      cancelAnimationFrame(raf);
      const node = el.current;
      if (node) {
        node.classList.remove('tracking');
        node.style.removeProperty('--px');
        node.style.removeProperty('--py');
      }
    };
  }, [active]);

  return <EyesSvg {...svg} svgRef={(n) => (el.current = n)} />;
}
