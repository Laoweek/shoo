// Rules section (docs/spec/ui-design.md Section 6): How to write a Rule, Try a title, Escalation strip,
// state budget meter, the Rules table sorted by activity, Add a Rule, and the empty state with Starter rules.
import { useContext, useMemo } from 'preact/hooks';
import { directProvider, topicRuleLimit } from '~/core/providers';
import { rulesOn } from '~/core/rules';
import { SITE_IDS } from '~/core/sites';
import { t } from '~/i18n';
import { readRuleStats, watchRuleStats } from '~/store/read';
import { Notice, SkeletonRows } from '~/ui/components';
import { Escalations } from '~/ui/pages/Escalations';
import { useAsync, useNow } from '~/ui/pages/hooks';
import { SectionHead, SubHead } from '~/ui/pages/parts';
import { PROVIDER_NAMES } from '~/ui/pages/providers';
import { AddRule, RuleTable } from '~/ui/pages/RuleTable';
import { StarterChips } from '~/ui/pages/StarterChips';
import { EyesControl, type SectionProps } from '../context';
import { BudgetMeter, budgetFor } from './BudgetMeter';
import { RuleGuide } from './RuleGuide';
import { TryTitle } from './TryTitle';

export function Rules({ data }: SectionProps) {
  const eyes = useContext(EyesControl);
  const stats = useAsync(() => readRuleStats(), [watchRuleStats]);
  const now = useNow();
  const remove = useMemo(() => (data.rules ?? []).filter((r) => r.polarity === 'remove'), [data.rules]);
  const fit = useMemo(() => budgetFor(data.rules ?? [], data.exceptions ?? []), [data.rules, data.exceptions]);
  const truncated = useMemo(() => new Set(fit.truncatedRefs), [fit]);
  const hasTopic = (data.rules ?? []).some((r) => r.kind === 'topic' && r.enabled);
  // The direct Decision provider in use takes fewer Topic rules than are on: say so where Rules are edited.
  const provider = data.settings?.engine === 'direct' && data.settings.direct ? directProvider(data.settings.direct.provider) : undefined;
  // Each Site's requests carry only its own Rules, so the fullest Site counts.
  const topicOn = Math.max(...SITE_IDS.map((site) => rulesOn(remove, site).filter((r) => r.kind === 'topic' && r.enabled && r.deletedAt === undefined).length));
  const overLimit = !!provider && topicOn > topicRuleLimit(provider);

  return (
    <section aria-labelledby="section-rules">
      <SectionHead id="section-rules" title={t('rules.title')} lede={t('rules.lede')} />
      {data.loadError ? (
        <Notice tone="danger" live="alert">
          {t('settings.error.load')}
        </Notice>
      ) : !data.settings || !data.rules ? (
        <SkeletonRows rows={5} />
      ) : (
        <>
          <RuleGuide open={remove.length === 0} />
          <TryTitle consent={data.consent} rules={data.rules} onGiveConsent={() => data.go('connection')} />
          <Escalations rules={data.rules} variant="strip" class="mb-6" />
          {overLimit && (
            <Notice tone="danger" class="mb-6">
              {t('rules.tooManyRules', { provider: PROVIDER_NAMES[provider.id], max: String(topicRuleLimit(provider)), count: String(topicOn) })}
            </Notice>
          )}
          {hasTopic && <BudgetMeter fit={fit} />}
          <div class="card px-3 pt-5 pb-5 sm:px-5">
            <div class="px-2">
              <SubHead id="rules-yours" title={t('rules.yours')} hint={remove.length > 0 ? t('rules.sorted') : undefined} />
            </div>
            {remove.length === 0 ? (
              <div class="px-2">
                <p class="mt-0 mb-3">{t('rules.empty')}</p>
                <StarterChips rules={data.rules} modelOk={data.modelOk} disabledNote={data.consent ? t('rules.disabled.needsKey') : t('onboarding.rules.needsConsent')} />
              </div>
            ) : (
              <RuleTable
                rules={remove}
                stats={stats.data ?? {}}
                now={now}
                regexEnabled={data.settings.regexEnabled}
                truncatedRefs={truncated}
                onHover={eyes.wide}
                labelledBy="rules-yours"
              />
            )}
            <div class="px-2">
              <AddRule polarity="remove" regexEnabled={data.settings.regexEnabled} modelOk={data.modelOk} />
            </div>
          </div>
        </>
      )}
    </section>
  );
}
