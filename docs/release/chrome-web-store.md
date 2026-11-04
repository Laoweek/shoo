# Chrome Web Store submission pack

Everything the Chrome Web Store (CWS) Developer Dashboard asks for, filled in from the built package (`.output/chrome-mv3/manifest.json`, version 0.2.0, built 2026-11-04) and `docs/spec/cross-browser-and-stores.md` Section 4. Store rules were checked online on 2026-10-10 (sources at the end). Submission uses the publisher's own developer account.

Status of each field: **Ready** (paste as is), **Publisher** (needs a decision or the publisher's account).

## Package

| Item | Value | Status |
|---|---|---|
| Upload | `shoo-0.2.0-chrome.zip` from the GitHub Release `v0.2.0` (`gh release download v0.2.0 --repo Laoweek/shoo --pattern 'shoo-0.2.0-chrome.zip'`), built by CI from the tag after `pnpm check`. Never upload a local build | Ready once the tag's CI run has published the Release |
| Manifest name | `__MSG_extName__` → "Shoo · Clear unwanted video recommendations" | Ready |
| Manifest description (store summary) | `__MSG_extDescription__` | Ready |
| Version | 0.2.0 | Ready |
| Minimum Chrome | 120 (`minimum_chrome_version`) | Ready |

## Store listing tab

### Name

`Shoo · Clear unwanted video recommendations`

43 characters, limit 75. CWS takes the name from the manifest. The name names no site, because Shoo works on YouTube and Bilibili, and "YouTube" is never part of the product name (REQ-DIST-1).

### Summary

```
Write what you don't want to see. Shoo tells YouTube and Bilibili "Not interested" for you, and shows which rule did it.
```

120 characters, limit 132. CWS takes it from the manifest `description`.

### Description

No length limit is documented. Avoid keyword lists (Keyword spam policy).

```
Shoo keeps your YouTube and Bilibili recommendations closer to what you actually want.

Write short rules like "reaction videos" or "crypto get-rich-quick". Shoo checks every recommendation on YouTube's Home, Watch sidebar and Shorts shelf, and on Bilibili's Home, against them and, when one matches, tells the site "Not interested" through the site's own menu so the site learns from it. Shoo never hides anything.

- Review mode asks you on the video first. Auto mode just does it. Dry-run only shows what it would do.
- Every removal says which rule caused it. Undo is one click while you're on the page, and Keep stops Shoo removing that video again.
- Keep rules protect channels and topics you always want.
- Rules work on both sites, or on just one if you choose.
- Exact rules for channels, keywords, video length, view count and Shorts run on your device, without any model. View count and Shorts rules work on YouTube only.
- A rule can be set to skip YouTube channels you're subscribed to.
- Optionally tells YouTube to show fewer Shorts and games shelves on Home.
- Topic rules use a fast decision model through your own OpenRouter account. A few cents per thousand videos.
- YouTube's "Not interested" needs you to be signed in to YouTube.
- On Bilibili, Shoo uses Bilibili's own 内容不感兴趣 and 不想看此UP主. You can turn either site off in Settings.

What Shoo sends, only after you agree: each video's title, channel name, length and where on YouTube or Bilibili it appeared, the thumbnail only if you create a Thumbnail rule, plus the text of your Topic and Thumbnail rules and of Keep rules written as a sentence, and the titles and channel names of up to 10 videos you kept. It goes to OpenRouter and the model provider it uses (Cloudflare by default, TypeSafe or OpenAI as fallbacks, or the provider of a model you pick), or, if you choose, straight to Cloudflare, TypeSafe or Perplexity, a model on your own computer, or your own endpoint. It never sends them web addresses, video IDs, channel IDs or handles, your YouTube subscriptions, cookies, watch history, comments, page HTML or your YouTube or Bilibili account details. A rule set to skip channels you're subscribed to sends those channels' videos in requests of their own, so the model provider could tell which of the channels it sees you subscribe to. Nothing is sent to the developer.

Shoo is not affiliated with or endorsed by YouTube, Google or Bilibili.
```

Notes on this text: the Exact rules line says "on your device", the Topic rules line names OpenRouter as needed for Topic rules only, a line says Not interested needs a signed-in YouTube account (observed: signed out, YouTube's menu has no Not interested), the "Never" list is the full REQ-PRIV-1 list, and the recipients include the provider of a model the user picks in Settings, which the build allows. "A few cents per thousand videos" follows the calibration harness, which measured about $0.025 per 1,000 with 10 Topic rules and 2 Topic Keep rules (`decision-engine.md` Section 2.3). The cost grows with the number of Rules.

### Category

**Workflow & Planning** (under Productivity). Unhook, a YouTube recommendation remover, is listed there. **Well-being** is the alternative. The category names come from the public store's category pages. The dashboard dropdown was not seen (needs sign-in). Status: Publisher (pick at submission).

### Language

English. The extension also ships a Simplified Chinese UI (`_locales/zh_CN`), whose `extName` and `extDescription` give a Chinese name and summary (check how the dashboard shows them at submission). A Chinese listing description is not written yet.

### Graphic assets

| Asset | File | Notes |
|---|---|---|
| Store icon 128×128 | `public/icon/128.png` (also in the package) | Shoo's eyes mark. No YouTube logo or red play button |
| Small promo tile 440×280 (**required**) | `docs/release/screenshots/promo-small-440x280.png` | Wordmark and one line on the page ground, in Figtree. Made for this pack |
| Marquee 1400×560 | none | Optional |
| Screenshots 1280×800 (1 to 5) | see below | All five slots used |

### Screenshots

All 1280×800 PNG, no alpha, from the built extension in a fresh Chrome profile with "Use Exact rules only" and Exact rules written for the capture. No OpenRouter key, no real user data. All five were captured on 2026-11-04 from the current build (Chrome for Testing 150, puppeteer-core). Screenshots 1, 2, 3 and 4 come from one run on the fixture pages (`test/fixtures/youtube/page-watch.html`, `page-home.html`) served at youtube.com, with synthetic titles, channels and generated thumbnails and a minimal page style of our own, so no third-party thumbnails or titles appear. Screenshot 5 was captured at 1680×1050 and scaled to 1280×800.

| # | File | Shows | Staged? |
|---|---|---|---|
| 1 | `screenshots/1-review-chip.png` | Review chip "Remove?" with the Rule's swatch and label ("cartoon", the Rule's text, no R-number), Remove and Keep, on a Watch sidebar video | Fixture page, synthetic Rules. The thumbnail must be wide enough for the full chip |
| 2 | `screenshots/2-popup.png` | Toolbar popup: On, Mode switch (Review), today's counts, "Shoo only uses Exact rules", Add a rule | **Composite**: the popup page placed over screenshot 1 where the toolbar popup would open. The popup shows 0 judged when only Exact rules ran (the counter counts model-judged videos) |
| 3 | `screenshots/3-settings-rules.png` | Settings, Rules: Try a title above the first four of five Exact rules (Shorts, and the keywords cartoon, episode and compilation, with for kids below the fold) | Synthetic Rules. Mode reads Dry-run because the capture switched Mode to fill Activity |
| 4 | `screenshots/4-activity.png` | Activity: Would remove rows with the Rule that matched, Keep and Always keep this channel | Synthetic Rules, Dry-run results on the fixture pages |
| 5 | `screenshots/5-onboarding-consent.png` | Onboarding step 1: what Shoo does, What Shoo sends, Agree and continue, Use Exact rules only | Real page, captured 2026-11-04 at 1680×1050 so the whole disclosure fits, then scaled to 1280×800 with no other edits. This is the in-product disclosure CWS asks for |

Branding check: the Shoo assets use no YouTube logo. Screenshots 1, 2 and 4 show a YouTube page only as rebuilt from fixtures, with no third-party artwork.

### Other listing fields

| Field | Value | Status |
|---|---|---|
| Official URL / homepage | https://github.com/Laoweek/shoo | Ready |
| Support URL or email | https://github.com/Laoweek/shoo/issues (email: shoo@piran.xyz) | Ready |
| Mature content | No | Ready |

## Privacy practices tab

### Single purpose

```
Shoo tells YouTube and Bilibili which recommendations you don't want, using the site's own Not interested and Don't recommend channel actions, based on rules you write.
```

### Permission justifications

One field per permission in the built manifest. Paste as is.

| Permission | Justification |
|---|---|
| `storage` | Saves your Rules, settings, Activity and a 30-day cache of past Verdicts on your device, and syncs Rules across your browsers. |
| `alarms` | Deletes Activity older than 30 days. |
| `identity` | Lets you connect your OpenRouter account without pasting a key (OpenRouter sign-in with PKCE through identity.launchWebAuthFlow). |
| Host `https://www.youtube.com/*` | Reads video titles, channel names and lengths on YouTube and tells YouTube Not interested or Don't recommend channel through YouTube's own menu. When one of your rules is set to skip channels you're subscribed to, it also reads your YouTube subscriptions page about once a day (sooner after a failed read) to know which channels those are. That list stays on your device. |
| Host `https://openrouter.ai/*` | Sends the data listed in the privacy policy to the decision model you connected, and completes OpenRouter sign-in. |
| Host `https://www.bilibili.com/*` | Reads video titles, channel names and lengths on Bilibili and tells Bilibili Not interested or Don't recommend channel through Bilibili's own menu. You can turn Bilibili off in Settings. |
| Optional hosts `https://i.ytimg.com/*`, `https://i0.hdslb.com/*` | Not granted at install. Requested when you turn on a Thumbnail rule, to download that video's thumbnail from YouTube's or Bilibili's image server. |
| Optional hosts `https://*/*`, `http://localhost/*`, `http://127.0.0.1/*` | Not granted at install. Requested only when you choose a model provider other than OpenRouter (Cloudflare, TypeSafe or Perplexity directly, a model on your computer, or any OpenAI-compatible address) during setup or in Settings, and only for that one address (Firefox grants it without the port). http is allowed only for a model you run on your own computer. |

The dashboard may not ask about optional hosts. If it shows a single host-permission field, paste the three host rows and both optional rows together.

### Remote code

**No, I am not using remote code.** All JavaScript ships in the package. Network responses (OpenRouter decisions, model list, key check) are JSON data and are never evaluated. No `eval`, no remote scripts, no `web_accessible_resources`.

### Data usage: what is collected

CWS counts data handled only on the device too, so these follow REQ-PRIV-1 and the Firefox declaration (`websiteContent`, `authenticationInfo`).

| Category | Tick? | Why |
|---|---|---|
| Personally identifiable information | No | Shoo never reads account names, emails or IDs |
| Health information | No | |
| Financial and payment information | No | Shoo shows OpenRouter spend in dollars, read from OpenRouter, but handles no payment data |
| **Authentication information** | **Yes** | The user's OpenRouter key (pasted, or created by Connect OpenRouter), the key of a provider reached directly (Cloudflare, TypeSafe or Perplexity), and the key of the user's own endpoint if one is set up. Stored on the device, each sent only to its own service as the user's credential |
| Personal communications | No | Comments are never read |
| Location | No | |
| Web history | No | Shoo keeps no list of pages visited. On youtube.com and bilibili.com it reads the page address and video links only to tell which part of the site it is on and which video a tile is, and on Bilibili the thumbnail's address, to fetch it for a Thumbnail rule and show it in Activity. Video IDs stay in the Verdict cache and Activity on the device, and in recent Exceptions through browser sync. Bilibili thumbnail addresses stay only in Activity. Neither is ever sent to a model or to the developer. See risk 3 below |
| User activity | No | No click, scroll or keystroke monitoring. Shoo records only its own Remove and Keep buttons in Activity |
| **Website content** | **Yes** | Video titles, channel names, lengths, the part of YouTube or Bilibili each video appeared on, thumbnails only with Thumbnail rules, the text of your Topic and Thumbnail rules and of Keep rules written as a sentence, and titles and channel names of up to 10 videos you kept |

Recipients to describe where the form asks: OpenRouter and the model provider it routes to (Cloudflare by default, TypeSafe for the text fallback, OpenAI for the thumbnail fallback, or the provider of another decision model the user picks in Settings). Instead of OpenRouter, the user can choose Cloudflare, TypeSafe or Perplexity directly, a model on their own computer, or their own endpoint. Nothing goes to the developer.

### Certifications (tick all three)

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

The wording is taken from public listing pages ("This developer declares that your data is…"). The dashboard's exact checkbox text was not seen.

### Limited Use

Certify compliance in the dashboard **and** publish a statement on a website (required by the Limited Use policy). The privacy policy carries it under the anchor `#limited-use`:

```
Shoo's use of information received from YouTube and Bilibili pages is limited to deciding which videos to tell YouTube or Bilibili you're not interested in. It is sent only to OpenRouter and the model provider you use, and is never used for advertising or sold.

Shoo's use of this information complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.
```

The spec draft has only the first sentence. The second is needed because the policy asks for "an affirmative statement that your use of the data complies with the Limited Use restrictions".

Data sent to a custom endpoint the user enters is outside Limited Use (User Data FAQ, user-specified servers). The policy still lists it.

### Privacy policy URL

https://laoweek.github.io/shoo/release/privacy-policy.html, served by GitHub Pages from `docs/release/privacy-policy.html` on `main`. Onboarding step 1 and Settings, Connection link to the same URL. Status: Ready once Pages is on.

### In-product disclosure and consent

Onboarding step 1 (screenshot 5) shows what is sent and to whom, with "Agree and continue" and "Use Exact rules only", before any request. Consent can be withdrawn in Settings, Connection. This matches the CWS rule that consent happens in the extension's own UI, not only in the listing, and the 2026 policy update that all data collection is prominently disclosed.

## Test instructions for the reviewer (Test instructions tab)

```
No account is needed to try Shoo with Exact rules: on the first screen choose "Use Exact rules only", add a title keyword (for example "cartoon"), then open any youtube.com video. Matching videos in the Watch sidebar get a "Remove?" chip naming the rule.

YouTube offers "Not interested" only to signed-in users, so Remove needs a signed-in YouTube account. Signed out, Remove fails, the video stays visible and Activity records the failure.

Remove can be tried without any account on Bilibili. Open https://www.bilibili.com/ (Home) and add a title keyword taken from a video shown there, since most Bilibili titles are in Chinese. A matching video gets the "Remove?" chip. Remove clicks Bilibili's own "内容不感兴趣" (Not interested) menu item, Bilibili shows its placeholder, and "撤销" (Undo) brings the video back. Shoo supports only Bilibili's Home page. Settings, Sites turns either site off.

Topic rules (plain-language rules judged by a model) need consent and an OpenRouter account with a key. Without one, Shoo stays on Exact rules.
```

## Risks and open points

1. **Fallback models.** The listing, the form and the policy still name TypeSafe and OpenAI, because they must match REQ-PRIV-1 and the build. Changing the fallback models changes REQ-MODEL-2, REQ-PRIV-1, the consent text and every store text together.
2. **Consent timing.** CWS asks for consent "before collecting or handling user data" and counts on-device handling. Before consent Shoo reads titles on the page only to match Exact rules on the device, and the onboarding page opens on install. Reviewers may still ask. The disclosure screen states the Exact-only path plainly.
3. **Web history.** On the device Shoo keeps records about recommended videos, not pages visited: Activity (30 days), the Verdict cache (30 days), Exceptions, and a 30-day per-channel tally of video IDs checked (for Escalation). None is a list of pages visited, so "Web history" stays unticked. If a reviewer disagrees, tick it and update the privacy policy and the Firefox declaration in the same change (REQ-PRIV-3).
4. **Not confirmed without the dashboard**: the category dropdown, the exact certification wording, whether optional hosts need their own justification.

## Sources checked (2026-10-10)

- Manifest name limit 75: https://developer.chrome.com/docs/extensions/reference/manifest/name
- Summary limit 132: https://developer.chrome.com/docs/extensions/reference/manifest/description and https://developer.chrome.com/docs/webstore/best-listing
- Listing fields, no stated description limit: https://developer.chrome.com/docs/webstore/cws-dashboard-listing
- Images: 1 to 5 screenshots at 1280×800 or 640×400, small promo tile 440×280 required, 128×128 icon: https://developer.chrome.com/docs/webstore/images
- Privacy tab (single purpose, permission justifications, remote code): https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- Limited Use statement on a website: https://developer.chrome.com/docs/webstore/program-policies/limited-use
- User Data FAQ (local handling counts, consent in the product UI, user-specified servers): https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
- 2026 policy update (data strictly necessary, prominent disclosure of all collection): https://developer.chrome.com/blog/cws-policy-updates-2026
- Data category definitions and certification wording, from a public listing's privacy page: https://chromewebstore.google.com/detail/x/nngceckbapebfimnlniiiahkandclblb/privacy
- Categories: https://chromewebstore.google.com/category/extensions (Productivity, Lifestyle, Make Chrome Yours sub-pages)
