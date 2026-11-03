# Security policy

## Reporting a vulnerability

Please report security problems privately through GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. If the **Report a vulnerability** button is missing, email [shoo@piran.xyz](mailto:shoo@piran.xyz) instead. Do not open a public issue or pull request for a vulnerability.

Include what you found, how to reproduce it, the browser and Shoo version, and the impact you expect. You will get a reply in the advisory thread. Please give a reasonable time for a fix before you disclose the problem publicly.

## Scope

In scope:

- The Shoo extension itself: the background, the content script on youtube.com, the popup, onboarding and Settings pages.
- How Shoo stores, isolates and sends API keys (OpenRouter, direct Decision providers and custom endpoints), for example a key reaching a host other than the one the user chose, or becoming readable by YouTube pages or the content script.
- How Shoo handles YouTube pages, for example page content that makes Shoo run code, act on the wrong video, or send data that `docs/release/privacy-policy.md` says is never sent (URLs, video IDs, cookies, history).

Out of scope:

- Vulnerabilities in YouTube, OpenRouter, a model provider or a local model runtime. Report those to their owners.
- Problems that need an already compromised browser, extension profile or computer.
- Model answers that judge a video wrongly, unless they lead to one of the in-scope problems above.

## Supported versions

Shoo is pre-release. Fixes go into the latest code on the default branch.
