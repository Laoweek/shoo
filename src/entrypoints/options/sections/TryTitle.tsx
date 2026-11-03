// Try a title (REQ-RULE-8, decision-engine.md §7.5): one real model call for a synthetic video. Needs
// consent: without it the slip is disabled and links to Connection, and no message is ever sent.
import { useContext, useRef, useState } from 'preact/hooks';
import type { ReasonCode, Rule, TileResult } from '~/core/types';
import { t } from '~/i18n';
import { sendMessage } from '~/messaging/protocol';
import { Button, RuleRef, VerdictPill, ruleLabel } from '~/ui/components';
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
  const [state, setState] = useState<State>({ kind: 'idle' });
  const typing = useRef<ReturnType<typeof setTimeout>>(undefined);
  const videoId = url.trim() ? parseVideoId(url) : undefined;
  const urlInvalid = videoId === null;

  const typed = () => {
    if (state.kind === 'done' || state.kind === 'error') setState({ kind: 'idle' });
    eyes.reading(true);
    clearTimeout(typing.current);
    typing.current = setTimeout(() => eyes.reading(false), 700);
  };

  const submit = async () => {
    if (!consent || !title.trim() || urlInvalid || state.kind === 'pending') return;
    setState({ kind: 'pending' });
    try {
      const res = await sendMessage('tryTitle', {
        title: title.trim(),
        ...(channel.trim() ? { channelName: channel.trim() } : {}),
        ...(videoId ? { thumbnailUrl: tryThumbnailUrl(videoId) } : {}),
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
  const field = 'w-full min-w-0 border-0 bg-transparent p-0 text-ink placeholder:text-muted focus:outline-none disabled:cursor-not-allowed';
  const wrap = 'rounded-[6px] focus-within:outline-2 focus-within:outline-offset-4 focus-within:outline-ink';

  return (
    <section aria-labelledby="try-label" class="mb-6 rounded-[10px] border border-dashed border-line-strong p-3">
      <div class="grid gap-3" onKeyDown={onKey}>
        <div class="flex flex-wrap items-end gap-x-4 gap-y-2">
          <div class={`${wrap} min-w-[min(100%,16rem)] flex-1`}>
            <label id="try-label" for="try-title" class="mb-1 block text-[12px] font-semibold text-muted">
              {t('rules.try.label')}
            </label>
            <input
              id="try-title"
              type="text"
              disabled={!consent}
              value={title}
              placeholder={t('rules.try.titlePlaceholder')}
              onInput={(e) => {
                setTitle(e.currentTarget.value);
                typed();
              }}
              class={`${field} text-[16px]`}
            />
          </div>
          <div class="ml-auto flex min-h-[30px] items-center">
            {!consent ? (
              <Button variant="text" onClick={onGiveConsent}>
                {t('rules.try.needsConsent')}
              </Button>
            ) : state.kind === 'pending' ? (
              <VerdictPill outcome="pending" />
            ) : verdict ? (
              <VerdictPill outcome={verdict.outcome} rule={rule ? ruleLabel(rule) : verdict.ruleRef} colour={rule?.colour} probability={verdict.probability} />
            ) : (
              <Button variant="primary" disabled={!title.trim() || urlInvalid} onClick={() => void submit()}>
                {t('rules.try.submit')}
              </Button>
            )}
          </div>
        </div>
        <div class="grid gap-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
          {/* Channel and URL are secondary fields, so they get a visible --edge boundary (WCAG 1.4.11). */}
          <TextInput
            id="try-channel"
            disabled={!consent}
            value={channel}
            placeholder={t('rules.try.channel')}
            aria-label={t('rules.try.channel')}
            onInput={(e) => {
              setChannel(e.currentTarget.value);
              typed();
            }}
          />
          <TextInput
            id="try-url"
            type="url"
            disabled={!consent}
            value={url}
            placeholder={t('rules.try.url')}
            aria-label={t('rules.try.url')}
            aria-invalid={urlInvalid || undefined}
            aria-describedby={urlInvalid ? 'try-url-error' : undefined}
            onInput={(e) => {
              setUrl(e.currentTarget.value);
              typed();
            }}
          />
        </div>
      </div>
      <div role="status" class="text-[13px]">
        {urlInvalid && (
          <p id="try-url-error" class="mt-2 mb-0 text-danger">
            {t('rules.try.urlInvalid')}
          </p>
        )}
        {state.kind === 'error' && <p class="mt-2 mb-0 text-danger">{state.message}</p>}
        {verdict && rule && (
          <p class="mt-2 mb-0 text-muted">
            <RuleRef
              rule={rule}
              wrap
              sentence={(label) => (rule.name ? t('rules.try.decidedByNamed', { name: label, rule: rule.text }) : t('rules.try.decidedBy', { rule: label }))}
            />
          </p>
        )}
      </div>
    </section>
  );
}
