import type { ComponentChildren } from 'preact';
import { Button } from './Button';

export interface NoticeAction {
  label: string;
  onClick: () => void;
}

export interface NoticeProps {
  /** danger sets the message in --danger (errors only). */
  tone?: 'plain' | 'danger';
  children: ComponentChildren;
  actions?: readonly NoticeAction[];
  /** status (polite) for most notices, alert (assertive) only when a failure category tripped. */
  live?: 'status' | 'alert' | 'off';
  class?: string;
}

/** One line: the problem, then its fix as text buttons. Used in the popup and Settings. */
export function Notice({ tone = 'plain', children, actions, live = 'status', class: cls }: NoticeProps) {
  return (
    <div role={live === 'off' ? undefined : live} class={`flex flex-wrap items-center gap-x-3 gap-y-1 ${cls ?? ''}`}>
      <p class={`m-0 min-w-0 flex-1 ${tone === 'danger' ? 'text-danger' : 'text-ink'}`}>{children}</p>
      {actions?.map((a) => (
        <Button key={a.label} variant="text" onClick={a.onClick}>
          {a.label}
        </Button>
      ))}
    </div>
  );
}
