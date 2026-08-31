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
| Jikan `/users/{user}/statistics` | lifetime chapter total | nothing |

The public `load.json` endpoint leads, because it needs no key and no request headers — and therefore no CORS preflight, which is the thing that breaks most proxies. The official API is tried first only when you've set a custom proxy, since that's the case where it's likely to work; otherwise it's a fallback. Whichever source answers is named in the UI when it isn't the usual one.

Day-by-day numbers come from Jikan when it's up. When it isn't, they're reconstructed by diffing the daily snapshots the app stores locally on each refresh — which is why visiting daily keeps the chart complete.

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

The app tries its proxies in order and names each one and its failure reason if they all fall over. Public proxies are unreliable by nature — they add API-key requirements, origin allowlists, or simply disappear. **The durable fix is to run your own**, which is free and takes about five minutes:

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

3. Deploy, copy the worker URL, and paste `https://<your-worker>.workers.dev/?url=` into the app's **proxy** field. It's saved in `localStorage` and tried before the built-in list.

The proxy field also accepts templates: `{url}` is replaced with the percent-encoded target and `{raw}` with the target as-is. A bare prefix (like the one above) gets the encoded target appended.

> Your client ID is sent through whichever proxy is in use. It's a public-ish identifier rather than a secret — it grants read-only access to public list data and no account access — but running your own worker keeps it between you, Cloudflare, and MAL.

## Deploy

Any push to `main` triggers the GitHub Actions workflow at `.github/workflows/deploy-pages.yml`, which republishes the current `index.html` to GitHub Pages.
