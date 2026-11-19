// Escalation suggestions waiting on the user (REQ-ESC-2): in the popup, the Rules section and Activity.
import { useState } from 'preact/hooks';
import type { Rule } from '~/core/types';
import { t } from '~/i18n';
import { sendMessage } from '~/messaging/protocol';
import { readEscalations, watchEscalation, watchRules, type EscalationSuggestion } from '~/store/read';
import { Button, RuleRef } from '../components';
import { useAsync } from './hooks';
import { byId } from './rules';

export function useEscalations() {
  return useAsync(() => readEscalations(), [watchEscalation, watchRules]);
}

export interface EscalationsProps {
  rules: Rule[] | undefined;
  /** popup: compact rows. strip: roomier rows in Settings (Rules and Activity), buttons at the row's end on wider screens. */
  variant: 'popup' | 'strip';
  class?: string;
}

export function Escalations({ rules, variant, class: cls }: EscalationsProps) {
  const list = useEscalations();
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [error, setError] = useState(false);
  const byRule = byId(rules);
  const items = (list.data ?? []).filter((e) => !gone.has(e.channelKey));
  if (items.length === 0) return error ? <p role="alert" class="m-0 text-danger">{t('banned.error.save')}</p> : null;

  const act = async (e: EscalationSuggestion, ban: boolean) => {
    setError(false);
    try {
      if (ban) await sendMessage('confirmEscalation', { channelKey: e.channelKey });
      else await sendMessage('dismissEscalation', { channelKey: e.channelKey });
      setGone((g) => new Set(g).add(e.channelKey));
      list.reload();
    } catch {
      setError(true);
    }
  };

  return (
    <ul class={`m-0 grid list-none gap-2 p-0 ${cls ?? ''}`} aria-label={t('popup.waiting.label')}>
      {items.map((e) => {
        const rule = e.ruleId ? byRule.get(e.ruleId) : undefined;
        const counts = { removed: String(e.removed), judged: String(e.judged) };
        return (
          <li
            key={e.channelKey}
            class={`grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-[14px] bg-lit ${variant === 'popup' ? 'px-3 py-2.5' : 'px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]'}`}
          >
            <span aria-hidden="true" class="mt-[7px] size-[7px] self-start rounded-full bg-ink" />
            {variant === 'popup' ? (
              <p class="m-0 min-w-0">
                <b class="font-semibold">{e.channelName}</b>
                <span class="flex text-[13px] text-muted">
                  {rule ? <RuleRef rule={rule} sentence={(label) => t('popup.escalation.removedBy', { ...counts, rule: label })} /> : t('popup.escalation.removed', counts)}
                </span>
              </p>
            ) : (
              <p class="m-0 min-w-0">
                <b class="font-semibold">{t('rules.escalation.lead', { channel: e.channelName })}</b>{' '}
                <span class="text-muted">
                  {rule ? <RuleRef rule={rule} wrap sentence={(label) => t('rules.escalation.detail', { ...counts, rule: label })} /> : t('rules.escalation.detailNoRule', counts)}
                </span>
              </p>
            )}
            <div class={`flex gap-2 ${variant === 'popup' ? 'col-start-2' : 'col-start-2 sm:col-start-3'}`}>
              <Button variant="primary" onClick={() => void act(e, true)}>
                {variant === 'popup' ? t('popup.escalation.ban') : t('rules.escalation.ban')}
              </Button>
              <Button onClick={() => void act(e, false)}>{variant === 'popup' ? t('popup.escalation.notNow') : t('rules.escalation.notNow')}</Button>
            </div>
          </li>
        );
      })}
      {error && (
        <li role="alert" class="text-danger">
          {t('banned.error.save')}
        </li>
      )}
    </ul>
  );
}
