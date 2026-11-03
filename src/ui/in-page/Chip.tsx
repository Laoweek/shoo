// The Review chip in Review mode, full or compact, then its kept note (docs/spec/ui-design.md
// Section 4, "Review chip").
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ColourCode } from '~/core/types';
import { t } from '~/i18n';
import { EyesSvg } from '../eyes/EyesSvg';
import { percent } from '../format';
import { BanIcon, CheckIcon, UserCheckIcon } from './icons';
import { RuleTag, ruleLabel, type RuleNaming } from './parts';

export const KEPT_NOTE_MS = 4000;

export interface ChipProps extends RuleNaming {
  /** full when the thumbnail anchor is at least 320 px wide, compact below that (COMPACT_BELOW_PX in src/youtube/mount.ts). */
  variant: 'full' | 'compact';
  colour?: ColourCode;
  /** P(remove) 0..1 for model Verdicts. Omitted for Exact rules. */
  probability?: number;
  /** False on the Shorts shelf (no channel): hides "Always keep this channel". */
  hasChannel: boolean;
  /** Private window: the note reads "Kept for this session" and nothing is stored, so no channel button. */
  privateWindow?: boolean;
  /** Max width in px: thumbnail anchor width minus 16. */
  maxWidth?: number;
  onRemove: () => void;
  /** Called on Keep. The chip then shows the kept note for 4 s. */
  onKeep: () => void;
  onAlwaysKeepChannel: () => void;
  /** Esc inside the chip. The caller returns focus to the Tile's title link. */
  onEscape: () => void;
  /** The kept note ended. hadFocus tells the caller to move focus to the title link. */
  onNoteDone?: (hadFocus: boolean) => void;
}

/** Accessible name: "Shoo: Remove? Rule: Reaction videos, 88 percent". */
function chipName(p: RuleNaming & Pick<ChipProps, 'probability'>): string {
  return p.probability === undefined
    ? t('chip.labelExact', { rule: ruleLabel(p) })
    : t('chip.label', { rule: ruleLabel(p), p: percent(p.probability) });
}

export function Chip(props: ChipProps) {
  const [kept, setKept] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const focusWasInside = useRef(false);
  const done = useRef(props.onNoteDone);
  done.current = props.onNoteDone;

  useEffect(() => {
    if (!kept) return;
    // The Keep button is gone. Keep focus on the note so it is not lost to the page.
    if (focusWasInside.current) root.current?.focus({ preventScroll: true });
    const id = setTimeout(() => {
      const el = root.current;
      done.current?.(!!el && (el.getRootNode() as ShadowRoot).activeElement !== null);
    }, KEPT_NOTE_MS);
    return () => clearTimeout(id);
  }, [kept]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    props.onEscape();
  };
  const style = props.maxWidth ? `max-width:${props.maxWidth}px` : undefined;
  const compact = props.variant === 'compact';

  if (kept) {
    const showChannel = props.hasChannel && !props.privateWindow;
    const note = props.privateWindow ? t('chip.kept.session') : t('chip.kept.note');
    // Compact: "Kept" and an icon button on one row, the full sentence and button name stay for screen readers.
    return (
      <div ref={root} class={compact ? 'chip compact' : 'chip'} role="status" tabIndex={-1} style={style} onKeyDown={onKeyDown}>
        <EyesSvg state="watching" width={22} />
        {compact ? (
          <span class="note">
            <span class="sr">{note}</span>
            <span aria-hidden="true">{t('chip.kept.short')}</span>
          </span>
        ) : (
          <span class="note">{note}</span>
        )}
        {showChannel &&
          (compact ? (
            <button type="button" class="ib" aria-label={t('common.keepChannel')} title={t('common.keepChannel')} onClick={props.onAlwaysKeepChannel}>
              <UserCheckIcon />
            </button>
          ) : (
            <button type="button" class="link" onClick={props.onAlwaysKeepChannel}>
              {t('common.keepChannel')}
            </button>
          ))}
      </div>
    );
  }

  const keep = () => {
    focusWasInside.current = (root.current?.getRootNode() as ShadowRoot | undefined)?.activeElement != null;
    props.onKeep();
    setKept(true);
  };

  return (
    <div
      ref={root}
      class={compact ? 'chip compact' : 'chip'}
      role="group"
      aria-label={chipName(props)}
      style={style}
      onKeyDown={onKeyDown}
    >
      <EyesSvg state="watching" width={22} glanceKey={1} glance={{ x: 1.7, y: -2.2 }} />
      {compact ? (
        <>
          <RuleTag ruleRef={props.ruleRef} ruleName={props.ruleName} ruleText={props.ruleText} colour={props.colour} hidden />
          <span class="acts">
            <button type="button" class="ib solid" aria-label={t('chip.removeLabel')} onClick={props.onRemove}>
              <BanIcon />
            </button>
            <button type="button" class="ib" aria-label={t('chip.keepLabel')} onClick={keep}>
              <CheckIcon />
            </button>
          </span>
        </>
      ) : (
        <>
          <span class="what" aria-hidden="true">
            <b>{t('chip.question')}</b>
            <RuleTag ruleRef={props.ruleRef} ruleName={props.ruleName} ruleText={props.ruleText} colour={props.colour} />
            {props.probability !== undefined && (
              <span class="muted num">{t('verdict.percent', { p: percent(props.probability) })}</span>
            )}
          </span>
          <span class="acts">
            <button type="button" class="btn solid" aria-label={t('chip.removeLabel')} onClick={props.onRemove}>
              {t('chip.remove')}
            </button>
            <button type="button" class="btn" aria-label={t('chip.keepLabel')} onClick={keep}>
              {t('chip.keep')}
            </button>
          </span>
        </>
      )}
    </div>
  );
}
