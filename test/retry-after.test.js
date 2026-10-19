const assert = require('node:assert/strict');
const { parseRetryAfter } = require('../retry-after.js');

const now = Date.parse('2026-10-18T12:00:00Z');
const cases = [
  ['47', now + 47000],
  [' 0 ', now],
  ['2026', now + 2026000],
  ['Sun, 18 Oct 2026 12:01:30 GMT', now + 90000],
  [null, null],
  [undefined, null],
  ['abc', null],
  ['-5', null],
];

for (const [input, expected] of cases) {
  assert.equal(parseRetryAfter(input, now), expected, `parseRetryAfter(${JSON.stringify(input)})`);
}
console.log(`ok - ${cases.length} cases`);

// cooldownUntil: the later of Retry-After and ChatGPT's history retry header.
{
  const { cooldownUntil } = require('../retry-after.js');
  const now = 1_000_000;
  assert.equal(cooldownUntil('34', null, now), now + 34_000);
  assert.equal(cooldownUntil('34', '120', now), now + 120_000, 'history header later → it wins');
  assert.equal(cooldownUntil('90', '20', now), now + 90_000, 'Retry-After later → it wins');
  assert.equal(cooldownUntil(null, '45', now), now + 45_000, 'history header alone');
  assert.equal(cooldownUntil(null, null, now), null);
  assert.equal(cooldownUntil('soon', 'later', now), null, 'invalid values give no time');
  console.log('ok - cooldownUntil');
}
