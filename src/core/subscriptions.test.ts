import { describe, expect, it } from 'vitest';
import { parseSubscribedChannels, subscribedMatcher } from './subscriptions';
import type { TileFacts } from './types';

// Synthetic: shaped like the channelRenderer objects of youtube.com/feed/channels, not a captured page.
const channel = (id: string, name: string, base: string, subscribed = true) => ({
  channelRenderer: {
    channelId: id,
    title: { simpleText: name },
    navigationEndpoint: { browseEndpoint: { browseId: id, canonicalBaseUrl: base } },
    subscriptionButton: { subscribed },
  },
});
const page = (items: unknown[]) => {
  const data = {
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: [{ shelfRenderer: { content: { expandedShelfContentsRenderer: { items } } } }] } }] } } } }],
      },
    },
  };
  return `<!doctype html><html><body><script nonce="x">var ytInitialData = ${JSON.stringify(data)};</script><script>var other = 1;</script></body></html>`;
};

const tile = (over: Partial<TileFacts>): TileFacts => ({ videoId: 'v', surface: 'home', title: 't', isShort: false, isLive: false, isUpcoming: false, isMembersOnly: false, ...over });

describe('parseSubscribedChannels', () => {
  it('reads the id, handle and name of every subscribed channel, sorted', () => {
    const html = page([
      channel('UCbbbbbbbbbbbbbbbbbbbbbb', 'Code  Bites', '/@CodeBites'),
      channel('UCaaaaaaaaaaaaaaaaaaaaaa', 'Café Ünïcode', '/@caf%C3%A9'),
      channel('UCcccccccccccccccccccccc', 'Old Channel', '/channel/UCcccccccccccccccccccccc'),
      channel('UCdddddddddddddddddddddd', 'Not Subscribed', '/@notsub', false),
    ]);
    expect(parseSubscribedChannels(html)).toEqual({
      ids: ['UCaaaaaaaaaaaaaaaaaaaaaa', 'UCbbbbbbbbbbbbbbbbbbbbbb', 'UCcccccccccccccccccccccc'],
      handles: ['café', 'codebites'],
      keys: ['café ünïcode', 'code bites', 'old channel'],
    });
  });

  it('finds nothing in a page without ytInitialData, with broken JSON, or without a subscribed channel', () => {
    expect(parseSubscribedChannels('<html><body>Sign in</body></html>')).toBeUndefined();
    expect(parseSubscribedChannels('<script>var ytInitialData = {"contents": ;</script>')).toBeUndefined();
    expect(parseSubscribedChannels(page([channel('UCdddddddddddddddddddddd', 'Not Subscribed', '/@notsub', false)]))).toBeUndefined();
  });
});

describe('subscribedMatcher', () => {
  const isSubscribed = subscribedMatcher({ ids: ['UCaaaaaaaaaaaaaaaaaaaaaa'], handles: ['codebites'], keys: ['code bites', 'old channel'] });

  it('matches a Tile by its channel id, handle or name, any one being enough', () => {
    expect(isSubscribed(tile({ channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa' }))).toBe(true);
    expect(isSubscribed(tile({ channelHandle: '@CodeBites', channelName: 'Renamed' }))).toBe(true);
    expect(isSubscribed(tile({ channelName: ' Old  Channel ' }))).toBe(true);
    expect(isSubscribed(tile({ channelName: 'Someone Else', channelHandle: '@someone' }))).toBe(false);
  });

  it('never matches a Tile that shows no channel', () => {
    expect(isSubscribed(tile({ surface: 'shortsShelf', isShort: true }))).toBe(false);
  });

  it('never matches a Bilibili Tile, even from a channel with a subscribed name', () => {
    expect(isSubscribed(tile({ videoId: 'BV1FIXTURE01', surface: 'bilibiliHome', channelName: 'Code Bites', channelId: '10000001' }))).toBe(false);
  });
});
