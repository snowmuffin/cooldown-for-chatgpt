// Dependency-free checks for the checked-in icon assets. Does not require Chrome.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

for (const name of ['icon.svg', 'icon-small.svg']) {
  const svg = fs.readFileSync(path.join(root, 'icons', name), 'utf8');
  assert.match(svg, /viewBox="0 0 128 128"/, `${name}: expected square vector master`);
  assert.match(svg, /<path\s/, `${name}: native paths missing`);
  assert.match(svg, /<circle\s/, `${name}: native circles missing`);
  assert.doesNotMatch(svg, /<(?:image|script|foreignObject)\b|data:|base64/i, `${name}: not a self-contained native vector`);
  for (const [, href] of svg.matchAll(/(?:xlink:)?href="([^"]*)"/g)) {
    assert.ok(href.startsWith('#'), `${name}: external resource ${href}`);
  }
  console.log(`ok - native vector ${name}`);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function paeth(a, b, c) {
  const p = a + b - c;
  const da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
  return da <= db && da <= dc ? a : db <= dc ? b : c;
}
function checkPng(file, size) {
  const png = fs.readFileSync(file);
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(png.toString('ascii', 12, 16), 'IHDR');
  assert.equal(png.readUInt32BE(16), size);
  assert.equal(png.readUInt32BE(20), size);
  assert.deepEqual([...png.subarray(24, 29)], [8, 6, 0, 0, 0], 'Expected 8-bit non-interlaced RGBA');
  const chunks = [];
  let ended = false;
  for (let offset = 8; offset < png.length;) {
    assert.ok(offset + 12 <= png.length, 'Truncated chunk');
    const length = png.readUInt32BE(offset);
    const end = offset + 12 + length;
    assert.ok(end <= png.length, 'Truncated chunk data');
    const type = png.toString('ascii', offset + 4, offset + 8);
    assert.equal(crc32(png.subarray(offset + 4, end - 4)), png.readUInt32BE(end - 4), `${type}: invalid checksum`);
    if (type === 'IDAT') chunks.push(png.subarray(offset + 8, end - 4));
    if (type === 'IEND') { ended = true; assert.equal(end, png.length); }
    offset = end;
  }
  assert.ok(ended && chunks.length, 'Missing PNG image data or terminator');
  const stride = size * 4;
  const expectedBytes = size * (stride + 1);
  const raw = zlib.inflateSync(Buffer.concat(chunks), { maxOutputLength: expectedBytes });
  assert.equal(raw.length, expectedBytes);
  const pixels = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    const filter = raw[y * (stride + 1)];
    assert.ok(filter <= 4, 'Unsupported PNG filter');
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x;
      const a = x >= 4 ? pixels[i - 4] : 0;
      const b = y ? pixels[i - stride] : 0;
      const c = y && x >= 4 ? pixels[i - stride - 4] : 0;
      const predicted = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
      pixels[i] = (raw[y * (stride + 1) + 1 + x] + predicted) & 255;
    }
  }
  const alpha = [];
  for (let i = 3; i < pixels.length; i += 4) alpha.push(pixels[i]);
  assert.ok(alpha.some(a => a === 255), 'Icon is empty or translucent everywhere');
  assert.ok(alpha.some(a => a > 0 && a < 255), 'Expected antialiased edges');
  for (const i of [0, size - 1, size * (size - 1), size * size - 1]) {
    assert.equal(alpha[i], 0, 'Icon corners must be transparent');
  }
  console.log(`ok - PNG ${size}x${size}: CRC, RGBA, transparency (${png.length} bytes)`);
}
for (const size of [16, 32, 48, 128]) {
  const relative = `icons/icon${size}.png`;
  assert.equal(manifest.icons[String(size)], relative);
  if (size <= 32) assert.equal(manifest.action.default_icon[String(size)], relative);
  checkPng(path.join(root, relative), size);
}
console.log('ok - icons (2 vector sources, 4 PNGs, manifest references)');
