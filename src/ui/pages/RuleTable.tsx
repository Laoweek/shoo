// The Rules table (Rules and Keep rules sections): swatch + ref, kind, inline-editable name and text,
// hits this week, on/off switch and an expandable row (docs/spec/ui-design.md Section 6). A real <table>, so
// screen readers announce rows and columns, and every control sits in the Tab order.
import { ChevronDown, Plus, Trash2 } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { validateRegex } from '~/core/regex';
import { isBannedChannel, RULE_NAME_MAX } from '~/core/rules';
import { SUBSCRIPTIONS_MAX_AGE_MS } from '~/core/subscriptions';
import type { Polarity, Rule, RuleKind, RuleOp } from '~/core/types';
import { t } from '~/i18n';
import { sendMessage } from '~/messaging/protocol';
import { hitsThisWeek, type RuleStats, type StoredSubscriptions } from '~/store/local';
import { readActivity, readSubscriptions, watchSubscriptions } from '~/store/read';
import { Button, RuleRef, Switch, ruleLabel } from '../components';
import { count, weekStart, when } from './format';
import { useAsync } from './hooks';
import { Select, Status, TextInput, focusHeading } from './parts';
import {
  COUNTER_FROM,
  SOFT_TEXT_LIMIT,
  addOp,
  findAdded,
  hasName,
  kindLabel,
  namePatch,
  needsModel,
  offeredKinds,
  ruleHints,
  sortByActivity,
  takesHints,
  textPatch,
  type Draft,
  type RuleHint,
} from './rules';
import { ThumbWall } from './ThumbWall';

export type MutateResult = { ok: true; rules: Rule[] } | { ok: false; quota: boolean };

export async function mutate(ops: RuleOp[]): Promise<MutateResult> {
  try {
    const res = await sendMessage('mutateRules', { ops });
    if ('error' in res) return { ok: false, quota: res.error === 'syncQuota' };
    return { ok: true, rules: res.rules };
  } catch {
    return { ok: false, quota: false };
  }
}

const saveError = (polarity: Polarity, quota: boolean) => (quota ? t('rules.error.syncQuota') : polarity === 'keep' ? t('keep.error.save') : t('rules.error.save'));

export interface RuleTableProps {
  rules: Rule[];
  stats: RuleStats;
  now: number;
  regexEnabled: boolean;
  /** Refs whose text reaches the model only in part (state budget). */
  truncatedRefs?: ReadonlySet<string>;
  /** Eyes widen on the hovered Rule row (ui-design.md Section 3). */
  onHover?: (hovering: boolean) => void;
  /** Id of the heading that names the table. */
  labelledBy: string;
}

export function RuleTable({ rules, stats, now, regexEnabled, truncatedRefs, onHover, labelledBy }: RuleTableProps) {
  const [open, setOpen] = useState<string>();
  const sorted = sortByActivity(rules, stats, now);
  return (
    <table aria-labelledby={labelledBy} class="w-full table-fixed border-collapse border-t border-line-strong text-left">
      {/* Narrow windows shrink the Kind column to zero width (it keeps its place, so the expanded row's colSpan holds)
          and show the kind under the Rule text instead. */}
      <thead>
        <tr class="h-[30px] border-b border-line-strong text-[12px] text-muted">
          <th scope="col" class="w-[64px] px-2 font-semibold">{t('rules.table.rule')}</th>
          <th scope="col" class="w-[176px] px-2 font-semibold max-sm:w-0 max-sm:p-0">
            <span class="max-sm:hidden">{t('rules.table.kind')}</span>
          </th>
          <th scope="col" class="px-2 font-semibold">{t('rules.table.text')}</th>
          <th scope="col" class="w-[76px] px-2 text-right font-semibold">{t('rules.table.week')}</th>
          <th scope="col" class="w-[48px] px-2 font-semibold">{t('rules.table.on')}</th>
          <th scope="col" class="w-[36px] px-0">
            <span class="sr-only">{t('rules.table.more')}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <RuleRow
            key={r.id}
            rule={r}
            stats={stats}
            now={now}
            regexEnabled={regexEnabled}
            truncated={truncatedRefs?.has(r.ref) ?? false}
            open={open === r.id}
            onToggle={() => setOpen((o) => (o === r.id ? undefined : r.id))}
            onHover={onHover}
          />
        ))}
      </tbody>
    </table>
  );
}

interface RowProps {
  rule: Rule;
  stats: RuleStats;
  now: number;
  regexEnabled: boolean;
  truncated: boolean;
  open: boolean;
  onToggle: () => void;
  onHover?: (hovering: boolean) => void;
}

function RuleRow({ rule, stats, now, regexEnabled, truncated, open, onToggle, onHover }: RowProps) {
  const [text, setText] = useState(rule.text);
  const [name, setName] = useState(rule.name ?? '');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string>();
  const [enabled, setEnabled] = useState(rule.enabled);
  useEffect(() => setText(rule.text), [rule.text]);
  useEffect(() => setName(rule.name ?? ''), [rule.name]);
  useEffect(() => setEnabled(rule.enabled), [rule.enabled]);

  const keep = rule.polarity === 'keep';
  const regexOff = rule.kind === 'regex' && !regexEnabled;
  const off = !enabled || regexOff;
  const week = hitsThisWeek(stats[rule.id], now);
  const panelId = `rule-panel-${rule.id}`;
  const textId = `rule-text-${rule.id}`;
  const hintId = `rule-hint-${rule.id}`;
  const hints = takesHints(rule.polarity, rule.kind) ? (editing ? ruleHints(text) : []) : undefined;
  const notes: string[] = [];
  if (rule.kind === 'channel' && !keep) notes.push(t('rules.kind.channelAction'));
  if (rule.skipSubscribed && offersSkipSubscribed(rule)) notes.push(t('rules.skipSubscribed.note'));
  if (regexOff) notes.push(t('rules.regex.disabledNote'));

  const commit = async () => {
    const next = text.trim();
    if (next === rule.text) return;
    if (!next) return setText(rule.text);
    if (rule.kind === 'regex') {
      const check = validateRegex(next);
      if (!check.ok) return setError(t(`rules.regex.reason.${check.reason}`));
    }
    setError(undefined);
    const res = await mutate([textPatch(rule, next)]);
    if (!res.ok) {
      setError(saveError(rule.polarity, res.quota));
      setText(rule.text);
    }
  };

  const commitName = async () => {
    const next = name.trim();
    if (next === (rule.name ?? '')) return setName(next);
    setError(undefined);
    const res = await mutate([namePatch(rule, next)]);
    if (!res.ok) {
      setError(saveError(rule.polarity, res.quota));
      setName(rule.name ?? '');
    }
  };

  const toggle = async (v: boolean) => {
    setEnabled(v);
    setError(undefined);
    const res = await mutate([{ op: 'update', id: rule.id, patch: { enabled: v } }]);
    if (!res.ok) {
      setEnabled(!v);
      setError(saveError(rule.polarity, res.quota));
    }
  };

  const len = [...text].length;
  const kind = (
    <>
      {kindLabel(rule.kind, rule.polarity)}
      {notes.map((n) => (
        <small key={n} class="block text-[12px]">
          {n}
        </small>
      ))}
    </>
  );
  return (
    <>
      <tr
        onMouseEnter={() => onHover?.(true)}
        onMouseLeave={() => onHover?.(false)}
        class={`border-b border-line align-middle ${open ? 'border-b-transparent bg-tint' : 'hover:bg-tint'}`}
      >
        <td class="px-2 py-2">
          <RuleRef rule={rule} show="ref" off={off} />
        </td>
        <td class="px-2 py-2 text-[13px] leading-tight text-muted max-sm:p-0">
          <div class="max-sm:hidden">{kind}</div>
        </td>
        <td class="px-2 py-2">
          {hasName(rule.kind) && (
            <input
              type="text"
              value={name}
              maxLength={RULE_NAME_MAX}
              dir="auto"
              placeholder={t('rules.name.placeholder')}
              aria-label={t('rules.row.name', { ref: rule.ref })}
              onInput={(e) => setName(e.currentTarget.value)}
              onBlur={() => void commitName()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') {
                  setName(rule.name ?? '');
                  setError(undefined);
                }
              }}
              class={`-mx-2 block h-6 w-[calc(100%+16px)] rounded-[6px] border border-transparent bg-transparent px-2 font-semibold text-ellipsis placeholder:font-normal placeholder:text-muted hover:border-line-strong focus:border-edge ${off ? 'text-muted' : 'text-ink'}`}
            />
          )}
          <input
            id={textId}
            type="text"
            value={text}
            maxLength={500}
            aria-label={t('rules.row.text', { ref: rule.ref })}
            aria-invalid={error ? true : undefined}
            aria-describedby={hints?.length ? hintId : undefined}
            onInput={(e) => setText(e.currentTarget.value)}
            onFocus={() => setEditing(true)}
            onBlur={() => {
              setEditing(false);
              void commit();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                setText(rule.text);
                setError(undefined);
              }
            }}
            class={`-mx-2 w-[calc(100%+16px)] rounded-[6px] border border-transparent bg-transparent px-2 text-ellipsis hover:border-line-strong focus:border-edge ${hasName(rule.kind) ? 'block h-6' : 'h-[30px]'} ${off ? 'text-muted' : 'text-ink'}`}
          />
          {/* Narrow windows drop the Kind column, so the kind sits under the Rule text instead. */}
          <span class="block text-[13px] leading-tight text-muted sm:hidden">{kind}</span>
          {len >= COUNTER_FROM && (
            <span class={`num block text-[12px] ${len > SOFT_TEXT_LIMIT ? 'text-danger' : 'text-muted'}`}>
              {t('rules.text.counter', { count: String(len), max: String(SOFT_TEXT_LIMIT) })}
              {len > SOFT_TEXT_LIMIT && ` ${t('rules.text.over')}`}
            </span>
          )}
          {hints && <HintLines id={hintId} hints={hints} />}
          {truncated && <span class="block text-[13px] text-muted">{t('rules.budget.truncated', { rule: rule.name ?? rule.ref })}</span>}
          {error && (
            <span role="alert" class="block text-[13px] text-danger">
              {error}
            </span>
          )}
        </td>
        <td class={`num px-2 py-2 text-right font-semibold ${off ? 'text-muted' : ''}`}>{count(week)}</td>
        <td class="px-1 py-2">
          <Switch checked={enabled} onChange={(v) => void toggle(v)} label={t('rules.row.on', { ref: rule.ref })} />
        </td>
        <td class="py-2 pr-1">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            aria-label={open ? t('rules.row.collapse', { ref: rule.ref }) : t('rules.row.expand', { ref: rule.ref })}
            onClick={onToggle}
            class="grid size-[30px] cursor-pointer place-items-center rounded-[6px] text-muted hover:bg-lit hover:text-ink"
          >
            <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" class={`transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
          </button>
        </td>
      </tr>
      {open && (
        <tr id={panelId} class="border-b border-line bg-tint">
          <td colSpan={6} class="px-2 pt-2 pb-4 sm:pl-[72px]">
            <RulePanel rule={rule} stats={stats} now={now} />
          </td>
        </tr>
      )}
    </>
  );
}

function RulePanel({ rule, stats, now }: { rule: Rule; stats: RuleStats; now: number }) {
  const stat = stats[rule.id];
  const [error, setError] = useState(false);
  // The videos this Rule removed this week, or for a Keep rule the videos it rescued (its Rescues).
  const keep = rule.polarity === 'keep';
  const wall = useAsync(() => readActivity({ kinds: [keep ? 'keptByRule' : 'removed'], ruleId: rule.id, fromDay: weekStart(now) }), [], [rule.id]);
  const events = (wall.data ?? []).filter((e) => e.videoId);
  // A kept video comes back day after day, so the wall shows each video once, newest first.
  const onWall = new Set<string>();
  const videos = events.filter((e) => !onWall.has(e.videoId!) && onWall.add(e.videoId!));
  const wallLabel = keep ? t('rules.row.keptThisWeek') : t('rules.row.removedThisWeek');

  const del = async () => {
    setError(false);
    const res = await mutate([{ op: 'delete', id: rule.id }]);
    if (!res.ok) setError(true);
    else focusHeading();
  };

  return (
    <div class="grid gap-4">
      {events.length > 0 && (
        <div>
          <div class="mb-2 flex items-baseline justify-between gap-3">
            <span class="text-[12px] font-semibold text-muted">{wallLabel}</span>
            <a href={`#activity?rule=${encodeURIComponent(rule.id)}`} class="text-[13px] font-semibold text-ink underline underline-offset-[3px]">
              {t('rules.row.seeAll', events.length)}
            </a>
          </div>
          <ThumbWall
            label={wallLabel}
            items={videos.slice(0, 24).map((e) => ({ id: e.id, videoId: e.videoId!, title: e.title ?? '', colour: rule.colour }))}
          />
        </div>
      )}
      {offersSkipSubscribed(rule) && <SkipSubscribed rule={rule} now={now} />}
      <div class="flex flex-wrap items-center gap-x-6 gap-y-1 text-[13px] text-muted">
        <span class="num">{t('rules.row.allTime', stat?.total ?? 0)}</span>
        {stat?.lastHitAt ? <span class="num">{t('rules.row.lastHit', { time: when(stat.lastHitAt, now) })}</span> : null}
        <span class="flex-1" />
        <Button variant="text" onClick={() => void del()} class="text-[13px]">
          <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
          {t('rules.row.delete', { ref: rule.ref })}
        </Button>
      </div>
      {error && (
        <p role="alert" class="m-0 text-[13px] text-danger">
          {saveError(rule.polarity, false)}
        </p>
      )}
    </div>
  );
}

/** Every remove Rule but a Banned channel, which names one channel already (REQ-RULE-14). */
const offersSkipSubscribed = (rule: Rule): boolean => rule.polarity === 'remove' && !isBannedChannel(rule);

/** The expanded row's "Never shoo channels I'm subscribed to" switch, with what Shoo knows of the list. */
function SkipSubscribed({ rule, now }: { rule: Rule; now: number }) {
  const [on, setOn] = useState(rule.skipSubscribed === true);
  const [error, setError] = useState(false);
  useEffect(() => setOn(rule.skipSubscribed === true), [rule.skipSubscribed]);
  const stored = useAsync(() => readSubscriptions(), [watchSubscriptions]);
  const labelId = `rule-skip-${rule.id}`;

  const toggle = async (v: boolean) => {
    setOn(v);
    setError(false);
    const res = await mutate([{ op: 'update', id: rule.id, patch: { skipSubscribed: v } }]);
    if (!res.ok) {
      setOn(!v);
      setError(true);
    }
  };

  return (
    <div class="flex items-start gap-3">
      <Switch checked={on} onChange={(v) => void toggle(v)} labelledBy={labelId} />
      <div class="min-w-0 text-[13px] leading-snug">
        <span id={labelId} class="block font-semibold text-ink">
          {t('rules.skipSubscribed.label')}
        </span>
        <span class="block text-muted">{on && !stored.loading ? subscriptionsStatus(stored.data, now) : t('rules.skipSubscribed.hint')}</span>
        {error && (
          <span role="alert" class="block text-danger">
            {saveError(rule.polarity, false)}
          </span>
        )}
      </div>
    </div>
  );
}

function subscriptionsStatus(stored: StoredSubscriptions | undefined, now: number): string {
  const list = stored?.list && now - stored.list.readAt < SUBSCRIPTIONS_MAX_AGE_MS ? stored.list : undefined;
  if (list) {
    const channels = t('rules.skipSubscribed.channels', Math.max(list.ids.length, list.handles.length, list.keys.length));
    return t('rules.skipSubscribed.read', { channels, time: when(list.readAt, now) });
  }
  return stored && stored.failures > 0 ? t('rules.skipSubscribed.unreadable') : t('rules.skipSubscribed.pending');
}

// ---------------------------------------------------------------------------------------------------
// Add a Rule

export interface AddRuleProps {
  polarity: Polarity;
  regexEnabled: boolean;
  /** Consent and a key: Topic and Thumbnail kinds need the Decision model. */
  modelOk: boolean;
  /** Channel Keep rules go through keepChannel so a ban can be lifted (REQ-EXC-3). */
  onKeepChannel?: (name: string) => Promise<void>;
  onAdded?: (rule: Rule) => void;
}

export function AddRule({ polarity, regexEnabled, modelOk, onKeepChannel, onAdded }: AddRuleProps) {
  const kinds = offeredKinds(polarity, regexEnabled);
  const firstKind = (): RuleKind => (modelOk ? 'topic' : 'keyword');
  const [openForm, setOpenForm] = useState(false);
  const [draft, setDraft] = useState<Draft>({ kind: firstKind(), text: '' });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [announce, setAnnounce] = useState('');
  const textRef = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (openForm) textRef.current?.focus();
  }, [openForm, draft.kind]);

  const close = () => {
    setOpenForm(false);
    setError(undefined);
    setDraft({ kind: firstKind(), text: '' });
    queueMicrotask(() => addButton.current?.focus());
  };

  const blocked = needsModel(draft.kind) && !modelOk;
  const op = blocked ? undefined : addOp(polarity, draft);
  const regexCheck = draft.kind === 'regex' && draft.text.trim() ? validateRegex(draft.text.trim()) : undefined;

  const save = async () => {
    if (!op || busy) return;
    if (regexCheck && !regexCheck.ok) return setError(t(`rules.regex.reason.${regexCheck.reason}`));
    setBusy(true);
    setError(undefined);
    try {
      if (polarity === 'keep' && draft.kind === 'channel' && onKeepChannel) {
        await onKeepChannel(draft.text.trim());
        close();
        return;
      }
      const res = await mutate([op]);
      if (!res.ok) return setError(saveError(polarity, res.quota));
      const rule = findAdded(res.rules, op);
      if (rule) {
        setAnnounce(t('rules.added', { rule: ruleLabel(rule) })); // names the Rule, so each add is announced
        onAdded?.(rule);
      }
      close();
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: KeyboardEvent) => {
    // Enter saves from the text fields only, so Enter on Cancel still cancels.
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
      e.preventDefault();
      void save();
    }
    if (e.key === 'Escape') close();
  };

  const formId = `add-${polarity}`;
  return (
    <div class="mt-4">
      {!openForm ? (
        <button
          ref={addButton}
          type="button"
          onClick={() => setOpenForm(true)}
          class="inline-flex h-[30px] cursor-pointer items-center gap-2 rounded-[6px] border border-edge px-3 font-semibold hover:bg-tint"
        >
          <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
          {polarity === 'keep' ? t('keep.add') : t('rules.add')}
        </button>
      ) : (
        <div role="group" aria-label={polarity === 'keep' ? t('keep.add') : t('rules.add')} onKeyDown={onKey} class="grid gap-2 border-b border-line bg-tint px-2 py-3">
          <div class="flex flex-wrap items-start gap-2">
            <label class="sr-only" for={`${formId}-kind`}>
              {t('rules.kind.label')}
            </label>
            <Select
              id={`${formId}-kind`}
              value={draft.kind}
              class="w-auto"
              onChange={(e) => {
                const kind = e.currentTarget.value as RuleKind;
                setDraft((d) => ({ kind, text: d.text, name: d.name }));
                setError(undefined);
              }}
            >
              {kinds.map((k) => (
                <option key={k} value={k} disabled={needsModel(k) && !modelOk}>
                  {kindLabel(k, polarity)}
                </option>
              ))}
            </Select>
            <DraftFields polarity={polarity} draft={draft} setDraft={setDraft} textRef={textRef} formId={formId} />
          </div>
          <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
            {hasName(draft.kind) && (
              <>
                <label class="sr-only" for={`${formId}-name`}>
                  {t('rules.name.label')}
                </label>
                <TextInput
                  id={`${formId}-name`}
                  class="w-[16rem] max-w-full"
                  value={draft.name ?? ''}
                  maxLength={RULE_NAME_MAX}
                  dir="auto"
                  placeholder={t('rules.name.placeholder')}
                  aria-describedby={`${formId}-name-hint`}
                  onInput={(e) => {
                    const v = e.currentTarget.value;
                    setDraft((d) => ({ ...d, name: v }));
                  }}
                />
                <span id={`${formId}-name-hint`} class="min-w-[12rem] flex-1 text-[13px] text-muted">
                  {t('rules.name.hint')}
                </span>
              </>
            )}
            <div class="ml-auto flex gap-2">
              <Button variant="primary" class="h-9!" disabled={!op || busy} onClick={() => void save()}>
                {t('common.save')}
              </Button>
              <Button class="h-9!" onClick={close}>{t('common.cancel')}</Button>
            </div>
          </div>
          {!modelOk && <p class="m-0 text-[13px] text-muted">{t('rules.disabled.needsModel')}</p>}
          {draft.kind === 'pattern' && <p class="m-0 text-[13px] text-muted">{t('rules.pattern.hint')}</p>}
          {draft.kind === 'artistChannel' && <p class="m-0 text-[13px] text-muted">{t('rules.artistChannel.hint')}</p>}
          {draft.kind === 'views' && <p class="m-0 text-[13px] text-muted">{t('rules.views.hint')}</p>}
          {error && (
            <p role="alert" class="m-0 text-[13px] text-danger">
              {error}
            </p>
          )}
        </div>
      )}
      <Status class="sr-only">{announce}</Status>
    </div>
  );
}

function DraftFields({
  polarity,
  draft,
  setDraft,
  textRef,
  formId,
}: {
  polarity: Polarity;
  draft: Draft;
  setDraft: (fn: (d: Draft) => Draft) => void;
  textRef: { current: HTMLInputElement | null };
  formId: string;
}) {
  if (draft.kind === 'duration') {
    return (
      <div class="flex flex-1 flex-wrap items-center gap-2">
        <label class="flex items-center gap-2 text-[13px] text-muted">
          {t('rules.duration.min')}
          <TextInput
            ref={textRef}
            inputMode="numeric"
            class="w-20"
            value={draft.minMinutes ?? ''}
            onInput={(e) => {
              const v = e.currentTarget.value;
              setDraft((d) => ({ ...d, minMinutes: v }));
            }}
          />
        </label>
        <label class="flex items-center gap-2 text-[13px] text-muted">
          {t('rules.duration.max')}
          <TextInput
            inputMode="numeric"
            class="w-20"
            value={draft.maxMinutes ?? ''}
            onInput={(e) => {
              const v = e.currentTarget.value;
              setDraft((d) => ({ ...d, maxMinutes: v }));
            }}
          />
        </label>
      </div>
    );
  }
  if (draft.kind === 'views') {
    return (
      <div class="flex flex-1 flex-wrap items-center gap-2">
        <label class="flex items-center gap-2 text-[13px] text-muted">
          {t('rules.views.min')}
          <TextInput
            ref={textRef}
            class="w-24"
            value={draft.minViews ?? ''}
            onInput={(e) => {
              const v = e.currentTarget.value;
              setDraft((d) => ({ ...d, minViews: v }));
            }}
          />
        </label>
        <label class="flex items-center gap-2 text-[13px] text-muted">
          {t('rules.views.max')}
          <TextInput
            class="w-24"
            value={draft.maxViews ?? ''}
            onInput={(e) => {
              const v = e.currentTarget.value;
              setDraft((d) => ({ ...d, maxViews: v }));
            }}
          />
        </label>
      </div>
    );
  }
  if (draft.kind === 'short' || draft.kind === 'live' || draft.kind === 'artistChannel') return <span class="flex-1" />;
  const placeholder = placeholderFor(draft.kind, polarity);
  const len = [...draft.text].length;
  const hints = takesHints(polarity, draft.kind) ? ruleHints(draft.text) : undefined;
  const hintId = `${formId}-hint`;
  return (
    <div class="min-w-[12rem] flex-1">
      <label class="sr-only" for={`${formId}-text`}>
        {draft.kind === 'channel' ? t('rules.placeholder.channel') : t('rules.table.text')}
      </label>
      <TextInput
        id={`${formId}-text`}
        ref={textRef}
        value={draft.text}
        maxLength={draft.kind === 'regex' ? 200 : 500}
        placeholder={placeholder}
        aria-describedby={hints?.length ? hintId : undefined}
        onInput={(e) => {
          const v = e.currentTarget.value;
          setDraft((d) => ({ ...d, text: v }));
        }}
      />
      {len >= COUNTER_FROM && (
        <span class={`num block text-[12px] ${len > SOFT_TEXT_LIMIT ? 'text-danger' : 'text-muted'}`}>
          {t('rules.text.counter', { count: String(len), max: String(SOFT_TEXT_LIMIT) })}
        </span>
      )}
      {hints && <HintLines id={hintId} hints={hints} class={hints.length ? 'mt-2' : ''} />}
    </div>
  );
}

function placeholderFor(kind: RuleKind, polarity: Polarity): string {
  switch (kind) {
    case 'channel':
      return t('rules.placeholder.channel');
    case 'topic':
      return polarity === 'keep' ? t('rules.placeholder.keep') : t('popup.addRule.placeholder');
    case 'keyword':
      return t('rules.placeholder.keyword');
    case 'thumbnail':
      return t('rules.placeholder.thumbnail');
    default:
      return '';
  }
}

/**
 * Soft hints under a Topic or Thumbnail rule's text (REQ-RULE-12). A polite live region that is always
 * there, so a hint is announced when it appears. Hints never block saving.
 */
export function HintLines({ id, hints, class: cls }: { id: string; hints: RuleHint[]; class?: string }) {
  return (
    <span id={id} role="status" class={`block text-[13px] leading-snug text-muted ${cls ?? ''}`}>
      {hints.map((h) => (
        <span key={h} class="block">
          {t(`rules.hint.${h}`)}
        </span>
      ))}
    </span>
  );
}
