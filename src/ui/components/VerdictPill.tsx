import type { ColourCode } from '~/core/types';
import { t } from '~/i18n';
import { percent } from '../format';
import { Swatch } from './Swatch';

export interface VerdictPillProps {
  outcome: 'remove' | 'keep' | 'pending';
  /** The deciding Rule's label (its name, or its text when it has none), for the accessible name. */
  rule?: string;
  colour?: ColourCode;
  /** P(remove) from 0 to 1 for model Verdicts. Omitted for Exact rules. */
  probability?: number;
  class?: string;
}

/** `Remove · 91%`, `Keep`, or `…` while judging. Ink-filled pill, the swatch names the Rule. */
export function VerdictPill({ outcome, rule, colour, probability, class: cls }: VerdictPillProps) {
  const p = probability === undefined ? undefined : percent(probability);
  const name =
    outcome === 'pending'
      ? t('verdict.label.pending')
      : outcome === 'keep'
        ? t('verdict.label.keep')
        : p === undefined
          ? t('verdict.label.removeExact', { rule: rule ?? '' })
          : t('verdict.label.remove', { rule: rule ?? '', p });
  return (
    <span
      role="img"
      aria-label={name}
      class={`inline-flex h-[34px] items-center gap-2 rounded-full bg-ink pr-3 pl-2.5 font-semibold whitespace-nowrap text-paper ${cls ?? ''}`}
    >
      {outcome === 'remove' && <Swatch colour={colour} class="outline-2 -outline-offset-1 outline-paper" />}
      <span aria-hidden="true" class="num">
        {outcome === 'pending'
          ? t('verdict.pending')
          : outcome === 'keep'
            ? t('verdict.keep')
            : [t('verdict.remove'), p === undefined ? undefined : t('verdict.percent', { p })].filter(Boolean).join(' · ')}
      </span>
    </span>
  );
}
