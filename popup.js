// Renders the recent 429 / aborted-request history kept by the background worker,
// and the auto reload setting.
const HISTORY_KEY = 'history';
const list = document.getElementById('list');
const clear = document.getElementById('clear');
const autoReload = document.getElementById('auto-reload');
const language = document.getElementById('language');
let history = [];

async function applyLanguage(lang) {
  const res = await fetch(chrome.runtime.getURL(`_locales/${lang}/messages.json`));
  setMessages(await res.json());
  document.documentElement.lang = lang;
  language.value = lang;
  language.setAttribute('aria-label', i18n('popupLanguage'));
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = i18n(el.dataset.i18n);
  document.querySelector('.setting-help').textContent = i18n('popupAutoReloadHelp', RELOAD_LIMIT, RELOAD_WINDOW_MS / 60000);
  render(history);
}

const hms = t => { const d = new Date(t); return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':'); };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// What the response said about waiting, as a duration from when it arrived ("Wait 1:47").
// An unparseable value is shown as sent.
function waitText(h) {
  // Newer entries carry `until`, which also accounts for ChatGPT's history retry header.
  const until = h.until !== undefined ? h.until : parseRetryAfter(h.raw, h.at);
  if (until == null && h.raw == null) return i18n('rowNoHeader');
  return until == null ? h.raw : i18n('popupWait', formatWait(Math.max(0, Math.round((until - h.at) / 1000))));
}

function render(items) {
  history = items;
  clear.disabled = !history.length;
  if (!history.length) {
    const li = el('li', 'empty');
    li.append(el('p', null, i18n('popupEmpty')), el('p', null, i18n('popupEmptyHelp')));
    list.replaceChildren(li);
    return;
  }
  list.replaceChildren(...history.map(h => {
    const li = el('li');
    const path = h.url.split('?')[0];
    const name = endpointName(h.method, h.url);
    const label = el('div', 'label');
    label.append(
      el('span', `kind k${h.kind}`, h.kind === '429' ? '429' : i18n('popupKindNetwork')),
      el('span', null, name ? i18n(name) : shortenPath(path)),
    );
    const extra = el('div', 'extra', h.kind === '429'
      ? waitText(h)
      : h.afterHeaders != null ? i18n('popupAfterStatus', h.error, h.afterHeaders) : h.error);
    extra.title = extra.textContent;
    const meta = el('div', 'meta', `${h.method} ${shortenPath(h.url)}`);
    meta.title = h.url;
    const time = el('time', null, hms(h.at));
    time.dateTime = new Date(h.at).toISOString();
    li.append(label, extra, meta, time);
    return li;
  }));
}

// Text first, then the history, so the list never renders in the wrong language.
Promise.all([chrome.storage.local.get(['autoReload', 'language']), chrome.storage.session.get(HISTORY_KEY)]).then(([settings, session]) => {
  autoReload.checked = settings.autoReload === true;
  history = session[HISTORY_KEY] || [];
  return applyLanguage(languageOf(settings.language));
});
chrome.storage.session.onChanged.addListener(ch => { if (ch[HISTORY_KEY]) render(ch[HISTORY_KEY].newValue || []); });
clear.onclick = () => chrome.storage.session.remove(HISTORY_KEY);
autoReload.onchange = () => chrome.storage.local.set({ autoReload: autoReload.checked });
language.onchange = () => {
  const lang = languageOf(language.value);
  chrome.storage.local.set({ language: lang });
  applyLanguage(lang);
};
