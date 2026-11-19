import { describe, expect, it } from 'vitest';
import { parseVideoId, tryThumbnailUrl } from './video-url';

const ID = 'dQw4w9WgXcQ';

describe('Try a title URL parsing (decision-engine.md §7.5)', () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s`,
    `www.youtube.com/watch?list=PL1&v=${ID}`,
    `https://youtu.be/${ID}`,
    `youtu.be/${ID}?si=abc`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`,
    `https://i.ytimg.com/vi/${ID}/mqdefault.jpg?sqp=x`,
  ])('accepts %s', (url) => {
    expect(parseVideoId(url)).toBe(ID);
  });

  it.each([
    '',
    'not a url',
    `https://m.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/watch?v=short`,
    `https://www.youtube.com/watch?v=${ID}x`,
    `https://youtu.be/${ID}/extra`,
    `https://example.com/watch?v=${ID}`,
    `https://youtube.com.evil.test/watch?v=${ID}`,
    `https://i.ytimg.com/vi_webp/${ID}/hq.webp`,
    `https://i.ytimg.com/vi/${ID}`,
    `https://img.youtube.com/vi/${ID}/0.jpg`,
    `ftp://youtu.be/${ID}`,
    `javascript:alert(1)`,
    `https://user:pw@youtu.be/${ID}`,
    `https://www.youtube.com/shorts/${ID}/more`,
  ])('rejects %s', (url) => {
    expect(parseVideoId(url)).toBeNull();
  });

  it('builds only the i.ytimg.com mqdefault URL', () => {
    expect(tryThumbnailUrl(ID)).toBe(`https://i.ytimg.com/vi/${ID}/mqdefault.jpg`);
  });
});
