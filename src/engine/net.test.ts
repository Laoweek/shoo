import { describe, expect, it } from 'vitest';
import { MAX_JSON_BYTES, readJson } from './net';

describe('readJson', () => {
  it('parses a JSON body and gives undefined for one that is not JSON', async () => {
    expect(await readJson(new Response('{"answers":{"t01":{"noul":0.2}}}'))).toEqual({ answers: { t01: { noul: 0.2 } } });
    expect(await readJson(new Response('<html>'))).toBeUndefined();
    expect(await readJson(new Response(null))).toBeUndefined();
  });

  it('stops reading a reply once it passes the size limit, so an endless body never fills memory', async () => {
    const chunk = new TextEncoder().encode(`"${'x'.repeat(64 * 1024)}",`);
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('['));
      },
      pull(controller) {
        pulled += chunk.byteLength;
        if (pulled > 64 * 1024 * 1024) controller.close();
        else controller.enqueue(chunk);
      },
    });
    expect(await readJson(new Response(endless))).toBeUndefined();
    expect(pulled).toBeLessThan(MAX_JSON_BYTES + 4 * chunk.byteLength);
  });
});
