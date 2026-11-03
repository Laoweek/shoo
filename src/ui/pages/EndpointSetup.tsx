// Where Shoo checks videos (docs/spec/ui-design.md Sections 6 and 7, decision-engine.md Sections 6 and
// 12): the Decision provider choice shared by onboarding step 2 and Settings, Connection, the setup of a
// Decision provider reached directly, and the chat model form, which only Settings offers.
// Save: host access for the endpoint is the first statement of the click (Firefox rejects the prompt
// after any await, cross-browser-and-stores.md Section 2), a model on this computer is then checked with
// one synthetic title, and consent naming the host comes before anything is saved.
import { ChevronRight, Cloud, Copy, ExternalLink, Gauge, Image, ImageOff, Laptop, TriangleAlert } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { CALIBRATED_MODEL, cloudflareAccount, directProvider, readsImages, topicRuleLimit, type DirectProvider, type DirectProviderId } from '~/core/providers';
import { endpointPattern } from '~/core/runtime';
import type { Settings } from '~/core/types';
import { t } from '~/i18n';
import { sendMessage } from '~/messaging/protocol';
import { Button } from '~/ui/components';
import { consentClick, endpointOrigin, IS_FIREFOX, requestOrigins } from '~/ui/pages/consent';
import { Disclosure } from '~/ui/pages/Disclosure';
import { FieldLabel, Status, TextInput } from '~/ui/pages/parts';
import {
  CHAT_LOCAL,
  desktopOs,
  isLocalUrl,
  isOllamaUrl,
  LLAMACPP_COMMAND,
  LOCAL,
  OLLAMA_FAQ_URL,
  ollamaOriginsCommand,
  ONLINE,
  type ProviderId,
} from '~/ui/pages/providers';

/** The provider's display name, a brand name. */
const providerName = (id: ProviderId): string => (id === 'openrouter' ? 'OpenRouter' : directProvider(id)!.name);

const LINK = 'inline-flex items-center gap-1 text-[13px] text-muted underline underline-offset-[3px] hover:text-ink';

// ---------------------------------------------------------------------------------------------------

/**
 * Where Shoo sends videos: online providers on the left, Decision models on this computer on the right.
 * One radio group (one `name`), so arrow keys move through every choice.
 */
export function ProviderPicker({ value, onChange, inUse }: { value: ProviderId | undefined; onChange: (id: ProviderId) => void; inUse?: ProviderId | undefined }) {
  const group = (id: string, Icon: typeof Cloud, title: string, ids: readonly ProviderId[]) => (
    <div role="group" aria-labelledby={id} class="min-w-0">
      <p id={id} class="m-0 mb-2 flex items-center gap-2 text-[12px] font-semibold text-muted">
        <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
        {title}
      </p>
      <div class="border-t border-line-strong">
        {ids.map((p) => (
          <label key={p} class={`flex min-h-11 cursor-pointer items-start gap-3 border-b border-line px-2 py-3 ${value === p ? 'bg-tint' : 'hover:bg-tint'}`}>
            <input type="radio" name="provider" value={p} checked={value === p} onChange={() => onChange(p)} class="mt-1 size-4 shrink-0 cursor-pointer" />
            <span class="min-w-0">
              <span class="font-semibold">{providerName(p)}</span>
              {p === 'openrouter' && <span class="ml-2 text-[12px] text-muted">{t('connection.provider.recommended')}</span>}
              {p === inUse && <span class="ml-2 text-[12px] text-muted">{t('connection.provider.inUse')}</span>}
              <span class="block text-[13px] text-muted">{t(`connection.provider.${p}.hint`)}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
  return (
    <fieldset class="m-0 min-w-0 border-0 p-0">
      <legend class="sr-only">{t('connection.provider.legend')}</legend>
      <div class="grid gap-6 sm:grid-cols-2">
        {group('provider-online', Cloud, t('connection.provider.online'), ONLINE)}
        {group('provider-local', Laptop, t('connection.provider.local'), LOCAL)}
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------------------------------

/** A command to copy, set in the monospace face because it is code. `what` names it for screen readers. */
function Command({ text, what }: { text: string; what: string }) {
  const [copied, setCopied] = useState<boolean>();
  // The result clears after a moment, so copying again is announced again.
  useEffect(() => {
    if (copied === undefined) return;
    const timer = setTimeout(() => setCopied(undefined), 4000);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = () =>
    void navigator.clipboard.writeText(text).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  return (
    <>
      <div class="mt-2 flex items-start gap-2 rounded-[10px] bg-lit py-2 pr-2 pl-3">
        <code class="min-w-0 flex-1 py-0.5 font-mono text-[13px] leading-[1.45] wrap-anywhere">{text}</code>
        <Button size="sm" onClick={copy}>
          <Copy size={14} strokeWidth={1.75} aria-hidden="true" />
          {t('connection.provider.copy')}
          <span class="sr-only"> {what}</span>
        </Button>
      </div>
      <Status tone={copied === false ? 'danger' : 'plain'} class="not-empty:mt-2">
        {copied === true ? t('connection.provider.copied') : copied === false ? t('connection.provider.copyFailed') : ''}
      </Status>
    </>
  );
}

const Steps = ({ children }: { children: ComponentChildren }) => <ol class="m-0 grid list-decimal gap-2 pl-5 marker:text-muted">{children}</ol>;

const Ext = ({ href, children }: { href: string; children: ComponentChildren }) => (
  <a href={href} target="_blank" rel="noreferrer" class={LINK}>
    {children}
    <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
  </a>
);

/** Ollama answers 403 to an extension until OLLAMA_ORIGINS lists it: the line for this OS and install. */
function OllamaOrigins() {
  const os = desktopOs();
  return (
    <li>
      {t(os === 'linux' ? 'connection.provider.ollama.originsLinux' : 'connection.provider.ollama.origins')}
      <Command text={ollamaOriginsCommand(location.origin, os)} what={t('connection.provider.ollama.originsWhat')} />
      <Ext href={OLLAMA_FAQ_URL}>{t('connection.provider.ollama.faq')}</Ext>
    </li>
  );
}

/** How to start each runtime on this computer, with the commands to copy. */
function LocalSteps({ provider, model }: { provider: DirectProviderId; model: string }) {
  if (provider === 'ollama') {
    return (
      <Steps>
        <li>
          {t('connection.provider.ollama.pull')}
          <Command text={`ollama pull ${model.trim() || 'clef-flash'}`} what={t('connection.provider.ollama.pullWhat')} />
        </li>
        <OllamaOrigins />
      </Steps>
    );
  }
  if (provider === 'llamacpp') {
    return (
      <Steps>
        <li>
          {t('connection.provider.llamacpp.start')}
          <Command text={LLAMACPP_COMMAND} what={t('connection.provider.llamacpp.startWhat')} />
        </li>
      </Steps>
    );
  }
  return (
    <Steps>
      <li>{t('connection.provider.lmstudio.load')}</li>
      <li>{t('connection.provider.lmstudio.serve')}</li>
    </Steps>
  );
}

// ---------------------------------------------------------------------------------------------------
// The save flow shared by a direct Decision provider and the chat model.

type Step<R> = { kind: 'form' } | { kind: 'checking' } | { kind: 'consent'; host: string; req: R } | { kind: 'saving' } | { kind: 'saved' };
type Message = { text: string; tone: 'plain' | 'danger' };
type Result = { ok: true } | { ok: false; error: string };

/** What a failed check of a model on this computer means, in the user's terms. */
function checkError(error: string, name: string, host: string, model: string, ollama: boolean): string {
  if (error === 'network') return t('connection.provider.error.unreachable', { host, provider: name });
  if (error === 'keyRejected') return ollama ? t('connection.provider.error.ollamaOrigins') : t('connection.provider.error.refused', { host });
  if (error === 'http404') return t('connection.provider.error.noModel', { host, model });
  return t('connection.provider.error.format', { host, detail: error });
}

interface FlowOptions<R> {
  origin: string | undefined;
  local: boolean;
  /** The request as typed, read when the button is clicked. */
  request: () => R;
  test: (r: R) => Promise<{ ok: true; latencyMs: number } | { ok: false; error: string }>;
  save: (r: R) => Promise<Result>;
  /** Copy for a failed local check. */
  checkFailed: (error: string, host: string, r: R) => string;
  onSaved: (host: string) => void;
  clearKey: () => void;
}

/**
 * Host access, a local check, consent naming the host, then save. The key is only ever in the form's
 * state and the message to the background (store/secret.ts is background-only).
 */
function useSaveFlow<R>(o: FlowOptions<R>) {
  const [step, setStep] = useState<Step<R>>({ kind: 'form' });
  const [message, setMessage] = useState<Message>();
  const callout = useRef<HTMLDivElement>(null);
  const use = useRef<HTMLButtonElement>(null);
  const moved = useRef(false);
  const host = o.origin ? new URL(o.origin).host : '';

  // Focus follows the swap between the Use button and the consent callout, so it never falls to the body.
  useEffect(() => {
    if (!moved.current) return;
    if (step.kind === 'consent') callout.current?.focus();
    if (step.kind === 'form') use.current?.focus();
  }, [step.kind]);
  const go = (next: Step<R>) => {
    moved.current = true;
    setStep(next);
  };

  // A model on this computer is checked with one synthetic title (no user data, nothing billed), so a
  // missing OLLAMA_ORIGINS or model shows here instead of as failures on YouTube. Online providers are
  // not called before consent: a call there spends the user's credit. The fields are locked meanwhile,
  // and consent and save use the values that were checked.
  const check = async (r: R, h: string) => {
    setStep({ kind: 'checking' });
    try {
      const res = await o.test(r);
      if (res.ok) return go({ kind: 'consent', host: h, req: r });
      setMessage({ text: o.checkFailed(res.error, h, r), tone: 'danger' });
    } catch {
      setMessage({ text: o.checkFailed('network', h, r), tone: 'danger' });
    }
    go({ kind: 'form' });
  };

  const start = () => {
    const request = requestOrigins([endpointPattern(o.origin!, IS_FIREFOX)!]);
    const r = o.request();
    const h = host;
    const denied = () => setMessage({ text: t('connection.custom.permissionDenied', { host: h }), tone: 'danger' });
    void request.then((granted) => {
      if (!granted) return denied();
      setMessage(undefined);
      if (o.local) return void check(r, h);
      go({ kind: 'consent', host: h, req: r });
    }, denied);
  };

  const finish = async (r: R, h: string) => {
    setStep({ kind: 'saving' });
    try {
      const res = await o.save(r);
      if (!res.ok) {
        setStep({ kind: 'form' });
        return setMessage({ text: t('connection.custom.error', { detail: res.error }), tone: 'danger' });
      }
      o.clearKey();
      setStep({ kind: 'saved' });
      setMessage({ text: t('connection.custom.saved', { host: h }), tone: 'plain' });
      o.onSaved(h);
    } catch {
      setStep({ kind: 'form' });
      setMessage({ text: t('connection.error.save'), tone: 'danger' });
    }
  };

  const agree =
    step.kind === 'consent'
      ? consentClick({
          customHost: step.host,
          onDone: (granted) => {
            if (granted) void finish(step.req, step.host);
            else setMessage({ text: t('connection.consent.declined'), tone: 'plain' });
          },
          onError: () => setMessage({ text: t('connection.error.save'), tone: 'danger' }),
        })
      : undefined;

  /** An edit returns the form to its first step. */
  const edit = (set: (v: string) => void) => (e: { currentTarget: HTMLInputElement }) => {
    set(e.currentTarget.value);
    if (step.kind !== 'form') setStep({ kind: 'form' });
  };

  return { step, message, host, start, agree, edit, go, callout, use, busy: step.kind === 'checking' || step.kind === 'saving' };
}

/** The Use button, or the consent callout that replaces it, and the status line. */
function SaveArea({
  flow,
  label,
  checking,
  missing,
  unchanged,
  local,
  disclosure,
  consentLabel,
  large,
}: {
  flow: ReturnType<typeof useSaveFlow<unknown>>;
  label: string;
  checking: string;
  missing: string | undefined;
  /** The saved values, unedited: nothing to save. */
  unchanged?: boolean | undefined;
  local: boolean;
  disclosure?: boolean | undefined;
  consentLabel: string;
  large?: boolean | undefined;
}) {
  const { step } = flow;
  const host = step.kind === 'consent' ? step.host : flow.host;
  // Settings shows a direct provider's form and the chat model form at once, so the id is per instance.
  const missingId = useId();
  return (
    <>
      {step.kind === 'consent' || step.kind === 'saving' ? (
        <div ref={flow.callout} tabIndex={-1} class="grid gap-2 rounded-[10px] bg-lit px-4 py-3 focus:outline-none focus-visible:outline-2">
          <p class="m-0 font-semibold">{t('connection.custom.consent', { host })}</p>
          {local && <p class="m-0 text-[13px]">{t('connection.provider.consentLocal', { host })}</p>}
          {disclosure && <Disclosure compact level={3} />}
          <div class="flex flex-wrap gap-2">
            <Button variant="primary" disabled={step.kind === 'saving'} onClick={flow.agree}>
              {consentLabel}
            </Button>
            <Button disabled={step.kind === 'saving'} onClick={() => flow.go({ kind: 'form' })}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button
            ref={flow.use}
            variant="primary"
            size={large ? 'lg' : 'md'}
            disabled={!!missing || !!unchanged || flow.busy}
            aria-describedby={missing ? missingId : undefined}
            onClick={flow.start}
          >
            {step.kind === 'checking' ? checking : label}
          </Button>
          {missing && (
            <span id={missingId} class="text-[13px] text-muted">
              {missing}
            </span>
          )}
        </div>
      )}
      <Status tone={flow.message?.tone} class="empty:absolute">{flow.message?.text ?? ''}</Status>
    </>
  );
}

/** A muted fact about the choice, with its icon. */
const Fact = ({ icon: Icon, children }: { icon: typeof Cloud; children: ComponentChildren }) => (
  <p class="m-0 flex items-start gap-2">
    <Icon size={14} strokeWidth={1.75} aria-hidden="true" class="mt-[3px] shrink-0" />
    <span>{children}</span>
  </p>
);

function KeyField({ id, label, value, disabled, keep, onInput }: { id: string; label: string; value: string; disabled: boolean; keep: boolean; onInput: (e: { currentTarget: HTMLInputElement }) => void }) {
  return (
    <div>
      <FieldLabel for={id}>{label}</FieldLabel>
      <TextInput id={id} type="password" autoComplete="off" spellcheck={false} value={value} disabled={disabled} aria-describedby={keep ? `${id}-hint` : undefined} onInput={onInput} />
      {keep && (
        <p id={`${id}-hint`} class="mt-2 mb-0 text-[13px] text-muted">
          {t('connection.provider.keyKeep')}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------

type DirectRequest = { provider: DirectProviderId; baseUrl: string; model: string; key?: string };

const ACCOUNT_ID = /^[0-9a-f]{32}$/i;

export interface DirectSetupProps {
  provider: DirectProviderId;
  /** The saved direct endpoint when it belongs to this provider: its fields start from it. */
  initial?: { baseUrl: string; model: string } | undefined;
  /** That endpoint is the one in use: the button saves changes and waits for one. */
  active?: boolean;
  /** Enabled remove Topic rules, to warn when this provider takes fewer (Settings). Onboarding has none yet. */
  topicRules?: number;
  /** Settings repeats What Shoo sends in the consent. Onboarding showed it one step earlier. */
  disclosure?: boolean;
  consentLabel: string;
  /** Onboarding's 44 px primary button. */
  large?: boolean;
  onSaved: (host: string) => void;
}

/**
 * A Decision provider reached directly (decision-engine.md Section 12): what it reads and how well Filtering
 * strength fits it, how to start it on this computer, the key or account it needs, then the save flow.
 */
export function DirectSetup({ provider, initial, active, topicRules = 0, disclosure, consentLabel, large, onSaved }: DirectSetupProps) {
  const p = directProvider(provider) as DirectProvider;
  const cloudflare = provider === 'cloudflare';
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? p.baseUrl);
  const [account, setAccount] = useState(initial ? cloudflareAccount(initial.baseUrl) : '');
  const [model, setModel] = useState(initial?.model ?? p.model);
  const [key, setKey] = useState('');

  const url = cloudflare ? p.baseUrl.replace('{account}', account.trim()) : baseUrl.trim();
  const origin = endpointOrigin(url);
  // Re-saving the saved endpoint at the same address with the key field left blank keeps its key.
  const keepKey = !!initial && endpointOrigin(initial.baseUrl) === origin && !key.trim();
  const flow = useSaveFlow<DirectRequest>({
    origin,
    local: p.local,
    request: () => ({ provider, baseUrl: url, model: model.trim(), ...(p.local || keepKey ? {} : { key: key.trim() }) }),
    test: (r) => sendMessage('testDirectEndpoint', r),
    save: (r) => sendMessage('setDirectEndpoint', r),
    checkFailed: (error, h, r) => checkError(error, p.name, h, r.model, provider === 'ollama'),
    onSaved,
    clearKey: () => setKey(''),
  });
  const { busy, edit } = flow;

  const missing = cloudflare && !ACCOUNT_ID.test(account.trim())
    ? t('connection.provider.missing.account')
    : !origin || (p.local && !isLocalUrl(url))
      ? t(p.local ? 'connection.provider.missing.local' : 'connection.provider.missing.url')
      : !p.local && !key.trim() && !keepKey
        ? cloudflare
          ? t('connection.provider.missing.token')
          : t('connection.provider.missing.key', { provider: p.name })
        : !model.trim()
          ? t('connection.provider.missing.model')
          : undefined;

  const unchanged = !!active && !!initial && url === initial.baseUrl && model.trim() === initial.model && !key.trim();
  const images = readsImages(p, model);
  const tuned = model.trim() === CALIBRATED_MODEL;
  const modelField = !cloudflare && (
    <div>
      <FieldLabel for="direct-model">{t('connection.custom.model')}</FieldLabel>
      <TextInput
        id="direct-model"
        spellcheck={false}
        autoComplete="off"
        value={model}
        disabled={busy}
        placeholder={provider === 'lmstudio' ? t('connection.provider.lmstudio.modelPlaceholder') : ''}
        aria-describedby="direct-model-hint"
        onInput={edit(setModel)}
      />
      <p id="direct-model-hint" class="mt-2 mb-0 text-[13px] text-muted">
        {p.model ? t('connection.provider.modelSuggested') : t('connection.provider.modelHint')}
      </p>
    </div>
  );

  return (
    <div class="grid max-w-xl gap-4">
      <div class="grid gap-1 text-[13px] text-muted">
        <Fact icon={p.local ? Laptop : Cloud}>{t(p.local ? 'connection.provider.sendsToLocal' : 'connection.provider.sendsTo', { host: flow.host || new URL(p.baseUrl.replace('{account}', 'x')).host })}</Fact>
        <Fact icon={images ? Image : ImageOff}>{t(images ? 'connection.provider.images' : 'connection.provider.textOnly')}</Fact>
        {topicRules > topicRuleLimit(p) && (
          <p class="m-0 flex items-start gap-2 text-danger">
            <TriangleAlert size={14} strokeWidth={1.75} aria-hidden="true" class="mt-[3px] shrink-0" />
            <span>{t('connection.provider.tooManyRules', { provider: p.name, max: String(topicRuleLimit(p)), count: String(topicRules) })}</span>
          </p>
        )}
        {/* Filtering strength was tuned on clef-flash at Cloudflare (decision-engine.md Section 2.3). */}
        {!(tuned && !p.local) && <Fact icon={Gauge}>{tuned ? t('connection.provider.tunedLocal') : t('connection.provider.untuned', { model: model.trim() || p.name })}</Fact>}
      </div>

      {p.local && <LocalSteps provider={provider} model={model} />}
      {/* On this computer the model comes before the address: Ollama's first command downloads it. */}
      {p.local && modelField}

      {cloudflare && (
        <>
          <p class="m-0 text-[13px] text-muted">
            {t('connection.provider.cloudflare.how')}{' '}
            <Ext href="https://dash.cloudflare.com/?to=/:account/ai/workers-ai">{t('connection.provider.cloudflare.open')}</Ext>
          </p>
          <div>
            <FieldLabel for="direct-account">{t('connection.provider.cloudflare.account')}</FieldLabel>
            <TextInput
              id="direct-account"
              spellcheck={false}
              autoComplete="off"
              value={account}
              disabled={busy}
              aria-invalid={account.trim() !== '' && !ACCOUNT_ID.test(account.trim()) ? true : undefined}
              aria-describedby={account.trim() !== '' && !ACCOUNT_ID.test(account.trim()) ? 'direct-account-error' : undefined}
              onInput={edit(setAccount)}
            />
            {account.trim() !== '' && !ACCOUNT_ID.test(account.trim()) && (
              <p id="direct-account-error" class="mt-2 mb-0 text-[13px] text-danger">
                {t('connection.provider.cloudflare.accountInvalid')}
              </p>
            )}
          </div>
        </>
      )}
      {p.local && (
        <div>
          <FieldLabel for="direct-url">{t('connection.provider.address')}</FieldLabel>
          <TextInput id="direct-url" type="url" spellcheck={false} value={baseUrl} disabled={busy} onInput={edit(setBaseUrl)} />
        </div>
      )}
      {!p.local && (
        <div class="grid gap-2">
          <KeyField
            id="direct-key"
            label={cloudflare ? t('connection.provider.cloudflare.token') : t('connection.provider.keyLabel', { provider: p.name })}
            value={key}
            disabled={busy}
            keep={!!initial}
            onInput={edit(setKey)}
          />
          {!cloudflare && p.keyUrl && <Ext href={p.keyUrl}>{t('connection.provider.howKey')}</Ext>}
        </div>
      )}
      {!p.local && modelField}
      {cloudflare && <p class="m-0 text-[13px] text-muted">{t('connection.provider.cloudflare.model', { model: p.model })}</p>}

      <SaveArea
        flow={flow as ReturnType<typeof useSaveFlow<unknown>>}
        label={active ? t('connection.provider.saveChanges') : t('connection.provider.use', { provider: p.name })}
        checking={t('connection.provider.checking', { provider: p.name })}
        missing={missing}
        unchanged={unchanged}
        local={p.local}
        disclosure={disclosure}
        consentLabel={consentLabel}
        large={large}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------

type ChatRequest = { baseUrl: string; model: string; key?: string };

/**
 * The chat model (Settings, Connection only, decision-engine.md Section 6): any OpenAI-compatible chat
 * completions address. Less accurate than a Decision model and titles only, which the form says first.
 * Ollama and LM Studio fill in their address on this computer.
 */
export function ChatEndpoint({ settings }: { settings: Settings }) {
  const saved = settings.customEndpoint;
  const [baseUrl, setBaseUrl] = useState(saved?.baseUrl ?? '');
  const [model, setModel] = useState(saved?.model ?? '');
  const [key, setKey] = useState('');
  const origin = endpointOrigin(baseUrl);
  const local = isLocalUrl(baseUrl);
  const keepKey = !!saved && endpointOrigin(saved.baseUrl) === origin && !key.trim();
  const flow = useSaveFlow<ChatRequest>({
    origin,
    local,
    request: () => ({ baseUrl: baseUrl.trim(), model: model.trim(), ...(keepKey ? {} : { key: key.trim() }) }),
    test: (r) => sendMessage('testCustomEndpoint', r),
    save: (r) => sendMessage('setCustomEndpoint', r),
    checkFailed: (error, h, r) => checkError(error, h, h, r.model, isOllamaUrl(r.baseUrl)),
    onSaved: () => {},
    clearKey: () => setKey(''),
  });
  const { busy, edit } = flow;
  const missing = !origin ? t('connection.provider.missing.url') : !model.trim() ? t('connection.provider.missing.model') : undefined;
  const active = settings.engine === 'custom' && !!saved;
  const unchanged = active && baseUrl.trim() === saved.baseUrl && model.trim() === saved.model && !key.trim();

  return (
    <details class="group" open={settings.engine === 'custom' || undefined}>
      <summary class="flex cursor-pointer list-none items-center gap-2 rounded-[6px] py-1 text-[15px] font-bold tracking-[-0.01em] [&::-webkit-details-marker]:hidden">
        <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" class="transition-transform group-open:rotate-90 motion-reduce:transition-none" />
        {t('connection.chat.title')}
        <span class="text-[12px] font-normal tracking-normal text-muted">{t('connection.chat.badge')}</span>
      </summary>
      <div class="mt-2 border-t border-line-strong pt-4">
        <div class="grid max-w-xl gap-4">
          <div class="grid gap-1 text-[13px] text-muted">
            <p class="m-0">{t('connection.chat.lede')}</p>
            <Fact icon={ImageOff}>{t('connection.chat.textOnly')}</Fact>
          </div>
          <div>
            <FieldLabel for="custom-url">{t('connection.custom.baseUrl')}</FieldLabel>
            <TextInput
              id="custom-url"
              type="url"
              placeholder="https://"
              value={baseUrl}
              disabled={busy}
              aria-invalid={baseUrl.trim() !== '' && !origin ? true : undefined}
              aria-describedby={baseUrl.trim() !== '' && !origin ? 'custom-url-error' : 'custom-url-fill'}
              onInput={edit(setBaseUrl)}
            />
            {baseUrl.trim() !== '' && !origin ? (
              <p id="custom-url-error" class="mt-2 mb-0 text-[13px] text-danger">
                {t('connection.custom.urlInvalid')}
              </p>
            ) : (
              <p id="custom-url-fill" class="mt-2 mb-0 flex flex-wrap items-center gap-x-3 text-[13px] text-muted">
                {t('connection.chat.fill')}
                {CHAT_LOCAL.map((c) => (
                  <Button key={c.name} variant="text" disabled={busy} onClick={() => edit(setBaseUrl)({ currentTarget: { value: c.baseUrl } as HTMLInputElement })}>
                    {c.name}
                  </Button>
                ))}
              </p>
            )}
          </div>
          {isOllamaUrl(baseUrl) && (
            <Steps>
              <OllamaOrigins />
            </Steps>
          )}
          <KeyField id="custom-key" label={t('connection.chat.keyOptional')} value={key} disabled={busy} keep={!!saved && endpointOrigin(saved.baseUrl) === origin} onInput={edit(setKey)} />
          <div>
            <FieldLabel for="custom-model">{t('connection.custom.model')}</FieldLabel>
            <TextInput id="custom-model" spellcheck={false} autoComplete="off" value={model} disabled={busy} aria-describedby="custom-model-hint" onInput={edit(setModel)} />
            <p id="custom-model-hint" class="mt-2 mb-0 text-[13px] text-muted">
              {t('connection.chat.modelHint')}
            </p>
          </div>
          <SaveArea
            flow={flow as ReturnType<typeof useSaveFlow<unknown>>}
            label={active ? t('connection.provider.saveChanges') : t('connection.chat.use')}
            checking={t('connection.provider.checking', { provider: flow.host })}
            missing={missing}
            unchanged={unchanged}
            local={local}
            disclosure
            consentLabel={t('connection.consent.give')}
          />
        </div>
      </div>
    </details>
  );
}
