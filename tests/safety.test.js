import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Film data (titles, plots, directors) must reach the page as text, never as HTML.
const sources = fs.readdirSync(new URL('../src/', import.meta.url)).filter(name => name.endsWith('.js'));

test('no source file builds HTML from data', () => {
  for (const name of sources) {
    const code = fs.readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
    const assignments = [...code.matchAll(/\.(innerHTML|outerHTML)\s*=\s*([^;\n]*)/g)];
    for (const [, property, value] of assignments) {
      assert.equal(value.trim(), "''", `${name}: ${property} is assigned something other than ''`);
    }
    assert.ok(!/insertAdjacentHTML|document\.write|createContextualFragment/.test(code), `${name}: inserts raw HTML`);
  }
});
