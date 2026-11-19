---
status: accepted
---

# Judge tiles with a decision model through OpenRouter's alpha Decisions API

The obvious alternative is to send Tiles to a general chat LLM and parse JSON out of its text. Shoo instead uses a Decision model (default `cloudflare/clef-flash`) through `POST https://openrouter.ai/api/alpha/decisions`, which returns calibrated probabilities for typed questions in a single forward pass. It is roughly 0.2 s median latency, was estimated at about $0.01 per 1,000 Tiles (calibration with 10 Topic rules later measured about 2.5 US cents per 1,000), needs no output parsing, and a `choice` question names the Rule that matched without the model writing a reason.

**Considered options**: chat models with JSON schema (slower, costlier, free text to parse, kept only as the custom-endpoint path), safety classifiers such as Llama Guard (fixed categories, cannot follow user Rules).

**Consequences**:
- The Decisions API is alpha. Its request and response shapes are isolated behind one engine module so a change touches one file.
- Decisions requests take a single `model` with no fallback array, so Shoo implements its own fallback chain.
- Cloudflare reads only about the first 2,000 tokens of text in `state`, so Rules plus Exceptions sent to the model must stay under that budget.
- There is no generated text, so Shoo cannot rewrite Rules from undos. Exceptions handle mistakes instead (see ADR 0004).
