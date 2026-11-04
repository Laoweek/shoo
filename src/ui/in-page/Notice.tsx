// In-page notices for failure streaks (docs/spec/ui-design.md Section 4, "Notices (in page)").
import { t } from '~/i18n';
import { EyesSvg } from '../eyes/EyesSvg';
import { siteName } from './site';

/** In-page notices, one per failure streak (architecture.md Section 7). */
export type InPageNoticeKind =
  | 'failureModel'
  | 'failureNativeAction'
  | 'breakerNativeAction'
  | 'breakerMarkup'
  | 'breakerModel'
  | 'creditsExhausted';

export interface InPageNoticeProps {
  kind: InPageNoticeKind;
  /** Videos affected, for failureNativeAction. */
  count?: number;
  /** The Site a breaker names, when another Site than this page's tripped it. */
  site?: string;
  /** The recovery: Open settings (Site breakers), Retry (model breaker), Open OpenRouter (credits). */
  onAction?: () => void;
  onDismiss: () => void;
}

/** A tripped category says "paused" and offers recovery. Before the trip the copy never says "paused". */
export const isTripped = (kind: InPageNoticeKind) => kind !== 'failureModel' && kind !== 'failureNativeAction';

export function noticeText(kind: InPageNoticeKind, count = 1, site = siteName()): string {
  switch (kind) {
    case 'failureModel':
      return t('notice.failureModel');
    case 'failureNativeAction':
      return t('notice.failureNativeAction', count, { site });
    case 'breakerNativeAction':
      return t('notice.breakerNativeAction', { site });
    case 'breakerMarkup':
      return t('notice.breakerMarkup', { site });
    case 'breakerModel':
      return t('notice.breakerModel');
    case 'creditsExhausted':
      return t('notice.creditsExhausted');
  }
}

function actionText(kind: InPageNoticeKind): string | undefined {
  if (kind === 'breakerNativeAction' || kind === 'breakerMarkup') return t('notice.action.openSettings');
  if (kind === 'breakerModel') return t('notice.action.retry');
  if (kind === 'creditsExhausted') return t('notice.action.openOpenRouter');
  return undefined;
}

export function InPageNotice(props: InPageNoticeProps) {
  const tripped = isTripped(props.kind);
  const action = actionText(props.kind);
  return (
    <section class="panel notice" aria-label={t('notice.label')}>
      <div class="head">
        <EyesSvg state="error" width={34} />
        <h2 class={tripped ? 'danger' : undefined}>{noticeText(props.kind, props.count, props.site)}</h2>
      </div>
      <div class="foot">
        {action && props.onAction && (
          <button type="button" class="btn" onClick={props.onAction}>
            {action}
          </button>
        )}
        <button type="button" class="link" onClick={props.onDismiss}>
          {t('common.dismiss')}
        </button>
      </div>
    </section>
  );
}
