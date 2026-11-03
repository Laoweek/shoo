// Settings (options page, opens in a tab). Two columns: a 200 px section index with the current section
// ink-filled, and the main column (max 880 px). URL hash routing per section (docs/spec/ui-design.md
// Section 6). Pages never write storage: every change is a message to the background.
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

const NAV_LABEL: Record<Section, () => string> = {
  rules: () => t('settings.nav.rules'),
  keep: () => t('settings.nav.keep'),
  banned: () => t('settings.nav.banned'),
  exceptions: () => t('settings.nav.exceptions'),
  activity: () => t('settings.nav.activity'),
  connection: () => t('settings.nav.connection'),
  advanced: () => t('settings.nav.advanced'),
};

const VIEWS = { rules: Rules, keep: Keep, banned: Banned, exceptions: Exceptions, activity: Activity, connection: Connection, advanced: Advanced };

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
      <div class="mx-auto grid min-h-screen max-w-[1200px] grid-cols-1 md:grid-cols-[200px_minmax(0,1fr)]">
        {/* Item text sits 24 px in beside the content column, 16 px on narrow windows to line up with the content. */}
        <nav aria-label={t('settings.nav.label')} class="flex flex-col gap-4 border-line px-3 pt-6 pb-4 max-md:border-b max-md:px-2 md:sticky md:top-0 md:h-screen md:border-r">
          <a href="#rules" class="self-start rounded-[6px] px-3 no-underline max-md:px-2">
            <Wordmark state={runtime.data?.eye ?? 'watching'} track drift reading={reading} wide={wide} status />
          </a>
          <ul class="m-0 flex list-none flex-col gap-1 p-0 max-md:flex-row max-md:flex-wrap">
            {SECTIONS.map((id) => {
              const current = id === route.section;
              const n = counts[id];
              return (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    aria-current={current ? 'page' : undefined}
                    class={`flex h-9 items-center justify-between gap-3 rounded-[6px] px-3 font-medium no-underline max-md:px-2 ${current ? 'bg-ink text-paper' : 'text-ink hover:bg-tint'}`}
                  >
                    {NAV_LABEL[id]()}
                    {n !== undefined && n > 0 && <span class={`num text-[12px] font-normal ${current ? 'text-paper/70' : 'text-muted'}`}>{n}</span>}
                  </a>
                </li>
              );
            })}
          </ul>
          {s && (
            <p class="mt-auto mb-0 border-t border-line px-3 pt-3 text-[12px] text-muted max-md:hidden">
              {t('mode.label')} <b class="font-semibold text-ink">{t(`mode.${s.mode}`)}</b> · {t('connection.strength.label')}{' '}
              <b class="font-semibold text-ink">{t(`connection.strength.${s.strength.preset}`)}</b>
            </p>
          )}
        </nav>
        <main class="min-w-0 px-4 pt-6 pb-12 sm:px-8">
          <div class="max-w-[880px]">
            {onboardingOpen ? <SkeletonRows rows={4} /> : <View data={data} params={route.params} />}
          </div>
        </main>
      </div>
    </EyesControl.Provider>
  );
}
