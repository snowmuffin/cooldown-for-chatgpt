# Contributing

Bug reports, documentation fixes, translations, and focused pull requests are welcome.
You can write issues and pull requests in English or Korean. 한국어로 참여해도 됩니다.
Please follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Report a problem

Search existing issues first, then use the bug report form. Include the extension and
Chrome versions, reproduction steps, and what the panel and popup displayed.
Replace conversation IDs with `<id>` and remove private information from screenshots.
Do not post raw HAR files, cookies, authorization headers, or full response bodies.
Report vulnerabilities through the [security policy](SECURITY.md).

The extension observes only part of ChatGPT's loading behavior. An absent observation
does not prove an absent request, and an HTTP success does not prove valid content.
Clearly separate captured evidence from a proposed explanation.

## Local development

1. Fork and clone the repository, then create a branch for your change.
2. Use Node.js 22, matching CI. The tests and ZIP builder need no npm dependencies.
3. Open `chrome://extensions`, enable Developer mode, and load the repository folder
   using **Load unpacked**.
4. After edits, reload the extension and the ChatGPT test tab.

Keep changes focused. Preserve the distinction between response headers, network
failures, and page state. Changes to permissions, data retention, or automatic reload
must explain the impact and update the relevant documentation and privacy policy.
Update both `_locales/en/messages.json` and `_locales/ko/messages.json` for UI text.

## Validate a change

Run these commands from the repository root:

```sh
node test/retry-after.test.js
node test/common.test.js
node test/background.test.js
node test/i18n.test.js
node test/icons.test.js
node test/webstore.test.js
node scripts/package.cjs
```

CI runs these checks on pull requests and pushes to `main`, then checks ZIP integrity.
The background tests mock Chrome APIs; they do not replace a browser check for changes
to request observation, page detection, or automatic reload. Report which browser
checks you actually performed. Do not deliberately generate repeated requests to
trigger rate limits; use mocked responses for repeatable tests.

Optional icon and store-image rendering tools are documented in the README. They
are not required for ordinary code or documentation changes. Do not commit browser
profiles, captured account data, `node_modules`, or generated ZIPs.

## Pull requests

Describe the problem, changed behavior, validation, and known limitations. Add a
regression test when changing diagnosis or cooldown behavior. For visual changes,
include redacted screenshots. Contributions are distributed under this repository's
[MIT license](LICENSE).
