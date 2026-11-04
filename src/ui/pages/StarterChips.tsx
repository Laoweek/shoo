// Starter rule chips (onboarding step 3 and the Rules empty state). Each chip turns into its Rule,
// with the colour the background assigned and the chip label as its Rule name, once it is added.
import { Plus } from 'lucide-preact';
import { useState } from 'preact/hooks';
import type { Rule } from '~/core/types';
import { t } from '~/i18n';
import { sendMessage } from '~/messaging/protocol';
import { RuleRef } from '../components';
import { Status } from './parts';
import { STARTERS, findAdded, needsModel, starterLabel, starterOp, starterText, type Starter } from './rules';

export interface StarterChipsProps {
  rules: Rule[];
  /** Consent and a key (or consent alone in onboarding): Topic starters need the Decision model. */
  modelOk: boolean;
  /** Shown on disabled Topic starters, e.g. "Needs consent". */
  disabledNote: string;
  onAdded?: (rule: Rule, rules: Rule[]) => void;
}

export function StarterChips({ rules, modelOk, disabledNote, onAdded }: StarterChipsProps) {
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState(false);
  const [added, setAdded] = useState<Rule[]>([]);

  const existing = (s: Starter) =>
    [...added, ...rules].find((r) => r.kind === s.kind && r.polarity === 'remove' && r.text === starterText(s) && r.deletedAt === undefined);

  const add = async (s: Starter) => {
    setBusy(s.id);
    setError(false);
    const op = starterOp(s);
    try {
      const res = await sendMessage('mutateRules', { ops: [op] });
      if ('error' in res) throw new Error(res.detail);
      const rule = findAdded(res.rules, op);
      if (rule) {
        setAdded((a) => [...a, rule]);
        onAdded?.(rule, res.rules);
      }
    } catch {
      setError(true);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div>
      <ul class="m-0 flex list-none flex-wrap gap-2 p-0">
        {STARTERS.map((s) => {
          const rule = existing(s);
          const blocked = needsModel(s.kind) && !modelOk;
          const label = starterLabel(s);
          if (rule) {
            return (
              <li key={s.id} class="inline-flex h-[34px] items-center rounded-full bg-tint pr-4 pl-3">
                {/* A Starter rule stored without a Rule name shows the chip label. */}
                <RuleRef rule={{ ...rule, name: rule.name || label }} />
              </li>
            );
          }
          return (
            <li key={s.id}>
              <button
                type="button"
                disabled={blocked || busy !== undefined}
                aria-describedby={blocked ? `starter-note-${s.id}` : undefined}
                onClick={() => void add(s)}
                class="press inline-flex h-[34px] cursor-pointer items-center gap-2 rounded-full border border-edge bg-paper pr-4 pl-3 font-medium hover:border-ink disabled:cursor-not-allowed disabled:border-stroke disabled:text-muted disabled:hover:border-stroke"
              >
                <Plus size={16} strokeWidth={2} aria-hidden="true" />
                {label}
                {blocked && (
                  <span id={`starter-note-${s.id}`} class="text-[12px] font-normal">
                    · {disabledNote}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <Status tone="danger" class="mt-2">
        {error ? t('rules.error.save') : ''}
      </Status>
    </div>
  );
}
