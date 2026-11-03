import type { ColourCode } from '~/core/types';

export interface SwatchProps {
  /** Rule colour code. Keep rules have none and show a hollow ink square. */
  colour?: ColourCode;
  /** Switched-off Rule: greyed. */
  off?: boolean;
  class?: string;
}

/** 8 px Rule colour square, radius 2, 1 px --line-strong ring. Decorative: the Rule name or R-number beside it carries the meaning. */
export function Swatch({ colour, off, class: cls }: SwatchProps) {
  return (
    <span
      aria-hidden="true"
      data-colour={colour}
      class={`inline-block size-2 shrink-0 rounded-[2px] ${
        colour ? 'ring-1 ring-line-strong' : 'border-[1.5px] border-ink'
      } ${off ? 'opacity-55 grayscale' : ''} ${cls ?? ''}`}
      style={colour ? `background:var(--${colour})` : undefined}
    />
  );
}
