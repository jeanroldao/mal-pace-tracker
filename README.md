# mal-pace-tracker

A single-page web app for tracking your manga reading pace against a daily chapter goal, using your [MyAnimeList](https://myanimelist.net/) (MAL) reading list.

🔗 **Live site:** https://jeanroldao.github.io/mal-pace-tracker/

## What it does

The tracker fetches your MAL "currently reading" list each time you hit **refresh**, saves a snapshot of your chapter counts in `localStorage`, and computes the difference between each day's snapshot to figure out how many chapters you read that day. It then compares that against your daily goal and shows:

- **Today** — chapters read today vs your goal
- **N-day total** — cumulative chapters over the days with data
- **Pace** — how many chapters ahead or behind goal you are overall
- **Avg/day** — average daily chapters across days with data
- **7-day bar chart** — one row per day showing chapter count, a progress bar, and the running cumulative delta vs goal
- **Today's reading** — a breakdown of which manga titles you read today and how many chapters each

## Setup & usage

1. **Get a MAL client ID** — register a free application at [myanimelist.net/apiconfig](https://myanimelist.net/apiconfig). Any name and redirect URL will do; copy the **Client ID** that is generated.
2. Open the [live site](https://jeanroldao.github.io/mal-pace-tracker/) (or your own deployment).
3. Paste your **Client ID** and **MAL username** into the fields at the top, and set your daily chapter **goal**.
4. Click **↻ refresh** — your settings are saved in `localStorage` so you only need to enter them once.
5. Come back each day and hit refresh to keep the history accurate. The tracker builds up its day-by-day picture from the snapshots it has collected, so the more consistently you visit, the more complete the data will be.

> **Note:** All data (snapshots, titles, settings) is stored locally in your browser. Nothing is sent to any server other than the MAL API (via a CORS proxy, see below) and Jikan.

## The CORS proxy

MAL's API sends no CORS headers and requires an `X-MAL-CLIENT-ID` request header, so a browser can't call it directly — the request has to go through a proxy that forwards custom headers and answers the CORS preflight they trigger.

The app ships with a list of public proxies and tries them in order, so one going down no longer takes the app with it. If a request genuinely fails, the error names every proxy it tried and why.

Public proxies are unreliable by nature — they add API-key requirements, origin allowlists, or simply disappear. **The durable fix is to run your own**, which is free and takes about five minutes:

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
