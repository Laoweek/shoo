# No MAIN-world script in v1: match YouTube's menu from the isolated world

YouTube's page data names the menu items (`imageName` `HIDE` for "Not interested", `REMOVE` for "Don't recommend channel") and carries the feedback tokens, but only a `world: "MAIN"` content script can read it. Shoo v1 does not inject one. It opens the Tile's menu with a synthetic click, waits for the lazily rendered icons, matches the item by a distinguishing substring of its SVG `path[d]`, and falls back to localized label text. This was verified live on 2026-10-09 (`docs/spec/youtube-integration.md`, Section 4).

**Considered options**: a MAIN-world bridge would know whether an action exists before opening a menu and would survive icon redesigns. It was rejected because MAIN-world code runs alongside YouTube's scripts, its `postMessage` channel can be spoofed by the page, it needs extra plumbing and testing in two browsers, and it reads internal tokens that Shoo must never store or log.

**Revisit when**: icon-path matching breaks repeatedly after YouTube icon refreshes, or YouTube stops rendering menu icons, or Shoo needs to know an action's availability without opening the menu (for example to support a Surface whose menus are expensive to open).
