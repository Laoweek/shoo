import type { ButtonHTMLAttributes, ComponentChildren } from 'preact';

export type ButtonVariant = 'primary' | 'outline' | 'text';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'size'> {
  variant?: ButtonVariant;
  /** sm 28 px (dense rows), md 36 px, lg 44 px (onboarding's primary actions). */
  size?: ButtonSize;
  children?: ComponentChildren;
}

const BASE =
  'press inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold select-none cursor-pointer disabled:cursor-not-allowed';
const SIZE: Record<ButtonSize, string> = {
  sm: 'h-7 px-3 text-[13px] rounded-full',
  md: 'h-9 px-4 text-[14px] rounded-full',
  lg: 'h-11 px-5 text-[15px] rounded-full',
};
// Orange marks what you can press: the primary button is filled with it, the outline button rings in --edge, and
// a text button's underline takes it on hover.
const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-action text-on-action hover:bg-action-hover disabled:bg-tint disabled:text-muted disabled:hover:bg-tint',
  outline: 'bg-paper text-ink border border-edge hover:bg-ground disabled:text-muted disabled:border-stroke disabled:hover:bg-paper',
  text: 'bg-transparent text-ink underline underline-offset-[4px] decoration-[1.5px] decoration-line-strong hover:decoration-action disabled:text-muted disabled:hover:decoration-line-strong',
};

/** Primary (orange pill), outline (paper pill ringed in --edge) or text button. Text buttons keep a 24 px hit target. */
export function Button({ variant = 'outline', size = 'md', type = 'button', class: cls, ...rest }: ButtonProps) {
  const sizing = variant === 'text' ? 'min-h-6 px-0 text-[inherit] rounded-[4px]' : SIZE[size];
  return <button type={type} class={`${BASE} ${sizing} ${VARIANT[variant]} ${cls ?? ''}`} {...rest} />;
}
