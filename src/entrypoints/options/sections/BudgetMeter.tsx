// State budget meter (decision-engine.md §3): how much of what the Decision model reads the enabled
// Topic rules and recent kept videos use. Saving stays allowed when over.
import { fitState } from '~/core/budget';
import type { Exception, Rule } from '~/core/types';
import { t } from '~/i18n';

export function budgetFor(rules: Rule[], exceptions: Exception[]) {
  const topic = rules.filter((r) => r.kind === 'topic');
  return fitState(
    topic.filter((r) => r.polarity === 'remove'),
    topic.filter((r) => r.polarity === 'keep'),
    exceptions,
  );
}

export function BudgetMeter({ fit }: { fit: ReturnType<typeof fitState> }) {
  const percent = Math.round((fit.usedTokens / fit.budget) * 100);
  const over = fit.usedTokens > fit.budget;
  return (
    <div class="mb-6 grid gap-2 text-[13px]">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <span id="budget-label" class="font-semibold">
          {t('rules.budget.label')}
        </span>
        <span class="num text-muted">{t('rules.budget.value', { percent: String(percent) })}</span>
      </div>
      <div
        role="meter"
        aria-labelledby="budget-label"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(percent, 100)}
        aria-valuetext={t('rules.budget.value', { percent: String(percent) })}
        class="h-1 overflow-hidden rounded-full bg-line"
      >
        <div class="h-full rounded-full bg-ink" style={`width:${Math.min(percent, 100)}%`} />
      </div>
      {over && <p class="m-0 text-danger">{t('rules.budget.over')}</p>}
      {fit.droppedExceptions > 0 && <p class="m-0 text-muted">{t('rules.budget.dropped', fit.droppedExceptions)}</p>}
    </div>
  );
}
