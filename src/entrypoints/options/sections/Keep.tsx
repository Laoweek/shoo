// Keep rules (docs/spec/ui-design.md Section 6): the same table with K-numbers and no colours. Topic or
// Exact kinds, no Thumbnail. A channel Keep rule for a Banned channel asks whether to lift the ban.
import { useMemo, useState } from 'preact/hooks';
import { t } from '~/i18n';
import { readRuleStats, watchRuleStats } from '~/store/read';
import { Notice, SkeletonRows } from '~/ui/components';
import { useAsync, useNow } from '~/ui/pages/hooks';
import { useKeepChannel } from '~/ui/pages/keep-channel';
import { SectionHead, Status, SubHead } from '~/ui/pages/parts';
import { AddRule, RuleTable } from '~/ui/pages/RuleTable';
import type { SectionProps } from '../context';

export function Keep({ data }: SectionProps) {
  const stats = useAsync(() => readRuleStats(), [watchRuleStats]);
  const now = useNow();
  const [failed, setFailed] = useState(false);
  const channel = useKeepChannel(data.rules, (ok) => setFailed(!ok));
  const keep = useMemo(() => (data.rules ?? []).filter((r) => r.polarity === 'keep'), [data.rules]);

  return (
    <section aria-labelledby="section-keep">
      <SectionHead id="section-keep" title={t('keep.title')} lede={t('keep.lede')} />
      {data.loadError ? (
        <Notice tone="danger" live="alert">
          {t('settings.error.load')}
        </Notice>
      ) : !data.settings || !data.rules ? (
        <SkeletonRows rows={3} />
      ) : (
        <>
          <SubHead id="keep-yours" title={t('keep.yours')} hint={keep.length > 0 ? t('rules.sorted') : undefined} />
          {keep.length === 0 ? (
            <p class="m-0 border-t border-line-strong pt-4">{t('keep.empty')}</p>
          ) : (
            <RuleTable rules={keep} stats={stats.data ?? {}} now={now} regexEnabled={data.settings.regexEnabled} labelledBy="keep-yours" />
          )}
          {channel.prompt}
          <AddRule
            polarity="keep"
            regexEnabled={data.settings.regexEnabled}
            modelOk={data.modelOk}
            onKeepChannel={(name) => channel.keep({ channelName: name })}
          />
          <Status tone="danger" class="mt-2">
            {failed ? t('keep.error.save') : ''}
          </Status>
        </>
      )}
    </section>
  );
}
