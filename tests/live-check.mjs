// Live end-to-end check: loads the real index.html in a real Chromium and
// lets it talk to the real MAL through a real proxy. Nothing is stubbed, so
// this answers "does the app work right now, and if not, which request broke?"
//
//   node tests/live-check.mjs <mal-username> [proxy] [goal]
//
//   node tests/live-check.mjs someuser https://my-worker.me.workers.dev/
//   node tests/live-check.mjs someuser ""        # built-in proxies only
//
// Needs Playwright:  npm i -g playwright && npx playwright install chromium
// Env:  CHROME_PATH  use this Chromium binary instead of Playwright's own
//       SETTLE_MS    extra wait after the list loads, for history (default 4000)
//       SCREENSHOT   where to save the screenshot (default live-check.png)
//
// Exit code 0 when today's count rendered as a number, 1 otherwise.
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const [username, proxy = '', goal = '3'] = process.argv.slice(2);
if (!username) {
  console.error('usage: node tests/live-check.mjs <mal-username> [proxy] [goal]');
  process.exit(2);
}

// createRequire so a globally installed Playwright (NODE_PATH) is found too.
const { chromium } = createRequire(import.meta.url)('playwright');

const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ['--no-sandbox'],
});
const page = await browser.newPage();

// Every request the app makes, and how it ended.
const requests = new Map();
const host = url => { try { return new URL(url).host; } catch (_) { return url; } };
const short = url => url.replace(origin, '').slice(0, 110);
page.on('request',        r => requests.set(r, { url: r.url(), outcome: 'pending' }));
page.on('response',       r => { const e = requests.get(r.request()); if (e) e.outcome = `HTTP ${r.status()}`; });
page.on('requestfailed',  r => { const e = requests.get(r); if (e) e.outcome = (r.failure() || {}).errorText || 'failed'; });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });

// A clean profile with just the settings under test — the same keys the app
// writes itself (see the LS_* constants in index.html).
await page.addInitScript(([u, p, g]) => {
  localStorage.setItem('mal_tracker_username', u);
  localStorage.setItem('mal_tracker_goal', g);
  localStorage.setItem('mal_tracker_offset', '0');
  localStorage.setItem('mal_tracker_proxy', p);
  localStorage.setItem('mal_schema_version', '4');
}, [username, proxy.trim(), goal]);

await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => !/fetching/.test(document.getElementById('last-updated').textContent),
  null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(Number(process.env.SETTLE_MS || 4000));

const status   = (await page.textContent('#last-updated')).trim();
const proxyUse = await page.inputValue('#proxy-input');
const today    = (await page.textContent('.metric-value').catch(() => '')).trim();
const banners  = await page.$$eval('#main-content .error-msg, #main-content .notice',
  els => els.map(e => `${e.className.includes('error') ? 'ERROR ' : 'notice'} ${e.innerText.replace(/\s+/g, ' ').slice(0, 300)}`));
const rendered = (await page.innerText('#main-content'))
  .split('\n').map(l => l.trim()).filter(Boolean);

const shot = process.env.SCREENSHOT || 'live-check.png';
await page.screenshot({ path: shot, fullPage: true });
await browser.close();
server.close();

console.log(`proxy entered : ${proxy.trim() || '(none)'}`);
console.log(`proxy used    : ${proxyUse || '(none)'}`);
console.log(`status line   : ${status}`);
console.log(`today         : ${today}`);

console.log('\nbanners:');
console.log(banners.length ? banners.map(b => `  ${b}`).join('\n') : '  (none)');

console.log('\nrequests:');
[...requests.values()]
  .filter(r => !r.url.startsWith(origin))
  .forEach(r => console.log(`  ${r.outcome.padEnd(28)} ${host(r.url).padEnd(46)} ${short(r.url)}`));

if (pageErrors.length)    { console.log('\npage errors:');    pageErrors.forEach(e => console.log(`  ${e}`)); }
if (consoleErrors.length) { console.log('\nconsole errors:'); consoleErrors.forEach(e => console.log(`  ${e}`)); }

console.log('\nrendered page:');
console.log(rendered.map(l => `  ${l}`).join('\n'));
console.log(`\nscreenshot: ${shot}`);

const ok = /^\d+$/.test(today) && !pageErrors.length;
console.log(ok ? '\nPASS — today rendered as a number' : '\nFAIL — today did not render as a number');
process.exit(ok ? 0 : 1);
