import type { ColourCode, Polarity } from '~/core/types';
import { Swatch } from './Swatch';

/** What RuleRef needs of a Rule. */
export interface RuleLike {
  ref: string;
  text: string;
  name?: string;
  colour?: ColourCode;
  polarity?: Polarity;
}

/** How Shoo names a Rule outside the Settings tables: its Rule name, or its text when it has none (REQ-RULE-6, REQ-RULE-11). */
export const ruleLabel = (rule: RuleLike): string => rule.name?.trim() || rule.text;

/** Stands in for the label inside a translated sentence, so the sentence can be split around it. */
const MARK = '';

export interface RuleRefProps {
  rule: RuleLike;
  /**
   * 'label' (default): swatch + Rule name, or the text when the Rule has none, on one line with an
   * ellipsis and the full text as its tooltip. 'ref': swatch + R-number, beside each Rule in the
   * Settings tables.
   */
  show?: 'label' | 'ref';
  /**
   * Places the label inside a translated sentence with `{rule}`, for example
   * `(rule) => t('exceptions.wantedBy', { rule })`. The label truncates, the rest of the sentence stays whole.
   */
  sentence?: (rule: string) => string;
  /** The label wraps with the sentence instead of truncating (prose lines such as Try a title). */
  wrap?: boolean;
  /** Switched-off Rule: greyed swatch, muted ref. */
  off?: boolean;
  class?: string;
}

/** Swatch + Rule name (or R-number in the Settings tables): the pair that names a Rule wherever a Verdict appears. */
export function RuleRef({ rule, show = 'label', sentence, wrap, off, class: cls }: RuleRefProps) {
  const colour = rule.polarity === 'keep' ? undefined : rule.colour;
  if (show === 'ref') {
    return (
      <span class={`inline-flex min-w-0 items-center gap-2 ${cls ?? ''}`}>
        <Swatch colour={colour} off={off} />
        <span class={`num font-bold ${off ? 'text-muted' : ''}`}>{rule.ref}</span>
      </span>
    );
  }
  const label = ruleLabel(rule);
  const [before = '', after = ''] = sentence ? sentence(MARK).split(MARK) : [];
  if (wrap) {
    return (
      <span class={cls}>
        {before}
        <Swatch colour={colour} off={off} class="mr-2" />
        <span title={rule.text} dir="auto">
          {label}
        </span>
        {after}
      </span>
    );
  }
  return (
    <span class={`inline-flex max-w-full min-w-0 items-center ${cls ?? ''}`}>
      {before && <span class="shrink-0 whitespace-pre">{before}</span>}
      <Swatch colour={colour} off={off} class="mr-2" />
      <span class={`min-w-0 truncate ${off ? 'text-muted' : ''}`} title={rule.text} dir="auto">
        {label}
      </span>
      {after && <span class="shrink-0 whitespace-pre">{after}</span>}
    </span>
  );
}
