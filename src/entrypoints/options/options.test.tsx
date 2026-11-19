// @vitest-environment jsdom
import '~/ui/test/catalogue';
import { act as preactAct } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivityEvent, Rule } from '~/core/types';
import { CONSENT_VERSION } from '~/store/schema';
import { replies, resetMessages, sent } from '~/ui/pages/testing/messages';
import { expectDisclosure } from '~/ui/pages/testing/disclosure';
import { fake, reset } from '~/ui/pages/testing/read';
import { button, click, hasButton, key, mount, radio, settle, snapshot, text, type, unmountAll } from '~/ui/pages/testing/render';
import { App } from './App';
import type { PageData } from './context';
import { Activity, SEARCH_PAUSE_MS } from './sections/Activity';
import { Advanced } from './sections/Advanced';
import { Banned } from './sections/Banned';
import { ChatEndpoint } from '~/ui/pages/EndpointSetup';
import { Connection } from './sections/Connection';
import { EXCEPTIONS_PAGE, Exceptions } from './sections/Exceptions';
import { Keep } from './sections/Keep';
import { Rules } from './sections/Rules';
import { Sites } from './sections/Sites';
import { TryTitle, tryErrorMessage } from './sections/TryTitle';

vi.mock('~/messaging/protocol', () => import('~/ui/pages/testing/messages'));
vi.mock('~/store/read', () => import('~/ui/pages/testing/read'));

const rule = (over: Partial<Rule> & Pick<Rule, 'id' | 'ref'>): Rule => ({
  polarity: 'remove',
  kind: 'topic',
  text: 'Reaction videos',
  enabled: true,
  origin: 'user',
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

function data(over: Partial<PageData> = {}): PageData {
  return {
    settings: { ...fake.settings, consent: { version: CONSENT_VERSION, acceptedAt: 1 } },
    rules: [],
    exceptions: [],
    runtime: snapshot(),
    loadError: false,
    exceptionsError: false,
    consent: true,
    modelOk: true,
    key: { connectedAt: Date.UTC(2026, 9, 1), usage: 0.12, limit: 5, limitRemaining: 4.88, label: 'Shoo' },
    keyStatus: 'connected',
    refreshKey: vi.fn(),
    refreshRuntime: vi.fn(),
    go: vi.fn(),
    ...over,
  };
}
const params = new URLSearchParams();
let permissionRequests: unknown[];
let hostsGranted: boolean;
/** permissions.onAdded and onRemoved listeners (the fake browser has no permission events). */
let permissionListeners: Set<() => void>;

beforeEach(() => {
  reset();
  resetMessages();
  replies.listModels = () => ({ models: [{ id: 'cloudflare/clef-flash', images: true, pricePerMInput: 0.02 }], fetchedAt: 1 });
  permissionRequests = [];
  hostsGranted = true;
  browser.permissions.contains = (() => Promise.resolve(hostsGranted)) as typeof browser.permissions.contains;
  browser.permissions.request = ((p: unknown) => {
    permissionRequests.push(p);
    return Promise.resolve(true);
  }) as typeof browser.permissions.request;
  permissionListeners = new Set();
  const events = { addListener: (cb: () => void) => void permissionListeners.add(cb), removeListener: (cb: () => void) => void permissionListeners.delete(cb) };
  Object.assign(browser.permissions, { onAdded: events, onRemoved: events });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  unmountAll();
  vi.restoreAllMocks();
});

describe('Settings sections: loading, empty, error and disabled states', () => {
  const sections = [
    ['Rules', Rules, 'Nothing to shoo yet. Add a Rule, or start from one of these.'],
    ['Keep', Keep, 'Nothing is protected yet. Keep rules always win.'],
    ['Banned', Banned, 'No banned channels. Ban one from a chip, Activity or an Escalation.'],
    ['Exceptions', Exceptions, 'No Exceptions yet. Videos you keep show up here.'],
    ['Activity', Activity, 'Quiet so far. When Shoo acts, it shows up here.'],
  ] as const;

  it.each(sections)('%s shows skeleton rows while loading', (_name, View) => {
    const el = mount(<View data={data({ settings: undefined, rules: undefined, exceptions: undefined })} params={params} />);
    expect(el.querySelector('[role="status"][aria-busy="true"]')).not.toBeNull();
  });

  it.each(sections)('%s shows its empty state', async (_name, View, copy) => {
    const el = mount(<View data={data()} params={params} />);
    await settle();
    expect(text(el)).toContain(copy);
  });

  it.each([
    ['Rules', Rules, "Couldn't load Shoo's data. Reload the page to try again."],
    ['Keep', Keep, "Couldn't load Shoo's data. Reload the page to try again."],
    ['Banned', Banned, "Couldn't load Shoo's data. Reload the page to try again."],
    ['Exceptions', Exceptions, "Couldn't load Exceptions. Reload the page to try again."],
    ['Connection', Connection, "Couldn't load Shoo's data. Reload the page to try again."],
    ['Advanced', Advanced, "Couldn't load Shoo's data. Reload the page to try again."],
  ] as const)('%s shows the load error', async (_name, View, copy) => {
    const el = mount(<View data={data({ loadError: true })} params={params} />);
    await settle();
    expect(el.querySelector('[role="alert"]')!.textContent).toContain(copy);
  });

  it('Activity shows its load error', async () => {
    fake.fail = true;
    const el = mount(<Activity data={data()} params={params} />);
    await settle();
    expect(text(el)).toContain("Couldn't load Activity. Reload the page to try again.");
  });

  it('Rules: more Topic rules than the direct provider takes says so, and Try a title explains a refusal', async () => {
    const topics = Array.from({ length: 26 }, (_, i) => rule({ id: `t${i}`, ref: `R${i + 1}`, text: `Topic ${i}` }));
    const direct = { engine: 'direct' as const, direct: { provider: 'ollama' as const, baseUrl: 'http://localhost:11434/v1', model: 'clef-flash' } };
    const el = mount(<Rules data={data({ rules: topics, settings: { ...fake.settings, ...direct } })} params={params} />);
    await settle();
    expect(text(el)).toContain('Ollama takes at most 25 Topic rules, and 26 are on. Shoo checks no videos by topic until you switch some off, or pick another Decision provider in Connection.');
    unmountAll();
    const fine = mount(<Rules data={data({ rules: topics.slice(0, 25), settings: { ...fake.settings, ...direct } })} params={params} />);
    await settle();
    expect(text(fine)).not.toContain('takes at most');
    expect(tryErrorMessage('tooManyRules')).toBe('Too many Topic rules for this Decision provider. Switch some off, or pick another provider in Connection.');
  });

  it('Rules: Topic and Thumbnail kinds are disabled without consent or key, Topic starters too', async () => {
    const el = mount(<Rules data={data({ consent: false, modelOk: false })} params={params} />);
    await settle();
    const starter = button(el, 'Reaction videos');
    expect(starter.disabled).toBe(true);
    expect(text(starter)).toContain('Needs consent');
    expect(button(el, 'Shorts').disabled).toBe(false);
    click(button(el, 'Add a Rule'));
    const options = [...el.querySelectorAll('option')] as HTMLOptionElement[];
    expect(options.filter((o) => o.disabled).map((o) => o.value)).toEqual(['topic', 'thumbnail']);
    expect(options.map((o) => o.value)).not.toContain('regex');
    expect(options.map((o) => o.value)).not.toContain('artistChannel');
    expect(text(el)).toContain('Topic and Thumbnail rules need consent and a Decision model.');
  });

  it('Rules: a failed save shows the save error', async () => {
    replies.mutateRules = () => ({ error: 'invalidInput', detail: 'x' });
    const el = mount(<Rules data={data()} params={params} />);
    await settle();
    click(button(el, 'Add a Rule'));
    type(el.querySelector('#add-remove-text') as HTMLInputElement, 'Prank videos');
    click(button(el, 'Save'));
    await settle();
    expect(text(el)).toContain("Couldn't save the Rule. Try again.");
  });

  it('Connection: not connected offers Connect and Paste, no consent offers Give consent', async () => {
    const el = mount(<Connection data={data({ key: { error: 'noKey' }, keyStatus: 'none', consent: false, settings: { ...fake.settings } })} params={params} />);
    await settle();
    expect(hasButton(el, 'Connect OpenRouter')).toBe(true);
    expect(hasButton(el, 'Paste a key')).toBe(true);
    expect(hasButton(el, 'Give consent')).toBe(true);
  });

  it('Connection: What Shoo sends shows every consent fact in the same rows as onboarding', async () => {
    const el = mount(<Connection data={data({ key: { error: 'noKey' }, keyStatus: 'none', consent: false, settings: { ...fake.settings } })} params={params} />);
    await settle();
    const head = [...el.querySelectorAll('h3')].find((h) => text(h) === 'What Shoo sends')!;
    expectDisclosure(head.closest('div')!.parentElement!);
  });

  it('Connection: What Shoo sends links the hosted privacy policy', async () => {
    const el = mount(<Connection data={data({ key: { error: 'noKey' }, keyStatus: 'none', consent: false, settings: { ...fake.settings } })} params={params} />);
    await settle();
    const link = [...el.querySelectorAll('a')].find((a) => text(a) === 'Privacy policy');
    expect(link?.getAttribute('href')).toBe('https://laoweek.github.io/shoo/release/privacy-policy.html');
  });

  it('Connection: OAuth cancelled and invalid key render their copy', async () => {
    replies.connectOpenRouter = () => ({ ok: false, error: 'cancelled' });
    replies.setKey = () => ({ ok: false, error: 'keyRejected' });
    const el = mount(<Connection data={data({ key: { error: 'noKey' }, keyStatus: 'none' })} params={params} />);
    await settle();
    click(button(el, 'Connect OpenRouter'));
    await settle();
    expect(text(el)).toContain('Connection cancelled. Nothing changed.');
    click(button(el, 'Paste a key'));
    type(el.querySelector('#key-input') as HTMLInputElement, 'sk-or-bad');
    el.querySelector('#key-input')!.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(text(el)).toContain('OpenRouter rejected this key.');
  });

  it('Connection: connected shows label, date, usage, Disconnect and warns before reconnecting', async () => {
    replies.connectOpenRouter = () => ({ ok: true, label: 'Shoo' });
    const el = mount(<Connection data={data()} params={params} />);
    await settle();
    expect(text(el)).toMatch(/Connected .*2026 · Shoo/);
    expect(text(el)).toContain('$0.12 used of $5.00');
    expect(hasButton(el, 'Disconnect')).toBe(true);
    expect(el.querySelector('a[href="https://openrouter.ai/keys"]')).not.toBeNull();
    click(button(el, 'Connect again'));
    await settle();
    expect(sent('connectOpenRouter')).toEqual([]);
    expect(text(el)).toContain('Connecting again creates a new key. Revoke the old one at openrouter.ai/keys.');
    click(button(el, 'Connect again anyway'));
    await settle();
    expect(sent('connectOpenRouter')).toHaveLength(1);
  });

  it("Connection: shows today's usage when OpenRouter reports it", async () => {
    const el = mount(<Connection data={data({ key: { connectedAt: Date.UTC(2026, 9, 1), usage: 0.12, usageDaily: 0.03, limit: 5, limitRemaining: 4.88 } })} params={params} />);
    await settle();
    expect(text(el)).toContain('$0.03 used today');
    expect(text(el)).not.toContain('used of');
  });

  it('Connection: before consent shows the stored key without usage and the model picker without an error, and consent loads the key', async () => {
    replies.listModels = () => ({ error: 'noConsent' });
    const d = data({ key: { label: 'Shoo', source: 'oauth', connectedAt: Date.UTC(2026, 9, 1) }, consent: false, settings: { ...fake.settings } });
    const el = mount(<Connection data={d} params={params} />);
    await settle();
    expect(text(el)).toMatch(/Connected .*2026 · Shoo/);
    expect(text(el)).not.toContain('used');
    expect(text(el)).not.toContain("Couldn't load models");
    click(button(el, 'Give consent'));
    await settle();
    expect(d.refreshKey).toHaveBeenCalled();
  });

  it('Connection: on Firefox, withdrawing consent gives back the data collection permission', async () => {
    vi.stubEnv('BROWSER', 'firefox');
    const removed: unknown[] = [];
    browser.permissions.remove = ((p: unknown) => {
      removed.push(p);
      return Promise.resolve(true);
    }) as typeof browser.permissions.remove;
    replies.withdrawConsent = () => snapshot({ reason: 'noConsent' });
    try {
      const el = mount(<Connection data={data()} params={params} />);
      await settle();
      click(button(el, 'Withdraw consent'));
      await settle();
    } finally {
      vi.unstubAllEnvs();
    }
    expect(sent('withdrawConsent')).toHaveLength(1);
    expect(removed).toEqual([{ data_collection: ['websiteContent', 'authenticationInfo'] }]);
  });

  it('Connection: the model list failure shows clef-flash and Retry', async () => {
    replies.listModels = () => ({ error: 'modelError' });
    const el = mount(<Connection data={data()} params={params} />);
    await settle();
    expect(text(el)).toContain("Couldn't load models. Using clef-flash.");
    click(button(el, 'Retry'));
    await settle();
    expect(sent('listModels')).toContainEqual({ refresh: true });
  });

  it('Connection: a stored model missing from the list is not labelled as reading thumbnails', async () => {
    const settings = { ...fake.settings, consent: { version: CONSENT_VERSION, acceptedAt: 1 }, models: { text: 'cloudflare/clef-flash', image: 'acme/unlisted' } };
    const el = mount(<Connection data={data({ settings })} params={params} />);
    await settle();
    const option = [...el.querySelectorAll('option')].find((o) => o.value === 'acme/unlisted');
    expect(option?.textContent).toBe('acme/unlisted');
  });

  it('Connection: offline disables Connect', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const el = mount(<Connection data={data({ key: { error: 'noKey' }, keyStatus: 'none' })} params={params} />);
    await settle();
    expect(text(el)).toContain("You're offline. Connect when you're back online.");
    expect(button(el, 'Connect OpenRouter').disabled).toBe(true);
  });

  it('Connection: host access lost shows Allow access, which asks for the hosts first', async () => {
    const el = mount(<Connection data={data({ runtime: snapshot({ reason: 'hostRevoked', eye: 'error' }) })} params={params} />);
    await settle();
    click(button(el, 'Allow access'));
    expect(permissionRequests).toEqual([{ origins: ['https://www.youtube.com/*', 'https://openrouter.ai/*'] }]);
  });

  it('Connection: missing host access shows Allow access even when another reason outranks hostRevoked', async () => {
    hostsGranted = false;
    const el = mount(<Connection data={data({ runtime: snapshot({ reason: 'noConsent' }) })} params={params} />);
    await settle();
    expect(hasButton(el, 'Allow access')).toBe(true);
  });

  it('Exceptions: a failed read shows the Exceptions load error', async () => {
    const el = mount(<Exceptions data={data({ exceptions: undefined, exceptionsError: true })} params={params} />);
    await settle();
    expect(text(el)).toContain("Couldn't load Exceptions. Reload the page to try again.");
  });

  it('Add a Rule: Enter on Cancel cancels instead of saving', async () => {
    const el = mount(<Rules data={data()} params={params} />);
    await settle();
    click(button(el, 'Add a Rule'));
    type(el.querySelector('#add-remove-text') as HTMLInputElement, 'Prank videos');
    key(button(el, 'Cancel'), 'Enter');
    await settle();
    expect(sent('mutateRules')).toEqual([]);
  });

  it('Advanced import shows "Checking file…" then the error with details', async () => {
    let finish: (v: unknown) => void = () => {};
    replies.importData = () => new Promise((r) => (finish = r)) as never;
    const el = mount(<Advanced data={data()} params={params} />);
    await settle();
    const input = el.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([JSON.stringify(EMPTY_EXPORT)], 'x.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(text(el)).toContain('Checking file…');
    finish({ error: 'invalidInput', detail: 'syncQuota' });
    await settle();
    expect(text(el)).toContain("This file isn't a Shoo export, or it's from a newer version.");
    expect(text(el)).toContain('syncQuota');
  });

  it('Advanced import checks the file itself and sends nothing for one that is not a Shoo export', async () => {
    const el = mount(<Advanced data={data()} params={params} />);
    await settle();
    const input = el.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['{"format":"nope"}'], 'x.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(text(el)).toContain("This file isn't a Shoo export, or it's from a newer version.");
    expect(text(el)).toContain('format');
    expect(sent('importData')).toEqual([]);
  });
});

const EMPTY_EXPORT = { format: 'shoo-rules', version: 1, rules: [], exceptions: [] };

describe('Advanced import modes', () => {
  async function pickFile(el: HTMLElement, content: object = EMPTY_EXPORT) {
    const input = el.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([JSON.stringify(content)], 'rules.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
  }

  it('dry-runs Replace before offering it, shows what it deletes, and applies only the previewed mode', async () => {
    replies.importData = (req: { mode: 'merge' | 'replace'; dryRun: boolean }) =>
      ({ preview: { add: 2, update: 1, renumber: 0, invalid: [], ...(req.mode === 'replace' ? { remove: { rules: 5, exceptions: 3 } } : {}) } }) as never;
    const el = mount(<Advanced data={data()} params={params} />);
    await settle();
    await pickFile(el);
    expect(sent('importData')).toEqual([expect.objectContaining({ mode: 'merge', dryRun: true })]);
    expect(text(el)).not.toContain('Replace deletes your current');
    click(button(el, 'Preview Replace'));
    await settle();
    expect(sent('importData')[1]).toEqual(expect.objectContaining({ mode: 'replace', dryRun: true }));
    expect(text(el)).toContain('Replace deletes your current Rules (5) and Exceptions (3) first.');
    click(button(el, 'Replace my Rules'));
    await settle();
    expect(sent('importData')[2]).toEqual(expect.objectContaining({ mode: 'replace', dryRun: false }));
    expect(text(el)).toContain('Imported.');
  });

  it("asks for the image hosts of the file's enabled Thumbnail rules when the import is applied", async () => {
    replies.importData = () => ({ preview: { add: 2, update: 0, renumber: 0, invalid: [] } }) as never;
    const thumbnail = { id: 'thumb-1', ref: 'R1', polarity: 'remove', kind: 'thumbnail', text: 'Shocked faces', enabled: true, site: 'youtube', origin: 'user', createdAt: 1, updatedAt: 1 };
    const el = mount(<Advanced data={data()} params={params} />);
    await settle();
    await pickFile(el, { ...EMPTY_EXPORT, rules: [thumbnail, { ...thumbnail, id: 'thumb-2', ref: 'R2', site: 'bilibili', enabled: false }] });
    expect(sent('importData')[0]).toEqual(expect.objectContaining({ file: expect.objectContaining({ invalid: [] }) }));
    expect(permissionRequests).toEqual([]);
    click(button(el, 'Merge with my Rules'));
    await settle();
    expect(permissionRequests).toEqual([{ origins: ['https://i.ytimg.com/*'] }]);
  });

  it('warns and blocks the apply when the result would not fit browser sync', async () => {
    replies.importData = () => ({ preview: { add: 200, update: 0, renumber: 0, invalid: [], syncQuota: true } }) as never;
    const el = mount(<Advanced data={data()} params={params} />);
    await settle();
    await pickFile(el);
    expect(text(el)).toContain("This won't fit in browser sync storage, so the import would fail.");
    expect(button(el, 'Merge with my Rules').disabled).toBe(true);
    click(button(el, 'Merge with my Rules'));
    await settle();
    expect(sent('importData').filter((r) => !(r as { dryRun: boolean }).dryRun)).toEqual([]);
  });
});

describe('Try a title', () => {
  it('without consent shows the consent link and never sends tryTitle', async () => {
    const go = vi.fn();
    const el = mount(<TryTitle consent={false} rules={[]} onGiveConsent={go} />);
    const title = el.querySelector('#try-title') as HTMLInputElement;
    expect(title.disabled).toBe(true);
    key(title, 'Enter');
    click(button(el, 'Give consent to try titles'));
    await settle();
    expect(go).toHaveBeenCalledOnce();
    expect(sent('tryTitle')).toEqual([]);
  });

  it('rejects a non-YouTube URL in the form and sends nothing', async () => {
    const el = mount(<TryTitle consent rules={[]} onGiveConsent={vi.fn()} />);
    type(el.querySelector('#try-title') as HTMLInputElement, 'I tried day trading');
    type(el.querySelector('#try-url') as HTMLInputElement, 'https://example.com/video');
    expect(text(el)).toContain('Use a YouTube video URL or an i.ytimg.com thumbnail URL.');
    expect(button(el, 'Try').disabled).toBe(true);
    key(el.querySelector('#try-title')!, 'Enter');
    await settle();
    expect(sent('tryTitle')).toEqual([]);
  });

  it('asks which Site the video is on once a Rule works on one Site only, and tries a Bilibili title without a URL', async () => {
    replies.tryTitle = () => ({ result: { videoId: 'x', status: 'decided', verdict: { videoId: 'x', outcome: 'keep', source: 'model', rulesVersion: 'v', at: 1 } }, costUsd: 0 });
    const plain = mount(<TryTitle consent rules={[rule({ id: 'a', ref: 'R1' })]} onGiveConsent={vi.fn()} />);
    expect(text(plain)).not.toContain('Try it as a video on');
    unmountAll();
    const el = mount(<TryTitle consent rules={[rule({ id: 'b', ref: 'R2', site: 'bilibili' })]} onGiveConsent={vi.fn()} />);
    expect(text(el)).toContain('Try it as a video on');
    click([...el.querySelectorAll('[role="radio"]')].find((r) => text(r) === 'Bilibili')!);
    await settle();
    expect(el.querySelector('#try-url')).toBeNull();
    type(el.querySelector('#try-title') as HTMLInputElement, '新番导视');
    key(el.querySelector('#try-title')!, 'Enter');
    await settle();
    expect(sent('tryTitle')).toEqual([{ title: '新番导视', site: 'bilibili' }]);
  });

  it('sends the title, channel and only the derived thumbnail URL, then shows the Verdict', async () => {
    const r2 = rule({ id: 'r2', ref: 'R2', colour: 'c2', name: 'Crypto', text: 'Crypto, day trading, or get-rich-quick finance' });
    replies.tryTitle = () => ({
      result: { videoId: 'x', status: 'decided', verdict: { videoId: 'x', outcome: 'remove', ruleId: 'r2', ruleRef: 'R2', probability: 0.91, source: 'model', rulesVersion: 'v', at: 1 } },
      costUsd: 0.00001,
    });
    const el = mount(<TryTitle consent rules={[r2]} onGiveConsent={vi.fn()} />);
    type(el.querySelector('#try-title') as HTMLInputElement, 'I tried day trading for 30 days');
    type(el.querySelector('#try-channel') as HTMLInputElement, 'Max Hustle');
    type(el.querySelector('#try-url') as HTMLInputElement, 'https://youtu.be/dQw4w9WgXcQ');
    key(el.querySelector('#try-title')!, 'Enter');
    await settle();
    expect(sent('tryTitle')).toEqual([{ title: 'I tried day trading for 30 days', channelName: 'Max Hustle', thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg' }]);
    // The pill drops the ref, the decided-by line names the Rule with its swatch.
    const pill = el.querySelector('[aria-label="Verdict: Remove, Rule: Crypto, 91 percent"]')!;
    expect(text(pill)).toBe('Remove · 91%');
    const decided = el.querySelector('[role="status"] p')!;
    expect(text(decided)).toBe('Decided by Crypto: Crypto, day trading, or get-rich-quick finance');
    expect(decided.querySelector('[data-colour="c2"]')).not.toBeNull();
    expect(text(el)).not.toContain('R2');
  });

  it('names an unnamed deciding Rule by its text', async () => {
    const r2 = rule({ id: 'r2', ref: 'R2', colour: 'c2', text: 'Crypto, day trading, or get-rich-quick finance' });
    replies.tryTitle = () => ({
      result: { videoId: 'x', status: 'decided', verdict: { videoId: 'x', outcome: 'remove', ruleId: 'r2', ruleRef: 'R2', probability: 0.91, source: 'model', rulesVersion: 'v', at: 1 } },
      costUsd: 0.00001,
    });
    const el = mount(<TryTitle consent rules={[r2]} onGiveConsent={vi.fn()} />);
    type(el.querySelector('#try-title') as HTMLInputElement, 'I tried day trading for 30 days');
    key(el.querySelector('#try-title')!, 'Enter');
    await settle();
    expect(el.querySelector('[aria-label="Verdict: Remove, Rule: Crypto, day trading, or get-rich-quick finance, 91 percent"]')).not.toBeNull();
    expect(text(el.querySelector('[role="status"] p')!)).toBe('Decided by Crypto, day trading, or get-rich-quick finance');
  });

  it.each([
    ['noKey', 'Connect OpenRouter in Connection to try titles.'],
    ['offline', "You're offline. Try again when you're back online."],
    ['dailyCap', 'The Daily cap is reached. Try again after midnight.'],
    ['modelError', "OpenRouter didn't answer. Try again."],
  ] as const)('names the reason when it fails: %s', async (error, copy) => {
    replies.tryTitle = () => ({ error });
    const el = mount(<TryTitle consent rules={[]} onGiveConsent={vi.fn()} />);
    type(el.querySelector('#try-title') as HTMLInputElement, 'A title');
    key(el.querySelector('#try-title')!, 'Enter');
    await settle();
    expect(text(el)).toContain(copy);
  });
});

describe('Rules table', () => {
  const rules = [
    rule({ id: 'a', ref: 'R1', colour: 'c1', text: 'Reaction videos' }),
    rule({ id: 'b', ref: 'R2', colour: 'c2', text: 'Crypto' }),
    rule({ id: 'c', ref: 'R3', colour: 'c3', text: 'Gossip', enabled: false }),
    rule({ id: 'd', ref: 'R4', colour: 'c4', kind: 'channel', text: 'Hustle Daily', params: { channelName: 'Hustle Daily' } }),
  ];

  it('sorts by activity this week and sinks switched-off Rules', async () => {
    const now = Date.now();
    fake.ruleStats = { a: { days: {}, total: 1, lastHitAt: 0 }, b: { days: { [new Date(now).toISOString().slice(0, 10)]: 0 }, total: 0, lastHitAt: 0 } };
    const day = new Date(now);
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    fake.ruleStats = { b: { days: { [key]: 12 }, total: 12, lastHitAt: now }, c: { days: { [key]: 40 }, total: 40, lastHitAt: now }, d: { days: { [key]: 4 }, total: 4, lastHitAt: now } };
    const el = mount(<Rules data={data({ rules })} params={params} />);
    await settle();
    const refs = [...el.querySelectorAll('tbody tr td:first-child')].map(text);
    expect(refs).toEqual(['R2', 'R4', 'R1', 'R3']);
    expect(text(el)).toContain("Don't recommend channel");
  });

  it('inline edit saves on Enter, the switch and delete send mutateRules', async () => {
    replies.mutateRules = () => ({ rules, rulesVersion: 'v' });
    const el = mount(<Rules data={data({ rules: rules.slice(0, 1) })} params={params} />);
    await settle();
    const input = el.querySelector('input[aria-label="R1 description"]') as HTMLInputElement;
    type(input, 'Reaction and commentary videos');
    act(input, 'blur');
    await settle();
    click(el.querySelector('[role="switch"][aria-label="R1 on"]')!);
    await settle();
    click(button(el, 'Expand R1'));
    await settle();
    click(button(el, 'Delete R1'));
    await settle();
    expect(sent('mutateRules')).toEqual([
      { ops: [{ op: 'update', id: 'a', patch: { text: 'Reaction and commentary videos' } }] },
      { ops: [{ op: 'update', id: 'a', patch: { enabled: false } }] },
      { ops: [{ op: 'delete', id: 'a' }] },
    ]);
  });

  it('the expanded row switches skipping Subscribed channels and says what Shoo read, Banned channels offer none', async () => {
    replies.mutateRules = () => ({ rules, rulesVersion: 'v' });
    const el = mount(<Rules data={data({ rules: [rules[0]!, { ...rules[1]!, skipSubscribed: true }, rules[3]!] })} params={params} />);
    await settle();
    fake.subscriptions = { list: { ids: ['UC1', 'UC2'], handles: ['one'], keys: ['one', 'two'], readAt: Date.now() }, triedAt: Date.now(), failures: 0 };
    expect(text(el)).toContain('Skips subscribed channels');
    click(button(el, 'Expand R2'));
    await settle();
    expect(text(el)).toContain('Skips 2 subscribed channels, read from YouTube');
    click(button(el, 'Expand R1'));
    await settle();
    const skip = el.querySelector('[role="switch"][aria-labelledby="rule-skip-a"]') as HTMLElement;
    expect(skip.getAttribute('aria-checked')).toBe('false');
    click(skip);
    await settle();
    expect(sent('mutateRules')).toEqual([{ ops: [{ op: 'update', id: 'a', patch: { skipSubscribed: true } }] }]);
    click(button(el, 'Expand R4'));
    await settle();
    expect(el.querySelector('[aria-labelledby="rule-skip-d"]')).toBeNull();
  });

  it('a Rule that works only on Bilibili offers no skipping of Subscribed channels, which are YouTube\'s list', async () => {
    const el = mount(<Rules data={data({ rules: [{ ...rules[0]!, site: 'bilibili', skipSubscribed: true }] })} params={params} />);
    await settle();
    expect(text(el)).not.toContain('Skips subscribed channels');
    click(button(el, 'Expand R1'));
    await settle();
    expect(el.querySelector('[aria-labelledby="rule-skip-a"]')).toBeNull();
  });

  it('names a Rule inline: saves on blur, Escape reverts, an empty name clears it, channel Rules have none', async () => {
    replies.mutateRules = () => ({ rules, rulesVersion: 'v' });
    const named = [{ ...rules[0]!, name: 'Reaction' }, rules[1]!, rules[3]!];
    const el = mount(<Rules data={data({ rules: named })} params={params} />);
    await settle();
    const r1 = el.querySelector('input[aria-label="R1 name"]') as HTMLInputElement;
    const r2 = el.querySelector('input[aria-label="R2 name"]') as HTMLInputElement;
    expect(r1.value).toBe('Reaction');
    expect(r1.maxLength).toBe(40);
    expect(r2.value).toBe('');
    expect(r2.placeholder).toBe('Add a name');
    expect(el.querySelector('input[aria-label="R4 name"]')).toBeNull();
    // The name sits above the text in the Rule cell.
    expect(r1.compareDocumentPosition(el.querySelector('input[aria-label="R1 description"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    type(r2, '  Crypto ');
    act(r2, 'blur');
    await settle();
    type(r1, 'Something else');
    key(r1, 'Escape');
    expect(r1.value).toBe('Reaction');
    act(r1, 'blur');
    await settle();
    type(r1, '');
    act(r1, 'blur');
    await settle();
    expect(sent('mutateRules')).toEqual([
      { ops: [{ op: 'update', id: 'b', patch: { name: 'Crypto' } }] },
      { ops: [{ op: 'update', id: 'a', patch: { name: '' } }] },
    ]);
  });

  it('a soft hint shows while editing a Topic rule that reads as an order or a negation, and never blocks saving', async () => {
    replies.mutateRules = () => ({ rules, rulesVersion: 'v' });
    const el = mount(<Rules data={data({ rules: rules.slice(0, 1) })} params={params} />);
    await settle();
    const input = el.querySelector('input[aria-label="R1 description"]') as HTMLInputElement;
    const status = el.querySelector('#rule-hint-a')!;
    expect(status.getAttribute('role')).toBe('status');
    act(input, 'focus');
    type(input, 'No gaming videos except speedruns');
    expect(text(status)).toContain('Describe the videos instead of giving an order');
    expect(text(status)).toContain('Shoo reads “not” and “except” poorly.');
    expect(input.getAttribute('aria-describedby')).toBe('rule-hint-a');
    act(input, 'blur');
    await settle();
    expect(text(status)).toBe('');
    expect(sent('mutateRules')).toEqual([{ ops: [{ op: 'update', id: 'a', patch: { text: 'No gaming videos except speedruns' } }] }]);
  });

  it('shows the soft limit counter from 150 characters', async () => {
    const el = mount(<Rules data={data({ rules: rules.slice(0, 1) })} params={params} />);
    await settle();
    const input = el.querySelector('input[aria-label="R1 description"]') as HTMLInputElement;
    type(input, 'x'.repeat(149));
    expect(text(el)).not.toContain('of 200');
    type(input, 'x'.repeat(210));
    expect(text(el)).toContain('210 of 200');
    expect(text(el)).toContain('Shorter Rules work better.');
  });

  it('expanded row shows the thumbnail wall from removed events this week', async () => {
    fake.activity = [
      { id: 'e1', kind: 'removed', at: Date.now(), videoId: 'aaaaaaaaaaa', title: 'Streamer reacts', ruleId: 'a' },
      { id: 'e2', kind: 'wouldRemove', at: Date.now(), videoId: 'bbbbbbbbbbb', title: 'Other', ruleId: 'a' },
    ];
    fake.ruleStats = { a: { days: {}, total: 31, lastHitAt: Date.now() } };
    const el = mount(<Rules data={data({ rules: rules.slice(0, 1) })} params={params} />);
    await settle();
    click(button(el, 'Expand R1'));
    await settle();
    const imgs = [...el.querySelectorAll('ul img')] as HTMLImageElement[];
    expect(imgs.map((i) => i.src)).toEqual(['https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg']);
    expect(fake.queries.at(-1)).toMatchObject({ kinds: ['removed'], ruleId: 'a' });
    expect(text(el)).toContain('31 all time');
  });

  it('Add a Rule works on all sites unless a Site is unchecked, and a kind bound to YouTube shows that instead of a choice', async () => {
    replies.mutateRules = () => ({ rules, rulesVersion: 'v' });
    const el = mount(<Rules data={data({ rules: rules.slice(0, 1) })} params={params} />);
    await settle();
    click(button(el, 'Add a Rule'));
    await settle();
    const box = (site: string) => el.querySelector(`#add-remove-site-${site}`) as HTMLInputElement;
    expect([box('youtube').checked, box('bilibili').checked]).toEqual([true, true]);
    click(box('youtube'));
    await settle();
    expect(box('bilibili').disabled).toBe(true);
    type(el.querySelector('#add-remove-text') as HTMLInputElement, 'Anime openings');
    click(button(el, 'Save'));
    await settle();
    expect(sent('mutateRules')).toEqual([{ ops: [{ op: 'add', rule: { polarity: 'remove', kind: 'topic', text: 'Anime openings', enabled: true, origin: 'user', site: 'bilibili' } }] }]);
    click(button(el, 'Add a Rule'));
    await settle();
    act(el.querySelector('#add-remove-kind') as HTMLSelectElement, 'change', 'short');
    await settle();
    expect([box('youtube').checked, box('bilibili').checked]).toEqual([true, false]);
    expect([box('youtube').disabled, box('bilibili').disabled]).toEqual([true, true]);
  });

  it('saving a Thumbnail rule asks for the image hosts in the click, and saves it even when the browser says no', async () => {
    browser.permissions.request = ((p: unknown) => {
      permissionRequests.push(p);
      return Promise.resolve(false);
    }) as typeof browser.permissions.request;
    replies.mutateRules = () => ({ rules, rulesVersion: 'v' });
    const el = mount(<Rules data={data({ rules })} params={params} />);
    await settle();
    click(button(el, 'Add a Rule'));
    await settle();
    act(el.querySelector('#add-remove-kind') as HTMLSelectElement, 'change', 'thumbnail');
    await settle();
    type(el.querySelector('#add-remove-text') as HTMLInputElement, 'A person pointing at a red arrow');
    click(button(el, 'Save'));
    expect(permissionRequests).toEqual([{ origins: ['https://i.ytimg.com/*', 'https://i0.hdslb.com/*'] }]);
    await settle();
    expect(sent('mutateRules')).toEqual([{ ops: [{ op: 'add', rule: { polarity: 'remove', kind: 'thumbnail', text: 'A person pointing at a red arrow', enabled: true, origin: 'user' } }] }]);
  });

  it("turning on a YouTube-only Thumbnail rule asks for YouTube's image host only, and a Topic rule asks for nothing", async () => {
    replies.mutateRules = () => ({ rules, rulesVersion: 'v' });
    const thumb = rule({ id: 't', ref: 'R6', colour: 'c6', kind: 'thumbnail', text: 'A red arrow', enabled: false, site: 'youtube' });
    const el = mount(<Rules data={data({ rules: [...rules, thumb] })} params={params} />);
    await settle();
    click(el.querySelector('[role="switch"][aria-label="R3 on"]')!);
    expect(permissionRequests).toEqual([]);
    click(el.querySelector('[role="switch"][aria-label="R6 on"]')!);
    expect(permissionRequests).toEqual([{ origins: ['https://i.ytimg.com/*'] }]);
  });

  it('a Site-only rule says so on its row, and its panel makes it work on all sites again', async () => {
    replies.mutateRules = () => ({ rules, rulesVersion: 'v' });
    const only = rule({ id: 'e', ref: 'R5', colour: 'c5', text: 'Anime openings', site: 'bilibili' });
    const el = mount(<Rules data={data({ rules: [only, rules[0]!] })} params={params} />);
    await settle();
    const row = (ref: string) => [...el.querySelectorAll('tbody tr')].find((r) => text(r.querySelector('td')!) === ref)!;
    expect(text(row('R5'))).toContain('Bilibili only');
    expect(text(row('R1'))).not.toContain('only');
    click(button(el, 'Expand R5'));
    await settle();
    click(el.querySelector('#works-on-e-youtube') as HTMLInputElement);
    await settle();
    expect(sent('mutateRules')).toEqual([{ ops: [{ op: 'update', id: 'e', patch: { site: null } }] }]);
  });

  it("a channel Rule made from a video keeps its video's Site, and its panel says why", async () => {
    const fromVideo = rule({ id: 'f', ref: 'R6', colour: 'c6', kind: 'channel', text: 'Up', params: { channelName: 'Up', channelId: '10000001' }, site: 'bilibili' });
    const el = mount(<Rules data={data({ rules: [fromVideo] })} params={params} />);
    await settle();
    click(button(el, 'Expand R6'));
    await settle();
    expect(text(el)).toContain('This channel is on Bilibili, so the Rule works there only.');
    expect([...el.querySelectorAll<HTMLInputElement>('input[id^="works-on-f-"]')].map((b) => [b.checked, b.disabled])).toEqual([
      [false, true],
      [true, true],
    ]);
  });

  it('Add a Rule takes an optional name with its help text, kind placeholders, and soft hints that never block saving', async () => {
    replies.mutateRules = ({ ops }) => {
      const op = ops[0]!;
      if (op.op !== 'add') throw new Error('unexpected');
      return { rules: [{ ...op.rule, id: 'n', ref: 'R9', colour: 'c9', createdAt: 9, updatedAt: 9 }], rulesVersion: 'v' };
    };
    const el = mount(<Rules data={data({ rules: rules.slice(0, 1) })} params={params} />);
    await settle();
    click(button(el, 'Add a Rule'));
    const textField = el.querySelector('#add-remove-text') as HTMLInputElement;
    const nameField = el.querySelector('#add-remove-name') as HTMLInputElement;
    expect(textField.placeholder).toBe('Unboxing videos and hauls');
    expect(nameField.placeholder).toBe('Add a name');
    expect(nameField.maxLength).toBe(40);
    expect(text(el.querySelector(`#${nameField.getAttribute('aria-describedby')}`)!)).toBe('Shown on the video instead of the whole Rule. The model never sees it.');
    const kind = el.querySelector('#add-remove-kind') as HTMLSelectElement;
    act(kind, 'change', 'keyword');
    expect((el.querySelector('#add-remove-text') as HTMLInputElement).placeholder).toBe('A word in titles');
    act(kind, 'change', 'thumbnail');
    expect((el.querySelector('#add-remove-text') as HTMLInputElement).placeholder).toBe('A person pointing at a red arrow');
    act(kind, 'change', 'channel');
    expect(el.querySelector('#add-remove-name')).toBeNull();
    act(kind, 'change', 'topic');
    type(el.querySelector('#add-remove-text') as HTMLInputElement, 'No unboxing videos');
    const hint = el.querySelector('#add-remove-hint')!;
    expect(hint.getAttribute('role')).toBe('status');
    expect(text(hint)).toContain('Describe the videos instead of giving an order');
    type(el.querySelector('#add-remove-name') as HTMLInputElement, 'Unboxing');
    click(button(el, 'Save'));
    await settle();
    expect(sent('mutateRules')).toEqual([
      { ops: [{ op: 'add', rule: { polarity: 'remove', kind: 'topic', text: 'No unboxing videos', name: 'Unboxing', enabled: true, origin: 'user' } }] },
    ]);
    expect(text(el)).toContain('Rule added');
  });

  it('adds a views Rule from bounds typed as 10k and 1.5m, and holds Save while a bound is not a count', async () => {
    const el = mount(<Rules data={data({ rules: [] })} params={params} />);
    await settle();
    click(button(el, 'Add a Rule'));
    const kind = el.querySelector('#add-remove-kind') as HTMLSelectElement;
    expect([...kind.options].find((o) => o.value === 'views')?.textContent).toBe('Views');
    act(kind, 'change', 'views');
    expect(el.querySelector('#add-remove-text')).toBeNull();
    expect(text(el)).toContain('Type 10k or 1.5m for thousands or millions.');
    const bound = (label: string) => [...el.querySelectorAll('label')].find((l) => text(l) === label)!.querySelector('input')!;
    type(bound('At least (views)'), '10k');
    type(bound('At most (views)'), 'lots');
    expect(button(el, 'Save').disabled).toBe(true);
    type(bound('At most (views)'), '1.5m');
    click(button(el, 'Save'));
    await settle();
    expect(sent('mutateRules')).toEqual([
      {
        ops: [
          {
            op: 'add',
            rule: { polarity: 'remove', kind: 'views', text: 'Between 10k and 1.5m views', params: { minViews: 10_000, maxViews: 1_500_000 }, enabled: true, origin: 'user' },
          },
        ],
      },
    ]);
  });

  it('announces each added Rule by its name or text, so a second add in the same visit is announced too', async () => {
    let n = 0;
    replies.mutateRules = ({ ops }) => {
      const op = ops[0]!;
      if (op.op !== 'add') throw new Error('unexpected');
      n += 1;
      return { rules: [{ ...op.rule, id: `n${n}`, ref: `R${8 + n}`, colour: 'c9', createdAt: 9 + n, updatedAt: 9 + n }], rulesVersion: 'v' };
    };
    const el = mount(<Rules data={data({ rules: rules.slice(0, 1) })} params={params} />);
    await settle();
    const add = async (ruleText: string, name?: string) => {
      click(button(el, 'Add a Rule'));
      type(el.querySelector('#add-remove-text') as HTMLInputElement, ruleText);
      if (name) type(el.querySelector('#add-remove-name') as HTMLInputElement, name);
      click(button(el, 'Save'));
      await settle();
    };
    await add('Unboxing videos and hauls', 'Unboxing');
    expect(text(el.querySelector('p[role="status"].sr-only')!)).toBe('Rule added: Unboxing');
    await add('Crypto price predictions');
    expect(text(el.querySelector('p[role="status"].sr-only')!)).toBe('Rule added: Crypto price predictions');
  });

  it('Rule name fields take their direction from what is typed, inline and in Add a Rule', async () => {
    const el = mount(<Rules data={data({ rules: rules.slice(0, 1) })} params={params} />);
    await settle();
    expect(el.querySelector('input[aria-label="R1 name"]')!.getAttribute('dir')).toBe('auto');
    click(button(el, 'Add a Rule'));
    expect(el.querySelector('#add-remove-name')!.getAttribute('dir')).toBe('auto');
  });

  it('Keep rules: a Topic Keep rule gets its own placeholder and no soft hints', async () => {
    const el = mount(<Keep data={data()} params={params} />);
    await settle();
    click(button(el, 'Add a Keep rule'));
    const field = el.querySelector('#add-keep-text') as HTMLInputElement;
    expect(field.placeholder).toBe('Woodworking tutorials');
    type(field, 'No woodworking except tutorials');
    expect(el.querySelector('#add-keep-hint')).toBeNull();
    expect(el.querySelector('#add-keep-name')).not.toBeNull();
  });

  it('How to write a Rule is open while there are no Rules, closed otherwise, and leads to Try a title', async () => {
    const empty = mount(<Rules data={data()} params={params} />);
    await settle();
    const guide = empty.querySelector('details')!;
    expect(text(guide.querySelector('summary')!)).toBe('How to write a Rule');
    expect(guide.open).toBe(true);
    // Seven tips, five with a Try and a Not example.
    expect(guide.querySelectorAll('ul > li')).toHaveLength(7);
    expect(text(guide)).toContain('Try Unboxing videos and hauls');
    expect(text(guide)).toContain('Not No unboxing videos');
    expect(text(guide)).toContain('Give it a name');
    click(button(guide, 'Check a Rule with Try a title below.'));
    expect(document.activeElement).toBe(empty.querySelector('#try-title'));
    unmountAll();
    const some = mount(<Rules data={data({ rules })} params={params} />);
    await settle();
    expect(some.querySelector('details')!.open).toBe(false);
  });

  it('shows the budget meter and the truncation warning', async () => {
    const long = Array.from({ length: 30 }, (_, i) => rule({ id: `t${i}`, ref: `R${i + 1}`, colour: 'c1', text: `${'very long topic rule text '.repeat(12)}${i}` }));
    const el = mount(<Rules data={data({ rules: long })} params={params} />);
    await settle();
    expect(el.querySelector('[role="meter"]')).not.toBeNull();
    expect(text(el)).toContain('reach the model.');
  });
});

describe('Keep rules', () => {
  it('a channel Keep rule for a Banned channel asks to lift the ban', async () => {
    const banned = rule({ id: 'b', ref: 'R5', kind: 'channel', text: 'Hustle Daily', params: { channelName: 'Hustle Daily' }, colour: 'c5' });
    replies.keepChannel = () => ({ ruleId: 'k1', liftedBanRuleId: 'b' });
    const el = mount(<Keep data={data({ rules: [banned] })} params={params} />);
    await settle();
    click(button(el, 'Add a Keep rule'));
    const kind = el.querySelector('#add-keep-kind') as HTMLSelectElement;
    expect([...kind.options].map((o) => o.value)).not.toContain('thumbnail');
    act(kind, 'change', 'channel');
    type(el.querySelector('#add-keep-text') as HTMLInputElement, 'hustle daily');
    click(button(el, 'Save'));
    await settle();
    expect(text(el)).toContain('Lift the ban on hustle daily too?');
    expect(sent('keepChannel')).toEqual([]);
    click(button(el, 'Lift the ban'));
    await settle();
    expect(sent('keepChannel')).toEqual([{ channelName: 'hustle daily', liftBan: true }]);
  });

  it('offers an Artist channel Keep rule with no text field and saves it with its default text', async () => {
    const el = mount(<Keep data={data({ rules: [] })} params={params} />);
    await settle();
    click(button(el, 'Add a Keep rule'));
    const kind = el.querySelector('#add-keep-kind') as HTMLSelectElement;
    expect([...kind.options].find((o) => o.value === 'artistChannel')?.textContent).toBe('Artist channel');
    act(kind, 'change', 'artistChannel');
    expect(el.querySelector('#add-keep-text')).toBeNull();
    expect(text(el)).toContain("Keeps videos from channels with YouTube's music-note artist badge.");
    click(button(el, 'Save'));
    await settle();
    const [req] = sent('mutateRules') as { ops: { op: string; rule: Partial<Rule> }[] }[];
    expect(req!.ops[0]!.rule).toMatchObject({ polarity: 'keep', kind: 'artistChannel', text: 'Artist channels' });
  });

  it('expanded Keep rule shows the videos it kept this week', async () => {
    fake.activity = [
      { id: 'e1', kind: 'keptByRule', at: Date.now(), videoId: 'aaaaaaaaaaa', title: 'アポカリプスより', ruleId: 'k', source: 'keepRule', seenAt: Date.now() },
      // The same video kept again on another day (one event per day): one thumbnail.
      { id: 'e0', kind: 'keptByRule', at: Date.now() - 1000, videoId: 'aaaaaaaaaaa', title: 'アポカリプスより', ruleId: 'k', source: 'keepRule', seenAt: Date.now() },
      { id: 'e2', kind: 'kept', at: Date.now(), videoId: 'bbbbbbbbbbb', title: 'Other', ruleId: 'k' },
    ];
    const el = mount(<Keep data={data({ rules: [rule({ id: 'k', ref: 'K1', polarity: 'keep', kind: 'artistChannel', text: 'Artist channels' })] })} params={params} />);
    await settle();
    expect(text(el)).toContain('Artist channel');
    click(button(el, 'Expand K1'));
    await settle();
    expect(fake.queries.at(-1)).toMatchObject({ kinds: ['keptByRule'], ruleId: 'k' });
    const wall = el.querySelector('ul[aria-label="Kept this week"]')!;
    expect([...wall.querySelectorAll('img')].map((i) => i.getAttribute('alt'))).toEqual(['アポカリプスより']);
    expect(text(el)).toContain('See all 2 in Activity');
  });

  it('asks when only the background knows the ban, then sends again with the answer', async () => {
    replies.keepChannel = (req) => (req.liftBan === undefined ? { ruleId: '', bannedRuleId: 'b' } : { ruleId: 'k1', bannedRuleId: 'b' });
    const el = mount(<Keep data={data({ rules: [] })} params={params} />);
    await settle();
    click(button(el, 'Add a Keep rule'));
    act(el.querySelector('#add-keep-kind') as HTMLSelectElement, 'change', 'channel');
    type(el.querySelector('#add-keep-text') as HTMLInputElement, 'Hustle Daily');
    click(button(el, 'Save'));
    await settle();
    expect(text(el)).toContain('Lift the ban on Hustle Daily too?');
    click(button(el, 'Keep the ban'));
    await settle();
    expect(sent('keepChannel')).toEqual([{ channelName: 'Hustle Daily' }, { channelName: 'Hustle Daily', liftBan: false }]);
    expect(text(el)).not.toContain('Lift the ban on');
  });
});

describe('Banned channels', () => {
  it('name the Site each ban works on', async () => {
    const bans = [
      rule({ id: 'g', ref: 'R7', colour: 'c7', kind: 'channel', text: 'Up', params: { channelName: 'Up', channelId: '10000001' }, site: 'bilibili' }),
      rule({ id: 'h', ref: 'R8', colour: 'c8', kind: 'channel', text: 'Hustle Daily', params: { channelName: 'Hustle Daily' } }),
    ];
    const el = mount(<Banned data={data({ rules: bans })} params={params} />);
    await settle();
    const cells = [...el.querySelectorAll('tbody tr')].map((r) => [...r.querySelectorAll('td')].slice(1, 3).map(text));
    expect(cells).toEqual([
      ['Up', 'Bilibili'],
      ['Hustle Daily', 'All sites'],
    ]);
  });
});

describe('Exceptions', () => {
  it('searches and deletes', async () => {
    const exceptions = [
      { videoId: 'v1', title: 'Musician reacts to a classic rock ballad', channelName: 'Vocal Coach Ana', ruleId: 'a', at: 1 },
      { videoId: 'v2', title: 'Sourdough fermentation', channelName: 'Food Science Lab', at: 2 },
    ];
    const el = mount(<Exceptions data={data({ exceptions, rules: [rule({ id: 'a', ref: 'R1', colour: 'c1', name: 'Reactions' })] })} params={params} />);
    await settle();
    expect(text(el)).toContain('Reactions wanted it gone');
    expect(text(el)).not.toContain('R1');
    type(el.querySelector('input[type="search"]') as HTMLInputElement, 'sourdough');
    expect(el.querySelectorAll('li').length).toBe(1);
    click(button(el, 'Delete'));
    await settle();
    expect(sent('removeException')).toEqual([{ videoId: 'v2' }]);
  });

  it('renders a page of rows at a time, and search looks through all of them', async () => {
    const exceptions = Array.from({ length: EXCEPTIONS_PAGE * 2 + 5 }, (_, i) => ({ videoId: `v${i}`, title: `Kept video ${i}`, channelName: 'Channel', at: i }));
    const el = mount(<Exceptions data={data({ exceptions })} params={params} />);
    await settle();
    expect(el.querySelectorAll('li').length).toBe(EXCEPTIONS_PAGE);
    click(button(el, 'Show more'));
    expect(el.querySelectorAll('li').length).toBe(EXCEPTIONS_PAGE * 2);
    click(button(el, 'Show more'));
    expect(el.querySelectorAll('li').length).toBe(EXCEPTIONS_PAGE * 2 + 5);
    expect(hasButton(el, 'Show more')).toBe(false);
    type(el.querySelector('input[type="search"]') as HTMLInputElement, `Kept video ${EXCEPTIONS_PAGE * 2 + 4}`);
    expect([...el.querySelectorAll('li')].map(text)).toEqual([expect.stringContaining(`Kept video ${EXCEPTIONS_PAGE * 2 + 4}`)]);
  });
});

describe('Activity', () => {
  const now = Date.now();
  const events: ActivityEvent[] = [
    { id: 'e1', kind: 'removed', at: now - 60_000, videoId: 'aaaaaaaaaaa', title: 'Streamer reacts to the new trailer', channelName: 'Clip Vault', surface: 'home', ruleId: 'a', batchId: 'b1' },
    { id: 'e2', kind: 'removed', at: now - 2 * 60 * 60 * 1000, videoId: 'bbbbbbbbbbb', title: 'This altcoin will 100x', channelName: 'Crypto Kingz', surface: 'watchSidebar', ruleId: 'a', seenAt: now },
    { id: 'e3', kind: 'wouldRemove', at: now - 120_000, videoId: 'ccccccccccc', title: 'Breakup rumours', surface: 'home', ruleId: 'a', batchId: 'b2', seenAt: now },
  ];

  it('names the Site with each Surface, and filters by Site', async () => {
    fake.activity = [...events, { id: 'e4', kind: 'removed', at: now - 30_000, videoId: 'BV1FIXTURE01', title: '新番导视', channelName: 'Up', surface: 'bilibiliHome', ruleId: 'a' }];
    const el = mount(<Activity data={data({ rules: [rule({ id: 'a', ref: 'R1', colour: 'c1' })] })} params={params} />);
    await settle();
    expect(text(el.querySelector('li[data-activity-id="e4"]')!)).toContain('Up · Bilibili Home');
    expect(text(el.querySelector('li[data-activity-id="e2"]')!)).toContain('Crypto Kingz · YouTube Watch sidebar');
    act(el.querySelector('#activity-site') as HTMLSelectElement, 'change', 'bilibili');
    await settle();
    expect(fake.queries.at(-1)).toMatchObject({ site: 'bilibili' });
  });

  it('groups by day with the shooed count, lights unseen rows and offers the right actions', async () => {
    fake.activity = events;
    fake.counters = { judged: 3, removed: 2, requests: 1, costUsd: 0 };
    const el = mount(
      <Activity data={data({ rules: [rule({ id: 'a', ref: 'R1', colour: 'c1', name: 'Reactions' }), rule({ id: 'k', ref: 'K1', polarity: 'keep', text: 'Speedruns' })] })} params={params} />,
    );
    await settle();
    expect(text(el.querySelector('h3')!)).toBe('Today · 2 shooed');
    // Rows name the Rule, never the ref. The filter groups Rules and Keep rules by name.
    expect(text(el.querySelector('li[data-activity-id="e1"]')!)).toContain('Reactions Removed');
    expect(text(el)).not.toMatch(/\b[RK]1\b/);
    const filter = el.querySelector('#activity-rule') as HTMLSelectElement;
    expect([...filter.querySelectorAll('optgroup')].map((g) => [g.label, [...g.querySelectorAll('option')].map(text)])).toEqual([
      ['Rules', ['Reactions']],
      ['Keep rules', ['Speedruns']],
    ]);
    const rows = [...el.querySelectorAll('li[data-activity-id]')];
    expect(rows.find((r) => r.getAttribute('data-activity-id') === 'e1')!.className).toContain('bg-lit');
    expect(rows.find((r) => r.getAttribute('data-activity-id') === 'e2')!.className).not.toContain('bg-lit');
    const e1 = rows.find((r) => r.getAttribute('data-activity-id') === 'e1')!;
    expect(hasButton(e1, 'Undo')).toBe(true);
    expect(hasButton(e1, 'Always keep this channel')).toBe(true);
    const e2 = rows.find((r) => r.getAttribute('data-activity-id') === 'e2')!;
    expect(hasButton(e2, 'Undo')).toBe(false);
    expect(hasButton(e2, 'Keep')).toBe(true);
  });

  it('shows a Keep rule keep under its Keep rule as Kept by Keep rule, never lit and with no actions', async () => {
    fake.activity = [{ id: 'k1', kind: 'keptByRule', at: now - 60_000, seenAt: now - 60_000, videoId: 'ddddddddddd', title: 'アポカリプスより', channelName: 'KAF', surface: 'home', ruleId: 'k', source: 'keepRule' }];
    const el = mount(<Activity data={data({ rules: [rule({ id: 'k', ref: 'K1', polarity: 'keep', text: 'Music video' })] })} params={params} />);
    await settle();
    const row = el.querySelector('li[data-activity-id="k1"]')!;
    expect(text(row)).toContain('Music video Kept by Keep rule');
    expect(row.className).not.toContain('bg-lit');
    expect(row.querySelectorAll('button')).toHaveLength(0);
    expect([...(el.querySelector('#activity-kind') as HTMLSelectElement).options].map(text)).toContain('Kept by Keep rule');
  });

  it("keeps a channel from a Bilibili row on Bilibili only, reading the Site from the video's id when the row has no Surface", async () => {
    replies.keepChannel = () => ({ ruleId: 'k1' });
    fake.activity = [{ id: 'b1', kind: 'kept', at: now - 60_000, videoId: 'BV1FIXTURE01', title: 'Fixture title', channelName: 'Fixture Uploader', ruleId: 'a' }];
    const el = mount(<Activity data={data({ rules: [rule({ id: 'a', ref: 'R1', colour: 'c1' })] })} params={params} />);
    await settle();
    const row = el.querySelector('li[data-activity-id="b1"]')!;
    click([...row.querySelectorAll('button')].find((b) => text(b).includes('Always keep this channel'))!);
    await settle();
    expect(sent('keepChannel')).toEqual([{ channelName: 'Fixture Uploader', site: 'bilibili' }]);
  });

  it('keeps a channel from a Bilibili row without asking about a same-named ban whose handle puts it on YouTube', async () => {
    replies.keepChannel = () => ({ ruleId: 'k1' });
    const ban = rule({ id: 'b', ref: 'R5', colour: 'c5', kind: 'channel', text: 'Hustle Daily', params: { channelName: 'Hustle Daily', handle: '@hustledaily' } });
    fake.activity = [{ id: 'b1', kind: 'kept', at: now - 60_000, videoId: 'BV1FIXTURE01', title: 'Fixture title', channelName: 'Hustle Daily', ruleId: 'a' }];
    const el = mount(<Activity data={data({ rules: [rule({ id: 'a', ref: 'R1', colour: 'c1' }), ban] })} params={params} />);
    await settle();
    const row = el.querySelector('li[data-activity-id="b1"]')!;
    click([...row.querySelectorAll('button')].find((b) => text(b).includes('Always keep this channel'))!);
    await settle();
    expect(text(el)).not.toContain('Lift the ban on');
    expect(sent('keepChannel')).toEqual([{ channelName: 'Hustle Daily', site: 'bilibili' }]);
  });

  it('drops the shooed count on a day with no Removals (Dry-run only)', async () => {
    fake.activity = [events[2]!];
    const el = mount(<Activity data={data({ rules: [rule({ id: 'a', ref: 'R1', colour: 'c1' })] })} params={params} />);
    await settle();
    expect(text(el.querySelector('h3')!)).toBe('Today');
  });

  it('Undo reports an expired undo honestly, Keep adds an Exception', async () => {
    fake.activity = events;
    replies.undoFromActivity = () => ({ ok: false, reason: 'expired' });
    const el = mount(<Activity data={data({ rules: [rule({ id: 'a', ref: 'R1', colour: 'c1' })] })} params={params} />);
    await settle();
    const e1 = el.querySelector('li[data-activity-id="e1"]')!;
    click(button(e1, 'Undo'));
    await settle();
    expect(sent('undoFromActivity')).toEqual([{ videoId: 'aaaaaaaaaaa' }]);
    expect(text(e1)).toContain("YouTube's Undo has expired for this video.");
    const e3 = el.querySelector('li[data-activity-id="e3"]')!;
    click(button(e3, 'Keep'));
    await settle();
    expect(sent('addException')).toEqual([{ videoId: 'ccccccccccc', title: 'Breakup rumours', ruleId: 'a', origin: 'activityKeep' }]);
  });

  it('filters to one batch from the #activity?batch= deep link', async () => {
    fake.activity = events;
    const el = mount(<Activity data={data()} params={new URLSearchParams('batch=b1')} />);
    await settle();
    expect(fake.queries.at(-1)).toMatchObject({ batchId: 'b1' });
    expect(el.querySelectorAll('li[data-activity-id]').length).toBe(1);
    expect(text(el)).toContain('Showing one batch');
  });

  it('marks unseen rows seen after 1 s in view', async () => {
    const observed: Element[] = [];
    let callback: IntersectionObserverCallback = () => {};
    class FakeIO {
      constructor(cb: IntersectionObserverCallback) {
        callback = cb;
      }
      observe(el: Element) {
        observed.push(el);
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', FakeIO);
    fake.activity = events;
    const el = mount(<Activity data={data()} params={params} />);
    await settle();
    expect(observed.map((o) => o.getAttribute('data-activity-id'))).toEqual(['e1']);
    vi.useFakeTimers();
    callback([{ target: observed[0]!, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
    vi.advanceTimersByTime(900);
    expect(sent('markActivitySeen')).toEqual([]);
    vi.advanceTimersByTime(400);
    expect(sent('markActivitySeen')).toEqual([{ ids: ['e1'] }]);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    void el;
  });

  it('search reads Activity once the typing pauses, not on every keystroke', async () => {
    fake.activity = events;
    const el = mount(<Activity data={data()} params={params} />);
    await settle();
    const search = el.querySelector('input[type="search"]') as HTMLInputElement;
    for (const typed of ['a', 'al', 'alt', 'altc', 'altco']) type(search, typed);
    await settle();
    expect(fake.queries.filter((q) => q.text)).toEqual([]);
    await new Promise((r) => setTimeout(r, SEARCH_PAUSE_MS + 50));
    await settle();
    expect(fake.queries.filter((q) => q.text).map((q) => q.text)).toEqual(['altco']);
  });

  it('a row scrolled away before 1 s stays unseen', async () => {
    const observed: Element[] = [];
    let callback: IntersectionObserverCallback = () => {};
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: IntersectionObserverCallback) {
          callback = cb;
        }
        observe(e: Element) {
          observed.push(e);
        }
        unobserve() {}
        disconnect() {}
      },
    );
    fake.activity = events;
    mount(<Activity data={data()} params={params} />);
    await settle();
    vi.useFakeTimers();
    const entry = (isIntersecting: boolean) => [{ target: observed[0]!, isIntersecting } as unknown as IntersectionObserverEntry];
    callback(entry(true), {} as IntersectionObserver);
    vi.advanceTimersByTime(500);
    callback(entry(false), {} as IntersectionObserver);
    vi.advanceTimersByTime(2000);
    expect(sent('markActivitySeen')).toEqual([]);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});

describe('Connection: where Shoo checks videos (Decision providers)', () => {
  const providers = (el: Element) => [...el.querySelectorAll('input[name="provider"]')].map((r) => text(r.closest('label')!.querySelector('.font-semibold')!));
  const connection = (over: Partial<PageData['settings'] & object> = {}) =>
    mount(<Connection data={data({ settings: { ...fake.settings, consent: { version: CONSENT_VERSION, acceptedAt: 1 }, ...over } })} params={params} />);

  it('offers the same Decision providers as onboarding, with the one in use selected and marked', async () => {
    const el = connection();
    await settle();
    expect(providers(el)).toEqual(['OpenRouter', 'Cloudflare', 'TypeSafe', 'Perplexity', 'Ollama', 'llama.cpp', 'LM Studio']);
    expect(radio(el, 'OpenRouter').checked).toBe(true);
    expect(text(radio(el, 'OpenRouter').closest('label')!)).toContain('In use');
    expect(hasButton(el, 'Disconnect')).toBe(true);
  });

  it('Perplexity: host access first in the click, consent naming the host with What Shoo sends, then saves', async () => {
    replies.giveConsent = () => snapshot();
    replies.setDirectEndpoint = () => ({ ok: true });
    const el = connection();
    await settle();
    click(radio(el, 'Perplexity'));
    expect(hasButton(el, 'Disconnect')).toBe(false);
    expect((el.querySelector('#direct-model') as HTMLInputElement).value).toBe('pplx-decider-v1.1-27b');
    expect(text(el)).toContain('Shoo sends to api.perplexity.ai.');
    expect(text(el)).toContain('Reads thumbnails, so Thumbnail rules work too.');
    type(el.querySelector('#direct-key') as HTMLInputElement, 'pplx-secret');
    click(button(el, 'Use Perplexity'));
    // No await between the click and the request.
    expect(permissionRequests).toEqual([{ origins: ['https://api.perplexity.ai/*'] }]);
    await settle();
    const callout = [...el.querySelectorAll('[tabindex="-1"]')].find((n) => text(n).includes('instead of OpenRouter'))!;
    expect(text(callout)).toContain("Shoo will send what's listed under What Shoo sends to api.perplexity.ai, instead of OpenRouter.");
    expectDisclosure(callout, 3);
    click(button(callout, 'Give consent'));
    await settle();
    expect(sent('giveConsent')).toEqual([{ version: CONSENT_VERSION, customHost: 'api.perplexity.ai' }]);
    expect(sent('setDirectEndpoint')).toEqual([{ provider: 'perplexity', baseUrl: 'https://api.perplexity.ai/v1', model: 'pplx-decider-v1.1-27b', key: 'pplx-secret' }]);
    expect(el.innerHTML).not.toContain('pplx-secret');
  });

  it('a direct provider in use: says so, starts its form from the saved model, keeps the key when left blank', async () => {
    replies.giveConsent = () => snapshot();
    replies.setDirectEndpoint = () => ({ ok: true });
    const el = connection({
      engine: 'direct',
      direct: { provider: 'typesafe', baseUrl: 'https://api.typesafe.ai/v1', model: 'jev-latest' },
      consent: { version: CONSENT_VERSION, acceptedAt: 1, customHost: 'api.typesafe.ai' },
    });
    await settle();
    expect(text(el)).toContain('Using jev-latest at TypeSafe (api.typesafe.ai).');
    expect(radio(el, 'TypeSafe').checked).toBe(true);
    expect(text(radio(el, 'TypeSafe').closest('label')!)).toContain('In use');
    expect((el.querySelector('#direct-model') as HTMLInputElement).value).toBe('jev-latest');
    expect(text(el)).toContain('Leave blank to keep the saved key.');
    // The OpenRouter model picker does not apply to a direct provider.
    expect(el.querySelector('select')).toBeNull();
    // The provider in use saves changes, and only once there is one.
    expect(button(el, 'Save changes').disabled).toBe(true);
    type(el.querySelector('#direct-model') as HTMLInputElement, 'jev-1.13.0');
    click(button(el, 'Save changes'));
    await settle();
    click(button(el, 'Give consent'));
    await settle();
    expect(sent('setDirectEndpoint')).toEqual([{ provider: 'typesafe', baseUrl: 'https://api.typesafe.ai/v1', model: 'jev-1.13.0' }]);
  });

  it('each disabled button names its own missing field, with the chat model form open too', async () => {
    const el = connection();
    await settle();
    click(radio(el, 'Perplexity'));
    const reason = (label: string) => document.getElementById(button(el, label).getAttribute('aria-describedby')!)!.textContent;
    expect(reason('Use Perplexity')).toBe('Paste your Perplexity API key to continue.');
    expect(reason('Use this chat model')).toBe('Enter an https address, or http for localhost, to continue.');
  });

  it('back to OpenRouter from its own row: withdraws the other host\'s consent, then switches', async () => {
    replies.withdrawConsent = () => snapshot();
    replies.updateSettings = ({ patch }) => ({ settings: { ...fake.settings, ...patch } });
    const el = connection({
      engine: 'direct',
      direct: { provider: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'clef-flash' },
      consent: { version: CONSENT_VERSION, acceptedAt: 1, customHost: 'localhost:11434' },
    });
    await settle();
    expect(text(el)).toContain('Using clef-flash on this computer (localhost:11434).');
    expect(hasButton(el, 'Use OpenRouter')).toBe(false);
    click(radio(el, 'OpenRouter'));
    expect(text(el)).toContain('Switching back to OpenRouter asks for consent again.');
    click(button(el, 'Use OpenRouter'));
    await settle();
    expect(sent('withdrawConsent')).toHaveLength(1);
    expect(sent('updateSettings')).toEqual([{ patch: { engine: 'openrouter' } }]);
  });

  it("forgets a Decision provider's key on this device, and its form then asks for a key again", async () => {
    let stored = { direct: true, custom: false };
    replies.getStoredKeys = () => stored;
    replies.forgetKey = () => {
      stored = { direct: false, custom: false };
    };
    const el = connection({ direct: { provider: 'typesafe', baseUrl: 'https://api.typesafe.ai/v1', model: 'jev-latest' } });
    await settle();
    expect(text(el)).toContain('TypeSafe key for api.typesafe.ai');
    click(button(el, 'Forget key'));
    await settle();
    expect(sent('forgetKey')).toEqual([{ endpoint: 'direct' }]);
    expect(hasButton(el, 'Forget key')).toBe(false);
    click(radio(el, 'TypeSafe'));
    expect(text(el)).not.toContain('Leave blank to keep the saved key.');
    expect(button(el, 'Use TypeSafe').disabled).toBe(true);
  });

  it("forgets the chat model's key, and its form then stops offering to keep a saved key", async () => {
    let stored = { direct: false, custom: true };
    replies.getStoredKeys = () => stored;
    replies.forgetKey = () => {
      stored = { direct: false, custom: false };
    };
    const el = connection({ customEndpoint: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-6-luna' } });
    await settle();
    expect(text(el)).toContain('Leave blank to keep the saved key.');
    click(button(el, 'Forget key'));
    await settle();
    expect(sent('forgetKey')).toEqual([{ endpoint: 'custom' }]);
    expect(text(el)).not.toContain('Leave blank to keep the saved key.');
  });

  it('back to OpenRouter needs an OpenRouter key first: without one only Connect and Paste show', async () => {
    const el = mount(
      <Connection
        data={data({
          key: { error: 'noKey' },
          keyStatus: 'none',
          settings: { ...fake.settings, engine: 'direct', direct: { provider: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'clef-flash' }, consent: { version: CONSENT_VERSION, acceptedAt: 1, customHost: 'localhost:11434' } },
        })}
        params={params}
      />,
    );
    await settle();
    click(radio(el, 'OpenRouter'));
    expect(hasButton(el, 'Connect OpenRouter')).toBe(true);
    expect(hasButton(el, 'Use OpenRouter')).toBe(false);
  });

  it.each([
    ['keyRejected', 'Ollama refused Shoo. Run the second command, restart Ollama, then try again.'],
    ['network', "Couldn't reach localhost:11434. Check that Ollama is running."],
    ['http404', "localhost:11434 doesn't have clef-flash. Download it first, or enter another model."],
  ])('a failed Ollama check (%s) explains the fix and asks for no consent', async (error, copy) => {
    replies.testDirectEndpoint = () => ({ ok: false, error });
    const el = connection();
    await settle();
    click(radio(el, 'Ollama'));
    click(button(el, 'Use Ollama'));
    await settle();
    expect(text(el)).toContain(copy);
    expect(text(el)).not.toContain('localhost:11434 is this computer');
    expect(sent('setDirectEndpoint')).toEqual([]);
  });

  it('locks the fields while a local model is checked, then moves focus to the consent', async () => {
    let answer!: (v: { ok: true; latencyMs: number }) => void;
    replies.testDirectEndpoint = () => new Promise((r) => (answer = r));
    const el = connection();
    await settle();
    click(radio(el, 'LM Studio'));
    expect(button(el, 'Use LM Studio').disabled).toBe(true);
    type(el.querySelector('#direct-model') as HTMLInputElement, 'clef-flash');
    click(button(el, 'Use LM Studio'));
    await settle();
    expect(button(el, 'Checking LM Studio').disabled).toBe(true);
    expect((el.querySelector('#direct-model') as HTMLInputElement).disabled).toBe(true);
    answer({ ok: true, latencyMs: 1 });
    await settle();
    expect(document.activeElement?.textContent).toContain('localhost:1234 is this computer');
    click(button(el, 'Cancel'));
    await settle();
    expect(document.activeElement?.textContent).toBe('Use LM Studio');
  });

  it('picking a provider that takes fewer Topic rules than are on warns before saving', async () => {
    const topics = Array.from({ length: 30 }, (_, i) => rule({ id: `t${i}`, ref: `R${i + 1}`, text: `Topic ${i}` }));
    const el = mount(<Connection data={data({ rules: topics })} params={params} />);
    await settle();
    click(radio(el, 'Ollama'));
    expect(text(el)).toContain('Ollama takes at most 25 Topic rules, and 30 are on. Topic rules stop working until you switch some off.');
    click(radio(el, 'llama.cpp'));
    expect(text(el)).not.toContain('takes at most');
  });

  it('copy buttons say which command they copy and announce the result', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const el = connection();
    await settle();
    click(radio(el, 'Ollama'));
    click(button(el, 'the command that lets Shoo reach Ollama'));
    await settle();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('OLLAMA_ORIGINS'));
    expect(text(el)).toContain('Copied.');
  });
});

describe('Connection: chat model (Settings only, less accurate)', () => {
  it('sits in a closed disclosure labelled less accurate, says why and that it reads titles only', () => {
    const el = mount(<ChatEndpoint settings={fake.settings} keyStored={false} />);
    const details = el.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(text(details.querySelector('summary')!)).toBe('Chat modelLess accurate');
    expect(text(el)).toContain('Filtering strength was not tuned for those ratings, so it removes less reliably.');
    expect(text(el)).toContain('Titles only. Thumbnail rules need a Decision model that reads images.');
  });

  it('Save asks for host access synchronously, then consent naming the host, then saves', async () => {
    replies.giveConsent = () => snapshot();
    replies.setCustomEndpoint = () => ({ ok: true });
    const el = mount(<ChatEndpoint settings={fake.settings} keyStored={false} />);
    type(el.querySelector('#custom-url') as HTMLInputElement, 'https://llm.example.com/v1');
    type(el.querySelector('#custom-model') as HTMLInputElement, 'my-model');
    type(el.querySelector('#custom-key') as HTMLInputElement, 'secret');
    click(button(el, 'Use this chat model'));
    expect(permissionRequests).toEqual([{ origins: ['https://llm.example.com/*'] }]);
    await settle();
    expect(text(el)).toContain("Shoo will send what's listed under What Shoo sends to llm.example.com, instead of OpenRouter.");
    expectDisclosure(el, 3);
    click(button(el, 'Give consent'));
    await settle();
    expect(sent('giveConsent')).toEqual([{ version: CONSENT_VERSION, customHost: 'llm.example.com' }]);
    expect(sent('setCustomEndpoint')).toEqual([{ baseUrl: 'https://llm.example.com/v1', model: 'my-model', key: 'secret' }]);
    // Online endpoints are never called before consent: a call there spends the user's credit.
    expect(sent('testCustomEndpoint')).toEqual([]);
  });

  it('Ollama fills in its address and shows the OLLAMA_ORIGINS line, then checks the model before consent', async () => {
    replies.testCustomEndpoint = () => ({ ok: true, latencyMs: 40 });
    const el = mount(<ChatEndpoint settings={fake.settings} keyStored={false} />);
    click(button(el, 'Ollama'));
    expect((el.querySelector('#custom-url') as HTMLInputElement).value).toBe('http://localhost:11434/v1');
    expect(text(el.querySelector('code')!)).toContain(location.origin);
    click(button(el, 'LM Studio'));
    expect((el.querySelector('#custom-url') as HTMLInputElement).value).toBe('http://localhost:1234/v1');
    expect(el.querySelector('code')).toBeNull();
    type(el.querySelector('#custom-model') as HTMLInputElement, 'qwen3');
    click(button(el, 'Use this chat model'));
    expect(permissionRequests).toEqual([{ origins: ['http://localhost:1234/*'] }]);
    await settle();
    expect(sent('testCustomEndpoint')).toEqual([{ baseUrl: 'http://localhost:1234/v1', model: 'qwen3', key: '' }]);
    expect(text(el)).toContain('localhost:1234 is this computer, so nothing leaves it.');
  });

  it('denied host access names the host and saves nothing', async () => {
    browser.permissions.request = (() => Promise.resolve(false)) as typeof browser.permissions.request;
    const el = mount(<ChatEndpoint settings={fake.settings} keyStored={false} />);
    type(el.querySelector('#custom-url') as HTMLInputElement, 'https://llm.example.com/v1');
    type(el.querySelector('#custom-model') as HTMLInputElement, 'm');
    click(button(el, 'Use this chat model'));
    await settle();
    expect(text(el)).toContain('Shoo needs access to llm.example.com to use it.');
    expect(sent('giveConsent')).toEqual([]);
    expect(sent('setCustomEndpoint')).toEqual([]);
  });

  it('refuses plain http outside localhost', () => {
    const el = mount(<ChatEndpoint settings={fake.settings} keyStored={false} />);
    type(el.querySelector('#custom-url') as HTMLInputElement, 'http://llm.example.com');
    expect(text(el)).toContain('Use an https address, or http only for localhost.');
  });

  it('opens when in use, with its saved address, and re-saving with the key left blank keeps the key', async () => {
    replies.giveConsent = () => snapshot();
    replies.setCustomEndpoint = () => ({ ok: true });
    const settings = { ...fake.settings, engine: 'custom' as const, customEndpoint: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-6-luna' } };
    const el = mount(<ChatEndpoint settings={settings} keyStored />);
    expect(el.querySelector('details')!.open).toBe(true);
    expect(text(el)).toContain('Leave blank to keep the saved key.');
    expect(button(el, 'Save changes').disabled).toBe(true);
    type(el.querySelector('#custom-model') as HTMLInputElement, 'gpt-6-luna-mini');
    click(button(el, 'Save changes'));
    await settle();
    click(button(el, 'Give consent'));
    await settle();
    expect(sent('setCustomEndpoint')).toEqual([{ baseUrl: 'https://api.openai.com/v1', model: 'gpt-6-luna-mini' }]);
  });

  it('Connection with a chat model in use says so and offers OpenRouter back, with no provider selected', async () => {
    const el = mount(
      <Connection
        data={data({ settings: { ...fake.settings, engine: 'custom', customEndpoint: { baseUrl: 'http://localhost:11434/v1', model: 'gemma3:4b' }, consent: { version: CONSENT_VERSION, acceptedAt: 1, customHost: 'localhost:11434' } } })}
        params={params}
      />,
    );
    await settle();
    expect(text(el)).toContain('Using the chat model gemma3:4b at localhost:11434.');
    expect(el.querySelector('input[name="provider"]:checked')).toBeNull();
    click(radio(el, 'OpenRouter'));
    expect(hasButton(el, 'Use OpenRouter')).toBe(true);
  });
});

describe('Settings shell', () => {
  it('routes by hash, marks the current section and resumes onboarding when unfinished', async () => {
    fake.settings.onboarding = { step: 0, done: true };
    replies.getRuntimeState = () => snapshot();
    replies.getKeyUsage = () => ({ error: 'noKey' });
    location.hash = '#exceptions';
    const el = mount(<App />);
    await settle();
    expect(el.querySelector('a[aria-current="page"]')!.getAttribute('href')).toBe('#exceptions');
    expect(el.querySelector('h2')!.textContent).toBe('Exceptions');
    location.hash = '#activity?batch=b9';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await settle();
    expect(el.querySelector('a[aria-current="page"]')!.getAttribute('href')).toBe('#activity');
    expect(fake.queries.at(-1)).toMatchObject({ batchId: 'b9' });
    location.hash = '';
  });

  it('a direct Decision provider without its key leaves Topic and Thumbnail rules off, as the popup does', async () => {
    fake.settings.onboarding = { step: 0, done: true };
    fake.settings.engine = 'direct';
    fake.settings.direct = { provider: 'typesafe', baseUrl: 'https://api.typesafe.ai/v1', model: 'jev-latest' };
    fake.settings.consent = { version: CONSENT_VERSION, acceptedAt: 1, customHost: 'api.typesafe.ai' };
    replies.getRuntimeState = () => snapshot({ reason: 'noKey', eye: 'error' });
    replies.getKeyUsage = () => ({ error: 'noKey' });
    location.hash = '#rules';
    const el = mount(<App />);
    await settle();
    click(button(el, 'Add a Rule'));
    const options = [...el.querySelectorAll('option')] as HTMLOptionElement[];
    expect(options.filter((o) => o.disabled).map((o) => o.value)).toEqual(['topic', 'thumbnail']);
    location.hash = '';
  });

  it('counts Exceptions in the index from any section, and lists them in their own', async () => {
    fake.settings.onboarding = { step: 0, done: true };
    fake.exceptions = [
      { videoId: 'a0000000001', title: 'Kept one', at: 2 },
      { videoId: 'a0000000002', title: 'Kept two', at: 1 },
    ];
    replies.getRuntimeState = () => snapshot();
    replies.getKeyUsage = () => ({ error: 'noKey' });
    location.hash = '#advanced';
    const el = mount(<App />);
    await settle();
    expect(el.querySelector('a[href="#exceptions"]')!.textContent).toContain('2');
    location.hash = '#exceptions';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await settle();
    expect(text(el)).toContain('Kept two');
    location.hash = '';
  });

  it('Sites lists unsupported Surfaces disabled with the reason and the Shorts note', async () => {
    const el = mount(<Sites data={data()} params={params} />);
    await settle();
    const switches = [...el.querySelectorAll('[role="switch"]')] as HTMLButtonElement[];
    const byLabel = (id: string) => switches.find((s) => s.getAttribute('aria-labelledby') === `surface-${id}`)!;
    expect(byLabel('search').disabled).toBe(true);
    expect(byLabel('channel').disabled).toBe(true);
    expect(byLabel('endScreen').disabled).toBe(true);
    expect(byLabel('bilibiliVideoSidebar').disabled).toBe(true);
    expect(byLabel('home').disabled).toBe(false);
    expect(byLabel('bilibiliHome').disabled).toBe(false);
    expect(text(el)).toContain('YouTube offers no Not interested here');
    expect(text(el)).toContain('Bilibili offers no Not interested here');
    expect(text(el)).toContain("Shorts show no channel, so channel Rules can't match here. Shoo uses Not interested only.");
    click(byLabel('watchSidebar'));
    await settle();
    expect(sent('updateSettings')).toEqual([{ patch: { surfaces: { ...fake.settings.surfaces, watchSidebar: false } } }]);
  });

  it('Shelf dismissal switches sit under YouTube, start off and save one Shelf at a time', async () => {
    const el = mount(<Sites data={data()} params={params} />);
    await settle();
    const shelf = (id: string) => el.querySelector(`[role="switch"][aria-labelledby="shelf-${id}"]`) as HTMLButtonElement;
    expect(shelf('shorts').getAttribute('aria-checked')).toBe('false');
    expect(shelf('games').getAttribute('aria-checked')).toBe('false');
    const youtubeCard = el.querySelector('[aria-labelledby="site-youtube"]')!.closest('.card')!;
    expect(youtubeCard.contains(shelf('shorts'))).toBe(true);
    expect(youtubeCard.contains(shelf('games'))).toBe(true);
    click(shelf('games'));
    await settle();
    expect(sent('updateSettings')).toEqual([{ patch: { shelfDismissal: { games: true } } }]);
  });

  it("Sites turns one Site off without touching its Surfaces' own switches, which wait disabled", async () => {
    const el = mount(<Sites data={data()} params={params} />);
    await settle();
    click(el.querySelector('[role="switch"][aria-labelledby="site-bilibili"]') as HTMLButtonElement);
    await settle();
    expect(sent('updateSettings')).toEqual([{ patch: { sites: { youtube: true, bilibili: false } } }]);
    unmountAll();
    const off = mount(<Sites data={data({ settings: { ...fake.settings, sites: { youtube: true, bilibili: false } } })} params={params} />);
    await settle();
    expect(text(off)).toContain('Off. Shoo does nothing on Bilibili.');
    expect((off.querySelector('[role="switch"][aria-labelledby="surface-bilibiliHome"]') as HTMLButtonElement).disabled).toBe(true);
    expect((off.querySelector('[role="switch"][aria-labelledby="surface-home"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it("Sites says when the browser took a Site's access away, and asks for it again in the click", async () => {
    browser.permissions.contains = ((p: { origins: string[] }) => Promise.resolve(!p.origins.includes('https://www.bilibili.com/*'))) as typeof browser.permissions.contains;
    browser.permissions.request = ((p: unknown) => {
      permissionRequests.push(p);
      return Promise.resolve(false);
    }) as typeof browser.permissions.request;
    const el = mount(<Sites data={data()} params={params} />);
    await settle();
    expect(text(el)).toContain("Shoo has no access to Bilibili. It was taken away in your browser's settings.");
    expect(text(el)).not.toContain('Shoo has no access to YouTube');
    click(button(el, 'Allow access'));
    expect(permissionRequests).toEqual([{ origins: ['https://www.bilibili.com/*'] }]);
    await settle();
    expect(text(el)).toContain("The browser didn't give Shoo access to Bilibili.");
  });

  it('Reset asks for confirmation first and says it also clears synced data', async () => {
    replies.resetAll = () => undefined;
    const el = mount(<Advanced data={data()} params={params} />);
    await settle();
    click(button(el, 'Reset Shoo'));
    expect(text(el)).toContain('also disappear from your other browsers');
    expect(sent('resetAll')).toEqual([]);
    click(button(el, 'Delete everything'));
    await settle();
    expect(sent('resetAll')).toHaveLength(1);
  });

  it('Clear history asks for confirmation first and says checked videos cost model calls again', async () => {
    replies.clearHistory = () => undefined;
    const el = mount(<Advanced data={data()} params={params} />);
    await settle();
    expect(text(el)).toContain('Your Rules, Keep rules, Banned channels, Exceptions, settings and key stay.');
    click(button(el, 'Clear history'));
    expect(text(el)).toContain('which costs model calls');
    expect(sent('clearHistory')).toEqual([]);
    click(button(el, 'Delete history'));
    await settle();
    expect(sent('clearHistory')).toHaveLength(1);
    expect(text(el)).toContain("Shoo's history is deleted.");
    expect(sent('resetAll')).toEqual([]);
  });

  it('export downloads a JSON file through an object URL', async () => {
    replies.exportData = () => ({ format: 'shoo-rules', version: 1, exportedAt: '2026-10-10T00:00:00Z', rules: [], exceptions: [] });
    const create = vi.fn(() => 'blob:x');
    URL.createObjectURL = create;
    URL.revokeObjectURL = vi.fn();
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this.download);
    });
    const el = mount(<Advanced data={data()} params={params} />);
    await settle();
    click(button(el, 'Export'));
    await settle();
    expect(create).toHaveBeenCalledOnce();
    expect(clicks[0]).toMatch(/^shoo-rules-\d{4}-\d{2}-\d{2}\.json$/);
  });
});

function act(el: Element, event: 'focus' | 'blur' | 'change', value?: string): void {
  preactAct(() => {
    if (value !== undefined) (el as HTMLSelectElement).value = value;
    el.dispatchEvent(new Event(event === 'blur' ? 'focusout' : event === 'focus' ? 'focusin' : event, { bubbles: true }));
    if (event === 'blur' || event === 'focus') el.dispatchEvent(new Event(event));
  });
}
