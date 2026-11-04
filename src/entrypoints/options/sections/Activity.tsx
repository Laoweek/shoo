// Activity (docs/spec/ui-design.md Section 6, REQ-ACTV-1/2): day guides ("Today · 17 shooed"), rows with
// time, Rule, Activity kind, title, channel and Surface, and the actions Undo (while YouTube still
// offers it), Keep and Always keep this channel. Keep rule keeps have no actions. Unseen rows stay lit
// until scrolled into view for 1 s.
// Deep link: #activity?batch=<id> (the batch summary's Review button) and #activity?rule=<id>.
import { Search, X } from 'lucide-preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { dayKey } from '~/core/escalation';
import { isBannedChannel } from '~/core/rules';
import { SITE_IDS, SITE_NAMES, siteOfVideo } from '~/core/sites';
import type { ActivityEvent, ActivityKind, Rule, SiteId } from '~/core/types';
import { t } from '~/i18n';
import { sendMessage } from '~/messaging/protocol';
import { readActivity, readCounters, watchActivity, watchCounters } from '~/store/read';
import { Button, Notice, RuleRef, Segmented, SkeletonRows, ruleLabel } from '~/ui/components';
import { Escalations } from '~/ui/pages/Escalations';
import { clock, dayLabel, thumbUrl, whereLabel } from '~/ui/pages/format';
import { useAsync, useDebounced, useNow } from '~/ui/pages/hooks';
import { useKeepChannel } from '~/ui/pages/keep-channel';
import { SectionHead, Select, Status } from '~/ui/pages/parts';
import { byId } from '~/ui/pages/rules';
import { ThumbWall } from '~/ui/pages/ThumbWall';
import type { SectionProps } from '../context';

const PAGE = 300;
/** Each search reads every stored Activity page, so it waits for a pause in typing. */
export const SEARCH_PAUSE_MS = 150;
/** session:removalTabs keeps a Removal's tab for 1 hour (architecture.md Section 6). */
export const UNDO_WINDOW_MS = 60 * 60 * 1000;
/** How long a row must be in view before it counts as seen. */
export const SEEN_AFTER_MS = 1000;

const KINDS: ActivityKind[] = ['removed', 'kept', 'keptByRule', 'wouldRemove', 'failed', 'escalated', 'banned', 'undone', 'renumbered', 'shelfDismissed'];
export const activityKindLabel = (k: ActivityKind): string => t(`activity.kind.${k}`);

export function Activity({ data, params }: SectionProps) {
  const now = useNow();
  const [text, setText] = useState('');
  const [ruleId, setRuleId] = useState(params.get('rule') ?? '');
  const [kind, setKind] = useState<ActivityKind | ''>('');
  const [site, setSite] = useState<SiteId | ''>('');
  const [batchId, setBatchId] = useState(params.get('batch') ?? '');
  const [view, setView] = useState<'list' | 'wall'>('list');
  const [limit, setLimit] = useState(PAGE);
  const [failed, setFailed] = useState(false);
  const channel = useKeepChannel(data.rules, (ok) => setFailed(!ok));

  // A new deep link (hash change while the page is open) replaces the filters.
  useEffect(() => {
    setRuleId(params.get('rule') ?? '');
    setBatchId(params.get('batch') ?? '');
  }, [params.toString()]);

  const typed = text.trim();
  // Clearing the box shows everything at once, and the next search starts from no filter.
  const paused = useDebounced(typed, typed ? SEARCH_PAUSE_MS : 0);
  const query = typed ? paused : '';
  const kinds = view === 'wall' ? (['removed'] as ActivityKind[]) : kind ? [kind] : undefined;
  const events = useAsync(
    () =>
      readActivity({
        ...(query ? { text: query } : {}),
        ...(ruleId ? { ruleId } : {}),
        ...(batchId ? { batchId } : {}),
        ...(kinds ? { kinds } : {}),
        ...(site ? { site } : {}),
        limit,
      }),
    [watchActivity],
    [query, ruleId, kind, site, batchId, view, limit],
  );
  const rules = byId(data.rules);
  const list = events.data ?? [];
  const filtered = !!(query || ruleId || kind || site || batchId);

  return (
    <section aria-labelledby="section-activity">
      <SectionHead id="section-activity" title={t('activity.title')} lede={t('activity.lede')} />
      <Escalations rules={data.rules} variant="strip" class="mb-6" />
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <label class="flex h-9 min-w-[12rem] flex-1 items-center gap-2 rounded-[12px] border border-edge bg-paper px-3 hover:border-ink focus-within:border-ink focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink">
          <Search size={16} strokeWidth={2} aria-hidden="true" class="shrink-0 text-muted" />
          <span class="sr-only">{t('activity.search')}</span>
          <input
            type="search"
            value={text}
            placeholder={t('activity.search')}
            onInput={(e) => setText(e.currentTarget.value)}
            class="w-full min-w-0 border-0 bg-transparent text-[16px] placeholder:text-muted focus:outline-none"
          />
        </label>
        <label class="sr-only" for="activity-rule">
          {t('activity.filter.rule')}
        </label>
        <Select id="activity-rule" class="w-auto max-w-[14rem]" value={ruleId} onChange={(e) => setRuleId(e.currentTarget.value)}>
          <option value="">{t('activity.filter.allRules')}</option>
          {/* Grouped, because a Rule name alone doesn't say whether it removes or keeps. */}
          {ruleGroups(data.rules ?? []).map(([label, group]) =>
            group.length === 0 ? null : (
              <optgroup key={label} label={label}>
                {group.map((r) => (
                  <option key={r.id} value={r.id}>
                    {ruleLabel(r)}
                  </option>
                ))}
              </optgroup>
            ),
          )}
        </Select>
        {view === 'list' && (
          <>
            <label class="sr-only" for="activity-kind">
              {t('activity.filter.kind')}
            </label>
            <Select id="activity-kind" class="w-auto" value={kind} onChange={(e) => setKind(e.currentTarget.value as ActivityKind | '')}>
              <option value="">{t('activity.filter.allKinds')}</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {activityKindLabel(k)}
                </option>
              ))}
            </Select>
          </>
        )}
        <label class="sr-only" for="activity-site">
          {t('activity.filter.site')}
        </label>
        <Select id="activity-site" class="w-auto" value={site} onChange={(e) => setSite(e.currentTarget.value as SiteId | '')}>
          <option value="">{t('activity.filter.allSites')}</option>
          {SITE_IDS.map((s) => (
            <option key={s} value={s}>
              {SITE_NAMES[s]}
            </option>
          ))}
        </Select>
        <Segmented
          label={t('activity.view.label')}
          value={view}
          onChange={setView}
          options={[
            { value: 'list', label: t('activity.view.list') },
            { value: 'wall', label: t('activity.view.wall') },
          ]}
        />
      </div>
      {batchId && (
        <p class="mt-0 mb-4 inline-flex items-center gap-2 rounded-full bg-paper py-1 pr-1 pl-3 text-[13px] shadow-card">
          {t('activity.filter.batchOn')}
          <button
            type="button"
            aria-label={t('activity.filter.clearBatch')}
            onClick={() => {
              setBatchId('');
              data.go('activity', ruleId ? `rule=${encodeURIComponent(ruleId)}` : undefined);
            }}
            class="grid size-6 cursor-pointer place-items-center rounded-full hover:bg-tint"
          >
            <X size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </p>
      )}
      {channel.prompt}
      {events.error ? (
        <Notice tone="danger" live="alert">
          {t('activity.error.load')}
        </Notice>
      ) : events.loading ? (
        <SkeletonRows rows={6} />
      ) : list.length === 0 ? (
        <p class="card m-0 p-5">{filtered ? t('activity.noMatch') : t('activity.empty')}</p>
      ) : view === 'wall' ? (
        <ThumbWall
          label={t('activity.view.wall')}
          class="card p-4"
          items={list
            .filter((e) => e.videoId)
            .map((e) => ({ id: e.id, videoId: e.videoId!, cover: e.cover, title: e.title ?? '', colour: e.ruleId ? rules.get(e.ruleId)?.colour : undefined }))}
        />
      ) : (
        <ActivityList events={list} rules={rules} now={now} onKeepChannel={(name, site) => void channel.keep({ channelName: name, site })} />
      )}
      {list.length >= limit && (
        <Button class="mt-4" onClick={() => setLimit((l) => l + PAGE)}>
          {t('activity.more')}
        </Button>
      )}
      <Status tone="danger" class="mt-2">
        {failed ? t('keep.error.save') : ''}
      </Status>
    </section>
  );
}

/** The Rule filter's groups: Rules, Keep rules, Banned channels. */
const ruleGroups = (rules: Rule[]): [string, Rule[]][] => [
  [t('rules.title'), rules.filter((r) => r.polarity === 'remove' && !isBannedChannel(r))],
  [t('keep.title'), rules.filter((r) => r.polarity === 'keep')],
  [t('banned.title'), rules.filter(isBannedChannel)],
];

export function ActivityList({
  events,
  rules,
  now,
  onKeepChannel,
}: {
  events: ActivityEvent[];
  rules: Map<string, Rule>;
  now: number;
  onKeepChannel: (name: string, site?: SiteId) => void;
}) {
  const days = useMemo(() => {
    const out = new Map<string, ActivityEvent[]>();
    for (const e of events) {
      const d = dayKey(e.at);
      out.set(d, [...(out.get(d) ?? []), e]);
    }
    return [...out.entries()];
  }, [events]);
  const observe = useSeen();

  // A container, so a row goes on one line only where the list (not the window) is wide enough.
  return (
    <div class="card @container px-3 pb-1">
      {days.map(([day, rows]) => (
        <section key={day} aria-label={dayLabel(day, now)}>
          <DayGuide day={day} now={now} />
          <ul class="m-0 list-none p-0">
            {rows.map((e) => (
              <ActivityRow key={e.id} event={e} rule={e.ruleId ? rules.get(e.ruleId) : undefined} now={now} observe={observe} onKeepChannel={onKeepChannel} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** "Today · 17 shooed": the day's Removals from the daily counters, whatever the filters show. */
function DayGuide({ day, now }: { day: string; now: number }) {
  const counters = useAsync(() => readCounters(day), [watchCounters], [day]);
  const label = dayLabel(day, now);
  return (
    <h3 class="sticky top-0 z-[1] m-0 flex justify-between border-b border-line bg-paper p-2 text-[12px] font-semibold">
      {/* No "0 shooed" over a day of Dry-run rows: the count shows only once something was removed. */}
      <span class="num">{counters.data?.removed ? t('activity.day', { day: label, count: String(counters.data.removed) }) : label}</span>
    </h3>
  );
}

type RowState = { kind: 'idle' } | { kind: 'busy' } | { kind: 'note'; text: string; tone: 'plain' | 'danger' };

function ActivityRow({
  event: e,
  rule,
  now,
  observe,
  onKeepChannel,
}: {
  event: ActivityEvent;
  rule?: Rule;
  now: number;
  observe: (el: Element | null, id: string, unseen: boolean) => void;
  onKeepChannel: (name: string, site?: SiteId) => void;
}) {
  const [state, setState] = useState<RowState>({ kind: 'idle' });
  const unseen = e.seenAt === undefined;
  const canUndo = e.kind === 'removed' && !!e.videoId && now - e.at < UNDO_WINDOW_MS;
  const canKeep = (e.kind === 'removed' || e.kind === 'wouldRemove') && !!e.videoId;
  const canKeepChannel = (e.kind === 'removed' || e.kind === 'wouldRemove' || e.kind === 'kept' || e.kind === 'undone') && !!e.channelName;
  const site = siteOfVideo(e);
  // Undo is offered only for a Removal, whose video ID names its Site.
  const siteName = SITE_NAMES[site ?? 'youtube'];

  const undo = async () => {
    setState({ kind: 'busy' });
    try {
      const res = await sendMessage('undoFromActivity', { videoId: e.videoId! });
      const text = res.ok ? t('activity.undo.done', { site: siteName }) : t('activity.undo.expired', { site: siteName });
      setState({ kind: 'note', text, tone: res.ok ? 'plain' : 'danger' });
    } catch {
      setState({ kind: 'note', text: t('activity.undo.expired', { site: siteName }), tone: 'danger' });
    }
  };
  const keep = async () => {
    setState({ kind: 'busy' });
    try {
      await sendMessage('addException', {
        videoId: e.videoId!,
        title: e.title ?? '',
        ...(e.channelName ? { channelName: e.channelName } : {}),
        ...(e.ruleId ? { ruleId: e.ruleId } : {}),
        origin: 'activityKeep',
      });
      setState({ kind: 'note', text: t('activity.kept'), tone: 'plain' });
    } catch {
      setState({ kind: 'note', text: t('keep.error.save'), tone: 'danger' });
    }
  };

  const title =
    e.kind === 'renumbered'
      ? t('activity.renumbered', { detail: e.detail ?? '' })
      : e.kind === 'shelfDismissed' && e.shelf
        ? t(`activity.shelf.${e.shelf}`)
        : (e.title ?? '');
  const thumb = e.videoId ? thumbUrl(e.videoId, e.cover) : undefined;
  // One line where the list is at least 48rem wide: time, thumbnail, title, Rule, actions. Narrower, the
  // Rule and the actions each take a line under the title, so neither squeezes the title.
  return (
    <li
      ref={(el) => observe(el, e.id, unseen)}
      data-activity-id={e.id}
      class={`grid grid-cols-[52px_minmax(0,1fr)] items-center gap-x-3 gap-y-1 border-b border-line p-2 @lg:grid-cols-[52px_54px_minmax(0,1fr)] @3xl:grid-cols-[52px_54px_minmax(0,1fr)_150px_16.5rem] ${unseen ? 'bg-lit' : ''}`}
    >
      <time dateTime={new Date(e.at).toISOString()} class={`num inline-flex items-center gap-1 text-[13px] ${unseen ? 'font-semibold text-ink' : 'text-muted'}`}>
        {unseen && <span aria-hidden="true" class="size-1.5 rounded-full bg-ink" />}
        {unseen && <span class="sr-only">{t('activity.unseen')}</span>}
        {clock(e.at)}
      </time>
      <span class="relative h-[30px] w-[54px] overflow-hidden rounded-[6px] bg-tint @max-lg:hidden" aria-hidden="true">
        {thumb && <img src={thumb} alt="" width={54} height={30} loading="lazy" decoding="async" referrerpolicy="no-referrer" class="block h-[30px] w-[54px] object-cover" />}
      </span>
      <div class="min-w-0">
        <div class="truncate font-medium" title={title}>
          {title}
        </div>
        <div class="truncate text-[13px] text-muted">{[e.channelName, e.surface ? whereLabel(e.surface) : site && SITE_NAMES[site]].filter(Boolean).join(' · ')}</div>
      </div>
      {/* The Rule's name over the Activity kind, like the title over the channel. */}
      <div class="col-start-2 inline-flex min-w-0 items-center gap-2 text-[13px] @lg:col-start-3 @3xl:col-start-auto @3xl:flex-col @3xl:items-start @3xl:gap-0">
        {rule && <RuleRef rule={rule} class="font-medium" />}{' '}
        <span class="shrink-0 whitespace-nowrap text-muted">{activityKindLabel(e.kind)}</span>
      </div>
      <div class="col-start-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] empty:hidden @lg:col-start-3 @3xl:col-start-auto @3xl:justify-end">
        {state.kind === 'note' ? (
          <span role="status" class={state.tone === 'danger' ? 'text-danger' : 'text-muted'}>
            {state.text}
          </span>
        ) : (
          <>
            {canUndo && (
              <Button variant="text" disabled={state.kind === 'busy'} aria-label={t('activity.undoLabel', { title: e.title ?? '' })} onClick={() => void undo()}>
                {t('common.undo')}
              </Button>
            )}
            {canKeep && (
              <Button variant="text" disabled={state.kind === 'busy'} aria-label={t('activity.keepLabel', { title: e.title ?? '' })} onClick={() => void keep()}>
                {t('common.keep')}
              </Button>
            )}
            {canKeepChannel && (
              <Button variant="text" disabled={state.kind === 'busy'} aria-label={t('activity.keepChannelLabel', { channel: e.channelName! })} onClick={() => onKeepChannel(e.channelName!, site)}>
                {t('common.keepChannel')}
              </Button>
            )}
          </>
        )}
      </div>
    </li>
  );
}

/**
 * Lit-until-seen: an unseen row counts as seen once it has been at least half in view for 1 s. Seen ids
 * are sent in small batches with markActivitySeen, which persists `seenAt`.
 */
export function useSeen(send: (ids: string[]) => void = (ids) => void sendMessage('markActivitySeen', { ids })) {
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const sent = useRef(new Set<string>());
  const pending = useRef(new Set<string>());
  const flush = useRef<ReturnType<typeof setTimeout>>(undefined);
  const observer = useRef<IntersectionObserver | null>(null);
  const sendRef = useRef(send);
  sendRef.current = send;

  const seen = (io: IntersectionObserver, target: Element, id: string) => {
    timers.current.delete(id);
    sent.current.add(id);
    pending.current.add(id);
    io.unobserve(target);
    clearTimeout(flush.current);
    flush.current = setTimeout(() => {
      const ids = [...pending.current];
      pending.current.clear();
      if (ids.length) sendRef.current(ids);
    }, 200);
  };

  // Created on first use: rows mount (and call `observe`) before effects run.
  const get = (): IntersectionObserver | null => {
    if (observer.current || typeof IntersectionObserver === 'undefined') return observer.current;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.activityId;
          if (!id || sent.current.has(id)) continue;
          if (entry.isIntersecting) {
            if (!timers.current.has(id)) timers.current.set(id, setTimeout(() => seen(io, entry.target, id), SEEN_AFTER_MS));
          } else {
            clearTimeout(timers.current.get(id));
            timers.current.delete(id);
          }
        }
      },
      { threshold: 0.5 },
    );
    observer.current = io;
    return io;
  };

  useEffect(
    () => () => {
      observer.current?.disconnect();
      observer.current = null;
      timers.current.forEach(clearTimeout);
      timers.current.clear();
      clearTimeout(flush.current);
      const ids = [...pending.current];
      pending.current.clear();
      if (ids.length) sendRef.current(ids);
    },
    [],
  );

  return (el: Element | null, id: string, unseen: boolean) => {
    if (!el || !unseen || sent.current.has(id)) return;
    get()?.observe(el);
  };
}
