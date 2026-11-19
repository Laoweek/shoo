// Exceptions (docs/spec/ui-design.md Section 6): kept videos with title, channel and Site, date and the Rule
// that wanted them gone. Search and delete. The archive holds up to 5,000 Exceptions, so the list renders a page at
// a time.
import { Search } from 'lucide-preact';
import { useMemo, useState } from 'preact/hooks';
import { normalizeText } from '~/core/exact';
import { SITE_NAMES, videoSite } from '~/core/sites';
import { t } from '~/i18n';
import { sendMessage } from '~/messaging/protocol';
import { Button, Notice, RuleRef, SkeletonRows } from '~/ui/components';
import { date } from '~/ui/pages/format';
import { SectionHead, Status, focusHeading } from '~/ui/pages/parts';
import { byId } from '~/ui/pages/rules';
import type { SectionProps } from '../context';

export const EXCEPTIONS_PAGE = 100;

export function Exceptions({ data }: SectionProps) {
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(EXCEPTIONS_PAGE);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [error, setError] = useState(false);
  const rules = byId(data.rules);
  const list = useMemo(() => {
    const q = normalizeText(query);
    return (data.exceptions ?? []).filter(
      (x) => !gone.has(x.videoId) && (!q || normalizeText(x.title).includes(q) || normalizeText(x.channelName ?? '').includes(q)),
    );
  }, [data.exceptions, query, gone]);

  const remove = async (videoId: string) => {
    setError(false);
    try {
      await sendMessage('removeException', { videoId });
      setGone((g) => new Set(g).add(videoId));
      focusHeading();
    } catch {
      setError(true);
    }
  };

  const total = data.exceptions?.length ?? 0;
  return (
    <section aria-labelledby="section-exceptions">
      <SectionHead id="section-exceptions" title={t('exceptions.title')} lede={t('exceptions.lede')} />
      {data.loadError || data.exceptionsError ? (
        <Notice tone="danger" live="alert">
          {t('exceptions.error.load')}
        </Notice>
      ) : !data.exceptions ? (
        <SkeletonRows rows={4} />
      ) : total === 0 ? (
        <p class="card m-0 p-5">{t('exceptions.empty')}</p>
      ) : (
        <>
          <label class="mb-4 flex h-9 max-w-sm items-center gap-2 rounded-[12px] border border-edge bg-paper px-3 hover:border-ink focus-within:border-ink focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink">
            <Search size={16} strokeWidth={2} aria-hidden="true" class="shrink-0 text-muted" />
            <span class="sr-only">{t('exceptions.search')}</span>
            <input
              type="search"
              value={query}
              placeholder={t('exceptions.search')}
              onInput={(e) => {
                setQuery(e.currentTarget.value);
                setLimit(EXCEPTIONS_PAGE);
              }}
              class="w-full min-w-0 border-0 bg-transparent text-[16px] placeholder:text-muted focus:outline-none"
            />
          </label>
          {/* A container, so the Rule and date columns give way to the title in a narrow list. */}
          <ul aria-labelledby="section-exceptions" class="card @container m-0 list-none px-3 py-1 empty:hidden [&>:last-child]:border-b-0">
            {list.slice(0, limit).map((x) => {
              const rule = x.ruleId ? rules.get(x.ruleId) : undefined;
              const site = videoSite(x.videoId);
              return (
                <li key={x.videoId} class="grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-b border-line p-2 @2xl:grid-cols-[minmax(0,1fr)_14rem_6rem_auto]">
                  <div class="min-w-0">
                    <div class="truncate font-medium" title={x.title}>
                      {x.title}
                    </div>
                    <div class="truncate text-[13px] text-muted">{[x.channelName, site && SITE_NAMES[site]].filter(Boolean).join(' · ')}</div>
                  </div>
                  <div class="text-[13px] text-muted @max-2xl:hidden">
                    {rule && <RuleRef rule={rule} sentence={(label) => t('exceptions.wantedBy', { rule: label })} />}
                  </div>
                  <div class="num text-[13px] text-muted @max-2xl:hidden">{date(x.at)}</div>
                  <Button variant="text" aria-label={t('exceptions.deleteLabel', { title: x.title })} onClick={() => void remove(x.videoId)}>
                    {t('common.delete')}
                  </Button>
                </li>
              );
            })}
          </ul>
          {list.length === 0 && <p class="mt-4 text-muted">{t('exceptions.noMatch')}</p>}
          {list.length > limit && (
            <Button class="mt-4" onClick={() => setLimit((l) => l + EXCEPTIONS_PAGE)}>
              {t('exceptions.more')}
            </Button>
          )}
        </>
      )}
      <Status tone="danger" class="mt-2">
        {error ? t('exceptions.error.save') : ''}
      </Status>
    </section>
  );
}
