// The removed-Tile annotation over YouTube's placeholder (docs/spec/ui-design.md Section 4,
// "Removed-Tile annotation").
import { useEffect, useRef } from 'preact/hooks';
import type { ColourCode } from '~/core/types';
import { t } from '~/i18n';
import { EyesSvg } from '../eyes/EyesSvg';
import { UserCheckIcon } from './icons';
import { RuleTag, ruleLabel, type RuleNaming } from './parts';

export interface AnnotationProps extends RuleNaming {
  colour?: ColourCode;
  /** False on the Shorts shelf: hides "Always keep this channel". */
  hasChannel: boolean;
  /** A duplicate copy of a video already removed higher on the page: "Already shooed above", no actions. */
  duplicate?: boolean;
  /** YouTube's placeholder is the "Don't recommend channel" one: the line says the channel was shooed. */
  channel?: boolean;
  /** The removed video's title. YouTube's placeholder does not say what it replaced, so a second line does. */
  title?: string;
  /** Its channel name when the Tile showed one (never on the Shorts shelf). */
  channelName?: string;
  /** Keep: the caller undoes through YouTube's Undo, then stores an Exception. */
  onKeep?: () => void;
  onAlwaysKeepChannel?: () => void;
  /**
   * Move focus to Keep when mounted. Use it when focus was on the Review chip that YouTube's
   * placeholder just replaced, so focus does not drop to <body>.
   */
  focusKeep?: boolean;
}

/**
 * Over the empty top band of YouTube's own placeholder. Line one: eyes, "Shooed by", swatch and Rule label, Keep,
 * Always keep this channel. The Rule label is what shrinks. On narrow placeholders a container query keeps it on one
 * line: the channel action becomes its user-check icon, then "Shooed by" goes (components.css). Line two names what
 * was removed: the title, then the channel, or the channel first on the "Don't recommend channel" placeholder. It
 * stays one line with an ellipsis and the full text as a tooltip. Where the placeholder has no room for two lines
 * (src/youtube/mount.ts, data-tight) the title moves into line one instead of "Shooed by", or goes on the channel
 * placeholder (components.css). Names stay whole for screen readers. "Already shooed above" sits on a Tile whose own
 * title still shows, so it has no second line.
 */
export function RemovedAnnotation(props: AnnotationProps) {
  const named = { rule: ruleLabel(props) };
  const title = props.duplicate ? '' : (props.title ?? '').trim();
  const channelName = props.duplicate ? '' : (props.channelName ?? '').trim();
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (props.focusKeep) keep.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div class={props.duplicate ? 'annot dup' : props.channel ? 'annot chan' : 'annot'}>
      <span class="sr">{srLabel(props, named, title, channelName)}</span>
      <EyesSvg state="watching" width={22} />
      <span class="by" aria-hidden="true">
        {props.duplicate ? t('annotation.duplicate') : props.channel ? t('annotation.channelShooedBy') : t('annotation.shooedBy')}
      </span>
      <RuleTag ruleRef={props.ruleRef} ruleName={props.ruleName} ruleText={props.ruleText} colour={props.colour} hidden />
      {!props.duplicate && props.onKeep && (
        <button ref={keep} type="button" class="link" aria-label={t('chip.keepLabel')} onClick={props.onKeep}>
          {t('common.keep')}
        </button>
      )}
      {!props.duplicate && props.hasChannel && props.onAlwaysKeepChannel && (
        <button type="button" class="link ch" aria-label={t('common.keepChannel')} title={t('common.keepChannel')} onClick={props.onAlwaysKeepChannel}>
          <span class="tx">{t('common.keepChannel')}</span>
          <span class="ib" aria-hidden="true">
            <UserCheckIcon />
          </span>
        </button>
      )}
      {(title || channelName) && <VideoLine title={title} channelName={channelName} channelFirst={!!props.channel} />}
    </div>
  );
}

function srLabel(props: AnnotationProps, named: { rule: string }, title: string, channel: string): string {
  if (props.duplicate) return t('annotation.duplicateLabel', named);
  if (props.channel) {
    if (channel && title) return t('annotation.channelNamedLabel', { ...named, channel, title });
    if (channel) return t('annotation.channelOnlyLabel', { ...named, channel });
    return title ? t('annotation.channelTitledLabel', { ...named, title }) : t('annotation.channelLabel', named);
  }
  if (title && channel) return t('annotation.titledChannelLabel', { ...named, title, channel });
  return title ? t('annotation.titledLabel', { ...named, title }) : t('annotation.label', named);
}

/**
 * Line two: what was shooed (ink), then its context (muted): the title then the channel, or the channel first when the
 * whole channel was shooed. Each name is its own bidi run (dir=auto), so an RTL title never reorders the separator or
 * the other name. The sr sentence carries the names, so the line itself is hidden from screen readers.
 */
function VideoLine({ title, channelName, channelFirst }: { title: string; channelName: string; channelFirst: boolean }) {
  const names = [
    { text: title, cls: '' },
    { text: channelName, cls: 'chn' },
  ].filter((n) => n.text);
  if (channelFirst) names.reverse();
  const [lead, context] = names as [{ text: string; cls: string }, { text: string; cls: string } | undefined];
  return (
    <span class="vid" aria-hidden="true" title={context ? t('annotation.nameAndContext', { name: lead.text, context: context.text }) : lead.text}>
      <bdi dir="auto" class={`nm ${lead.cls}`.trim()}>
        {lead.text}
      </bdi>
      {context && <span class="sep" />}
      {context && (
        <bdi dir="auto" class={context.cls || undefined}>
          {context.text}
        </bdi>
      )}
    </span>
  );
}
