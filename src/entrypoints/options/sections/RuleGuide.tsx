// How to write a Rule (REQ-RULE-12, docs/spec/ui-design.md Section 6): a disclosure under the Rules lede,
// open while there are no Rules. Seven tips, the first five with a Try and a Not example. Every tip traces
// to docs/spec/decision-engine.md Section 13.
import { Check, ChevronRight, X } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { t } from '~/i18n';
import { Button } from '~/ui/components';

const WITH_EXAMPLES = ['describe', 'one', 'is', 'concrete', 'noNot'] as const;
const PLAIN = ['exact', 'name'] as const;
type TipId = (typeof WITH_EXAMPLES)[number] | (typeof PLAIN)[number];

/** Moves focus to Try a title: its title field, or its consent button while the field is disabled. */
function focusTryTitle() {
  const field = document.getElementById('try-title') as HTMLInputElement | null;
  const target = field && !field.disabled ? field : document.querySelector<HTMLElement>('[aria-labelledby="try-label"] button');
  target?.focus();
}

export function RuleGuide({ open }: { open: boolean }) {
  // Open on arrival when there are no Rules. Adding the first Rule doesn't fold it away mid-read.
  const [initial] = useState(open);
  return (
    <details class="group mb-6" open={initial}>
      <summary class="inline-flex cursor-pointer list-none items-center gap-2 rounded-[6px] py-1 font-semibold [&::-webkit-details-marker]:hidden">
        <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" class="transition-transform group-open:rotate-90 motion-reduce:transition-none" />
        {t('rules.guide.title')}
      </summary>
      <div class="@container mt-2 border-t border-line-strong text-pretty">
        <p class="m-0 max-w-[72ch] py-3 text-muted">{t('rules.guide.lede')}</p>
        <ul class="m-0 list-none p-0">
          {WITH_EXAMPLES.map((id) => (
            <Tip key={id} id={id}>
              <Examples good={t(`rules.guide.${id}.good`)} avoid={t(`rules.guide.${id}.avoid`)} />
            </Tip>
          ))}
          {PLAIN.map((id) => (
            <Tip key={id} id={id} />
          ))}
        </ul>
        <div class="border-t border-line pt-3">
          <Button variant="text" onClick={focusTryTitle}>
            {t('rules.guide.try')}
          </Button>
        </div>
      </div>
    </details>
  );
}

function Tip({ id, children }: { id: TipId; children?: ComponentChildren }) {
  return (
    <li class="grid gap-x-6 gap-y-1 border-t border-line py-3 @xl:grid-cols-[14rem_minmax(0,1fr)]">
      <span class="font-semibold">{t(`rules.guide.${id}.title`)}</span>
      <div class="grid gap-1">
        <p class="m-0 max-w-[72ch]">{t(`rules.guide.${id}.body`)}</p>
        {children}
      </div>
    </li>
  );
}

/** A Try and a Not example side by side. The words and icons tell them apart, not colour. */
function Examples({ good, avoid }: { good: string; avoid: string }) {
  return (
    <div class="grid gap-x-6 gap-y-1 @2xl:grid-cols-2">
      <p class="m-0 flex items-start gap-2">
        <Check size={16} strokeWidth={1.75} aria-hidden="true" class="mt-0.5 shrink-0" />
        <span>
          <span class="font-semibold">{t('rules.guide.good')}</span> {good}
        </span>
      </p>
      <p class="m-0 flex items-start gap-2 text-muted">
        <X size={16} strokeWidth={1.75} aria-hidden="true" class="mt-0.5 shrink-0" />
        <span>
          <span class="font-semibold">{t('rules.guide.avoid')}</span> {avoid}
        </span>
      </p>
    </div>
  );
}
