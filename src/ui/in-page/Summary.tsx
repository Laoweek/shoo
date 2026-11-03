// The batch summary in Auto mode and its collapsed pill (docs/spec/ui-design.md Section 4,
// "Batch summary").
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ColourCode } from '~/core/types';
import { t } from '~/i18n';
import { EyesSvg } from '../eyes/EyesSvg';
import { RuleTag, ruleLabel, type RuleNaming } from './parts';

export const SUMMARY_OPEN_MS = 6000;
export const SUMMARY_PILL_MS = 30000;
/** Rule rows the summary shows. With more Rules than this, one row less and a "+N more Rules" line. */
export const SUMMARY_ROWS = 3;

export interface SummaryRule extends RuleNaming {
  colour?: ColourCode;
  count: number;
}

export interface SummaryData {
  /** Activity batch the Review button filters to. */
  batchId: string;
  /** Removals in this summary (counts every Removal, also those whose square did not fly). */
  count: number;
  rules: readonly SummaryRule[];
  /** Channels an automatic Escalation added to Banned channels in this batch (REQ-ESC-2). */
  escalated?: readonly string[];
  /** YouTube's Undo is still available on this page. A function is asked at every render (expanding the pill too). */
  undoAvailable: boolean | (() => boolean);
  onReview: (batchId: string) => void;
  onUndoAll: (batchId: string) => void;
}

export interface BatchSummaryProps extends SummaryData {
  /** Count shown in the headline. Ticks up to `count` as the moment's squares arrive. */
  shown: number;
  /** A new number restarts the 6 s timer and reopens a collapsed summary (update, never stack). */
  generation: number;
  blinkKey: number;
  /** fade when the moment's squares carry the motion (their landing spots must not move). */
  entrance?: 'rise' | 'fade';
  /** The pill's 30 s ran out. */
  onGone: () => void;
}

/** Most Removals first, then in the order the Rules first acted (the sort is stable). */
const byCount = (rules: readonly SummaryRule[]) => [...rules].sort((a, b) => b.count - a.count);

/** "Shoo removed 4 videos: 2 by Reaction videos, 1 by Crypto, 1 by Hustle Daily." plus "Banned Hustle Daily too." */
export function summaryAnnouncement(data: Pick<SummaryData, 'count' | 'rules' | 'escalated'>): string {
  const items = byCount(data.rules).map((r) => t('summary.announceItem', { count: r.count, rule: ruleLabel(r) }));
  const list = new Intl.ListFormat(undefined, { type: 'unit' }).format(items);
  const said = t('summary.announce', data.count, { list });
  const banned = escalatedText(data.escalated);
  return banned ? `${said} ${banned}.` : said;
}

/** "Banned Hustle Daily too", or undefined when no Escalation happened. */
function escalatedText(channels: readonly string[] | undefined): string | undefined {
  if (!channels?.length) return undefined;
  return t('summary.escalated', { channels: new Intl.ListFormat(undefined, { type: 'conjunction' }).format(channels) });
}

/**
 * Batch summary: open for 6 s (paused while hovered or focused), then an eyes-and-count pill for
 * 30 s, then gone. Timers restart when `generation` changes.
 */
export function BatchSummary(props: BatchSummaryProps) {
  // Collapsed for one generation only: an update (new generation) reopens the summary in the same render.
  const [pillGen, setPillGen] = useState<number | null>(null);
  const phase = pillGen === props.generation ? 'pill' : 'open';
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const el = useRef<HTMLElement>(null);
  const remaining = useRef(SUMMARY_OPEN_MS);
  const seenGeneration = useRef(props.generation);
  const focusOnOpen = useRef(false);
  const gone = useRef(props.onGone);
  gone.current = props.onGone;

  // focusout does not fire when the focused node is removed (Firefox), so re-check after each render.
  useEffect(() => {
    const node = el.current;
    const active = node && (node.getRootNode() as ShadowRoot).activeElement;
    if (focused && !(active && node.contains(active))) setFocused(false);
  });

  // The pill had focus and was expanded: keep focus on the panel's first button.
  useEffect(() => {
    if (phase !== 'open' || !focusOnOpen.current) return;
    focusOnOpen.current = false;
    el.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }, [phase]);

  useEffect(() => {
    if (seenGeneration.current !== props.generation) {
      seenGeneration.current = props.generation;
      remaining.current = SUMMARY_OPEN_MS;
    }
    if (hovered || focused) return;
    if (phase === 'pill') {
      const id = setTimeout(() => gone.current(), SUMMARY_PILL_MS);
      return () => clearTimeout(id);
    }
    const start = Date.now();
    const id = setTimeout(() => setPillGen(props.generation), remaining.current);
    return () => {
      clearTimeout(id);
      remaining.current = Math.max(0, remaining.current - (Date.now() - start));
    };
  }, [phase, hovered, focused, props.generation]);

  const hold = {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
    onFocusIn: () => setFocused(true),
    onFocusOut: (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      if (!next || !(e.currentTarget as Node).contains(next)) setFocused(false);
    },
  };

  if (phase === 'pill') {
    return (
      <button
        ref={(n) => void (el.current = n)}
        type="button"
        class="pill"
        aria-label={`${t('summary.shooed', props.count)}. ${t('summary.expand')}`}
        {...hold}
        onClick={() => {
          focusOnOpen.current = focused;
          remaining.current = SUMMARY_OPEN_MS;
          setHovered(false);
          setPillGen(null);
        }}
      >
        <EyesSvg state="watching" width={22} />
        <span class="num">{props.count}</span>
      </button>
    );
  }

  const ordered = byCount(props.rules);
  const rows = ordered.length > SUMMARY_ROWS ? ordered.slice(0, SUMMARY_ROWS - 1) : ordered;
  const more = ordered.slice(rows.length);

  return (
    <section
      ref={(n) => void (el.current = n)}
      class={props.entrance === 'fade' ? 'panel fade' : 'panel'}
      aria-label={t('summary.label')}
      {...hold}
    >
      <div class="head">
        <EyesSvg state="watching" width={34} blinkKey={props.blinkKey} />
        <h2>{t('summary.shooed', props.shown)}</h2>
      </div>
      <ul class="rules">
        {rows.map((r) => (
          <li key={r.ruleRef}>
            <RuleTag ruleRef={r.ruleRef} ruleName={r.ruleName} ruleText={r.ruleText} colour={r.colour} />
            <span class="n num">{t('summary.times', { count: r.count })}</span>
          </li>
        ))}
        {more.length > 0 && (
          <li key="more" class="more">
            {/* Where the moment's squares for these Rules land (moment.ts), in line with the swatches above. */}
            <span class="sw" data-refs={more.map((r) => r.ruleRef).join(' ')} />
            {t('summary.more', more.length)}
          </li>
        )}
      </ul>
      {props.escalated?.length ? <p class="esc">{escalatedText(props.escalated)}</p> : null}
      <div class="foot">
        <button type="button" class="btn" onClick={() => props.onReview(props.batchId)}>
          {t('summary.review')}
        </button>
        {(typeof props.undoAvailable === 'function' ? props.undoAvailable() : props.undoAvailable) && (
          <button type="button" class="link" onClick={() => props.onUndoAll(props.batchId)}>
            {t('summary.undoAll')}
          </button>
        )}
      </div>
    </section>
  );
}
