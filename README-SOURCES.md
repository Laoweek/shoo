# Building Shoo from source (for AMO reviewers)

Shoo is built with WXT (Vite). The submitted Firefox package is produced by the commands below. No environment file is needed. Do not create a `.env` file, it changes chunk hashes.

```
OS: macOS 15+ or Ubuntu 24.04 (x64 or arm64)
Node 24.x (see .nvmrc), pnpm 11.9.0 via corepack

corepack enable
pnpm install --frozen-lockfile
pnpm zip:firefox
```

The extension zip is written to `.output/shoo-<version>-firefox.zip`. Every file inside it matches the uploaded one (compare the sha256 of each extracted file, not the zip checksum, since zip containers carry timestamps).

Source layout: `src/entrypoints/` (background, content script, popup, options, onboarding), `src/core/` (pure logic), `src/engine/` (OpenRouter client, background only), `src/store/` (storage), `src/youtube/` (YouTube page handling), `src/ui/` (Preact components), `src/locales/` (strings). Fonts (Geist, Bricolage Grotesque, SIL OFL) come from the `@fontsource-variable` packages.
