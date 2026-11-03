// Exceptions (docs/spec/ui-design.md Section 6): kept videos with title, channel, date and the Rule that
// wanted them gone. Search and delete.
import { Search } from 'lucide-preact';
import { useMemo, useState } from 'preact/hooks';
import { normalizeText } from '~/core/exact';
import { t } from '~/i18n';
import { sendMessage } from '~/messaging/protocol';
import { Button, Notice, RuleRef, SkeletonRows } from '~/ui/components';
import { date } from '~/ui/pages/format';
import { SectionHead, Status, focusHeading } from '~/ui/pages/parts';
import { byId } from '~/ui/pages/rules';
import type { SectionProps } from '../context';

export function Exceptions({ data }: SectionProps) {
  const [query, setQuery] = useState('');
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
        <p class="m-0 border-t border-line-strong pt-4">{t('exceptions.empty')}</p>
      ) : (
        <>
          <label class="mb-4 flex h-9 max-w-sm items-center gap-2 rounded-[6px] border border-edge px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink">
            <Search size={16} strokeWidth={1.75} aria-hidden="true" class="shrink-0 text-muted" />
            <span class="sr-only">{t('exceptions.search')}</span>
            <input
              type="search"
              value={query}
              placeholder={t('exceptions.search')}
              onInput={(e) => setQuery(e.currentTarget.value)}
              class="w-full min-w-0 border-0 bg-transparent text-[16px] placeholder:text-muted focus:outline-none"
            />
          </label>
          {/* A container, so the Rule and date columns give way to the title in a narrow list. */}
          <ul aria-labelledby="section-exceptions" class="@container m-0 list-none border-t border-line-strong p-0">
            {list.map((x) => {
              const rule = x.ruleId ? rules.get(x.ruleId) : undefined;
              return (
                <li key={x.videoId} class="grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-b border-line p-2 @2xl:grid-cols-[minmax(0,1fr)_14rem_6rem_auto]">
                  <div class="min-w-0">
                    <div class="truncate font-medium" title={x.title}>
                      {x.title}
                    </div>
                    {x.channelName && <div class="truncate text-[13px] text-muted">{x.channelName}</div>}
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
        </>
      )}
      <Status tone="danger" class="mt-2">
        {error ? t('exceptions.error.save') : ''}
      </Status>
    </section>
  );
}
