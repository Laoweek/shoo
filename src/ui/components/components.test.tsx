// @vitest-environment jsdom
import '../test/catalogue';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EYE_STATES } from '../eyes/EyesSvg';
import { Button, Eyes, Notice, RuleRef, Segmented, SkeletonRows, Swatch, Switch, VerdictPill, Wordmark } from './index';

let host: HTMLElement;
function mount(vnode: preact.ComponentChild): HTMLElement {
  host = document.createElement('div');
  document.body.append(host);
  act(() => render(vnode, host));
  return host;
}
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  vi.useRealTimers();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe('Eyes', () => {
  it('switches state through data-state and stays hidden from assistive technology', () => {
    for (const state of EYE_STATES) {
      const el = mount(<Eyes state={state} />);
      const svg = el.querySelector('svg')!;
      expect(svg.getAttribute('data-state')).toBe(state);
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      act(() => render(<Eyes state="paused" />, el));
      expect(el.querySelector('svg')!.getAttribute('data-state')).toBe('paused');
    }
  });

  it('blinks once per new blinkKey by remounting the lids', () => {
    const el = mount(<Eyes state="watching" blinkKey={0} />);
    expect(el.querySelector('.blink')).toBeNull();
    const before = el.querySelector('.lid-top');
    act(() => render(<Eyes state="watching" blinkKey={1} />, el));
    expect(el.querySelectorAll('.lid-top.blink')).toHaveLength(2);
    expect(el.querySelector('.lid-top')).not.toBe(before);
  });

  it('follows the pointer with a per-frame lerp while watching', () => {
    vi.useFakeTimers();
    window.matchMedia = ((q: string) => ({ matches: false, media: q })) as unknown as typeof window.matchMedia;
    const el = mount(<Eyes state="watching" track />);
    act(() => void document.dispatchEvent(new MouseEvent('pointermove', { clientX: 500, clientY: 0 })));
    act(() => void vi.advanceTimersByTime(16));
    const svg = el.querySelector('svg')!;
    const first = Number(svg.style.getPropertyValue('--px'));
    expect(first).toBeCloseTo(0.18, 2);
    act(() => void vi.advanceTimersByTime(2000));
    expect(Number(svg.style.getPropertyValue('--px'))).toBeGreaterThan(0.95);
    expect(svg.classList.contains('tracking')).toBe(true);
  });

  it('does not track with prefers-reduced-motion or outside the watching state', () => {
    vi.useFakeTimers();
    window.matchMedia = ((q: string) => ({ matches: q.includes('reduce') })) as unknown as typeof window.matchMedia;
    const el = mount(<Eyes state="watching" track />);
    act(() => void document.dispatchEvent(new MouseEvent('pointermove', { clientX: 500, clientY: 0 })));
    act(() => void vi.advanceTimersByTime(500));
    expect(el.querySelector('svg')!.style.getPropertyValue('--px')).toBe('');

    window.matchMedia = ((q: string) => ({ matches: false, media: q })) as unknown as typeof window.matchMedia;
    const other = mount(<Eyes state="judging" track />);
    act(() => void document.dispatchEvent(new MouseEvent('pointermove', { clientX: 500, clientY: 0 })));
    act(() => void vi.advanceTimersByTime(500));
    expect(other.querySelector('svg')!.style.getPropertyValue('--px')).toBe('');
  });
});

describe('Wordmark', () => {
  it('is an image named Shoo with visually hidden status text', () => {
    const el = mount(<Wordmark state="paused" status />);
    expect(el.querySelector('[role="img"]')!.getAttribute('aria-label')).toBe('Shoo');
    expect(el.querySelector('.sr-only')!.textContent).toBe('Shoo is paused');
    expect(el.querySelector('svg')!.getAttribute('data-state')).toBe('paused');
  });
});

describe('controls', () => {
  it('Button renders the three variants as type=button', () => {
    const el = mount(
      <>
        <Button variant="primary">Save</Button>
        <Button>Not now</Button>
        <Button variant="text">Undo</Button>
      </>,
    );
    const buttons = [...el.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Save', 'Not now', 'Undo']);
    expect(buttons.every((b) => b.type === 'button')).toBe(true);
    expect(buttons[0]!.className).toContain('bg-ink');
    expect(buttons[1]!.className).toContain('border-edge');
  });

  it('Switch is role=switch and reports the next value', () => {
    const onChange = vi.fn();
    const el = mount(<Switch checked={false} onChange={onChange} label="R1 on" />);
    const sw = el.querySelector('[role="switch"]')!;
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(sw.getAttribute('aria-label')).toBe('R1 on');
    act(() => (sw as HTMLButtonElement).click());
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('Segmented is a radio group with arrow keys and roving tabindex', () => {
    const onChange = vi.fn();
    const options = [
      { value: 'auto', label: 'Auto' },
      { value: 'review', label: 'Review' },
      { value: 'dryRun', label: 'Dry-run' },
    ] as const;
    const el = mount(<Segmented options={options} value="review" onChange={onChange} label="Mode" />);
    const group = el.querySelector('[role="radiogroup"]')!;
    expect(group.getAttribute('aria-label')).toBe('Mode');
    const radios = [...el.querySelectorAll('[role="radio"]')] as HTMLButtonElement[];
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
    radios[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(onChange).toHaveBeenLastCalledWith('dryRun');
    radios[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(onChange).toHaveBeenLastCalledWith('auto');
    radios[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(onChange).toHaveBeenLastCalledWith('dryRun');
  });
});

describe('Rule display', () => {
  it('Swatch is decorative and uses the Rule colour token, hollow for Keep rules', () => {
    const el = mount(
      <>
        <Swatch colour="c4" />
        <Swatch />
      </>,
    );
    const [a, b] = [...el.querySelectorAll('span')];
    expect(a!.getAttribute('aria-hidden')).toBe('true');
    expect(a!.getAttribute('style')).toContain('var(--c4)');
    expect(b!.className).toContain('border-ink');
  });

  const crypto = { ref: 'R2', colour: 'c2' as const, polarity: 'remove' as const, text: 'Cryptocurrency trading and coin price predictions' };

  it('RuleRef names a Rule by its name, or its text without one, with the full text as tooltip', () => {
    const el = mount(<RuleRef rule={{ ...crypto, name: 'Crypto' }} />);
    expect(el.textContent).toBe('Crypto');
    expect(el.querySelector('[title]')!.getAttribute('title')).toBe(crypto.text);
    expect(el.querySelector('[data-colour]')!.getAttribute('data-colour')).toBe('c2');
    act(() => render(<RuleRef rule={crypto} />, el));
    expect(el.textContent).toBe(crypto.text);
    expect(el.querySelector('[title]')!.className).toContain('truncate');
    act(() => render(<RuleRef rule={{ ...crypto, name: '  ' }} />, el));
    expect(el.textContent).toBe(crypto.text);
  });

  it('RuleRef shows the ref in the Settings tables, and Keep rules get the hollow swatch', () => {
    const el = mount(<RuleRef rule={{ ...crypto, name: 'Crypto' }} show="ref" />);
    expect(el.textContent).toBe('R2');
    act(() => render(<RuleRef rule={{ ref: 'K1', text: 'Speedruns', polarity: 'keep', colour: 'c3' }} />, el));
    expect(el.textContent).toBe('Speedruns');
    expect(el.querySelector('[aria-hidden="true"]')!.className).toContain('border-ink');
  });

  it('RuleRef places the label inside a sentence, truncating only the label', () => {
    const el = mount(<RuleRef rule={{ ...crypto, name: 'Crypto' }} sentence={(rule) => `${rule} wanted it gone`} />);
    expect(el.textContent).toBe('Crypto wanted it gone');
    const label = el.querySelector('[title]')!;
    expect(label.className).toContain('truncate');
    expect(label.nextElementSibling!.className).toContain('shrink-0');
    act(() => render(<RuleRef rule={crypto} wrap sentence={(rule) => `Decided by ${rule}`} />, el));
    expect(el.textContent).toBe(`Decided by ${crypto.text}`);
    expect(el.querySelector('[title]')!.className).not.toContain('truncate');
  });

  it('RuleRef takes the label direction from the name, so a right-to-left name keeps the sentence in order', () => {
    const rtl = { ...crypto, name: 'العملات الرقمية' };
    const el = mount(<RuleRef rule={rtl} sentence={(rule) => `${rule} wanted it gone`} />);
    expect(el.querySelector('[title]')!.getAttribute('dir')).toBe('auto');
    act(() => render(<RuleRef rule={rtl} wrap sentence={(rule) => `Decided by ${rule}`} />, el));
    expect(el.querySelector('[title]')!.getAttribute('dir')).toBe('auto');
  });

  it('VerdictPill reads Remove · 91%, Keep, or …, and names the Rule to screen readers', () => {
    const el = mount(<VerdictPill outcome="remove" rule="Crypto" colour="c2" probability={0.912} />);
    expect(el.querySelector('.num')!.textContent).toBe('Remove · 91%');
    expect(el.firstElementChild!.getAttribute('aria-label')).toBe('Verdict: Remove, Rule: Crypto, 91 percent');
    act(() => render(<VerdictPill outcome="remove" rule="Crypto" colour="c2" />, el));
    expect(el.querySelector('.num')!.textContent).toBe('Remove');
    expect(el.firstElementChild!.getAttribute('aria-label')).toBe('Verdict: Remove, Rule: Crypto');
    act(() => render(<VerdictPill outcome="keep" />, el));
    expect(el.textContent).toBe('Keep');
    act(() => render(<VerdictPill outcome="pending" />, el));
    expect(el.textContent).toBe('…');
  });
});

describe('feedback', () => {
  it('SkeletonRows is a busy status with hidden loading text', () => {
    const el = mount(<SkeletonRows rows={4} />);
    expect(el.querySelector('[role="status"]')!.getAttribute('aria-busy')).toBe('true');
    expect(el.querySelector('.sr-only')!.textContent).toBe('Loading…');
    expect(el.querySelectorAll('.h-10')).toHaveLength(4);
  });

  it('Notice shows the problem and its fix, danger only when asked', () => {
    const onClick = vi.fn();
    const el = mount(
      <Notice tone="danger" live="alert" actions={[{ label: 'Retry', onClick }]}>
        Shoo paused: OpenRouter didn't answer.
      </Notice>,
    );
    expect(el.querySelector('[role="alert"] p')!.className).toContain('text-danger');
    act(() => el.querySelector('button')!.click());
    expect(onClick).toHaveBeenCalledOnce();
  });
});
