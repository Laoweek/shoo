// State budget meter (decision-engine.md §3): how much of what the Decision model reads the enabled
// Topic rules and recent kept videos use. Saving stays allowed when over.
import { fitState } from '~/core/budget';
import { exampleOn, rulesOn } from '~/core/rules';
import { SITE_IDS } from '~/core/sites';
import type { Exception, Rule } from '~/core/types';
import { t } from '~/i18n';

/** The fullest Site's requests, since each carries only the Rules that work there (ADR 0012), with every Site's cut Rules. */
export function budgetFor(rules: Rule[], exceptions: Exception[]) {
  const fits = SITE_IDS.map((site) => {
    const topic = rulesOn(rules, site).filter((r) => r.kind === 'topic');
    return fitState(
      topic.filter((r) => r.polarity === 'remove'),
      topic.filter((r) => r.polarity === 'keep'),
      exceptions.filter(exampleOn(rules, site)),
    );
  });
  const fullest = fits.reduce((a, b) => (b.usedTokens > a.usedTokens ? b : a));
  return { ...fullest, truncatedRefs: [...new Set(fits.flatMap((f) => f.truncatedRefs))] };
}

export function BudgetMeter({ fit }: { fit: ReturnType<typeof fitState> }) {
  const percent = Math.round((fit.usedTokens / fit.budget) * 100);
  const over = fit.usedTokens > fit.budget;
  return (
    <div class="mb-6 grid gap-1 px-1 text-[13px]">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span id="budget-label" class="font-semibold">
          {t('rules.budget.label')}
        </span>
        <div
          role="meter"
          aria-labelledby="budget-label"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(percent, 100)}
          aria-valuetext={t('rules.budget.value', { percent: String(percent) })}
          class="h-1.5 w-36 overflow-hidden rounded-full bg-line-strong"
        >
          <div class={`h-full min-w-1.5 rounded-full ${over ? 'bg-danger' : 'bg-muted'}`} style={`width:${Math.min(percent, 100)}%`} />
        </div>
        <span class="num text-muted">{t('rules.budget.value', { percent: String(percent) })}</span>
      </div>
      {over && <p class="m-0 text-danger">{t('rules.budget.over')}</p>}
      {fit.droppedExceptions > 0 && <p class="m-0 text-muted">{t('rules.budget.dropped', fit.droppedExceptions)}</p>}
    </div>
  );
}
