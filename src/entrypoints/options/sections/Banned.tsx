// Banned channels (docs/spec/ui-design.md Section 6): channel name, its Site, how it got there (you, or an
// Escalation with its date), videos removed, remove from list.
import { useMemo, useState } from 'preact/hooks';
import { isBannedChannel, ruleSite, sortByRef } from '~/core/rules';
import { SITE_NAMES } from '~/core/sites';
import type { Rule } from '~/core/types';
import { t } from '~/i18n';
import { readRuleStats, watchRuleStats } from '~/store/read';
import { Button, Notice, RuleRef, SkeletonRows } from '~/ui/components';
import { date } from '~/ui/pages/format';
import { useAsync } from '~/ui/pages/hooks';
import { SectionHead, Status, focusHeading } from '~/ui/pages/parts';
import { channelOf } from '~/ui/pages/rules';
import { mutate } from '~/ui/pages/RuleTable';
import type { SectionProps } from '../context';

/** A ban made from a video names that video's Site. One typed by name may work on all sites. */
const siteName = (r: Rule): string => {
  const site = ruleSite(r);
  return site ? SITE_NAMES[site] : t('rules.site.all');
};

export function Banned({ data }: SectionProps) {
  const stats = useAsync(() => readRuleStats(), [watchRuleStats]);
  const [error, setError] = useState(false);
  const banned = useMemo(() => sortByRef((data.rules ?? []).filter(isBannedChannel)), [data.rules]);

  const remove = async (id: string) => {
    setError(false);
    const res = await mutate([{ op: 'delete', id }]);
    if (!res.ok) setError(true);
    else focusHeading();
  };

  return (
    <section aria-labelledby="section-banned">
      <SectionHead id="section-banned" title={t('banned.title')} lede={t('banned.lede')} />
      {data.loadError ? (
        <Notice tone="danger" live="alert">
          {t('settings.error.load')}
        </Notice>
      ) : !data.rules ? (
        <SkeletonRows rows={3} />
      ) : banned.length === 0 ? (
        <p class="card m-0 p-5">{t('banned.empty')}</p>
      ) : (
        // A container, so the Added and Removed columns give way to the channel name in a narrow list.
        <div class="card @container px-3 pt-1 pb-2">
          <table aria-labelledby="section-banned" class="w-full border-collapse text-left [&_tbody_tr:last-child]:border-b-0">
            <thead>
              <tr class="h-[34px] border-b border-line-strong text-[13px] text-muted">
                <th scope="col" class="w-16 px-2 font-semibold">{t('rules.table.rule')}</th>
                <th scope="col" class="px-2 font-semibold">{t('banned.table.channel')}</th>
                <th scope="col" class="px-2 font-semibold @max-md:hidden">{t('banned.table.site')}</th>
                <th scope="col" class="px-2 font-semibold @max-2xl:hidden">{t('banned.table.origin')}</th>
                <th scope="col" class="px-2 text-right font-semibold @max-lg:hidden">{t('banned.table.removed')}</th>
                <th scope="col" class="w-36 px-2">
                  <span class="sr-only">{t('rules.table.more')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {banned.map((r) => (
                <tr key={r.id} class="h-10 border-b border-line hover:bg-tint">
                  <td class="px-2 py-2">
                    <RuleRef rule={r} show="ref" off={!r.enabled} />
                  </td>
                  <td class={`px-2 py-2 ${r.enabled ? '' : 'text-muted'}`}>{channelOf(r)}</td>
                  <td class="px-2 py-2 text-[13px] whitespace-nowrap text-muted @max-md:hidden">{siteName(r)}</td>
                  <td class="px-2 py-2 text-[13px] whitespace-nowrap text-muted @max-2xl:hidden">
                    {r.origin === 'escalation' ? t('banned.origin.escalation', { date: date(r.createdAt) }) : t('banned.origin.you')}
                  </td>
                  <td class="num px-2 py-2 text-right text-[13px] whitespace-nowrap @max-lg:hidden">{t('banned.removed', stats.data?.[r.id]?.total ?? 0)}</td>
                  <td class="px-2 py-2 text-right">
                    <Button variant="text" aria-label={t('banned.removeLabel', { channel: channelOf(r) })} onClick={() => void remove(r.id)}>
                      {t('banned.remove')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Status tone="danger" class="mt-2">
        {error ? t('banned.error.save') : ''}
      </Status>
    </section>
  );
}
