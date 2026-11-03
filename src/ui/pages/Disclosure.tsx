// What Shoo sends (REQ-PRIV-1, docs/spec/ui-design.md Section 7): the consent disclosure as four
// ruled rows, shared by onboarding step 1 and Settings, Connection. The rows carry every fact of the
// consent and nothing else, so changing a row changes what the user agreed to.
import type { LucideIcon } from 'lucide-preact';
import { Check, CircleUserRound, Clock3, CornerDownRight, EyeOff, FileText, Globe, Image, LayoutGrid, ListChecks, Send, Server, SquarePlay, Type, X } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { t } from '~/i18n';

type Level = 3 | 4;

// Rows go side by side once the disclosure itself is 36rem wide (a container query), so the narrow
// custom endpoint callout in Settings stacks them like a phone does.
function Row({ icon: Icon, title, level, children }: { icon: LucideIcon; title: string; level: Level; children: ComponentChildren }) {
  const H = `h${level}` as const;
  return (
    <div class="grid gap-x-6 gap-y-2 border-b border-line py-3 last:border-b-0 @xl:grid-cols-[11rem_1fr]">
      <H class="m-0 flex items-start gap-2 font-semibold">
        <Icon size={16} strokeWidth={1.75} aria-hidden="true" class="mt-[2px] shrink-0" />
        {title}
      </H>
      {children}
    </div>
  );
}

function Line({ icon: Icon, children }: { icon: LucideIcon; children: ComponentChildren }) {
  return (
    <>
      <Icon size={16} strokeWidth={1.75} aria-hidden="true" class="mt-[2px] shrink-0 text-muted" />
      <span>{children}</span>
    </>
  );
}

function Item({ icon, children }: { icon: LucideIcon; children: ComponentChildren }) {
  return (
    <li class="flex items-start gap-2">
      <Line icon={icon}>{children}</Line>
    </li>
  );
}

// Recipients through OpenRouter, then the recipients that replace OpenRouter when the user picks one.
const VIA_OPENROUTER = [
  ['cloudflare', 'cloudflareWhen'],
  ['typeSafe', 'typeSafeWhen'],
  ['openAi', 'openAiWhen'],
  ['otherModel', 'otherModelWhen'],
] as const;
const INSTEAD = [
  ['direct', 'directWhen'],
  ['local', 'localWhen'],
  ['custom', 'customWhen'],
] as const;

function Recipients({ list }: { list: typeof VIA_OPENROUTER | typeof INSTEAD }) {
  const r = 'onboarding.what.sends.recipients';
  return (
    <ul class="m-0 grid list-none gap-1 p-0 pl-6">
      {list.map(([name, when]) => (
        <Item key={name} icon={CornerDownRight}>
          <span class="font-semibold">{t(`${r}.${name}`)}</span> {t(`${r}.${when}`)}
        </Item>
      ))}
    </ul>
  );
}

/**
 * The disclosure rows. `level` is the heading level of each row title (4 under an h3 such as
 * "What Shoo sends"). `compact` is the Settings text size.
 */
export function Disclosure({ level = 4, compact = false, class: cls = '' }: { level?: Level; compact?: boolean; class?: string }) {
  const list = 'm-0 list-none p-0';
  const r = 'onboarding.what.sends.recipients';
  return (
    <div class={`@container ${compact ? 'text-[13px] leading-[1.5]' : 'text-[14px] leading-[1.55]'} ${cls}`}>
      <Row icon={SquarePlay} title={t('onboarding.what.sends.perVideo.title')} level={level}>
        <ul class={`${list} flex flex-wrap gap-x-4 gap-y-1`}>
          <Item icon={Type}>{t('onboarding.what.sends.perVideo.videoTitle')}</Item>
          <Item icon={CircleUserRound}>{t('onboarding.what.sends.perVideo.channel')}</Item>
          <Item icon={Clock3}>{t('onboarding.what.sends.perVideo.length')}</Item>
          <Item icon={LayoutGrid}>{t('onboarding.what.sends.perVideo.surface')}</Item>
          <Item icon={Image}>{t('onboarding.what.sends.perVideo.thumbnail')}</Item>
        </ul>
      </Row>
      <Row icon={FileText} title={t('onboarding.what.sends.request.title')} level={level}>
        <ul class={`${list} grid gap-1`}>
          <Item icon={ListChecks}>{t('onboarding.what.sends.request.rules')}</Item>
          <Item icon={Check}>{t('onboarding.what.sends.request.kept')}</Item>
        </ul>
      </Row>
      {/* OpenRouter and "Instead of OpenRouter" are peers, each with its recipients under it
          (REQ-PRIV-1: the direct, local and custom recipients replace OpenRouter, they never add to it). */}
      <Row icon={Send} title={t(`${r}.title`)} level={level}>
        <div class="grid gap-1">
          <p class="m-0 flex items-start gap-2">
            <Line icon={Globe}>
              <span class="font-semibold">{t(`${r}.openRouter`)}</span> {t(`${r}.openRouterWhen`)}
            </Line>
          </p>
          <Recipients list={VIA_OPENROUTER} />
          <p class="m-0 flex items-start gap-2">
            <Line icon={Server}>
              <span class="font-semibold">{t(`${r}.instead`)}</span> {t(`${r}.insteadWhen`)}
            </Line>
          </p>
          <Recipients list={INSTEAD} />
        </div>
      </Row>
      <Row icon={EyeOff} title={t('onboarding.what.sends.never.title')} level={level}>
        <ul class={`${list} flex flex-wrap gap-x-4 gap-y-1`}>
          <Item icon={X}>{t('onboarding.what.sends.never.urls')}</Item>
          <Item icon={X}>{t('onboarding.what.sends.never.ids')}</Item>
          <Item icon={X}>{t('onboarding.what.sends.never.history')}</Item>
          <Item icon={X}>{t('onboarding.what.sends.never.cookies')}</Item>
          <Item icon={X}>{t('onboarding.what.sends.never.comments')}</Item>
          <Item icon={X}>{t('onboarding.what.sends.never.page')}</Item>
          <Item icon={X}>{t('onboarding.what.sends.never.account')}</Item>
        </ul>
      </Row>
    </div>
  );
}
