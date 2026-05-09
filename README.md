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

> **Note:** All data (snapshots, titles, settings) is stored locally in your browser. Nothing is sent to any server other than the MAL API (via [corsproxy.io](https://corsproxy.io) for CORS).

## Deploy

Any push to `main` triggers the GitHub Actions workflow at `.github/workflows/deploy-pages.yml`, which republishes the current `index.html` to GitHub Pages.
