---
status: accepted
---

# Reach Decision providers directly, and keep chat models as a Settings-only fallback

ADR 0002 sends every Decision request through OpenRouter. Users want one-click setup of the other places Decision models live: Cloudflare's own API for clef-flash, TypeSafe for jev, and a Decision model on the user's own computer. Chat models are not equal choices in onboarding: Shoo is about Decision models.

Research (`decision-engine.md` Section 12) found that these providers, and the local runtimes that serve Decision models (Ollama, llama.cpp, LM Studio), all speak TypeSafe's System One API, the shape Shoo already sends to OpenRouter. So Shoo keeps one request builder, one validator and one derivation, and adds a small per-provider adapter (`core/providers.ts`, `DecisionsTarget` in `engine/decisions.ts`): the address, the auth header, the model ID without OpenRouter's `vendor/` prefix, no `provider` routing object, where a thumbnail goes, and Cloudflare's response envelope.

**Considered options**: one generic "System One URL" field (flexible, but no one-click setup, and the user would have to know each provider's path and image format), and OpenAI-compatible chat presets as equals (an earlier design, rejected because chat models self-report uncalibrated scores and cannot read thumbnails here).

**Consequences**:
- Onboarding step 2 offers Decision providers only: OpenRouter first and recommended, then Cloudflare, TypeSafe and Perplexity, and Ollama, llama.cpp and LM Studio on this computer. The chat model (custom endpoint) moves to Settings, Connection, labelled less accurate.
- A direct provider has no OpenRouter fallback chain. A failure counts toward the `model` category and the breaker like any exhausted chain (`decision-engine.md` Section 12).
- Each provider is a recipient of Tile data in its own right. Consent names its host before anything is saved, as for a custom endpoint, so `settings.consent.customHost` now covers any non-OpenRouter host. REQ-PRIV-1 and the consent screen name these recipients since `CONSENT_VERSION` 2.
- Filtering strength was tuned on clef-flash at Cloudflare. Cloudflare direct runs the same model, so the cutoffs carry over. A local clef-flash is the same weights quantized, other models were not tuned, and the setup says so.
- Spend for a direct provider is an estimate from its published price per input token: none of them reports `usage.cost`.
