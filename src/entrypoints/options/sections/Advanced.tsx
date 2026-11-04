// Advanced (docs/spec/ui-design.md Section 6, REQ-SET-1): notification style, Escalation, Daily cap, exact
// Filtering strength, regex Rules, import/export and Reset. Sites and their Surfaces have their own section.
import { useRef, useState } from 'preact/hooks';
import type { Settings } from '~/core/types';
import { CUSTOM_CUTOFF_MAX, CUSTOM_CUTOFF_MIN, removeCutoff } from '~/core/verdict';
import { t } from '~/i18n';
import { sendMessage, type ImportPreview } from '~/messaging/protocol';
import { Button, Notice, Segmented, SkeletonRows, Switch } from '~/ui/components';
import { count } from '~/ui/pages/format';
import { SectionHead, SettingRow, Status, SubHead, TextInput } from '~/ui/pages/parts';
import type { SectionProps } from '../context';
import { patchSettings } from './Connection';

export function Advanced({ data }: SectionProps) {
  const s = data.settings;
  const [failed, setFailed] = useState(false);
  const patch = (p: Partial<Settings>) => void patchSettings(p).then((ok) => setFailed(!ok));

  return (
    <section aria-labelledby="section-advanced">
      <SectionHead id="section-advanced" title={t('advanced.title')} lede={t('advanced.lede')} />
      {data.loadError ? (
        <Notice tone="danger" live="alert">
          {t('settings.error.load')}
        </Notice>
      ) : !s ? (
        <SkeletonRows rows={6} />
      ) : (
        <div class="grid gap-6">
          <Status tone="danger" class="empty:absolute">{failed ? t('connection.error.save') : ''}</Status>
          <div>
            <SubHead title={t('advanced.behaviour')} />
            <div class="card px-5 [&>:last-child]:border-b-0">
              <SettingRow label={t('advanced.notification.label')} labelId="notify-label" hint={t('advanced.notification.hint')}>
                <Segmented
                  label={t('advanced.notification.label')}
                  value={s.notificationStyle}
                  onChange={(v) => patch({ notificationStyle: v })}
                  options={[
                    { value: 'summary', label: t('advanced.notification.summary') },
                    { value: 'perRemoval', label: t('advanced.notification.perRemoval') },
                    { value: 'silent', label: t('advanced.notification.silentShort') },
                  ]}
                />
              </SettingRow>
              <SettingRow label={t('advanced.escalation.label')} hint={t(`advanced.escalation.hint.${s.escalationMode}`)}>
                <Segmented
                  label={t('advanced.escalation.label')}
                  value={s.escalationMode}
                  onChange={(v) => patch({ escalationMode: v })}
                  options={[
                    { value: 'off', label: t('advanced.escalation.off') },
                    { value: 'suggest', label: t('advanced.escalation.suggest') },
                    { value: 'automatic', label: t('advanced.escalation.automatic') },
                  ]}
                />
              </SettingRow>
              <DailyCap value={s.dailyCap} onSave={(dailyCap) => patch({ dailyCap })} />
              <StrengthSlider settings={s} onSave={(custom) => patch({ strength: { preset: 'custom', custom } })} />
              <SettingRow label={t('advanced.regex.label')} labelId="regex-label" hint={t('advanced.regex.hint')}>
                <Switch checked={s.regexEnabled} onChange={(v) => patch({ regexEnabled: v })} labelledBy="regex-label" />
              </SettingRow>
            </div>
          </div>
          <ImportExport />
          <Reset />
        </div>
      )}
    </section>
  );
}

function DailyCap({ value, onSave }: { value: number; onSave: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  const n = Number(text);
  const valid = /^\d+$/.test(text.trim()) && n >= 1;
  const commit = () => {
    if (valid && n !== value) onSave(n);
    if (!valid) setText(String(value));
  };
  return (
    <SettingRow label={<label for="daily-cap">{t('advanced.dailyCap.label')}</label>} hint={t('advanced.dailyCap.hint')}>
      <TextInput
        id="daily-cap"
        inputMode="numeric"
        class="num w-28 text-right"
        value={text}
        aria-invalid={!valid || undefined}
        onInput={(e) => setText(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
    </SettingRow>
  );
}

function StrengthSlider({ settings, onSave }: { settings: Settings; onSave: (v: number) => void }) {
  const [v, setV] = useState(removeCutoff(settings.strength, 'text'));
  const p = String(Math.round(v * 100));
  return (
    <SettingRow
      label={<label for="strength-slider">{t('advanced.strength.label')}</label>}
      hint={settings.strength.preset === 'custom' ? t('advanced.strength.hintCustom') : t('advanced.strength.hint', { preset: t(`connection.strength.${settings.strength.preset}`) })}
    >
      <input
        id="strength-slider"
        type="range"
        min={CUSTOM_CUTOFF_MIN}
        max={CUSTOM_CUTOFF_MAX}
        step={0.05}
        value={v}
        aria-valuetext={t('advanced.strength.value', { p })}
        onInput={(e) => setV(Number(e.currentTarget.value))}
        onChange={(e) => onSave(Math.round(Number(e.currentTarget.value) * 100) / 100)}
        class="w-44 cursor-pointer"
      />
      <span class="num min-w-24 text-[13px] whitespace-nowrap text-muted">{t('advanced.strength.value', { p })}</span>
    </SettingRow>
  );
}

// ---------------------------------------------------------------------------------------------------

type ImportState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'preview'; file: unknown; name: string; mode: ImportMode; preview: ImportPreview }
  | { kind: 'error'; detail?: string }
  | { kind: 'done' };

type ImportMode = 'merge' | 'replace';

export function ImportExport() {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<ImportState>({ kind: 'idle' });
  const [exportFailed, setExportFailed] = useState(false);

  const exportFile = async () => {
    setExportFailed(false);
    try {
      const data = await sendMessage('exportData');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `shoo-rules-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      setExportFailed(true);
    }
  };

  const pick = async (fileList: FileList | null) => {
    const f = fileList?.[0];
    // Clear the picker now, so choosing the same file again (after fixing it) fires change.
    if (input.current) input.current.value = '';
    if (!f) return;
    setState({ kind: 'checking' });
    let file: unknown;
    try {
      file = JSON.parse(await f.text());
    } catch {
      return setState({ kind: 'error' });
    }
    await preview(file, f.name, 'merge');
  };

  // Every apply follows a dry run in the same mode, so the preview always shows what that button does.
  const preview = async (file: unknown, name: string, mode: ImportMode) => {
    setState({ kind: 'checking' });
    try {
      const res = await sendMessage('importData', { file, mode, dryRun: true });
      if ('error' in res) return setState({ kind: 'error', detail: res.detail });
      setState({ kind: 'preview', file, name, mode, preview: res.preview });
    } catch {
      setState({ kind: 'error' });
    }
  };

  const apply = async () => {
    if (state.kind !== 'preview' || state.preview.syncQuota) return;
    const { file, mode } = state;
    setState({ kind: 'checking' });
    try {
      const res = await sendMessage('importData', { file, mode, dryRun: false });
      setState('error' in res ? { kind: 'error', detail: res.detail } : { kind: 'done' });
    } catch {
      setState({ kind: 'error' });
    }
  };

  return (
    <div>
      <SubHead title={t('advanced.data')} />
      <div class="card grid gap-3 p-5">
        <p class="m-0 text-[13px] text-muted">{t('advanced.export.hint')}</p>
        <div class="flex flex-wrap gap-2">
          <Button onClick={() => void exportFile()}>{t('advanced.export.label')}</Button>
          <Button onClick={() => input.current?.click()}>{t('advanced.import.label')}</Button>
          <input ref={input} type="file" accept="application/json,.json" class="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void pick(e.currentTarget.files)} />
        </div>
        <div role="status" class="text-[13px] empty:absolute">
          {exportFailed && <p class="m-0 text-danger">{t('advanced.export.error')}</p>}
          {state.kind === 'checking' && <p class="m-0 text-muted">{t('advanced.import.checking')}</p>}
          {state.kind === 'done' && <p class="m-0">{t('advanced.import.done')}</p>}
          {state.kind === 'error' && (
            <div class="grid gap-1">
              <p class="m-0 text-danger">{t('advanced.import.error')}</p>
              {state.detail && (
                <details>
                  <summary class="cursor-pointer text-muted">{t('advanced.import.details')}</summary>
                  <p class="mt-1 mb-0 font-mono text-[12px] break-words text-muted">{state.detail}</p>
                </details>
              )}
            </div>
          )}
        </div>
        {state.kind === 'preview' && (
          <div class="grid gap-2 rounded-[14px] bg-lit px-4 py-3">
            <p class="m-0 font-semibold">{state.name}</p>
            <p class="num m-0">
              {t('advanced.import.preview', { add: count(state.preview.add), update: count(state.preview.update), renumber: count(state.preview.renumber) })}
            </p>
            {state.preview.invalid.length > 0 && (
              <details>
                <summary class="cursor-pointer text-muted">{t('advanced.import.invalid', state.preview.invalid.length)}</summary>
                <ul class="mt-1 mb-0 pl-4 text-[13px] text-muted">
                  {state.preview.invalid.slice(0, 50).map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </details>
            )}
            {state.mode === 'replace' && state.preview.remove && (
              <p class="num m-0">{t('advanced.import.removes', { rules: count(state.preview.remove.rules), exceptions: count(state.preview.remove.exceptions) })}</p>
            )}
            {state.preview.syncQuota && <p class="m-0 text-danger">{t('advanced.import.syncQuota')}</p>}
            <p class="m-0 text-[13px] text-muted">{t('advanced.import.replaceNote')}</p>
            <div class="flex flex-wrap gap-2">
              <Button variant="primary" disabled={state.preview.syncQuota} onClick={() => void apply()}>
                {state.mode === 'merge' ? t('advanced.import.merge') : t('advanced.import.replace')}
              </Button>
              <Button onClick={() => void preview(state.file, state.name, state.mode === 'merge' ? 'replace' : 'merge')}>
                {state.mode === 'merge' ? t('advanced.import.previewReplace') : t('advanced.import.previewMerge')}
              </Button>
              <Button variant="text" onClick={() => setState({ kind: 'idle' })}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function Reset() {
  const [step, setStep] = useState<'idle' | 'confirm' | 'busy' | 'done' | 'error'>('idle');
  const run = async () => {
    setStep('busy');
    try {
      await sendMessage('resetAll');
      setStep('done');
    } catch {
      setStep('error');
    }
  };
  return (
    <div>
      <SubHead title={t('advanced.reset.label')} />
      <div class="card grid gap-3 p-5">
        <p class="m-0 max-w-[64ch] text-[13px] text-muted">{t('advanced.reset.hint')}</p>
        {step === 'confirm' || step === 'busy' ? (
          <div role="alert" class="grid gap-2 rounded-[14px] bg-lit px-4 py-3">
            <p class="m-0 font-semibold text-danger">{t('advanced.reset.confirm')}</p>
            <div class="flex flex-wrap gap-2">
              <Button variant="primary" disabled={step === 'busy'} onClick={() => void run()}>
                {t('advanced.reset.confirmButton')}
              </Button>
              <Button onClick={() => setStep('idle')}>{t('common.cancel')}</Button>
            </div>
          </div>
        ) : (
          <div>
            <Button onClick={() => setStep('confirm')}>{t('advanced.reset.button')}</Button>
          </div>
        )}
        <Status tone={step === 'error' ? 'danger' : 'plain'} class="empty:absolute">{step === 'done' ? t('advanced.reset.done') : step === 'error' ? t('advanced.reset.error') : ''}</Status>
      </div>
    </div>
  );
}
