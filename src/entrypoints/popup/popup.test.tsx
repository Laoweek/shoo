// @vitest-environment jsdom
import '~/ui/test/catalogue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeReason, RuntimeSnapshot } from '~/core/types';
import { CONSENT_VERSION } from '~/store/schema';
import { replies, resetMessages, sendMessage, sent } from '~/ui/pages/testing/messages';
import { fake, reset } from '~/ui/pages/testing/read';
import { button, click, hasButton, mount, settle, snapshot, text, type, unmountAll } from '~/ui/pages/testing/render';
import { App } from './App';

vi.mock('~/messaging/protocol', () => import('~/ui/pages/testing/messages'));
vi.mock('~/store/read', () => import('~/ui/pages/testing/read'));

let runtime: RuntimeSnapshot;
let tabUrl: string | undefined;
let permissionRequests: unknown[];
let hostsGranted: boolean;

beforeEach(() => {
  reset();
  resetMessages();
  fake.settings.consent = { version: CONSENT_VERSION, acceptedAt: 1 };
  runtime = snapshot();
  tabUrl = 'https://www.youtube.com/';
  replies.getRuntimeState = () => runtime;
  replies.getKeyUsage = () => ({ connectedAt: 1, usage: 0, limit: null, limitRemaining: null, label: 'Shoo' });
  vi.spyOn(browser.tabs, 'query').mockImplementation(async () => [{ url: tabUrl } as Browser.tabs.Tab]);
  hostsGranted = true;
  browser.permissions.contains = (() => Promise.resolve(hostsGranted)) as typeof browser.permissions.contains;
  permissionRequests = [];
  browser.permissions.request = ((p: unknown) => {
    permissionRequests.push(p);
    return Promise.resolve(true);
  }) as typeof browser.permissions.request;
});
afterEach(() => {
  unmountAll();
  vi.restoreAllMocks();
});

async function popup(): Promise<HTMLElement> {
  const el = mount(<App />);
  await settle();
  return el;
}

describe('popup screen states (ui-design.md Section 8)', () => {
  it('shows skeleton rows and disabled controls while loading', () => {
    replies.getRuntimeState = () => new Promise(() => {});
    const el = mount(<App />);
    expect(el.querySelector('[role="status"][aria-busy="true"]')?.textContent).toContain("Loading today's numbers…");
    expect(el.querySelector('[role="radiogroup"]')!.getAttribute('aria-disabled')).toBe('true');
    expect((el.querySelector('[role="switch"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('points to the Sites when the active tab is elsewhere', async () => {
    tabUrl = 'https://example.com/';
    expect(text(await popup())).toContain('Open YouTube or Bilibili to see Shoo at work.');
    tabUrl = undefined;
    unmountAll();
    expect(text(await popup())).toContain('Open YouTube or Bilibili to see Shoo at work.');
  });

  it('on a Site the user turned off, says so and turns that Site back on', async () => {
    tabUrl = 'https://www.bilibili.com/';
    fake.settings.sites = { youtube: true, bilibili: false };
    const el = await popup();
    expect(text(el)).toContain('Shoo is off on Bilibili.');
    click(button(el, 'Turn on'));
    await settle();
    expect(sent('updateSettings')).toEqual([{ patch: { sites: { youtube: true, bilibili: true } } }]);
  });

  it('says when the browser took away access to a Site that is on, even where the tab hides its address', async () => {
    tabUrl = undefined;
    browser.permissions.contains = ((p: { origins: string[] }) => Promise.resolve(!p.origins.includes('https://www.bilibili.com/*'))) as typeof browser.permissions.contains;
    const el = await popup();
    expect(text(el)).toContain('Shoo has no access to Bilibili.');
    click(button(el, 'Fix in Settings'));
    await settle();
    expect(sent('openSettings')).toEqual([{ hash: 'sites' }]);
  });

  it('shows no YouTube hint on YouTube and no notice when everything is fine', async () => {
    const el = await popup();
    expect(text(el)).not.toContain('Open YouTube');
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  const cases: [RuntimeReason, Partial<RuntimeSnapshot>, string, string[]][] = [
    ['off', { enabled: false, eye: 'paused' }, 'Shoo is off.', ['Turn on']],
    ['noConsent', {}, 'Shoo only uses Exact rules.', ['Give consent']],
    ['migrating', { eye: 'judging' }, "Updating Shoo's data…", []],
    ['hostRevoked', { eye: 'error' }, 'Shoo lost access to YouTube or your Decision model.', ['Fix in Settings']],
    ['noKey', { eye: 'paused' }, 'Connect OpenRouter to use Topic rules.', ['Connect']],
    ['breakerNativeAction', { eye: 'error' }, "Shoo paused: YouTube's menu changed.", ['Retry', 'Open settings']],
    ['breakerMarkup', { eye: 'error' }, "Shoo paused: YouTube's menu changed.", ['Retry', 'Open settings']],
    ['breakerModel', { eye: 'error' }, "Shoo paused: OpenRouter didn't answer.", ['Retry']],
    ['dailyCap', { eye: 'paused' }, 'Daily limit of 5,000 videos reached. Judging resumes at midnight.', []],
    ['offline', { eye: 'paused' }, "You're offline. Exact rules still work.", []],
  ];
  it.each(cases)('%s renders its copy and fix', async (reason, over, copy, fixes) => {
    runtime = snapshot({ reason, ...over });
    const el = await popup();
    expect(text(el)).toContain(copy);
    for (const f of fixes) expect(hasButton(el, f)).toBe(true);
    expect(el.querySelector('svg[data-state]')!.getAttribute('data-state')).toBe(runtime.eye);
  });

  it('noKey with a rejected key and out of credits use their own copy', async () => {
    runtime = snapshot({ reason: 'noKey', detail: 'keyRejected', eye: 'error' });
    expect(text(await popup())).toContain('OpenRouter rejected the key. Reconnect in Connection.');
    unmountAll();
    runtime = snapshot({ reason: 'breakerModel', detail: 'creditsExhausted', eye: 'error' });
    const el = await popup();
    expect(text(el)).toContain('OpenRouter says the key is out of credits.');
    expect(hasButton(el, 'Open OpenRouter')).toBe(true);
  });

  it('with a custom endpoint, a refused request and a tripped model name that host, not OpenRouter', async () => {
    fake.settings.engine = 'custom';
    fake.settings.customEndpoint = { baseUrl: 'http://localhost:11434/v1', model: 'gemma3:4b' };
    runtime = snapshot({ reason: 'noKey', detail: 'keyRejected', eye: 'error' });
    let el = await popup();
    expect(text(el)).toContain('localhost:11434 refused Shoo. Check it in Settings, Connection.');
    expect(hasButton(el, 'Fix in Settings')).toBe(true);
    unmountAll();
    runtime = snapshot({ reason: 'breakerModel', eye: 'error' });
    el = await popup();
    expect(text(el)).toContain("Shoo paused: localhost:11434 didn't answer.");
    expect(text(el)).not.toContain("OpenRouter didn't answer");
  });

  it('with a direct Decision provider, the footer and a tripped model name its host, and Topic rules need no OpenRouter key', async () => {
    fake.settings.engine = 'direct';
    fake.settings.direct = { provider: 'cloudflare', baseUrl: 'https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/run/@cf/cloudflare', model: 'clef-flash' };
    fake.settings.consent = { version: CONSENT_VERSION, acceptedAt: 1, customHost: 'api.cloudflare.com' };
    replies.getKeyUsage = () => ({ error: 'noKey' });
    runtime = snapshot({ reason: 'breakerModel', eye: 'error' });
    const el = await popup();
    expect(text(el)).toContain("Shoo paused: api.cloudflare.com didn't answer.");
    expect(text(el)).toContain('api.cloudflare.com connected');
    expect((el.querySelector('#quick-add') as HTMLInputElement).disabled).toBe(false);
    unmountAll();
    // Out of credits at Cloudflare: name it, and do not send the user to OpenRouter.
    runtime = snapshot({ reason: 'breakerModel', detail: 'creditsExhausted', eye: 'error' });
    const credits = await popup();
    expect(text(credits)).toContain('api.cloudflare.com says the key is out of credits.');
    expect(text(credits)).not.toContain('OpenRouter');
  });

  it('with a direct Decision provider whose key was forgotten, names its host and turns quick add off', async () => {
    fake.settings.engine = 'direct';
    fake.settings.direct = { provider: 'typesafe', baseUrl: 'https://api.typesafe.ai/v1', model: 'jev-1.13' };
    fake.settings.consent = { version: CONSENT_VERSION, acceptedAt: 1, customHost: 'api.typesafe.ai' };
    replies.getKeyUsage = () => ({ error: 'noKey' });
    runtime = snapshot({ reason: 'noKey', eye: 'paused' });
    const el = await popup();
    expect(text(el)).toContain('Shoo has no key for api.typesafe.ai. Add one in Settings, Connection.');
    expect(text(el)).not.toContain('OpenRouter');
    expect(hasButton(el, 'Fix in Settings')).toBe(true);
    expect((el.querySelector('#quick-add') as HTMLInputElement).disabled).toBe(true);
  });

  it('off disables the Mode control, migrating disables quick add', async () => {
    runtime = snapshot({ reason: 'off', enabled: false, eye: 'paused' });
    let el = await popup();
    expect(el.querySelector('[role="radiogroup"]')!.getAttribute('aria-disabled')).toBe('true');
    unmountAll();
    runtime = snapshot({ reason: 'migrating', eye: 'judging' });
    el = await popup();
    expect((el.querySelector('#quick-add') as HTMLInputElement).disabled).toBe(true);
  });

  it('shows zeros for an empty day and no cap bar', async () => {
    const el = await popup();
    const figures = [...el.querySelectorAll('dd')].map(text);
    expect(figures).toEqual(['0', '0', '$0']);
    expect(el.querySelector('[role="progressbar"]')).toBeNull();
  });

  it("shows today's numbers and the cap bar only above 80% of the Daily cap", async () => {
    fake.counters = { judged: 214, removed: 17, requests: 20, costUsd: 0.0021 };
    let el = await popup();
    expect([...el.querySelectorAll('dd')].map(text)).toEqual(['214', '17', '$0.002']);
    expect(el.querySelector('[role="progressbar"]')).toBeNull();
    unmountAll();
    fake.counters = { judged: 4100, removed: 300, requests: 300, costUsd: 0.04 };
    el = await popup();
    expect(el.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('4100');
    expect(text(el)).toContain('4,100 of 5,000 videos today');
  });
});

describe('popup actions', () => {
  it('the switch sends updateSettings enabled and Turn on re-enables', async () => {
    runtime = snapshot({ reason: 'off', enabled: false, eye: 'paused' });
    const el = await popup();
    click(button(el, 'Turn on'));
    await settle();
    expect(sent('updateSettings')).toEqual([{ patch: { enabled: true } }]);
  });

  it('switching Mode sends setMode', async () => {
    const el = await popup();
    click(button(el, 'Dry-run'));
    await settle();
    expect(sent('setMode')).toEqual([{ mode: 'dryRun' }]);
    expect(text(el)).toContain('Shoo asks on the video before telling the site anything.');
  });

  it('Review to Auto asks first when chips are showing, then acts on them', async () => {
    runtime = snapshot({ reviewPending: 3 });
    const el = await popup();
    click(button(el, 'Auto'));
    await settle();
    expect(sent('setMode')).toEqual([]);
    expect(text(el)).toContain('Remove the 3 flagged videos now?');
    click(button(el, 'Remove now'));
    await settle();
    expect(sent('setMode')).toEqual([{ mode: 'auto', actOnShowingChips: true }]);
  });

  it('Review to Auto with "Leave them" keeps the chips', async () => {
    runtime = snapshot({ reviewPending: 1 });
    const el = await popup();
    click(button(el, 'Auto'));
    await settle();
    expect(text(el)).toContain('Remove the flagged video now?');
    click(button(el, 'Leave them'));
    await settle();
    expect(sent('setMode')).toEqual([{ mode: 'auto', actOnShowingChips: false }]);
  });

  it('fixes open Settings at the right section and Retry resumes the tripped category', async () => {
    runtime = snapshot({ reason: 'noConsent' });
    let el = await popup();
    click(button(el, 'Give consent'));
    expect(sent('openSettings')).toEqual([{ hash: 'connection' }]);
    unmountAll();
    runtime = snapshot({ reason: 'breakerNativeAction', eye: 'error' });
    el = await popup();
    click(button(el, 'Retry'));
    await settle();
    expect(sent('resumeFromBreaker')).toEqual([{ category: 'nativeAction' }]);
    click(button(el, 'Activity'));
    expect(sent('openSettings').at(-1)).toEqual({ hash: 'activity' });
  });

  it('never asks for permissions, even on hostRevoked', async () => {
    runtime = snapshot({ reason: 'hostRevoked', eye: 'error' });
    const el = await popup();
    click(button(el, 'Fix in Settings'));
    await settle();
    expect(permissionRequests).toEqual([]);
    expect(sent('openSettings')).toEqual([{ hash: 'connection' }]);
  });

  it('quick add sends a Topic rule and names it, with the help line turning into a soft hint while typed as an order', async () => {
    replies.mutateRules = ({ ops }) => {
      const op = ops[0]!;
      if (op.op !== 'add') throw new Error('unexpected');
      return { rules: [{ ...op.rule, id: 'r7', ref: 'R7', colour: 'c7', createdAt: 2, updatedAt: 2 }], rulesVersion: 'v2' };
    };
    const el = await popup();
    const field = el.querySelector('#quick-add') as HTMLInputElement;
    const help = el.querySelector('#quick-add-hint')!;
    expect(field.placeholder).toBe('Unboxing videos and hauls');
    expect(field.getAttribute('aria-describedby')).toBe('quick-add-hint');
    expect(help.getAttribute('role')).toBe('status');
    expect(text(help)).toBe('Describe the videos, not an order.');
    type(field, 'No unboxing videos');
    expect(text(help)).toContain('Describe the videos instead of giving an order');
    el.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    // The hint never blocks adding.
    expect(sent('mutateRules')).toEqual([{ ops: [{ op: 'add', rule: { polarity: 'remove', kind: 'topic', text: 'No unboxing videos', enabled: true, origin: 'user' } }] }]);
    expect(text(el)).toContain('Rule added No unboxing videos');
    expect(text(el)).not.toContain('R7');
    expect(text(help)).toBe('Describe the videos, not an order.');
  });

  it('quick add on a Site can make the Rule work there only, and works on all sites unticked', async () => {
    tabUrl = 'https://www.bilibili.com/';
    replies.mutateRules = ({ ops }) => {
      const op = ops[0]!;
      if (op.op !== 'add') throw new Error('unexpected');
      return { rules: [{ ...op.rule, id: 'r7', ref: 'R7', colour: 'c7', createdAt: 2, updatedAt: 2 }], rulesVersion: 'v2' };
    };
    const el = await popup();
    const only = [...el.querySelectorAll('label')].find((l) => text(l) === 'Only on Bilibili')!.querySelector('input')!;
    type(el.querySelector('#quick-add') as HTMLInputElement, 'Anime openings');
    click(only);
    el.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(sent('mutateRules')).toEqual([{ ops: [{ op: 'add', rule: { polarity: 'remove', kind: 'topic', text: 'Anime openings', enabled: true, origin: 'user', site: 'bilibili' } }] }]);
    unmountAll();
    tabUrl = 'https://example.com/';
    expect([...(await popup()).querySelectorAll('label')].some((l) => text(l).startsWith('Only on'))).toBe(false);
  });

  it('quick add is disabled without consent', async () => {
    delete fake.settings.consent;
    runtime = snapshot({ reason: 'noConsent' });
    const el = await popup();
    expect((el.querySelector('#quick-add') as HTMLInputElement).disabled).toBe(true);
    expect(text(el)).toContain('Topic and Thumbnail rules need consent and a Decision model.');
  });

  it('shows Escalations waiting with Ban and Not now', async () => {
    fake.rules = [{ id: 'r2', ref: 'R2', polarity: 'remove', kind: 'topic', text: 'Crypto', colour: 'c2', enabled: true, origin: 'user', createdAt: 1, updatedAt: 1 }];
    fake.escalations = [{ channelKey: 'crypto kingz', channelName: 'Crypto Kingz', removed: 4, judged: 6, ruleId: 'r2' }];
    replies.confirmEscalation = () => ({ ruleId: 'r9' });
    const el = await popup();
    expect(text(el)).toContain('Crypto Kingz');
    expect(text(el)).toContain('4 of 6 removed by Crypto');
    expect(text(el)).not.toContain('R2');
    click(button(el, 'Ban'));
    await settle();
    expect(sent('confirmEscalation')).toEqual([{ channelKey: 'crypto kingz' }]);
  });

  it('footer reports the connection', async () => {
    let el = await popup();
    expect(text(el.querySelector('footer')!)).toContain('OpenRouter connected');
    unmountAll();
    replies.getKeyUsage = () => ({ error: 'noKey' });
    el = await popup();
    expect(text(el.querySelector('footer')!)).toContain('OpenRouter not connected');
  });

  it('sends nothing but reads on open', async () => {
    await popup();
    const names = new Set(sendMessage.mock.calls.map((c) => c[0]));
    expect([...names].sort()).toEqual(['getKeyUsage', 'getRuntimeState']);
  });
});
