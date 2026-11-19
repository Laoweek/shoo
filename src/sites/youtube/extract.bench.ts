// @vitest-environment jsdom
/// <reference types="node" />
// Extraction benchmark over the composed Home page ×50 (architecture.md Section 12 extraction budget).
// `pnpm bench` prints Vitest's bench table, then compares against extract.bench.baseline.json and fails on a
// regression above 20%. Absolute times differ between machines, so the stored number is a ratio: extraction time
// divided by a calibration workload of plain DOM queries over the same Tiles, both measured in the same run
// (median latencies from Vitest's bench.compare). No baseline file, or SHOO_BENCH_UPDATE=1: the baseline is (re)written.
// Absolute per-Tile timings are measured by hand in a real browser, with the hardware recorded.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { SurfaceId } from '~/core/types';
import { channelBadgePending, extract } from './extract';
import { SURFACES, visiblePage } from './surfaces';
import { FIXTURES, loadPage } from './test-harness';

const REPEAT = 50;
const MAX_REGRESSION = 0.2;
// Vitest runs from the project root. (import.meta.url is not a file URL under the jsdom environment.)
const BASELINE = join(process.cwd(), 'src/sites/youtube/extract.bench.baseline.json');

loadPage(FIXTURES.pageHome, '/');
const page = visiblePage(document) as Element;
const tiles: Array<[Element, SurfaceId]> = (['home', 'shortsShelf'] as const).flatMap((id) =>
  SURFACES[id].containers(page).flatMap((c) => SURFACES[id].tiles(c).map((t) => [t, id] as [Element, SurfaceId])),
);

let sink = 0;
// The watcher's first read of a Tile: extract(), then the badge check for a Tile without the Artist channel flag.
function extraction(): void {
  for (let i = 0; i < REPEAT; i++) {
    for (const [t, s] of tiles) {
      const facts = extract(t, s, document);
      sink += facts?.title.length ?? 0;
      if (facts && !facts.isArtistChannel && channelBadgePending(t, s)) sink += 1;
    }
  }
}
// Same Tiles, same number of passes, a fixed mix of generic DOM reads that never changes with Shoo's code.
function calibration(): void {
  for (let i = 0; i < REPEAT; i++) {
    for (const [t] of tiles) {
      sink += t.querySelectorAll('span').length;
      sink += t.querySelector('a[href]')?.getAttribute('href')?.length ?? 0;
      sink += t.querySelector('h3')?.textContent?.length ?? 0;
      sink += t.querySelector('[aria-label]') ? 1 : 0;
    }
  }
}

type Stats = { latency: { p50: number } };
type Compared = { get(name: string): Stats | undefined };

describe(`extract() over the composed Home page ×${REPEAT}`, () => {
  test(`${tiles.length} Tiles, compared with the stored baseline`, async ({ bench }) => {
    const once = async () => {
      const result = (await bench.compare(bench('extract', extraction), bench('calibration (plain DOM queries)', calibration))) as unknown as Compared;
      const extractMs = result.get('extract')?.latency.p50 ?? NaN;
      const calibrationMs = result.get('calibration (plain DOM queries)')?.latency.p50 ?? NaN;
      return { ratio: extractMs / calibrationMs, extractMs, calibrationMs };
    };
    let run = await once();
    expect(Number.isFinite(run.ratio)).toBe(true);
    const stored = existsSync(BASELINE) ? (JSON.parse(readFileSync(BASELINE, 'utf8')) as { ratio: number }) : null;
    if (!stored || process.env.SHOO_BENCH_UPDATE === '1') {
      const out = {
        ratio: Number(run.ratio.toFixed(4)),
        extractMedianMs: Number(run.extractMs.toFixed(3)),
        calibrationMedianMs: Number(run.calibrationMs.toFixed(3)),
        tiles: tiles.length,
        repeat: REPEAT,
        recordedAt: new Date().toISOString().slice(0, 10),
        node: process.version,
        note: 'ratio = median extraction latency / median calibration latency, same run. Only ratio is compared.',
      };
      writeFileSync(BASELINE, `${JSON.stringify(out, null, 2)}\n`);
      console.log(`extract bench: baseline written, ratio ${out.ratio}`);
      return;
    }
    const limit = stored.ratio * (1 + MAX_REGRESSION);
    // Noise only adds time, so a second measurement's lower ratio is the better estimate.
    if (run.ratio > limit) {
      const again = await once();
      if (again.ratio < run.ratio) run = again;
    }
    const change = ((run.ratio / stored.ratio - 1) * 100).toFixed(1);
    console.log(`extract bench: ratio ${run.ratio.toFixed(4)} vs baseline ${stored.ratio} (${change}%), extract median ${run.extractMs.toFixed(2)} ms (sink ${sink > 0})`);
    expect(run.ratio, `extraction regressed ${change}% against the stored baseline`).toBeLessThanOrEqual(limit);
  });
});
