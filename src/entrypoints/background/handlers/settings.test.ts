import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { getOpenRouterKey } from '~/store/secret';
import { queryActivity } from '~/store/local';
import { checked } from '~/store/testing/fixtures';
import { DroppedMessage, InvalidInput } from '../router';
import { contentSender, harness, keywordRule, T0 } from '../testing';

beforeEach(() => fakeBrowser.reset());

describe('updateSettings', () => {
  it('cannot change the custom endpoint, which only setCustomEndpoint saves with its key rule', async () => {
    const h = harness();
    await h.call('setCustomEndpoint', { baseUrl: 'https://llm.example.com/v1', model: 'm', key: 'k' });
    const { settings } = await h.call('updateSettings', { patch: { customEndpoint: { baseUrl: 'https://elsewhere.example.net/v1', model: 'm' } } });
    expect(settings.customEndpoint).toEqual({ baseUrl: 'https://llm.example.com/v1', model: 'm' });
  });
});

describe('resumeFromBreaker', () => {
  async function tripAll(h: ReturnType<typeof harness>) {
    await h.writer.updateRuntime((s) => ({ ...s, tripped: { model: 1, nativeAction: 1, markup: 1 } }));
  }

  it('from a Site tab resumes the model only', async () => {
    const h = harness();
    await tripAll(h);
    await expect(h.call('resumeFromBreaker', { category: 'nativeAction' }, contentSender())).rejects.toBeInstanceOf(InvalidInput);
    await expect(h.call('resumeFromBreaker', { category: 'markup' }, contentSender())).rejects.toBeInstanceOf(InvalidInput);
    await expect(h.call('resumeFromBreaker', {}, contentSender())).rejects.toBeInstanceOf(InvalidInput);
    expect((await h.writer.getRuntime()).tripped).toEqual({ model: 1, nativeAction: 1, markup: 1 });
    await h.call('resumeFromBreaker', { category: 'model' }, contentSender());
    expect((await h.writer.getRuntime()).tripped).toEqual({ nativeAction: 1, markup: 1 });
  });

  it('from the popup resumes every breaker', async () => {
    const h = harness();
    await tripAll(h);
    await h.call('resumeFromBreaker', {});
    expect((await h.writer.getRuntime()).tripped).toEqual({});
  });
});

describe('clearHistory', () => {
  it('only from a Settings page: deletes Activity and the Removals Undo needs, keeps Rules and the key', async () => {
    const h = harness();
    await h.addRules(keywordRule('drama'));
    await h.connect();
    await h.writer.recordActivity([{ id: 'e', kind: 'removed', at: T0, videoId: 'seenvideo01', title: 'Drama' }]);
    h.bg.services.rememberRemoval('seenvideo01', { title: 'Drama', surface: 'home', nativeAction: 'notInterested' });
    await expect(h.call('clearHistory', undefined, contentSender())).rejects.toBeInstanceOf(DroppedMessage);
    await h.call('clearHistory', undefined);
    expect(await queryActivity(h.areas.local)).toEqual([]);
    expect(h.bg.services.removals.size).toBe(0);
    expect((await h.writer.getRules()).map((r) => r.text)).toEqual(['drama']);
    expect(await getOpenRouterKey(h.areas.local)).toBeDefined();
  });
});

describe('importData', () => {
  it('takes only a file the options page checked, never the raw export', async () => {
    const h = harness();
    const rule = { id: 'imported-1', ref: 'R1', polarity: 'remove', kind: 'keyword', text: 'drama', enabled: true, origin: 'user', createdAt: T0, updatedAt: T0 };
    const raw = { format: 'shoo-rules', version: 1, exportedAt: 'x', rules: [rule], exceptions: [] };
    expect(await h.call('importData', { file: raw as never, mode: 'merge', dryRun: false })).toEqual({ error: 'invalidInput', detail: 'request' });
    expect(await h.writer.getRules()).toEqual([]);
    const res = await h.call('importData', { file: checked(raw), mode: 'merge', dryRun: false });
    expect(res).toEqual({ preview: { add: 1, update: 0, renumber: 0, invalid: [] } });
    expect((await h.writer.getRules()).map((r) => r.text)).toEqual(['drama']);
  });
});
