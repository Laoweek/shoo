// Connection (docs/spec/ui-design.md Section 6, decision-engine.md §7 and §12): where Shoo checks videos
// (OpenRouter connect, paste or disconnect, or a Decision provider reached directly, the same choice as
// onboarding step 2 in ui/pages/EndpointSetup.tsx), consent, model picker, Filtering strength presets,
// and the chat model under a disclosure. Host-access prompts start here (never from the popup), and
// every permissions.request is the first statement of its click handler (cross-browser-and-stores.md §2).
import { ExternalLink } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { directProvider } from '~/core/providers';
import { endpointBase, endpointHost, endpointPattern } from '~/core/runtime';
import type { Settings, StrengthPreset } from '~/core/types';
import { STRENGTH_PRESETS } from '~/core/verdict';
import { t } from '~/i18n';
import { sendMessage, type KeyUsage } from '~/messaging/protocol';
import { Button, Notice, SkeletonRows } from '~/ui/components';
import { IS_FIREFOX, REQUIRED_ORIGINS, consentClick, requestOrigins } from '~/ui/pages/consent';
import { ChatEndpoint, DirectSetup, ProviderPicker } from '~/ui/pages/EndpointSetup';
import { Disclosure } from '~/ui/pages/Disclosure';
import { date, money } from '~/ui/pages/format';
import { useAsync, useOnline } from '~/ui/pages/hooks';
import { OPENROUTER_KEYS_URL, PRIVACY_POLICY_URL } from '~/ui/pages/nav';
import type { ProviderId } from '~/ui/pages/providers';
import { FieldLabel, SectionHead, Select, Status, SubHead, TextInput } from '~/ui/pages/parts';
import type { PageData, SectionProps } from '../context';

export async function patchSettings(patch: Partial<Settings>): Promise<boolean> {
  try {
    await sendMessage('updateSettings', { patch });
    return true;
  } catch {
    return false;
  }
}

export function Connection({ data }: SectionProps) {
  const s = data.settings;
  // Host access is checked directly too: a higher RuntimeState reason (off, noConsent) can hide hostRevoked.
  const base = s && endpointBase(s);
  const custom = base ? endpointPattern(base, IS_FIREFOX) : undefined;
  const access = useAsync(
    async () => {
      try {
        return await browser.permissions.contains({ origins: custom ? [...REQUIRED_ORIGINS, custom] : REQUIRED_ORIGINS });
      } catch {
        return true;
      }
    },
    [],
    [custom],
  );
  return (
    <section aria-labelledby="section-connection">
      <SectionHead id="section-connection" title={t('connection.title')} lede={t('connection.lede')} />
      {data.loadError ? (
        <Notice tone="danger" live="alert">
          {t('settings.error.load')}
        </Notice>
      ) : !s ? (
        <SkeletonRows rows={4} />
      ) : (
        <div class="grid gap-6">
          {(data.runtime?.reason === 'hostRevoked' || access.data === false) && (
            <HostAccess
              settings={s}
              onGranted={() => {
                access.reload();
                data.refreshRuntime();
              }}
            />
          )}
          <Providers data={data} />
          <Consent data={data} />
          {s.engine === 'openrouter' && <Models settings={s} />}
          <Strength settings={s} />
          <ChatEndpoint settings={s} />
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------

function HostAccess({ settings, onGranted }: { settings: Settings; onGranted: () => void }) {
  const [denied, setDenied] = useState(false);
  const base = endpointBase(settings);
  const custom = base ? endpointPattern(base, IS_FIREFOX) : undefined;
  const origins = custom ? [...REQUIRED_ORIGINS, custom] : REQUIRED_ORIGINS;
  const allow = () => {
    const request = requestOrigins(origins);
    void request.then(
      (ok) => {
        setDenied(!ok);
        if (ok) onGranted();
      },
      () => setDenied(true),
    );
  };
  return (
    <div class="grid gap-2 rounded-[10px] bg-lit px-4 py-3">
      <p class="m-0 font-semibold text-danger">{t('popup.state.hostRevoked')}</p>
      <p class="m-0 text-muted">{t('connection.access.body')}</p>
      <div>
        <Button variant="primary" onClick={allow}>
          {t('connection.access.allow')}
        </Button>
      </div>
      <Status tone="danger" class="empty:absolute">{denied ? t('connection.access.denied') : ''}</Status>
    </div>
  );
}

/** The provider in use, as the picker marks it. A chat model is none of the picker's choices. */
function activeProvider(s: Settings): ProviderId | undefined {
  return s.engine === 'openrouter' ? 'openrouter' : s.engine === 'direct' ? s.direct?.provider : undefined;
}

/**
 * Where Shoo checks videos: the provider choice with OpenRouter's connect flow or a direct provider's
 * setup under it. With a direct provider or a chat model in use, it says so first, with a way back to
 * OpenRouter (whose consent is asked again, since consent names its recipient).
 */
function Providers({ data }: { data: PageData }) {
  const s = data.settings!;
  const inUse = activeProvider(s);
  const [picked, setPicked] = useState<ProviderId | undefined>(inUse);
  return (
    <div>
      <SubHead title={t('connection.provider.title')} />
      <div class="grid gap-4 border-t border-line-strong pt-4">
        {s.engine !== 'openrouter' && <InUse settings={s} />}
        <ProviderPicker value={picked} inUse={inUse} onChange={setPicked} />
        {picked === 'openrouter' ? (
          <div class="grid gap-4">
            <OpenRouter data={data} />
            {/* Switching needs a key: without one, Connect or Paste above comes first. */}
            {s.engine !== 'openrouter' && data.keyStatus === 'connected' && <SwitchBack settings={s} onSwitched={data.refreshRuntime} />}
          </div>
        ) : (
          picked && (
            <DirectSetup
              key={picked}
              provider={picked}
              initial={s.direct?.provider === picked ? s.direct : undefined}
              active={inUse === picked}
              topicRules={(data.rules ?? []).filter((r) => r.kind === 'topic' && r.polarity === 'remove' && r.enabled && r.deletedAt === undefined).length}
              disclosure
              consentLabel={t('connection.consent.give')}
              onSaved={() => {}}
            />
          )
        )}
      </div>
    </div>
  );
}

/** What is in use when it is not OpenRouter: the model, the provider (or this computer) and its host. */
function InUse({ settings }: { settings: Settings }) {
  const base = endpointBase(settings);
  const host = (base && endpointHost(base)) ?? '';
  const direct = settings.engine === 'direct' ? settings.direct : undefined;
  const p = direct && directProvider(direct.provider);
  return (
    <p class="m-0 font-semibold">
      {!p
        ? t('connection.custom.activeChat', { host, model: settings.customEndpoint?.model ?? '' })
        : p.local
          ? t('connection.custom.activeLocal', { host, model: direct.model })
          : t('connection.custom.activeDirect', { host, model: direct.model, provider: p.name })}
    </p>
  );
}

/** Back to OpenRouter from a direct provider or a chat model. Consent given for another host does not cover OpenRouter. */
function SwitchBack({ settings, onSwitched }: { settings: Settings; onSwitched: () => void }) {
  const [failed, setFailed] = useState(false);
  const switchBack = async () => {
    setFailed(false);
    if (settings.consent?.customHost) {
      const withdrawn = await sendMessage('withdrawConsent').then(
        () => true,
        () => false,
      );
      if (!withdrawn) return setFailed(true);
    }
    const ok = await patchSettings({ engine: 'openrouter' });
    setFailed(!ok);
    if (!ok) return;
    onSwitched();
  };
  return (
    <div class="grid gap-2">
      {settings.consent?.customHost && <p class="m-0 text-[13px] text-muted">{t('connection.custom.reconsent')}</p>}
      <div>
        <Button variant="primary" onClick={() => void switchBack()}>
          {t('connection.provider.use', { provider: 'OpenRouter' })}
        </Button>
      </div>
      <Status tone="danger" class="empty:absolute">{failed ? t('connection.error.save') : ''}</Status>
    </div>
  );
}

type Busy = 'connecting' | 'saving' | undefined;

function OpenRouter({ data }: { data: PageData }) {
  const online = useOnline();
  const [busy, setBusy] = useState<Busy>();
  const [message, setMessage] = useState<{ text: string; tone: 'plain' | 'danger' }>();
  const [paste, setPaste] = useState(false);
  const [keyText, setKeyText] = useState('');
  const [headless, setHeadless] = useState(false);
  const [code, setCode] = useState('');
  const [confirmReconnect, setConfirmReconnect] = useState(false);

  const status = data.keyStatus;
  const usage = data.key && !('error' in data.key) ? (data.key as KeyUsage) : undefined;
  const fail = (text: string) => setMessage({ text, tone: 'danger' });
  const done = () => {
    setMessage(undefined);
    setPaste(false);
    setKeyText('');
    setHeadless(false);
    setCode('');
    setConfirmReconnect(false);
    data.refreshKey();
  };

  const connect = async () => {
    if (status === 'connected' && !confirmReconnect) return setConfirmReconnect(true);
    setBusy('connecting');
    setMessage(undefined);
    try {
      const res = await sendMessage('connectOpenRouter');
      if (res.ok) return done();
      if (res.error === 'cancelled') fail(t('connection.oauth.cancelled'));
      else if (res.error === 'unsupported') setHeadless(true);
      else fail(t('connection.oauth.failed'));
    } catch {
      fail(t('connection.oauth.failed'));
    } finally {
      setBusy(undefined);
    }
  };

  const saveKey = async () => {
    if (!keyText.trim()) return;
    setBusy('saving');
    setMessage(undefined);
    try {
      const res = await sendMessage('setKey', { key: keyText.trim() });
      if (res.ok) return done();
      fail(res.error === 'offline' ? t('connection.offline') : t('connection.key.invalid'));
    } catch {
      fail(t('connection.key.invalid'));
    } finally {
      setBusy(undefined);
    }
  };

  const exchange = async () => {
    if (!code.trim()) return;
    setBusy('saving');
    try {
      const res = await sendMessage('exchangeHeadlessCode', { code: code.trim() });
      if (res.ok) return done();
      fail(res.error === 'expired' ? t('connection.headless.expired') : t('connection.oauth.failed'));
    } catch {
      fail(t('connection.oauth.failed'));
    } finally {
      setBusy(undefined);
    }
  };

  const disconnect = async () => {
    try {
      await sendMessage('disconnect');
      done();
    } catch {
      fail(t('connection.error.save'));
    }
  };

  return (
    <div>
      <SubHead title={t('connection.openrouter')} />
      <div class="grid gap-3 border-t border-line-strong pt-4">
        {status === 'unknown' ? (
          <SkeletonRows rows={2} />
        ) : status === 'connected' ? (
          <div class="grid gap-1">
            <p class="m-0 font-semibold">{usage ? t('connection.connected', { date: date(usage.connectedAt), label: usage.label ?? 'Shoo' }) : t('popup.footer.connected')}</p>
            {usage && (
              <p class="num m-0 text-muted">
                {usage.usageDaily !== undefined
                  ? t('connection.usageToday', { usage: money(usage.usageDaily) })
                  : usage.limit === null
                  ? t('connection.noLimit', { usage: money(usage.usage) })
                  : t('connection.usage', { usage: money(usage.usage), limit: money(usage.limit) })}
              </p>
            )}
          </div>
        ) : (
          status === 'rejected' && <p class="m-0 text-danger">{t('notice.keyRejected')}</p>
        )}

        {!online && <p class="m-0 text-danger">{t('connection.offline')}</p>}
        {confirmReconnect && (
          <p role="alert" class="m-0 font-semibold">
            {t('connection.reconnectWarning')}
          </p>
        )}

        <div class="flex flex-wrap items-center gap-2">
          <Button variant={status === 'connected' && !confirmReconnect ? 'outline' : 'primary'} disabled={!online || busy !== undefined} onClick={() => void connect()}>
            {busy === 'connecting'
              ? t('connection.connecting')
              : status === 'connected'
                ? confirmReconnect
                  ? t('connection.reconnectConfirm')
                  : t('connection.reconnect')
                : t('connection.connect')}
          </Button>
          {status !== 'connected' && (
            <Button aria-expanded={paste} onClick={() => setPaste((p) => !p)}>
              {t('connection.paste')}
            </Button>
          )}
          {status === 'connected' && <Button onClick={() => void disconnect()}>{t('connection.disconnect')}</Button>}
          {confirmReconnect && <Button variant="text" onClick={() => setConfirmReconnect(false)}>{t('common.cancel')}</Button>}
        </div>
        {status === 'connected' && (
          <p class="m-0 text-[13px] text-muted">
            {t('connection.disconnectNote')}{' '}
            <a href={OPENROUTER_KEYS_URL} target="_blank" rel="noreferrer" class="inline-flex items-center gap-1 font-semibold text-ink underline underline-offset-[3px]">
              openrouter.ai/keys
              <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
            </a>
          </p>
        )}

        {paste && status !== 'connected' && (
          <form
            class="flex max-w-xl flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void saveKey();
            }}
          >
            <div class="min-w-[16rem] flex-1">
              <FieldLabel for="key-input">{t('connection.key.label')}</FieldLabel>
              <TextInput id="key-input" type="password" autoComplete="off" spellcheck={false} value={keyText} onInput={(e) => setKeyText(e.currentTarget.value)} />
            </div>
            <Button type="submit" variant="primary" class="h-9!" disabled={!online || !keyText.trim() || busy !== undefined}>
              {t('connection.key.save')}
            </Button>
          </form>
        )}

        {headless && (
          <form
            class="flex max-w-xl flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void exchange();
            }}
          >
            <div class="min-w-[16rem] flex-1">
              <FieldLabel for="code-input">{t('connection.headless.label')}</FieldLabel>
              <TextInput id="code-input" autoComplete="off" spellcheck={false} value={code} onInput={(e) => setCode(e.currentTarget.value)} />
            </div>
            <Button type="submit" variant="primary" disabled={!code.trim() || busy !== undefined}>
              {t('common.save')}
            </Button>
          </form>
        )}
        <Status tone={message?.tone} class="empty:absolute">{message?.text ?? (busy === 'connecting' ? t('connection.connecting') : '')}</Status>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------

function Consent({ data }: { data: PageData }) {
  const s = data.settings!;
  const [note, setNote] = useState<{ text: string; tone: 'plain' | 'danger' }>();
  const base = endpointBase(s);
  const customHost = base ? endpointHost(base) : undefined;
  const give = consentClick({
    customHost,
    onDone: (granted) => {
      setNote(granted ? undefined : { text: t('connection.consent.declined'), tone: 'plain' });
      data.refreshRuntime();
    },
    onError: () => setNote({ text: t('connection.error.save'), tone: 'danger' }),
  });
  const withdraw = async () => {
    try {
      await sendMessage('withdrawConsent');
      data.refreshRuntime();
    } catch {
      setNote({ text: t('connection.error.save'), tone: 'danger' });
    }
  };
  return (
    <div>
      <SubHead title={t('connection.consent.title')} />
      <div class="grid gap-3 border-t border-line-strong">
        <Disclosure compact class="border-b border-line" />
        <p class="m-0 text-[13px]">
          <a href={PRIVACY_POLICY_URL} target="_blank" rel="noreferrer" class="inline-flex items-center gap-1 font-semibold text-ink underline underline-offset-[3px]">
            {t('connection.consent.policy')}
            <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
          </a>
        </p>
        {customHost && <p class="m-0 font-semibold">{t('connection.custom.consent', { host: customHost })}</p>}
        {data.consent && s.consent ? (
          <div class="flex flex-wrap items-center gap-3">
            <span class="text-muted">
              {s.consent.customHost
                ? t('connection.consent.givenHost', { host: s.consent.customHost, date: date(s.consent.acceptedAt) })
                : t('connection.consent.given', { date: date(s.consent.acceptedAt) })}
            </span>
            <Button variant="text" onClick={() => void withdraw()}>
              {t('connection.consent.withdraw')}
            </Button>
          </div>
        ) : (
          <div class="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={give}>
              {t('connection.consent.give')}
            </Button>
            <span class="text-[13px] text-muted">{t('popup.state.noConsent')}</span>
          </div>
        )}
        <Status tone={note?.tone} class="empty:absolute">{note?.text ?? ''}</Status>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------

function Models({ settings }: { settings: Settings }) {
  const list = useAsync(() => sendMessage('listModels', {}), []);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const models = list.data && !('error' in list.data) ? list.data.models : undefined;
  const loadFailed = !!list.error || (!!list.data && 'error' in list.data);

  const retry = async () => {
    setRefreshing(true);
    try {
      await sendMessage('listModels', { refresh: true });
    } finally {
      setRefreshing(false);
      list.reload();
    }
  };
  const set = (patch: Partial<Settings['models']>) => void patchSettings({ models: { ...settings.models, ...patch } }).then((ok) => setFailed(!ok));

  const label = (id: string, images: boolean, price?: number) =>
    [id, images ? t('connection.models.images') : undefined, price !== undefined ? t('connection.models.price', { price: money(price) }) : undefined].filter(Boolean).join(' · ');

  const options = (imagesOnly: boolean, current: string) => {
    const shown = (models ?? []).filter((m) => !imagesOnly || m.images);
    const list = shown.some((m) => m.id === current) ? shown : [{ id: current, images: false, pricePerMInput: undefined as number | undefined }, ...shown];
    return list.map((m) => (
      <option key={m.id} value={m.id}>
        {label(m.id, m.images, m.pricePerMInput)}
      </option>
    ));
  };

  return (
    <div>
      <SubHead title={t('connection.models.label')} />
      <div class="grid gap-3 border-t border-line-strong pt-4">
        {list.loading ? (
          <SkeletonRows rows={2} />
        ) : (
          <div class="grid max-w-xl gap-4">
            <div>
              <FieldLabel for="model-text">{t('connection.models.text')}</FieldLabel>
              <Select id="model-text" value={settings.models.text} disabled={!models} onChange={(e) => set({ text: e.currentTarget.value })}>
                {options(false, settings.models.text)}
              </Select>
            </div>
            <div>
              <FieldLabel for="model-image">{t('connection.models.image')}</FieldLabel>
              <Select id="model-image" value={settings.models.image} disabled={!models} onChange={(e) => set({ image: e.currentTarget.value })}>
                {options(true, settings.models.image)}
              </Select>
            </div>
          </div>
        )}
        {loadFailed && (
          <Notice tone="danger" actions={[{ label: refreshing ? t('common.loading') : t('common.retry'), onClick: () => void retry() }]}>
            {t('connection.models.error')}
          </Notice>
        )}
        <Status tone="danger" class="empty:absolute">{failed ? t('connection.error.save') : ''}</Status>
      </div>
    </div>
  );
}

const PRESETS: StrengthPreset[] = ['cautious', 'balanced', 'eager'];

function Strength({ settings }: { settings: Settings }) {
  const [failed, setFailed] = useState(false);
  const presets = settings.strength.preset === 'custom' ? [...PRESETS, 'custom' as const] : PRESETS;
  const pick = (preset: StrengthPreset) => void patchSettings({ strength: { ...settings.strength, preset } }).then((ok) => setFailed(!ok));
  return (
    <fieldset class="m-0 min-w-0 border-0 p-0">
      <legend class="mb-2 p-0 text-[15px] font-bold tracking-[-0.01em]">{t('connection.strength.label')}</legend>
      <div class="border-t border-line-strong">
        {presets.map((p) => (
          <label key={p} class="flex min-h-11 cursor-pointer items-start gap-3 border-b border-line px-2 py-3 hover:bg-tint">
            <input type="radio" name="strength" value={p} checked={settings.strength.preset === p} onChange={() => pick(p)} class="mt-1 size-4 shrink-0 cursor-pointer" />
            <span class="min-w-0">
              <span class="font-semibold">{t(`connection.strength.${p}`)}</span>
              {p !== 'custom' && <span class="num ml-2 text-[12px] text-muted">{t('connection.strength.cutoff', { p: String(Math.round(STRENGTH_PRESETS[p].text * 100)) })}</span>}
              <span class="block text-[13px] text-muted">{t(`connection.strength.hint.${p}`)}</span>
            </span>
          </label>
        ))}
      </div>
      <Status tone="danger">{failed ? t('connection.error.save') : ''}</Status>
    </fieldset>
  );
}
