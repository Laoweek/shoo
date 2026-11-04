// Settings (options page, opens in a tab). Two columns: a 248 px section index on the bare ground, the current section
// a raised paper pill, and the main column (max 960 px). URL hash routing per section (docs/spec/ui-design.md Section 6).
// Pages never write storage: every change is a message to the background.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { isBannedChannel } from '~/core/rules';
import { t } from '~/i18n';
import { sendMessage } from '~/messaging/protocol';
import { readExceptions, readRules, readSettings, watchExceptions, watchRules, watchSettings } from '~/store/read';
import { SkeletonRows, Wordmark } from '~/ui/components';
import { hasConsent, keyState } from '~/ui/pages/consent';
import { useAsync, useRuntime } from '~/ui/pages/hooks';
import { SECTIONS, parseHash, type Route, type Section } from '~/ui/pages/nav';
import { EyesControl, type PageData } from './context';
import { Activity } from './sections/Activity';
import { Advanced } from './sections/Advanced';
import { Banned } from './sections/Banned';
import { Connection } from './sections/Connection';
import { Exceptions } from './sections/Exceptions';
import { Keep } from './sections/Keep';
import { Rules } from './sections/Rules';
import { Sites } from './sections/Sites';

const NAV_LABEL: Record<Section, () => string> = {
  rules: () => t('settings.nav.rules'),
  keep: () => t('settings.nav.keep'),
  banned: () => t('settings.nav.banned'),
  exceptions: () => t('settings.nav.exceptions'),
  activity: () => t('settings.nav.activity'),
  sites: () => t('settings.nav.sites'),
  connection: () => t('settings.nav.connection'),
  advanced: () => t('settings.nav.advanced'),
};

const VIEWS = { rules: Rules, keep: Keep, banned: Banned, exceptions: Exceptions, activity: Activity, sites: Sites, connection: Connection, advanced: Advanced };

export function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  const settings = useAsync(() => readSettings(), [watchSettings]);
  const rules = useAsync(() => readRules(), [watchRules]);
  const exceptions = useAsync(() => readExceptions(), [watchExceptions]);
  const runtime = useRuntime();
  const key = useAsync(() => sendMessage('getKeyUsage'), []);
  const [reading, setReading] = useState(false);
  const [wide, setWide] = useState(false);
  const heading = useRef(false);

  useEffect(() => {
    const onHash = () => {
      heading.current = true;
      setRoute(parseHash(location.hash));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Move focus to the new section's heading after in-page navigation (not on first load).
  useEffect(() => {
    if (!heading.current) return;
    heading.current = false;
    document.getElementById(`section-${route.section}`)?.focus();
    window.scrollTo?.({ top: 0 });
  }, [route.section, route.params.toString()]);

  // Onboarding not finished: resume it where the user left (ui-design.md Section 7).
  const onboardingOpen = settings.data !== undefined && settings.data.onboarding !== undefined && !settings.data.onboarding.done;
  useEffect(() => {
    if (onboardingOpen) location.replace(browser.runtime.getURL('/onboarding.html'));
  }, [onboardingOpen]);

  const consent = hasConsent(settings.data);
  // Key presence: the runtime says noKey (missing or rejected) when nothing outranks it, getKeyUsage
  // says so otherwise (for example while Shoo is off).
  const runtimeNoKey = runtime.data?.reason === 'noKey';
  const keyNow = runtimeNoKey ? (runtime.data?.detail === 'keyRejected' ? 'rejected' : 'none') : keyState(key.data);
  const modelOk = consent && ((!!settings.data && settings.data.engine !== 'openrouter') || keyNow === 'connected' || keyNow === 'unknown');
  const data: PageData = {
    settings: settings.data,
    rules: rules.data,
    exceptions: exceptions.data,
    runtime: runtime.data,
    loadError: !!(settings.error || rules.error),
    exceptionsError: !!exceptions.error,
    consent,
    modelOk,
    key: key.data,
    keyStatus: keyNow,
    refreshKey: () => {
      key.reload();
      runtime.reload();
    },
    refreshRuntime: runtime.reload,
    go: (section, query) => {
      location.hash = query ? `${section}?${query}` : section;
    },
  };

  const counts = useMemo(() => {
    const all = rules.data ?? [];
    return {
      rules: all.filter((r) => r.polarity === 'remove').length,
      keep: all.filter((r) => r.polarity === 'keep').length,
      banned: all.filter(isBannedChannel).length,
      exceptions: exceptions.data?.length,
    } as Partial<Record<Section, number>>;
  }, [rules.data, exceptions.data]);

  const eyes = useMemo(() => ({ reading: setReading, wide: setWide }), []);
  const View = VIEWS[route.section];
  const s = settings.data;

  return (
    <EyesControl.Provider value={eyes}>
      <div class="mx-auto grid min-h-screen max-w-[1280px] grid-cols-1 md:grid-cols-[248px_minmax(0,1fr)]">
        <nav aria-label={t('settings.nav.label')} class="flex flex-col gap-6 px-4 pt-6 pb-2 md:sticky md:top-0 md:h-screen md:pt-8 md:pr-3 md:pb-6 md:pl-6">
          <a href="#rules" class="self-start rounded-[8px] px-3.5 text-ink no-underline">
            <Wordmark state={runtime.data?.eye ?? 'watching'} track drift reading={reading} wide={wide} status />
          </a>
          <ul class="m-0 flex list-none flex-col gap-0.5 p-0 max-md:flex-row max-md:flex-wrap">
            {SECTIONS.map((id) => {
              const current = id === route.section;
              const n = counts[id];
              return (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    aria-current={current ? 'page' : undefined}
                    class={`press flex h-10 items-center gap-2.5 rounded-full pr-4 pl-3.5 text-[15px] text-ink no-underline max-md:h-9 ${
                      current ? 'bg-paper font-semibold shadow-card' : 'font-medium hover:bg-tint'
                    }`}
                  >
                    <span aria-hidden="true" class={`size-[7px] shrink-0 rounded-full ${current ? 'bg-action' : ''}`} />
                    {NAV_LABEL[id]()}
                    {n !== undefined && n > 0 && <span class="num ml-auto text-[13px] text-muted">{n}</span>}
                  </a>
                </li>
              );
            })}
          </ul>
          {s && (
            <dl class="mt-auto mb-0 grid gap-1 border-t border-line-strong px-3.5 pt-3 text-[14px] max-md:hidden">
              <div class="flex justify-between gap-3">
                <dt class="text-muted">{t('mode.label')}</dt>
                <dd class="m-0 font-semibold">{t(`mode.${s.mode}`)}</dd>
              </div>
              <div class="flex justify-between gap-3">
                <dt class="text-muted">{t('connection.strength.label')}</dt>
                <dd class="m-0 font-semibold">{t(`connection.strength.${s.strength.preset}`)}</dd>
              </div>
            </dl>
          )}
        </nav>
        <main class="min-w-0 px-4 pt-6 pb-16 sm:px-8 md:pt-9 md:pr-12 md:pl-6">
          <div class="max-w-[960px]">
            {onboardingOpen ? <SkeletonRows rows={4} /> : <View data={data} params={route.params} />}
          </div>
        </main>
      </div>
    </EyesControl.Provider>
  );
}
