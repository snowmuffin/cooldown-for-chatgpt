#!/usr/bin/env node
// Builds dist/cooldown-for-chatgpt-<version>.zip for the Chrome Web Store.
// The file list is derived from what the extension actually loads, so notes, tests,
// scripts and icon sources never end up in the package. No dependencies.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

function collectFiles() {
  const manifest = JSON.parse(read('manifest.json'));
  const files = new Set(['manifest.json']);
  const sw = manifest.background.service_worker;
  files.add(sw);
  for (const [, list] of read(sw).matchAll(/importScripts\(([^)]*)\)/g)) {
    for (const [, f] of list.matchAll(/'([^']+)'/g)) files.add(f);
  }
  for (const cs of manifest.content_scripts) for (const f of [...(cs.js || []), ...(cs.css || [])]) files.add(f);
  const popup = manifest.action.default_popup;
  files.add(popup);
  for (const [, f] of read(popup).matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)) files.add(f);
  for (const f of [...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)]) files.add(f);
  for (const locale of fs.readdirSync(path.join(root, '_locales'))) files.add(`_locales/${locale}/messages.json`);
  for (const f of files) {
    if (path.isAbsolute(f) || f.split('/').includes('..') || !fs.statSync(path.join(root, f)).isFile()) {
      throw new Error(`Missing or invalid file: ${f}`);
    }
  }
  return { version: manifest.version, files: [...files].sort() };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Minimal ZIP writer (deflate, no extra fields). A fixed timestamp keeps builds reproducible.
function zip(entries) {
  const DOS_TIME = 0, DOS_DATE = (1 << 5) | 1; // 1980-01-01 00:00
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, deflated);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + deflated.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

function main() {
  const { version, files } = collectFiles();
  const out = path.join(root, 'dist', `cooldown-for-chatgpt-${version}.zip`);
  const archive = zip(files.map(name => ({ name, data: fs.readFileSync(path.join(root, name)) })));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, archive);
  for (const f of files) console.log(`  ${f}`);
  console.log(`Wrote ${path.relative(root, out)} (${files.length} files, ${archive.length} bytes)`);
}

try { main(); } catch (error) {
  console.error(`Packaging failed: ${error.message}`);
  process.exitCode = 1;
}
