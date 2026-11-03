// Toolbar popup, 360 px (docs/spec/ui-design.md Sections 5 and 8, REQ-POP-1): wordmark and on/off, Mode,
// today's numbers, what is waiting on the user, quick Add a rule, and the footer. Never asks for host
// access (Firefox closes the popup when a permission prompt opens): fixes open Settings instead.
import { ChevronRight } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { dayKey } from '~/core/escalation';
import { endpointBase, endpointHost } from '~/core/runtime';
import type { Mode, Rule } from '~/core/types';
import { t } from '~/i18n';
import { sendMessage } from '~/messaging/protocol';
import { readCounters, readRules, readSettings, watchCounters, watchRules, watchSettings } from '~/store/read';
import { Button, Notice, RuleRef, Segmented, SkeletonRows, Switch, Wordmark } from '~/ui/components';
import { hasConsent, keyState } from '~/ui/pages/consent';
import { Escalations } from '~/ui/pages/Escalations';
import { count, money } from '~/ui/pages/format';
import { useAsync, useRuntime } from '~/ui/pages/hooks';
import { OPENROUTER_CREDITS_URL, openExternal, openSettings } from '~/ui/pages/nav';
import { TextInput } from '~/ui/pages/parts';
import { findAdded, ruleHints } from '~/ui/pages/rules';
import { FIX_SECTION, popupNotice, type PopupFix } from './state';

const MODES: Mode[] = ['auto', 'review', 'dryRun'];
const YOUTUBE = 'https://www.youtube.com/';

export function App() {
  const runtime = useRuntime();
  const settings = useAsync(() => readSettings(), [watchSettings]);
  const rules = useAsync(() => readRules(), [watchRules]);
  const today = useAsync(() => readCounters(dayKey(Date.now())), [watchCounters]);
  const key = useAsync(() => sendMessage('getKeyUsage'), []);
  const onYouTube = useAsync(async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    return !!tab?.url?.startsWith(YOUTUBE);
  }, []);
  const [confirm, setConfirm] = useState<number>();
  const [error, setError] = useState(false);

  const r = runtime.data;
  const s = settings.data;
  const loading = !r;
  const notice = r ? popupNotice(r, s) : undefined;
  const controlsOff = loading || r.reason === 'off' || r.reason === 'migrating';

  const keyNow = r?.reason === 'noKey' ? (r.detail === 'keyRejected' ? 'rejected' : 'none') : keyState(key.data);
  // A direct Decision provider or a custom endpoint: no OpenRouter key involved.
  const custom = !!s && s.engine !== 'openrouter';
  const modelOk = hasConsent(s) && (custom || keyNow === 'connected' || keyNow === 'unknown');

  const send = async (fn: () => Promise<unknown>) => {
    setError(false);
    try {
      await fn();
    } catch {
      setError(true);
    }
    runtime.reload();
  };

  const setEnabled = (enabled: boolean) => void send(() => sendMessage('updateSettings', { patch: { enabled } }));
  const focusMode = () => queueMicrotask(() => (document.querySelector('[role="radio"][aria-checked="true"]') as HTMLElement | null)?.focus());
  const setMode = (mode: Mode, actOnShowingChips?: boolean) => {
    if (confirm !== undefined) focusMode();
    setConfirm(undefined);
    void send(() => sendMessage('setMode', { mode, ...(actOnShowingChips === undefined ? {} : { actOnShowingChips }) }));
  };
  const pickMode = (mode: Mode) => {
    if (!r || mode === r.mode) return;
    // Review -> Auto never removes videos whose chips are showing without asking once (REQ-MODE-5).
    if (mode === 'auto' && r.mode === 'review' && (r.reviewPending ?? 0) > 0) return setConfirm(r.reviewPending);
    setMode(mode);
  };

  const runFix = (f: PopupFix, category?: 'model' | 'nativeAction' | 'markup') => {
    if (f === 'turnOn') return setEnabled(true);
    if (f === 'retry') return void send(() => sendMessage('resumeFromBreaker', category ? { category } : {}));
    if (f === 'openOpenRouter') return openExternal(OPENROUTER_CREDITS_URL);
    openSettings(FIX_SECTION[f] || undefined);
  };

  const counters = today.data;
  const cap = s?.dailyCap ?? 0;
  const capShare = counters && cap > 0 ? counters.judged / cap : 0;

  return (
    <div class="w-[360px] bg-paper text-ink">
      <header class="flex items-center justify-between px-4 pt-3 pb-4">
        <Wordmark state={r?.eye ?? 'watching'} size={22} track status />
        <label class="-my-2.5 inline-flex min-h-11 cursor-pointer items-center gap-2 font-medium text-muted">
          <span aria-hidden="true">{r?.enabled === false ? t('popup.off') : t('popup.on')}</span>
          <Switch checked={r?.enabled ?? s?.enabled ?? true} disabled={loading} onChange={setEnabled} label={t('popup.switch')} />
        </label>
      </header>

      <div class="grid gap-4 px-4 pb-4">
        <div class="grid gap-2">
          <Segmented
            label={t('mode.label')}
            disabled={controlsOff}
            value={r?.mode ?? s?.mode ?? 'review'}
            onChange={pickMode}
            options={MODES.map((m) => ({ value: m, label: t(`mode.${m}`) }))}
          />
          {/* Two lines kept for every Mode, so switching Mode never moves what is below. */}
          <p class="m-0 min-h-[2lh] text-[13px] text-balance text-muted">{t(`mode.hint.${r?.mode ?? s?.mode ?? 'review'}`)}</p>
        </div>

        {confirm !== undefined && (
          <div
            role="alertdialog"
            aria-labelledby="confirm-auto"
            class="grid gap-2 rounded-[10px] bg-lit px-3 py-2.5"
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              setConfirm(undefined);
              focusMode();
            }}
          >
            <p id="confirm-auto" class="m-0 font-semibold">
              {t('popup.confirmAuto', confirm)}
            </p>
            <div class="flex gap-2">
              <ConfirmButton onClick={() => setMode('auto', true)}>{t('popup.confirmAutoYes')}</ConfirmButton>
              <Button onClick={() => setMode('auto', false)}>
                {t('popup.confirmAutoNo')}
              </Button>
            </div>
          </div>
        )}

        <section aria-labelledby="today-label" class="border-y border-line py-4">
          <h2 id="today-label" class="sr-only">
            {t('popup.today.label')}
          </h2>
          {loading || !counters ? (
            <SkeletonRows rows={1} label={t('popup.state.loading')} class="[&>div]:border-b-0" />
          ) : (
            <>
              {/* Equal thirds, under the three Mode segments. */}
              <dl class="m-0 grid grid-cols-3">
                <Figure value={count(counters.judged)} label={t('popup.today.judged')} />
                <Figure value={count(counters.removed)} label={t('popup.today.removed')} />
                <Figure value={money(counters.costUsd)} label={t('popup.today.spent')} />
              </dl>
              {capShare > 0.8 && (
                <div class="mt-3 grid gap-1">
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={cap}
                    aria-valuenow={Math.min(counters.judged, cap)}
                    aria-label={t('popup.today.cap', { used: count(counters.judged), cap: count(cap) })}
                    class="h-1 overflow-hidden rounded-full bg-line"
                  >
                    <div class="h-full rounded-full bg-ink" style={`width:${Math.min(100, capShare * 100)}%`} />
                  </div>
                  <span class="num text-[12px] text-muted">{t('popup.today.cap', { used: count(counters.judged), cap: count(cap) })}</span>
                </div>
              )}
            </>
          )}
        </section>

        {notice && (
          <Notice tone={notice.tone} live={notice.live} actions={notice.fixes.map((f) => ({ label: f.label, onClick: () => runFix(f.fix, f.category) }))}>
            {notice.text}
          </Notice>
        )}
        {!notice && onYouTube.data === false && <p class="m-0 text-[13px] text-muted">{t('popup.state.notOnYouTube')}</p>}
        {error && (
          <p role="alert" class="m-0 text-[13px] text-danger">
            {t('popup.error')}
          </p>
        )}

        <Escalations rules={rules.data} variant="popup" />

        <QuickAdd disabled={controlsOff || !modelOk} hint={!loading && !modelOk ? t('rules.disabled.needsModel') : undefined} />
      </div>

      <footer class="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-[13px]">
        <span class="min-w-0 truncate text-muted">
          {custom
            ? t('popup.footer.custom', { host: (s && endpointHost(endpointBase(s) ?? '')) ?? '' })
            : keyNow === 'connected'
              ? t('popup.footer.connected')
              : keyNow === 'unknown'
                ? ''
                : t('popup.footer.notConnected')}
        </span>
        <span class="flex shrink-0 items-center gap-4">
          <FooterLink onClick={() => openSettings('activity')}>{t('popup.footer.activity')}</FooterLink>
          <FooterLink onClick={() => openSettings()}>
            {t('popup.footer.settings')}
            <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
          </FooterLink>
        </span>
      </footer>
    </div>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div class="flex flex-col-reverse">
      <dt class="text-[12px] text-muted">{label}</dt>
      <dd class="num m-0 text-[20px] leading-[1.1] font-semibold tracking-[-0.02em]">{value}</dd>
    </div>
  );
}

function ConfirmButton({ onClick, children }: { onClick: () => void; children: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <button ref={ref} type="button" onClick={onClick} class="h-[30px] cursor-pointer rounded-[6px] border border-ink bg-ink px-3 font-semibold text-paper hover:opacity-90">
      {children}
    </button>
  );
}

function FooterLink({ onClick, children }: { onClick: () => void; children: preact.ComponentChildren }) {
  return (
    <button type="button" onClick={onClick} class="inline-flex min-h-6 cursor-pointer items-center gap-1 border-0 bg-transparent p-0 font-medium text-ink hover:underline hover:underline-offset-[3px]">
      {children}
    </button>
  );
}

/** Quick "Add a rule": a Topic rule, Enter to save, then "Rule added" with its colour and text. */
export function QuickAdd({ disabled, hint }: { disabled: boolean; hint?: string }) {
  const [text, setText] = useState('');
  const [added, setAdded] = useState<Rule>();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const hints = ruleHints(text);

  const add = async () => {
    const value = text.trim();
    if (!value || busy || disabled) return;
    setBusy(true);
    setFailed(false);
    const op = { op: 'add' as const, rule: { polarity: 'remove' as const, kind: 'topic' as const, text: value, enabled: true, origin: 'user' as const } };
    try {
      const res = await sendMessage('mutateRules', { ops: [op] });
      if ('error' in res) throw new Error(res.detail);
      setAdded(findAdded(res.rules, op));
      setText('');
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <label for="quick-add" class="sr-only">
        {t('popup.addRule.label')}
      </label>
      <div class="flex gap-2">
        <TextInput
          id="quick-add"
          value={text}
          disabled={disabled}
          maxLength={500}
          placeholder={t('popup.addRule.placeholder')}
          aria-describedby="quick-add-hint"
          onInput={(e) => {
            setText(e.currentTarget.value);
            setAdded(undefined);
          }}
          class="flex-1"
        />
        <Button type="submit" variant="primary" class="h-9!" disabled={disabled || busy || !text.trim()}>
          {t('popup.addRule.submit')}
        </Button>
      </div>
      {/* The help line, or a soft hint while the text reads as an order or a negation (REQ-RULE-12). */}
      <p id="quick-add-hint" role="status" class="mt-2 mb-0 text-[13px] text-muted">
        {hint ??
          (hints.length
            ? hints.map((h) => (
                <span key={h} class="block">
                  {t(`rules.hint.${h}`)}
                </span>
              ))
            : t('popup.addRule.hint'))}
      </p>
      {/* No margin while empty, so the form ends at the help line. */}
      <div role="status" class="text-[13px] not-empty:mt-2">
        {added && (
          <span class="flex items-center gap-2">
            <span class="shrink-0 text-muted">{t('popup.addRule.added')}</span>{' '}
            <RuleRef rule={added} />
          </span>
        )}
        {failed && <span class="text-danger">{t('rules.error.save')}</span>}
      </div>
    </form>
  );
}
