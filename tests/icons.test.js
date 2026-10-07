import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildIco, readIco } from '../scripts/ico.js';

const read = path => fs.readFileSync(new URL(path, import.meta.url));
const text = path => read(path).toString('utf8');
const pngSize = buffer => [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];

// A tiny valid PNG signature plus an IHDR chunk, enough for header checks.
function fakePng(size) {
  const png = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
  png.writeUInt32BE(13, 8);
  png.write('IHDR', 12);
  png.writeUInt32BE(size, 16);
  png.writeUInt32BE(size, 20);
  return png;
}

test('buildIco writes a header, one entry per size, and the images', () => {
  const ico = buildIco([16, 32, 48].map(size => ({ size, png: fakePng(size) })));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 3);
  const entries = readIco(ico);
  assert.deepEqual(entries.map(entry => [entry.width, entry.height]), [[16, 16], [32, 32], [48, 48]]);
  entries.forEach((entry, index) => assert.deepEqual(pngSize(entry.png), [[16, 16], [32, 32], [48, 48]][index]));
});

test('buildIco rejects empty input and impossible sizes, and stores 256 as 0', () => {
  assert.throws(() => buildIco([]));
  assert.throws(() => buildIco([{ size: 0, png: fakePng(1) }]));
  assert.throws(() => buildIco([{ size: 300, png: fakePng(1) }]));
  const big = buildIco([{ size: 256, png: fakePng(256) }]);
  assert.equal(big.readUInt8(6), 0);
  assert.equal(readIco(big)[0].width, 256);
});

test('readIco refuses a file that is not an icon', () => {
  assert.throws(() => readIco(Buffer.from('not an icon at all!!')));
});

test('the committed favicon.ico is a real 16, 32 and 48 pixel icon with PNG images inside', () => {
  const entries = readIco(read('../src/favicon.ico'));
  assert.deepEqual(entries.map(entry => entry.width), [16, 32, 48]);
  for (const entry of entries) {
    assert.deepEqual(pngSize(entry.png), [entry.width, entry.height]);
  }
});

test('logo.svg follows the design: violet rounded square, two outlined circles, a lens and a play triangle', () => {
  const svg = text('../src/logo.svg');
  assert.match(svg, /viewBox="0 0 64 64"/);
  assert.match(svg, /<rect width="64" height="64" rx="16" fill="#7C3AED"\/>/);
  assert.match(svg, /<circle cx="26" cy="32" r="14" fill="none" stroke="#F2EFFA" stroke-width="3\.5"\/>/);
  assert.match(svg, /<circle cx="38" cy="32" r="14" fill="none" stroke="#F2EFFA" stroke-width="3\.5"\/>/);
  assert.match(svg, /<path d="M32 19\.35 A14 14 0 0 1 32 44\.65 A14 14 0 0 1 32 19\.35 Z" fill="#F2EFFA"\/>/);
  assert.match(svg, /<polygon points="29\.5,27\.5 29\.5,36\.5 36\.5,32" fill="#7C3AED"\/>/);
});

test('the lens corners are where the two circles really cross', () => {
  // Circles of radius 14 centred 12 apart cross on the line x = 32, at 32 +/- sqrt(14^2 - 6^2).
  const offset = Math.sqrt(14 ** 2 - 6 ** 2);
  assert.ok(Math.abs(32 - offset - 19.35) < 0.005);
  assert.ok(Math.abs(32 + offset - 44.65) < 0.005);
  // Both points lie on both circles.
  for (const y of [19.35, 44.65]) {
    for (const cx of [26, 38]) {
      assert.ok(Math.abs(Math.hypot(32 - cx, y - 32) - 14) < 0.01);
    }
  }
});

test('the play triangle sits inside the lens', () => {
  const inLens = (x, y) => Math.hypot(x - 26, y - 32) <= 14 && Math.hypot(x - 38, y - 32) <= 14;
  for (const [x, y] of [[29.5, 27.5], [29.5, 36.5], [36.5, 32]]) {
    assert.ok(inLens(x, y), `${x},${y}`);
  }
});

test('the maskable variant fills the whole square and keeps the mark in the central 60%', () => {
  const svg = text('../src/logo-maskable.svg');
  assert.match(svg, /<rect width="64" height="64" fill="#7C3AED"\/>/);
  assert.ok(!/rx=/.test(svg.split('<g')[0]), 'the maskable background must not be rounded');
  const scale = Number(/scale\(([\d.]+)\)/.exec(svg)[1]);
  const markWidth = (38 + 14 + 1.75) - (26 - 14 - 1.75); // outer edge to outer edge, including the stroke
  const share = (markWidth * scale) / 64;
  assert.ok(share >= 0.55 && share <= 0.65, `the mark spans ${(share * 100).toFixed(1)}% of the icon`);
});

test('the favicon is the logo, and every generated icon exists at its stated size', () => {
  assert.equal(text('../src/favicon.svg'), text('../src/logo.svg'));
  const sizes = { 'icon-192.png': 192, 'icon-512.png': 512, 'icon-maskable-512.png': 512, 'apple-touch-icon.png': 180 };
  for (const [file, size] of Object.entries(sizes)) {
    assert.deepEqual(pngSize(read(`../src/icons/${file}`)), [size, size], file);
  }
  assert.deepEqual(pngSize(read('../src/og-image.png')), [1200, 630]);
});

test('the manifest lists the 192, 512 and maskable icons with the right purposes', () => {
  const manifest = JSON.parse(text('../src/manifest.webmanifest'));
  const byFile = Object.fromEntries(manifest.icons.map(icon => [icon.src, icon]));
  assert.equal(byFile['icons/icon-192.png'].purpose, 'any');
  assert.equal(byFile['icons/icon-192.png'].sizes, '192x192');
  assert.equal(byFile['icons/icon-512.png'].purpose, 'any');
  assert.equal(byFile['icons/icon-maskable-512.png'].purpose, 'maskable');
  assert.equal(manifest.icons.length, 3);
});
