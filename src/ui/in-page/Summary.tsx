// The batch summary in Auto mode and its collapsed pill (docs/spec/ui-design.md Section 4,
// "Batch summary").
import { Component } from 'preact';
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

interface SummaryState {
  /** Collapsed for one generation only: an update (new generation) reopens the summary in the same render. */
  pillGen: number | null;
  hovered: boolean;
  focused: boolean;
}

const phaseOf = (state: SummaryState, props: BatchSummaryProps) => (state.pillGen === props.generation ? 'pill' : 'open');

/**
 * Batch summary: open for 6 s (paused while hovered or focused), then an eyes-and-count pill for
 * 30 s, then gone. Timers restart when `generation` changes.
 */
export class BatchSummary extends Component<BatchSummaryProps, SummaryState> {
  override state: SummaryState = { pillGen: null, hovered: false, focused: false };
  private el: HTMLElement | null = null;
  private remaining = SUMMARY_OPEN_MS;
  private seenGeneration = this.props.generation;
  private focusOnOpen = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** When the open timer started, or null while the pill's timer runs. */
  private openSince: number | null = null;

  override componentDidMount(): void {
    this.startTimer();
  }

  override componentDidUpdate(prevProps: BatchSummaryProps, prev: SummaryState): void {
    const { state, props } = this;
    // focusout does not fire when the focused node is removed (Firefox), so re-check after each render.
    const active = this.el && (this.el.getRootNode() as ShadowRoot).activeElement;
    if (state.focused && !(active && this.el?.contains(active))) this.setState({ focused: false });

    const phase = phaseOf(state, props);
    const phaseChanged = phase !== phaseOf(prev, prevProps);
    // The pill had focus and was expanded: keep focus on the panel's first button.
    if (phaseChanged && phase === 'open' && this.focusOnOpen) {
      this.focusOnOpen = false;
      this.el?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    }
    if (phaseChanged || state.hovered !== prev.hovered || state.focused !== prev.focused || props.generation !== prevProps.generation) {
      this.stopTimer();
      this.startTimer();
    }
  }

  override componentWillUnmount(): void {
    this.stopTimer();
  }

  private startTimer(): void {
    const { state, props } = this;
    if (this.seenGeneration !== props.generation) {
      this.seenGeneration = props.generation;
      this.remaining = SUMMARY_OPEN_MS;
    }
    if (state.hovered || state.focused) return;
    if (phaseOf(state, props) === 'pill') {
      this.timer = setTimeout(() => this.props.onGone(), SUMMARY_PILL_MS);
      return;
    }
    this.openSince = Date.now();
    this.timer = setTimeout(() => this.setState({ pillGen: this.props.generation }), this.remaining);
  }

  /** Also when the open timer ran out, so `remaining` is spent before a hover pauses the pill. */
  private stopTimer(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.openSince !== null) this.remaining = Math.max(0, this.remaining - (Date.now() - this.openSince));
    this.openSince = null;
  }

  private setEl = (n: HTMLElement | null) => {
    this.el = n;
  };

  private hold = {
    onMouseEnter: () => this.setState({ hovered: true }),
    onMouseLeave: () => this.setState({ hovered: false }),
    onFocusIn: () => this.setState({ focused: true }),
    onFocusOut: (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      if (!next || !(e.currentTarget as Node).contains(next)) this.setState({ focused: false });
    },
  };

  private expand = () => {
    this.focusOnOpen = this.state.focused;
    this.remaining = SUMMARY_OPEN_MS;
    this.setState({ hovered: false, pillGen: null });
  };

  override render() {
    const { props, hold } = this;
    if (phaseOf(this.state, props) === 'pill') {
      return (
        <button
          ref={this.setEl}
          type="button"
          class="pill"
          aria-label={`${t('summary.shooed', props.count)}. ${t('summary.expand')}`}
          {...hold}
          onClick={this.expand}
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
        ref={this.setEl}
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
}
