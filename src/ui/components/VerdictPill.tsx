import { t } from '~/i18n';
import { percent } from '../format';

export interface VerdictPillProps {
  outcome: 'remove' | 'keep' | 'pending';
  /** The deciding Rule's label (its name, or its text when it has none), for the accessible name. */
  rule?: string;
  /** P(remove) from 0 to 1 for model Verdicts. Omitted for Exact rules. */
  probability?: number;
  class?: string;
}

const FILL = {
  remove: 'bg-remove-bg text-remove-fg',
  keep: 'bg-keep-bg text-keep-fg',
  pending: 'bg-tint text-muted',
} as const;

/**
 * `Remove · 91%` in red on pale red, `Keep` in green on pale green, or `…` while judging. Pale grounds, so a Verdict never
 * looks like a button. The line under the pill names the Rule with its swatch.
 */
export function VerdictPill({ outcome, rule, probability, class: cls }: VerdictPillProps) {
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
      class={`inline-flex h-9 items-center rounded-full px-4 text-[16px] font-bold whitespace-nowrap ${FILL[outcome]} ${cls ?? ''}`}
    >
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
