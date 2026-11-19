import type { ColourCode } from '~/core/types';

/** How in-page UI names a Rule (REQ-RULE-11). The ref (R2) only keys it, it never shows on YouTube. */
export interface RuleNaming {
  ruleRef: string;
  /** The Rule name. Undefined when the Rule has none, or the background sent none. */
  ruleName?: string;
  /** The Rule's full text: the tooltip, and the label when the Rule has no name. */
  ruleText: string;
}

/** The Rule's label: its name, else its text, else its ref (no display data from the background). */
export const ruleLabel = (r: RuleNaming): string => r.ruleName?.trim() || r.ruleText.trim() || r.ruleRef;

/**
 * Swatch + Rule label. The swatch is decorative, the label carries the meaning and is what shrinks first, to an
 * ellipsis (components.css). The tooltip is the full Rule text. The moment lands on the swatch (`data-ref`).
 * `hidden` when a screen-reader sentence already names the Rule.
 */
export function RuleTag({ colour, hidden, ...rule }: RuleNaming & { colour?: ColourCode; hidden?: boolean }) {
  return (
    <span class="tag" title={rule.ruleText} aria-hidden={hidden ? 'true' : undefined}>
      <span class="sw" data-ref={rule.ruleRef} style={colour ? `background:var(--${colour})` : undefined} />
      <span class="lb" dir="auto">
        {ruleLabel(rule)}
      </span>
    </span>
  );
}
