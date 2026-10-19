# Chrome Web Store listing

Copy for the developer dashboard. Images in this folder are rendered by `scripts/render-store-assets.cjs`.

| Asset | File |
|---|---|
| Store icon (128×128, 96 px artwork + 16 px padding) | `store-icon-128.png` |
| Screenshots (1280×800) | `screenshot-{1,2,3}-*-{en,ko}.png` |
| Small promo tile (440×280) | `promo-small-440x280-{en,ko}.png` |

## Basics

- **Name:** Cooldown for ChatGPT (from `_locales`)
- **Category:** Tools
- **Language:** English (default), Korean. The interface is English unless Korean is chosen in the popup.
- **Privacy policy URL:** https://snowmuffin.github.io/cooldown-for-chatgpt/privacy.html
- **Homepage / support:** https://github.com/snowmuffin/cooldown-for-chatgpt

## Description — English

When ChatGPT says "Unable to load conversation" or a request quietly fails, the reason is often rate limiting: the server answered with HTTP 429 and a Retry-After header telling the browser how long to wait. The ChatGPT web app doesn't show that number. Cooldown for ChatGPT does.

What it does
• Shows a small panel with a live countdown for each rate-limited request. It uses the same time ChatGPT itself uses to block its Retry button, so you know when Retry can work at all
• Turns green when retrying is allowed, and flags 429 responses that came without a wait time
• When ChatGPT shows its conversation load error, reports what was actually observed for that conversation: an elapsed wait, a network-level failure, a request that succeeded, or nothing recorded
• Shows a 429 badge on the toolbar icon while a limit is active
• Keeps a short history of recent 429s and network errors in the toolbar popup
• Optional auto reload (off by default): once the wait is over, reloads the tab that couldn't load the chat. It never reloads early, never touches other tabs, waits while you have unsent text, and stops after 3 reloads in 10 minutes.
• English and Korean interface (English by default, switch in the popup)

What it doesn't do
• It only reads response status and headers. It never blocks or modifies requests, never sends requests of its own, and doesn't try to get around limits.
• It doesn't read your messages or ChatGPT's replies.
• It collects nothing and sends nothing anywhere. Observations live in memory and are cleared when the browser restarts.

Good to know
• Waiting out the countdown doesn't always fix the error. The server can answer with a new 429 after the wait, ChatGPT sometimes doesn't request the chat at all after a reload, and the error can also come from network failures or other server-side problems. The panel shows what was actually observed, so you can tell these cases apart instead of waiting blindly.

Open source, and contributions are welcome. Bug reports, ideas and pull requests: https://github.com/snowmuffin/cooldown-for-chatgpt

Independent project. Not affiliated with or endorsed by OpenAI. ChatGPT is a trademark of OpenAI.

## Description — Korean

ChatGPT에서 "이 ChatGPT 대화를 불러올 수 없습니다"가 뜨거나 요청이 조용히 실패할 때, 원인은 사용량 제한인 경우가 많습니다. 서버는 HTTP 429와 함께 얼마나 기다려야 하는지 알려주는 Retry-After 헤더를 보내지만, ChatGPT 웹 앱은 그 시간을 보여주지 않습니다. Cooldown for ChatGPT가 대신 보여줍니다.

기능
• 사용량 제한에 걸린 요청마다 작은 패널에 실시간 카운트다운 표시. ChatGPT가 자체적으로 '다시 시도'를 막아 두는 시각과 같은 기준이라, 언제부터 다시 시도가 의미 있는지 알 수 있음
• 다시 시도해도 되는 시점에 초록색으로 전환, 대기 시간 없이 온 429도 따로 표시
• ChatGPT가 대화 불러오기 오류를 띄우면, 그 대화에서 실제로 관측된 내용(대기 시간 경과, 네트워크 오류, 성공한 요청, 기록 없음)을 알려줌
• 제한이 걸려 있는 동안 툴바 아이콘에 429 배지 표시
• 툴바 팝업에서 최근 429와 네트워크 오류 기록 확인
• 선택 기능인 자동 새로고침(기본 꺼짐): 대기 시간이 끝나면 대화를 불러오지 못한 그 탭만 새로고침합니다. 대기 시간 전에는 절대 새로고침하지 않고, 입력 중인 글이 있으면 기다리며, 10분에 3번을 넘기면 멈춥니다.
• 영어·한국어 지원(기본은 영어, 팝업에서 한국어 선택)

하지 않는 것
• 응답 상태와 헤더만 읽습니다. 요청을 차단·변경하거나 직접 요청을 보내지 않으며, 제한을 우회하지 않습니다.
• 메시지나 ChatGPT의 답변을 읽지 않습니다.
• 아무것도 수집하거나 전송하지 않습니다. 관측 기록은 메모리에만 있고 브라우저를 다시 시작하면 지워집니다.

알아 두실 점
• 카운트를 기다린다고 항상 오류가 해결되지는 않습니다. 기다린 뒤에도 서버가 새 429를 보낼 수 있고, 새로고침 뒤 ChatGPT가 대화를 아예 요청하지 않는 경우도 있으며, 네트워크 오류나 다른 서버 측 문제로도 생길 수 있습니다. 패널은 실제로 관측된 내용을 보여 주므로 무작정 기다리는 대신 어떤 경우인지 구분할 수 있습니다.

오픈 소스이며 기여를 환영합니다. 버그 제보, 아이디어, 풀 리퀘스트 모두 좋습니다: https://github.com/snowmuffin/cooldown-for-chatgpt

독립 프로젝트이며 OpenAI와 제휴하거나 보증받지 않았습니다. ChatGPT는 OpenAI의 상표입니다.

## Privacy practices tab

**Single purpose**

> Shows how long to wait before retrying when chatgpt.com responds with HTTP 429, by reading the Retry-After response header and displaying a live countdown on the page. Optionally reloads the affected tab once that wait is over.

**Permission justifications**

| Permission | Justification |
|---|---|
| `webRequest` | Reads the status code and the Retry-After header of chatgpt.com responses to detect rate limiting (HTTP 429) and network failures. Requests are only observed; nothing is blocked, modified or redirected. |
| `storage` | Keeps the current cooldowns and a short history in `chrome.storage.session` (in memory) so the countdown survives page reloads and the popup can list recent events, and the two settings (auto reload on/off, interface language) in `chrome.storage.local`. |
| `alarms` | Removes cooldown entries when their wait time has expired, even while the service worker is asleep. |
| Host permission `https://chatgpt.com/*` | The only site the extension works on: needed to observe its requests and show the countdown panel on its pages. |

**Remote code:** No, I am not using remote code. All JavaScript is included in the package.

**Data usage:** The extension does not collect or transmit any user data. Leave every data type unchecked. Certify all three statements:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes
