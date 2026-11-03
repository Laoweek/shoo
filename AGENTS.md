# AGENTS.md

Shoo is a WXT browser extension (Chrome MV3 120+, Firefox MV3 140+) that judges YouTube recommendation Tiles against the user's Rules with a Decision model and performs YouTube's own Native actions. This file is for contributors and coding agents.

## Working rules

- Specs in `docs/spec/` are the source of truth. Before touching a module, read the spec that covers it. When code and spec disagree, fix the code, or update the spec in the same change and say why.
- Every identifier, label and message uses the vocabulary in `CONTEXT.md`. A new concept gets a glossary entry first.
- A hard-to-reverse or surprising trade-off gets a new ADR in `docs/adr/`. Read the existing ADR before proposing to reverse one.
- A behaviour change comes with tests that would fail without it.

## Reference, reach for it when the trigger applies

- **Vocabulary**: `CONTEXT.md` (Tile, Surface, Rule, Verdict, Removal, Exception, Escalation…).
- **Requirements** (`REQ-…` ids): `docs/spec/requirements.md`.
- **System shape, module boundaries, storage, budgets**: `docs/spec/architecture.md`.
- **Decision models, request shapes, Decision providers, fallback, OAuth, data recipients**: `docs/spec/decision-engine.md`. Filtering strength presets and their calibration: its Section 2.3, with the harness in `scripts/calibration/README.md`. Evidence behind the Rule-writing guide: its Section 13.
- **YouTube selectors, menus, undo, fixtures**: `docs/spec/youtube-integration.md`, fixtures in `test/fixtures/youtube/`.
- **Manifest, permissions, store submission**: `docs/spec/cross-browser-and-stores.md`, store packs in `docs/release/`.
- **Any UI**: `docs/spec/ui-design.md` and `DESIGN.md`. `DESIGN.md` is generated from the build by impeccable's documenter, so regenerate it after UI changes. Use the `/impeccable` skill for UI work when you have it.
- **Why a decision was made**: `docs/adr/`.

## Gotchas no config file will tell you

- The background judges every Tile. The content script only finds, extracts and decorates Tiles and performs Native actions.
- The content script loads on every youtube.com page and ships as one bundle (WXT cannot split content scripts, ADR 0006). Keep it within the `architecture.md` budget, which `pnpm size` enforces, and initialize UI code only on first need.
- Tailwind tokens go on `:root, :host`, and in-page UI uses px, never rem (YouTube sets `html { font-size: 10px }`). In-page UI uses the system font stack and the SVG wordmark. Bundled fonts are for extension pages only.
- `permissions.request` must be the first awaited call in a click handler, or Firefox rejects it. Ask for host access from Settings, never the popup (Firefox closes the popup when the prompt opens).
- Background state is disposable on both browsers (Chrome service worker, Firefox event page). Persist anything that matters.
- YouTube keeps hidden copies of pages you left. Scope every query to `ytd-page-manager > :not([hidden])`.
- Menu icons render about 1 s after the menu opens. Poll for the icon path before falling back to text.
- The list of data sent and its recipients is canonical in `decision-engine.md` Section 10. Onboarding consent, `PRODUCT.md`, the store packs and the privacy policy copy it, so change them together (REQ-PRIV-1, REQ-PRIV-3).

## Privacy and secrets

- Send a model only the Tile facts listed in `decision-engine.md` Section 10. Video IDs, URLs, channel IDs and handles stay on the device, for every Decision provider and chat endpoint.
- API keys live behind `src/store/secret.ts`, imported only by `src/engine/` and the background router. A lint rule and a bundle test enforce it.
- Log status codes and trimmed messages only. YouTube feedback tokens, API keys and raw error bodies (which can carry a `user_id`) stay out of logs.
- Keys go in `.env.local`, which is git-ignored. Refer to a secret by its name (`OPENROUTER_API_KEY`), and keep its value out of commits, fixtures, logs and issues. Redact keys, response `id`s and `user_id`s from recorded fixtures.
- Live tests (`pnpm test:live`) and calibration runs (`scripts/calibration/`) are opt-in and spend real OpenRouter credit. Run unit tests with `pnpm test`: a plain `vitest run` also runs the paid `live` project when `.env.local` holds a key.

## Checks

Run `pnpm check` (typecheck, lint, unit tests, both browser builds, size budgets) before calling a change done. CI runs the same command on pull requests and pushes to main.
