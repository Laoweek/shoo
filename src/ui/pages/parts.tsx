// Small page-level building blocks: inputs, headings, status lines. Tokens only (pages.css).
import type { ComponentChildren, JSX } from 'preact';

const FIELD =
  'min-w-0 rounded-[6px] border border-edge bg-transparent px-3 text-[16px] text-ink placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-55';

export function TextInput({ class: cls, ...rest }: JSX.IntrinsicElements['input']) {
  return <input type="text" class={`${FIELD} h-9 ${cls ?? 'w-full'}`} {...rest} />;
}

export function Select({ class: cls, children, ...rest }: JSX.IntrinsicElements['select'] & { children: ComponentChildren }) {
  return (
    <select class={`${FIELD} h-9 cursor-pointer pr-7 ${cls ?? 'w-full'}`} {...rest}>
      {children}
    </select>
  );
}

/** Section heading (30 px Bricolage) and its one plain sentence. */
export function SectionHead({ id, title, lede, children }: { id: string; title: string; lede?: string; children?: ComponentChildren }) {
  return (
    <header class="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div class="min-w-0">
        <h2 id={id} tabIndex={-1} class="display m-0 text-[30px] leading-[1.1] font-bold tracking-[-0.025em] focus:outline-none">
          {title}
        </h2>
        {lede && <p class="mt-2 mb-0 max-w-[64ch] text-[15px] leading-[1.55] text-muted">{lede}</p>}
      </div>
      {children}
    </header>
  );
}

/** h3 with an optional muted hint on the right, over a strong rule. */
export function SubHead({ title, hint, id }: { title: string; hint?: ComponentChildren; id?: string }) {
  return (
    <div class="mb-2 flex items-baseline justify-between gap-3">
      <h3 id={id} class="m-0 text-[15px] font-bold tracking-[-0.01em]">
        {title}
      </h3>
      {hint && <span class="text-[12px] text-muted">{hint}</span>}
    </div>
  );
}

/** Polite live region for async results. Renders even when empty so updates are announced. */
export function Status({ children, tone = 'plain', class: cls }: { children?: ComponentChildren; tone?: 'plain' | 'danger'; class?: string }) {
  return (
    <p role="status" class={`m-0 min-h-0 text-[13px] ${tone === 'danger' ? 'text-danger' : 'text-muted'} ${cls ?? ''}`}>
      {children}
    </p>
  );
}

/** Label above a control, 12 px muted. */
export function FieldLabel({ for: htmlFor, children }: { for: string; children: ComponentChildren }) {
  return (
    <label for={htmlFor} class="mb-1 block text-[12px] font-semibold text-muted">
      {children}
    </label>
  );
}

/** A labelled settings row: label and hint on the left, control on the right, ruled below. */
export function SettingRow({ label, hint, labelId, children }: { label: ComponentChildren; hint?: ComponentChildren; labelId?: string; children: ComponentChildren }) {
  return (
    <div class="flex min-h-11 flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-line py-3">
      <div class="min-w-0 flex-1">
        <div id={labelId} class="font-medium">
          {label}
        </div>
        {hint && <div class="text-[13px] text-muted">{hint}</div>}
      </div>
      <div class="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/** After a row disappears, keep keyboard focus on the page: move it to the section heading. */
export function focusHeading(): void {
  (document.querySelector('main h2[tabindex="-1"]') as HTMLElement | null)?.focus();
}
