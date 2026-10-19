# Cooldown for ChatGPT

A Chrome extension that tells you when ChatGPT errors such as "Unable to load conversation" are caused by rate limiting (HTTP 429), and when you can try again.

The ChatGPT web app does not surface the `Retry-After` header the server sends. This extension reads it and shows a live per-endpoint countdown in the bottom-right corner of the page.

> Independent project. Not affiliated with or endorsed by OpenAI.

## Features

- Reads `Retry-After` (delta-seconds or HTTP-date) from 429 responses on `chatgpt.com/backend-api/*` and shows a countdown
- Red while waiting, green once retrying is allowed, yellow "no Retry-After" for 429s without the header
- Clears an entry automatically when the same endpoint later returns a successful response
- Shows a `429` badge on the toolbar icon while any endpoint is limited
- Countdown survives page reloads
- **Error diagnosis:** when ChatGPT shows its conversation load error, the panel reports what was actually observed for that conversation on this page: a 429 whose wait has elapsed (recovery unconfirmed), a network-level failure (and whether a status had already arrived), a last request that succeeded, or nothing recorded. It never concludes "not a 429" from the absence of data
- **History:** the toolbar popup lists the last 50 rate-limit responses (method, full path and query, `Retry-After`) and network failures on conversation requests
- **Auto reload (optional, off by default):** when ChatGPT can't load a chat because of a 429, reloads that tab once `Retry-After` has passed. Only the tab that hit the error is reloaded (`chrome.tabs.reload` on the sender tab), never before the wait is over, never while the message box holds unsent text, and at most 3 times in 10 minutes per tab. The panel shows the countdown with a Cancel button
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

Store assets in `store/` are rendered from the real panel and popup code with sample data:

```sh
npm install --no-save --package-lock=false playwright
node scripts/render-store-assets.cjs   # uses the installed Google Chrome
```

## Limitations

Waiting out `Retry-After` does not always fix ChatGPT's "Unable to load conversation" error. The error can also come from network-level failures or other server-side problems, and the server can answer with a new 429 after the wait. The panel reports what was actually observed for the conversation so these cases can be told apart; it never claims a cause it did not see.

## Contributing

Contributions are welcome: bug reports (ideally with what the panel and popup showed), ideas, and pull requests. ChatGPT's endpoints and error UI change without notice, so reports of new endpoint paths or error texts are especially useful. Please run the tests listed above before opening a pull request.

## License

[MIT](LICENSE)
