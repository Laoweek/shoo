import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { queryActivity } from '~/store/local';
import { InvalidInput } from '../router';
import { banRule, contentSender, harness, tile } from '../testing';
import { LIFT_WINDOW_MS } from './user-ban';

beforeEach(() => fakeBrowser.reset());

const jake = tile('aaaaaaaaaaa', 'Jake reacts to drama', { channelName: 'Jake Reacts', channelHandle: '@jakereacts' });
const live = async (h: ReturnType<typeof harness>) => (await h.writer.getRules()).filter((r) => r.deletedAt === undefined);

describe('banChannel', () => {
  it("adds the user's Banned channel once, records it in Activity and tells the tabs", async () => {
    const h = harness();
    const sent = h.sentOf('settingsChanged').length;
    const res = await h.call('banChannel', { tile: jake }, contentSender());
    expect(res).toEqual({ ruleId: expect.any(String), added: true });
    const ruleId = (res as { ruleId: string }).ruleId;
    expect(await live(h)).toEqual([
      expect.objectContaining({ id: ruleId, polarity: 'remove', kind: 'channel', origin: 'user', site: 'youtube', params: { channelName: 'Jake Reacts', handle: '@jakereacts' } }),
    ]);
    expect(await queryActivity(h.areas.local, { kinds: ['banned'] })).toEqual([
      expect.objectContaining({ videoId: 'aaaaaaaaaaa', title: 'Jake reacts to drama', surface: 'home', ruleId, channelName: 'Jake Reacts', nativeAction: 'dontRecommendChannel' }),
    ]);
    expect(h.sentOf('settingsChanged')).toHaveLength(sent + 1);
    // Another Tile of the channel, or a ban made in Settings, is not added twice.
    expect(await h.call('banChannel', { tile: { ...jake, videoId: 'bbbbbbbbbbb' } }, contentSender())).toEqual({ ruleId, added: false });
    expect(await live(h)).toHaveLength(1);
  });

  it('adds nothing when Shoo is off, from a private window, for a kept channel or without a channel', async () => {
    const h = harness({ tabs: [{ id: 1, url: 'https://www.youtube.com/', incognito: false }, { id: 7, url: 'https://www.youtube.com/', incognito: true }] });
    expect(await h.call('banChannel', { tile: jake }, contentSender(7, true))).toEqual({ error: 'privateWindow' });
    expect(await h.call('banChannel', { tile: tile('ccccccccccc', 'No channel') }, contentSender())).toEqual({ error: 'noChannel' });
    await expect(h.call('banChannel', { tile: { ...jake, videoId: 'BV1FIXTURE01', surface: 'bilibiliHome' } }, contentSender())).rejects.toBeInstanceOf(InvalidInput);
    await h.call('keepChannel', { channelName: 'Jake Reacts' });
    expect(await h.call('banChannel', { tile: jake }, contentSender())).toEqual({ error: 'keptChannel' });
    await h.call('updateSettings', { patch: { enabled: false } });
    expect(await h.call('banChannel', { tile: { ...jake, channelName: 'Other', channelHandle: undefined } }, contentSender())).toEqual({ error: 'off' });
    expect((await live(h)).filter((r) => r.polarity === 'remove')).toEqual([]);
  });
});

describe('liftChannelBan', () => {
  it("removes only the ban this video's Don't recommend channel added, while YouTube's Undo can be offered", async () => {
    const h = harness();
    const [older] = await h.addRules(banRule('Older Ban'));
    const { ruleId } = (await h.call('banChannel', { tile: jake }, contentSender())) as { ruleId: string };
    // Another video, or a ban that banChannel did not add, changes nothing.
    await h.call('liftChannelBan', { ruleId, videoId: 'bbbbbbbbbbb' }, contentSender());
    await h.call('liftChannelBan', { ruleId: older!.id, videoId: 'aaaaaaaaaaa' }, contentSender());
    expect(await live(h)).toHaveLength(2);

    await h.call('liftChannelBan', { ruleId, videoId: 'aaaaaaaaaaa' }, contentSender());
    expect((await live(h)).map((r) => r.id)).toEqual([older!.id]);
    expect(await queryActivity(h.areas.local, { kinds: ['undone'] })).toEqual([
      expect.objectContaining({ videoId: 'aaaaaaaaaaa', channelName: 'Jake Reacts', nativeAction: 'dontRecommendChannel', detail: 'youtube' }),
    ]);
  });

  it('keeps a ban older than the lift window', async () => {
    const h = harness();
    const { ruleId } = (await h.call('banChannel', { tile: jake }, contentSender())) as { ruleId: string };
    h.clock.t += LIFT_WINDOW_MS + 1;
    await h.call('liftChannelBan', { ruleId, videoId: 'aaaaaaaaaaa' }, contentSender());
    expect(await live(h)).toHaveLength(1);
  });
});
