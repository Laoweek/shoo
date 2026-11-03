// "Always keep this channel" and channel Keep rules (REQ-EXC-3). When the channel is a Banned channel,
// the user is asked first: "Lift the ban on Hustle Daily too?".
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Rule } from '~/core/types';
import { t } from '~/i18n';
import { sendMessage } from '~/messaging/protocol';
import { Button } from '../components';
import { focusHeading } from './parts';
import { bannedRuleFor } from './rules';

export interface ChannelRef {
  channelName?: string;
  channelHandle?: string;
  channelId?: string;
}

type Ask = { channel: ChannelRef; name: string };

export function useKeepChannel(rules: Rule[] | undefined, onDone?: (ok: boolean) => void) {
  const [ask, setAsk] = useState<Ask>();

  const keep = async (channel: ChannelRef): Promise<void> => {
    const name = channel.channelName ?? channel.channelHandle ?? '';
    const banned = channel.channelName ? bannedRuleFor(rules ?? [], channel.channelName) : undefined;
    if (banned) {
      setAsk({ channel, name });
      return;
    }
    try {
      const res = await sendMessage('keepChannel', channel);
      if ('error' in res) return onDone?.(false);
      // The background knew of a ban this page did not: it created nothing (ruleId ''), so ask and send again.
      if (res.ruleId === '') setAsk({ channel, name });
      else onDone?.(true);
    } catch {
      onDone?.(false);
    }
  };

  const answer = async (lift: boolean) => {
    const a = ask;
    setAsk(undefined);
    focusHeading();
    if (!a) return;
    try {
      const res = await sendMessage('keepChannel', { ...a.channel, liftBan: lift });
      onDone?.(!('error' in res));
    } catch {
      onDone?.(false);
    }
  };

  const prompt = ask ? <LiftBanPrompt name={ask.name} onAnswer={(lift) => void answer(lift)} /> : null;
  return { keep, prompt, asking: !!ask };
}

function LiftBanPrompt({ name, onAnswer }: { name: string; onAnswer: (lift: boolean) => void }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <div role="alert" class="my-4 flex flex-wrap items-center gap-3 rounded-[10px] bg-lit px-4 py-3">
      <p class="m-0 min-w-0 flex-1 font-semibold">{t('keep.liftBan.question', { channel: name })}</p>
      <div class="flex gap-2">
        <button
          ref={first}
          type="button"
          onClick={() => onAnswer(true)}
          class="h-[30px] cursor-pointer rounded-[6px] border border-ink bg-ink px-3 font-semibold text-paper hover:opacity-90"
        >
          {t('keep.liftBan.yes')}
        </button>
        <Button onClick={() => onAnswer(false)}>{t('keep.liftBan.no')}</Button>
      </div>
    </div>
  );
}
