# Shoo privacy policy

Last updated: 2026-11-04

Shoo is a browser extension that tells YouTube and Bilibili, through the site's own menu, which recommended videos you're not interested in, based on rules you write.

## What Shoo sends, and where

Only after you agree, and only while Shoo is on, Shoo sends the following about each video it checks on YouTube's Home, Watch sidebar and Shorts shelf, and on Bilibili's Home:

- the video title
- the channel name
- the video length
- which of those places it appeared on
- the thumbnail image, only if you created a Thumbnail rule

Each request also includes the text of your enabled Topic rules, Thumbnail rules and Keep rules written as a sentence that work on the video's site, and the titles and channel names of up to 10 videos you chose to keep.

Shoo sends these to OpenRouter (openrouter.ai), which passes them to the model provider:

- Cloudflare by default (model `cloudflare/clef-flash`)
- TypeSafe when Shoo falls back to the model `typesafe/jev-1.13` for titles
- OpenAI when a thumbnail check falls back to the model `openai/gpt-6-luna-decisions`

If you pick a different decision model under Settings, Connection, they go to that model's provider through OpenRouter in place of Cloudflare, and the fallbacks above still apply if it fails. If you choose to reach Cloudflare (api.cloudflare.com), TypeSafe (api.typesafe.ai) or Perplexity (api.perplexity.ai) directly with your own key, they go to that provider instead of OpenRouter. If you run a model on your own computer (for example Ollama, llama.cpp or LM Studio), they stay on your computer. If you set up your own model endpoint, they go to that address instead. Before Shoo sends any of your data to an address other than openrouter.ai, it names that address and asks you.

You can turn YouTube or Bilibili off under Settings, Sites. Shoo then does nothing on that site.

For a Thumbnail rule, Shoo downloads the thumbnail image from YouTube's image server (i.ytimg.com) or Bilibili's (i0.hdslb.com), without cookies and without keeping it in the browser's cache, and sends the model the image alone. Shoo asks your browser for access to these servers when you turn on a Thumbnail rule, not at install. Shoo's Settings page also shows thumbnails of the videos in Activity and on your Rules, loaded from the same servers without a referrer.

Shoo never sends OpenRouter or any model provider web addresses (URLs), video IDs (YouTube's, or Bilibili's BV ids), channel IDs or handles, your YouTube subscriptions, cookies, your watch history, comments, the page's HTML, or your YouTube or Bilibili account details.

If a Rule is set to skip channels you're subscribed to, videos from those channels are sent in requests of their own without that Rule, so OpenRouter or the model provider could tell which of the channel names it receives belong to channels you subscribe to. The list itself is never sent.

Your OpenRouter key is stored on your device and sent only to OpenRouter to authorize these requests. If you reach Cloudflare, TypeSafe or Perplexity directly, that provider's key is stored on your device and sent only to that provider. If you set up your own endpoint, its key is stored on your device and sent only to that endpoint. With OpenRouter, Shoo turns on OpenRouter's setting that leaves out providers which store your requests and may train on them (`data_collection: deny`). OpenRouter or the model provider may still keep requests to prevent abuse, not to train on them, under their own policies. Pressing Connect OpenRouter in Settings signs you in at openrouter.ai, which creates your key there. A key you paste before giving consent is stored on your device and checked with OpenRouter only after you consent.

If you choose "Use Exact rules only", or decline consent, Shoo sends nothing to OpenRouter or any model provider. Exact rules (channels, keywords, patterns, length, Shorts) run entirely on your device.

You can withdraw consent at any time under Settings, Connection. On Firefox you can also remove the data collection permission in the browser's add-ons manager. Either way, Shoo stops sending at once and keeps working with Exact rules only.

## What Shoo stores

- **On your device:** your settings, your OpenRouter key (and the key of a provider you reach directly or of your own endpoint, if you set one up), a 30-day record of what Shoo did (Activity), a 30-day cache of past Verdicts, older Exceptions that no longer fit in sync, a 30-day per-channel tally of the IDs of videos checked and how many were removed (used to suggest banning a channel, kept only while Escalation is on), daily counts and spend, how often each Rule matched, OpenRouter's list of models, and, while a Rule is set to skip channels you're subscribed to, the list of those YouTube channels, which Shoo reads from your YouTube subscriptions page, signed in as you, about once a day (sooner after a failed read: it waits 1 hour, then twice as long after each further failure). Some of these records include YouTube or Bilibili video IDs and channel IDs, and for Bilibili videos the address of the thumbnail image. They stay on your device and are never sent.
- **Through your browser's sync:** your Rules, Keep rules, Banned channels and recent Exceptions (videos you kept or undid, with their title, channel name and video ID). Your browser's sync service (Google for Chrome, Mozilla for Firefox) handles this data under its own terms. The key, Activity and the Verdict cache never sync.
- **Private windows:** for tabs in private windows, Shoo writes nothing about the videos you see or the choices you make to disk. Videos you keep there are held in memory and forgotten when you close that tab. Today's counts for the daily spending cap are held in memory until the browser closes. Shoo does count failures (for example how many model requests failed) on your device, with no information about any video, so that it can pause when something is broken.

## What the developer receives

Nothing. Shoo has no server, no analytics and no tracking.

## Retention and deletion

- Activity and cached Verdicts older than 30 days are deleted automatically. The list of channels you're subscribed to is deleted as soon as no Rule skips them.
- "Clear history" in Settings, Advanced deletes Activity, cached Verdicts, counts and ban suggestions on this device, and keeps your Rules, Exceptions and settings.
- "Reset" in Settings deletes your Rules, Exceptions, keys, Activity and everything else Shoo stored about you, on this device and, through sync, on your other browsers, and restores the default settings.
- Uninstalling Shoo deletes its data on that device. To also remove synced Rules, use Reset before you uninstall.
- OpenRouter's and the model provider's own policies cover what they keep and for how long: [OpenRouter](https://openrouter.ai/privacy), [Cloudflare](https://www.cloudflare.com/privacypolicy/), [TypeSafe](https://typesafe.ai/legal/privacy-policy), [OpenAI](https://openai.com/policies/privacy-policy/) and [Perplexity](https://www.perplexity.ai/hub/legal/privacy-notice).

## Limited Use

Shoo's use of information received from YouTube and Bilibili pages is limited to deciding which videos to tell YouTube or Bilibili you're not interested in. It is sent only to OpenRouter and the model provider you use, and is never used for advertising or sold.

Shoo's use of this information complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Changes

If a future version of Shoo sends anything not listed above, this page changes first and Shoo asks for your consent again.

## Contact

Questions about this policy or Shoo's handling of your data: [shoo@piran.xyz](mailto:shoo@piran.xyz).

Shoo is not affiliated with or endorsed by YouTube, Google or Bilibili.
