// Shared by the background worker, content script and popup.

// Requests that load one conversation (conversation/init, conversations/{id}),
// as opposed to the sidebar list at /backend-api/conversations.
const CONVERSATION_LOAD = /^\/backend-api\/conversations?\/./;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

// How long a cooldown entry stays listed after Retry-After has passed.
const READY_LINGER_MS = 5000;
// A 429 without Retry-After has no end time; drop it after this long unless it recurs.
const NO_HEADER_TTL_MS = 60000;

// GET and POST to the same path are limited and recovered independently.
const entryKey = (method, path) => `${method} ${path}`;

// UI language is a setting (English by default) rather than the browser language that
// chrome.i18n follows, so the chosen _locales/<lang>/messages.json is loaded and used here.
const LANGUAGES = ['en', 'ko'];
const DEFAULT_LANGUAGE = 'en';
const languageOf = value => (LANGUAGES.includes(value) ? value : DEFAULT_LANGUAGE);
let uiMessages = null;
function setMessages(messages) { uiMessages = messages; }

// UI string with Chrome's placeholder rules. Falls back to chrome.i18n until messages are
// loaded, and to the key so a missing message shows up instead of a blank.
function i18n(key, ...subs) {
  const m = uiMessages?.[key];
  if (!m) return chrome.i18n.getMessage(key, subs.map(String)) || key;
  return m.message.replace(/\$([A-Za-z0-9_]+)\$/g, (whole, name) => {
    const content = m.placeholders?.[name.toLowerCase()]?.content;
    return content ? String(subs[Number(content.slice(1)) - 1] ?? '') : whole;
  });
}

function staleAt(entry) {
  return entry.until != null ? entry.until + READY_LINGER_MS : entry.at + NO_HEADER_TTL_MS;
}

// Auto reload limit, enforced per tab by the background worker.
const RELOAD_LIMIT = 3;
const RELOAD_WINDOW_MS = 10 * 60 * 1000;
// Extra wait before the next auto reload, by how many the tab already had in the window.
// The server can keep refusing after Retry-After, so each further try waits longer.
const RELOAD_BACKOFF_MS = [0, 30 * 1000, 90 * 1000];

// Message key naming a well-known ChatGPT endpoint, or null to show the path instead.
const LOAD_PATH = new RegExp(`^/backend-api/conversations?/${UUID.source}$`);
function endpointName(method, url) {
  const p = endpointOf(url);
  if (p === '/backend-api/conversations') return 'epList';
  if (p === '/backend-api/conversation/init') return 'epInit';
  if (LOAD_PATH.test(p)) return 'epLoad';
  if (method === 'POST' && /^\/backend-api\/(f\/)?conversation$/.test(p)) return 'epSend';
  return null;
}

// 47 → "47s", 107 → "1:47", 3725 → "1:02:05".
function formatWait(secs) {
  if (secs < 60) return `${secs}s`;
  const pad = n => String(n).padStart(2, '0');
  const h = Math.floor(secs / 3600), m = Math.floor(secs / 60) % 60, s = secs % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function shortenPath(p) {
  return p.replace(/^\/backend-api/, '').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, m => m.slice(0, 8) + '…');
}

function conversationIdFromPath(pathname) {
  const m = pathname.match(/\/c\/([0-9a-f-]{36})/);
  return m ? m[1] : null;
}

// A request naming a conversation id only concerns that conversation; conversation/init
// carries no id, so it can only be scoped by time.
function concernsConversation(url, convId) {
  const id = url.match(UUID);
  return !id || id[0] === convId;
}

const endpointOf = url => url.split('?')[0];

// What the observed conversation-load events say about the current load error.
// `events` are in chronological order and already limited to this document.
//   waiting — a 429 whose Retry-After has not passed yet
//   elapsed — a 429 was observed and its Retry-After has passed; recovery is unconfirmed
//   nowait  — a 429 was observed without Retry-After, so no wait time is known
//   notRequested — the setup request (conversation/init) was cancelled and the conversation
//             itself was never requested on this page
//   neterr  — the request failed at the network level (event.afterHeaders tells if a status arrived first)
//   ok      — no failure observed, or a later request recovered from it; the error has some other cause
//   none    — nothing observed for this conversation
function diagnose(events, { convId, since, now }) {
  const observed = events.filter(e => e.at >= since && concernsConversation(e.url, convId));
  if (!observed.length) return { kind: 'none' };
  // ChatGPT cancels its own setup request now and then. That is noise once the conversation
  // itself was requested; it only matters when the page never asked for the conversation.
  const setupCancelled = e => e.kind === 'neterr' && endpointOf(e.url) === '/backend-api/conversation/init';
  const requested = observed.some(e => endpointName(e.method, e.url) === 'epLoad');
  if (!requested) {
    const cancelled = observed.filter(setupCancelled).pop();
    if (cancelled && !observed.some(e => e.kind !== 'ok' && !setupCancelled(e))) return { kind: 'notRequested', event: cancelled };
  }
  const relevant = requested ? observed.filter(e => !setupCancelled(e)) : observed;
  const failure = [...relevant].reverse().find(e => e.kind !== 'ok');
  if (!failure) return { kind: 'ok', event: relevant[relevant.length - 1] };
  // Same rule as clearing a cooldown: only a success on the same method and endpoint that was
  // sent after the failure was observed counts as recovery. An older request finishing late,
  // or one whose send time is unknown, says nothing about the failure.
  const recovery = relevant.filter(e => e.kind === 'ok' && e.sent != null && e.sent > failure.at &&
    e.method === failure.method && endpointOf(e.url) === endpointOf(failure.url)).pop();
  if (recovery) return { kind: 'ok', event: recovery };
  if (failure.kind === 'neterr') return { kind: 'neterr', event: failure };
  if (failure.until == null) return { kind: 'nowait', event: failure };
  return { kind: failure.until > now ? 'waiting' : 'elapsed', event: failure };
}

if (typeof module !== 'undefined') {
  module.exports = {
    CONVERSATION_LOAD, READY_LINGER_MS, NO_HEADER_TTL_MS, RELOAD_LIMIT, RELOAD_WINDOW_MS, RELOAD_BACKOFF_MS, endpointOf,
    LANGUAGES, DEFAULT_LANGUAGE, languageOf, setMessages, i18n,
    entryKey, staleAt, shortenPath, endpointName, formatWait, conversationIdFromPath, concernsConversation, diagnose,
  };
}
