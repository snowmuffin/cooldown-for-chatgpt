// Runs background.js in a VM with mocked Chrome APIs and drives webRequest events.
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const clone = x => (x == null ? x : structuredClone(x));
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });

function setup() {
  const storage = {};
  const messages = [];
  const badges = [];
  const reloads = [];
  const local = {};
  const tabUrls = {};
  const alarms = {};
  const ev = {
    before: event(), headers: event(), completed: event(), error: event(),
    message: event(), removed: event(), alarm: event(),
  };
  let now = 1_792_328_400_000;
  class Clock extends Date { static now() { return now; } }
  const chrome = {
    storage: { session: {
      async get(keys) {
        const ks = keys == null ? Object.keys(storage) : typeof keys === 'string' ? [keys] : keys;
        return Object.fromEntries(ks.filter(k => k in storage).map(k => [k, clone(storage[k])]));
      },
      async set(obj) { Object.assign(storage, clone(obj)); },
      async remove(keys) { for (const k of typeof keys === 'string' ? [keys] : keys) delete storage[k]; },
    }, local: {
      async get(keys) { const ks = typeof keys === 'string' ? [keys] : keys; return Object.fromEntries(ks.filter(k => k in local).map(k => [k, local[k]])); },
    } },
    action: { async setBadgeText(item) { badges.push(clone(item)); }, async setBadgeBackgroundColor() {} },
    tabs: { async sendMessage(tabId, msg, opts) { messages.push({ tabId, opts, ...clone(msg) }); }, async query() { return [{ id: 1 }]; }, async reload(tabId) { reloads.push(tabId); }, async get(tabId) { return { id: tabId, url: tabUrls[tabId] }; }, onRemoved: ev.removed },
    alarms: {
      create(name, info) { alarms[name] = info.when; },
      clear(name) { delete alarms[name]; },
      onAlarm: ev.alarm,
    },
    webRequest: { onBeforeRequest: ev.before, onHeadersReceived: ev.headers, onCompleted: ev.completed, onErrorOccurred: ev.error },
    runtime: { onMessage: ev.message },
  };
  const context = vm.createContext({ chrome, URL, Date: Clock, Map, console });
  context.importScripts = (...files) => { for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), context, { filename: f }); };
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8'), context, { filename: 'background.js' });

  const flush = async () => { for (let i = 0; i < 6; i++) { await Promise.resolve(); await vm.runInContext('queue', context); } };
  const fire = async (type, details) => { for (const cb of ev[type].listeners) await cb(details); await flush(); };
  const get = async (sender) => new Promise(res => { ev.message.listeners[0]({ type: 'get' }, sender, res); });
  const ask = (msg, sender) => new Promise(res => { const done = r => res(r === undefined ? r : JSON.parse(JSON.stringify(r))); if (ev.message.listeners[0](msg, sender, done) !== true) done(undefined); });
  return {
    storage, local, tabUrls, messages, badges, reloads, alarms, fire, get, ask, flush,
    setTime: t => { now = t; }, now: () => now,
    alarm: async () => { await fire('alarm', { name: 'prune' }); },
  };
}

const URL_CONV = 'https://chatgpt.com/backend-api/conversations/6acde5a1-ee0c-83ee-8d06-5d0924e7163a';
const KEY = 'GET /backend-api/conversations/6acde5a1-ee0c-83ee-8d06-5d0924e7163a';
const base = { url: URL_CONV, tabId: 1, method: 'GET', documentId: 'DOC-A' };
const r429 = (o = {}) => ({ ...base, statusCode: 429, responseHeaders: [{ name: 'Retry-After', value: '47' }], ...o });

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('429 creates an entry with a 47 s deadline', async () => {
  const h = setup();
  await h.fire('before', { ...base, requestId: 'r1', timeStamp: 1000 });
  await h.fire('headers', r429({ requestId: 'r1', timeStamp: 2000 }));
  assert.equal(h.storage['tab:1'][KEY].until, 2000 + 47_000);
});

test('an older request completing late does not clear a newer 429', async () => {
  const h = setup();
  await h.fire('before', { ...base, requestId: 'old', timeStamp: 1000 });
  await h.fire('before', { ...base, requestId: 'new', timeStamp: 1500 });
  await h.fire('headers', r429({ requestId: 'new', timeStamp: 2000 }));
  await h.fire('completed', { ...base, requestId: 'old', statusCode: 200, timeStamp: 3000 });
  assert.ok(h.storage['tab:1'][KEY], 'entry must survive');
});

test('a request sent after the 429 that succeeds clears it', async () => {
  const h = setup();
  await h.fire('headers', r429({ requestId: 'a', timeStamp: 2000 }));
  await h.fire('before', { ...base, requestId: 'retry', timeStamp: 50_000 });
  await h.fire('completed', { ...base, requestId: 'retry', statusCode: 200, timeStamp: 51_000 });
  assert.equal(h.storage['tab:1'][KEY], undefined);
});

test('a success whose send time is unknown (worker restarted) keeps the entry', async () => {
  const h = setup();
  await h.fire('headers', r429({ requestId: 'a', timeStamp: 2000 }));
  await h.fire('completed', { ...base, requestId: 'unknown', statusCode: 200, timeStamp: 60_000 });
  assert.ok(h.storage['tab:1'][KEY]);
});

test('GET success does not clear a POST 429 on the same path', async () => {
  const h = setup();
  await h.fire('headers', r429({ method: 'POST', requestId: 'p', timeStamp: 2000 }));
  await h.fire('before', { ...base, requestId: 'g', timeStamp: 3000 });
  await h.fire('completed', { ...base, requestId: 'g', statusCode: 200, timeStamp: 3500 });
  assert.ok(h.storage['tab:1']['POST /backend-api/conversations/6acde5a1-ee0c-83ee-8d06-5d0924e7163a']);
});

test('expiry is done by the background alarm and clears the badge without a content script', async () => {
  const h = setup();
  await h.fire('headers', r429({ requestId: 'a', timeStamp: h.now() }));
  assert.equal(h.alarms.prune, h.now() + 47_000 + 5000);
  h.setTime(h.now() + 60_000);
  await h.alarm();
  assert.deepEqual(h.storage['tab:1'], {});
  assert.equal(h.badges.at(-1).text, '');
  assert.equal(h.alarms.prune, undefined);
});

test('a newer 429 for the same key survives the prune scheduled for the old one', async () => {
  const h = setup();
  const t0 = h.now();
  await h.fire('headers', r429({ requestId: 'a', timeStamp: t0 }));
  await h.fire('headers', r429({ requestId: 'b', timeStamp: t0 + 50_000 }));
  h.setTime(t0 + 53_000); // past the first entry's stale time, before the second's
  await h.alarm();
  assert.equal(h.storage['tab:1'][KEY].at, t0 + 50_000);
});

test('history keeps the newest 50', async () => {
  const h = setup();
  for (let i = 0; i < 55; i++) await h.fire('headers', r429({ requestId: 'r' + i, timeStamp: 1000 + i }));
  assert.equal(h.storage.history.length, 50);
  assert.equal(h.storage.history[0].at, 1054);
});

test('network error after headers records the status that arrived', async () => {
  const h = setup();
  await h.fire('headers', { ...base, requestId: 'x', statusCode: 200, responseHeaders: [], timeStamp: 1000 });
  await h.fire('error', { ...base, requestId: 'x', error: 'net::ERR_INCOMPLETE_CHUNKED_ENCODING', timeStamp: 1100 });
  const e = h.storage['events:1'].at(-1);
  assert.equal(e.kind, 'neterr');
  assert.equal(e.afterHeaders, 200);
});

test('network error before headers has no status', async () => {
  const h = setup();
  await h.fire('error', { ...base, requestId: 'y', url: 'https://chatgpt.com/backend-api/conversation/init', method: 'POST', error: 'net::ERR_ABORTED', timeStamp: 1000 });
  assert.equal(h.storage['events:1'].at(-1).afterHeaders, null);
});

test('a later success is recorded after an earlier failure', async () => {
  const h = setup();
  await h.fire('error', { ...base, requestId: 'y', error: 'net::ERR_ABORTED', timeStamp: 1000 });
  await h.fire('completed', { ...base, requestId: 'z', statusCode: 200, timeStamp: 2000 });
  assert.deepEqual(h.storage['events:1'].map(e => e.kind), ['neterr', 'ok']);
});

test('events are only handed to the document that issued them', async () => {
  const h = setup();
  await h.fire('error', { ...base, requestId: 'y', documentId: 'DOC-OLD', error: 'net::ERR_ABORTED', timeStamp: 1000 });
  await h.fire('completed', { ...base, requestId: 'z', documentId: 'DOC-NEW', statusCode: 200, timeStamp: 2000 });
  const r = await h.get({ tab: { id: 1 }, documentId: 'DOC-NEW' });
  assert.deepEqual(r.events.map(e => e.kind), ['ok']);
  const none = await h.get({ tab: { id: 1 } });
  assert.equal(none.events.length, 0);
  const pushed = h.messages.filter(m => m.type === 'event');
  assert.deepEqual(pushed.map(m => m.opts.documentId), ['DOC-OLD', 'DOC-NEW']);
});

test('an older 200 finishing after a newer 429 keeps both the cooldown and the diagnosis', async () => {
  const { diagnose } = require('../common.js');
  const h = setup();
  const t = h.now();
  await h.fire('before', { ...base, requestId: 'old', timeStamp: t - 1000 });
  await h.fire('headers', { ...base, requestId: 'old', statusCode: 200, responseHeaders: [], timeStamp: t - 900 });
  await h.fire('before', { ...base, requestId: 'new', timeStamp: t - 800 });
  await h.fire('headers', r429({ requestId: 'new', timeStamp: t - 700 }));
  await h.fire('completed', { ...base, requestId: 'old', statusCode: 200, timeStamp: t - 100 });
  assert.ok(h.storage['tab:1'][KEY], 'cooldown kept');
  const events = JSON.parse(JSON.stringify(h.storage['events:1']));
  assert.equal(events.at(-1).sent, t - 1000);
  assert.equal(diagnose(events, { convId: '6acde5a1-ee0c-83ee-8d06-5d0924e7163a', since: 0, now: t }).kind, 'waiting');
});

test('sidebar list requests are not recorded as conversation events', async () => {
  const h = setup();
  await h.fire('headers', r429({ url: 'https://chatgpt.com/backend-api/conversations?limit=20', requestId: 'l', timeStamp: 1000 }));
  assert.equal(h.storage['events:1'], undefined);
  assert.ok(h.storage['tab:1']['GET /backend-api/conversations']);
});

// ---- Auto reload: the background re-validates every request ----
const CONV = '6acde5a1-ee0c-83ee-8d06-5d0924e7163a';
const OTHER = '11111111-2222-3333-4444-555555555555';
const PAGE = `https://chatgpt.com/c/${CONV}`;
// A tab whose document saw a conversation-load 429 that has already run out, with auto reload on.
function readyToReload(h, tabId, doc = 'DOC-A') {
  const t = h.now();
  h.local.autoReload = true;
  h.tabUrls[tabId] = PAGE;
  h.storage[`events:${tabId}`] = [{ kind: '429', at: t - 60_000, method: 'GET', url: `/backend-api/conversations/${CONV}?num_turns=10`, raw: '34', until: t - 20_000, documentId: doc }];
  return { tab: { id: tabId }, frameId: 0, documentId: doc, url: PAGE };
}
const reloadMsg = { type: 'reloadTab', convId: CONV };

test('reloadTab reloads exactly the asking tab, top frame only', async () => {
  const h = setup();
  const sender = readyToReload(h, 7);
  assert.deepEqual(await h.ask(reloadMsg, sender), { ok: true });
  assert.deepEqual(h.reloads, [7]);
  assert.equal(await h.ask(reloadMsg, { ...sender, frameId: 3 }), undefined, 'subframes are ignored');
  assert.equal(await h.ask(reloadMsg, {}), undefined, 'senders without a tab are ignored');
  assert.deepEqual(h.reloads, [7]);
});

test('reloadTab is refused when auto reload was turned off meanwhile', async () => {
  const h = setup();
  const sender = readyToReload(h, 1);
  h.local.autoReload = false;
  assert.deepEqual(await h.ask(reloadMsg, sender), { ok: false, reason: 'disabled' });
  assert.deepEqual(h.reloads, []);
});

test('reloadTab waits for a newer 429 that arrived after the page decided (#1)', async () => {
  const h = setup();
  const sender = readyToReload(h, 1);
  await h.fire('headers', r429({ requestId: 'n', timeStamp: h.now() }));
  const r = await h.ask(reloadMsg, sender);
  assert.equal(r.reason, 'waiting');
  assert.equal(r.until, h.now() + 47_000);
  assert.deepEqual(h.reloads, []);
});

test('reloadTab needs a 429 for this document and conversation, and the tab still on it', async () => {
  const h = setup();
  const sender = readyToReload(h, 1);
  assert.equal((await h.ask(reloadMsg, { ...sender, documentId: 'DOC-B' })).reason, 'unverified', 'another document');
  assert.equal((await h.ask({ type: 'reloadTab', convId: OTHER }, sender)).reason, 'unverified', 'another conversation');
  assert.equal((await h.ask({ type: 'reloadTab' }, sender)).reason, 'unverified', 'no conversation given');
  h.tabUrls[1] = `https://chatgpt.com/c/${OTHER}`;
  assert.equal((await h.ask(reloadMsg, sender)).reason, 'unverified', 'tab moved on to another chat');
  h.tabUrls[1] = PAGE;
  h.storage['events:1'] = [{ kind: 'neterr', at: h.now() - 1000, method: 'POST', url: '/backend-api/conversation/init', error: 'net::ERR_ABORTED', documentId: 'DOC-A' }];
  assert.equal((await h.ask(reloadMsg, sender)).reason, 'unverified', 'no 429 recorded at all');
  assert.deepEqual(h.reloads, []);
});

test('reloadTab is capped per tab and the cap expires', async () => {
  const h = setup();
  const t = h.now();
  const s1 = readyToReload(h, 1), s2 = readyToReload(h, 2);
  for (let i = 0; i < 3; i++) assert.equal((await h.ask(reloadMsg, s1)).ok, true);
  assert.deepEqual(await h.ask(reloadMsg, s1), { ok: false, reason: 'limit' });
  assert.equal((await h.ask(reloadMsg, s2)).ok, true, 'other tabs have their own budget');
  h.setTime(t + 10 * 60 * 1000 + 1);
  assert.equal((await h.ask(reloadMsg, s1)).ok, true, 'budget refills after the window');
  assert.deepEqual(h.reloads, [1, 1, 1, 2, 1]);
});

test('concurrent reloadTab requests cannot exceed the cap (#4)', async () => {
  const h = setup();
  const sender = readyToReload(h, 1);
  await h.ask(reloadMsg, sender);
  await h.ask(reloadMsg, sender);
  const replies = await Promise.all(Array.from({ length: 4 }, () => h.ask(reloadMsg, sender)));
  assert.equal(replies.filter(r => r.ok).length, 1, 'only one more slot was left');
  assert.equal(h.reloads.length, 3);
  assert.equal(h.storage['reloads:1'].length, 3, 'stored budget matches the reloads made');

  const fresh = setup();
  const s = readyToReload(fresh, 5);
  const all = await Promise.all(Array.from({ length: 6 }, () => fresh.ask(reloadMsg, s)));
  assert.equal(all.filter(r => r.ok).length, 3);
  assert.equal(fresh.reloads.length, 3);
});

test('closing a tab forgets its reload budget', async () => {
  const h = setup();
  await h.ask(reloadMsg, readyToReload(h, 4));
  assert.ok(h.storage['reloads:4']);
  await h.fire('removed', 4);
  assert.equal(h.storage['reloads:4'], undefined);
});

test('the countdown uses the later of Retry-After and the history retry header', async () => {
  const h = setup();
  const t = h.now();
  await h.fire('headers', r429({ requestId: 'h', timeStamp: t, responseHeaders: [{ name: 'Retry-After', value: '34' }, { name: 'X-OAI-History-Initial-Retry-After', value: '120' }] }));
  assert.equal(h.storage['tab:1'][KEY].until, t + 120_000);
  assert.equal(h.storage['tab:1'][KEY].rawHistory, '120');
  assert.equal(h.storage.history[0].until, t + 120_000);
  assert.equal(h.storage['events:1'].at(-1).until, t + 120_000);
});

test('get hands the page earlier conversation 429s and its reload count', async () => {
  const h = setup();
  const sender = readyToReload(h, 1);
  await h.fire('headers', r429({ requestId: 'x', timeStamp: h.now() - 5 * 60_000 }));
  await h.fire('headers', r429({ requestId: 'l', url: 'https://chatgpt.com/backend-api/conversations?limit=20', timeStamp: h.now() }));
  await h.ask(reloadMsg, sender);
  const r = JSON.parse(JSON.stringify(await h.get({ ...sender, documentId: 'DOC-NEW' })));
  assert.equal(r.recent429.length, 1, 'conversation loads only, not the sidebar list');
  assert.ok(r.recent429[0].url.includes(CONV));
  assert.equal(r.recentReloads, 1);
  assert.deepEqual(r.events, [], 'events of the old document are not handed to the new one');
});

(async () => {
  let fails = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log('ok -', name); }
    catch (e) { fails++; console.log('FAIL -', name, '\n   ', e.message); }
  }
  console.log(fails ? `${fails} failed` : `ok - background (${tests.length})`);
  process.exit(fails ? 1 : 0);
})();
