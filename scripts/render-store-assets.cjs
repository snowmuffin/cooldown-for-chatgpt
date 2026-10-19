#!/usr/bin/env node
// Build-time only. Renders Chrome Web Store assets into store/: screenshots (1280x800) per locale,
// the small promo tile (440x280), and a store icon with the recommended 16 px padding.
// The panel and popup in the screenshots are the extension's real code running against a stub
// chrome API with sample data; the surrounding chat app is a generic mock, not ChatGPT's UI.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'store');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const ORIGIN = 'https://app.example';
const CONV = '6acde5a1-ee0c-83ee-8d06-5d0924e7163a';

const COPY = {
  en: {
    error: 'Unable to load conversation', retry: 'Retry',
    shots: [
      ['See exactly when you can retry', 'A live countdown from the Retry-After header, and an optional reload when it ends.'],
      ['Know what actually failed', 'When the load error appears, the panel reports what was observed for that conversation.'],
      ['Recent 429s and network errors', 'Kept in memory on your device only. Nothing is collected or sent anywhere.'],
    ],
    tagline: 'Live Retry-After countdown',
  },
  ko: {
    error: '이 ChatGPT 대화를 불러올 수 없습니다', retry: '다시 시도',
    shots: [
      ['언제 다시 시도할 수 있는지 정확히', 'Retry-After 헤더를 실시간 카운트다운으로 보여주고, 원하면 끝날 때 새로고침합니다.'],
      ['실제로 무엇이 실패했는지', '불러오기 오류가 뜨면 그 대화에서 관측된 내용을 그대로 알려줍니다.'],
      ['최근 429와 네트워크 오류 기록', '기기 메모리에만 보관합니다. 어떤 데이터도 수집하거나 전송하지 않습니다.'],
    ],
    tagline: '실시간 Retry-After 카운트다운',
  },
};

// chrome.* stub: real messages.json with Chrome's placeholder substitution, and canned extension state.
function stub(locale, state) {
  return `(() => {
    const msgs = ${read(`_locales/${locale}/messages.json`)};
    const getMessage = (key, subs = []) => {
      const m = msgs[key];
      return m ? m.message.replace(/[$]([A-Za-z0-9_]+)[$]/g, (_, p) => subs[+m.placeholders[p.toLowerCase()].content.slice(1) - 1] ?? '') : '';
    };
    const state = ${JSON.stringify(state)};
    window.chrome = {
      i18n: { getMessage, getUILanguage: () => ${JSON.stringify(locale)} },
      runtime: { id: 'store', lastError: undefined,
        getURL: p => '${ORIGIN}/' + p,
        sendMessage: (m, cb) => cb && setTimeout(() => cb(m.type === 'messages'
          ? { language: ${JSON.stringify(locale)}, messages: msgs }
          : { entries: state.entries || {}, events: state.events || [] }), 0),
        onMessage: { addListener() {} } },
      storage: {
        session: { get: async () => ({ history: state.history || [] }), remove: async () => {}, onChanged: { addListener() {} } },
        local: { get: async () => ({ autoReload: state.autoReload === true, language: ${JSON.stringify(locale)} }), set: async () => {} },
        onChanged: { addListener() {} },
      },
    };
  })();`;
}

const icon = `data:image/svg+xml;base64,${Buffer.from(read('icons/icon.svg')).toString('base64')}`;

const STYLE = `
  * { box-sizing: border-box; }
  body { margin: 0; width: 800px; height: 500px; overflow: hidden; font: 14px/1.4 system-ui, sans-serif;
    background: linear-gradient(135deg, #0d4f4a, #0a2f33); color: #fff; }
  .head { height: 104px; display: flex; align-items: center; gap: 16px; padding: 0 32px; }
  .head img { width: 52px; height: 52px; }
  .head h1 { margin: 0; font-size: 26px; letter-spacing: -.01em; }
  .head p { margin: 2px 0 0; opacity: .82; font-size: 14px; }
  .app { position: absolute; left: 32px; right: 32px; top: 104px; bottom: 0; display: flex; overflow: hidden;
    border-radius: 12px 12px 0 0; background: #212121; box-shadow: 0 -2px 24px rgba(0,0,0,.35); }
  .side { width: 170px; background: #171717; padding: 18px 14px; }
  .bar { height: 9px; border-radius: 5px; background: #2f2f2f; margin: 0 0 14px; }
  .main { flex: 1; display: flex; flex-direction: column; align-items: center; padding-top: 72px; gap: 12px; color: #ececec; }
  .err { display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .err button { font: inherit; color: #ececec; background: #2f2f2f; border: 1px solid #424242; border-radius: 18px; padding: 6px 16px; }
  .composer { position: absolute; left: 210px; right: 40px; bottom: 18px; height: 44px; border-radius: 22px; background: #303030; }
  iframe { position: absolute; top: 112px; right: 52px; width: 360px; height: 356px; border: 0; border-radius: 10px;
    box-shadow: 0 8px 28px rgba(0,0,0,.45); background: #202124; }
`;

function shotHtml(copy, [title, sub], { error = true, popup = false } = {}) {
  const bars = [92, 70, 84, 58, 76, 64, 88, 52].map(w => `<div class="bar" style="width:${w}%"></div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>
    <div class="head"><img src="${icon}" alt=""><div><h1>${title}</h1><p>${sub}</p></div></div>
    <div class="app"><div class="side">${bars}</div><div class="main">
      ${error ? `<div class="err"><div>${copy.error}</div><button>${copy.retry}</button></div>` : ''}
    </div><div class="composer"></div></div>
    ${popup ? `<iframe src="${ORIGIN}/popup.html"></iframe>` : ''}
  </body></html>`;
}

function promoHtml(copy) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; width: 440px; height: 280px; display: flex; align-items: center; gap: 22px; padding: 0 34px; box-sizing: border-box;
      font: 15px/1.35 system-ui, sans-serif; color: #fff; background: linear-gradient(135deg, #0f5a53, #0a2f33); }
    img { width: 112px; height: 112px; flex: none; }
    h1 { margin: 0 0 6px; font-size: 25px; line-height: 1.15; }
    p { margin: 0; opacity: .85; }
  </style></head><body><img src="${icon}" alt=""><div><h1>Cooldown for ChatGPT</h1><p>${copy.tagline}</p></div></body></html>`;
}

function sampleState(kind) {
  const now = Date.now();
  const convPath = `/backend-api/conversation/${CONV}`;
  if (kind === 'countdown') {
    // Partly elapsed, so the bars show progress.
    const entry = (method, p, secs, ago) => ({ key: `${method} ${p}`, method, path: p, raw: String(secs), at: now - ago * 1000, until: now + (secs - ago) * 1000 });
    const load = entry('GET', convPath, 120, 38);
    return {
      autoReload: true,
      entries: {
        [load.key]: load,
        'POST /backend-api/conversation': entry('POST', '/backend-api/conversation', 30, 12),
      },
      // The background worker records conversation loads as events too; this makes the diagnosis "waiting".
      events: [{ kind: '429', at: load.at, method: 'GET', url: convPath, raw: load.raw, until: load.until }],
    };
  }
  if (kind === 'diagnosis') {
    return { events: [{ kind: 'neterr', at: now - 1500, method: 'POST', url: '/backend-api/conversation/init', error: 'net::ERR_ABORTED', afterHeaders: null }] };
  }
  const base = new Date(2026, 9, 19, 10, 42, 7).getTime();
  return { autoReload: true, history: [
    { kind: '429', at: base, method: 'GET', url: `${convPath}?num_turns=10`, raw: '47' },
    { kind: '429', at: base - 12_000, method: 'POST', url: '/backend-api/conversation', raw: '18' },
    { kind: 'error', at: base - 115_000, method: 'POST', url: '/backend-api/conversation/init', error: 'net::ERR_ABORTED', afterHeaders: null },
    { kind: '429', at: base - 217_000, method: 'GET', url: '/backend-api/conversations?offset=0&limit=28', raw: null },
    { kind: 'error', at: base - 301_000, method: 'GET', url: `${convPath}`, error: 'net::ERR_INCOMPLETE_CHUNKED_ENCODING', afterHeaders: 200 },
  ] };
}

async function main() {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    throw new Error('Install the build-only renderer: npm install --no-save --package-lock=false playwright');
  }
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' });
  const written = [];
  try {
    for (const [locale, copy] of Object.entries(COPY)) {
      const kinds = [['countdown', {}], ['diagnosis', {}], ['history', { error: false, popup: true }]];
      for (const [i, [kind, opts]] of kinds.entries()) {
        const page = await browser.newPage({ viewport: { width: 800, height: 500 }, deviceScaleFactor: 1.6, locale });
        const state = sampleState(kind);
        const stubJs = stub(locale, state);
        await page.route(`${ORIGIN}/**`, route => {
          const url = new URL(route.request().url());
          if (url.pathname === '/popup.html') {
            const html = read('popup.html').replace('<script src="retry-after.js">', `<script>${stubJs}</script><script src="retry-after.js">`);
            return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
          }
          if (/^\/[a-z-]+\.js$/.test(url.pathname)) {
            return route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: read(url.pathname.slice(1)) });
          }
          if (/^\/_locales\/(en|ko)\/messages\.json$/.test(url.pathname)) {
            return route.fulfill({ contentType: 'application/json; charset=utf-8', body: read(url.pathname.slice(1)) });
          }
          if (/^\/icons\/icon\d+\.png$/.test(url.pathname)) {
            return route.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(root, url.pathname.slice(1))) });
          }
          return route.fulfill({ contentType: 'text/html; charset=utf-8', body: shotHtml(copy, copy.shots[i], opts) });
        });
        await page.goto(`${ORIGIN}/c/${CONV}`);
        if (kind !== 'history') {
          await page.evaluate(`${stubJs}\n${read('common.js')}\n${read('content.js')}`);
        }
        await page.waitForTimeout(700);
        const file = path.join(outDir, `screenshot-${i + 1}-${kind}-${locale}.png`);
        await page.screenshot({ path: file });
        written.push(file);
        await page.close();
      }
      const promo = await browser.newPage({ viewport: { width: 440, height: 280 } });
      await promo.setContent(promoHtml(copy));
      const promoFile = path.join(outDir, `promo-small-440x280-${locale}.png`);
      await promo.screenshot({ path: promoFile });
      written.push(promoFile);
      await promo.close();
    }
    // Store icon: 96 px artwork centered in a transparent 128 px canvas.
    const iconPage = await browser.newPage({ viewport: { width: 128, height: 128 } });
    await iconPage.setContent(`<html><body style="margin:0;background:transparent"><img src="${icon}" width="96" height="96" style="display:block;margin:16px"></body></html>`);
    const iconFile = path.join(outDir, 'store-icon-128.png');
    await iconPage.screenshot({ path: iconFile, omitBackground: true });
    written.push(iconFile);
  } finally {
    await browser.close();
  }
  for (const f of written) console.log(`Rendered ${path.relative(root, f)}`);
}

main().catch(error => {
  console.error(`Store asset rendering failed: ${error.message}`);
  process.exitCode = 1;
});
