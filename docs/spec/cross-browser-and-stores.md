# Cross-browser build and store spec

How to configure WXT, the manifest and releases so one codebase ships to Chrome 120+ and Firefox 140+ desktop (REQ-DIST-1 to REQ-DIST-3). Verify every manifest key against current MDN and Chrome docs when implementing, since store rules change. Items marked **Verify** must be checked against current documentation before release.

## 1. Manifest

### Decisions

| Item | Value | Why |
|---|---|---|
| Manifest version | MV3 for both browsers | WXT builds MV2 for Firefox by default, so always pass `--mv3` for Firefox |
| `permissions` | `storage`, `alarms`, `identity` | storage for everything, alarms for Activity retention pruning, identity for Connect OpenRouter (REQ-MODEL-4) |
| `unlimitedStorage` | **no** | Activity has a byte budget and the Verdict cache is size-capped (`architecture.md`, storage budgets), so the 10 MB `storage.local` quota is enough. Fewer permissions, simpler review |
| `host_permissions` | `https://www.youtube.com/*`, `https://openrouter.ai/*`, `https://i.ytimg.com/*` | content script, Decisions API and OAuth key exchange, thumbnails for Thumbnail rules |
| `optional_host_permissions` | `https://*/*`, `http://localhost/*`, `http://127.0.0.1/*` | a Decision provider reached directly or on this computer (REQ-MODEL-7, onboarding step 2 or Settings) or a custom chat endpoint (REQ-MODEL-5, Settings only), requested for the single origin the user saves, never from the popup |
| `web_accessible_resources` | **none** | single content-script bundle with inline CSS and no fonts in the page (ADR 0006). WAR entries would make Shoo detectable by pages |
| Content script matches | `https://www.youtube.com/*` only | no `m.youtube.com`, no other sites (REQ-DIST-2) |
| Content script `runAt` | `document_idle` | YouTube is a single-page app, the watcher handles later navigation |
| Commands | `toggle-shoo`, suggested `Alt+Shift+S` | REQ-KEY-1, rebindable in both browsers. The handler is specified in `architecture.md` (messages contract) |
| Chrome minimum | `minimum_chrome_version: "120"` | REQ-DIST-2 |
| Chrome `version_name` | `<version> (<short commit>)`, with `-dirty` when built from uncommitted changes, left out without git | chrome://extensions shows it, so an installed build names its commit. Firefox gets none: AMO rebuilds from the sources zip, which has no `.git`, and the rebuilt files must match the upload |
| Firefox minimum | `strict_min_version: "140.0"` | built-in data consent and runtime `data_collection` requests (REQ-PRIV-3) |
| Firefox add-on ID | `shoo@shoo.extension` | required for MV3 signing, keeps the identity redirect URL stable. **Never change it after the first AMO upload** |
| Firefox data collection | `required: ["none"]`, `optional: ["websiteContent", "authenticationInfo"]` | consent is not a condition of install, so the "Exact rules only" path exists on Firefox (REQ-PRIV-2). See "Data collection and consent" below |

### `wxt.config.ts`

```ts
import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,
  modules: ['@wxt-dev/i18n/module'],
  vite: () => ({ plugins: [preact()] }),
  manifest: ({ browser }) => ({
    name: '__MSG_extName__',
    short_name: 'Shoo',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    permissions: ['storage', 'alarms', 'identity'],
    host_permissions: [
      'https://www.youtube.com/*',
      'https://openrouter.ai/*',
      'https://i.ytimg.com/*',
    ],
    optional_host_permissions: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
    action: { default_title: 'Shoo' },
    commands: {
      'toggle-shoo': {
        suggested_key: { default: 'Alt+Shift+S' },
        description: '__MSG_commandToggle__',
      },
    },
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'shoo@shoo.extension',
              strict_min_version: '140.0',
              // Verify key names and category ids against current MDN before release.
              data_collection_permissions: {
                required: ['none'],
                optional: ['websiteContent', 'authenticationInfo'],
              },
            },
          },
        }
      : { minimum_chrome_version: '120' }),
  }),
});
```

The content script declares its own options in `src/entrypoints/content/index.ts`. It is one bundle (WXT bundles content scripts as IIFE without code splitting, ADR 0006). Its CSS is imported as an inline string and injected into each shadow root, so nothing is fetched from an extension URL:

```ts
import uiCss from '~/ui/in-page.css?inline';

export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  runAt: 'document_idle',
  cssInjectionMode: 'manual', // WXT's 'ui' mode may load CSS from an extension URL, which would need WAR
  main(ctx) { /* bootstrap, see docs/spec/architecture.md. Pass uiCss to the shadow-root UI. */ },
});
```

The shadow-root UI renders with this inline CSS in both browsers (chips from the built extension checked on youtube.com in Chrome 155 and Firefox 158), and `pnpm size` fails when either built manifest declares `web_accessible_resources`.

### Data collection and consent

What Shoo sends is defined once, in REQ-PRIV-1 (`docs/spec/requirements.md`). The store texts below repeat it and must be updated in the same change whenever REQ-PRIV-1 changes. In short: per video, the title, channel name, length and Surface, plus the thumbnail only with Thumbnail rules. Per request, the text of the enabled Topic rules, Thumbnail rules and Topic Keep rules and the titles and channel names of up to 10 Exceptions. Recipients: OpenRouter, then the model provider (Cloudflare by default, TypeSafe for the text fallback `typesafe/jev-1.13`, OpenAI for the image fallback `openai/gpt-6-luna-decisions`, or the provider of another model the user picks in Settings). Instead of OpenRouter, when the user chooses one: Cloudflare, TypeSafe or Perplexity directly, a Decision model on the user's computer, or the user's own endpoint. Never URLs, video IDs, watch history or cookies, so `browsingActivity` is not declared. If a later version sends video IDs or URLs, add `browsingActivity` and update the privacy policy and CWS form in the same change.

Category mapping:

| Data | Firefox category | Chrome Web Store category |
|---|---|---|
| Titles, channel names, lengths, Surface, thumbnails, Rule texts, kept titles | `websiteContent` | Website content |
| The user's OpenRouter key, the key of a directly reached Decision provider and the key of a custom endpoint (each stored on the device and sent only to its own service as the user's credential) | `authenticationInfo` | Authentication information |

Both stores declare both categories, so the two disclosures match (REQ-PRIV-3). **Verify** on current MDN whether Firefox expects `authenticationInfo` for a user-supplied key sent only to the user's own third-party account. If MDN says it does not apply, drop it from Firefox and from the CWS form together, never from one alone.

Runtime consent on Firefox: the onboarding `Agree and continue` click, and the `Give consent` button in Settings, call `browser.permissions.request({ data_collection: ['websiteContent', 'authenticationInfo'] })` as the first statement of the click handler (before any `await`), then record Shoo's own consent. If the user declines Firefox's prompt, Shoo stays on Exact rules only. The user can revoke the permission later in about:addons, so the background checks `permissions.contains({ data_collection: ['websiteContent'] })` on every snapshot (guarded by `import.meta.env.FIREFOX`) and treats a missing permission as `noConsent`. It also listens to `permissions.onRemoved`, so sending stops at once (`architecture.md` Section 7). **Verify** the exact `permissions.request` key for data collection on current MDN (Firefox 140+). Chrome has no equivalent API, so Chrome relies on Shoo's own consent screen.

## 2. API differences and how the code handles them

| Area | Chrome | Firefox | Shoo's rule |
|---|---|---|---|
| Background | service worker, no DOM, stops after 30 s idle | event page (`background.scripts`), has DOM, stops after 30 s idle | Treat background globals as a disposable cache. Batching timers live in the content script. Persist anything that must survive in `storage.*` |
| Long requests | a `fetch` with no response after 30 s can get the worker killed | event page suspension can also cut requests | Decisions requests use the timeout in `decision-engine.md` ("Network policy"), well under 30 s on every path |
| Content-script bundle | IIFE, no code splitting | same | One bundle with Preact and inline CSS, no `web_accessible_resources`, no fonts in the page (ADR 0006) |
| `storage.session` | content scripts need `setAccessLevel` | no `setAccessLevel` | Only the background reads and writes `storage.session` (private-window state, see below). Content asks the background via messages |
| `storage.local` | readable by content scripts | readable by content scripts | The API key accessors live in `src/store/secret.ts`, imported only by `src/engine/` and the background router. An import-boundary lint rule plus a test that greps the built content bundle for the key's storage name enforce it (REQ-MODEL-6) |
| `permissions.request` | needs a user gesture | needs a user gesture and must run before any `await` in the handler | Call `browser.permissions.request(...)` synchronously as the first statement of the click handler, then await its result. Never call `contains` first. Host requests for a direct Decision provider or a custom endpoint happen only on the `Use <provider>` (or `Use this chat model`) click in onboarding step 2 or Settings, never in the popup (Firefox closes the popup when the permission prompt opens). The pattern keeps the port on Chrome (`http://localhost:11434/*`) and drops it on Firefox (`http://localhost/*`): Firefox match patterns do not support ports, and a pattern with one matches no URL (MDN Match patterns, checked in Firefox 158 on 2026-10-10). `core/runtime.ts` `endpointPattern` builds it for both the page and the background |
| Revoked hosts | user can revoke | user can revoke any host at any time (Firefox 127+ grants MV3 hosts at install) | On startup and before each batch, the background checks `permissions.contains` for youtube.com and the model host: openrouter.ai, or the direct or custom endpoint's `endpointPattern` (with the port on Chrome, without it on Firefox), the exact pattern the page requested. If missing, the RuntimeState becomes `hostRevoked` (`architecture.md`) and the popup shows `Fix in Settings`, where a button calls `permissions.request`. `permissions.onAdded` and `onRemoved` listeners, registered at background start, recompute the snapshot at once |
| `identity.getRedirectURL()` | `https://<ext-id>.chromiumapp.org/` | `https://<sha1 of id>.extensions.allizom.org/` | Pass `getRedirectURL('openrouter')` as OpenRouter's `callback_url`. Start the flow from the background (the popup closes when focus moves). Firefox needs the fixed `gecko.id` |
| Messaging | `onMessage` promise returns unsupported through `wxt/browser` | same | Use `@webext-core/messaging` for every message in `src/messaging/protocol.ts` |
| Typings | `@types/chrome` | Firefox-only APIs are untyped | Guard Firefox-only code (for example `data_collection` requests) with `import.meta.env.FIREFOX` |
| Private windows | extension off by default | extension off by default, IndexedDB fails in "always private" mode | No IndexedDB anywhere. Nothing is written to `storage.local` or `storage.sync` for a tab where `sender.tab.incognito` is true (REQ-ACTV-3). Tab-scoped Exceptions and counters live in `storage.session` (memory only) so Undo, Keep and the daily cap still work within the session. **Verify** with AMO policy that memory-only `storage.session` use for private tabs is acceptable under "data from private browsing sessions must not be stored" |

## 3. Build, run, zip and sign

### Tooling pins

- `package.json`: `"packageManager": "pnpm@<exact version>"` and `"engines": { "node": ">=24" }`. Pin Node with an `.nvmrc` of `24` (fnm and nvm read it).
- Commit `pnpm-lock.yaml`. Never commit `.env.local` (the OpenRouter test key lives there).

### Scripts

```json
{
  "scripts": {
    "dev": "wxt",
    "dev:firefox": "wxt -b firefox --mv3",
    "build": "wxt build",
    "build:firefox": "wxt build -b firefox --mv3",
    "zip": "wxt zip",
    "zip:firefox": "wxt zip -b firefox --mv3",
    "compile": "tsc --noEmit",
    "test": "vitest run",
    "test:live": "vitest run --project live",
    "size": "node scripts/check-size.mjs",
    "check": "pnpm compile && pnpm test && pnpm build && pnpm build:firefox && pnpm size"
  }
}
```

- Output: `.output/chrome-mv3/` and `.output/firefox-mv3/`. `zip:firefox` also writes the sources zip.
- Both builds copy `LICENSE` and `THIRD_PARTY_NOTICES.md` into the package root (the `build:publicAssets` hook in `wxt.config.ts`), because the bundled Preact, Lucide paths and fonts must carry their notices.
- Configure `zip.includeSources` / `zip.excludeSources` so the sources zip holds `src/`, `public/`, `scripts/`, `wxt.config.ts`, `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `README-SOURCES.md`, `THIRD_PARTY_NOTICES.md`, `LICENSE`, `.nvmrc`, and excludes `.output/`, `node_modules/`, `.env*`, `.impeccable/`, `test/`, `docs/`, `coverage/` and test files.

### Loading unpacked builds

- Chrome: `chrome://extensions`, enable Developer mode, Load unpacked, pick `.output/chrome-mv3`. After a rebuild click the reload icon (cannot be done programmatically).
- Firefox: `about:debugging#/runtime/this-firefox`, Load Temporary Add-on, pick `.output/firefox-mv3/manifest.json`. Temporary add-ons vanish on restart.
- Prefer the production build for manual tests. The WXT dev background loses its modules if the dev server restarts.

### Reproducible AMO sources

`README-SOURCES.md` at the repo root (included in the sources zip) must say:

```
OS: Ubuntu 24.04 (any x64 or arm64), Node 24.x, pnpm <exact version> via corepack
corepack enable
pnpm install --frozen-lockfile
pnpm zip:firefox
Every file inside the produced extension zip matches the uploaded one (compare sha256 per extracted file).
No .env file is needed. Do not create one, it changes chunk hashes.
```

Before each upload, verify: unzip the sources zip into an empty directory, run the commands, unzip both extension zips, and compare the sha256 of every extracted file. Zip containers can differ in timestamps, so compare files, not the zip checksum.

### Signing an unlisted Firefox build (personal use)

Firefox release only installs signed add-ons. Signing uses the publisher's own AMO credentials:

1. `pnpm zip:firefox`.
2. AMO Developer Hub, Submit a New Add-on, "On your own" (unlisted), upload the extension zip and the sources zip.
3. Install the signed `.xpi` AMO returns.

`web-ext sign --channel=unlisted` with AMO API credentials is the scriptable alternative. Never store those credentials in the repo.

## 4. Store checklists

### Chrome Web Store

- **Single purpose**: "Shoo tells YouTube which recommendations you don't want, using YouTube's own Not interested and Don't recommend channel actions, based on rules you write."
- **Permission justifications**

| Permission | Justification |
|---|---|
| `storage` | Saves your Rules, settings, Activity and a cache of past Verdicts on your device, and syncs Rules across your browsers. |
| `alarms` | Deletes Activity older than 30 days. |
| `identity` | Lets you connect your OpenRouter account without pasting a key. |
| `https://www.youtube.com/*` | Reads video titles, channel names and lengths on YouTube and tells YouTube Not interested or Don't recommend channel through YouTube's own menu. |
| `https://openrouter.ai/*` | Sends the data listed in the privacy policy to the decision model you connected, and completes OpenRouter sign-in. |
| `https://i.ytimg.com/*` | Downloads a video's thumbnail only when you have a Thumbnail rule. |
| optional hosts | Only requested when you choose your own model endpoint (during setup or in Settings), and only for that address. |

- **Privacy practices form** (must match REQ-PRIV-1, the Firefox declaration and the privacy policy):
  - Data collected: **Website content** (video titles, channel names, lengths, the part of YouTube each video appeared on, thumbnails only with Thumbnail rules, the text of your Topic and Thumbnail rules and of Keep rules written as a sentence, and titles and channel names of up to 10 videos you kept) and **Authentication information** (the OpenRouter key, the key of a provider reached directly and the key of a custom endpoint, each stored on your device and sent only to its own service). The submitted wording is in `docs/release/chrome-web-store.md`.
  - Recipients: OpenRouter and the model provider it routes to (Cloudflare by default, TypeSafe for the text fallback, OpenAI for the thumbnail fallback, or the provider of another decision model the user picks in Settings), or instead, when the user chooses, Cloudflare, TypeSafe or Perplexity directly, a model on the user's computer, or the user's own endpoint.
  - Not collected: personally identifiable information, health, financial, personal communications, location, web history, user activity.
  - Certify: not sold to third parties, not used for unrelated purposes, not used for creditworthiness or lending.
  - **Limited Use**: certify compliance and publish this statement on the privacy policy page: "Shoo's use of information received from YouTube pages is limited to deciding which videos to tell YouTube you're not interested in. It is sent only to OpenRouter and the model provider you use, and is never used for advertising or sold."
- **In-extension disclosure and consent**: onboarding step 1 (REQ-PRIV-2, REQ-ONB-1) shows exactly what is sent and to whom before any request. Store screenshots should include that screen.
- **Privacy policy URL**: https://laoweek.github.io/shoo/release/privacy-policy.html, served by GitHub Pages from the `docs/` folder of `main` (`docs/.nojekyll` serves the files as they are). The listing and Settings, Connection link it.

### Firefox Add-ons (AMO)

- `data_collection_permissions` declared as in Section 1, with nothing required. Firefox shows its built-in consent when the user clicks `Agree and continue` in onboarding (runtime request). Shoo's own consent text is shown on the same screen (REQ-PRIV-2).
- Upload the sources zip and `README-SOURCES.md` (bundled and minified code).
- **Reviewer notes**: the submitted text is in `docs/release/amo.md`. Update it whenever `decision-engine.md` Section 10 changes.

### Listing copy (both stores)

- **Name**: `Shoo · Clear unwanted recommendations for YouTube` (49 characters, under AMO's 50 and CWS's 75, verify both limits at submission).
- **Summary** (under 132 characters): "Write what you don't want to see. Shoo tells YouTube \"Not interested\" for you, and shows which rule did it."
- **Description**: the current text is in the submission packs in `docs/release/`: `chrome-web-store.md`, Description, which `amo.md` reuses.
- **Branding rules**: never use "YouTube" or "YT" as part of the product name itself (only "for YouTube"). Do not use the YouTube logo or red play button in Shoo's icon or promo art. Screenshots of youtube.com may show YouTube's UI as it appears. Include the non-affiliation line.

## 5. Privacy policy

The published policy is `docs/release/privacy-policy.md`, served as `docs/release/privacy-policy.html` at the URL in Section 4. Keep the two files identical and change them together with `decision-engine.md` Section 10 (REQ-PRIV-1).
