import { useRef } from 'preact/hooks';

export interface SegmentedOption<V extends string> {
  value: V;
  label: string;
}

export interface SegmentedProps<V extends string> {
  options: readonly SegmentedOption<V>[];
  value: V;
  onChange: (value: V) => void;
  /** Accessible name of the radio group, for example "Mode". */
  label: string;
  disabled?: boolean;
  class?: string;
}

/**
 * Radio group with arrow keys (Left/Up previous, Right/Down next, Home, End) and roving tabindex.
 * The selected segment is a paper pill ringed in --edge inside a tinted track (ui-design.md Section 2), so it shows at 3:1 in both themes.
 */
export function Segmented<V extends string>({ options, value, onChange, label, disabled, class: cls }: SegmentedProps<V>) {
  const group = useRef<HTMLDivElement>(null);
  const index = Math.max(0, options.findIndex((o) => o.value === value));

  const move = (e: KeyboardEvent) => {
    const last = options.length - 1;
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? (index === last ? 0 : index + 1)
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? (index === 0 ? last : index - 1)
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(options[next]!.value);
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };

  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      onKeyDown={disabled ? undefined : move}
      class={`grid auto-cols-fr grid-flow-col gap-0.5 rounded-full bg-tint p-[3px] shadow-[inset_0_0_0_1px_var(--line)] ${disabled ? 'opacity-50' : ''} ${cls ?? ''}`}
    >
      {options.map((o, i) => {
        const on = i === index;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            class={`press h-[30px] rounded-full px-3 font-semibold whitespace-nowrap cursor-pointer disabled:cursor-not-allowed ${
              on ? 'bg-paper text-ink shadow-[inset_0_0_0_1px_var(--edge),0_1px_2px_rgb(0_0_0/0.12)]' : 'text-muted hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
