import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { RuntimeSnapshot } from '~/core/types';
import { answerer, fixture, fromFixture } from '~/engine/testing';
import { queryActivity } from '~/store/local';
import { CONSENT_VERSION } from '~/store/schema';
import { getCustomKey, getDirectKey, getOpenRouterKey, setOpenRouterKey } from '~/store/secret';
import { createBackground, RETENTION_ALARM } from './app';
import { KEPT_BY_RULE_DAY_MAX } from './handlers/judging';
import { DroppedMessage, InvalidInput } from './router';
import { banRule, contentSender, fakeOpenRouter, harness, keywordRule, pageSender, T0, tile, topicRule } from './testing';

beforeEach(() => fakeBrowser.reset());

const localKeys = (h: ReturnType<typeof harness>) => Object.keys(h.areas.local.dump()).sort();

describe('Bilibili', () => {
  const BILI = 'https://www.bilibili.com/';
  const COVER = `/bfs/archive/${'0'.repeat(39)}1.jpg`;

  it('judges a Bilibili tab against the Rules that work there: its own Site-only rules and the ones for all sites', async () => {
    const h = harness({ tabs: [{ id: 2, url: BILI }] });
    const only = (text: string, site: 'youtube' | 'bilibili') => ({ op: 'add' as const, rule: { ...keywordRule(text).rule, site } });
    await h.addRules(only('unboxing', 'youtube'), only('mukbang', 'bilibili'), keywordRule('asmr'));
    const onBilibili = async (title: string) =>
      (await h.call('judgeTiles', { items: [tile('BV1FIXTURE01', title, { surface: 'bilibiliHome' })], settingsGeneration: 0 }, contentSender(2, false, BILI))).results[0]!.verdict;
    expect(await onBilibili('Mukbang night')).toMatchObject({ outcome: 'remove', source: 'exact' });
    expect(await onBilibili('ASMR night')).toMatchObject({ outcome: 'remove', source: 'exact' });
    expect((await onBilibili('Unboxing day'))?.outcome).not.toBe('remove');
    const onYouTube = await h.call('judgeTiles', { items: [tile('yyyyyyyyyyy', 'Mukbang night')], settingsGeneration: 0 }, contentSender());
    expect(onYouTube.results[0]!.verdict?.outcome).not.toBe('remove');
  });

  it('limits a Rule to one Site and makes it work on all sites again, and refuses an unknown Site', async () => {
    const h = harness();
    const [added] = await h.addRules(keywordRule('mukbang'));
    const id = added!.id;
    await h.call('mutateRules', { ops: [{ op: 'update', id, patch: { site: 'bilibili' } }] });
    expect((await h.writer.getRules())[0]!.site).toBe('bilibili');
    await h.call('mutateRules', { ops: [{ op: 'update', id, patch: { site: null } }] });
    expect('site' in (await h.writer.getRules())[0]!).toBe(false);
    expect(await h.call('mutateRules', { ops: [{ op: 'update', id, patch: { site: 'vimeo' } }] } as never)).toEqual({ error: 'invalidInput', detail: 'shape' });
  });

  it("refuses a judge batch with another Site's Tiles", async () => {
    const h = harness({ tabs: [{ id: 2, url: BILI }] });
    await expect(h.call('judgeTiles', { items: [tile('yyyyyyyyyyy', 't')], settingsGeneration: 0 }, contentSender(2, false, BILI))).rejects.toBeInstanceOf(InvalidInput);
  });

  it('takes content messages from a Bilibili tab: covers go into Activity, its Undo is recorded as the Site', async () => {
    const h = harness({ tabs: [{ id: 2, url: BILI }] });
    const sender = contentSender(2, false, BILI);
    const report = { ok: true, videoId: 'BV1FIXTURE01', surface: 'bilibiliHome', nativeAction: 'notInterested', batchId: 'b1', title: 'Fixture', channelName: 'Up', channelId: '10000001', cover: COVER, source: 'exact' } as const;
    await h.call('reportActionResult', report, sender);
    await h.call('reportUndo', { videoId: 'BV1FIXTURE01', via: 'site' }, sender);
    const events = await queryActivity(h.areas.local, { videoId: 'BV1FIXTURE01' });
    expect(events.find((e) => e.kind === 'removed')).toMatchObject({ cover: COVER, surface: 'bilibiliHome' });
    expect(events.find((e) => e.kind === 'undone')).toMatchObject({ detail: 'bilibili' });
    await expect(h.call('reportActionResult', { ...report, cover: '/bfs/face/x.jpg' }, sender)).rejects.toBeInstanceOf(InvalidInput);
  });

  it("names the Site whose Native action failures tripped the shared breaker", async () => {
    const h = harness({ tabs: [{ id: 2, url: BILI }] });
    await h.connect(); // consent and a key, so the breaker is the top reason
    const fail = { ok: false, videoId: 'BV1FIXTURE01', surface: 'bilibiliHome', nativeAction: 'notInterested', step: 'openMenu', selectorVersion: 'bilibili-2026-10-18' } as const;
    let snap: RuntimeSnapshot | undefined;
    for (let i = 0; i < 5; i++) snap = await h.call('reportActionResult', fail, contentSender(2, false, BILI));
    expect(snap).toMatchObject({ reason: 'breakerNativeAction', site: 'bilibili' });
    await h.call('resumeFromBreaker', { category: 'nativeAction' });
    expect((await h.call('getRuntimeState', undefined, pageSender('popup.html'))).site).toBeUndefined();
  });

  it('keeps a channel on the Site it was seen on: a Bilibili Keep rule never keeps a same-named YouTube channel', async () => {
    const h = harness({ tabs: [{ id: 2, url: BILI }] });
    await h.call('keepChannel', { channelName: 'Same Name', channelId: '10000001', site: 'bilibili' }, contentSender(2, false, BILI));
    const [rule] = await h.writer.getRules();
    expect(rule).toMatchObject({ params: { channelName: 'Same Name', channelId: '10000001' }, site: 'bilibili' });
    await h.addRules(banRule('Same Name'));
    const res = await h.call('judgeTiles', { items: [tile('yyyyyyyyyyy', 't', { channelName: 'Same Name' })], settingsGeneration: 0 }, contentSender());
    expect(res.results[0]!.verdict).toMatchObject({ outcome: 'remove', source: 'exact' });
  });
});

describe('sender checks', () => {
  it('drops content messages from pages, other origins and other extensions', async () => {
    const h = harness();
    const req = { items: [tile('aaaaaaaaaaa', 'x')], settingsGeneration: 0 };
    await expect(h.call('judgeTiles', req, pageSender())).rejects.toBeInstanceOf(DroppedMessage);
    await expect(h.call('judgeTiles', req, contentSender(1, false, 'https://evil.example/watch'))).rejects.toBeInstanceOf(DroppedMessage);
    await expect(h.call('judgeTiles', req, contentSender(1, false, 'https://www.youtube.com.evil.example/'))).rejects.toBeInstanceOf(DroppedMessage);
    await expect(h.call('judgeTiles', req, { ...contentSender(), id: 'other-extension' })).rejects.toBeInstanceOf(DroppedMessage);
    await expect(h.call('judgeTiles', req, undefined)).rejects.toBeInstanceOf(DroppedMessage);
  });

  it('drops page messages from content, and accepts the shared ones from both', async () => {
    const h = harness();
    await expect(h.call('updateSettings', { patch: { enabled: false } }, contentSender())).rejects.toBeInstanceOf(DroppedMessage);
    await expect(h.call('resetAll', undefined, contentSender())).rejects.toBeInstanceOf(DroppedMessage);
    expect((await h.call('getRuntimeState', undefined, contentSender())).enabled).toBe(true);
    expect((await h.call('getRuntimeState', undefined, pageSender('popup.html'))).enabled).toBe(true);
    expect((await h.writer.getSettings()).enabled).toBe(true);
  });

  it('rejects malformed payloads with invalidInput and never writes', async () => {
    const h = harness();
    await expect(h.call('judgeTiles', { items: [{ videoId: 1 }], settingsGeneration: 0 } as never, contentSender())).rejects.toBeInstanceOf(InvalidInput);
    expect(await h.call('mutateRules', { ops: 'nope' } as never)).toEqual({ error: 'invalidInput', detail: 'shape' });
    expect(await h.call('tryTitle', { title: 42 } as never)).toEqual({ error: 'invalidInput' });
    await expect(h.call('updateSettings', { patch: { dailyCap: 'lots' } } as never)).rejects.toBeInstanceOf(InvalidInput);
  });

  it('strips unknown keys, consent and generation from updateSettings', async () => {
    const h = harness();
    const { settings } = await h.call('updateSettings', { patch: { notificationStyle: 'silent', generation: 99, consent: { version: CONSENT_VERSION, acceptedAt: 1 }, evil: 1 } as never });
    expect(settings.notificationStyle).toBe('silent');
    expect(settings.generation).toBe(1);
    expect(settings.consent).toBeUndefined();
    expect('evil' in settings).toBe(false);
    expect((await h.call('getRuntimeState', undefined)).notificationStyle).toBe('silent');
  });
});

describe('Shelf dismissal', () => {
  it('a switched-on Shelf reaches the RuntimeSnapshot, and a reported dismissal is one Activity event', async () => {
    const h = harness();
    await h.call('updateSettings', { patch: { shelfDismissal: { shorts: true, games: false } } });
    expect((await h.call('getRuntimeState', undefined, contentSender())).shelfDismissal).toEqual({ shorts: true, games: false });
    await h.call('reportShelfDismissal', { shelf: 'shorts' }, contentSender());
    expect(await queryActivity(h.areas.local)).toEqual([expect.objectContaining({ kind: 'shelfDismissed', shelf: 'shorts', surface: 'home' })]);
    await expect(h.call('reportShelfDismissal', { shelf: 'mixes' } as never, contentSender())).rejects.toBeInstanceOf(InvalidInput);
  });
});

const artistKeepRule = {
  op: 'add' as const,
  rule: { polarity: 'keep' as const, kind: 'artistChannel' as const, text: 'Artist channels', enabled: true, origin: 'user' as const },
};

describe('judgeTiles', () => {
  it('without consent runs stages 1-4 only: Exact rules decide, Topic Tiles stay undecided with noConsent', async () => {
    const fake = fakeOpenRouter();
    const h = harness({ fetch: fake.fetch });
    const rules = await h.addRules(topicRule('Reaction videos'), keywordRule('giveaway'));
    const reply = await h.call('judgeTiles', { items: [tile('aaaaaaaaaaa', 'Huge iPhone giveaway'), tile('bbbbbbbbbbb', 'Jake reacts to drama')], settingsGeneration: 0 }, contentSender());
    const kw = rules.find((r) => r.kind === 'keyword')!;
    expect(reply.results[0]).toMatchObject({ status: 'decided', verdict: { outcome: 'remove', source: 'exact', ruleId: kw.id, nativeAction: 'notInterested' } });
    expect(reply.results[1]).toEqual({ videoId: 'bbbbbbbbbbb', status: 'undecided', reason: 'noConsent' });
    expect(reply.rules).toEqual({ [kw.id]: { ref: kw.ref, text: 'giveaway', colour: kw.colour } });
    expect(reply.private).toBe(false);
    expect(reply.runtime.reason).toBe('noConsent');
    expect(reply.runtime.notificationStyle).toBe('summary');
    expect(reply.settingsGeneration).toBe((await h.writer.getSettings()).generation);
    expect(fake.requests).toHaveLength(0);
  });

  it('names the deciding Rule in the rules display map when it has a Rule name (REQ-RULE-11)', async () => {
    const h = harness();
    const [kw] = await h.addRules({ op: 'add', rule: { ...keywordRule('giveaway').rule, name: 'Giveaways' } });
    const reply = await h.call('judgeTiles', { items: [tile('aaaaaaaaaaa', 'Huge iPhone giveaway')], settingsGeneration: 0 }, contentSender());
    expect(reply.rules).toEqual({ [kw!.id]: { ref: kw!.ref, text: 'giveaway', name: 'Giveaways', colour: kw!.colour } });
  });

  it('with consent and a key asks the model and fills the rules display map', async () => {
    const fake = fakeOpenRouter();
    const h = harness({ fetch: fake.fetch });
    const [r1] = await h.addRules(topicRule('Reaction videos'));
    await h.connect();
    const reply = await h.call(
      'judgeTiles',
      { items: [tile('ccccccccccc', 'Jake reacts to drama', { channelName: 'Jake Reacts' }), tile('ddddddddddd', 'Sourdough basics')], settingsGeneration: 1 },
      contentSender(),
    );
    expect(reply.results[0]).toMatchObject({ status: 'decided', verdict: { outcome: 'remove', source: 'model', ruleId: r1!.id, ruleRef: 'R1' } });
    expect(reply.results[1]).toMatchObject({ status: 'decided', verdict: { outcome: 'keep', source: 'model' } });
    expect(reply.rules).toEqual({ [r1!.id]: { ref: 'R1', text: 'Reaction videos', colour: r1!.colour } });
    expect(reply.runtime.reason).toBe('ok');
    expect(reply.rulesVersion).toBe(reply.runtime.rulesVersion);
    expect(fake.decisionRequests()).toHaveLength(1);
    // Counting: judged and cost, Escalation judged once per day, the Rule hit.
    expect((await h.writer.getDayCounters(h.writer.today())).judged).toBe(2);
    expect((await h.writer.getEscalation())['jake reacts']?.judged).toEqual({ [h.writer.today()]: ['ccccccccccc'] });
    expect((h.areas.local.dump().ruleStats as Record<string, { total: number }>)[r1!.id]?.total).toBe(1);
    // A rescan answers from the Verdict cache and does not count the hit twice.
    await h.call('judgeTiles', { items: [tile('ccccccccccc', 'Jake reacts to drama', { channelName: 'Jake Reacts' })], settingsGeneration: 1 }, contentSender());
    expect(fake.decisionRequests()).toHaveLength(1);
    expect((h.areas.local.dump().ruleStats as Record<string, { total: number }>)[r1!.id]?.total).toBe(1);
  });

  it('records Keep rule keeps in Activity once per Keep rule, video and day, across a background restart', async () => {
    const h = harness();
    const rules = await h.addRules(keywordRule('giveaway'), {
      op: 'add',
      rule: { polarity: 'keep', kind: 'artistChannel', text: 'Artist channels', enabled: true, origin: 'user' },
    });
    const artist = rules.find((r) => r.kind === 'artistChannel')!;
    const items = [tile('aaaaaaaaaaa', 'Giveaway live', { channelName: 'KAF', isArtistChannel: true }), tile('bbbbbbbbbbb', 'Huge giveaway'), tile('aaaaaaaaaaa', 'Giveaway live', { channelName: 'KAF', isArtistChannel: true })];
    const reply = await h.call('judgeTiles', { items, settingsGeneration: 0 }, contentSender());
    expect(reply.results[0]).toMatchObject({ verdict: { outcome: 'keep', source: 'keepRule', ruleId: artist.id } });
    await h.call('judgeTiles', { items, settingsGeneration: 0 }, contentSender());
    await createBackground(h.platform).dispatch('judgeTiles', { items, settingsGeneration: 0 }, contentSender());
    const kept = (await queryActivity(h.areas.local)).filter((e) => e.kind === 'keptByRule');
    expect(kept).toEqual([
      expect.objectContaining({ videoId: 'aaaaaaaaaaa', ruleId: artist.id, source: 'keepRule', title: 'Giveaway live', channelName: 'KAF', channelKey: 'kaf', surface: 'home', at: T0, seenAt: T0 }),
    ]);
    // The next day records it again, so the Keep rule's week shows the video.
    h.clock.t += 24 * 60 * 60 * 1000;
    await h.call('judgeTiles', { items, settingsGeneration: 0 }, contentSender());
    expect((await queryActivity(h.areas.local)).filter((e) => e.kind === 'keptByRule')).toHaveLength(2);
  });

  it('counts a hit and records Activity for an exact Keep rule only when it beat a remove Rule (a Rescue)', async () => {
    const h = harness();
    const rules = await h.addRules(keywordRule('giveaway'), artistKeepRule);
    const kw = rules.find((r) => r.kind === 'keyword')!;
    const artist = rules.find((r) => r.kind === 'artistChannel')!;
    const items = [tile('aaaaaaaaaaa', 'Song', { channelName: 'KAF', isArtistChannel: true }), tile('bbbbbbbbbbb', 'Giveaway live', { channelName: 'KAF', isArtistChannel: true })];
    const stats = () => h.areas.local.dump().ruleStats as Record<string, { total: number }> | undefined;
    const kept = async () => (await queryActivity(h.areas.local)).filter((e) => e.kind === 'keptByRule').map((e) => e.videoId);
    const reply = await h.call('judgeTiles', { items, settingsGeneration: 0 }, contentSender());
    expect(reply.results[0]!.verdict).toMatchObject({ outcome: 'keep', source: 'keepRule', ruleId: artist.id });
    expect(reply.results[0]!.verdict).not.toHaveProperty('rescuedFrom');
    expect(reply.results[1]!.verdict).toMatchObject({ outcome: 'keep', source: 'keepRule', ruleId: artist.id, rescuedFrom: kw.id });
    expect(stats()?.[artist.id]?.total).toBe(1);
    expect(stats()?.[kw.id]).toBeUndefined();
    expect(await kept()).toEqual(['bbbbbbbbbbb']);
    // A ban added later the same day makes the first video a Rescue too: it counts then, once.
    await h.addRules(banRule('KAF'));
    await h.call('judgeTiles', { items, settingsGeneration: 0 }, contentSender());
    await h.call('judgeTiles', { items, settingsGeneration: 0 }, contentSender());
    expect(stats()?.[artist.id]?.total).toBe(2);
    expect((await kept()).sort()).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb']);
  });

  it('counts a hit and records Activity for a Topic Keep rule only when the Topic rule would have removed the video', async () => {
    const fake = fakeOpenRouter({
      decisions: answerer({
        choose: (title) => (/react/i.test(title) ? { keep: 0.05, R1: 0.95 } : { keep: 0.97, R1: 0.03 }),
        noul: (title) => (/science/i.test(title ?? '') ? 0.9 : 0.01),
      }),
    });
    const h = harness({ fetch: fake.fetch });
    const rules = await h.addRules(topicRule('Reaction videos'), { op: 'add', rule: { polarity: 'keep', kind: 'topic', text: 'Science', enabled: true, origin: 'user' } });
    const r1 = rules.find((r) => r.polarity === 'remove')!;
    const k1 = rules.find((r) => r.polarity === 'keep')!;
    await h.connect();
    const items = [tile('ccccccccccc', 'Jake reacts to a science fair'), tile('ddddddddddd', 'The science of sourdough')];
    const reply = await h.call('judgeTiles', { items, settingsGeneration: 1 }, contentSender());
    expect(reply.results[0]!.verdict).toMatchObject({ outcome: 'keep', source: 'keepRule', ruleId: k1.id, rescuedFrom: r1.id });
    expect(reply.results[1]!.verdict).toMatchObject({ outcome: 'keep', source: 'keepRule', ruleId: k1.id });
    expect(reply.results[1]!.verdict).not.toHaveProperty('rescuedFrom');
    expect((h.areas.local.dump().ruleStats as Record<string, { total: number }>)[k1.id]?.total).toBe(1);
    expect((await queryActivity(h.areas.local)).filter((e) => e.kind === 'keptByRule').map((e) => e.videoId)).toEqual(['ccccccccccc']);
  });

  it('records at most KEPT_BY_RULE_DAY_MAX Keep rule keeps a day', async () => {
    const h = harness();
    await h.addRules(artistKeepRule, banRule('KAF'));
    const items = Array.from({ length: KEPT_BY_RULE_DAY_MAX + 20 }, (_, i) => tile(`v${String(i).padStart(10, '0')}`, `Song ${i}`, { channelName: 'KAF', isArtistChannel: true }));
    for (let i = 0; i < items.length; i += 40) await h.call('judgeTiles', { items: items.slice(i, i + 40), settingsGeneration: 0 }, contentSender());
    expect((await queryActivity(h.areas.local)).filter((e) => e.kind === 'keptByRule')).toHaveLength(KEPT_BY_RULE_DAY_MAX);
  });

  it('records a Keep rule keep later when its Activity read or write failed, without duplicates', async () => {
    const h = harness();
    await h.addRules(artistKeepRule, banRule('KAF'));
    const items = [tile('aaaaaaaaaaa', 'Song', { channelName: 'KAF', isArtistChannel: true })];
    const local = h.areas.local;
    const { get, set } = local;
    const kept = async () => (await queryActivity(local)).filter((e) => e.kind === 'keptByRule');
    // The write fails once: nothing is saved, and the next batch records it.
    local.set = async (items) => {
      if (!('activity:index' in items)) return set(items);
      local.set = set;
      throw new Error('write failed');
    };
    await h.call('judgeTiles', { items, settingsGeneration: 0 }, contentSender());
    expect(await kept()).toHaveLength(0);
    await h.call('judgeTiles', { items, settingsGeneration: 0 }, contentSender());
    expect(await kept()).toHaveLength(1);
    // After a restart the first read of the day's Activity fails: the next batch reads again and finds the keep.
    const restarted = createBackground(h.platform);
    local.get = async (keys) => {
      if (keys === 'activity:index') {
        local.get = get;
        throw new Error('read failed');
      }
      return get(keys);
    };
    await restarted.dispatch('judgeTiles', { items, settingsGeneration: 0 }, contentSender());
    await restarted.dispatch('judgeTiles', { items, settingsGeneration: 0 }, contentSender());
    expect(await kept()).toHaveLength(1);
  });

  it('records no Keep rule keeps from private windows', async () => {
    const h = harness({ tabs: [{ id: 1, url: 'https://www.youtube.com/', incognito: true }] });
    await h.addRules({ op: 'add', rule: { polarity: 'keep', kind: 'artistChannel', text: 'Artist channels', enabled: true, origin: 'user' } }, banRule('KAF'));
    const reply = await h.call('judgeTiles', { items: [tile('aaaaaaaaaaa', 'Song', { channelName: 'KAF', isArtistChannel: true })], settingsGeneration: 0 }, contentSender(1, true));
    expect(reply.results[0]).toMatchObject({ verdict: { outcome: 'keep', source: 'keepRule', rescuedFrom: expect.any(String) } });
    expect(await queryActivity(h.areas.local)).toEqual([]);
  });

  it('trips the model breaker after 5 failing batches and broadcasts breakerModel exactly once', async () => {
    const fake = fakeOpenRouter({ decisions: () => fromFixture(fixture('error-400-bad-shape')) });
    const h = harness({ fetch: fake.fetch });
    await h.addRules(topicRule('Reaction videos'));
    await h.connect();
    for (let i = 0; i < 5; i++) {
      const reply = await h.call('judgeTiles', { items: [tile(`vid${i}aaaaaaa`, `Video ${i}`)], settingsGeneration: 1 }, contentSender());
      expect(reply.results[0]).toEqual({ videoId: `vid${i}aaaaaaa`, status: 'undecided', reason: 'apiShapeChanged' });
    }
    const states = h.sentOf('runtimeStateChanged').map((m) => m.data as RuntimeSnapshot);
    expect(states.filter((s) => s.reason === 'breakerModel')).toHaveLength(1);
    expect(fake.decisionRequests()).toHaveLength(5);
    const after = await h.call('judgeTiles', { items: [tile('vid9aaaaaaaa', 'Video 9')], settingsGeneration: 1 }, contentSender());
    expect(after.results[0]).toMatchObject({ status: 'undecided', reason: 'breakerModel' });
    expect(fake.decisionRequests()).toHaveLength(5);
    // Resume clears it.
    const resumed = await h.call('resumeFromBreaker', { category: 'model' }, contentSender());
    expect(resumed.reason).toBe('ok');
  });

  it('stops model calls at the daily cap, Exact rules keep working', async () => {
    const fake = fakeOpenRouter();
    const h = harness({ fetch: fake.fetch });
    const rules = await h.addRules(topicRule('Reaction videos'), keywordRule('giveaway'));
    await h.connect();
    await h.call('updateSettings', { patch: { dailyCap: 10 } });
    await h.writer.bumpCounters(h.writer.today(), { judged: 10 });
    const reply = await h.call('judgeTiles', { items: [tile('eeeeeeeeeee', 'Jake reacts'), tile('fffffffffff', 'A giveaway')], settingsGeneration: 2 }, contentSender());
    expect(reply.results[0]).toEqual({ videoId: 'eeeeeeeeeee', status: 'undecided', reason: 'dailyCap' });
    expect(reply.results[1]).toMatchObject({ status: 'decided', verdict: { ruleId: rules[1]!.id } });
    expect(reply.runtime.reason).toBe('dailyCap');
    expect(fake.requests).toHaveLength(0);
    // Try a title ignores the cap.
    const tried = await h.call('tryTitle', { title: 'Jake reacts' });
    expect(tried).toMatchObject({ result: { status: 'decided', verdict: { outcome: 'remove' } } });
  });

  it('in a private window writes nothing to local or sync, and a Keep holds for that tab', async () => {
    const fake = fakeOpenRouter();
    const h = harness({ fetch: fake.fetch, tabs: [{ id: 7, url: 'https://www.youtube.com/', incognito: true }] });
    await h.addRules(topicRule('Reaction videos'));
    await h.connect();
    await h.writer.flush();
    // syncOutbox is the writer's own bookkeeping for the Rule added above, cleared once sync confirms it.
    const persistent = () => {
      const { syncOutbox: _o, ...rest } = h.areas.local.dump();
      return JSON.stringify(rest);
    };
    const syncBefore = JSON.stringify(h.areas.sync.dump());
    const localBefore = persistent();
    const priv = contentSender(7, true);
    const item = tile('ggggggggggg', 'Jake reacts', { channelName: 'Jake Reacts' });

    const first = await h.call('judgeTiles', { items: [item], settingsGeneration: 1 }, priv);
    expect(first.private).toBe(true);
    expect(first.results[0]).toMatchObject({ status: 'decided', verdict: { outcome: 'remove' } });
    await h.call('reportActionResult', { ok: true, videoId: item.videoId, surface: 'home', nativeAction: 'notInterested', batchId: 'b1', title: item.title, channelName: 'Jake Reacts', source: 'model', p: 0.95, mode: 'auto' }, priv);
    await h.call('addException', { videoId: item.videoId, title: item.title, channelName: 'Jake Reacts', origin: 'reviewKeep' }, priv);
    const again = await h.call('judgeTiles', { items: [item], settingsGeneration: 1 }, priv);
    expect(again.results[0]).toMatchObject({ status: 'decided', verdict: { outcome: 'keep', source: 'exception' } });
    await h.writer.flush();
    expect(persistent()).toBe(localBefore);
    expect(JSON.stringify(h.areas.sync.dump())).toBe(syncBefore);
    expect(Object.keys(h.areas.session.dump())).toEqual(expect.arrayContaining(['private:7:exceptions']));
    // A normal tab does not see the private Keep.
    h.tabs.set(1, { id: 1, url: 'https://www.youtube.com/', incognito: false });
    const normal = await h.call('judgeTiles', { items: [item], settingsGeneration: 1 }, contentSender(1));
    expect(normal.results[0]).toMatchObject({ verdict: { outcome: 'remove' } });
    // Closing the private tab forgets its Exceptions.
    await h.bg.onTabRemoved(7);
    expect(h.areas.session.dump()['private:7:exceptions']).toBeUndefined();
  });

  it('reviewPending sets the review eye on that tab and is reported in the snapshot', async () => {
    const h = harness();
    await h.connect();
    await h.call('reviewPending', { count: 2 }, contentSender(1));
    const snap = await h.call('getRuntimeState', undefined, contentSender(1));
    expect(snap).toMatchObject({ reviewPending: 2, eye: 'review' });
    expect(h.platform.action.setIcon).toHaveBeenCalledWith({ tabId: 1, path: expect.objectContaining({ 16: '/icon/review-16.png' }) });
    // The popup asks for the active tab's count.
    expect((await h.call('getRuntimeState', undefined, pageSender('popup.html'))).reviewPending).toBe(2);
  });
});

describe('Native action results', () => {
  it('records removed, bumps the badge and trips the Native action breaker after 5 failures', async () => {
    const h = harness();
    const snap = await h.call('reportActionResult', { ok: true, videoId: 'hhhhhhhhhhh', surface: 'home', nativeAction: 'notInterested', batchId: 'b1', title: 'x'.repeat(200), channelName: 'Chan', source: 'exact', mode: 'auto' }, contentSender());
    expect(snap.reason).toBe('noConsent');
    expect((await h.writer.getDayCounters(h.writer.today())).removed).toBe(1);
    expect(h.platform.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' });
    const [day] = Object.keys((h.areas.local.dump()['activity:index'] as { days: object }).days);
    const removed = (h.areas.local.dump()[`activity:${day}:0`] as { kind: string; title: string; channelKey: string }[])[0]!;
    expect(removed).toMatchObject({ kind: 'removed', channelKey: 'chan' });
    expect(removed.title).toHaveLength(120);
    let last: RuntimeSnapshot | undefined;
    for (let i = 0; i < 5; i++) {
      last = await h.call('reportActionResult', { ok: false, videoId: 'iiiiiiiiiii', surface: 'home', nativeAction: 'notInterested', step: 'findItem', selectorVersion: 's1' }, contentSender());
    }
    expect(last!.reason).toBe('noConsent'); // higher precedence, but the stage is off
    expect(last!.stages.nativeActions).toBe(false);
    expect((await h.writer.getRuntime()).tripped.nativeAction).toBe(T0);
  });
});

describe('Undo and Exceptions', () => {
  it('routes undoFromActivity to the removing tab; reportUndo records one undone event and one Exception', async () => {
    const h = harness();
    const r1 = (await h.addRules(keywordRule('drama')))[0]!;
    await h.call('reportActionResult', { ok: true, videoId: 'jjjjjjjjjjj', surface: 'home', nativeAction: 'notInterested', batchId: 'b1', title: 'Drama time', channelName: 'Chan', ruleId: r1.id, source: 'exact' }, contentSender(1));
    expect(await h.call('undoFromActivity', { videoId: 'jjjjjjjjjjj' })).toEqual({ ok: true });
    expect(h.sentOf('undoRemoval')).toEqual([{ type: 'undoRemoval', data: { videoId: 'jjjjjjjjjjj' }, tabId: 1 }]);
    // Content answers ok and reports the undo, maybe twice when two detectors fire.
    await h.call('reportUndo', { videoId: 'jjjjjjjjjjj', via: 'shoo' }, contentSender(1));
    await h.call('reportUndo', { videoId: 'jjjjjjjjjjj', via: 'site' }, contentSender(1));
    const exceptions = await h.writer.getExceptions();
    expect(exceptions).toEqual([expect.objectContaining({ videoId: 'jjjjjjjjjjj', title: 'Drama time', channelName: 'Chan', ruleId: r1.id })]);
    const events = Object.entries(h.areas.local.dump())
      .filter(([k]) => /^activity:\d/.test(k))
      .flatMap(([, v]) => v as { kind: string }[]);
    expect(events.filter((e) => e.kind === 'undone')).toHaveLength(1);
    // The Removal is no longer undoable.
    expect(await h.call('undoFromActivity', { videoId: 'jjjjjjjjjjj' })).toEqual({ ok: false, reason: 'expired' });
  });

  it('answers expired for a closed tab, a navigated tab and an unknown video', async () => {
    const h = harness();
    const report = (videoId: string) =>
      h.call('reportActionResult', { ok: true, videoId, surface: 'home', nativeAction: 'notInterested', batchId: 'b', title: 't' }, contentSender(1));
    await report('kkkkkkkkkkk');
    h.tabs.set(1, { id: 1, url: 'https://example.com/' });
    expect(await h.call('undoFromActivity', { videoId: 'kkkkkkkkkkk' })).toEqual({ ok: false, reason: 'expired' });
    h.tabs.set(1, { id: 1, url: 'https://www.youtube.com/' });
    await report('lllllllllll');
    h.tabs.delete(1);
    expect(await h.call('undoFromActivity', { videoId: 'lllllllllll' })).toEqual({ ok: false, reason: 'expired' });
    await h.bg.onTabRemoved(1);
    expect(await h.call('undoFromActivity', { videoId: 'lllllllllll' })).toEqual({ ok: false, reason: 'expired' });
    expect(await h.call('undoFromActivity', { videoId: 'zzzzzzzzzzz' })).toEqual({ ok: false, reason: 'expired' });
    expect(h.sentOf('undoRemoval')).toHaveLength(0);
  });

  it('broadcasts settingsChanged after Exception changes from pages and from content', async () => {
    const h = harness();
    await h.bg.onStartup();
    const before = h.sentOf('settingsChanged').length;
    await h.call('addException', { videoId: 'mmmmmmmmmmm', title: 't', origin: 'activityKeep' });
    expect(h.sentOf('settingsChanged')).toHaveLength(before + 1);
    await h.call('removeException', { videoId: 'mmmmmmmmmmm' });
    expect(h.sentOf('settingsChanged')).toHaveLength(before + 2);
    // Content's own Keep too: another tab may hold a queued job for the video.
    await h.call('addException', { videoId: 'mmmmmmmmmmm', title: 't', origin: 'reviewKeep' }, contentSender());
    expect(h.sentOf('settingsChanged')).toHaveLength(before + 3);
  });
});

describe('keepChannel', () => {
  it('asks before lifting a ban, then adds the Keep rule and tombstones the ban', async () => {
    const h = harness();
    const [ban] = await h.addRules(banRule('Jake Reacts'));
    expect(await h.call('keepChannel', {}, contentSender())).toEqual({ error: 'noChannel' });
    expect(await h.call('keepChannel', { channelName: 'jake  reacts' }, contentSender())).toEqual({ ruleId: '', bannedRuleId: ban!.id });
    expect((await h.writer.getRules()).filter((r) => r.polarity === 'keep')).toHaveLength(0);
    const sentBefore = h.sentOf('settingsChanged').length;
    const res = await h.call('keepChannel', { channelName: 'Jake Reacts', liftBan: true });
    expect(res).toEqual({ ruleId: expect.any(String), liftedBanRuleId: ban!.id });
    const rules = await h.writer.getRules();
    expect(rules).toEqual([expect.objectContaining({ id: (res as { ruleId: string }).ruleId, polarity: 'keep', kind: 'channel', params: { channelName: 'Jake Reacts' } })]);
    expect(h.sentOf('settingsChanged').length).toBe(sentBefore + 1);
    // Asking again returns the existing Keep rule.
    expect(await h.call('keepChannel', { channelName: 'Jake Reacts' })).toEqual({ ruleId: (res as { ruleId: string }).ruleId });
  });

  it('is refused from a private window, so nothing reaches sync', async () => {
    const h = harness({ tabs: [{ id: 7, url: 'https://www.youtube.com/', incognito: true }] });
    expect(await h.call('keepChannel', { channelName: 'Jake Reacts' }, contentSender(7, true))).toEqual({ error: 'privateWindow' });
    expect(await h.writer.getRules()).toEqual([]);
  });

  it('keeps the ban when liftBan is false', async () => {
    const h = harness();
    const [ban] = await h.addRules(banRule('Jake Reacts'));
    const res = await h.call('keepChannel', { channelName: 'Jake Reacts', liftBan: false });
    expect(res).toEqual({ ruleId: expect.any(String), bannedRuleId: ban!.id });
    expect(await h.writer.getRules()).toHaveLength(2);
  });
});

describe('Escalation', () => {
  /** 3 judged Tiles of one channel (decided by an Exact rule) and `n` Topic removals. */
  async function topicRemovals(h: ReturnType<typeof harness>, n: number, from = 0) {
    const replies = [];
    for (let i = from; i < from + n; i++) {
      const videoId = `drama${i}aaaaa`.slice(0, 11);
      await h.call('judgeTiles', { items: [tile(videoId, `drama ${i}`, { channelName: 'Drama Hub' })], settingsGeneration: 0 }, contentSender());
      replies.push(
        await h.call('reportActionResult', { ok: true, videoId, surface: 'home', nativeAction: 'notInterested', batchId: `b${i}`, title: `drama ${i}`, channelName: 'Drama Hub', source: 'model', p: 0.9, mode: 'auto' }, contentSender()),
      );
    }
    return replies;
  }

  it('suggests a channel after 3 Topic removals of at least half its judged Tiles, and Not now waits for 3 more', async () => {
    const h = harness();
    await h.addRules(keywordRule('drama'));
    await topicRemovals(h, 2);
    expect(await h.call('listEscalations', undefined)).toEqual([]);
    await topicRemovals(h, 1, 2);
    expect(await h.call('listEscalations', undefined)).toEqual([{ channelKey: 'drama hub', channelName: 'Drama Hub', removed: 3, judged: 3 }]);
    await h.call('dismissEscalation', { channelKey: 'drama hub' });
    expect(await h.call('listEscalations', undefined)).toEqual([]);
    await topicRemovals(h, 2, 3);
    expect(await h.call('listEscalations', undefined)).toEqual([]);
    await topicRemovals(h, 1, 5);
    expect(await h.call('listEscalations', undefined)).toEqual([expect.objectContaining({ channelKey: 'drama hub', removed: 6 })]);
    const { ruleId } = await h.call('confirmEscalation', { channelKey: 'drama hub' });
    expect((await h.writer.getRules()).find((r) => r.id === ruleId)).toMatchObject({ kind: 'channel', polarity: 'remove', origin: 'escalation', params: { channelName: 'Drama Hub' } });
    expect(await h.call('listEscalations', undefined)).toEqual([]);
  });

  it('counts a same-named channel on each Site apart, and bans it on its own Site only', async () => {
    const h = harness({ tabs: [{ id: 1, url: 'https://www.youtube.com/' }, { id: 2, url: 'https://www.bilibili.com/' }] });
    await h.addRules(keywordRule('drama'));
    const bili = contentSender(2, false, 'https://www.bilibili.com/');
    async function biliRemovals(n: number, from: number) {
      for (let i = from; i < from + n; i++) {
        const videoId = `BV1DRAMA${String(i).padStart(4, '0')}`;
        await h.call('judgeTiles', { items: [tile(videoId, `drama ${i}`, { channelName: 'Drama Hub', surface: 'bilibiliHome' })], settingsGeneration: 0 }, bili);
        await h.call('reportActionResult', { ok: true, videoId, surface: 'bilibiliHome', nativeAction: 'notInterested', batchId: `c${i}`, title: `drama ${i}`, channelName: 'Drama Hub', source: 'model', p: 0.9, mode: 'auto' }, bili);
      }
    }
    await topicRemovals(h, 1);
    await biliRemovals(2, 0);
    expect(await h.call('listEscalations', undefined)).toEqual([]);
    await biliRemovals(1, 2);
    expect(await h.call('listEscalations', undefined)).toEqual([{ channelKey: 'bilibili:drama hub', channelName: 'Drama Hub', removed: 3, judged: 3 }]);
    const { ruleId } = await h.call('confirmEscalation', { channelKey: 'bilibili:drama hub' });
    expect((await h.writer.getRules()).find((r) => r.id === ruleId)).toMatchObject({ params: { channelName: 'Drama Hub' }, site: 'bilibili' });
    // The Escalation's Activity row is about no video, so it carries the Site itself.
    expect((await queryActivity(h.areas.local, { kinds: ['escalated'] }))[0]).toMatchObject({ ruleId, site: 'bilibili' });
  });

  it('bans a channel from a record stored before Sites on YouTube only', async () => {
    const h = harness();
    await h.writer.updateEscalation((all) => ({ ...all, 'news daily': { judged: {}, topicRemoved: {}, name: 'News Daily', suggestedAt: T0 } }));
    const { ruleId } = await h.call('confirmEscalation', { channelKey: 'news daily' });
    expect((await h.writer.getRules()).find((r) => r.id === ruleId)).toMatchObject({ params: { channelName: 'News Daily' }, site: 'youtube' });
  });

  it('bans automatically in Automatic mode, records escalated and broadcasts settingsChanged', async () => {
    const h = harness();
    await h.addRules(keywordRule('drama'));
    await h.call('updateSettings', { patch: { escalationMode: 'automatic' } });
    const before = h.sentOf('settingsChanged').length;
    const replies = await topicRemovals(h, 3);
    const ban = (await h.writer.getRules()).find((r) => r.origin === 'escalation');
    expect(ban).toMatchObject({ kind: 'channel', polarity: 'remove', text: 'Drama Hub' });
    // Only the Removal that made the ban says so, for the batch summary.
    expect(replies.map((r) => r.escalated)).toEqual([undefined, undefined, { ruleId: ban!.id, channelName: 'Drama Hub' }]);
    const events = Object.entries(h.areas.local.dump())
      .filter(([k]) => /^activity:\d/.test(k))
      .flatMap(([, v]) => v as { kind: string; ruleId?: string; batchId?: string }[]);
    expect(events.filter((e) => e.kind === 'escalated')).toEqual([expect.objectContaining({ ruleId: ban!.id, batchId: 'b2', channelKey: 'drama hub' })]);
    expect(h.sentOf('settingsChanged').length).toBeGreaterThan(before);
  });

  it('never escalates a channel with an Exception', async () => {
    const h = harness();
    await h.addRules(keywordRule('drama'));
    await h.call('addException', { videoId: 'protectedaa', title: 't', channelName: 'Drama Hub', origin: 'activityKeep' });
    await topicRemovals(h, 3);
    expect(await h.call('listEscalations', undefined)).toEqual([]);
  });
});

describe('settings, commands and lifecycle', () => {
  it('toggle-shoo flips enabled, raises the generation and broadcasts', async () => {
    const h = harness();
    await h.bg.onStartup();
    const gen = (await h.writer.getSettings()).generation;
    await h.bg.onCommand('toggle-shoo');
    const settings = await h.writer.getSettings();
    expect(settings.enabled).toBe(false);
    expect(settings.generation).toBe(gen + 1);
    const last = h.sentOf('runtimeStateChanged').at(-1)!.data as RuntimeSnapshot;
    expect(last).toMatchObject({ enabled: false, reason: 'off', eye: 'paused', settingsGeneration: gen + 1 });
    expect(h.sentOf('settingsChanged').at(-1)!.data).toMatchObject({ settingsGeneration: gen + 1 });
    await h.bg.onCommand('something-else');
    expect((await h.writer.getSettings()).enabled).toBe(false);
  });

  it('setMode forwards actOnShowingChips in settingsChanged', async () => {
    const h = harness();
    const snap = await h.call('setMode', { mode: 'auto', actOnShowingChips: true });
    expect(snap.mode).toBe('auto');
    expect(h.sentOf('settingsChanged').at(-1)!.data).toMatchObject({ actOnShowingChips: true });
  });

  it('consent flow: noConsent until giveConsent, broadcast on change, withdraw returns to noConsent', async () => {
    const h = harness();
    await h.bg.onStartup();
    expect((await h.call('getRuntimeState', undefined)).reason).toBe('noConsent');
    const given = await h.call('giveConsent', { version: CONSENT_VERSION });
    expect(given.reason).toBe('noKey');
    expect((await h.writer.getSettings()).consent).toEqual({ version: CONSENT_VERSION, acceptedAt: T0 });
    expect((h.sentOf('runtimeStateChanged').at(-1)!.data as RuntimeSnapshot).reason).toBe('noKey');
    expect((await h.call('withdrawConsent', undefined)).reason).toBe('noConsent');
  });

  it('opens Settings at the root or at a section', async () => {
    const h = harness();
    await h.call('openSettings', {}, contentSender());
    await h.call('openSettings', { hash: 'activity?batch=b1' }, contentSender());
    expect(h.platform.tabs.create).toHaveBeenCalledWith({ url: `chrome-extension://test-extension-id/options.html` });
    expect(h.platform.tabs.create).toHaveBeenCalledWith({ url: `chrome-extension://test-extension-id/options.html#activity?batch=b1` });
  });

  it('opens onboarding on install and creates the retention alarm only when missing', async () => {
    const h = harness();
    await h.bg.onInstalled('install');
    expect(h.platform.tabs.create).toHaveBeenCalledWith({ url: 'chrome-extension://test-extension-id/onboarding.html' });
    expect(h.platform.alarms.create).toHaveBeenCalledTimes(1);
    expect(h.alarms.get(RETENTION_ALARM)).toEqual({ periodInMinutes: 1440, delayInMinutes: 1 });
    await h.bg.onStartup();
    await h.bg.onInstalled('update');
    expect(h.platform.alarms.create).toHaveBeenCalledTimes(1);
    expect(h.platform.tabs.create).toHaveBeenCalledTimes(1);
  });

  it('offline events change the snapshot and are broadcast', async () => {
    const h = harness();
    await h.connect();
    await h.bg.onNetwork(false);
    expect((h.sentOf('runtimeStateChanged').at(-1)!.data as RuntimeSnapshot).reason).toBe('offline');
    await h.bg.onNetwork(true);
    expect((h.sentOf('runtimeStateChanged').at(-1)!.data as RuntimeSnapshot).reason).toBe('ok');
  });

  it('reports hostRevoked when the openrouter.ai permission is missing', async () => {
    const h = harness({ hosts: { 'https://openrouter.ai/*': false } });
    await h.connect();
    const snap = await h.call('getRuntimeState', undefined);
    expect(snap).toMatchObject({ reason: 'hostRevoked', stages: { exact: true, model: false } });
  });

  it('resetAll clears Rules, keys and settings and broadcasts', async () => {
    const h = harness();
    await h.addRules(keywordRule('drama'));
    await h.connect();
    const before = h.sentOf('settingsChanged').length;
    await h.call('resetAll', undefined);
    expect(await h.writer.getRules()).toEqual([]);
    expect(await getOpenRouterKey(h.areas.local)).toBeUndefined();
    expect((await h.writer.getSettings()).consent).toBeUndefined();
    expect(h.sentOf('settingsChanged').length).toBe(before + 1);
    expect(localKeys(h)).toEqual(expect.arrayContaining(['meta', 'settings']));
  });
});

describe('connection', () => {
  it('setKey with a rejected key stores nothing', async () => {
    const fake = fakeOpenRouter({ key: () => ({ status: 401, body: { error: { message: 'User not found.', code: 401 } } }) });
    const h = harness({ fetch: fake.fetch });
    expect(await h.call('setKey', { key: 'sk-or-v1-bad' })).toEqual({ ok: false, error: 'keyRejected' });
    expect(await getOpenRouterKey(h.areas.local)).toBeUndefined();
  });

  it('a model 401 shows noKey + keyRejected until a working key is set', async () => {
    const fake = fakeOpenRouter({ decisions: () => fromFixture(fixture('error-401')) });
    const h = harness({ fetch: fake.fetch });
    await h.addRules(topicRule('Reaction videos'));
    await h.connect();
    const reply = await h.call('judgeTiles', { items: [tile('nnnnnnnnnnn', 'Jake reacts')], settingsGeneration: 1 }, contentSender());
    expect(reply.runtime).toMatchObject({ reason: 'noKey', detail: 'keyRejected', eye: 'error' });
    expect((await h.writer.getRuntime()).failures.model).toBe(0);
    const set = await h.call('setKey', { key: 'sk-or-v1-good' });
    expect(set).toEqual({ ok: true, label: 'sk-or-v1-abc...xyz' });
    expect(await getOpenRouterKey(h.areas.local)).toMatchObject({ key: 'sk-or-v1-good', source: 'pasted', connectedAt: T0 });
    expect((await h.call('getRuntimeState', undefined)).reason).toBe('ok');
  });

  it('getKeyUsage reports noKey without a key, usage with one, and disconnect forgets it', async () => {
    const h = harness();
    expect(await h.call('getKeyUsage', undefined)).toEqual({ error: 'noKey' });
    await h.connect();
    expect(await h.call('getKeyUsage', undefined)).toEqual({ label: 'sk-or-v1-abc...xyz', source: 'pasted', connectedAt: T0, usage: 0.5, usageDaily: 0.1, limit: null, limitRemaining: null });
    await h.call('disconnect', undefined);
    expect(await h.call('getKeyUsage', undefined)).toEqual({ error: 'noKey' });
  });

  it('connectOpenRouter without the identity API opens the headless page', async () => {
    const h = harness();
    expect(await h.call('connectOpenRouter', undefined)).toEqual({ ok: false, error: 'unsupported' });
    expect(h.platform.tabs.create).toHaveBeenCalledWith({ url: expect.stringMatching(/^https:\/\/openrouter\.ai\/auth\?code_challenge=/) });
    expect(h.areas.session.dump().oauth).toMatchObject({ codeVerifier: expect.any(String) });
  });

  it('a custom endpoint needs consent naming its host', async () => {
    const h = harness();
    await h.connect();
    expect(await h.call('setCustomEndpoint', { baseUrl: 'https://llm.example.com/v1', model: 'm', key: 'k' })).toEqual({ ok: true });
    expect((await h.call('getRuntimeState', undefined)).reason).toBe('noConsent');
    expect((await h.call('giveConsent', { version: CONSENT_VERSION, customHost: 'llm.example.com' })).reason).toBe('ok');
    // Back to OpenRouter: the page withdraws the custom-host consent, so the model waits for new consent.
    await h.call('updateSettings', { patch: { engine: 'openrouter' } });
    expect((await h.call('withdrawConsent', undefined)).reason).toBe('noConsent');
    expect(await h.call('setCustomEndpoint', { baseUrl: 'ftp://x', model: 'm', key: 'k' })).toEqual({ ok: false, error: 'invalidInput' });
  });
});

describe('edge cases in judging, keys and reports', () => {
  it('replies with the settings generation the batch was judged under', async () => {
    const inner = fakeOpenRouter();
    const holder: { h?: ReturnType<typeof harness> } = {};
    const h = harness({
      fetch: async (url, init) => {
        await holder.h!.writer.updateSettings({ notificationStyle: 'silent' }); // a settings change mid-flight
        return inner.fetch(url, init);
      },
    });
    holder.h = h;
    await h.addRules(topicRule('Reaction videos'));
    await h.connect();
    const gen = (await h.writer.getSettings()).generation;
    const reply = await h.call('judgeTiles', { items: [tile('ooooooooooo', 'Jake reacts')], settingsGeneration: gen }, contentSender());
    expect(reply.settingsGeneration).toBe(gen);
    expect((await h.writer.getSettings()).generation).toBe(gen + 1);
  });

  it('a double click on Always keep this channel adds one Keep rule', async () => {
    const h = harness();
    const [a, b] = await Promise.all([h.call('keepChannel', { channelName: 'Code Bites' }), h.call('keepChannel', { channelName: 'Code Bites' })]);
    expect(a).toEqual(b);
    expect(await h.writer.getRules()).toHaveLength(1);
  });

  it('saving a custom endpoint clears a rejected-key state', async () => {
    const h = harness();
    await h.connect();
    await h.bg.services.state.setFlag('keyRejected');
    expect((await h.call('getRuntimeState', undefined)).detail).toBe('keyRejected');
    await h.call('setCustomEndpoint', { baseUrl: 'https://llm.example.com/v1', model: 'm', key: 'k' });
    expect(await h.call('giveConsent', { version: CONSENT_VERSION, customHost: 'llm.example.com' })).toMatchObject({ reason: 'ok' });
  });

  it('a 200 from getKeyUsage lifts a rejected-key state', async () => {
    const h = harness();
    await h.connect();
    await h.bg.services.state.setFlag('keyRejected');
    await h.call('getKeyUsage', undefined);
    expect((await h.call('getRuntimeState', undefined)).reason).toBe('ok');
  });

  it('markup failures from a private window still trip the breaker', async () => {
    const h = harness({ tabs: [{ id: 7, url: 'https://www.youtube.com/', incognito: true }] });
    let snap: RuntimeSnapshot | undefined;
    for (let i = 0; i < 5; i++) snap = await h.call('reportMarkupCheck', { ok: false, selectorVersion: 's1', missing: ['menu'] }, contentSender(7, true));
    expect(snap!.stages.exact).toBe(false);
    expect((await h.writer.getRuntime()).tripped.markup).toBe(T0);
  });

  it('accepts a Dry-run report larger than one batch', async () => {
    const h = harness();
    const results = Array.from({ length: 100 }, (_, i) => ({
      videoId: `w${String(i).padStart(10, '0')}`,
      status: 'decided' as const,
      verdict: { videoId: `w${String(i).padStart(10, '0')}`, outcome: 'remove' as const, source: 'exact' as const, rulesVersion: 'x', at: T0, nativeAction: 'notInterested' as const },
    }));
    await h.call('recordWouldRemove', { results, batchId: 'big' }, contentSender());
    const events = Object.entries(h.areas.local.dump())
      .filter(([k]) => /^activity:\d/.test(k))
      .flatMap(([, v]) => v as { kind: string }[]);
    expect(events.filter((e) => e.kind === 'wouldRemove')).toHaveLength(100);
  });
});

describe('engines, consent, tabs and Rule edits', () => {
  /** OpenRouter fake plus a custom endpoint at `base` that answers every Tile with keep. */
  function withCustom(base: string) {
    const fake = fakeOpenRouter();
    const custom: string[] = [];
    const fetch: typeof fake.fetch = async (url, init) => {
      if (!String(url).startsWith(base)) return fake.fetch(url, init);
      custom.push(String(url));
      const videos = JSON.parse(JSON.parse(String(init!.body)).messages[1].content) as { id: string }[];
      const content = JSON.stringify({ results: videos.map((v) => ({ id: v.id, outcome: 'keep', rule: null, probability: 0.1 })) });
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }), { status: 200 });
    };
    return { fake, custom, fetch };
  }
  const judge = (h: ReturnType<typeof harness>, videoId = 'ppppppppppp') =>
    h.call('judgeTiles', { items: [tile(videoId, 'Jake reacts')], settingsGeneration: 0 }, contentSender());

  it('"Use OpenRouter" switching the engine before withdrawing sends nothing to OpenRouter', async () => {
    const net = withCustom('https://llm.example.com');
    const h = harness({ fetch: net.fetch });
    await h.addRules(topicRule('Reaction videos'));
    await setOpenRouterKey({ key: 'sk-or-v1-test', source: 'pasted', connectedAt: T0 }, h.areas.local);
    await h.call('setCustomEndpoint', { baseUrl: 'https://llm.example.com/v1', model: 'm', key: 'k' });
    await h.call('giveConsent', { version: CONSENT_VERSION, customHost: 'llm.example.com' });
    expect((await judge(h)).runtime.reason).toBe('ok');
    expect(net.custom).toHaveLength(1);
    await h.call('updateSettings', { patch: { engine: 'openrouter' } }); // withdrawConsent not sent yet, or failed
    const reply = await judge(h, 'qqqqqqqqqqq');
    expect(reply.runtime.reason).toBe('noConsent');
    expect(reply.results[0]).toMatchObject({ status: 'undecided', reason: 'noConsent' });
    expect(net.fake.decisionRequests()).toHaveLength(0);
  });

  it('a local endpoint saved with no key judges through chat and sends no Authorization header', async () => {
    const net = withCustom('http://localhost:11434');
    const headers: unknown[] = [];
    const h = harness({
      fetch: (url, init) => {
        if (String(url).startsWith('http://localhost:11434')) headers.push(init?.headers);
        return net.fetch(url, init);
      },
    });
    await h.addRules(topicRule('Reaction videos'));
    await h.call('setCustomEndpoint', { baseUrl: 'http://localhost:11434/v1', model: 'qwen3:4b', key: '' });
    expect((await h.call('giveConsent', { version: CONSENT_VERSION, customHost: 'localhost:11434' })).reason).toBe('ok');
    expect((await judge(h)).runtime.reason).toBe('ok');
    expect(net.custom).toEqual(['http://localhost:11434/v1/chat/completions']);
    expect(headers).toEqual([{ 'Content-Type': 'application/json' }]);
    expect(net.fake.decisionRequests()).toHaveLength(0);
  });

  it('re-saving with the key left out keeps the stored key only for the same origin', async () => {
    const h = harness();
    await h.call('setCustomEndpoint', { baseUrl: 'https://api.openai.com/v1', model: 'gpt-6-luna', key: 'sk-one' });
    await h.call('setCustomEndpoint', { baseUrl: 'https://api.openai.com/v1/', model: 'gpt-6-luna-mini' });
    expect((await getCustomKey(h.areas.local))?.key).toBe('sk-one');
    // Another host never receives the stored key.
    await h.call('setCustomEndpoint', { baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-20b' });
    expect((await getCustomKey(h.areas.local))?.key).toBe('');
  });

  it('consent given for a custom host before setCustomEndpoint never reaches OpenRouter', async () => {
    const fake = fakeOpenRouter();
    const h = harness({ fetch: fake.fetch });
    await h.addRules(topicRule('Reaction videos'));
    await setOpenRouterKey({ key: 'sk-or-v1-test', source: 'pasted', connectedAt: T0 }, h.areas.local);
    expect((await h.call('giveConsent', { version: CONSENT_VERSION, customHost: 'llm.example.com' })).reason).toBe('noConsent');
    expect((await judge(h)).results[0]).toMatchObject({ status: 'undecided', reason: 'noConsent' });
    expect(fake.decisionRequests()).toHaveLength(0);
  });

  it('consent recorded under consent version 2, before Bilibili was named, counts as noConsent', async () => {
    const h = harness();
    await h.connect();
    expect((await h.call('getRuntimeState', undefined)).reason).toBe('ok');
    await h.writer.updateSettings({ consent: { version: 2, acceptedAt: T0 } });
    expect((await h.call('getRuntimeState', undefined)).reason).toBe('noConsent');
  });

  it('a consent withdrawn while a batch waits stops the request', async () => {
    const inner = fakeOpenRouter();
    const holder: { h?: ReturnType<typeof harness> } = {};
    let withdrawn = false;
    const h = harness({
      fetch: async (url, init) => {
        if (!withdrawn) {
          withdrawn = true;
          await holder.h!.call('withdrawConsent', undefined); // lands between the gate and the next request
        }
        return inner.fetch(url, init);
      },
    });
    holder.h = h;
    await h.addRules(topicRule('Reaction videos'));
    await h.connect();
    const items = Array.from({ length: 48 }, (_, i) => tile(`r${String(i).padStart(10, '0')}`, `Jake reacts ${i}`));
    const reply = await h.call('judgeTiles', { items, settingsGeneration: 0 }, contentSender());
    // At most the two requests already in flight went out. The third waited for a slot and was stopped.
    expect(inner.decisionRequests().length).toBeLessThanOrEqual(2);
    expect(reply.results.filter((r) => r.reason === 'noConsent').length).toBeGreaterThanOrEqual(16);
  });

  it('Exceptions from a YouTube tab (Review Keep, Undo) reach the other tabs', async () => {
    const h = harness({ tabs: [{ id: 1, url: 'https://www.youtube.com/' }, { id: 2, url: 'https://www.youtube.com/watch?v=x' }] });
    await h.bg.onStartup();
    const before = h.sentOf('settingsChanged').length;
    await h.call('addException', { videoId: 'sssssssssss', title: 't', origin: 'reviewKeep' }, contentSender(1));
    expect(h.sentOf('settingsChanged').slice(before).map((m) => m.tabId).sort()).toEqual([1, 2]);
    await h.call('reportUndo', { videoId: 'ttttttttttt', via: 'site' }, contentSender(1));
    expect(h.sentOf('settingsChanged').length).toBe(before + 4);
  });

  it('actOnShowingChips goes only to the active YouTube tab the popup counted', async () => {
    // The harness treats the first tab as the active one.
    const h = harness({ tabs: [{ id: 2, url: 'https://www.youtube.com/' }, { id: 1, url: 'https://www.youtube.com/feed' }] });
    await h.call('setMode', { mode: 'auto', actOnShowingChips: true });
    const sent = h.sentOf('settingsChanged');
    expect(sent.find((m) => m.tabId === 2)!.data).toMatchObject({ actOnShowingChips: true });
    expect('actOnShowingChips' in sent.find((m) => m.tabId === 1)!.data).toBe(false);
  });

  it.each([
    ['with a port', 'http://localhost:11434/v1', 'localhost:11434', 'http://localhost:11434/*', 'http://localhost/*'],
    ['without a port', 'https://llm.example.com/v1', 'llm.example.com', 'https://llm.example.com/*', 'https://llm.example.com:443/*'],
  ])('checks custom endpoint host access with the origin the page requested (%s)', async (_, baseUrl, host, granted, other) => {
    const h = harness({ hosts: { [granted]: true, [other]: false } });
    await h.call('setCustomEndpoint', { baseUrl, model: 'm', key: 'k' });
    expect((await h.call('giveConsent', { version: CONSENT_VERSION, customHost: host })).reason).toBe('ok');
  });

  describe('a Decision provider reached directly (§12)', () => {
    const OLLAMA = { provider: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'clef-flash' } as const;
    /** A stand-in System One server on localhost:11434 that answers keep for every question. */
    function withOllama() {
      const fake = fakeOpenRouter();
      const calls: { url: string; headers: unknown; body: any }[] = [];
      const fetch: typeof fake.fetch = async (url, init) => {
        if (!String(url).startsWith('http://localhost:11434')) return fake.fetch(url, init);
        const body = JSON.parse(String(init!.body));
        calls.push({ url: String(url), headers: init?.headers, body });
        const answers = Object.fromEntries(
          Object.entries<any>(body.questions).map(([id, q]) =>
            q.type === 'choice'
              ? [id, { type: 'choice', choice: 'keep', probabilities: Object.fromEntries(Object.keys(q.criteria).map((k) => [k, k === 'keep' ? 1 : 0])), confidence: 0.9 }]
              : [id, { type: 'noul', noul: 0.01 }],
          ),
        );
        return new Response(JSON.stringify({ model: body.model, answers, usage: { input_tokens: 10, output_tokens: 0 } }), { status: 200 });
      };
      return { fake, calls, fetch };
    }

    it('saved with no key, needs consent naming its host, then judges on this computer with no Authorization header', async () => {
      const net = withOllama();
      const h = harness({ fetch: net.fetch });
      await h.addRules(topicRule('Reaction videos'));
      expect(await h.call('setDirectEndpoint', OLLAMA)).toEqual({ ok: true });
      expect((await getDirectKey(h.areas.local))?.key).toBe('');
      expect((await h.call('getRuntimeState', undefined)).reason).toBe('noConsent');
      expect((await judge(h)).results[0]).toMatchObject({ status: 'undecided', reason: 'noConsent' });
      expect(net.calls).toEqual([]);
      expect((await h.call('giveConsent', { version: CONSENT_VERSION, customHost: 'localhost:11434' })).reason).toBe('ok');
      expect((await judge(h, 'qqqqqqqqqqq')).results[0]).toMatchObject({ status: 'decided' });
      expect(net.calls.map((c) => [c.url, c.headers])).toEqual([['http://localhost:11434/v1/systemone', { 'Content-Type': 'application/json' }]]);
      expect(net.calls[0]!.body.provider).toBeUndefined();
      expect(net.fake.decisionRequests()).toHaveLength(0);
    });

    it('testDirectEndpoint never calls a provider online, where a call spends credit', async () => {
      const fake = fakeOpenRouter();
      const urls: string[] = [];
      const h = harness({ fetch: (url, init) => (urls.push(String(url)), fake.fetch(url, init)) });
      expect(await h.call('testDirectEndpoint', { provider: 'perplexity', baseUrl: 'https://api.perplexity.ai/v1', model: 'pplx-decider-v1.1-27b', key: 'k' })).toEqual({ ok: false, error: 'invalidInput' });
      expect(urls).toEqual([]);
    });

    it('testDirectEndpoint asks the local server one synthetic title, before any consent', async () => {
      const net = withOllama();
      const h = harness({ fetch: net.fetch });
      expect(await h.call('testDirectEndpoint', OLLAMA)).toMatchObject({ ok: true });
      expect(net.calls).toHaveLength(1);
      expect(JSON.stringify(net.calls[0]!.body)).toContain('How sourdough fermentation works');
    });

    it('refuses a provider it does not know, a cloud provider at another host, and a local one off this computer', async () => {
      const h = harness();
      const bad = [
        { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'm', key: 'k' },
        { provider: 'typesafe', baseUrl: 'https://evil.example.com/v1', model: 'jev-1.13.0', key: 'k' },
        { provider: 'cloudflare', baseUrl: 'https://api.cloudflare.com.evil.example/client/v4/accounts/x/ai/run/@cf/cloudflare', model: 'clef-flash', key: 'k' },
        { provider: 'ollama', baseUrl: 'http://192.168.1.5:11434/v1', model: 'clef-flash' },
        { provider: 'ollama', baseUrl: 'https://localhost:11434/v1', model: 'clef-flash' },
        { provider: 'perplexity', baseUrl: 'https://api.perplexity.ai/v1', model: '', key: 'k' },
        { provider: 'ollama', baseUrl: 'http://localhost:11434/v1', model: '' },
      ];
      for (const req of bad) expect(await h.call('setDirectEndpoint', req as never), JSON.stringify(req)).toEqual({ ok: false, error: 'invalidInput' });
      expect((await h.writer.getSettings()).engine).toBe('openrouter');
    });

    it('re-saving with the key left out keeps the stored key only for the same origin, and Reset forgets it', async () => {
      const h = harness();
      const cf = 'https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/run/@cf/cloudflare';
      await h.call('setDirectEndpoint', { provider: 'cloudflare', baseUrl: cf, model: 'clef-flash', key: 'cf-one' });
      await h.call('setDirectEndpoint', { provider: 'cloudflare', baseUrl: cf, model: 'clef-flash' });
      expect((await getDirectKey(h.areas.local))?.key).toBe('cf-one');
      // Another origin never receives the stored key, and a provider online is not saved without one.
      expect(await h.call('setDirectEndpoint', { provider: 'typesafe', baseUrl: 'https://api.typesafe.ai/v1', model: 'jev-1.13.0' })).toEqual({ ok: false, error: 'noKey' });
      expect((await getDirectKey(h.areas.local))?.key).toBe('cf-one');
      await h.call('setDirectEndpoint', { provider: 'typesafe', baseUrl: 'https://api.typesafe.ai/v1', model: 'jev-1.13.0', key: 'ts-two' });
      expect((await getDirectKey(h.areas.local))?.key).toBe('ts-two');
      await h.call('resetAll', undefined);
      expect(await getDirectKey(h.areas.local)).toBeUndefined();
    });

    it.each([
      ['Chrome keeps the port', false, 'http://localhost:11434/*'],
      ['Firefox drops it', true, 'http://localhost/*'],
    ])('host access for a local endpoint: %s', async (_n, firefox, pattern) => {
      const { modelOrigin } = await import('./runtime-state');
      expect(modelOrigin({ ...(await harness().writer.getSettings()), engine: 'direct', direct: OLLAMA }, firefox)).toBe(pattern);
    });
  });

  it('a revoked Firefox data collection permission stops the model, and permission changes refresh the tabs', async () => {
    const fake = fakeOpenRouter();
    const hosts: Record<string, boolean> = {};
    const h = harness({ fetch: fake.fetch, hosts });
    await h.addRules(topicRule('Reaction videos'));
    await h.connect();
    await h.bg.onStartup();
    h.perms.dataCollection = false;
    await h.bg.onPermissionsChanged();
    expect((h.sentOf('runtimeStateChanged').at(-1)!.data as RuntimeSnapshot).reason).toBe('noConsent');
    expect((await judge(h)).results[0]).toMatchObject({ status: 'undecided', reason: 'noConsent' });
    expect(fake.decisionRequests()).toHaveLength(0);
    h.perms.dataCollection = true;
    hosts['https://openrouter.ai/*'] = false;
    await h.bg.onPermissionsChanged();
    expect((h.sentOf('runtimeStateChanged').at(-1)!.data as RuntimeSnapshot).reason).toBe('hostRevoked');
    hosts['https://openrouter.ai/*'] = true;
    const before = h.sentOf('settingsChanged').length;
    await h.bg.onPermissionsChanged();
    expect((h.sentOf('runtimeStateChanged').at(-1)!.data as RuntimeSnapshot).reason).toBe('ok');
    expect(h.sentOf('settingsChanged').length).toBe(before); // runtimeStateChanged alone makes content rescan
  });

  it('limits mutateRules update patches to text, name, params, enabled and kind', async () => {
    const h = harness();
    const [a, b] = await h.addRules(keywordRule('drama'), keywordRule('gossip'));
    for (const patch of [{ id: b!.id }, { ref: 'R9' }, { deletedAt: 1 }, { colour: 3 }, { origin: 'escalation' }, { createdAt: 1 }]) {
      expect(await h.call('mutateRules', { ops: [{ op: 'update', id: a!.id, patch: patch as never }] })).toEqual({ error: 'invalidInput', detail: 'shape' });
    }
    const ok = await h.call('mutateRules', { ops: [{ op: 'update', id: a!.id, patch: { text: 'drama queen', enabled: false } }] });
    expect('rules' in ok && ok.rules.find((r) => r.id === a!.id)).toMatchObject({ text: 'drama queen', enabled: false, ref: a!.ref });
    expect(await h.writer.getRules()).toHaveLength(2);
  });

  it('accepts a Rule name on add and update, as a string only (REQ-RULE-11)', async () => {
    const h = harness();
    const named = { op: 'add' as const, rule: { ...keywordRule('drama').rule, name: ' Drama ' } };
    const [a] = await h.addRules(named);
    expect(a).toMatchObject({ text: 'drama', name: 'Drama' });
    for (const ops of [[{ ...named, rule: { ...named.rule, name: 5 } }], [{ op: 'update', id: a!.id, patch: { name: null } }]]) {
      expect(await h.call('mutateRules', { ops: ops as never })).toEqual({ error: 'invalidInput', detail: 'shape' });
    }
    const renamed = await h.call('mutateRules', { ops: [{ op: 'update', id: a!.id, patch: { name: 'Drama channels' } }] });
    expect('rules' in renamed && renamed.rules[0]).toMatchObject({ text: 'drama', name: 'Drama channels' });
  });

  it('a Rule renamed on another device still redraws the YouTube tabs, though a rename never re-judges (REQ-RULE-11)', async () => {
    const h = harness();
    const [a, b] = await h.addRules(topicRule('Reaction videos'), keywordRule('drama'));
    await h.writer.flush();
    // This device switches drama off. The edit waits for the sync debounce, so the merge below writes back.
    h.clock.t = T0 + 500;
    await h.call('mutateRules', { ops: [{ op: 'update', id: b!.id, patch: { enabled: false } }] });
    const before = h.sentOf('settingsChanged').length;
    // The other device's rename lands in storage.sync. The writer merges it and broadcasts without force.
    h.clock.t = T0 + 1000;
    const [key, bucket] = Object.entries(h.areas.sync.dump() as Record<string, Record<string, object>>).find(([k, v]) => k.startsWith('rules:') && a!.id in v)!;
    await h.areas.sync.set({ [key]: { ...bucket, [a!.id]: { ...bucket[a!.id], n: 'Reactions', ua: T0 + 1000 } } });
    await h.writer.whenIdle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await h.writer.getRules()).toMatchObject([{ text: 'Reaction videos', name: 'Reactions' }, { text: 'drama', enabled: false }]);
    expect(h.sentOf('settingsChanged')).toHaveLength(before + 1);
  });

  it('a clean Rule edit from another device reaches the YouTube tabs: new text with a new rulesVersion, a rename with the same', async () => {
    const h = harness();
    const [a] = await h.addRules(topicRule('Reaction videos'));
    await h.writer.flush();
    await h.writer.whenIdle();
    // The other device's edit lands in storage.sync. Nothing is pending here, so this device writes nothing back.
    const remote = async (at: number, patch: Record<string, unknown>) => {
      h.clock.t = at;
      const [key, bucket] = Object.entries(h.areas.sync.dump() as Record<string, Record<string, object>>).find(([k, v]) => k.startsWith('rules:') && a!.id in v)!;
      const sent = h.sentOf('settingsChanged').length;
      await h.areas.sync.set({ [key]: { ...bucket, [a!.id]: { ...bucket[a!.id], ...patch, ua: at } } });
      await h.writer.whenIdle();
      await new Promise((resolve) => setTimeout(resolve, 0));
      return h.sentOf('settingsChanged').slice(sent).map((m) => (m.data as { rulesVersion: string }).rulesVersion);
    };
    const v0 = (await h.call('getRuntimeState', undefined)).rulesVersion;
    const edited = await remote(T0 + 1000, { t: 'Reaction channels' });
    const v1 = (await h.call('getRuntimeState', undefined)).rulesVersion;
    expect(v1).not.toBe(v0);
    expect(edited).toEqual([v1]);
    expect(await remote(T0 + 2000, { n: 'Reactions' })).toEqual([v1]);
    expect(await h.writer.getRules()).toMatchObject([{ text: 'Reaction channels', name: 'Reactions' }]);
  });

  it('caps Try a title at 300 title and 120 channel characters', async () => {
    const h = harness();
    expect(await h.call('tryTitle', { title: 'x'.repeat(301) })).toEqual({ error: 'invalidInput' });
    expect(await h.call('tryTitle', { title: 'ok', channelName: 'c'.repeat(121) })).toEqual({ error: 'invalidInput' });
    expect(await h.call('tryTitle', { title: '   ' })).toEqual({ error: 'invalidInput' });
    expect(await h.call('tryTitle', { title: 'x'.repeat(300), channelName: 'c'.repeat(120) })).toEqual({ error: 'noConsent' });
  });

  it('a closed tab never drops a Removal another tab records at the same time', async () => {
    const h = harness({ tabs: [{ id: 1, url: 'https://www.youtube.com/' }, { id: 2, url: 'https://www.youtube.com/' }] });
    const report = (videoId: string, tabId: number) =>
      h.call('reportActionResult', { ok: true, videoId, surface: 'home', nativeAction: 'notInterested', batchId: 'b', title: 't' }, contentSender(tabId));
    await report('uuuuuuuuuuu', 1);
    // The cleanup's read of session:removalTabs answers late, while tab 2 records its Removal.
    const session = h.areas.session;
    const get = session.get.bind(session);
    let slow = true;
    session.get = (async (keys: Parameters<typeof get>[0]) => {
      const value = await get(keys);
      if (slow && JSON.stringify(keys ?? null).includes('removalTabs')) {
        slow = false;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return value;
    }) as typeof session.get;
    await Promise.all([h.bg.onTabRemoved(1), report('vvvvvvvvvvv', 2), h.bg.onTabRemoved(1)]);
    expect(await h.call('undoFromActivity', { videoId: 'vvvvvvvvvvv' })).toEqual({ ok: true });
    expect(await h.call('undoFromActivity', { videoId: 'uuuuuuuuuuu' })).toEqual({ ok: false, reason: 'expired' });
  });

  it('openSettings focuses an open Settings tab and moves it to the section', async () => {
    const h = harness();
    h.extensionTabs.push({ tabId: 9, windowId: 4, url: 'chrome-extension://test-extension-id/popup.html' });
    await h.call('openSettings', { hash: 'connection' }, contentSender());
    expect(h.platform.tabs.create).toHaveBeenCalledTimes(1);
    h.extensionTabs.push({ tabId: 5, windowId: 3, url: 'chrome-extension://test-extension-id/options.html#rules' });
    await h.call('openSettings', { hash: 'activity?batch=b1' }, contentSender());
    await h.call('openSettings', {});
    expect(h.platform.tabs.create).toHaveBeenCalledTimes(1);
    expect(h.platform.tabs.update).toHaveBeenNthCalledWith(1, 5, { active: true, url: 'chrome-extension://test-extension-id/options.html#activity?batch=b1' });
    expect(h.platform.tabs.update).toHaveBeenNthCalledWith(2, 5, { active: true });
    expect(h.platform.focusWindow).toHaveBeenCalledWith(3);
  });

  it('Escalation suggestions name the Rule that removed most of the channel’s Tiles', async () => {
    const h = harness();
    const [kw, r1, r2] = await h.addRules(keywordRule('drama'), topicRule('Reaction videos'), topicRule('Celebrity gossip'));
    const rules = [r1!.id, r2!.id, r2!.id];
    for (const [i, ruleId] of rules.entries()) {
      const videoId = `esc${i}aaaaaaaa`.slice(0, 11);
      await h.call('judgeTiles', { items: [tile(videoId, `drama ${i}`, { channelName: 'Drama Hub' })], settingsGeneration: 0 }, contentSender());
      await h.call('reportActionResult', { ok: true, videoId, surface: 'home', nativeAction: 'notInterested', batchId: `b${i}`, title: `drama ${i}`, channelName: 'Drama Hub', ruleId, source: 'model', p: 0.9 }, contentSender());
    }
    expect(kw).toBeDefined();
    expect(await h.call('listEscalations', undefined)).toEqual([{ channelKey: 'drama hub', channelName: 'Drama Hub', removed: 3, judged: 3, ruleId: r2!.id }]);
    // A deleted Rule is not named.
    await h.call('mutateRules', { ops: [{ op: 'delete', id: r2!.id }] });
    expect((await h.call('listEscalations', undefined))[0]).not.toHaveProperty('ruleId');
  });
});
