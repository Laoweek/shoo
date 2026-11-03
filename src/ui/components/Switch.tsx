export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name, for example "R1 on". Use labelledBy when a visible label exists. */
  label?: string;
  labelledBy?: string;
  disabled?: boolean;
  id?: string;
  class?: string;
}

/** role="switch" with a 24 px hit target around a 34 x 20 track. Off: --edge outline. On: ink-filled. */
export function Switch({ checked, onChange, label, labelledBy, disabled, id, class: cls }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      class={`group inline-flex h-6 w-[38px] shrink-0 items-center justify-center rounded-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${cls ?? ''}`}
    >
      <span
        aria-hidden="true"
        class={`relative block h-5 w-[34px] rounded-full border-[1.5px] transition-colors ${
          checked ? 'border-ink bg-ink' : 'border-edge bg-transparent'
        }`}
      >
        <span
          class={`absolute top-[2.5px] left-[2.5px] size-3 rounded-full transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
            checked ? 'translate-x-[14px] bg-paper' : 'bg-ink'
          }`}
        />
      </span>
    </button>
  );
}
