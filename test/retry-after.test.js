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
