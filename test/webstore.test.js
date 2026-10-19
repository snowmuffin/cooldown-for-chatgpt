'use strict';
const assert = require('node:assert/strict');
const { run } = require('../scripts/webstore.cjs');
const env = { CWS_ACCESS_TOKEN: 'test-token', CWS_PUBLISHER_ID: 'publisher', CWS_EXTENSION_ID: 'item',
  CWS_OPERATION: 'publish', CWS_EXPECTED_VERSION: '1.0.1' };
const published = { publishedItemRevisionStatus: { state: 'PUBLISHED', distributionChannels: [{ crxVersion: '1.0.0' }] } };
function setup(responses) {
  const calls = [];
  return { calls, deps: {
    request: async (url, options) => {
      calls.push({ url, ...options });
      assert.ok(responses.length, 'Unexpected API call');
      const data = responses.shift();
      return { ok: true, json: async () => data };
    },
    read: name => name === 'manifest.json' ? '{"version":"1.0.1"}' : Buffer.from('zip'),
    sleep: async () => {}, log: () => {},
  } };
}
(async () => {
  let h = setup([published]);
  await run({ ...env, CWS_OPERATION: 'status' }, h.deps);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].method, undefined);

  h = setup([published]);
  await assert.rejects(run({ ...env, CWS_EXPECTED_VERSION: '1.0.2' }, h.deps), /exactly match/);
  assert.equal(h.calls.length, 1);

  h = setup([{ submittedItemRevisionStatus: { state: 'PENDING_REVIEW' } }]);
  await assert.rejects(run(env, h.deps), /existing submission/);
  assert.equal(h.calls.length, 1);

  h = setup([{ publishedItemRevisionStatus: { distributionChannels: [{ crxVersion: '1.0.1' }] } }]);
  await assert.rejects(run(env, h.deps), /Increase/);
  assert.equal(h.calls.length, 1);

  h = setup([published, { uploadState: 'FAILED' }]);
  await assert.rejects(run(env, h.deps), /did not confirm success/);
  assert.equal(h.calls.length, 2);

  h = setup([published, { uploadState: 'IN_PROGRESS' }, { lastAsyncUploadState: 'SUCCEEDED' }, { state: 'PENDING_REVIEW' }]);
  await run(env, h.deps);
  assert.equal(h.calls.length, 4);
  assert.ok(h.calls[1].url.includes('/upload/v2/'));
  assert.equal(h.calls[3].method, 'POST');
  assert.deepEqual(JSON.parse(h.calls[3].body), { publishType: 'DEFAULT_PUBLISH', blockOnWarnings: true });

  h = setup([published, { uploadState: 'SUCCEEDED', crxVersion: '1.0.1' }]);
  await run({ ...env, CWS_OPERATION: 'upload' }, h.deps);
  assert.equal(h.calls.length, 2);
  console.log('ok - webstore: read-only status, version guard, pending review, monotonic version, failed upload, async upload, upload-only');
})().catch(error => { console.error(error); process.exitCode = 1; });
