// Shared bits for the browser checks: a tiny static server on 127.0.0.1 and a pass/fail recorder.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vercelConfig = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
export const shots = path.join(root, 'screenshots');
fs.mkdirSync(shots, { recursive: true });

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

// Mirrors the parts of vercel.json that matter here: "/" redirects to "/src/", and the service
// worker file is never cached and may control the whole site. swVersion swaps the cache name
// inside sw.js so a test can pretend a new deploy went out. counts records how often each path
// was served.
export async function startServer() {
  const state = { swVersion: null, counts: new Map() };

  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    state.counts.set(urlPath, (state.counts.get(urlPath) || 0) + 1);

    const redirect = (vercelConfig.redirects || []).find(rule => rule.source === urlPath);
    if (redirect) {
      res.writeHead(308, { Location: redirect.destination }).end();
      return;
    }
    const rewrite = (vercelConfig.rewrites || []).find(rule => rule.source === urlPath);
    const servedPath = rewrite ? rewrite.destination : urlPath;
    const file = path.join(root, servedPath.endsWith('/') ? servedPath + 'index.html' : servedPath);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }

    const headers = { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' };
    if (servedPath === '/src/sw.js') {
      headers['Cache-Control'] = 'public, max-age=0, must-revalidate';
      headers['Service-Worker-Allowed'] = '/';
      let body = fs.readFileSync(file, 'utf8');
      if (state.swVersion) body = body.replace(/const CACHE_NAME = '[^']+';/, `const CACHE_NAME = '${state.swVersion}';`);
      res.writeHead(200, headers).end(body);
      return;
    }
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, base: `${origin}/src/`, state, close: () => server.close() };
}

export function createRecorder() {
  const results = [];
  return {
    results,
    check(name, ok, detail = '') {
      results.push({ name, ok });
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
    },
    summary() {
      const failed = results.filter(result => !result.ok).length;
      console.log(`\n${results.length - failed}/${results.length} checks passed.`);
      return failed;
    },
  };
}

// Picks a session length on the landing screen (nothing is chosen for the visitor) and starts.
export async function chooseAndStart(page, length = 15) {
  await page.locator(`.length-card:has(input[value="${length}"])`).click();
  await page.waitForSelector('#start-button:not([disabled])');
  await page.click('#start-button');
}
