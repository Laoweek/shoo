// Sites (docs/spec/ui-design.md Section 6, REQ-SITE-1): each Site with its switch, then its Surfaces and any
// Shelf dismissal switches. A Site whose host access the user took away in the browser shows why, with Allow access.
import { useState } from 'preact/hooks';
import { SITE_IDS, SITE_NAMES, SURFACE_SITE, type SiteId } from '~/core/sites';
import { SHELF_IDS, SUPPORTED_SURFACES, SURFACE_IDS, type Settings, type ShelfId, type SurfaceId } from '~/core/types';
import { t } from '~/i18n';
import { Notice, SkeletonRows, Switch } from '~/ui/components';
import { hasSiteAccess, requestSiteAccess, watchPermissions } from '~/ui/pages/consent';
import { surfaceLabel } from '~/ui/pages/format';
import { useAsync } from '~/ui/pages/hooks';
import { SectionHead, SettingRow, Status } from '~/ui/pages/parts';
import type { SectionProps } from '../context';
import { patchSettings } from './Connection';

/** The Site whose Home shows each Shelf (youtube-integration.md Section 10). */
const SHELF_SITE: Record<ShelfId, SiteId> = { shorts: 'youtube', games: 'youtube' };

export function Sites({ data }: SectionProps) {
  const s = data.settings;
  const [failed, setFailed] = useState(false);
  const patch = (p: Partial<Settings>) => void patchSettings(p).then((ok) => setFailed(!ok));

  return (
    <section aria-labelledby="section-sites">
      <SectionHead id="section-sites" title={t('sites.title')} lede={t('sites.lede')} />
      {data.loadError ? (
        <Notice tone="danger" live="alert">
          {t('settings.error.load')}
        </Notice>
      ) : !s ? (
        <SkeletonRows rows={6} />
      ) : (
        <div class="grid gap-8">
          <Status tone="danger" class="empty:absolute">{failed ? t('connection.error.save') : ''}</Status>
          {SITE_IDS.map((site) => (
            <SiteGroup key={site} site={site} settings={s} patch={patch} />
          ))}
        </div>
      )}
    </section>
  );
}

function SiteGroup({ site, settings, patch }: { site: SiteId; settings: Settings; patch: (p: Partial<Settings>) => void }) {
  const access = useAsync(() => hasSiteAccess(site), [watchPermissions], [site]);
  const [denied, setDenied] = useState(false);
  const on = settings.sites[site];
  const labelId = `site-${site}`;
  // permissions.request must be the click handler's first statement (Firefox, cross-browser-and-stores.md §2).
  const allow = () => {
    const asked = requestSiteAccess(site);
    void asked.then((granted) => setDenied(!granted), () => setDenied(true));
  };
  const name = SITE_NAMES[site];

  return (
    <div class="card px-5 pb-1">
      <div class="[&>div]:border-line-strong">
        <SettingRow label={<span class="text-[15px] font-bold">{name}</span>} labelId={labelId} hint={on ? t('sites.on', { site: name }) : t('sites.off', { site: name })}>
          <Switch checked={on} labelledBy={labelId} onChange={(v) => patch({ sites: { ...settings.sites, [site]: v } })} />
        </SettingRow>
      </div>
      {access.data === false && (
        <Notice tone="danger" class="mt-3" actions={[{ label: t('sites.allowAccess'), onClick: allow }]}>
          {denied ? t('sites.denied', { site: name }) : t('sites.noAccess', { site: name })}
        </Notice>
      )}
      <div class="pl-6 [&>:last-child]:border-b-0">
        {SURFACE_IDS.filter((id) => SURFACE_SITE[id] === site).map((id) => (
          <SurfaceRow key={id} id={id} siteOn={on} settings={settings} patch={patch} />
        ))}
      </div>
      <Shelves site={site} siteOn={on} settings={settings} patch={patch} />
    </div>
  );
}

/** Shelf dismissal per Shelf on this Site's Home (youtube-integration.md Section 10). */
function Shelves({ site, siteOn, settings, patch }: { site: SiteId; siteOn: boolean; settings: Settings; patch: (p: Partial<Settings>) => void }) {
  const shelves = SHELF_IDS.filter((id) => SHELF_SITE[id] === site);
  if (shelves.length === 0) return null;
  const on = settings.shelfDismissal ?? {};
  return (
    <div class="pl-6 [&>:last-child]:border-b-0">
      <div class="flex items-baseline justify-between gap-3 border-b border-line pt-4 pb-2">
        <h3 class="m-0 text-[14px] font-semibold">{t('settings.shelves.title')}</h3>
        <span class="text-[12px] text-muted">{t('settings.shelves.hint')}</span>
      </div>
      {shelves.map((id) => {
        const labelId = `shelf-${id}`;
        return (
          <SettingRow key={id} label={<span class={siteOn ? '' : 'text-muted'}>{t(`settings.shelves.${id}`)}</span>} labelId={labelId} hint={t(`settings.shelves.${id}Hint`)}>
            <Switch checked={on[id] === true} disabled={!siteOn} labelledBy={labelId} onChange={(v) => patch({ shelfDismissal: { ...on, [id]: v } })} />
          </SettingRow>
        );
      })}
    </div>
  );
}

function SurfaceRow({ id, siteOn, settings, patch }: { id: SurfaceId; siteOn: boolean; settings: Settings; patch: (p: Partial<Settings>) => void }) {
  const supported = SUPPORTED_SURFACES.includes(id);
  const labelId = `surface-${id}`;
  const hint = !supported ? t('settings.surfaces.unsupported', { site: SITE_NAMES[SURFACE_SITE[id]] }) : id === 'shortsShelf' ? t('settings.surfaces.shortsNote') : undefined;
  return (
    <SettingRow label={<span class={siteOn ? '' : 'text-muted'}>{surfaceLabel(id)}</span>} labelId={labelId} hint={hint}>
      <Switch
        checked={supported && settings.surfaces[id]}
        disabled={!supported || !siteOn}
        labelledBy={labelId}
        onChange={(v) => patch({ surfaces: { ...settings.surfaces, [id]: v } })}
      />
    </SettingRow>
  );
}
