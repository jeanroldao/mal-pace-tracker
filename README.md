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

Everything the app needs comes from [Jikan](https://jikan.moe), an open API that reads public MyAnimeList profiles. It needs no key and sends CORS headers, so the browser can call it directly:

| What | Endpoint |
| --- | --- |
| Chapters read per day (the 7-day chart) | `/users/{username}/history/manga` |
| Lifetime chapter total (pace + anchor) | `/users/{username}/statistics` → `manga.chapters_read` |

Because it reads your **public** profile, your MAL list must be public for this to work.

### Optional: a MAL client ID

MAL's own API is the only source of *per-manga, up-to-the-second* chapter counts, so supplying a **Client ID** from [myanimelist.net/apiconfig](https://myanimelist.net/apiconfig) makes today's number update the instant you log a chapter, instead of waiting for Jikan's cache to roll over.

It is strictly an enhancement. It also requires a working CORS proxy (see below) — if either the key or the proxy is missing, the app says so once and carries on with Jikan.

> **Note:** All state (snapshots, settings, anchor) lives in your browser's `localStorage`. The only requests made are to Jikan, plus — if you supply a client ID — MAL via a CORS proxy.

## The CORS proxy (only for the optional MAL client ID)

MAL's API sends no CORS headers and requires an `X-MAL-CLIENT-ID` request header, so a browser can't call it directly — the request has to go through a proxy that forwards custom headers *and* answers the CORS preflight that a custom header triggers. Plenty of public proxies relay a plain GET but ignore `OPTIONS`, which fails as an unhelpful `Failed to fetch`.

None of this affects Jikan, which sends its own CORS headers — so **the app works with no proxy at all**. This section only matters if you want the real-time precision a client ID adds.

The app tries a list of public proxies in order, and names each one and its failure reason if they all fall over. Public proxies are unreliable by nature — they add API-key requirements, origin allowlists, or simply disappear. **The durable fix is to run your own**, which is free and takes about five minutes:

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
