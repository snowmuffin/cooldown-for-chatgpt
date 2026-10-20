importScripts('retry-after.js', 'common.js');

const FILTER = { urls: ['https://chatgpt.com/backend-api/*'] };
const HISTORY_KEY = 'history';
const HISTORY_MAX = 50;
const EVENTS_MAX = 20;
const PRUNE_ALARM = 'prune';
const key = tabId => `tab:${tabId}`;
const eventsKey = tabId => `events:${tabId}`;
const reloadsKey = tabId => `reloads:${tabId}`;
// How long an earlier conversation-load 429 is still mentioned after the page reloads.
const RECENT_429_MS = 15 * 60 * 1000;

// Per-request bookkeeping. It is lost if the worker restarts mid-request; every use
// below then falls back to the conservative choice (keep the cooldown, assume no headers).
const sentAt = new Map();      // requestId → timeStamp the request was issued
const statusSeen = new Map();  // requestId → status code, once response headers arrived
const forget = id => { sentAt.delete(id); statusSeen.delete(id); };

// Serialize read-modify-write on storage.session so concurrent events don't clobber each other.
let queue = Promise.resolve();
function serialize(fn) {
  queue = queue.then(fn).catch(e => console.error(e));
  return queue;
}

function mutate(tabId, fn) {
  return serialize(async () => {
    const k = key(tabId);
    const entries = (await chrome.storage.session.get(k))[k] || {};
    if (!fn(entries)) return;
    await chrome.storage.session.set({ [k]: entries });
    await publish(tabId, entries);
    await schedulePrune();
  });
}

async function publish(tabId, entries) {
  chrome.action.setBadgeText({ tabId, text: Object.keys(entries).length ? '429' : '' }).catch(() => {});
  chrome.tabs.sendMessage(tabId, { type: 'update', entries }).catch(() => {});
}

// Expiry lives here rather than in the page, so it also happens for tabs without a
// live content script, and a page can never delete an entry newer than the one it saw.
async function schedulePrune() {
  const all = await chrome.storage.session.get(null);
  const times = Object.entries(all).filter(([k]) => k.startsWith('tab:')).flatMap(([, v]) => Object.values(v).map(staleAt));
  if (times.length) chrome.alarms.create(PRUNE_ALARM, { when: Math.min(...times) });
  else chrome.alarms.clear(PRUNE_ALARM);
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== PRUNE_ALARM) return;
  serialize(async () => {
    const now = Date.now();
    const all = await chrome.storage.session.get(null);
    for (const [k, entries] of Object.entries(all)) {
      if (!k.startsWith('tab:')) continue;
      const stale = Object.keys(entries).filter(ek => staleAt(entries[ek]) <= now);
      if (!stale.length) continue;
      for (const ek of stale) delete entries[ek];
      await chrome.storage.session.set({ [k]: entries });
      await publish(Number(k.slice(4)), entries);
    }
    await schedulePrune();
  });
});

function pushHistory(item) {
  return serialize(async () => {
    const history = (await chrome.storage.session.get(HISTORY_KEY))[HISTORY_KEY] || [];
    history.unshift(item);
    await chrome.storage.session.set({ [HISTORY_KEY]: history.slice(0, HISTORY_MAX) });
  });
}

// Conversation-load observations for diagnosis, kept apart from the cooldown entries so
// that a timer running out never rewrites what was observed. Only document-bound requests
// are recorded: they can be attributed to the page that issued them.
function recordEvent(d, event) {
  if (d.tabId < 0 || !d.documentId) return;
  event.documentId = d.documentId;
  serialize(async () => {
    const k = eventsKey(d.tabId);
    const events = (await chrome.storage.session.get(k))[k] || [];
    events.push(event);
    await chrome.storage.session.set({ [k]: events.slice(-EVENTS_MAX) });
    chrome.tabs.sendMessage(d.tabId, { type: 'event', event }, { documentId: d.documentId }).catch(() => {});
  });
}

async function targetTabs(tabId) {
  if (tabId >= 0) return [tabId];
  // Requests from service/shared workers have no tab; attribute them to every chatgpt tab.
  return (await chrome.tabs.query({ url: 'https://chatgpt.com/*' })).map(t => t.id);
}

const pathAndQuery = u => { const url = new URL(u); return [url.pathname, url.pathname + url.search]; };

chrome.webRequest.onBeforeRequest.addListener(d => { sentAt.set(d.requestId, d.timeStamp); }, FILTER);

const headerValue = (d, name) => d.responseHeaders?.find(h => h.name.toLowerCase() === name)?.value ?? null;

chrome.webRequest.onHeadersReceived.addListener(async d => {
  statusSeen.set(d.requestId, d.statusCode);
  if (d.statusCode !== 429) return;
  const [path, full] = pathAndQuery(d.url);
  const raw = headerValue(d, 'retry-after');
  // ChatGPT's own client blocks history loads (including its Retry button) until the later of
  // Retry-After and this header, so the countdown has to use the later one too.
  const rawHistory = headerValue(d, HISTORY_RETRY_HEADER);
  const until = cooldownUntil(raw, rawHistory, d.timeStamp);
  const entry = { key: entryKey(d.method, path), method: d.method, path, raw, rawHistory, at: d.timeStamp, until };
  pushHistory({ kind: '429', at: d.timeStamp, method: d.method, url: full, raw, rawHistory, until });
  if (CONVERSATION_LOAD.test(path)) recordEvent(d, { kind: '429', at: d.timeStamp, method: d.method, url: full, raw, rawHistory, until });
  for (const tabId of await targetTabs(d.tabId)) {
    mutate(tabId, entries => { entries[entry.key] = entry; return true; });
  }
}, FILTER, ['responseHeaders']);

// A success clears the cooldown for the same method and path, but only if the request was
// sent after the 429 arrived; an older request finishing late says nothing about the limit now.
chrome.webRequest.onCompleted.addListener(async d => {
  const issued = sentAt.get(d.requestId);
  forget(d.requestId);
  if (d.statusCode >= 400) return;
  const [path, full] = pathAndQuery(d.url);
  // `sent` lets diagnose() tell a recovery from an older request finishing late.
  if (CONVERSATION_LOAD.test(path)) recordEvent(d, { kind: 'ok', at: d.timeStamp, sent: issued ?? null, method: d.method, url: full, status: d.statusCode });
  if (issued == null) return;
  const k = entryKey(d.method, path);
  for (const tabId of await targetTabs(d.tabId)) {
    mutate(tabId, entries => {
      if (!entries[k] || issued <= entries[k].at) return false;
      delete entries[k];
      return true;
    });
  }
}, FILTER);

// Network-level failures. These can happen before or after response headers arrive
// (e.g. a body cut off mid-stream), so record which one it was.
chrome.webRequest.onErrorOccurred.addListener(d => {
  const status = statusSeen.get(d.requestId) ?? null;
  forget(d.requestId);
  const [path, full] = pathAndQuery(d.url);
  if (!CONVERSATION_LOAD.test(path)) return;
  const event = { kind: 'neterr', at: d.timeStamp, method: d.method, url: full, error: d.error, afterHeaders: status };
  pushHistory({ kind: 'error', at: d.timeStamp, method: d.method, url: full, error: d.error, afterHeaders: status });
  recordEvent(d, event);
}, FILTER);

async function recentReloads(tabId, now = Date.now()) {
  const k = reloadsKey(tabId);
  return ((await chrome.storage.session.get(k))[k] || []).filter(t => now - t < RELOAD_WINDOW_MS);
}

// Auto reload: the page asks, and only the tab that asked is reloaded. The page's judgement is
// not trusted on its own: the setting, the document, the conversation and the recorded
// cooldowns are checked again here, inside the queue so concurrent requests can't share a slot
// of the per-tab cap.
function reloadTab(tabId, msg, sender) {
  return new Promise(resolve => serialize(async () => {
    try {
      resolve(await checkAndReload(tabId, msg, sender));
    } catch {
      resolve({ ok: false, reason: 'error' });
    }
  }));
}

async function checkAndReload(tabId, { convId }, sender) {
  const now = Date.now();
  if ((await chrome.storage.local.get('autoReload')).autoReload !== true) return { ok: false, reason: 'disabled' };
  if (!convId || !sender.documentId || conversationIdFromPath(new URL(sender.url).pathname) !== convId) return { ok: false, reason: 'unverified' };
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || conversationIdFromPath(new URL(tab.url).pathname) !== convId) return { ok: false, reason: 'unverified' };
  const [k, ek] = [key(tabId), eventsKey(tabId)];
  const stored = await chrome.storage.session.get([k, ek]);
  const forConv = url => loadsConversation(url, convId);
  const limits = (stored[ek] || []).filter(e => e.documentId === sender.documentId && e.kind === '429' && forConv(e.url));
  // Only a 429 observed for this very document and conversation justifies a reload.
  if (!limits.some(e => e.until != null)) return { ok: false, reason: 'unverified' };
  const pending = [
    ...limits.map(e => e.until),
    ...Object.values(stored[k] || {}).filter(e => forConv(e.path)).map(e => e.until),
  ].filter(u => u != null && u > now);
  if (pending.length) return { ok: false, reason: 'waiting', until: Math.max(...pending) };
  const recent = await recentReloads(tabId, now);
  if (recent.length >= RELOAD_LIMIT) return { ok: false, reason: 'limit' };
  await chrome.storage.session.set({ [reloadsKey(tabId)]: [...recent, now] });
  await chrome.tabs.reload(tabId);
  return { ok: true };
}

// Messages for the UI language setting. Content scripts can't read extension files directly.
async function loadMessages() {
  const language = languageOf((await chrome.storage.local.get('language')).language);
  const res = await fetch(chrome.runtime.getURL(`_locales/${language}/messages.json`));
  return { language, messages: await res.json() };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'messages') {
    loadMessages().then(sendResponse, () => sendResponse(undefined));
    return true;
  }
  const tabId = sender.tab?.id;
  if (tabId == null) return;
  if (msg.type === 'reloadTab') {
    if (sender.frameId !== 0) return;
    reloadTab(tabId, msg, sender).then(sendResponse);
    return true;
  }
  if (msg.type !== 'get') return;
  const [k, ek] = [key(tabId), eventsKey(tabId)];
  Promise.all([chrome.storage.session.get([k, ek, HISTORY_KEY]), recentReloads(tabId)]).then(([r, reloads]) => sendResponse({
    entries: r[k] || {},
    // Without a documentId on both sides there is no safe attribution, so send none.
    events: sender.documentId ? (r[ek] || []).filter(e => e.documentId === sender.documentId) : [],
    // Earlier conversation-load 429s survive a reload here, so the page can still mention them.
    recent429: (r[HISTORY_KEY] || []).filter(h => h.kind === '429' && CONVERSATION_LOAD.test(endpointOf(h.url)) && Date.now() - h.at < RECENT_429_MS)
      .map(({ at, url, raw, rawHistory, until }) => ({ at, url, raw, rawHistory, until })),
    recentReloads: reloads.length,
  }));
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => {
  chrome.storage.session.remove([key(tabId), eventsKey(tabId), reloadsKey(tabId)]).then(schedulePrune);
});
chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
