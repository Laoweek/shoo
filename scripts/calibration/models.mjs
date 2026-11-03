// Lists OpenRouter's decision models with each endpoint's provider tag, input modalities and prompt price,
// from the public catalogue (no key, no cost). Use the tags for run.mjs --provider when a model has several.
//   node scripts/calibration/models.mjs [--json]
import { TIMEOUT_MS } from './lib.mjs';

const get = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
};

const models = (await get('https://openrouter.ai/api/v1/models?output_modalities=decisions')).data ?? [];
const rows = [];
for (const m of models) {
  const eps = (await get(`https://openrouter.ai/api/v1/models/${m.id}/endpoints`)).data?.endpoints ?? [];
  for (const e of eps) {
    rows.push({ model: m.id, tag: e.tag, provider: e.provider_name, image: (m.architecture?.input_modalities ?? []).includes('image'), pricePerMTokens: +(Number(e.pricing?.prompt) * 1e6).toFixed(4) });
  }
}
if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
else {
  console.log('| model | provider tag | provider | image | $ per M input tokens |\n|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.model} | ${r.tag} | ${r.provider} | ${r.image ? 'yes' : 'no'} | ${r.pricePerMTokens} |`);
}
