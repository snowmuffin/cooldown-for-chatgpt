const assert = require('node:assert/strict');
const {
  CONVERSATION_LOAD, READY_LINGER_MS, NO_HEADER_TTL_MS,
  entryKey, staleAt, shortenPath, conversationIdFromPath, concernsConversation, diagnose,
} = require('../common.js');

const A = '6acde5a1-ee0c-83ee-8d06-5d0924e7163a';
const B = '11111111-2222-3333-4444-555555555555';

// CONVERSATION_LOAD: single-conversation requests only, not the sidebar list.
for (const p of ['/backend-api/conversation/init', `/backend-api/conversations/${A}`])
  assert.ok(CONVERSATION_LOAD.test(p), `should match ${p}`);
for (const p of ['/backend-api/conversations', '/backend-api/conversations/', '/backend-api/models', '/backend-api/conversation'])
  assert.ok(!CONVERSATION_LOAD.test(p), `should not match ${p}`);

assert.equal(entryKey('POST', '/x'), 'POST /x');
assert.notEqual(entryKey('GET', '/x'), entryKey('POST', '/x'));

assert.equal(staleAt({ at: 0, until: 1000 }), 1000 + READY_LINGER_MS);
assert.equal(staleAt({ at: 500, until: null }), 500 + NO_HEADER_TTL_MS);

assert.equal(shortenPath(`/backend-api/conversations/${A}?num_turns=10`), '/conversations/6acde5a1…?num_turns=10');
assert.equal(shortenPath('/backend-api/conversations?limit=20'), '/conversations?limit=20');

assert.equal(conversationIdFromPath(`/g/g-p-xyz/c/${A}`), A);
assert.equal(conversationIdFromPath(`/c/${A}`), A);
assert.equal(conversationIdFromPath('/'), null);

assert.ok(concernsConversation(`/backend-api/conversations/${A}?num_turns=10`, A));
assert.ok(!concernsConversation(`/backend-api/conversations/${B}`, A));
assert.ok(concernsConversation('/backend-api/conversation/init', A), 'init carries no id');

// diagnose
const ctx = { convId: A, since: 0, now: 10_000 };
const ev = (kind, at, extra = {}) => ({ kind, at, method: 'GET', url: `/backend-api/conversations/${A}`, ...extra });
assert.deepEqual(diagnose([], ctx), { kind: 'none' });
assert.equal(diagnose([ev('429', 1000, { until: 20_000 })], ctx).kind, 'waiting');
// An observed 429 stays a 429 after its timer ends — it is not reclassified.
assert.equal(diagnose([ev('429', 1000, { until: 5_000 })], ctx).kind, 'elapsed');
// Without Retry-After no wait was ever given, so it cannot have "elapsed".
assert.equal(diagnose([ev('429', 1000, { until: null })], ctx).kind, 'nowait');
assert.equal(diagnose([ev('neterr', 1000, { error: 'net::ERR_ABORTED', afterHeaders: null })], ctx).kind, 'neterr');
assert.equal(diagnose([ev('ok', 1000, { sent: 900 })], ctx).kind, 'ok');
// A success sent after the failure, on the same method and endpoint, is a recovery.
assert.equal(diagnose([ev('neterr', 1000), ev('ok', 2000, { sent: 1500, status: 200 })], ctx).kind, 'ok');
// An older request finishing late is not: the 429 is still waiting.
assert.equal(diagnose([ev('429', 1000, { until: 20_000 }), ev('ok', 2000, { sent: 500 })], ctx).kind, 'waiting');
// Unknown send time, another method, or another endpoint is not a recovery either.
assert.equal(diagnose([ev('neterr', 1000), ev('ok', 2000, { sent: null })], ctx).kind, 'neterr');
assert.equal(diagnose([ev('neterr', 1000), ev('ok', 2000, { sent: 1500, method: 'POST' })], ctx).kind, 'neterr');
assert.equal(diagnose([ev('neterr', 1000), ev('ok', 2000, { sent: 1500, url: '/backend-api/conversation/init' })], ctx).kind, 'neterr');
// The query string does not make it a different endpoint.
assert.equal(diagnose([ev('neterr', 1000, { url: `/backend-api/conversations/${A}?num_turns=10` }), ev('ok', 2000, { sent: 1500, url: `/backend-api/conversations/${A}?num_turns=20` })], ctx).kind, 'ok');
// Events about another conversation, or from before a same-document navigation, are ignored.
assert.equal(diagnose([ev('neterr', 1000, { url: `/backend-api/conversations/${B}` })], ctx).kind, 'none');
assert.equal(diagnose([ev('neterr', 1000)], { ...ctx, since: 5000 }).kind, 'none');

console.log('ok - common');

// Endpoint names and wait formatting used by the panel and popup.
{
  const { endpointName, formatWait } = require('../common.js');
  const id = '6acde5a1-ee0c-83ee-8d06-5d0924e7163a';
  assert.equal(endpointName('GET', '/backend-api/conversations?offset=0&limit=28'), 'epList');
  assert.equal(endpointName('POST', '/backend-api/conversation/init'), 'epInit');
  assert.equal(endpointName('GET', `/backend-api/conversation/${id}`), 'epLoad');
  assert.equal(endpointName('GET', `/backend-api/conversations/${id}?x=1`), 'epLoad');
  assert.equal(endpointName('GET', `/backend-api/conversation/${id}/stream_status`), null, 'sub-resources are not "loading a chat"');
  assert.equal(endpointName('POST', '/backend-api/conversation'), 'epSend');
  assert.equal(endpointName('POST', '/backend-api/f/conversation'), 'epSend');
  assert.equal(endpointName('GET', '/backend-api/conversation'), null);
  assert.equal(endpointName('GET', '/backend-api/me'), null);
  assert.deepEqual([0, 47, 59, 60, 107, 3599, 3600, 3725].map(formatWait),
    ['0s', '47s', '59s', '1:00', '1:47', '59:59', '1:00:00', '1:02:05']);
  console.log('ok - endpointName, formatWait');
}

// i18n() with loaded messages follows Chrome's placeholder rules; the language setting is validated.
{
  const { setMessages, i18n, languageOf } = require('../common.js');
  setMessages(JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '_locales', 'ko', 'messages.json'), 'utf8')));
  assert.equal(i18n('diagNetErrAfterHeadersDetail', 'GET /c/x', 200), 'GET /c/x · 상태 200 수신 후 실패');
  assert.equal(i18n('reloadLimited', 3, 10), '10분 동안 3번 새로고침해서 자동 새로고침을 멈췄습니다.');
  assert.equal(i18n('popupClear'), '지우기');
  setMessages(null);
  assert.equal(languageOf(undefined), 'en', 'English by default');
  assert.equal(languageOf('ko'), 'ko');
  assert.equal(languageOf('../../x'), 'en', 'anything else falls back to English');
  console.log('ok - i18n with loaded messages, languageOf');
}

// notRequested: setup request cancelled and the conversation never requested on this page.
{
  const { diagnose } = require('../common.js');
  const id = '6acde5a1-ee0c-83ee-8d06-5d0924e7163a';
  const init = { kind: 'neterr', at: 100, method: 'POST', url: '/backend-api/conversation/init', error: 'net::ERR_ABORTED', afterHeaders: null };
  assert.equal(diagnose([init], { convId: id, since: 0, now: 200 }).kind, 'notRequested');
  const loaded = { kind: 'ok', at: 150, sent: 120, method: 'GET', url: `/backend-api/conversations/${id}?num_turns=10`, status: 200 };
  assert.equal(diagnose([init, loaded], { convId: id, since: 0, now: 200 }).kind, 'ok', 'cancelled init is noise once the chat itself was requested');
  const limited = { kind: '429', at: 140, method: 'GET', url: `/backend-api/conversations/${id}`, raw: '34', until: 34_140 };
  assert.equal(diagnose([init, limited], { convId: id, since: 0, now: 200 }).kind, 'waiting', 'a 429 on the chat itself wins');
  const otherAbort = { ...init, url: `/backend-api/conversations/${id}` };
  assert.equal(diagnose([otherAbort], { convId: id, since: 0, now: 200 }).kind, 'neterr', 'an aborted chat request stays a network error');
  console.log('ok - diagnose notRequested');
}

// Only the request that loads that very conversation can justify an auto reload.
{
  const { loadsConversation } = require('../common.js');
  const id = '6ad32d53-1e80-83ec-aa81-31ca848b5eca';
  assert.equal(loadsConversation(`/backend-api/conversation/${id}`, id), true);
  assert.equal(loadsConversation(`/backend-api/conversations/${id}?num_turns=10`, id), true);
  assert.equal(loadsConversation('/backend-api/conversations?offset=0&limit=28', id), false);
  assert.equal(loadsConversation('/backend-api/conversation/init', id), false);
  assert.equal(loadsConversation(`/backend-api/conversation/${id}/stream_status`, id), false);
  assert.equal(loadsConversation('/backend-api/conversation/00000000-0000-0000-0000-000000000000', id), false);
}
