# Vision

What CoCinema should become and the rules the code keeps. Reviews check the code against this file. When the plan changes, I update it in the same commit.

## The product

1. Landing page: one "Get started" button in the middle of the screen.
2. Onboarding: rate 15 popular movies, one per genre, on a 1–10 scale, one movie at a time. "Haven't seen it" skips to the next movie for that genre.
   Genres: comedy, horror, sci-fi, drama, action, thriller, romance, animation, adventure, fantasy, crime, war, western, mystery, musical.
3. Results:
   - Top 3 picks in their own section above the rest, with bigger posters and titles, and a short line for each saying why it was picked.
   - Then the rest of the ranked list, in order, with poster and title, no explanation lines.
4. Every movie shows its title and poster. Clicking any movie opens its own page: poster, title, description, trailer, where to watch (Canada, US, UK).

## Done (v1, live)

Landing screen, one-at-a-time onboarding with skip queues, recommendations, results poster grid with rank badges, dark theme. Catalog: 576 popular films across 20 genres, 512-dim embeddings.

## Next

| # | Feature | Notes |
|---|---|---|
| 1 | Top 3 section with "why" lines | The "why" must come from all 15 ratings together, never from a single rated movie |
| 2 | Movie detail page | Description, trailer, where to watch (CA, US, UK) |
| 3 | Shuffled onboarding | Pool of about 100 popular movies, shuffled per visit |
| 4 | Co-watch mode | Person A's ratings go in a share link; B rates, sees the joint list, and gets a link back with both sets. No server, no database |

Open items:
- Posters come from OMDb but are served from m.media-amazon.com (IMDb's image server). Find a cleaner source.
- Forrest Gump's Wikidata ID (Q134773) is not verified.

## Rules the code keeps

- AI runs in one place only: one embedding per plot, at build time. Everything live is deterministic maths in the browser. No API keys or AI calls in `src/`.
- No IMDb data: no IMDb IDs, votes or datasets.
- `recommend()` returns the full ranked list of `{ movie, score }`; screens decide how many to show.
- `recommend.js` is pure maths with no DOM; `similarity.js` holds vector helpers; `ratings.js` stores scores; `ui.js` only builds elements; `main.js` loads data and switches screens.
- The onboarding list lives in `data/onboarding.json`, never hard-coded in `main.js`.
- Each screen is its own div that is shown or hidden.
- Movie data only gains fields; new versions add code rather than rewrite v1.
- Build scripts in `scripts/` call paid APIs (OMDb, OpenAI). Only I run them.
