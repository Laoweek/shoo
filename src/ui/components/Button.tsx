import type { ButtonHTMLAttributes, ComponentChildren } from 'preact';

export type ButtonVariant = 'primary' | 'outline' | 'text';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'size'> {
  variant?: ButtonVariant;
  /** sm 24 px (dense rows), md 30 px, lg 44 px (onboarding's primary actions). */
  size?: ButtonSize;
  children?: ComponentChildren;
}

const BASE =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold select-none cursor-pointer disabled:cursor-not-allowed';
const SIZE: Record<ButtonSize, string> = {
  sm: 'min-h-6 px-2 text-[13px] rounded-[6px]',
  md: 'h-[30px] px-3 text-[14px] rounded-[6px]',
  lg: 'h-11 px-4 text-[14px] rounded-[6px]',
};
const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-paper border border-ink hover:opacity-90 disabled:bg-stroke disabled:border-stroke',
  outline: 'bg-transparent text-ink border border-edge hover:bg-tint disabled:text-muted disabled:border-stroke disabled:hover:bg-transparent',
  text: 'bg-transparent text-ink underline underline-offset-[3px] decoration-1 hover:decoration-2 disabled:text-muted',
};

/** Primary (ink-filled), outline (--edge) or text button. Text buttons keep a 24 px hit target. */
export function Button({ variant = 'outline', size = 'md', type = 'button', class: cls, ...rest }: ButtonProps) {
  const sizing = variant === 'text' ? 'min-h-6 px-0 text-[inherit] rounded-[4px]' : SIZE[size];
  return <button type={type} class={`${BASE} ${sizing} ${VARIANT[variant]} ${cls ?? ''}`} {...rest} />;
}
