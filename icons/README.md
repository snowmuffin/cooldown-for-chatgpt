# Extension icon

The shipping icon follows the approved **teal speech bubble with three dots and
an overlapping clock badge** concept. It preserves the teal gradients, white rim,
dark outline, and clock placement without the previous flower-shaped knot.
**No third-party logo is included in the current icon assets.**

## Sources and exports

- `icon.svg`: native vector master for 48 and 128 pixel exports (and larger future
  outputs). The paths, circles, gradients, and clock hands are editable geometry.
- `icon-small.svg`: native vector variant for 16 and 32 pixel toolbar exports.
  The same bubble-and-clock silhouette is retained, with a larger clock face,
  heavier hands and outline, and no fine highlight on the clock rim.
- `icon16.png`, `icon32.png`, `icon48.png`, `icon128.png`: transparent RGBA PNGs
  used by the existing manifest.

Neither SVG embeds a PNG, a raster data URI, or an external image. The generated
concept sheet is a visual reference, not an export source: its labels, background,
glow, red variations, and square tiles are not bundled in the extension.

The static teal icon is used in the toolbar and extension manager. The existing
429 badge remains unchanged; no automatic icon switching or new permission has
been introduced. Extension behavior and version are unchanged.

Independent project. Not affiliated with or endorsed by OpenAI. Completing the
artwork does not mean that the extension or store listing has passed store review.

## Regenerate and validate

From the repository root, with Node.js and npm installed:

```sh
npm install --no-save --package-lock=false @resvg/resvg-js@2.6.2
node scripts/render-icons.cjs
node test/icons.test.js
```

The renderer reads output paths and sizes from `manifest.json`. It uses
`icon-small.svg` at sizes up to 32 pixels and `icon.svg` for larger sizes. Both
masters remain resolution-independent; larger outputs do not enlarge a 128 pixel
bitmap. The renderer is a build-only dependency, not code loaded by Chrome.
Exports use resvg-js 2.6.2 with system-font loading disabled.

After editing either source, regenerate all PNGs and inspect the 16/32 pixel
results at actual size on both light and dark backgrounds. The asset test checks
manifest targets, native-vector sources, PNG integrity, dimensions, and alpha.
