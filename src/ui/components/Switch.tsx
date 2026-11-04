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

/** role="switch" with a 24 px hit target around a 36 x 20 track. On: the action colour. Off: the --edge grey. The knob is --knob. */
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
      class={`group inline-flex h-6 w-10 shrink-0 items-center justify-center rounded-full cursor-pointer disabled:cursor-not-allowed ${cls ?? ''}`}
    >
      <span
        aria-hidden="true"
        class={`relative block h-5 w-9 rounded-full transition-colors duration-150 motion-reduce:transition-none ${
          disabled ? 'bg-stroke' : checked ? 'bg-action group-hover:bg-action-hover' : 'bg-edge'
        }`}
      >
        <span
          class={`absolute top-0.5 left-0.5 size-4 rounded-full bg-(--knob) shadow-[0_1px_2px_rgb(0_0_0/0.25)] transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
            checked ? 'translate-x-4' : ''
          }`}
        />
      </span>
    </button>
  );
}
