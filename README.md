# Cooldown for ChatGPT

A Chrome extension that tells you when ChatGPT errors such as "Unable to load conversation" are caused by rate limiting (HTTP 429), and when you can try again.

The ChatGPT web app does not surface the `Retry-After` header the server sends. This extension reads it and shows a live per-endpoint countdown in the bottom-right corner of the page.

> Independent project. Not affiliated with or endorsed by OpenAI.

## Features

- Reads `Retry-After` (delta-seconds or HTTP-date) and ChatGPT's `x-oai-history-initial-retry-after` from 429 responses on `chatgpt.com/backend-api/*` and counts down to the later of the two. ChatGPT's own client blocks loading a conversation, including its Retry button, until that same time without sending a request, so the countdown shows when Retry can work at all
- Red while waiting, green once retrying is allowed, yellow "no Retry-After" for 429s without the header
- Clears an entry automatically when the same endpoint later returns a successful response
- Shows a `429` badge on the toolbar icon while any endpoint is limited
- Countdown survives page reloads
- **Error diagnosis:** when ChatGPT shows its conversation load error, the panel reports what was actually observed for that conversation on this page: a running wait (with a note that ChatGPT blocks its own Retry until then), a 429 whose wait has elapsed (recovery unconfirmed), a page that never requested the chat because ChatGPT cancelled its own setup request, a network-level failure (and whether a status had already arrived), a last request that succeeded, or nothing recorded. A 429 for the chat from before a reload is still mentioned. It never concludes "not a 429" from the absence of data
- **History:** the toolbar popup lists the last 50 rate-limit responses (method, full path and query, `Retry-After`) and network failures on conversation requests
- **Auto reload (optional, off by default):** when ChatGPT can't load a chat because of a 429, reloads that tab once the wait has passed. Only the tab that hit the error is reloaded (`chrome.tabs.reload` on the sender tab). The background re-checks every request (setting still on, same document and conversation, a 429 observed for them and no limit still pending) and handles them one at a time, so the cap of 3 reloads per tab in 10 minutes holds. Each further reload of a tab waits longer (+30 s, +90 s). Never before the wait is over, never while the message box holds unsent text. The panel shows the countdown with a Cancel button
- English (default) and Korean UI, chosen in the popup

The extension only **reads** response headers. It never blocks or modifies requests, never sends requests of its own, and sends no data anywhere; the optional auto reload is the same as pressing reload after the server's wait. See the [privacy policy](docs/privacy.html).

## Install (development build)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Reload any ChatGPT tabs that were already open.

## Layout

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest |
| `background.js` | Observes requests via `webRequest`: 429 cooldowns per method + path, conversation-load events per document, history; expires cooldowns with `chrome.alarms` |
| `content.js` | Injects a Shadow DOM panel that renders the countdown and, when ChatGPT's error UI is visible, the diagnosis |
| `popup.html`, `popup.js` | Toolbar popup: recent history, auto reload switch, language |
| `_locales/` | UI strings (`en` default, `ko`). The manifest name and description use `chrome.i18n`; the panel and popup load the language chosen in the popup |
| `icons/` | Independent teal speech-bubble-and-clock artwork: `icon.svg` for 48/128 px exports, `icon-small.svg` for 16/32 px toolbar exports, and four transparent PNGs referenced by the manifest; see [icons/README.md](icons/README.md) |
| `retry-after.js` | `Retry-After` parsing |
| `common.js` | Helpers shared by all three contexts, including the pure `diagnose()` decision and `i18n()` |
| `docs/privacy.html` | Privacy policy, served with GitHub Pages |
| `store/` | Chrome Web Store listing text, screenshots, promo tile and store icon |
| `scripts/` | Build-only tools: icon renderer, store asset renderer, package builder |

## Icons

The checked-in PNGs are ready to load in Chrome. To regenerate them after editing the native SVG sources:

```sh
npm install --no-save --package-lock=false @resvg/resvg-js@2.6.2
node scripts/render-icons.cjs
node test/icons.test.js
node test/webstore.test.js      # store deployment checks with mocked API responses
```

The build-only renderer reads sizes and output paths from `manifest.json`, including toolbar icons. The dependency-free asset test checks both vector sources and all four PNGs for manifest references, integrity, dimensions, and transparency. See [icons/README.md](icons/README.md) for source details and visual inspection guidance.

## Tests

```sh
node test/retry-after.test.js
node test/common.test.js
node test/background.test.js   # background.js in a VM with mocked Chrome APIs
node test/i18n.test.js         # locales match each other and the keys the code uses
node test/icons.test.js
```

## Package

```sh
node scripts/package.cjs
```

Writes `dist/cooldown-for-chatgpt-<version>.zip` with only the files the extension loads (derived from the manifest, `importScripts` and `popup.html`). No dependencies.

For GitHub Actions uploads and review submissions, see the [Chrome Web Store release guide](docs/webstore-release.md).

Store assets in `store/` are rendered from the real panel and popup code with sample data:

```sh
npm install --no-save --package-lock=false playwright
node scripts/render-store-assets.cjs   # uses the installed Google Chrome
```

## Limitations

Waiting out the countdown does not always fix ChatGPT's "Could not load this ChatGPT conversation" error. The server can answer with a new 429 after the wait (observed: a 34 s wait followed by another 429 with 48 s), the page sometimes never requests the conversation after ChatGPT cancels its own setup request, and the error can come from network-level failures or other server-side problems. A full reload clears ChatGPT's in-page block on Retry, but not the server's limit. The panel reports what was actually observed for the conversation so these cases can be told apart; it never claims a cause it did not see.

## Contributing

Contributions in English and Korean are welcome. See the [contribution guide](CONTRIBUTING.md) for setup, checks, and reporting guidance, and the [Code of Conduct](CODE_OF_CONDUCT.md) for community expectations.

Use the [issue forms](https://github.com/snowmuffin/cooldown-for-chatgpt/issues/new/choose) for bug reports and ideas. Remove private conversation data from reports. For vulnerabilities, follow the [security policy](SECURITY.md).

## License

[MIT](LICENSE)
