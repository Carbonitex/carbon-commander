#!/usr/bin/env node
/**
 * Draws the extension icons (src/icons/icon-{16,32,48,128}.png): a rounded purple square with a
 * command-prompt chevron and cursor. Dependency-free: shapes are signed-distance functions,
 * anti-aliased by supersampling, written as RGBA PNGs with node:zlib.
 *
 *   node scripts/icons.mjs        (re)generate the PNGs; commit the result
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'src', 'icons');
const SIZES = [16, 32, 48, 128];
const SAMPLES = 4; // per axis

// ---- shapes in a unit square (0..1), y down ------------------------------------------------

/** Distance to a rounded rectangle centred at (cx, cy) with half-size (hx, hy) and radius r. */
function roundedRect(x, y, cx, cy, hx, hy, r) {
  const qx = Math.abs(x - cx) - hx + r;
  const qy = Math.abs(y - cy) - hy + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Distance to a segment from (ax, ay) to (bx, by), minus half the stroke width. */
function segment(x, y, ax, ay, bx, by, halfWidth) {
  const px = x - ax;
  const py = y - ay;
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - dx * t, py - dy * t) - halfWidth;
}

const BG_TOP = [74, 36, 112]; // #4a2470
const BG_BOTTOM = [36, 18, 58]; // #24123a
const FG = [245, 240, 252];
const ACCENT = [196, 155, 255];

/** Colour (premultiplied-free RGBA, 0..255) at a point, for an icon `size` px wide. */
function shade(x, y, size) {
  // Thicker strokes at small sizes so the glyph stays legible.
  const stroke = size <= 16 ? 0.085 : size <= 32 ? 0.07 : 0.06;
  const bg = roundedRect(x, y, 0.5, 0.5, 0.47, 0.47, 0.2);
  if (bg > 0) return [0, 0, 0, 0];
  const t = y;
  let color = BG_TOP.map((c, i) => c + (BG_BOTTOM[i] - c) * t);
  const chevron = Math.min(
    segment(x, y, 0.26, 0.3, 0.48, 0.5, stroke),
    segment(x, y, 0.48, 0.5, 0.26, 0.7, stroke),
  );
  const cursor = roundedRect(x, y, 0.65, 0.68, 0.12, stroke * 0.9, stroke * 0.5);
  if (cursor <= 0) color = ACCENT;
  if (chevron <= 0) color = FG;
  return [...color, 255];
}

function render(size) {
  const pixels = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const [cr, cg, cb, ca] = shade((px + (sx + 0.5) / SAMPLES) / size, (py + (sy + 0.5) / SAMPLES) / size, size);
          r += cr * ca;
          g += cg * ca;
          b += cb * ca;
          a += ca;
        }
      }
      const i = (py * size + px) * 4;
      pixels[i] = a ? Math.round(r / a) : 0;
      pixels[i + 1] = a ? Math.round(g / a) : 0;
      pixels[i + 2] = a ? Math.round(b / a) : 0;
      pixels[i + 3] = Math.round(a / (SAMPLES * SAMPLES));
    }
  }
  return pixels;
}

// ---- PNG -------------------------------------------------------------------------------------

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

await mkdir(outDir, { recursive: true });
for (const size of SIZES) {
  const file = path.join(outDir, `icon-${size}.png`);
  await writeFile(file, png(size, render(size)));
  console.log(`wrote ${path.relative(root, file)}`);
}
