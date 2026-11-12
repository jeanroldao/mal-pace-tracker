// Live end-to-end check: loads the real index.html in a real Chromium and
// lets it talk to the real MAL through a real proxy. Nothing is stubbed, so
// this answers "does the app work right now, and if not, which request broke?"
//
//   node tests/live-check.mjs <mal-username> [proxy] [goal]
//
//   node tests/live-check.mjs someuser https://my-worker.me.workers.dev/
//   node tests/live-check.mjs someuser ""        # built-in proxies only
//
// Settings fixed in the page's CONFIG block win over these arguments, exactly
// as they do for a real visitor; the output shows the values actually in use.
//
// Needs Playwright:  npm i -g playwright && npx playwright install chromium
// Env:  CHROME_PATH  use this Chromium binary instead of Playwright's own
//       SETTLE_MS    extra wait after the list loads, for history (default 4000)
//       SCREENSHOT   where to save the screenshot (default live-check.png)
//       REDACT=1     print <user> / <proxy> instead of the real values
//                    (on by default under GitHub Actions, where logs are public)
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

// Redaction happens here, on the full string and before any truncation: a
// log-level mask only matches the exact value, so a URL cut off mid-username
// slips straight past it.
const redact = process.env.REDACT ? process.env.REDACT !== '0' : process.env.GITHUB_ACTIONS === 'true';
const escapeRe = v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hidden = [];
const hide = (value, label) => { if (redact && value) hidden.push([value, label]); };
const hideProxy = p => {
  if (!p) return;
  hide(p, '<proxy>');
  const h = host(/^[a-z]+:\/\//i.test(p) ? p : `https://${p}`);
  if (h) { hide(`https://${h}`, '<proxy>'); hide(h, '<proxy>'); }
};
hideProxy(proxy.trim());
hide(username, '<user>');
const clean = text => hidden.reduce(
  (t, [value, label]) => t.replace(new RegExp(escapeRe(value), 'gi'), label), String(text));
page.on('request',        r => requests.set(r, { url: r.url(), outcome: 'pending' }));
page.on('response',       r => { const e = requests.get(r.request()); if (e) e.outcome = `HTTP ${r.status()}`; });
page.on('requestfailed',  r => { const e = requests.get(r); if (e) e.outcome = (r.failure() || {}).errorText || 'failed'; });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

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
// Ask the page itself, so values fixed in its CONFIG block are reported
// (and redacted) rather than the arguments they override.
const inUse    = await page.evaluate(() => ({ user: getUsername(), proxy: getProxy(), clientId: !!getClientId() }));
const proxyUse = inUse.proxy;
hideProxy(inUse.proxy.replace(/\{(url|raw)\}.*$/, ''));
hide(inUse.user, '<user>');
const today    = (await page.textContent('.metric-value').catch(() => '')).trim();
const banners  = await page.$$eval('#main-content .error-msg, #main-content .notice',
  els => els.map(e => [e.className.includes('error') ? 'ERROR ' : 'notice', e.innerText.replace(/\s+/g, ' ')]));
const rendered = (await page.innerText('#main-content'))
  .split('\n').map(l => l.trim()).filter(Boolean);

const shot = process.env.SCREENSHOT || 'live-check.png';
await page.screenshot({ path: shot, fullPage: true });
await browser.close();
server.close();

console.log(`proxy entered : ${clean(proxy.trim()) || '(none)'}`);
console.log(`proxy used    : ${clean(proxyUse) || '(none)'}`);
console.log(`username used : ${clean(inUse.user)}${inUse.user !== username ? '  (fixed by the page; argument ignored)' : ''}`);
console.log(`client ID     : ${inUse.clientId ? 'set' : 'none'}`);
console.log(`status line   : ${clean(status)}`);
console.log(`today         : ${today}`);

console.log('\nbanners:');
console.log(banners.length ? banners.map(([kind, text]) => `  ${kind} ${clean(text).slice(0, 300)}`).join('\n') : '  (none)');

console.log('\nrequests:');
[...requests.values()]
  .filter(r => !r.url.startsWith(origin))
  .forEach(r => console.log(`  ${r.outcome.padEnd(34)} ${clean(host(r.url)).padEnd(26)} ${clean(r.url).slice(0, 110)}`));

if (pageErrors.length)    { console.log('\npage errors:');    pageErrors.forEach(e => console.log(`  ${clean(e)}`)); }
if (consoleErrors.length) { console.log('\nconsole errors:'); consoleErrors.forEach(e => console.log(`  ${clean(e).slice(0, 200)}`)); }

console.log('\nrendered page:');
console.log(rendered.map(l => `  ${clean(l)}`).join('\n'));
console.log(`\nscreenshot: ${shot}`);

const ok = /^\d+$/.test(today) && !pageErrors.length;
console.log(ok ? '\nPASS — today rendered as a number' : '\nFAIL — today did not render as a number');
process.exit(ok ? 0 : 1);
