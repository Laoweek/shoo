// Try a title (REQ-RULE-8, decision-engine.md §7.5): one real model call for a synthetic video. Needs
// consent: without it the slip is disabled and links to Connection, and no message is ever sent. Once a Rule works
// on one Site only, the slip asks which Site the video is on, since only that Site's Rules apply. The eyes peek over
// the card's top edge and read along while the user types.
import { useContext, useRef, useState } from 'preact/hooks';
import { SITE_IDS, SITE_NAMES, type SiteId } from '~/core/sites';
import type { ReasonCode, Rule, TileResult } from '~/core/types';
import { t } from '~/i18n';
import { sendMessage } from '~/messaging/protocol';
import { Button, Eyes, RuleRef, Segmented, VerdictPill, ruleLabel } from '~/ui/components';
import { TextInput } from '~/ui/pages/parts';
import { byId } from '~/ui/pages/rules';
import { parseVideoId, tryThumbnailUrl } from '~/ui/pages/video-url';
import { EyesControl } from '../context';

type State = { kind: 'idle' } | { kind: 'pending' } | { kind: 'done'; result: TileResult } | { kind: 'error'; message: string };

export function tryErrorMessage(reason: ReasonCode | 'noConsent' | 'noKey' | 'invalidInput' | undefined): string {
  switch (reason) {
    case 'noConsent':
      return t('rules.try.needsConsent');
    case 'noKey':
    case 'keyRejected':
      return t('rules.try.error.noKey');
    case 'offline':
      return t('rules.try.error.offline');
    case 'dailyCap':
      return t('rules.try.error.dailyCap');
    case 'creditsExhausted':
      return t('rules.try.noCredits');
    case 'off':
    case 'hostRevoked':
    case 'migrating':
    case 'breakerModel':
      return t('rules.try.paused');
    case 'invalidInput':
      return t('rules.try.urlInvalid');
    case 'tooManyRules':
      return t('rules.try.error.tooManyRules');
    default:
      return t('rules.try.error.model');
  }
}

export function TryTitle({ consent, rules, onGiveConsent }: { consent: boolean; rules: Rule[]; onGiveConsent: () => void }) {
  const eyes = useContext(EyesControl);
  const [title, setTitle] = useState('');
  const [channel, setChannel] = useState('');
  const [url, setUrl] = useState('');
  const [site, setSite] = useState<SiteId>('youtube');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [reading, setReading] = useState(false);
  const siteOnly = rules.some((r) => r.site !== undefined && r.enabled);
  // A thumbnail comes from a YouTube video's address, so Bilibili titles are tried without one.
  const withUrl = !siteOnly || site === 'youtube';
  const typing = useRef<ReturnType<typeof setTimeout>>(undefined);
  const videoId = withUrl && url.trim() ? parseVideoId(url) : undefined;
  const urlInvalid = videoId === null;

  const typed = () => {
    if (state.kind === 'done' || state.kind === 'error') setState({ kind: 'idle' });
    eyes.reading(true);
    setReading(true);
    clearTimeout(typing.current);
    typing.current = setTimeout(() => {
      eyes.reading(false);
      setReading(false);
    }, 700);
  };

  const submit = async () => {
    if (!consent || !title.trim() || urlInvalid || state.kind === 'pending') return;
    setState({ kind: 'pending' });
    try {
      const res = await sendMessage('tryTitle', {
        title: title.trim(),
        ...(channel.trim() ? { channelName: channel.trim() } : {}),
        ...(videoId ? { thumbnailUrl: tryThumbnailUrl(videoId) } : {}),
        ...(siteOnly ? { site } : {}),
      });
      if ('error' in res) setState({ kind: 'error', message: tryErrorMessage(res.error) });
      else if (res.result.status === 'undecided') setState({ kind: 'error', message: tryErrorMessage(res.result.reason) });
      else setState({ kind: 'done', result: res.result });
    } catch {
      setState({ kind: 'error', message: tryErrorMessage(undefined) });
    }
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
      e.preventDefault();
      void submit();
    }
  };

  const verdict = state.kind === 'done' ? state.result.verdict : undefined;
  const rule = verdict?.ruleId ? byId(rules).get(verdict.ruleId) : undefined;

  return (
    <section aria-labelledby="try-label" class="relative mt-12 mb-6">
      <Eyes state={state.kind === 'pending' ? 'judging' : 'watching'} track reading={reading} width={84} class="absolute -top-[30px] right-12" />
      <div class="card relative grid gap-x-6 gap-y-4 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div class="grid min-w-0 gap-2.5" onKeyDown={onKey}>
          <label id="try-label" for="try-title" class="text-[18px] font-semibold">
            {t('rules.try.label')}
          </label>
          <div class="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,13rem)]">
            <TextInput
              id="try-title"
              disabled={!consent}
              value={title}
              placeholder={t('rules.try.titlePlaceholder')}
              class="h-[42px]! w-full"
              onInput={(e) => {
                setTitle(e.currentTarget.value);
                typed();
              }}
            />
            <TextInput
              id="try-channel"
              disabled={!consent}
              value={channel}
              placeholder={t('rules.try.channel')}
              aria-label={t('rules.try.channel')}
              class="h-[42px]! w-full"
              onInput={(e) => {
                setChannel(e.currentTarget.value);
                typed();
              }}
            />
          </div>
          <div class="flex gap-2.5">
            {withUrl && (
              <TextInput
                id="try-url"
                type="url"
                disabled={!consent}
                value={url}
                placeholder={t('rules.try.url')}
                aria-label={t('rules.try.url')}
                aria-invalid={urlInvalid || undefined}
                aria-describedby={urlInvalid ? 'try-url-error' : undefined}
                class="h-[42px]! min-w-0 flex-1"
                onInput={(e) => {
                  setUrl(e.currentTarget.value);
                  typed();
                }}
              />
            )}
            {consent && (
              <Button variant="primary" class="h-[42px]! px-6" disabled={!title.trim() || urlInvalid || state.kind === 'pending'} onClick={() => void submit()}>
                {t('rules.try.submit')}
              </Button>
            )}
          </div>
          {siteOnly && (
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
              <span class="font-semibold text-muted">{t('rules.try.site')}</span>
              <Segmented
                label={t('rules.try.site')}
                disabled={!consent}
                value={site}
                onChange={(v) => {
                  setSite(v);
                  typed();
                }}
                options={SITE_IDS.map((s) => ({ value: s, label: SITE_NAMES[s] }))}
              />
            </div>
          )}
        </div>
        <div class="flex min-w-0 flex-col items-start justify-center gap-2.5 lg:border-l lg:border-line lg:pl-6">
          {!consent ? (
            <Button variant="text" onClick={onGiveConsent}>
              {t('rules.try.needsConsent')}
            </Button>
          ) : state.kind === 'pending' ? (
            <VerdictPill outcome="pending" />
          ) : verdict ? (
            <VerdictPill outcome={verdict.outcome} rule={rule ? ruleLabel(rule) : verdict.ruleRef} probability={verdict.probability} />
          ) : (
            <p class="m-0 text-[13px] text-muted">{t('rules.try.idle')}</p>
          )}
          <div role="status" class="text-[13px]">
            {verdict && rule && (
              <p class="m-0 text-muted">
                <RuleRef
                  rule={rule}
                  wrap
                  sentence={(label) => (rule.name ? t('rules.try.decidedByNamed', { name: label, rule: rule.text }) : t('rules.try.decidedBy', { rule: label }))}
                />
              </p>
            )}
          </div>
        </div>
      </div>
      <div role="status" class="text-[13px]">
        {urlInvalid && (
          <p id="try-url-error" class="mt-2 mb-0 text-danger">
            {t('rules.try.urlInvalid')}
          </p>
        )}
        {state.kind === 'error' && <p class="mt-2 mb-0 text-danger">{state.message}</p>}
      </div>
    </section>
  );
}
