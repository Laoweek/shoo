// The Dry-run label (docs/spec/ui-design.md Section 4, "Dry-run label").
import type { ColourCode } from '~/core/types';
import { t } from '~/i18n';
import { EyesSvg } from '../eyes/EyesSvg';
import { RuleTag, ruleLabel, type RuleNaming } from './parts';

export interface DryRunLabelProps extends RuleNaming {
  variant: 'full' | 'compact';
  colour?: ColourCode;
  maxWidth?: number;
}

/**
 * Passive Dry-run label: not focusable, no buttons, dashed --edge outline. The full sentence
 * ("Shoo would remove this video, Rule: Celebrity gossip") sits in the shadow root in reading
 * order for screen readers. No aria-describedby (IDREFs do not cross shadow boundaries).
 */
export function DryRunLabel(props: DryRunLabelProps) {
  return (
    <div class={props.variant === 'compact' ? 'label compact' : 'label'} style={props.maxWidth ? `max-width:${props.maxWidth}px` : undefined}>
      <span class="sr">{t('dryRun.label', { rule: ruleLabel(props) })}</span>
      <EyesSvg state="watching" width={22} />
      {props.variant === 'full' && <span aria-hidden="true">{t('dryRun.wouldRemove')}</span>}
      <RuleTag ruleRef={props.ruleRef} ruleName={props.ruleName} ruleText={props.ruleText} colour={props.colour} hidden />
    </div>
  );
}
