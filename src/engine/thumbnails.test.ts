import { describe, expect, it } from 'vitest';
import { scriptedFetch, type Scripted } from './testing';
import { fetchThumbnail, parseThumbnailInput, THUMBNAIL_MAX_BYTES, thumbnailUrl } from './thumbnails';

const ID = 'dQw4w9WgXcQ';
const URL = thumbnailUrl(ID)!;
const BV = 'BV1FIXTURE01';
const COVER = `/bfs/archive/${'0123456789abcdef'.repeat(2)}01234567.jpg`;

describe('fetchThumbnail', () => {
  it('fetches mqdefault without cookies and returns a base64 data URL', async () => {
    const { fetch, requests } = scriptedFetch({ [URL]: [{ status: 200, bytes: new Uint8Array([1, 2, 3]), headers: { 'content-type': 'image/jpeg' } }] });
    expect(await fetchThumbnail(fetch, { videoId: ID })).toBe('data:image/jpeg;base64,AQID');
    expect(requests[0]!.url).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg');
    expect(requests[0]!.init!.credentials).toBe('omit');
  });

  it('fetches a Bilibili cover at 320 x 180 from the path its page showed, without cookies or referrer', async () => {
    const url = `https://i0.hdslb.com${COVER}@320w_180h_1c.jpg`;
    const { fetch, requests } = scriptedFetch({ [url]: [{ status: 200, bytes: new Uint8Array([1, 2, 3]), headers: { 'content-type': 'image/jpeg' } }] });
    expect(await fetchThumbnail(fetch, { videoId: BV, cover: COVER })).toBe('data:image/jpeg;base64,AQID');
    expect(requests.map((r) => r.url)).toEqual([url]);
    expect(requests[0]!.init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' });
  });

  it('fetches nothing for a Bilibili video without an archive cover path', async () => {
    const none = scriptedFetch({});
    for (const cover of [undefined, '/bfs/face/abc.jpg', `${COVER}@672w_378h_1c`, 'https://evil.test/x.jpg', `/bfs/archive/../${COVER}`]) {
      expect(await fetchThumbnail(none.fetch, { videoId: BV, cover })).toBeUndefined();
    }
    expect(none.requests).toEqual([]);
  });

  it('accepts WebP and rejects other types, large images, errors and bad ids', async () => {
    const webp = scriptedFetch({ [URL]: [{ status: 200, bytes: new Uint8Array([9]), headers: { 'content-type': 'image/webp' } }] });
    expect(await fetchThumbnail(webp.fetch, { videoId: ID })).toBe('data:image/webp;base64,CQ==');
    const cases: Scripted[] = [
      { status: 200, bytes: new Uint8Array([1]), headers: { 'content-type': 'image/png' } },
      { status: 200, bytes: new Uint8Array(THUMBNAIL_MAX_BYTES), headers: { 'content-type': 'image/jpeg' } },
      { status: 200, bytes: new Uint8Array([1]), headers: { 'content-type': 'image/jpeg', 'content-length': '200000' } },
      { status: 404, bytes: new Uint8Array([1]), headers: { 'content-type': 'image/jpeg' } },
      { status: 0, throws: true },
    ];
    for (const c of cases) expect(await fetchThumbnail(scriptedFetch({ [URL]: [c] }).fetch, { videoId: ID })).toBeUndefined();
    const none = scriptedFetch({});
    expect(await fetchThumbnail(none.fetch, { videoId: '../../evil' })).toBeUndefined();
    expect(none.requests).toEqual([]);
  });

  it('gives up after the timeout', async () => {
    const hanging = ((_u: string, init?: RequestInit) =>
      new Promise((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch;
    expect(await fetchThumbnail(hanging, { videoId: ID }, 5)).toBeUndefined();
  });
});

describe('parseThumbnailInput', () => {
  it.each([
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/watch?v=dQw4w9WgXcQ&t=10',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    '  https://i.ytimg.com/vi_webp/dQw4w9WgXcQ/mqdefault.webp ',
  ])('accepts %s', (url) => expect(parseThumbnailInput(url)).toBe(ID));

  it.each([
    'https://example.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'https://img.youtube.com/vi/dQw4w9WgXcQ/0.jpg',
    'javascript:alert(1)',
    'dQw4w9WgXcQ',
    'https://youtu.be.evil.com/dQw4w9WgXcQ',
  ])('rejects %s', (url) => expect(parseThumbnailInput(url)).toBeUndefined());
});
