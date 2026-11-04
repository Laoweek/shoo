# Firefox Add-ons (AMO) submission pack

Listing copy, reviewer notes, data collection declaration, sources and signing steps, filled in from the built package (`.output/firefox-mv3/manifest.json`, version 0.2.0, built 2026-11-04) and `docs/spec/cross-browser-and-stores.md`. AMO rules were checked online on 2026-10-10 (sources at the end). Signing and submission use the publisher's own AMO credentials, which never go in the repository.

## Package facts

| Item | Value |
|---|---|
| Add-on ID | `shoo@shoo.extension`. Never change it after the first upload |
| Minimum Firefox | 140.0 (`gecko.strict_min_version`) |
| Background | event page (`background.scripts`) |
| Data collection | `required: ["none"]`, `optional: ["websiteContent", "authenticationInfo"]` |
| Extension zip | `.output/shoo-0.2.0-firefox.zip` from `pnpm zip:firefox` |
| Sources zip | `.output/shoo-0.2.0-sources.zip`, written by the same command |
| `web-ext lint` (10.7.0, 2026-10-10, rerun on the 0.2.0 build before upload) | 0 errors, 0 notices, 2 warnings `UNSAFE_VAR_ASSIGNMENT` (Preact's own innerHTML code path, no page data reaches it) |

### No `gecko_android`

The manifest must not declare `browser_specific_settings.gecko_android`. MDN says an extension is "only made available on desktop Firefox" unless `gecko_android` is present, and AMO's server code marks any manifest with `gecko_android` as explicitly Android compatible, pre-ticks Android at upload and refuses overrides. REQ-DIST-2 says no Firefox for Android, so `wxt.config.ts` leaves the key out. `web-ext lint` warns about the missing key. The warning does not block signing.

## Listing (listed submission only)

Unlisted ("On your own") signing needs none of this except the sources and reviewer notes. Keep it ready for a later listed release.

| Field | Value | Limit |
|---|---|---|
| Name | `Shoo · Clear unwanted video recommendations` | 43 of 50 characters. Any translation must stay at 50 or below |
| Summary | `Write what you don't want to see. Shoo tells YouTube and Bilibili "Not interested" for you, and shows which rule did it.` | 120 of 250. No URLs allowed (none present) |
| Description | Same text as `docs/release/chrome-web-store.md`, Description | 15,000 characters. AMO accepts limited Markdown, the plain list renders as is |
| Categories (up to 2) | **Photos, Music & Videos**. Optional second: **Other** | |
| Screenshots | Five 1280×800 PNGs (AMO's recommended size) in `docs/release/screenshots/`, listed in `chrome-web-store.md`, Screenshots. They predate Bilibili support and the redesign, so all five are to be re-shot before submission | No count limit |
| Support email / site | `shoo@piran.xyz`, https://github.com/Laoweek/shoo/issues | |
| License | Apache-2.0 (`LICENSE`, and `license` in `package.json`) | Required for a listed version |
| Privacy policy | https://laoweek.github.io/shoo/release/privacy-policy.html, or paste the text of `docs/release/privacy-policy.md` | Required when data leaves the device |

Screenshot captions for AMO (each screenshot has its own caption field):

1. Review mode asks on the video first. The chip names the Rule that matched.
2. The toolbar popup: on or off, Mode, today's counts and a quick Rule. (Composite: popup shown over a YouTube page.)
3. Your Rules. Exact rules run on your device without any model.
4. Activity shows what Shoo did, which Rule did it, and one-click Keep.
5. First run says exactly what is sent, and to whom, before anything is sent.

All screenshots use synthetic Rules written for the capture in a fresh profile, signed out of YouTube, with no OpenRouter key (details in `chrome-web-store.md`, Screenshots).

## Data collection declaration

The manifest declares nothing required and two optional categories. Firefox shows its own consent prompt when the user clicks "Agree and continue" in onboarding or "Give consent" in Settings. Shoo calls `browser.permissions.request({ data_collection: ['websiteContent', 'authenticationInfo'] })` as the first statement of that click handler (`src/ui/pages/consent.ts`). Declining keeps Shoo on Exact rules only.

| Category | Declared | What it covers in Shoo |
|---|---|---|
| `websiteContent` | optional | Titles, channel names, lengths, Surface, thumbnails with Thumbnail rules, Rule texts, up to 10 kept titles and channels. Extension Workshop: "anything visible on a website — such as text, images, videos, and links" |
| `authenticationInfo` | optional | The user's OpenRouter key, sent only to OpenRouter, the key of a provider the user reaches directly (Cloudflare, TypeSafe or Perplexity), sent only to that provider, and the key of the user's own endpoint if one is set up, sent only to that endpoint. MDN defines the category as "passwords, usernames, personal identification numbers (PINs), security questions, and registration information for extensions that offer account-based services". It does not name API keys. AMO policy counts any data handled outside the add-on as transmission, so declaring it is the conservative choice. The CWS form declares Authentication information too, so both stores match (REQ-PRIV-3) |
| `browsingActivity` | no | Shoo never sends URLs, video IDs or history |

Runtime checks in the build: the background calls `permissions.contains({ data_collection: ['websiteContent'] })` on every RuntimeState snapshot and listens to `permissions.onRemoved`, so revoking the permission in about:addons stops sending at once.

Review risk: because `required` is `["none"]`, the install prompt says the add-on collects no data. Mozilla's page describes the optional list as "ancillary" collection, and judging Topic rules is Shoo's main feature. A reviewer could ask for `websiteContent` to move to `required`. That would remove the Exact-rules-only path on Firefox (REQ-PRIV-2), so answer with the reviewer notes below first. Implicit consent does not apply, because judging runs in the background, not on a single user command.

## Reviewer notes (paste into "Notes for reviewers")

```
What Shoo does: on youtube.com (Home, Watch sidebar, Shorts shelf) it matches recommended videos against rules the user writes and, when one matches, clicks YouTube's own "Not interested" or "Don't recommend channel" menu item. It never hides content.

Bilibili: on from install, like YouTube. The manifest runs the packaged content-scripts/bilibili.js on https://www.bilibili.com/*, and its host permissions include https://www.bilibili.com/* and https://i0.hdslb.com/* (thumbnails for Thumbnail rules). On Bilibili's Home it does the same as on YouTube, through Bilibili's own 内容不感兴趣 and 不想看此UP主 menu items. The user can turn either site off in Settings, Sites.

Data and consent: the data_collection permissions (websiteContent, authenticationInfo) are optional and requested at runtime from the "Agree and continue" button in onboarding (first statement of the click handler) or "Give consent" in Settings. The onboarding screen shows exactly what is sent and to whom before the prompt. Without consent, or after the permission is revoked in about:addons (checked with permissions.contains and permissions.onRemoved), Shoo works with local Exact rules only and sends nothing.

What is sent after consent: per video the title, channel name, length and which part of YouTube or Bilibili it appeared on, plus the thumbnail only when the user has a Thumbnail rule. Per request the text of the user's Topic and Thumbnail rules and of Keep rules written as a sentence, and the titles and channel names of up to 10 videos the user kept. Destination: OpenRouter (https://openrouter.ai/api/alpha/decisions) with provider.data_collection "deny", routed to Cloudflare by default, TypeSafe or OpenAI on fallback, or the provider of another decision model the user picks in Settings. Instead of OpenRouter the user can choose, in onboarding or Settings, Cloudflare (api.cloudflare.com), TypeSafe (api.typesafe.ai) or Perplexity (api.perplexity.ai) directly with their own key, a Decision model on localhost (Ollama, llama.cpp, LM Studio), or a custom OpenAI-compatible endpoint. Before any user data goes to that host, the screen names it and asks for consent, and that host is requested as an optional host permission (on Firefox without the port, since Firefox match patterns take none). For a model on localhost, Shoo first sends one synthetic title, with no user data, to check that it answers. Never sent to any model host: URLs, video IDs (YouTube's and Bilibili's BV ids), channel IDs (including Bilibili's numeric uid), handles, Bilibili cover paths, the user's subscriptions, cookies, watch history, comments, page HTML or account details. Nothing goes to the developer, there is no analytics.

Credentials: every fetch from the background to OpenRouter, a model provider, a custom endpoint, i.ytimg.com or i0.hdslb.com uses credentials: "omit". Settings (Activity and the videos a Rule matched) shows thumbnails from the same two image hosts as ordinary images, without a referrer. There is one request that carries cookies: while the user has a remove Rule set to skip channels they are subscribed to, the background reads https://www.youtube.com/feed/channels with the user's YouTube cookies (credentials: "include", redirects refused, 20 s timeout), about once a day (a failed read, for example when signed out, is retried after 1 hour, then twice as long after each further failure, up to 24 hours), never started for a private-window tab or for Bilibili, to learn which YouTube channels the user is subscribed to (src/engine/subscriptions.ts). It uses the existing youtube.com host permission. The parsed channel list stays in storage.local and is never sent anywhere.

Thumbnails: with a Thumbnail rule, the background downloads the thumbnail from i.ytimg.com (YouTube's image server) or i0.hdslb.com (Bilibili's, with the cover path the page showed) and sends the image bytes, without the video ID or path, to the model.

Key: the user's own OpenRouter key, pasted or created through OpenRouter's PKCE sign-in via identity.launchWebAuthFlow (callback identity.getRedirectURL("openrouter")). If that flow fails, OpenRouter shows a code the user pastes. The key lives in storage.local and is read only by the background (enforced by an import-boundary lint rule and a bundle test). Connecting requires an OpenRouter account.

Private windows: for incognito sender tabs Shoo writes nothing to storage.local or storage.sync about videos or choices (no Activity, Verdict cache, stats or Exceptions). Videos kept in a private tab are held in memory-only storage.session and removed when that tab closes. Today's private-window counts for the daily spending cap stay in storage.session until the browser exits. The only storage.local writes are connection health state: failure counts (model, menu-action and markup failures) and the key-rejected and credits-used-up flags, with no video information, so a failure seen in a private window still pauses Shoo.

No remote code: all scripts are in the package, responses are JSON data, no eval. The two UNSAFE_VAR_ASSIGNMENT lint warnings are inside Preact's runtime.

Build: bundled and minified with WXT (Vite). Source code and build steps are in the attached sources zip, see README-SOURCES.md (Node 24.x, pnpm 11.9.0 via corepack, pnpm install --frozen-lockfile, pnpm zip:firefox).

Testing without accounts: choose "Use Exact rules only" in onboarding, add a title keyword such as "cartoon", open any youtube.com video. Matching Watch sidebar videos get a "Remove?" chip naming the rule. YouTube shows "Not interested" only to signed-in users, so Remove succeeds only with a signed-in YouTube account. Signed out it fails, the video stays and Activity records the failure. Remove works without any account on Bilibili's Home page (https://www.bilibili.com/, the only Bilibili page Shoo supports): with a title keyword taken from a video shown there, Remove clicks Bilibili's own 内容不感兴趣 (Not interested), Bilibili shows its placeholder, and 撤销 (Undo) brings the video back.
```

Beyond the draft in `cross-browser-and-stores.md` Section 4, these notes add Bilibili, the runtime permission check and revocation, `data_collection: deny`, which requests omit credentials and the one that includes YouTube cookies, the headless OAuth fallback, what the thumbnail fetch sends, the exact private-window storage behaviour including failure counts, the Preact lint warnings, the build pointer and testing steps.

## Private-window storage question

AMO policy 6.3 says: "Data from private browsing sessions must not be stored." It does not define "stored", and no Mozilla page says whether memory-only `storage.session` counts. Facts that matter:

- MDN: `storage.session` is "stored in memory ... not persisted to disk. When the browser stops, all session storage is cleared."
- Firefox runs extensions in "spanning" mode, so one `storage.session` serves private and normal windows. Shoo keeps private data under separate keys (`private:<tabId>:exceptions`, `private:counters:<day>`) that normal tabs never read.
- Per-tab private Exceptions are removed when the tab closes (`clearPrivateTab` on `tabs.onRemoved`). Private daily counters outlive the private windows until the browser exits.
- Failure counts and the key-rejected and credits-used-up flags from private tabs go to `storage.local`. They hold no browsing data.

Assessment: nothing reaches disk except counts with no browsing data, which fits the policy's purpose. It is not confirmed, so the reviewer notes state it openly. Two optional hardening changes would remove any doubt, each a code change: clear `private:counters:*` when the last private window closes (`windows.onRemoved` with an incognito check), and keep private-tab failure counts in `storage.session` instead of `storage.local` (`architecture.md` keeps them in local so a private-window failure still trips the breaker).

## Sources for review

`pnpm zip:firefox` writes `.output/shoo-0.2.0-sources.zip` with `src/`, `public/`, `scripts/`, `wxt.config.ts`, `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `.nvmrc`, `README-SOURCES.md` and `THIRD_PARTY_NOTICES.md`. It holds no `.env*`, `docs/`, `.impeccable/` or `test/fixtures/` (checked 2026-10-10). Mozilla's default reviewer machine is Ubuntu 24.04 ARM64 with Node 24.14.0 and npm. README-SOURCES.md names Node 24.x and pnpm 11.9.0 via corepack, which covers the difference Mozilla asks builders to state.

Before each upload, rerun the reproducibility check (`cross-browser-and-stores.md` Section 3): unzip the sources zip into an empty directory, `pnpm install --frozen-lockfile && pnpm zip:firefox`, unzip both extension zips and compare the sha256 of every file. A run on macOS on 2026-10-10 matched all 60 files of the rebuilt Firefox package. It has not been run on Ubuntu yet.

## Signing an unlisted build

Needs the publisher's AMO account. Never put AMO credentials in the repo or `.env.local`.

Before either path: check that the manifest has no `gecko_android` (above), rebuild, run `pnpm check` and `pnpm zip:firefox`, and rerun the reproducibility check.

### Option A: Developer Hub (web)

1. Sign in at https://addons.mozilla.org/developers/ and choose Submit a New Add-on.
2. Choose **On your own** (unlisted, self-distributed).
3. Upload `.output/shoo-0.2.0-firefox.zip`. Wait for validation (expect the two Preact warnings).
4. Platforms: Firefox desktop only. If Android is pre-ticked and locked, `gecko_android` is still in the manifest. Stop and remove it.
5. Answer yes to "Do you need to submit source code?" and upload `.output/shoo-0.2.0-sources.zip`.
6. Paste the reviewer notes above. Submit.
7. When the version shows as signed, download the `.xpi` and install it in Firefox (drag it onto a window, or about:addons, Install Add-on From File).

Unlisted versions are signed after automated validation and can still get a human review later, so the sources and notes matter.

### Option B: `web-ext sign`

Create API credentials at https://addons.mozilla.org/developers/addon/api/key/ and keep them in a password manager. Then, from the repo root:

```sh
pnpm zip:firefox
export WEB_EXT_API_KEY='<JWT issuer from AMO>'      # do not commit, do not echo
export WEB_EXT_API_SECRET='<JWT secret from AMO>'
pnpm dlx web-ext@10 sign \
  --channel=unlisted \
  --source-dir=.output/firefox-mv3 \
  --upload-source-code=.output/shoo-0.2.0-sources.zip \
  --artifacts-dir=.output/signed
```

`--channel` is required. The command waits up to 15 minutes for signing (`--approval-timeout`) and writes the signed `.xpi` to `.output/signed/`. web-ext 10 needs Node 22 or later. Add the reviewer notes on the version's page in the Developer Hub (passing them through `--amo-metadata` was not checked).

## Sources checked (2026-10-10)

- Name 50, summary 250 (no URLs), description 15,000: https://github.com/mozilla/addons-server/blob/master/src/olympia/addons/models.py and https://extensionworkshop.com/documentation/develop/create-an-appealing-listing/
- Screenshots 1280×800 recommended: https://extensionworkshop.com/documentation/develop/create-an-appealing-listing/
- Categories: https://addons.mozilla.org/api/v5/addons/categories/
- Source code policy (3.1) and private browsing (6.3), policies updated 2026-04-30: https://extensionworkshop.com/documentation/publish/add-on-policies/
- Source code submission and reviewer build machine: https://extensionworkshop.com/documentation/publish/source-code-submission/
- Submitting, "On your own": https://extensionworkshop.com/documentation/publish/submitting-an-add-on/
- Unlisted add-ons can be reviewed after signing: https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/
- `web-ext sign` flags: https://extensionworkshop.com/documentation/develop/web-ext-command-reference/
- Data collection categories and runtime consent: https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
- `required: ["none"]` is valid with optional categories: https://github.com/mozilla/addons-linter (src/parsers/manifestjson.js)
- `gecko_android` and desktop-only default: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings
- AMO treats `gecko_android` as an Android opt-in: https://github.com/mozilla/addons-server (src/olympia/files/utils.py, static/js/common/upload-addon.js)
- `storage.session` lifetime: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/session
- Spanning incognito mode: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/incognito
- Data consent mandatory for new extensions from 2025-11-03: https://blog.mozilla.org/addons/2025/10/23/data-collection-consent-changes-for-new-firefox-extensions/
- Implicit consent limited to single user commands: https://blog.mozilla.org/addons/2025/06/23/updated-add-on-policies-simplified-clarified/
