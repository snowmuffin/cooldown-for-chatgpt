#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const origin = 'https://chromewebstore.googleapis.com';

// Dependencies can be replaced by tests; credentials and response bodies are never logged.
async function run(env, { request = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)),
  read = name => fs.readFileSync(path.join(root, name)), log = console.log } = {}) {
  const operation = env.CWS_OPERATION || 'status';
  if (!['status', 'upload', 'publish'].includes(operation)) throw new Error('Unknown store operation');
  for (const key of ['CWS_ACCESS_TOKEN', 'CWS_PUBLISHER_ID', 'CWS_EXTENSION_ID']) {
    if (!env[key]) throw new Error(`Missing ${key}`);
  }
  const name = `publishers/${encodeURIComponent(env.CWS_PUBLISHER_ID)}/items/${encodeURIComponent(env.CWS_EXTENSION_ID)}`;
  async function api(action, { upload = false, ...options } = {}) {
    let response;
    try {
      response = await request(`${origin}/${upload ? 'upload/' : ''}v2/${name}:${action}`, {
        ...options,
        headers: { Authorization: `Bearer ${env.CWS_ACCESS_TOKEN}`, ...options.headers },
        signal: AbortSignal.timeout(60000),
      });
    } catch { throw new Error(`Store ${action} request failed or timed out; inspect status before retrying`); }
    if (!response.ok) throw new Error(`Store ${action} failed: HTTP ${response.status}; inspect the developer dashboard`);
    try { return await response.json(); }
    catch { throw new Error(`Store ${action} returned invalid JSON`); }
  }
  const status = await api('fetchStatus');
  log(JSON.stringify({
    itemId: status.itemId,
    published: status.publishedItemRevisionStatus,
    submitted: status.submittedItemRevisionStatus,
    uploadState: status.lastAsyncUploadState,
  }, null, 2));
  if (operation === 'status') return;

  const manifest = JSON.parse(read('manifest.json'));
  if (!env.CWS_EXPECTED_VERSION || manifest.version !== env.CWS_EXPECTED_VERSION) {
    throw new Error('Requested version must exactly match manifest.json');
  }
  if (status.takenDown || status.warned) throw new Error('Resolve store policy notices before uploading');
  const pending = status.submittedItemRevisionStatus;
  if (['PENDING_REVIEW', 'STAGED'].includes(pending?.state)) {
    throw new Error('An existing submission is pending review or staged; resolve it before uploading');
  }
  const versions = [status.publishedItemRevisionStatus, pending]
    .flatMap(revision => revision?.distributionChannels || []).map(channel => channel.crxVersion);
  const parts = value => {
    if (!/^\d+(\.\d+){0,3}$/.test(value)) throw new Error('Unexpected extension version format');
    return value.split('.').map(Number).concat([0, 0, 0]).slice(0, 4);
  };
  const version = parts(manifest.version);
  for (const previous of versions) {
    const old = parts(previous);
    const index = version.findIndex((n, i) => n !== old[i]);
    if (index < 0 || version[index] < old[index]) throw new Error('Increase manifest.version before uploading');
  }
  const uploaded = await api('upload', {
    upload: true, method: 'POST', headers: { 'Content-Type': 'application/zip' },
    body: read(`dist/cooldown-for-chatgpt-${manifest.version}.zip`),
  });
  let state = uploaded.uploadState;
  // Some documentation uses the older UPLOAD_IN_PROGRESS spelling.
  for (let attempt = 0; ['IN_PROGRESS', 'UPLOAD_IN_PROGRESS'].includes(state) && attempt < 24; attempt++) {
    await sleep(5000);
    state = (await api('fetchStatus')).lastAsyncUploadState;
  }
  if (state !== 'SUCCEEDED') throw new Error('Upload did not confirm success; publication was not requested');
  if (uploaded.crxVersion && uploaded.crxVersion !== manifest.version) throw new Error('Uploaded version mismatch');
  log(`Uploaded version ${manifest.version}`);
  if (operation === 'upload') return;
  const submitted = await api('publish', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH', blockOnWarnings: true }),
  });
  if (!['PENDING_REVIEW', 'PUBLISHED', 'PUBLISHED_TO_TESTERS', 'STAGED'].includes(submitted.state)) {
    throw new Error('Store did not confirm submission; inspect the developer dashboard');
  }
  log(`Store state: ${submitted.state}. Submission success does not mean review has passed.`);
}

module.exports = { run };
if (require.main === module) run(process.env).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
