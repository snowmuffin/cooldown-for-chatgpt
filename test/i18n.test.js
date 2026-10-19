// Checks _locales against each other and against the keys the code looks up.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const manifest = JSON.parse(read('manifest.json'));
const locales = fs.readdirSync(path.join(root, '_locales'));
const messages = Object.fromEntries(locales.map(l => [l, JSON.parse(read(`_locales/${l}/messages.json`))]));
assert.ok(messages[manifest.default_locale], 'default_locale has no messages.json');
const base = messages[manifest.default_locale];

const placeholdersOf = m => (m.message.match(/\$[A-Za-z0-9_]+\$/g) || []).map(p => p.slice(1, -1).toLowerCase()).sort();
for (const [locale, msgs] of Object.entries(messages)) {
  assert.deepEqual(Object.keys(msgs).sort(), Object.keys(base).sort(), `${locale}: keys differ from ${manifest.default_locale}`);
  for (const [key, m] of Object.entries(msgs)) {
    assert.ok(m.message, `${locale}.${key}: empty message`);
    const used = placeholdersOf(m);
    assert.deepEqual(used, Object.keys(m.placeholders || {}).map(p => p.toLowerCase()).sort(), `${locale}.${key}: placeholders`);
    assert.deepEqual(used, placeholdersOf(base[key]), `${locale}.${key}: placeholders differ from ${manifest.default_locale}`);
  }
  // Chrome Web Store limits.
  assert.ok(msgs.extName.message.length <= 75, `${locale}: name too long`);
  assert.ok(msgs.extDescription.message.length <= 132, `${locale}: description too long`);
  console.log(`ok - ${locale}: ${Object.keys(msgs).length} messages`);
}

const used = new Set();
for (const f of ['content.js', 'popup.js', 'common.js', 'background.js']) {
  for (const [, key] of read(f).matchAll(/\bi18n\('([A-Za-z0-9_]+)'/g)) used.add(key);
  // endpointName() returns message keys that the callers pass to i18n().
  for (const [, key] of read(f).matchAll(/return '(ep[A-Za-z0-9_]+)'/g)) used.add(key);
}
for (const [, key] of read('popup.html').matchAll(/data-i18n="([A-Za-z0-9_]+)"/g)) used.add(key);
for (const [, key] of JSON.stringify(manifest).matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) used.add(key);
for (const key of used) assert.ok(base[key], `missing message: ${key}`);
for (const key of Object.keys(base)) assert.ok(used.has(key), `unused message: ${key}`);
console.log(`ok - ${used.size} keys used by the code, none missing or unused`);
