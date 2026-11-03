// In-page notices, one per failure streak (docs/spec/architecture.md Section 7, ui-design.md Section 4).
// The background owns the failure counters and decides when a category trips. Content shows:
// - before a trip: failureModel (a judgeTiles reply holds Tiles left undecided by a model failure) and
//   failureNativeAction (a Native action failed in this tab, the count grows within the streak). Never "paused".
// - after a trip: the tripped kind from the RuntimeSnapshot, which replaces any pre-trip notice.
// A streak ends when its category succeeds again or the snapshot leaves the tripped reason. A dismissed notice
// stays dismissed until its streak ends. The daily cap, offline, noKey and noConsent states have no in-page
// notice: the popup and the toolbar icon show them (the in-page notice kinds in ui/in-page/Notice.tsx).
import type { InPageNoticeKind } from '~/ui/in-page';
import type { ReasonCode, RuntimeSnapshot } from '~/core/types';
import type { PageUi } from './ui';

/** Per-Tile reasons that mean "the model was asked and failed" (counted as a model failure by the background). */
export const MODEL_FAILURE_REASONS: ReadonlySet<ReasonCode> = new Set(['modelError', 'rateLimited', 'apiShapeChanged']);

export const OPENROUTER_CREDITS_URL = 'https://openrouter.ai/settings/credits';

export interface NoticeActions {
  openSettings(): void;
  retryModel(): void;
  openOpenRouter(): void;
}

export function trippedKind(s: RuntimeSnapshot): InPageNoticeKind | null {
  switch (s.reason) {
    case 'breakerNativeAction':
      return 'breakerNativeAction';
    case 'breakerMarkup':
      return 'breakerMarkup';
    case 'breakerModel':
      return s.detail === 'creditsExhausted' ? 'creditsExhausted' : 'breakerModel';
    default:
      return null;
  }
}

export interface Notices {
  fromSnapshot(s: RuntimeSnapshot): void;
  modelFailed(): void;
  modelOk(): void;
  nativeFailed(): void;
  nativeOk(): void;
  /** Shoo turned off: hide and forget every streak. */
  reset(): void;
  readonly showing: InPageNoticeKind | null;
}

export function createNotices(ui: PageUi, actions: NoticeActions): Notices {
  let showing: InPageNoticeKind | null = null;
  let tripped: InPageNoticeKind | null = null;
  let modelStreak = false;
  let nativeCount = 0;
  const dismissed = new Set<InPageNoticeKind>();

  const onAction = (kind: InPageNoticeKind): (() => void) | undefined => {
    if (kind === 'breakerNativeAction' || kind === 'breakerMarkup') return actions.openSettings;
    if (kind === 'breakerModel') return actions.retryModel;
    if (kind === 'creditsExhausted') return actions.openOpenRouter;
    return undefined;
  };

  function show(kind: InPageNoticeKind, count?: number): void {
    if (dismissed.has(kind)) return;
    showing = kind;
    ui.notice({
      kind,
      count,
      onAction: onAction(kind),
      onDismiss: () => {
        dismissed.add(kind);
        if (showing === kind) showing = null;
      },
    });
  }

  function hide(kind: InPageNoticeKind): void {
    dismissed.delete(kind);
    if (showing !== kind) return;
    showing = null;
    ui.hideNotice();
  }

  return {
    get showing() {
      return showing;
    },
    fromSnapshot(s) {
      const next = trippedKind(s);
      if (next === tripped) return;
      if (tripped) hide(tripped);
      // Leaving a tripped reason ends that category's pre-trip streak too: a new streak gets its own notice.
      if (tripped === 'breakerModel' || tripped === 'creditsExhausted') {
        modelStreak = false;
        dismissed.delete('failureModel');
      }
      if (tripped === 'breakerNativeAction') {
        nativeCount = 0;
        dismissed.delete('failureNativeAction');
      }
      tripped = next;
      if (next) show(next);
    },
    modelFailed() {
      if (modelStreak) return;
      modelStreak = true;
      if (!tripped) show('failureModel');
    },
    modelOk() {
      if (!modelStreak) return;
      modelStreak = false;
      hide('failureModel');
    },
    nativeFailed() {
      nativeCount += 1;
      if (!tripped) show('failureNativeAction', nativeCount);
    },
    nativeOk() {
      if (nativeCount === 0) return;
      nativeCount = 0;
      hide('failureNativeAction');
    },
    reset() {
      if (showing) ui.hideNotice();
      showing = tripped = null;
      modelStreak = false;
      nativeCount = 0;
      dismissed.clear();
    },
  };
}
