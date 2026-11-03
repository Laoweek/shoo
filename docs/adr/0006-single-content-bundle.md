# One content-script bundle, no web-accessible resources, system fonts on YouTube

The first architecture draft loaded the in-page Preact UI as a lazy chunk with `import('./ui')` to keep a 15 KB bootstrap. WXT bundles content scripts as IIFE without code splitting, so that import cannot work as written. The workaround (an unlisted ESM entry loaded through `web_accessible_resources` and `runtime.getURL`) adds per-browser manifest plumbing and makes Shoo detectable by any page that probes for its resources. Bundled fonts in the page have the same problem, because `@font-face` inside a shadow root is ignored and `FontFace` needs a web-accessible URL. Shoo therefore ships one content bundle with Preact included, at ≤ 35 KB gzipped, initializes UI code only on first need, and renders in-page UI with the system font stack and the SVG wordmark. Geist and Bricolage Grotesque ship only on extension pages.

**Considered options**: the ESM entry plus `web_accessible_resources` with `use_dynamic_url` (smaller initial parse, but detectable and more moving parts), and fonts as base64 `data:` URLs in the bundle (no WAR, but about 25 KB per face on every YouTube page).

**Consequences**: the size check enforces the 35 KB budget. Revisit if the in-page UI grows past it or if WXT gains content-script code splitting.
