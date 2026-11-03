# Contributing to Shoo

Thanks for helping. Issues and pull requests are welcome. For anything larger than a small fix, open an issue first so the approach can be agreed before you build it.

## Setup

You need Node 24 (see `.nvmrc`) and pnpm, which Corepack provides at the version in `package.json`.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev              # or pnpm dev:firefox
```

The [README](README.md) explains how to load a build in Chrome and Firefox.

## Before you open a pull request

- Run `pnpm check`. It runs the typecheck, lint, unit tests, both browser builds and the size budgets, the same as CI.
- Add or update tests for any behaviour change. Unit tests run against recorded fixtures and never call a model.
- Live tests (`pnpm test:live`) and calibration runs spend real OpenRouter credit. They are opt-in and never required for a pull request.

## How the project is documented

- **Specs are the source of truth.** `docs/spec/` describes how Shoo behaves. When your change alters behaviour, update the spec in the same pull request. When code and spec disagree, fix one of them and say which in the description.
- **Use the project's words.** Names in code, UI copy and docs follow [CONTEXT.md](CONTEXT.md) (Tile, Surface, Rule, Verdict, Exception…). Add a glossary entry before introducing a new concept.
- **Record hard-to-reverse decisions.** A change that makes a surprising or hard-to-reverse trade-off gets a short ADR in `docs/adr/`. Read the existing ADR before proposing to reverse one.
- **What is sent stays canonical.** The data sent to models and its recipients are listed once in `docs/spec/decision-engine.md` Section 10. A change there also updates the onboarding consent, `PRODUCT.md`, the store packs in `docs/release/` and the privacy policy.

[AGENTS.md](AGENTS.md) collects the gotchas that no config file shows. Read it before working on the content script, permissions or the model calls.

## Secrets and privacy

- Keep API keys in `.env.local`, which is git-ignored, and out of commits, fixtures, logs, issues and screenshots.
- Never send video IDs, URLs, channel IDs or handles to a model. The tests check request bodies for this.
- Redact keys, response `id`s and `user_id`s from any recorded response you add to `test/fixtures/`.

## Reporting security problems

Please do not open a public issue. See [SECURITY.md](SECURITY.md).

## Licence

By contributing you agree that your contribution is licensed under the [Apache License 2.0](LICENSE), the project's licence.
