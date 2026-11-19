// Popup screen states (docs/spec/ui-design.md Section 8, Popup) from the RuntimeSnapshot. The
// highest-precedence reason wins (architecture.md Section 7), so one notice shows at a time.
import { endpointBase, endpointHost } from '~/core/runtime';
import { SITE_NAMES, type SiteId } from '~/core/sites';
import type { RuntimeSnapshot, Settings } from '~/core/types';
import { t } from '~/i18n';

export type PopupFix = 'turnOn' | 'turnOnSite' | 'giveConsent' | 'fixInSettings' | 'openSites' | 'connect' | 'openSettings' | 'retry' | 'openOpenRouter';

export interface PopupNotice {
  /** The copy key's text. */
  text: string;
  tone: 'plain' | 'danger';
  fixes: { fix: PopupFix; label: string; category?: 'model' | 'nativeAction' | 'markup' }[];
  /** Assertive only when a failure category tripped. */
  live: 'status' | 'alert';
  /** Mode control and quick add are disabled. */
  blocking: boolean;
}

const fix = (f: PopupFix, category?: 'model' | 'nativeAction' | 'markup') => {
  const labels: Record<PopupFix, () => string> = {
    turnOn: () => t('popup.action.turnOn'),
    turnOnSite: () => t('popup.action.turnOn'),
    giveConsent: () => t('popup.action.giveConsent'),
    fixInSettings: () => t('popup.action.fixInSettings'),
    openSites: () => t('popup.action.fixInSettings'),
    connect: () => t('popup.action.connect'),
    openSettings: () => t('popup.action.openSettings'),
    retry: () => t('popup.action.retry'),
    openOpenRouter: () => t('popup.action.openOpenRouter'),
  };
  return { fix: f, label: labels[f](), ...(category ? { category } : {}) };
};

/** The notice for a snapshot, or undefined when Shoo is fine ('ok'). */
export function popupNotice(r: RuntimeSnapshot, settings: Settings | undefined): PopupNotice | undefined {
  const plain = (text: string, fixes: PopupNotice['fixes'] = [], blocking = false): PopupNotice => ({ text, tone: 'plain', fixes, live: 'status', blocking });
  const danger = (text: string, fixes: PopupNotice['fixes'], live: 'status' | 'alert' = 'status'): PopupNotice => ({ text, tone: 'danger', fixes, live, blocking: false });
  // With a direct or custom endpoint the failure is that host's, so the copy names it instead of OpenRouter.
  const base = settings && endpointBase(settings);
  const endpoint = base ? endpointHost(base) : undefined;
  switch (r.reason) {
    case 'ok':
      return undefined;
    case 'off':
      return plain(t('popup.state.off'), [fix('turnOn')], true);
    case 'noConsent':
      return plain(t('popup.state.noConsent'), [fix('giveConsent')]);
    case 'migrating':
      return plain(t('popup.state.migrating'), [], true);
    case 'hostRevoked':
      return danger(t('popup.state.hostRevoked'), [fix('fixInSettings')]);
    case 'noKey':
      if (r.detail === 'keyRejected' && endpoint) return danger(t('popup.state.endpointRejected', { host: endpoint }), [fix('fixInSettings')]);
      if (endpoint) return plain(t('popup.state.endpointNoKey', { host: endpoint }), [fix('fixInSettings')]);
      return r.detail === 'keyRejected' ? danger(t('notice.keyRejected'), [fix('connect')]) : plain(t('popup.state.noKey'), [fix('connect')]);
    case 'breakerNativeAction':
    case 'breakerMarkup':
      // REQ-COST-4: a tripped category offers Resume. The copy names the Site that changed (YouTube before Sites).
      return danger(t('popup.state.breakerSite', { site: SITE_NAMES[r.site ?? 'youtube'] }), [fix('retry', r.reason === 'breakerMarkup' ? 'markup' : 'nativeAction'), fix('openSettings')], 'alert');
    case 'breakerModel':
      if (r.detail === 'creditsExhausted' && endpoint) return danger(t('popup.state.noCreditsEndpoint', { host: endpoint }), [fix('retry', 'model')], 'alert');
      return r.detail === 'creditsExhausted'
        ? danger(t('popup.state.noCredits'), [fix('openOpenRouter'), fix('retry', 'model')], 'alert')
        : danger(endpoint ? t('popup.state.breakerEndpoint', { host: endpoint }) : t('popup.state.breakerModel'), [fix('retry', 'model')], 'alert');
    case 'dailyCap':
      return plain(t('popup.state.dailyCap', { cap: new Intl.NumberFormat('en').format(settings?.dailyCap ?? 0) }));
    case 'offline':
      return plain(t('popup.state.offline'));
  }
}

/**
 * A Site's notice when Shoo itself is fine: the tab's Site is turned off, or the user took away Shoo's access to a Site
 * that is still on (`blocked`). Undefined when neither holds.
 */
export function siteNotice(site: SiteId | undefined, settings: Settings | undefined, blocked: readonly SiteId[]): PopupNotice | undefined {
  if (!settings) return undefined;
  if (site && !settings.sites[site]) return { text: t('popup.state.siteOff', { site: SITE_NAMES[site] }), tone: 'plain', fixes: [fix('turnOnSite')], live: 'status', blocking: false };
  const lost = blocked.find((b) => settings.sites[b]);
  if (lost) return { text: t('popup.state.noSiteAccess', { site: SITE_NAMES[lost] }), tone: 'danger', fixes: [fix('openSites')], live: 'status', blocking: false };
  return undefined;
}

/** Settings section each fix opens ('' opens Settings at its first section). */
export const FIX_SECTION: Partial<Record<PopupFix, string>> = {
  giveConsent: 'connection',
  fixInSettings: 'connection',
  openSites: 'sites',
  connect: 'connection',
  openSettings: '',
};
