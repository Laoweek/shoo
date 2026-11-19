// Toolbar icons: rasterizes the "two eyes" logo for every eye state into public/icon/.
// The geometry mirrors src/ui/eyes/EyesSvg.tsx and src/ui/eyes.css (docs/spec/ui-design.md Section 3).
// 32, 48 and 128 px scale the 52x26 viewBox with the `.eyes.icon` ring stroke. 16 px uses a hand-tuned pixel grid
// (TINY below).
// Each <state>-<size>.png (ink eyes, light toolbars) has a <state>-<size>-dark.png twin (paper eyes, dark toolbars).
// Run by hand with `node scripts/make-icons.mjs [--sheet <path.png>]`. Output is deterministic.
// --sheet also writes a contact sheet: one row per state, each size as ink on light, Chrome-dark and ink
// tiles, then as paper on Chrome-dark and ink tiles, then the 16 px icon magnified 8x (nearest neighbour)
// as ink on light and paper on ink.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const INK = [0x12, 0x12, 0x14];
const PAPER = [0xfb, 0xfb, 0xfa];
const VARIANTS = { '': INK, '-dark': PAPER }; // filename suffix -> eye colour
const SIZES = [16, 32, 48, 128];
const STATES = ['watching', 'judging', 'review', 'paused', 'error'];
const DEFAULT_STATE = 'watching';
const SAMPLES = 16; // supersampling grid per pixel axis

// Eye state variables, named after the CSS custom properties on .eyes[data-state]. The values come from the
// original logo design, so a few differ slightly from src/ui/eyes.css. lb is negative (moves up).
const STATE_VARS = {
  watching: { px: 0, py: 0.15, ps: 1, lt: 0, lb: 0, rs: 1 },
  judging: { px: 0.85, py: 0.3, ps: 1, lt: 0, lb: 0, rs: 1 },
  review: { px: 0, py: 0.35, ps: 1, lt: 10.4, lb: 0, rs: 1 },
  paused: { px: 0, py: 0.15, ps: 1, lt: 13, lb: -13, rs: 1 },
  error: { px: 0, py: 0, ps: 0.58, lt: 0, lb: 0, rs: 1.1 },
};
const VIEW_W = 56; // 52 viewBox units plus a margin so the error rings (outer edge 52.4 units wide) fit

// One eye, in pixels, relative to its centre: ring centreline radius and width, clip radius,
// pupil offset and radius, lid edges (y offsets, lid region is above top / below bottom) and lid line width.
function scaledEye(state, k) {
  const m = STATE_VARS[state];
  return {
    ringR: 9.6 * m.rs * k, ringW: 4.8 * m.rs * k, clipR: 7.9 * k,
    pupilX: m.px * 3.3 * k, pupilY: m.py * 3.3 * k, pupilR: 4.3 * m.ps * k,
    lidTop: (m.lt - 13) * k, lidBot: (13 + m.lb) * k, lidW: 2.4 * k,
  };
}

// 16 px grid. Normal eyes: 7 px outer diameter centred on pixel centres (3.5 and 12.5, row 7.5),
// 1 px ring, 5 px clip, 3 px pupil, 2 px gap between eyes. Error eyes: 8 px on pixel corners (4 and 12, row 8),
// 2 px pupil. Lid lines are 1 px rows. Coverage at 16 px is contrast-hinted (HINT) so edges snap to whole pixels.
const OPEN = { lidTop: -9, lidBot: 9, lidW: 1 };
const TINY_NORMAL = { centres: [[3.5, 7.5], [12.5, 7.5]], ringR: 3, ringW: 1, clipR: 2.5, pupilX: 0, pupilY: 0, pupilR: 1.5, ...OPEN };
const TINY = {
  watching: TINY_NORMAL,
  judging: { ...TINY_NORMAL, pupilX: 1 },
  review: { ...TINY_NORMAL, lidTop: -1 },
  paused: { ...TINY_NORMAL, lidTop: 0, lidBot: 0 },
  error: { ...TINY_NORMAL, centres: [[4, 8], [12, 8]], ringR: 3.5, clipR: 3, pupilR: 1 },
};

// Coverage 0.3 or less drops out, 0.7 or more is solid, linear in between.
const HINT = (a) => Math.min(1, Math.max(0, (a - 0.3) / 0.4));

function geometry(state, size) {
  if (size === 16) return TINY[state];
  const k = size / VIEW_W;
  const left = size / 2 - 26 * k;
  return { centres: [[left + 13 * k, size / 2], [left + 39 * k, size / 2]], ...scaledEye(state, k) };
}

function inked(g, x, y) {
  for (const [cx, cy] of g.centres) {
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
    if (Math.abs(d - g.ringR) <= g.ringW / 2) return true;
    if (d > g.clipR) continue;
    if (Math.abs(dy - g.lidTop) <= g.lidW / 2 || Math.abs(dy - g.lidBot) <= g.lidW / 2) return true;
    if (dy < g.lidTop || dy > g.lidBot) continue;
    if (Math.hypot(dx - g.pupilX, dy - g.pupilY) <= g.pupilR) return true;
  }
  return false;
}

// RGBA pixels, eye colour everywhere, alpha = supersampled coverage.
function render(state, size, colour) {
  const g = geometry(state, size);
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          if (inked(g, x + (sx + 0.5) / SAMPLES, y + (sy + 0.5) / SAMPLES)) hits++;
        }
      }
      const i = (y * size + x) * 4;
      px.set(colour, i);
      const a = hits / (SAMPLES * SAMPLES);
      px[i + 3] = Math.round(255 * (size === 16 ? HINT(a) : a));
    }
  }
  return px;
}

// PNG encoding: signature, IHDR, IDAT (filter 0 per row), IEND.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit, RGBA, deflate, adaptive filtering, no interlace
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Contact sheet: opaque RGB canvas with icons alpha-blended onto coloured tiles.
function writeSheet(path, icons) {
  const PAD = 8, GAP = 4;
  const CHROME_DARK = [0x35, 0x36, 0x3a];
  const ZOOM = 8;
  const cells = [];
  for (const size of SIZES) {
    for (const bg of [PAPER, CHROME_DARK, INK]) cells.push({ size, bg, variant: '', zoom: 1 });
    for (const bg of [CHROME_DARK, INK]) cells.push({ size, bg, variant: '-dark', zoom: 1 });
  }
  cells.push({ size: 16, bg: PAPER, variant: '', zoom: ZOOM }, { size: 16, bg: INK, variant: '-dark', zoom: ZOOM });
  const rowH = 16 * ZOOM + 2 * PAD;
  const width = cells.reduce((w, c) => w + c.size * c.zoom + 2 * PAD + GAP, GAP);
  const height = STATES.length * (rowH + GAP) + GAP;
  const out = new Uint8Array(width * height * 4).fill(0xc8);
  STATES.forEach((state, r) => {
    let x0 = GAP;
    const y0 = GAP + r * (rowH + GAP);
    for (const { size, bg, variant, zoom } of cells) {
      const tile = size * zoom + 2 * PAD;
      const top = y0 + (rowH - tile) / 2;
      const icon = icons[state][size + variant];
      for (let y = 0; y < tile; y++) {
        for (let x = 0; x < tile; x++) {
          const ix = Math.floor((x - PAD) / zoom), iy = Math.floor((y - PAD) / zoom);
          const inside = ix >= 0 && iy >= 0 && ix < size && iy < size;
          const p = (iy * size + ix) * 4;
          const a = inside ? icon[p + 3] / 255 : 0;
          const o = ((top + y) * width + x0 + x) * 4;
          for (let ch = 0; ch < 3; ch++) out[o + ch] = Math.round(bg[ch] * (1 - a) + (inside ? icon[p + ch] : 0) * a);
          out[o + 3] = 255;
        }
      }
      x0 += tile + GAP;
    }
  });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePng(width, height, out));
  return path;
}

const outDir = join(import.meta.dirname, '..', 'public', 'icon');
mkdirSync(outDir, { recursive: true });
const written = [];
const icons = {};
for (const state of STATES) {
  icons[state] = {};
  for (const size of SIZES) {
    for (const [suffix, colour] of Object.entries(VARIANTS)) {
      const rgba = render(state, size, colour);
      icons[state][size + suffix] = rgba;
      const png = encodePng(size, size, rgba);
      const names = [`${state}-${size}${suffix}.png`, ...(state === DEFAULT_STATE && !suffix ? [`${size}.png`] : [])];
      for (const name of names) {
        writeFileSync(join(outDir, name), png);
        written.push(join('public', 'icon', name));
      }
    }
  }
}
const sheetFlag = process.argv.indexOf('--sheet');
if (sheetFlag !== -1) {
  const target = process.argv[sheetFlag + 1];
  if (!target) throw new Error('--sheet needs a path');
  written.push(writeSheet(resolve(target), icons));
}
console.log(written.join('\n'));
