import type { ColourCode } from '~/core/types';

export interface SwatchProps {
  /** Rule colour code. Keep rules have none and show a hollow ring. */
  colour?: ColourCode;
  /** Switched-off Rule: a hollow ring in its colour. */
  off?: boolean;
  class?: string;
}

/** 10 px Rule colour dot. Decorative: the Rule name or R-number beside it carries the meaning. */
export function Swatch({ colour, off, class: cls }: SwatchProps) {
  const style = !colour
    ? undefined
    : off
      ? `box-shadow:inset 0 0 0 2px var(--${colour})`
      : `background:var(--${colour});box-shadow:inset 0 0 0 1px var(--dot-ring)`;
  return (
    <span
      aria-hidden="true"
      data-colour={colour}
      class={`inline-block size-2.5 shrink-0 rounded-full ${colour ? '' : 'shadow-[inset_0_0_0_2px_var(--edge)]'} ${cls ?? ''}`}
      style={style}
    />
  );
}
