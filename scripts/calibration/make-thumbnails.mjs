// Renders the synthetic thumbnail set for the Thumbnail rule experiment (rule set D) into
// test/calibration/thumbnails/<id>.jpg and writes test/calibration/thumbnails.json.
//   node scripts/calibration/make-thumbnails.mjs
// Needs Google Chrome (headless screenshot) and macOS `sips` (PNG to JPEG). Set CHROME to another binary.
// Labels are by construction: each design states which Thumbnail rules it shows. No network.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DATA_DIR } from './lib.mjs';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = resolve(DATA_DIR, 'thumbnails');

// Building blocks, 320x180 like YouTube's mqdefault.
const emoji = (c, size, x, y) => `<div style="position:absolute;left:${x}px;top:${y}px;font-size:${size}px;line-height:1">${c}</div>`;
const caption = (text, size = 54, y = 60, color = '#fff') =>
  `<div style="position:absolute;left:0;right:0;top:${y}px;text-align:center;font:900 ${size}px/1 Impact,'Arial Black',sans-serif;color:${color};-webkit-text-stroke:3px #000;text-transform:uppercase">${text}</div>`;
const small = (text, x, y, size = 11, color = '#ddd') => `<div style="position:absolute;left:${x}px;top:${y}px;font:500 ${size}px/1.2 system-ui,sans-serif;color:${color}">${text}</div>`;
const arrow = (x, y, rot, color = '#e00') =>
  `<svg style="position:absolute;left:${x}px;top:${y}px;transform:rotate(${rot}deg)" width="90" height="40" viewBox="0 0 90 40"><path d="M0 14h60V2l30 18-30 18V26H0z" fill="${color}" stroke="#fff" stroke-width="2"/></svg>`;
const ring = (x, y, d, color = '#e00') => `<div style="position:absolute;left:${x}px;top:${y}px;width:${d}px;height:${d}px;border:5px solid ${color};border-radius:50%"></div>`;
const box = (x, y, w, h, bg, extra = '') => `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:${bg};${extra}"></div>`;

// [id, title, channel, background, parts, rules shown, design note]
const DESIGNS = [
  ['th01', 'We found a hidden room in our new house', 'Fix It Fam', '#3b3b4f', [emoji('😱', 110, 20, 35), emoji('🚪', 80, 200, 50)], ['T1'], 'shocked face emoji next to a door'],
  ['th02', 'Diamond hunting at the state park', 'Rock Hounds', 'linear-gradient(#7a5,#463)', [emoji('🤯', 100, 15, 40), arrow(130, 75, 0), emoji('💎', 60, 235, 60)], ['T1'], 'mind-blown face and red arrow to a gem'],
  ['th03', 'Thrift store haul: vintage watches', 'Frugal Fran', '#c9b28f', [box(40, 110, 240, 20, '#8a6b45'), emoji('⌚', 34, 170, 80), ring(155, 64, 66), arrow(40, 30, 35)], ['T1'], 'red circle around a watch, red arrow'],
  ['th04', 'Hiking the canyon trail', 'Trail Days', 'linear-gradient(#9c6,#5a3)', [emoji('🌿', 50, 30, 100), emoji('🐍', 40, 210, 115), arrow(120, 90, 15)], ['T1'], 'red arrow pointing at a snake in grass'],
  ['th05', 'Opening my exam results', 'Study Saathi', '#223', [emoji('😨', 120, 100, 30), small('?!', 250, 40, 40, '#fff')], ['T1'], 'fearful face emoji'],
  ['th06', 'Leaving my job after ten years', 'Dev Life Vlogs', '#a22', [emoji('😱', 90, 10, 80), caption('I QUIT', 72, 18)], ['T1', 'T3'], 'shocked face and huge caption'],
  ['th07', 'Three habits for better sleep', 'Mind Matters', '#2e4a62', [emoji('🧑', 90, 115, 10), emoji('🫵', 70, 125, 100)], ['T2'], 'person emoji with a hand pointing at the viewer'],
  ['th08', 'Desk upgrades under fifty dollars', 'Desk Setup Lab', '#222', [emoji('🫵', 90, 20, 70), caption('YOU NEED THIS', 44, 25, '#ff0')], ['T2', 'T3'], 'hand pointing at the viewer and huge caption'],
  ['th09', 'Reading your comments', 'Danny & Lou', '#434', [emoji('😱', 90, 30, 20), emoji('🫵', 80, 190, 80)], ['T1', 'T2'], 'shocked face and hand pointing at the viewer'],
  ['th10', 'Quarterly sales review', 'Business Explained', '#f4f4f4', [emoji('🧑‍🏫', 80, 20, 60), emoji('👉', 50, 105, 80), box(190, 70, 25, 80, '#47a'), box(225, 50, 25, 100, '#47a'), box(260, 30, 25, 120, '#47a')], [], 'teacher pointing sideways at a chart, not at the viewer'],
  ['th11', 'Phone accessories review', 'Gadget Unbox', '#111', [emoji('📱', 70, 125, 95), caption('STOP BUYING THIS', 40, 25, '#f33')], ['T3'], 'huge caption over a phone'],
  ['th12', 'Productivity tips', 'Better Every Day', '#f7d200', [caption('10 TIPS<br>NOBODY<br>TELLS YOU', 44, 12, '#111')], ['T3'], 'three lines of huge text'],
  ['th13', 'My first year freelancing', 'Nomad Nina', '#0a5', [caption('$0 → $10K', 64, 55)], ['T3'], 'huge money caption'],
  ['th14', 'Trying convenience store food', '料理研究家ゆかり', '#fff', [caption('衝撃の結果', 58, 55, '#e00')], ['T3'], 'huge Japanese caption'],
  ['th15', 'Learning guitar every day', 'Guitar Garage', '#334', [emoji('🎸', 70, 125, 95), caption('DAY 1 vs DAY 100', 40, 25)], ['T3'], 'huge before/after caption'],
  ['th16', 'Why the sky is blue', 'Physics Unpacked', '#16a', [caption('WHY?', 110, 30)], ['T3'], 'one huge word'],
  ['th17', 'A quiet week in the mountains', 'Slow Travel Diaries', 'linear-gradient(#8cf,#fde)', [emoji('🏔️', 110, 40, 50), emoji('🌲', 60, 200, 100)], [], 'landscape'],
  ['th18', 'Ramen from scratch', 'Noodle Nerd', '#8a5a2b', [emoji('🍜', 110, 105, 30)], [], 'bowl of ramen on wood'],
  ['th19', 'TypeScript generics explained', 'Code Bites', '#1e1e1e', [emoji('💻', 60, 20, 60), ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => small(`const x${i} = map&lt;T&gt;(items, fn);`, 100, 20 + i * 18, 11, '#9cdcfe'))], [], 'laptop next to small code text (text, but not huge)'],
  ['th20', 'Fingerstyle guitar lesson', 'Guitar Garage', '#553', [emoji('🎸', 110, 100, 30), small('Part 2', 270, 160, 12, '#fff')], [], 'guitar with a small corner label'],
  ['th21', 'How DNS works', 'Code Bites', '#fafafa', [box(30, 70, 70, 40, '#cde', 'border:2px solid #357'), box(220, 70, 70, 40, '#cde', 'border:2px solid #357'), arrow(115, 70, 0, '#27c')], [], 'diagram with a blue arrow between boxes'],
  ['th22', 'Sunflower garden tour', 'Balcony Garden', '#9cd', [emoji('🙂', 90, 30, 45), emoji('🌻', 90, 180, 45)], [], 'calm smiling face and a flower'],
  ['th23', 'Champions League highlights', 'Football Highlights Hub', '#2a7a2a', [box(0, 85, 320, 3, '#fff'), emoji('⚽', 60, 130, 60)], [], 'football on a pitch'],
  ['th24', 'Electric car road trip', 'EV Roads', 'linear-gradient(#acd,#777 60%)', [emoji('🚗', 90, 110, 70)], [], 'car on a road'],
  ['th25', 'Is crime actually rising?', 'Data Desk', '#fff', [...[40, 80, 60, 110, 90].map((h, i) => box(40 + i * 50, 160 - h, 30, h, '#e85')), small('2021  2022  2023  2024  2025', 42, 164, 10, '#444')], [], 'bar chart with small axis labels'],
  ['th26', 'Sleepy cat compilation', 'Paws Doc', '#fbe', [emoji('🐱', 100, 60, 40), emoji('😴', 60, 200, 30)], [], 'sleeping cat'],
  ['th27', 'Stand-up special', 'Comedy Hour Archive', '#402', [emoji('😂', 100, 40, 40), emoji('🎤', 70, 200, 60)], [], 'laughing face, not shocked'],
  ['th28', 'Book club: chapter three', 'Book Club Lens', '#e9e1d0', [emoji('📚', 90, 110, 25), small('Chapter 3', 128, 140, 14, '#333')], [], 'books with a small label'],
  ['th29', 'Yoga for back pain', 'Calm Yoga', 'linear-gradient(#fed,#cde)', [emoji('🧘', 100, 110, 40)], [], 'person meditating'],
  ['th30', 'Indie game spotlight', 'Indie Radar', 'linear-gradient(90deg,#306,#09c)', [emoji('🎮', 100, 110, 40)], [], 'game controller'],
  ['th31', 'This changed my morning routine', 'Better Every Day', '#e33', [emoji('😱', 80, 15, 60), ring(170, 50, 90), emoji('☕', 50, 190, 70), caption('WAIT', 60, 4)], ['T1', 'T3'], 'shocked face, red circle around a cup, big caption'],
  ['th32', 'Pointing out the best seats', 'Slow Travel Diaries', '#5a7', [emoji('🧑', 70, 30, 50), emoji('👈', 50, 110, 70), emoji('🏟️', 80, 200, 50)], [], 'person pointing sideways, not at the viewer'],
];

// Designs a careful labeller could read either way: excluded from headline metrics.
const AMBIGUOUS = new Set(['th19']);

mkdirSync(OUT, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'shoo-thumbs-'));
try {
  for (const [id, , , bg, parts] of DESIGNS) {
    const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;width:320px;height:180px;overflow:hidden;position:relative;background:${bg};font-family:system-ui">${parts.join('')}</body>`;
    const htmlPath = join(work, `${id}.html`);
    const pngPath = join(work, `${id}.png`);
    writeFileSync(htmlPath, html);
    execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--user-data-dir=${join(work, 'profile')}`, '--window-size=320,180', `--screenshot=${pngPath}`, `file://${htmlPath}`], { stdio: 'ignore' });
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80', pngPath, '--out', join(OUT, `${id}.jpg`)], { stdio: 'ignore' });
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

const items = DESIGNS.map(([id, title, channel, , , refs, design]) => ({ id, title, channel, file: `${id}.jpg`, remove: refs[0] ?? null, removeAll: refs, ambiguous: AMBIGUOUS.has(id), design }));
writeFileSync(
  resolve(DATA_DIR, 'thumbnails.json'),
  `[\n${items.map((x) => '  ' + JSON.stringify(x)).join(',\n')}\n]\n`,
);
console.log(`${items.length} thumbnails in ${OUT}: ${items.filter((x) => x.remove).length} match a Thumbnail rule, ${items.filter((x) => !x.remove).length} match none`);
