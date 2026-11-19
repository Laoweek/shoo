import type { EyeState } from '~/core/types';
import { t } from '~/i18n';
import { Eyes, type EyesProps } from './Eyes';

const STATUS = {
  watching: 'eyes.status.watching',
  judging: 'eyes.status.judging',
  review: 'eyes.status.review',
  paused: 'eyes.status.paused',
  error: 'eyes.status.error',
} as const;

export function eyeStatusText(state: EyeState): string {
  return t(STATUS[state]);
}

export interface WordmarkProps extends Omit<EyesProps, 'width'> {
  /** Font size of the letters in px. The eyes are 0.66 of it tall. */
  size?: number;
  /** Render the visually hidden status text ("Shoo is paused") beside the image. */
  status?: boolean;
  class?: string;
}

/** The living wordmark: "Sh" in Figtree 800 followed by the two eyes (ui-design.md Section 3). */
export function Wordmark({ size = 26, status, class: cls, ...eyes }: WordmarkProps) {
  return (
    <span class={`inline-flex items-baseline ${cls ?? ''}`}>
      <span
        role="img"
        aria-label={t('common.wordmark')}
        class="inline-flex items-baseline leading-none font-extrabold tracking-[-0.02em] text-ink"
        style={`font-size:${size}px`}
      >
        <span aria-hidden="true">Sh</span>
        <Eyes
          {...eyes}
          width={Math.round(size * 1.32)}
          class="ml-[0.04em] translate-y-[0.06em] [--ring-w:5.4]"
        />
      </span>
      {status && <span class="sr-only">{eyeStatusText(eyes.state)}</span>}
    </span>
  );
}
