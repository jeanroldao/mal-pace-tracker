# mal-pace-tracker

A single-page web app for tracking your manga reading pace against a daily chapter goal, using your [MyAnimeList](https://myanimelist.net/) (MAL) reading list.

🔗 **Live site:** https://jeanroldao.github.io/mal-pace-tracker/

## What it does

On each **refresh** the tracker reads your public MAL reading history, and compares it against your daily goal to show:

- **Today** — chapters read today vs your goal
- **N-day total** — cumulative chapters over the days with data
- **Pace** — how many chapters ahead or behind goal you are overall
- **Avg/day** — average daily chapters across days with data
- **7-day bar chart** — one row per day showing chapter count, a progress bar, and the running cumulative delta vs goal
- **Today's reading** — a breakdown of which manga titles you read today and how many chapters each

## Setup & usage

1. Open the [live site](https://jeanroldao.github.io/mal-pace-tracker/) (or your own deployment).
2. Type your **MAL username** and set your daily chapter **goal**. That's the whole setup.
3. Click **↻ refresh** — your settings are saved in `localStorage` so you only need to enter them once.

### Where the data comes from

The app reads from several sources and uses whichever answers, so no single outage takes it down.

| Source | Gives | Needs |
| --- | --- | --- |
| **`myanimelist.net/mangalist/{user}/load.json`** | per-manga chapter counts — the endpoint MAL's own list page uses | a proxy, but **no key and no headers** |
| MAL official API | the same, plus per-manga `updated_at` | a client ID **and** a header-forwarding proxy |
| Jikan `/users/{user}/history/manga` | which chapters were read on which day | nothing |
| `myanimelist.net/history/{user}/manga` | the same, parsed from the page itself — live, with exact timestamps | a proxy, but **no key and no headers** |
| Jikan `/users/{user}/statistics` | lifetime chapter total | nothing |
| [jikan-edge](https://github.com/LucasHenriqueDiniz/jikan-edge) `/v1/users/{user}/mangalist` | per-manga chapter counts with no proxy — a cached copy, and with no usable `updatedAt` | nothing |
| jikan-edge `/v1/users/{user}/statistics` | lifetime chapter total, when Jikan is down | nothing |

The public `load.json` endpoint leads, because it needs no key and no request headers — and therefore no CORS preflight, which is the thing that breaks most proxies. The official API is tried first only when you've set a custom proxy, since that's the case where it's likely to work; otherwise it's a fallback. Whichever source answers is named in the UI when it isn't the usual one.

Day-by-day numbers come from a history source when one is reachable: MAL's own history page parsed in the browser, then Jikan. Only if both fail are they reconstructed by diffing the daily snapshots stored locally on each refresh.

Jikan is last on purpose. It has been failing on every endpoint since 2026-08-28 (`504` at first, unreachable as of 2026-11-12), and it serves a cached copy even when healthy, so leading with it cost a wasted round trip per refresh and gave staler answers than MAL's own page.

That ordering matters for accuracy, not just availability. A snapshot diff can only say "this changed between two refreshes", so chapters read last night and first seen by this morning's refresh get attributed to *this morning*. A history source timestamps each read, so it puts them on the night they happened. MAL's page is live (Jikan's copy is cached), so when it is the source it takes precedence even for today.

**On jikan-edge:** an independent reimplementation reading the same public MAL pages, suggested on [jikan-rest#612](https://github.com/jikan-me/jikan-rest/issues/612) during the August 2026 outage. Two properties make it the most useful fallback here: it needs **no proxy** (it sends CORS headers), so it still works when MAL refuses the public proxies' datacenter IPs; and when its own upstream fetch fails it answers `200` with `stale: true` from cache rather than `504`.

It cannot serve `/users/{user}/history` — that's on its documented list of routes it can't do — so the 7-day chart still falls back to snapshot diffs. Its `mangalist` route has an `updatedAt` field, but a live check on 2026-11-12 found it empty on every entry, so this path gives no help with day attribution. It is also a cached copy: with only jikan-edge reachable, today's count stays blank until two refreshes on different days give the snapshots something to diff. In practice it keeps the totals alive; it does not replace a working proxy.

The two APIs disagree about shape — `{ data, meta }` vs `{ data, pagination }`, camelCase vs snake_case — so responses are read through parsers that accept either dialect and return nothing, rather than a misleading `0`, when they recognise neither.

Your MAL list must be **public**, since every one of these reads your public profile.

### Optional: a MAL client ID

MAL's own API is the only source of *per-manga, up-to-the-second* chapter counts, so supplying a **Client ID** from [myanimelist.net/apiconfig](https://myanimelist.net/apiconfig) makes today's number update the instant you log a chapter, instead of waiting for Jikan's cache to roll over.

It is strictly an enhancement. It also requires a working CORS proxy (see below) — if either the key or the proxy is missing, the app says so once and carries on with Jikan.

> **Note:** All state (snapshots, settings, anchor) lives in your browser's `localStorage`. The only requests made are to Jikan, plus — if you supply a client ID — MAL via a CORS proxy.

## The CORS proxy (only for the optional MAL client ID)

Nothing on `myanimelist.net` sends CORS headers, so a browser can't read it without a relay. There are two tiers, and the difference matters:

- **Plain GETs** (the public list JSON) need only a pass-through proxy. Most public proxies handle this, so the app keeps two lists and uses the wider one here.
- **The official API** additionally requires an `X-MAL-CLIENT-ID` header, and any custom header makes the browser send a CORS **preflight** first. Many proxies relay a GET but ignore `OPTIONS`, which surfaces as an unhelpful `Failed to fetch` — this is exactly why every proxy appeared to fail at once.

Jikan needs no proxy at all, since it sends its own CORS headers.

The app **races** its proxies rather than trying them one at a time, and aborts the losers as soon as one answers. Walking them meant paying each dead proxy's timeout end to end — two hanging for 8s apiece put 16s in front of a page that was never going to load. A proxy that has already worked gets a solo attempt first, so the steady state is a single request. If they all fall over, the error names each one and its reason. Public proxies are unreliable by nature — they add API-key requirements, origin allowlists, or simply disappear. **The durable fix is to run your own**, which is free and takes about five minutes:

1. Sign in at [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create Worker**.
2. Replace the worker code with:

   ```js
   export default {
     async fetch(request) {
       const target = new URL(request.url).searchParams.get('url');
       if (!target) return new Response('missing ?url=', { status: 400 });

       // Preflight: the X-MAL-CLIENT-ID header makes browsers send OPTIONS first.
       if (request.method === 'OPTIONS') {
         return new Response(null, {
           headers: {
             'Access-Control-Allow-Origin': '*',
             'Access-Control-Allow-Headers': '*',
             'Access-Control-Allow-Methods': 'GET,OPTIONS',
             'Access-Control-Max-Age': '86400',
           },
         });
       }

       const upstream = await fetch(target, {
         headers: { 'X-MAL-CLIENT-ID': request.headers.get('X-MAL-CLIENT-ID') || '' },
       });
       const res = new Response(upstream.body, upstream);
       res.headers.set('Access-Control-Allow-Origin', '*');
       return res;
     },
   };
   ```

3. Deploy, copy the worker URL, and paste it into the app's **proxy** field. A bare `https://<your-worker>.workers.dev/` is completed to `…/?url={url}` automatically. It's saved in `localStorage` and raced alongside the built-in list.

The proxy field also accepts templates: `{url}` is replaced with the percent-encoded target and `{raw}` with the target as-is. A bare prefix (like the one above) gets the encoded target appended.

> Your client ID is sent through whichever proxy is in use. It's a public-ish identifier rather than a secret — it grants read-only access to public list data and no account access — but running your own worker keeps it between you, Cloudflare, and MAL.

## Debugging: the live check

When the app misbehaves, `tests/live-check.mjs` shows why. It loads the real `index.html` in a real Chromium, lets it call the real MAL through the proxy you give it, and prints the proxy string actually used, every banner, every request with its outcome, and the rendered page. Nothing is stubbed.

```sh
npm i -g playwright && npx playwright install chromium   # once
node tests/live-check.mjs <mal-username> [proxy] [goal]

node tests/live-check.mjs someuser https://my-worker.me.workers.dev/
node tests/live-check.mjs someuser ""    # built-in proxies only
```

It exits `0` when today's count rendered as a number and `1` otherwise, and saves a screenshot to `live-check.png`. It runs from a terminal — GitHub Pages only serves `index.html`, so the script is not part of the published site.

### Running it from GitHub

The same check runs with nothing installed: **Actions → Live check → Run workflow**. Set it up once under **Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `MAL_USERNAME` | your MAL username |
| `MAL_PROXY` | your proxy, e.g. `https://<your-worker>.workers.dev/` (optional) |

Both are masked in the run log, and either can be overridden for one run from the form (`none` as the proxy tests the built-in proxies only). The log still lists the manga titles on the rendered page. The screenshot is uploaded only if you tick the box, because it shows your username and the start of your proxy address — and on a public repository, logs and artifacts are visible to others.

## Deploy

Any push to `main` triggers the GitHub Actions workflow at `.github/workflows/deploy-pages.yml`, which republishes the current `index.html` to GitHub Pages.
