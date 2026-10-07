import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const text = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('vercel.json keeps the redirect and the worker headers and serves favicon.ico from the root', () => {
  const config = JSON.parse(text('../vercel.json'));
  assert.deepEqual(config.redirects, [{ source: '/', destination: '/src/' }]);
  const worker = config.headers.find(rule => rule.source === '/src/sw.js');
  const headers = Object.fromEntries(worker.headers.map(header => [header.key, header.value]));
  assert.equal(headers['Service-Worker-Allowed'], '/');
  assert.match(headers['Cache-Control'], /max-age=0/);
  assert.deepEqual(config.rewrites, [{ source: '/favicon.ico', destination: '/src/favicon.ico' }]);
});
