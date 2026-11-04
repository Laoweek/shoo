// Onboarding (docs/spec/ui-design.md Section 7, REQ-ONB-1): four steps on one page with a progress line.
// The step is saved in settings.onboarding, so closing the page resumes at the same step.
import { Ban, Check, ListChecks, Undo2 } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Mode, Rule, RuleKind } from '~/core/types';
import { t } from '~/i18n';
import { sendMessage } from '~/messaging/protocol';
import { readRules, readSettings, watchRules } from '~/store/read';
import { Button, RuleRef, SkeletonRows, Wordmark } from '~/ui/components';
import { consentClick, hasConsent, keyState } from '~/ui/pages/consent';
import { Disclosure } from '~/ui/pages/Disclosure';
import { DirectSetup, ProviderPicker } from '~/ui/pages/EndpointSetup';
import { useAsync, useOnline } from '~/ui/pages/hooks';
import { Status, TextInput } from '~/ui/pages/parts';
import type { ProviderId } from '~/ui/pages/providers';
import { findAdded, ruleHints } from '~/ui/pages/rules';
import { StarterChips } from '~/ui/pages/StarterChips';

export const STEPS = ['what', 'connect', 'rules', 'mode'] as const;
const LAST = STEPS.length - 1;
const YOUTUBE = 'https://www.youtube.com/';
const BILIBILI = 'https://www.bilibili.com/';

async function saveStep(step: number, done = false): Promise<void> {
  await sendMessage('updateSettings', { patch: { onboarding: { step, done } } });
}

/** Closes the onboarding tab. window.close() is refused for tabs the page did not open itself. */
async function closePage(): Promise<void> {
  try {
    const tab = await browser.tabs.getCurrent();
    if (tab?.id !== undefined) return void (await browser.tabs.remove(tab.id));
  } catch {
    // fall back below
  }
  window.close();
}

export function App({ isFirefox }: { isFirefox?: boolean } = {}) {
  const settings = useAsync(() => readSettings(), []);
  const [step, setStep] = useState<number>();
  const [resumed, setResumed] = useState(false);
  const [consent, setConsent] = useState(false);
  const [glance, setGlance] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  useEffect(() => {
    const s = settings.data;
    if (!s || step !== undefined) return;
    const saved = Math.min(Math.max(0, s.onboarding?.step ?? 0), LAST);
    setStep(saved);
    setResumed(saved > 0);
    setConsent(hasConsent(s));
  }, [settings.data]);

  useEffect(() => {
    if (moved.current) heading.current?.focus();
  }, [step]);

  const goTo = (n: number) => {
    moved.current = true;
    setResumed(false);
    setStep(n);
    void saveStep(n).catch(() => {});
  };

  return (
    <div class="mx-auto min-h-screen max-w-[880px] px-5 pt-5 pb-16">
      <header class="mb-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <Wordmark state="watching" track size={30} glanceKey={glance} glance={{ x: 0, y: 3 }} />
        <h1 class="sr-only">{t('onboarding.title')}</h1>
        {resumed && <p class="m-0 text-[13px] text-muted">{t('onboarding.resumed')}</p>}
      </header>
      {step === undefined ? (
        <SkeletonRows rows={4} />
      ) : (
        <>
          <Progress step={step} />
          <div class="card p-6 sm:px-8">
            {step === 0 && (
              <WhatStep
                headingRef={heading}
                isFirefox={isFirefox}
                onAgree={() => {
                  setConsent(true);
                  goTo(1);
                }}
                onExactOnly={() => {
                  setConsent(false);
                  goTo(2);
                }}
              />
            )}
            {step === 1 && <ConnectStep headingRef={heading} onNext={() => goTo(2)} />}
            {step === 2 && <RulesStep headingRef={heading} consent={consent} onGlance={() => setGlance((g) => g + 1)} onNext={() => goTo(3)} />}
            {step === 3 && <ModeStep headingRef={heading} initial={settings.data?.onboarding?.done ? settings.data.mode : 'review'} />}
          </div>
        </>
      )}
    </div>
  );
}

function Progress({ step }: { step: number }) {
  return (
    <ol aria-label={t('onboarding.progress', { step: String(step + 1), total: String(STEPS.length) })} class="m-0 mb-4 grid list-none grid-cols-4 gap-2 p-0">
      {STEPS.map((id, i) => {
        const done = i < step;
        return (
          <li key={id} aria-current={i === step ? 'step' : undefined} class="grid gap-1.5">
            <span aria-hidden="true" class={`h-1.5 rounded-full ${i <= step ? 'bg-ink' : 'bg-line-strong'}`} />
            <span class={`inline-flex items-center gap-1 text-[12px] ${i === step ? 'font-semibold text-ink' : 'text-muted'}`}>
              {done && <Check size={16} strokeWidth={2} aria-hidden="true" />}
              {t(`onboarding.${id}.title`)}
              {done && <span class="sr-only">{t('onboarding.stepDone')}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

type HeadingRef = { current: HTMLHeadingElement | null };

function StepHead({ headingRef, title }: { headingRef: HeadingRef; title: string }) {
  return (
    <h2 ref={headingRef} tabIndex={-1} class="mt-0 mb-3 text-[36px] leading-[1.1] font-semibold tracking-[-0.025em] text-balance focus:outline-none">
      {title}
    </h2>
  );
}

// Step 1, the welcome screen: what Shoo does and what it sends. On Firefox, Agree requests the optional
// data collection permission as the first statement of the click (cross-browser-and-stores.md Section 1).
export function WhatStep({ headingRef, isFirefox, onAgree, onExactOnly }: { headingRef: HeadingRef; isFirefox?: boolean; onAgree: () => void; onExactOnly: () => void }) {
  const [failed, setFailed] = useState(false);
  const agree = consentClick({
    ...(isFirefox === undefined ? {} : { isFirefox }),
    onDone: (granted) => (granted ? onAgree() : onExactOnly()),
    onError: () => setFailed(true),
  });
  return (
    <section>
      <StepHead headingRef={headingRef} title={t('onboarding.what.heading')} />
      <ul class="m-0 mb-5 grid list-none gap-1.5 p-0 text-[15px] leading-[1.5]">
        {(
          [
            [ListChecks, 'check'],
            [Ban, 'act'],
            [Undo2, 'undo'],
          ] as const
        ).map(([Icon, key]) => (
          <li key={key} class="flex items-start gap-2.5">
            <Icon size={16} strokeWidth={2} aria-hidden="true" class="mt-[3px] shrink-0" />
            {t(`onboarding.what.does.${key}`)}
          </li>
        ))}
      </ul>
      <h3 class="m-0 mb-2 text-[15px] font-semibold">{t('onboarding.what.sendsTitle')}</h3>
      <Disclosure class="mb-5 border-t border-line-strong" />
      <div class="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div class="flex flex-wrap gap-2">
          <Button variant="primary" size="lg" onClick={agree}>
            {t('onboarding.what.agree')}
          </Button>
          <Button size="lg" onClick={onExactOnly}>
            {t('onboarding.what.exactOnly')}
          </Button>
        </div>
        <p class="m-0 text-[13px] text-muted">{t('onboarding.what.later')}</p>
      </div>
      <Status tone="danger" class="mt-3">
        {failed ? t('onboarding.error') : ''}
      </Status>
    </section>
  );
}

// Step 2: choose where Shoo checks videos, Decision models only. OpenRouter (Connect, or paste a key) is
// preselected. A Decision provider reached directly runs the same setup as Settings, Connection
// (DirectSetup), which asks for host access and for consent naming that host. The chat model is offered
// in Settings only. Skipped for Exact rules only.
export function ConnectStep({ headingRef, onNext }: { headingRef: HeadingRef; onNext: () => void }) {
  const online = useOnline();
  const [provider, setProvider] = useState<ProviderId>('openrouter');
  const key = useAsync(() => sendMessage('getKeyUsage'), []);
  const [busy, setBusy] = useState(false);
  const [paste, setPaste] = useState(false);
  const [keyText, setKeyText] = useState('');
  const [message, setMessage] = useState<string>();
  const [keyError, setKeyError] = useState<string>();
  const [headless, setHeadless] = useState(false);
  const [code, setCode] = useState('');
  const connected = keyState(key.data) === 'connected';

  const connect = async () => {
    setBusy(true);
    setMessage(undefined);
    try {
      const res = await sendMessage('connectOpenRouter');
      if (res.ok) return onNext();
      // No browser sign-in window: OpenRouter shows a code to paste here (decision-engine.md §7.2 step 7).
      if (res.error === 'unsupported') return setHeadless(true);
      setMessage(res.error === 'cancelled' ? t('onboarding.connect.cancelled') : t('onboarding.connect.failed'));
    } catch {
      setMessage(t('onboarding.connect.failed'));
    } finally {
      setBusy(false);
    }
  };

  const saveKey = async () => {
    if (!keyText.trim()) return;
    setBusy(true);
    setKeyError(undefined);
    try {
      const res = await sendMessage('setKey', { key: keyText.trim() });
      if (res.ok) return onNext();
      if (res.error === 'offline') setMessage(t('onboarding.connect.offline'));
      else setKeyError(t('onboarding.connect.invalidKey'));
    } catch {
      setKeyError(t('onboarding.connect.invalidKey'));
    } finally {
      setBusy(false);
    }
  };

  const exchange = async () => {
    if (!code.trim()) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const res = await sendMessage('exchangeHeadlessCode', { code: code.trim() });
      if (res.ok) return onNext();
      setMessage(res.error === 'expired' ? t('connection.headless.expired') : t('onboarding.connect.failed'));
    } catch {
      setMessage(t('onboarding.connect.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <StepHead headingRef={headingRef} title={t('onboarding.connect.heading')} />
      <p class="mt-0 mb-6 max-w-[60ch] text-[15px] leading-[1.55]">{t('onboarding.connect.body')}</p>
      <div class="mb-6">
        <ProviderPicker value={provider} onChange={setProvider} />
      </div>
      {provider !== 'openrouter' ? (
        <DirectSetup key={provider} provider={provider} consentLabel={t('onboarding.what.agree')} large onSaved={onNext} />
      ) : connected ? (
        <div class="flex flex-wrap items-center gap-3">
          <span class="font-semibold">{t('popup.footer.connected')}</span>
          <Button variant="primary" size="lg" onClick={onNext}>
            {t('onboarding.next')}
          </Button>
        </div>
      ) : (
        <>
          <p class="mt-0 mb-3 max-w-[60ch] text-[13px] text-muted">
            {t('onboarding.connect.openRouter')} {t('onboarding.connect.cost')}
          </p>
          {!online && <p class="mt-0 mb-4 text-danger">{t('onboarding.connect.offline')}</p>}
          <div class="flex flex-wrap gap-2">
            <Button variant="primary" size="lg" disabled={!online || busy} onClick={() => void connect()}>
              {busy && !paste ? t('connection.connecting') : t('onboarding.connect.button')}
            </Button>
            <Button size="lg" disabled={!online} aria-expanded={paste} onClick={() => setPaste((p) => !p)}>
              {t('onboarding.connect.paste')}
            </Button>
          </div>
          {headless && (
            <form
              class="mt-4 flex max-w-xl flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void exchange();
              }}
            >
              <div class="min-w-[16rem] flex-1">
                <label for="onb-code" class="mb-1 block text-[12px] font-semibold text-muted">
                  {t('connection.headless.label')}
                </label>
                <TextInput id="onb-code" autoComplete="off" spellcheck={false} value={code} onInput={(e) => setCode(e.currentTarget.value)} />
              </div>
              <Button type="submit" variant="primary" class="h-9!" disabled={busy || !code.trim()}>
                {t('common.save')}
              </Button>
            </form>
          )}
          {paste && (
            <form
              class="mt-4 flex max-w-xl flex-wrap items-start gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void saveKey();
              }}
            >
              <div class="min-w-[16rem] flex-1">
                <label for="onb-key" class="mb-1 block text-[12px] font-semibold text-muted">
                  {t('connection.key.label')}
                </label>
                <TextInput
                  id="onb-key"
                  type="password"
                  autoComplete="off"
                  spellcheck={false}
                  value={keyText}
                  aria-invalid={keyError ? true : undefined}
                  aria-describedby={keyError ? 'onb-key-error' : undefined}
                  onInput={(e) => setKeyText(e.currentTarget.value)}
                />
                {keyError && (
                  <p id="onb-key-error" role="alert" class="mt-1 mb-0 text-[13px] text-danger">
                    {keyError}
                  </p>
                )}
              </div>
              <Button type="submit" variant="primary" class="mt-[22px] h-9!" disabled={!online || busy || !keyText.trim()}>
                {t('connection.key.save')}
              </Button>
            </form>
          )}
        </>
      )}
      <Status tone="danger" class="mt-3">
        {provider === 'openrouter' ? (message ?? '') : ''}
      </Status>
      {!connected && (
        <Button variant="text" class="mt-4" onClick={onNext}>
          {t('onboarding.connect.skip')}
        </Button>
      )}
    </section>
  );
}

// Step 3: Starter rules and a free field. Without consent the Topic starters are disabled ("Needs
// consent") and the free field adds a Title keyword rule instead of a Topic rule.
export function RulesStep({ headingRef, consent, onGlance, onNext }: { headingRef: HeadingRef; consent: boolean; onGlance: () => void; onNext: () => void }) {
  const rules = useAsync(() => readRules(), [watchRules]);
  const [text, setText] = useState('');
  const [mine, setMine] = useState<Rule[]>([]);
  const [failed, setFailed] = useState(false);
  const kind: RuleKind = consent ? 'topic' : 'keyword';
  const hints = consent ? ruleHints(text) : [];

  const add = async () => {
    const value = text.trim();
    if (!value) return;
    setFailed(false);
    const op = { op: 'add' as const, rule: { polarity: 'remove' as const, kind, text: value, enabled: true, origin: 'user' as const } };
    try {
      const res = await sendMessage('mutateRules', { ops: [op] });
      if ('error' in res) throw new Error(res.detail);
      const rule = findAdded(res.rules, op);
      if (rule) setMine((m) => [...m, rule]);
      setText('');
      onGlance();
    } catch {
      setFailed(true);
    }
  };

  return (
    <section>
      <StepHead headingRef={headingRef} title={t('onboarding.rules.title')} />
      <p class="mt-0 mb-5 max-w-[60ch] text-[15px] leading-[1.55]">{t('onboarding.rules.body')}</p>
      {rules.data ? (
        <StarterChips rules={rules.data} modelOk={consent} disabledNote={t('onboarding.rules.needsConsent')} onAdded={() => onGlance()} />
      ) : (
        <SkeletonRows rows={1} />
      )}
      <form
        class="mt-6 grid max-w-xl gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <label for="onb-rule" class="text-[12px] font-semibold text-muted">
          {consent ? t('onboarding.rules.field') : t('onboarding.rules.fieldKeyword')}
        </label>
        <div class="flex gap-2">
          <TextInput
            id="onb-rule"
            maxLength={500}
            value={text}
            placeholder={consent ? t('popup.addRule.placeholder') : t('rules.placeholder.keyword')}
            aria-describedby={consent ? 'onb-rule-tip' : undefined}
            onInput={(e) => setText(e.currentTarget.value)}
          />
          <Button type="submit" variant="primary" class="h-9!" disabled={!text.trim()}>
            {t('common.add')}
          </Button>
        </div>
        {/* The tip, or a soft hint while the text reads as an order or a negation (REQ-RULE-12). */}
        {consent && (
          <p id="onb-rule-tip" role="status" class="m-0 text-[13px] text-muted">
            {hints.length
              ? hints.map((h) => (
                  <span key={h} class="block">
                    {t(`rules.hint.${h}`)}
                  </span>
                ))
              : t('onboarding.rules.tip')}
          </p>
        )}
      </form>
      {mine.length > 0 && (
        <ul class="mt-3 mb-0 grid list-none gap-1 p-0">
          {mine.map((r) => (
            <li key={r.id} class="flex min-w-0">
              <RuleRef rule={r} />
            </li>
          ))}
        </ul>
      )}
      <Status tone="danger" class="mt-2">
        {failed ? t('rules.error.save') : ''}
      </Status>
      <div class="mt-8">
        <Button variant="primary" size="lg" onClick={onNext}>
          {t('onboarding.next')}
        </Button>
      </div>
    </section>
  );
}

// Step 4: Mode, Review preselected. Start closes onboarding. YouTube opens only if the user asks.
export function ModeStep({ headingRef, initial }: { headingRef: HeadingRef; initial: Mode }) {
  const [mode, setMode] = useState<Mode>(initial);
  const [failed, setFailed] = useState(false);
  const finish = async (then: () => Promise<void> | void) => {
    setFailed(false);
    try {
      await sendMessage('setMode', { mode });
      await saveStep(LAST, true);
      await then();
    } catch {
      setFailed(true);
    }
  };
  return (
    <section>
      <StepHead headingRef={headingRef} title={t('onboarding.mode.title')} />
      <p class="mt-0 mb-5 max-w-[60ch] text-[15px] leading-[1.55]">{t('onboarding.mode.body')}</p>
      <fieldset class="m-0 mb-8 border-0 p-0">
        <legend class="sr-only">{t('mode.label')}</legend>
        <div class="border-t border-line-strong">
          {(['review', 'auto', 'dryRun'] as Mode[]).map((m) => (
            <label key={m} class={`flex min-h-11 cursor-pointer items-start gap-3 border-b border-line px-3 py-3 ${mode === m ? 'bg-tint' : 'hover:bg-tint'}`}>
              <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} class="mt-1 size-4 shrink-0 cursor-pointer" />
              <span>
                <span class="font-semibold">{t(`mode.${m}`)}</span>
                <span class="block text-[13px] text-muted">{t(`mode.hint.${m}`)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div class="flex flex-wrap items-center gap-5">
        <Button variant="primary" size="lg" onClick={() => void finish(closePage)}>
          {t('onboarding.mode.start')}
        </Button>
        <Button
          variant="text"
          onClick={() =>
            void finish(() => {
              location.href = YOUTUBE;
            })
          }
        >
          {t('onboarding.mode.openYouTube')}
        </Button>
        <Button
          variant="text"
          onClick={() =>
            void finish(() => {
              location.href = BILIBILI;
            })
          }
        >
          {t('onboarding.mode.openBilibili')}
        </Button>
      </div>
      <Status tone="danger" class="mt-3">
        {failed ? t('onboarding.error') : ''}
      </Status>
    </section>
  );
}
