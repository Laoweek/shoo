# Shoo

Shoo is a browser extension that tells YouTube, through YouTube's own menu actions, which recommendations the user does not want, judged against the user's Rules.

## Language

### What appears on YouTube

**Tile**:
One recommendation shown on a YouTube page, such as a video, a Short, or a live stream. "Tile" is the term for code and docs. User-facing copy says "video" (store copy may say "recommendation").
_Avoid_: item, card

**Artist channel**:
A channel YouTube marks as an Official Artist Channel, with a music note beside the channel name on its Tiles. An Artist channel Keep rule keeps every Tile from one.
_Avoid_: verified channel, music channel, OAC

**Subscribed channel**:
A channel the user is subscribed to on YouTube. A remove Rule can be set to skip Subscribed channels, so it never removes their Tiles. Shoo reads the list from YouTube on the device and never sends it anywhere.
_Avoid_: followed channel, favourite channel

**Surface**:
A place on YouTube where Tiles appear: Home, Watch sidebar, Search, Shorts shelf, Channel page, End screen.
_Avoid_: page, feed, section

**Shelf**:
A row of Tiles that YouTube shows on Home as one block under its own heading: the Shorts shelf, or the games shelf (YouTube Playables). The Shorts shelf is also a Surface, where Shoo judges its Tiles one by one. User-facing copy says "Shorts shelf" and "games shelf".
_Avoid_: section, carousel, row

### What the user writes

**Rule**:
A short, user-written description of Tiles the user does not want.
_Avoid_: filter, criteria, prompt

**Rule name**:
An optional short label the user gives a Rule. Shoo shows it wherever it names the Rule, on YouTube, in Activity and in Settings, with the Rule's text as its tooltip. Without one, Shoo shows the start of the Rule's text. The Decision model never sees it.
_Avoid_: title, prompt

**Rule label**:
What Shoo shows to name a Rule: its Rule name, or its text when it has none. Settings tables show the reference number beside it.
_Avoid_: tag, caption

**Topic rule**:
A Rule written as one plain-language sentence and judged by the Decision model.
_Avoid_: AI rule, prompt

**Thumbnail rule**:
A Rule written as one plain-language sentence about what a Tile's thumbnail image shows, judged by the Decision model looking at the image.
_Avoid_: image rule, visual filter

**Exact rule**:
A Rule matched locally against a Tile's channel, title or format (duration, view count, Short, live, members-only), or against whether its channel is an Artist channel, with no Decision model involved. A views Rule reads the view count YouTube shows in English, never a live stream's watchers.
_Avoid_: mechanical filter, denylist entry

**Banned channel**:
A channel whose Tiles are always removed with Don't recommend channel. The user adds one in Settings, Escalation adds one, and Shoo adds one when the user picks Don't recommend channel on a Tile themselves.
_Avoid_: denylist, blocklist, blocked channel

**Escalation**:
Turning a channel into a Banned channel because enough of its Tiles were removed by Topic rules.
_Avoid_: promotion, auto-ban

**Starter rule**:
A ready-made Rule offered during first run and in empty states that the user can add with one tap.
_Avoid_: template, preset rule

**Keep rule**:
A Rule describing Tiles that must never be removed. A Keep rule beats every other Rule.
_Avoid_: allowlist, whitelist

**Exception**:
A specific video the user chose to keep after it was judged unwanted.
_Avoid_: learning example, false positive

### What the extension does

**Verdict**:
The outcome of judging one Tile: Keep or Remove, with the Rule that decided it.
_Avoid_: decision, classification, result

**Rescue**:
A Keep rule's Keep Verdict for a Tile that a remove Rule or Banned channel would otherwise have removed. For an exact Keep rule, Shoo checks only Exact rules and Banned channels. Shoo counts and shows only Rescues for a Keep rule.
_Avoid_: save, override

**Removal**:
Performing a Native action on a Tile.
_Avoid_: hide, mark, filter, block

**Native action**:
One of YouTube's own menu actions the extension performs for the user: Not interested, or Don't recommend channel on a Tile, and a Shelf's own dismiss control in a Shelf dismissal.
_Avoid_: action, click

**Shelf dismissal**:
Performing a Shelf's own dismiss control ("Show fewer Shorts", "Show fewer games") on the whole Shelf, because the user switched it on for that Shelf in Settings. No Rule or Verdict is involved, and it is not a Removal.
_Avoid_: hiding a shelf, shelf removal, section removal

**Mode**:
How Verdicts turn into Removals. Auto removes immediately. Review asks the user on the Tile. Dry-run only shows what would happen.
_Avoid_: automation setting, dry-run flag

**Filtering strength**:
How sure the Decision model must be before a Topic rule or Thumbnail rule produces a Remove Verdict.
_Avoid_: threshold, confidence, sensitivity

**Verdict cache**:
The record of what the Decision model answered for a video under the current Rules, so the same video is never sent to the model twice.
_Avoid_: decision cache, model cache

**Daily cap**:
The most Tiles Shoo sends to the Decision model in one day before it stops asking until midnight.
_Avoid_: quota, limit

**Activity**:
The user-visible record of recent Verdicts and Removals.
_Avoid_: history, log

**Decision model**:
A model that answers typed questions with probabilities instead of writing text.
_Avoid_: LLM, AI, classifier

**Decision provider**:
Where Shoo sends a Decision model its questions: OpenRouter (the default), a provider's own API reached directly (Cloudflare, TypeSafe, Perplexity), or a Decision model on this computer (Ollama, llama.cpp, LM Studio). User-facing copy names the provider ("Cloudflare") or says "on this computer".
_Avoid_: backend, engine, integration

**System One API**:
The request and response shape every Decision provider speaks: a `state`, typed `questions`, and `answers` with probabilities. TypeSafe defines it, OpenRouter's Decisions API adds a `provider` routing object.
_Avoid_: Decisions API (when the provider is not OpenRouter)

**Custom endpoint**:
An OpenAI-compatible chat model address the user chooses instead of a Decision provider, offered only in Settings and labelled less accurate: a chat model rates its own answers, and Filtering strength was not tuned for them. It judges Topic rules only, never Thumbnail rules. User-facing copy says "chat model".
_Avoid_: own API, self-hosted model, provider preset

### What the user sees

**Review chip**:
The small control Shoo places on a flagged Tile in Review mode, offering Remove or Keep.
_Avoid_: badge, popup, prompt

**Batch summary**:
The single quiet notice Shoo shows after it removes one or more Tiles, naming the Rules involved.
_Avoid_: toast, notification (for this specific notice)
