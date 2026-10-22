# CoCinema: the details

The README keeps things short. This is everything else: how each feature behaves, how the data is built and checked, the streaming refresh rules, offline caching and the project layout.

## Features in full

- **General or one genre.** The landing first asks whether you want films from every genre or just one. Pick a genre offers every catalog genre with enough films (at least 35, largest first); you rate only well-known films from that genre and get back only films from it, ranked by the same maths and filtered afterwards. "Rate 5 more" stays in the genre. Watching with a friend is General only.
- **Taster, Quick or Full.** Nothing is pre-selected. Taster asks about 5 films (5 of the 15 genres), Quick about 10, and Full covers all 15 genres; the shorter sessions take a different set of genres each time. Choosing Taster says plainly that its picks are rougher and that at least 3 films rated with different scores are needed. Skip any film you have not seen, or go Back to change an answer. The order of genres and films is shuffled per session from a saved seed, so a refresh resumes on the same film. Each film shows its poster, year, runtime, Rotten Tomatoes score and genres next to the scores.
- **Picks with reasons.** The top 5 each carry a short line naming the films you rated that drove the pick and the score you gave them ("Your 9 for X did most of the work here, with a nudge from Y (8)."), plus, on at most two cards, the one film that held the pick back when that pull is large. The wording is chosen from the film's id, so a list always reads the same way and no two top cards open or end alike. The line is never cut short: with long film names the card grows to fit. Every card also shows its year, runtime, Rotten Tomatoes score and genres. The rest follow in a compact grid. "Rate 5 more" adds five well-known unrated films, at most two per genre. If a session ends with too few ratings to rank (under 3, or all the same score), the results say so and offer "Rate 5 more" first, with Start over second.
- **Where a film sits for you.** Top picks show a rank; other films show "Top N% for your taste", its place among the films you have not rated. It ranks films against each other and is not the chance you will like one.
- **Film pages.** Poster, genres, runtime, director, age rating, Rotten Tomatoes score, the full plot, a breakdown of how each film you rated pushed this one up or down, a YouTube trailer search, and which services carry it (subscription, rent or buy) in Canada, the US and the UK, with JustWatch search links (searches, not a guarantee of availability).
- **Watch with a friend.** A banner at the top of the results has the invite button (it copies the link, or opens the share sheet where there is one) and a "Try a sample friend" control with three made-up friends (horror, romance, sci-fi). Your friend rates their own films and you both get one list.
- **Home, Back and Start over never lose your ratings by accident.** The logo and a Home button go home; with at least one rating (and for the browser Back button) a dialog asks "Leave and keep your ratings?". "Start over" asks before it clears anything.
- **Fresh visits and refreshes.** A refresh, or a reload in the same tab, resumes exactly where you were. A fresh visit (new tab or window, or opening the installed app) always shows the landing page; if a session is saved, Continue offers it ("Continue (n of N)" mid-onboarding, "See your last picks" once finished). A per-tab marker in sessionStorage tells the two apart; where storage is blocked, every load counts as a fresh visit. Direct film-page and co-watch links open as normal. Nothing saved is deleted.
- **Installable and offline.** After one visit the app works with no connection (posters excepted) and can be added to the home screen. The screens are checked with an automated accessibility scan (axe).

## The maths, step by step

1. **Mean-centre your ratings.** Each rating becomes a weight: how far it sits above or below *your own* average. A 7 from a harsh rater counts as a like; a 7 from someone who rates everything 9 counts as a dislike.
2. **Build a taste profile.** Multiply each rated film's embedding by its weight and add them up. Films you loved pull the profile toward them; films you disliked push it away.
3. **Rank by cosine similarity.** Compare the profile with every unrated film. Cosine similarity measures the *angle* between two vectors, so it captures what a story is about regardless of plot length.

## Watch with a friend: ratings in the link

Your ratings are written into the link itself, after `#/with/`, as a short encoded string (format version 1: each film's Wikidata number in base 36 plus one digit for the score, then base64-url encoded). The part after `#` is never sent to a server, so nothing is stored anywhere; anyone who has the link can read the ratings, and the app says so. A link holds at most 120 films, and bad or unknown links get a plain message.

When your friend rates their own films, each person's score for every film neither has rated is turned into a rank among those same films. A film is **only as good as its weaker fit**: films are ordered by the worse of the two ranks, then by the average, then by title and id so the order is stable. Your friend's ratings are only read for this list; they are never added to your own profile.

## Data quality and verification

- **Discovery:** the best-known films per genre from Wikidata, ranked by how many Wikipedia language editions cover them.
- **Enrichment:** plot, poster, runtime, director, age rating and Rotten Tomatoes score from OMDb. A title guard rejects wrong matches (for example a "Making of..." featurette).
- **Title, year and plot checks:** `scripts/verifyCatalog.js` checks every entry against OMDb. The normalised title must match and OMDb's year must be within one year of Wikidata's. The stored plot is then compared with OMDb's by shared-word overlap. Clearly different plots mean the entry holds another film's content, and `scripts/repairCatalog.js` replaces its plot, poster, metadata and embedding. A test asserts that every entry is verified or a repaired mismatch.
- **Director and runtime cross-check:** `scripts/crossCheckWikidata.js` compares each entry's director (by family name) and runtime (within 20 minutes) with Wikidata, as an independent check on remakes that share a title.
- **Overrides:** `data/overrides.json` lists the documented exceptions, each with a note: a title OMDb spells differently (`omdbTitle`), a disagreeing year (`omdbYear`), a tracked genre Wikidata leaves off (`addGenres`), or a Rotten Tomatoes score OMDb took from another film (`clearScore`, applied by `mergeMeta.js`; Guillermo del Toro's Pinocchio was given the Zemeckis film's 27%).
- **Extra films:** `data/extra-films.json` lists films the genre queries do not reach (Wikidata id, title, year), currently ten stop-motion features. `node scripts/buildCatalog.js --extras-only` enriches and embeds only the ones not yet in the catalog; then run `fetchMeta.js`, `mergeMeta.js`, `backfill.js` and `verifyCatalog.js` as usual.
- **Tests on the data:** no two films share a plot, every film has a poster, plot, year and 512-number embedding, and the streaming snapshot holds exactly the films in the catalog.
- **Embeddings:** reduced to 512 dimensions and rounded to 4 decimals, about 5 KB per film instead of 30 KB.
- **Resilience:** the build is resumable and stops cleanly at OMDb's daily limit. No IMDb ids are stored.

### Catalog schema

Each entry in `data/catalog.json`:

| Field | Type | Source |
| --- | --- | --- |
| `id` | string (Wikidata entity URL) | Wikidata |
| `title` | string | OMDb |
| `plot` | string | OMDb |
| `poster` | string or null | OMDb |
| `embedding` | number[512] | OpenAI |
| `rottenTomatoes` | string (e.g. `"87%"`) or null | OMDb |
| `runtime` | string (e.g. `"142 min"`) or null | OMDb |
| `director` | string or null | OMDb |
| `rated` | string (e.g. `"R"`) or null | OMDb |
| `genres` | string[] (from the 20 tracked genres) | Wikidata |
| `sitelinks` | number (Wikipedia language editions) | Wikidata |
| `year` | number (earliest release year) | Wikidata |

### Onboarding pools

`data/onboarding.json` holds 15 genre pools of up to 8 films: comedy, horror, sci-fi, drama, action, thriller, romance, animation, adventure, fantasy, crime, war, biographical, mystery and musical (westerns stay in the catalog but are not asked about). `node scripts/buildOnboarding.js` tops each pool up with the best-known verified catalog films that have a poster, plot, year and embedding and a title that appears only once. Rerun it after catalog changes.

## Streaming availability (Watchmode)

`node scripts/watchmode.js` looks up where each film can be watched in Canada, the US and the UK and writes service names to `data/availability.json`. It is resumable and stops at a credit cap (`--max-credits`, default 2000). The film page loads the file only when a film is opened; if it is missing, has no entry, or is more than 30 days old, the page shows only the JustWatch search links.

This is a snapshot, not live data. Under Watchmode's free plan the cached data must be **refreshed or deleted within 30 days** of the fetch date. The current snapshot was fetched on **22 October 2026**, so refresh or delete it by **21 November 2026**. To refresh, delete `data/availability.json` and run the script. The key goes in `.env` as `WATCHMODE_API_KEY` and is never printed or committed.

## Offline use and caching

A service worker (`src/sw.js`) keeps one versioned cache (currently `cocinema-v17`); bumping the name on a deploy makes every phone drop the old cache. Code (HTML, JS, CSS) is network-first with a 4 second wait before falling back to the saved copy. Data files (`catalog.json`, `onboarding.json`, `availability.json`) are stale-while-revalidate. Other origins (posters) are never cached, so offline the cards show placeholders. The worker is registered only on https or 127.0.0.1.

## Routing

One HTML page, hash routes. `#/movie/<Wikidata id>` is a film page (it survives a refresh, and Back returns to the results at the same scroll position), and `#/with/<payload>` is a friend's shared taste. An unknown film id shows a "Movie not found" screen.

## Evaluation in full

Run with `npm run evaluate` (fixed seed, no network). The headline numbers are written into [`src/evaluation-stats.js`](../src/evaluation-stats.js), which the landing page also reads, so the docs and the page cannot disagree. Seed 20261007, 1,000 simulated users over 20 genres, each rating 12 films:

| Measure | Value |
| --- | --- |
| Precision@10 | 0.598 |
| Baseline (genre's share of the catalog) | 0.162 |
| Lift over the baseline | 4.58x |
| Held-out liked film, mean percentile | 72.6 |
| Held-out liked film found in the top 20 | 14.4% |

**Method.** For each genre with enough films, simulated users rate films of that genre 9 or 10, films outside it 2 or 3, and a couple of others 5 or 6; one more film of the genre is held back. The real `recommend()` ranks every unrated film, and the script records how much of the top 10 is in the genre, how that compares with the genre's share of the catalog, and where the held-back film lands. `node scripts/evaluate.js --compare` repeats this with different numbers of ratings.

**Limitation.** These users' taste is defined by Wikidata genre labels, and a film can carry several. The numbers show the recommender picks up a genre signal from ratings; they say nothing about accuracy for real people, and results vary a lot by genre.

## Known limits

- Posters are linked from another site (via OMDb), which can see a visitor's IP address like any site would, and they need a connection. Fonts are self-hosted. There is no account; ratings stay on the device.
- Streaming availability is a dated snapshot, and the JustWatch links are searches, not guarantees.
- Co-watch links contain the ratings in encoded form; anyone with the link can read them.

## Project structure

```
scripts/            build time: runs locally, uses API keys
  wikidata.js, omdb.js, embeddings.js   discovery, enrichment, embeddings
  buildCatalog.js   orchestrates the build -> data/catalog.json
  fetchMeta.js, mergeMeta.js, backfill.js   Wikidata metadata, overrides, missing fields
  verifyCatalog.js, repairCatalog.js    title, year and plot verification, and repairs
  crossCheckWikidata.js                 director and runtime cross-check
  buildOnboarding.js, buildLandingPosters.js   onboarding pools, landing poster strip
  watchmode.js      streaming availability snapshot
  evaluate.js       evaluation, writes src/evaluation-stats.js
data/
  catalog.json      the bridge between build time and runtime
  onboarding.json   genre pools shown on the rating screen
  availability.json dated streaming snapshot
  overrides.json    documented verification exceptions
  extra-films.json  films added by hand that the genre queries do not reach
src/                runtime: static files served to the browser
  main.js           screens, hash routing and the rating flows
  recommend.js, similarity.js           taste profile, ranking, cosine similarity
  combine.js, cowatch.js, cowatchScreens.js, samples.js, flags.js   Watch with a friend
  why.js, dialog.js  the "why" lines, and the confirmation dialog
  detail.js, availability.js            film page and streaming text
  ratings.js        the only file that touches localStorage
  sw.js, offline.js service worker and offline notice
  fonts/            self-hosted fonts with their licences
tests/              node:test unit tests (npm test)
e2e/                headless browser checks (npm run test:e2e)
docs/               VISION.md, this file and the README screenshots
```

## Roadmap

- Diversity re-ranking, so the top of a list is not all one flavour
- Testing with real users
- A cleaner poster source
- Mood-based search
