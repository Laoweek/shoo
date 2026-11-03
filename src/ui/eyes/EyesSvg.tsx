import { useState } from 'preact/hooks';
import type { EyeState } from '~/core/types';

// Pure SVG for the two eyes (docs/spec/ui-design.md, Section 3). No timers, no listeners, so the
// in-page UI can use it without pulling in pointer tracking. Styling lives in src/ui/eyes.css.
// Geometry: 52 x 26 viewBox, eye centres at (13, 13) and (39, 13), ring radius 9.6, the pupil and
// lids are clipped to radius 7.9 inside the ring. scripts/make-icons.mjs mirrors it for the toolbar.

export const EYE_STATES: readonly EyeState[] = ['watching', 'judging', 'review', 'paused', 'error'];

export interface EyesSvgProps {
  state: EyeState;
  /** Rendered width in px. Height is half of it. */
  width?: number;
  /** Look a little wider (hovered Rule row). */
  wide?: boolean;
  /** Sweep left to right while the user types (Try a title). */
  reading?: boolean;
  /** Slow idle drift (Settings only). */
  drift?: boolean;
  /** Change to a new number to blink once (lids 120 ms down, 80 ms up). 0 never blinks. */
  blinkKey?: number;
  /** Change to a new number to glance once toward `glance`, in viewBox units. 0 never glances. */
  glanceKey?: number;
  glance?: { x: number; y: number };
  class?: string;
  svgRef?: (el: SVGSVGElement | null) => void;
}

let uid = 0;

export function EyesSvg(props: EyesSvgProps) {
  const width = props.width ?? 22;
  const [id] = useState(() => ++uid);
  const blinking = (props.blinkKey ?? 0) > 0;
  const glancing = (props.glanceKey ?? 0) > 0;
  const style = glancing && props.glance ? `--gx:${props.glance.x}px;--gy:${props.glance.y}px` : undefined;
  return (
    <svg
      ref={props.svgRef}
      class={props.class ? `eyes ${props.class}` : 'eyes'}
      viewBox="0 0 52 26"
      width={width}
      height={width / 2}
      aria-hidden="true"
      focusable="false"
      data-state={props.state}
      data-size={width < 28 ? 'tiny' : undefined}
      data-wide={props.wide ? '' : undefined}
      data-reading={props.reading ? '' : undefined}
      data-drift={props.drift ? '' : undefined}
      data-glance={glancing ? '' : undefined}
      style={style}
      // Remount on a new glance so the one-shot animation runs again.
      key={glancing ? `g${props.glanceKey}` : 'eyes'}
    >
      {[0, 26].map((dx) => {
        const clip = `shoo-eye-${id}-${dx}`;
        return (
          <g key={dx} transform={dx ? `translate(${dx} 0)` : undefined}>
            <clipPath id={clip}>
              <circle cx="13" cy="13" r="7.9" />
            </clipPath>
            <g clip-path={`url(#${clip})`}>
              <g class="drift">
                <circle class="pupil" cx="13" cy="13" r="4.3" />
              </g>
              <g key={`t${props.blinkKey ?? 0}`} class={blinking ? 'lid lid-top blink' : 'lid lid-top'}>
                <rect x="-2" y="-28" width="30" height="28" />
                <line x1="0" y1="0" x2="26" y2="0" />
              </g>
              <g key={`b${props.blinkKey ?? 0}`} class={blinking ? 'lid lid-bot blink' : 'lid lid-bot'}>
                <rect x="-2" y="26" width="30" height="28" />
                <line x1="0" y1="26" x2="26" y2="26" />
              </g>
            </g>
            <circle class="ring" cx="13" cy="13" r="9.6" />
          </g>
        );
      })}
    </svg>
  );
}
