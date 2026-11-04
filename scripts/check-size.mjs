// Bundle budget and boundary check (docs/spec/architecture.md Section 12, ADR 0006, REQ-MODEL-6).
// Fails when a gzipped bundle exceeds its budget, when a manifest declares web_accessible_resources,
// or when the content-script bundle mentions the API key's storage item.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname, normalize } from 'node:path';

const KB = 1024;
const BUDGETS = { content: 37 * KB, background: 44.5 * KB, page: 60 * KB };
const FORBIDDEN_IN_CONTENT = ['secret:', 'openrouterKey', 'customKey'];

const gz = (path) => gzipSync(readFileSync(path), { level: 9 }).length;
const fmt = (n) => `${(n / KB).toFixed(1)} KB`;

// Collect a JS file plus every chunk it statically imports.
function closure(outDir, file, seen = new Set()) {
  const abs = normalize(join(outDir, file));
  if (seen.has(abs) || !existsSync(abs)) return seen;
  seen.add(abs);
  const src = readFileSync(abs, 'utf8');
  for (const m of src.matchAll(/(?:import|from)\s*["']([^"']+\.js)["']/g)) {
    const spec = m[1];
    const next = spec.startsWith('/') ? spec.slice(1) : join(dirname(file), spec);
    closure(outDir, next, seen);
  }
  return seen;
}

let failed = false;
const report = (label, size, budget) => {
  const ok = size <= budget;
  if (!ok) failed = true;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(36)} ${fmt(size).padStart(9)} / ${fmt(budget)}`);
};

for (const target of ['chrome-mv3', 'firefox-mv3']) {
  const outDir = join('.output', target);
  if (!existsSync(outDir)) {
    console.log(`FAIL ${target}: not built`);
    failed = true;
    continue;
  }
  const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
  if (manifest.web_accessible_resources) {
    console.log(`FAIL ${target}: manifest declares web_accessible_resources (ADR 0006)`);
    failed = true;
  }

  const csDir = join(outDir, 'content-scripts');
  for (const f of readdirSync(csDir).filter((f) => f.endsWith('.js'))) {
    const path = join(csDir, f);
    report(`${target} content-scripts/${f}`, gz(path), BUDGETS.content);
    const text = readFileSync(path, 'utf8');
    for (const needle of FORBIDDEN_IN_CONTENT) {
      if (text.includes(needle)) {
        console.log(`FAIL ${target}: content bundle contains "${needle}" (key isolation, REQ-MODEL-6)`);
        failed = true;
      }
    }
  }

  report(`${target} background.js`, [...closure(outDir, 'background.js')].reduce((s, p) => s + gz(p), 0), BUDGETS.background);

  for (const page of ['popup', 'options', 'onboarding']) {
    const html = join(outDir, `${page}.html`);
    if (!existsSync(html)) continue;
    const scripts = [...readFileSync(html, 'utf8').matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1].replace(/^\//, ''));
    const files = new Set();
    for (const s of scripts) closure(outDir, s, files);
    report(`${target} ${page} JS`, [...files].reduce((s, p) => s + gz(p), 0), BUDGETS.page);
  }
}

if (failed) {
  console.error('\nSize or boundary check failed.');
  process.exit(1);
}
