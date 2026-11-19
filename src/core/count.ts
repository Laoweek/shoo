// View counts in English, as YouTube shows them and as users type them in a views Rule. Source of truth:
// docs/spec/requirements.md "Exact rule semantics" and docs/spec/youtube-integration.md Section 3.

const SCALES: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9, billion: 1e9 };
const COUNT = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*([a-z]+)?$/i;

/**
 * `1,234` → 1234, `116 thousand` → 116000, `1.1m` and `1.1M` → 1100000, `2b` → 2000000000. Undefined for anything
 * else, including other languages' separators and scale words (`1,1 Mio.`, `1.2 lakh`).
 */
export function parseCount(text: string): number | undefined {
  const m = COUNT.exec(text.trim());
  if (!m) return undefined;
  const scale = m[3] === undefined ? 1 : SCALES[m[3].toLowerCase()];
  if (scale === undefined) return undefined;
  return Math.round(Number(`${m[1]!.replace(/,/g, '')}.${m[2] ?? '0'}`) * scale);
}

/** 10000 → `10k`, 1500000 → `1.5m`, 1234 → `1,234`: the short form when one decimal is exact, else every digit. */
export function formatCount(n: number): string {
  for (const [scale, suffix] of [
    [1e9, 'b'],
    [1e6, 'm'],
    [1e3, 'k'],
  ] as const) {
    const tenths = (n * 10) / scale;
    if (n >= scale && Number.isInteger(tenths)) return `${tenths / 10}${suffix}`;
  }
  return n.toLocaleString('en');
}
