# Published Landscape

Behavior-analysis journal articles, organized by topic instead of chronology.
Covers the last 10 years of the *Journal of Applied Behavior Analysis*,
*Behavior Analysis in Practice*, and *Behavioral Interventions* so that
readers can browse by theme and associate editors can find reviewers by
topic instead of just by the names they already know.

## What's here

- **Topic map** (`/map`) - every article placed by what it's about, not when
  it was published. Click a point for the full abstract, DOI, and related work.
- **Articles** (`/articles`) - search/filter by journal, topic, year.
- **Find a reviewer** (`/reviewers`) - pick a topic (or search a name) to see
  who's published there, ranked by article count, with links to their work.
- **Place a submission** (`/submit`) - paste (or upload a PDF to autofill) a
  manuscript's title/abstract to project it into the same topic space, see
  the nearest existing articles (for spotting overlap or finding reviewers
  with directly related work), and view it as a marker on the topic map.
  PDF text never leaves the browser - only the extracted/edited text does.
- Whole site is gated behind Supabase Auth (invite-only magic link).

## Data pipeline

```
scripts/ingest_openalex.py   # fetch 10 years of articles from OpenAlex -> data/corpus.json
scripts/build_layout.py      # TF-IDF -> SVD -> MDS -> clustering -> topic map coords + data/model.json
```

`data/corpus.json` is the single source of truth for the v1 mockup - the
Next.js app (`src/lib/data.ts`) reads it directly, no database required to
run locally. Re-run both scripts to refresh the corpus (`pip install numpy
scipy` first). See `scripts/ingest_openalex.py` for journal/abstract-coverage
notes - Behavior Analysis in Practice has few machine-readable abstracts, so
those records fall back to OpenAlex's own topic/keyword tags for clustering.

`data/model.json` is the fitted TF-IDF/SVD projection (vocab, idf, SVD
components, per-article latent vectors, cluster centroids) that
`src/lib/placement.ts` uses to place a brand-new title/abstract into the
same space for `/submit`, without recomputing the whole corpus's layout.
Re-running `build_layout.py` regenerates it from scratch alongside the corpus.

`.github/workflows/refresh-data.yml` re-runs both scripts every Monday and
commits `data/corpus.json` if anything changed, which in turn triggers the
demo redeploy. OpenAlex/Crossref typically index new online-first articles
within a few days of publication - if you're moving to the Supabase-backed
version, add a `scripts/load_supabase.py` step to that workflow too.

## Running locally

```bash
npm install
npm run dev
```

Works out of the box with no setup - the login gate auto-disables (with a
visible banner) until Supabase is configured. To turn on real auth:

1. Follow `supabase/README.md` to create a project and run the migrations.
2. Copy `.env.local.example` to `.env.local` and fill in your project's URL/keys.
3. Invite yourself and any AEs/reviewers from the Supabase dashboard.

## Stack

Next.js 16 (App Router) + Tailwind, Supabase (Postgres + Auth) once
configured, static-JSON data layer for the mockup phase.
