// @vitest-environment jsdom
import '~/ui/test/catalogue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONSENT_VERSION } from '~/store/schema';
import { replies, resetMessages, sendMessage, sent } from '~/ui/pages/testing/messages';
import { expectDisclosure } from '~/ui/pages/testing/disclosure';
import { fake, reset } from '~/ui/pages/testing/read';
import { button, click, hasButton, mount, radio, settle, snapshot, text, type, unmountAll } from '~/ui/pages/testing/render';
import { App, ConnectStep, RulesStep, WhatStep } from './App';

vi.mock('~/messaging/protocol', () => import('~/ui/pages/testing/messages'));
vi.mock('~/store/read', () => import('~/ui/pages/testing/read'));

const heading = { current: null };
let order: string[];

beforeEach(() => {
  reset();
  resetMessages();
  order = [];
  replies.giveConsent = () => {
    order.push('giveConsent');
    return snapshot();
  };
  replies.updateSettings = ({ patch }) => ({ settings: { ...fake.settings, ...patch } });
  replies.getKeyUsage = () => ({ error: 'noKey' });
  browser.permissions.request = vi.fn(() => {
    order.push('permissions.request');
    return Promise.resolve(true);
  }) as unknown as typeof browser.permissions.request;
});
afterEach(() => {
  unmountAll();
  vi.restoreAllMocks();
});

describe('onboarding resume', () => {
  it('starts at step 1, the welcome screen, with every consent fact in its row before the buttons', async () => {
    const el = mount(<App isFirefox={false} />);
    await settle();
    expect(el.querySelector('h2')!.textContent).toBe("Shoo the videos you don't want");
    expect([...el.querySelectorAll('section > ul:first-of-type li')].map(text)).toEqual([
      'Shoo checks the videos YouTube and Bilibili recommend against your Rules.',
      'For the ones you don\'t want, it tells the site "Not interested" through the site\'s own menu.',
      'You always see which Rule acted. Undo it while you\'re on the page, or Keep the video so Shoo leaves it alone.',
    ]);
    expect(el.querySelector('h3')!.textContent).toBe('What Shoo sends');
    expectDisclosure(el);
    expect(el.querySelector('[aria-current="step"]')!.textContent).toContain('What Shoo does');
    // The disclosure comes before the consent request in reading order.
    const lastRow = [...el.querySelectorAll('h4')].at(-1)!;
    expect(lastRow.compareDocumentPosition(button(el, 'Agree and continue')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(text(el)).toContain('You can change this later in Settings, Connection.');
  });

  it('resumes at the saved step with completed steps checked', async () => {
    fake.settings.onboarding = { step: 2, done: false };
    fake.settings.consent = { version: CONSENT_VERSION, acceptedAt: 1 };
    const el = mount(<App isFirefox={false} />);
    await settle();
    expect(el.querySelector('h2')!.textContent).toBe('First Rules');
    expect(text(el)).toContain("Welcome back. You're on the step you left.");
    expect(el.querySelectorAll('ol li .sr-only').length).toBe(2);
  });

  it('saves each step as the user moves on', async () => {
    const el = mount(<App isFirefox={false} />);
    await settle();
    click(button(el, 'Use Exact rules only'));
    await settle();
    expect(sent('updateSettings')).toEqual([{ patch: { onboarding: { step: 2, done: false } } }]);
    expect(el.querySelector('h2')!.textContent).toBe('First Rules');
    expect(sent('giveConsent')).toEqual([]);
  });
});

describe('consent (step 1)', () => {
  it('on Firefox, Agree requests data collection synchronously, before any await or message', () => {
    const onAgree = vi.fn();
    const el = mount(<WhatStep headingRef={heading} isFirefox onAgree={onAgree} onExactOnly={vi.fn()} />);
    (button(el, 'Agree and continue') as HTMLButtonElement).click();
    // Still inside the click: the prompt was requested and nothing else has run yet.
    expect(browser.permissions.request).toHaveBeenCalledWith({ data_collection: ['websiteContent', 'authenticationInfo'] });
    expect(order).toEqual(['permissions.request']);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('on Firefox, consent is recorded only after the prompt is granted', async () => {
    const onAgree = vi.fn();
    const el = mount(<WhatStep headingRef={heading} isFirefox onAgree={onAgree} onExactOnly={vi.fn()} />);
    click(button(el, 'Agree and continue'));
    await settle();
    expect(order).toEqual(['permissions.request', 'giveConsent']);
    expect(sent('giveConsent')).toEqual([{ version: CONSENT_VERSION }]);
    expect(onAgree).toHaveBeenCalledOnce();
  });

  it('declining Firefox prompt means Exact rules only and records no consent', async () => {
    browser.permissions.request = vi.fn(() => Promise.resolve(false)) as unknown as typeof browser.permissions.request;
    const onExactOnly = vi.fn();
    const el = mount(<WhatStep headingRef={heading} isFirefox onAgree={vi.fn()} onExactOnly={onExactOnly} />);
    click(button(el, 'Agree and continue'));
    await settle();
    expect(onExactOnly).toHaveBeenCalledOnce();
    expect(sent('giveConsent')).toEqual([]);
  });

  it('on Chrome there is no browser prompt', async () => {
    const onAgree = vi.fn();
    const el = mount(<WhatStep headingRef={heading} isFirefox={false} onAgree={onAgree} onExactOnly={vi.fn()} />);
    click(button(el, 'Agree and continue'));
    await settle();
    expect(browser.permissions.request).not.toHaveBeenCalled();
    expect(sent('giveConsent')).toEqual([{ version: CONSENT_VERSION }]);
    expect(onAgree).toHaveBeenCalledOnce();
  });
});

describe('connect (step 2)', () => {
  it('offers Decision model providers only: OpenRouter preselected, providers reached directly, and this computer', async () => {
    const el = mount(<ConnectStep headingRef={heading} onNext={vi.fn()} />);
    await settle();
    expect(el.querySelector('h2')!.textContent).toBe('Choose where Shoo checks videos');
    const groups = [...el.querySelectorAll('[role="group"]')].map((g) => [
      text(document.getElementById(g.getAttribute('aria-labelledby')!)!),
      [...g.querySelectorAll('input[name="provider"]')].map((r) => text(r.closest('label')!.querySelector('.font-semibold')!)),
    ]);
    expect(groups).toEqual([
      ['Online', ['OpenRouter', 'Cloudflare', 'TypeSafe', 'Perplexity']],
      ['On this computer, most private', ['Ollama', 'llama.cpp', 'LM Studio']],
    ]);
    // The chat model is a Settings-only escape hatch: no chat provider and no chat form here.
    expect(text(el)).not.toMatch(/OpenAI|Groq|Custom|chat model/i);
    expect(radio(el, 'OpenRouter').checked).toBe(true);
    expect(text(el)).toContain('Recommended');
    expect(hasButton(el, 'Connect OpenRouter')).toBe(true);
    expect(hasButton(el, 'Paste a key')).toBe(true);
  });

  it('Cloudflare asks for host access first in the click, then consent naming the host, then saves and moves on', async () => {
    replies.setDirectEndpoint = () => {
      order.push('setDirectEndpoint');
      return { ok: true };
    };
    const onNext = vi.fn();
    const el = mount(<ConnectStep headingRef={heading} onNext={onNext} />);
    await settle();
    click(radio(el, 'Cloudflare'));
    expect(hasButton(el, 'Connect OpenRouter')).toBe(false);
    expect(text(el)).toContain('Reads thumbnails, so Thumbnail rules work too.');
    expect(text(el)).toContain('Model clef-flash, the one Filtering strength was tuned on.');
    expect(button(el, 'Use Cloudflare').disabled).toBe(true);
    type(el.querySelector('#direct-account') as HTMLInputElement, 'nope');
    expect(text(el)).toContain('An account ID is 32 letters and digits.');
    type(el.querySelector('#direct-account') as HTMLInputElement, '0123456789abcdef0123456789abcdef');
    expect(text(el)).toContain('Paste your Cloudflare API token to continue.');
    const token = el.querySelector('#direct-key') as HTMLInputElement;
    expect(token.type).toBe('password');
    type(token, 'cf-secret');
    click(button(el, 'Use Cloudflare'));
    expect(order).toEqual(['permissions.request']);
    expect(browser.permissions.request).toHaveBeenCalledWith({ origins: ['https://api.cloudflare.com/*'] });
    await settle();
    expect(text(el)).toContain("Shoo will send what's listed under What Shoo sends to api.cloudflare.com, instead of OpenRouter.");
    expect(onNext).not.toHaveBeenCalled();
    click(button(el, 'Agree and continue'));
    await settle();
    expect(sent('giveConsent')).toEqual([{ version: CONSENT_VERSION, customHost: 'api.cloudflare.com' }]);
    expect(sent('setDirectEndpoint')).toEqual([
      { provider: 'cloudflare', baseUrl: 'https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/run/@cf/cloudflare', model: 'clef-flash', key: 'cf-secret' },
    ]);
    // Online providers are never called before consent: a call there spends the user's credit.
    expect(sent('testDirectEndpoint')).toEqual([]);
    expect(order.indexOf('giveConsent')).toBeLessThan(order.indexOf('setDirectEndpoint'));
    expect(onNext).toHaveBeenCalledOnce();
    expect(el.innerHTML).not.toContain('cf-secret');
  });

  it('TypeSafe reads titles only and says Filtering strength was not tuned on its model', async () => {
    const el = mount(<ConnectStep headingRef={heading} onNext={vi.fn()} />);
    await settle();
    click(radio(el, 'TypeSafe'));
    expect(text(el)).toContain('Titles only. Thumbnail rules need a model that reads images.');
    expect(text(el)).toContain('Filtering strength was tuned on clef-flash, so jev-1.13.0 may remove more or fewer videos.');
    expect(text(el.querySelector('label[for="direct-key"]')!)).toBe('TypeSafe API key');
    expect(document.getElementById(button(el, 'Use TypeSafe').getAttribute('aria-describedby')!)!.textContent).toBe('Paste your TypeSafe API key to continue.');
  });

  it('Ollama: no key, a free check first, then consent that says nothing leaves the computer', async () => {
    replies.testDirectEndpoint = () => ({ ok: true, latencyMs: 30 });
    replies.setDirectEndpoint = () => ({ ok: true });
    const onNext = vi.fn();
    const el = mount(<ConnectStep headingRef={heading} onNext={onNext} />);
    await settle();
    click(radio(el, 'Ollama'));
    expect(el.querySelector('#direct-key')).toBeNull();
    expect([...el.querySelectorAll('code')].map(text)[0]).toBe('ollama pull clef-flash');
    expect(text(el)).toContain('A copy on this computer may score a little differently.');
    click(button(el, 'Use Ollama'));
    expect(order).toEqual(['permissions.request']);
    await settle();
    expect(sent('testDirectEndpoint')).toEqual([{ provider: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'clef-flash' }]);
    expect(text(el)).toContain('localhost:11434 is this computer, so nothing leaves it.');
    click(button(el, 'Agree and continue'));
    await settle();
    expect(sent('giveConsent')).toEqual([{ version: CONSENT_VERSION, customHost: 'localhost:11434' }]);
    expect(sent('setDirectEndpoint')).toEqual([{ provider: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'clef-flash' }]);
    expect(onNext).toHaveBeenCalledOnce();
  });

  it('llama.cpp shows the command that starts its server with the model name Shoo sends', async () => {
    const el = mount(<ConnectStep headingRef={heading} onNext={vi.fn()} />);
    await settle();
    click(radio(el, 'llama.cpp'));
    expect([...el.querySelectorAll('code')].map(text)).toEqual(['llama-server -hf ggml-org/Clef-Flash-GGUF --alias clef-flash']);
    expect((el.querySelector('#direct-url') as HTMLInputElement).value).toBe('http://localhost:9931/v1');
    type(el.querySelector('#direct-url') as HTMLInputElement, 'https://example.com/v1');
    expect(text(el)).toContain('Enter an address on this computer, such as http://localhost, to continue.');
  });

  it('OAuth cancelled shows its copy and stays on the step', async () => {
    replies.connectOpenRouter = () => ({ ok: false, error: 'cancelled' });
    const onNext = vi.fn();
    const el = mount(<ConnectStep headingRef={heading} onNext={onNext} />);
    await settle();
    click(button(el, 'Connect OpenRouter'));
    await settle();
    expect(text(el)).toContain('Connection cancelled. Try again or paste a key.');
    expect(onNext).not.toHaveBeenCalled();
  });

  it('an invalid pasted key shows inline under the field, a good one moves on', async () => {
    replies.setKey = ({ key }) => (key === 'good' ? { ok: true, label: 'Pasted' } : { ok: false, error: 'keyRejected' });
    const onNext = vi.fn();
    const el = mount(<ConnectStep headingRef={heading} onNext={onNext} />);
    await settle();
    click(button(el, 'Paste a key'));
    const input = el.querySelector('#onb-key') as HTMLInputElement;
    type(input, 'bad');
    input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(el.querySelector('#onb-key-error')!.textContent).toBe('OpenRouter rejected this key. Check it and paste it again.');
    type(input, 'good');
    input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(onNext).toHaveBeenCalledOnce();
  });

  it('without a sign-in window, the code from openrouter.ai is exchanged', async () => {
    replies.connectOpenRouter = () => ({ ok: false, error: 'unsupported' });
    replies.exchangeHeadlessCode = () => ({ ok: true, label: 'Shoo' });
    const onNext = vi.fn();
    const el = mount(<ConnectStep headingRef={heading} onNext={onNext} />);
    await settle();
    click(button(el, 'Connect OpenRouter'));
    await settle();
    const input = el.querySelector('#onb-code') as HTMLInputElement;
    type(input, 'abc123');
    input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(sent('exchangeHeadlessCode')).toEqual([{ code: 'abc123' }]);
    expect(onNext).toHaveBeenCalledOnce();
  });

  it('offline disables connecting and offers Skip for now', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const onNext = vi.fn();
    const el = mount(<ConnectStep headingRef={heading} onNext={onNext} />);
    await settle();
    expect(text(el)).toContain("You're offline. You can connect later in Settings.");
    expect(button(el, 'Connect OpenRouter').disabled).toBe(true);
    click(button(el, 'Skip for now'));
    expect(onNext).toHaveBeenCalledOnce();
  });
});

describe('first Rules (step 3)', () => {
  const added = ({ ops }: { ops: import('~/core/types').RuleOp[] }) => {
    const op = ops[0]!;
    if (op.op !== 'add') throw new Error('unexpected');
    const rule = { ...op.rule, id: `id-${fake.rules.length}`, ref: `R${fake.rules.length + 1}`, colour: `c${fake.rules.length + 1}` as const, createdAt: fake.rules.length + 1, updatedAt: 1 };
    fake.rules = [...fake.rules, rule as import('~/core/types').Rule];
    return { rules: fake.rules, rulesVersion: 'v' };
  };

  it('starter chips send the expected Rules, named after their labels, and turn into their Rules', async () => {
    replies.mutateRules = added;
    const el = mount(<RulesStep headingRef={heading} consent onGlance={vi.fn()} onNext={vi.fn()} />);
    await settle();
    for (const label of ['Reaction videos', 'Clickbait', 'Get-rich-quick', 'Celebrity gossip', 'Shorts']) {
      click(button(el, label));
      await settle();
    }
    expect(sent('mutateRules')).toEqual([
      { ops: [{ op: 'add', rule: { polarity: 'remove', kind: 'topic', text: 'Reaction videos, where someone watches and reacts to other content', name: 'Reaction videos', enabled: true, origin: 'starter' } }] },
      { ops: [{ op: 'add', rule: { polarity: 'remove', kind: 'topic', text: 'Clickbait: exaggerated or misleading titles made to get clicks', name: 'Clickbait', enabled: true, origin: 'starter' } }] },
      { ops: [{ op: 'add', rule: { polarity: 'remove', kind: 'topic', text: 'Get-rich-quick hype: crypto pumps, trading wins and side hustles that promise fast money', name: 'Get-rich-quick', enabled: true, origin: 'starter' } }] },
      { ops: [{ op: 'add', rule: { polarity: 'remove', kind: 'topic', text: 'Celebrity gossip and drama', name: 'Celebrity gossip', enabled: true, origin: 'starter' } }] },
      { ops: [{ op: 'add', rule: { polarity: 'remove', kind: 'short', text: 'Shorts', name: 'Shorts', enabled: true, origin: 'starter' } }] },
    ]);
    expect(el.querySelectorAll('li [data-colour]').length).toBe(5);
    // Each chip names its Rule by its name (the short label), with the Rule text as tooltip, never by ref.
    const chips = [...el.querySelectorAll('li')].filter((li) => li.querySelector('[data-colour]'));
    expect(chips.map(text)).toEqual(['Reaction videos', 'Clickbait', 'Get-rich-quick', 'Celebrity gossip', 'Shorts']);
    expect(chips[2]!.querySelector('[title]')!.getAttribute('title')).toBe('Get-rich-quick hype: crypto pumps, trading wins and side hustles that promise fast money');
    expect(text(el)).not.toMatch(/\bR\d\b/);
  });

  it('the free field shows the tip, a soft hint for an order, and lists the added Rule by its text', async () => {
    replies.mutateRules = added;
    const el = mount(<RulesStep headingRef={heading} consent onGlance={vi.fn()} onNext={vi.fn()} />);
    await settle();
    const field = el.querySelector('#onb-rule') as HTMLInputElement;
    const tip = el.querySelector('#onb-rule-tip')!;
    expect(field.placeholder).toBe('Unboxing videos and hauls');
    expect(field.getAttribute('aria-describedby')).toBe('onb-rule-tip');
    expect(tip.getAttribute('role')).toBe('status');
    expect(text(tip)).toBe('Describe the videos, like “Unboxing videos and hauls”. One idea per Rule.');
    type(field, 'No unboxing videos');
    expect(text(tip)).toContain('Describe the videos instead of giving an order');
    // A hint never blocks adding.
    field.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(sent('mutateRules')).toEqual([{ ops: [{ op: 'add', rule: { polarity: 'remove', kind: 'topic', text: 'No unboxing videos', enabled: true, origin: 'user' } }] }]);
    expect(text(el.querySelector('form + ul')!)).toBe('No unboxing videos');
    expect(text(tip)).toBe('Describe the videos, like “Unboxing videos and hauls”. One idea per Rule.');
  });

  it('without consent the Topic starters are disabled with "Needs consent" and Shorts still works', async () => {
    replies.mutateRules = added;
    const el = mount(<RulesStep headingRef={heading} consent={false} onGlance={vi.fn()} onNext={vi.fn()} />);
    await settle();
    for (const label of ['Reaction videos', 'Clickbait', 'Get-rich-quick', 'Celebrity gossip']) {
      expect(button(el, label).disabled).toBe(true);
      expect(text(button(el, label))).toContain('Needs consent');
    }
    click(button(el, 'Shorts'));
    await settle();
    expect(sent('mutateRules')).toHaveLength(1);
    // The free field adds a Title keyword rule instead of a Topic rule, with no Topic tip.
    expect((el.querySelector('#onb-rule') as HTMLInputElement).placeholder).toBe('A word in titles');
    expect(el.querySelector('#onb-rule-tip')).toBeNull();
    type(el.querySelector('#onb-rule') as HTMLInputElement, 'prank');
    el.querySelector('#onb-rule')!.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(sent('mutateRules').at(-1)).toEqual({ ops: [{ op: 'add', rule: { polarity: 'remove', kind: 'keyword', text: 'prank', enabled: true, origin: 'user' } }] });
  });
});

describe('Mode (step 4)', () => {
  it('Review is preselected and Start saves the Mode and finishes onboarding', async () => {
    fake.settings.onboarding = { step: 3, done: false };
    replies.setMode = () => snapshot();
    const remove = vi.fn(async () => {});
    vi.spyOn(browser.tabs, 'getCurrent').mockResolvedValue({ id: 7 } as never);
    vi.spyOn(browser.tabs, 'remove').mockImplementation(remove as never);
    const el = mount(<App isFirefox={false} />);
    await settle();
    expect((el.querySelector('input[value="review"]') as HTMLInputElement).checked).toBe(true);
    click(button(el, 'Start'));
    await settle();
    expect(sent('setMode')).toEqual([{ mode: 'review' }]);
    expect(sent('updateSettings')).toEqual([{ patch: { onboarding: { step: 3, done: true } } }]);
    expect(remove).toHaveBeenCalledWith(7);
  });
});
