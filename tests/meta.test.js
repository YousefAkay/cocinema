import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = new URL('../src/', import.meta.url);
const html = fs.readFileSync(new URL('index.html', src), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.webmanifest', src), 'utf8'));

const meta = (attribute, name) => {
  const match = new RegExp(`<meta ${attribute}="${name}" content="([^"]*)"`).exec(html);
  return match ? match[1] : null;
};

// Width and height from a PNG file's header.
function pngSize(relativePath) {
  const bytes = fs.readFileSync(new URL(relativePath, src));
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG', `${relativePath} is not a PNG`);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

test('the page has a description, theme colour, canonical URL and icons', () => {
  assert.ok(meta('name', 'description').length > 40);
  assert.equal(meta('name', 'theme-color'), '#7c3aed');
  assert.match(html, /<link rel="canonical" href="https:\/\/cocinema-pi\.vercel\.app\/">/);
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon\.png" sizes="180x180">/);
  assert.match(html, /<link rel="icon" href="favicon\.svg" type="image\/svg\+xml" sizes="any">/);
  assert.match(html, /<link rel="icon" href="favicon\.ico" type="image\/x-icon" sizes="16x16 32x32 48x48">/);
  assert.match(html, /<link rel="icon" href="\/favicon\.ico">/);
});

test('Open Graph and Twitter tags are complete and the image is an absolute URL that exists', () => {
  for (const name of ['og:title', 'og:description', 'og:url', 'og:image', 'og:image:alt']) {
    assert.ok(meta('property', name), name);
  }
  assert.equal(meta('property', 'og:url'), 'https://cocinema-pi.vercel.app/');
  const image = meta('property', 'og:image');
  assert.match(image, /^https:\/\/cocinema-pi\.vercel\.app\/src\/og-image\.png$/);
  assert.deepEqual(pngSize('og-image.png'), [1200, 630]);
  assert.equal(meta('property', 'og:image:width'), '1200');
  assert.equal(meta('property', 'og:image:height'), '630');
  assert.equal(meta('name', 'twitter:card'), 'summary_large_image');
  assert.equal(meta('name', 'twitter:image'), image);
});

test('the link-preview wording makes no claim the app cannot keep', () => {
  const text = [meta('name', 'description'), meta('property', 'og:description'), meta('name', 'twitter:description')].join(' ').toLowerCase();
  assert.ok(!/no tracking|anonymous|private by design|analytics|tracker/.test(text));
  assert.ok(text.includes('no account'));
});

test('the manifest names the app and points at real icons of the stated sizes', () => {
  assert.equal(manifest.name, 'CoCinema');
  assert.equal(manifest.short_name, 'CoCinema');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.background_color, '#0b0a12');
  assert.equal(manifest.theme_color, '#7c3aed');
  assert.ok(fs.existsSync(new URL(manifest.start_url, src)) || manifest.start_url === './');
  assert.ok(manifest.icons.some(icon => icon.purpose === 'maskable'));
  for (const icon of manifest.icons) {
    const [width, height] = pngSize(icon.src);
    assert.equal(`${width}x${height}`, icon.sizes, icon.src);
  }
  assert.deepEqual(pngSize('icons/apple-touch-icon.png'), [180, 180]);
});

test('the service worker precaches every module the app imports', () => {
  const worker = fs.readFileSync(new URL('sw.js', src), 'utf8');
  const modules = fs.readdirSync(src).filter(name => name.endsWith('.js') && name !== 'sw.js');
  for (const name of modules) {
    assert.ok(worker.includes(`'./${name}'`), `${name} is missing from the worker's list`);
  }
});
