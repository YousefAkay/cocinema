import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const text = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('the service worker saves the logo the landing page shows, and the icons', () => {
  const worker = text('../src/sw.js');
  for (const file of ['./logo.svg', './favicon.ico', './favicon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png']) {
    assert.ok(worker.includes(`'${file}'`), `${file} is missing from the worker's list`);
  }
});

test('the landing page top bar shows the logo as an empty-alt image of about 28px', () => {
  const html = text('../src/index.html');
  assert.match(html, /<img src="logo\.svg" alt="" width="28" height="28">/);
});
