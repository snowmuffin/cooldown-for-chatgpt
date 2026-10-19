#!/usr/bin/env node
// Build-time only. The extension loads the checked-in PNGs, not this renderer.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

function main() {
  let Resvg;
  try {
    ({ Resvg } = require('@resvg/resvg-js'));
  } catch {
    throw new Error('Install the build-only renderer: npm install --no-save --package-lock=false @resvg/resvg-js@2.6.2');
  }
  const root = path.resolve(__dirname, '..');
  const iconDir = path.join(root, 'icons');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const svg = fs.readFileSync(path.join(iconDir, 'icon.svg'));
  const smallSvg = fs.readFileSync(path.join(iconDir, 'icon-small.svg'));
  const targets = new Map();
  for (const mapping of [manifest.icons, manifest.action.default_icon]) {
    for (const [sizeText, relative] of Object.entries(mapping)) {
      const size = Number(sizeText);
      const target = path.resolve(root, relative);
      const inside = path.relative(iconDir, target);
      if (!Number.isInteger(size) || size < 1 || size > 1024 ||
          inside.startsWith('..') || path.isAbsolute(inside) || path.extname(target) !== '.png') {
        throw new Error(`Invalid icon target: ${sizeText} ${relative}`);
      }
      if (targets.has(target) && targets.get(target) !== size) throw new Error(`Conflicting icon size: ${relative}`);
      targets.set(target, size);
    }
  }
  // Finish all renders before replacing any checked-in files.
  const outputs = [...targets].sort((a, b) => a[1] - b[1]).map(([target, size]) => {
    // A larger clock face and heavier hands keep the toolbar sizes legible.
    const source = size <= 32 ? smallSvg : svg;
    const image = new Resvg(source, { fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: false } }).render();
    const png = image.asPng();
    if (png.readUInt32BE(16) !== size || png.readUInt32BE(20) !== size) throw new Error(`Wrong PNG dimensions: ${target}`);
    return [target, png];
  });
  for (const [target, png] of outputs) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.tmp`;
    fs.writeFileSync(temporary, png);
    fs.renameSync(temporary, target);
    console.log(`Rendered ${path.relative(root, target)} (${png.length} bytes)`);
  }
}

try { main(); } catch (error) {
  console.error(`Icon rendering failed: ${error.message}`);
  process.exitCode = 1;
}
