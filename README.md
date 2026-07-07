# Published Landscape

Behavior-analysis journal articles, organized by topic instead of chronology.

Journals are normally browsed chronologically - which makes it hard for an
editor to find who's written on a given topic beyond the names they already
know. This project takes the last 10 years of 7 behavior-analysis journals,
places every article in a "topic space" by what it's actually about, and
lets readers browse by theme and associate editors find reviewers by
expertise instead of by memory.

Current corpus: **4,095 articles**, **95.2% with a real abstract**, **7
journals**, **45 topics**, **5,961 authors**.

## What's here

- **Topic map** (`/map`) - every article placed by what it's about, not when
  it was published. Click a point for the full abstract, DOI, and related
  work. Click a topic in the legend to isolate it; click again to restore.
- **Articles** (`/articles`) - search/filter by journal, topic, year.
- **See where a new article lands** (`/submit`) - paste (or upload a PDF to
  autofill) a manuscript's title/abstract to project it into the same topic
  space, see the nearest existing articles (for spotting overlap), get a
  ranked list of candidate reviewers (authors of those nearest articles, with
  DOI links to find corresponding-author contact info), and view it as a
  marker on the topic map. PDF text never leaves the browser - only the
  extracted/edited text does.
- Whole site is gated behind Supabase Auth (invite-only magic link) - see
  [Auth setup](#auth-setup).

A public, read-only, un-gated version of the topic map/articles/reviewers
lives as a static demo (vanilla HTML/JS, no backend) deployed to GitHub
Pages - see [Static demo](#static-demo).

## How the data were gathered

**Journals** (`scripts/ingest_openalex.py`): Journal of Applied Behavior
Analysis, Behavior Analysis in Practice, Behavioral Interventions, Journal
of the Experimental Analysis of Behavior, Perspectives on Behavior Science,
The Analysis of Verbal Behavior, The Psychological Record. The last 10 years
of each is pulled from the free [OpenAlex](https://openalex.org) API
(title, authors, year, DOI, and abstract where OpenAlex has one), filtered
to `type:article|review` and a title-pattern denylist (issue front matter,
"Call for Nominations," "Correction to:," etc. - things OpenAlex sometimes
misclassifies as articles).

**Abstract backfill** (`scripts/enrich_missing_abstracts.py`): OpenAlex/
Crossref only carry abstracts for a small fraction of the Springer-published
journals here (Behavior Analysis in Practice, Perspectives on Behavior
Science, The Analysis of Verbal Behavior, The Psychological Record - as low
as ~10% for some). This script closes most of that gap in two passes:

1. **PubMed/PMC** (NCBI E-utilities) - free, keyless, unambiguously open to
   automated access. Matched by DOI, verified against the returned record's
   own DOI field before accepting a match.
2. **Springer Nature's Meta API** (dev.springernature.com, free
   registration, `SPRINGER_META_API_KEY`) as a fallback for whatever PubMed
   doesn't have - Springer's own sanctioned metadata/abstracts API, not
   scraping their site (their `robots.txt` explicitly disallows AI-agent
   crawlers by name, so this deliberately goes through their API instead).

This took overall abstract coverage from ~61% to 95.2%, and Behavior
Analysis in Practice specifically from ~10% to ~98%. The remainder (mostly
tributes/errata with no abstract anywhere, or capped by Springer's 500/day
free-tier quota on a given run) fall back to OpenAlex's own computed
topic/keyword tags for clustering - the app flags these explicitly wherever
an abstract would show, so a thin placement is visible rather than silently
looking wrong.

`.github/workflows/refresh-data.yml` re-runs ingestion + backfill + the
topic model every Monday and commits the result if anything changed, which
in turn redeploys the static demo. New online-first articles are typically
indexed by OpenAlex/Crossref within a few days of publication.

## How the topic model was built

`scripts/build_layout.py` turns the corpus into a topic map in four steps:

1. **Document text**: title (repeated 3x, so it dominates) + abstract. For
   the minority of articles with no abstract, falls back to title + OpenAlex's
   own topic/keyword tags instead (still real signal, just thinner).
2. **TF-IDF**: a ~7,600-term vocabulary (terms appearing in 3 to 40% of
   documents - rare enough to be informative, common enough to be reliable),
   weighted by log-scaled term frequency times inverse document frequency.
3. **Truncated SVD to 60 dimensions** - this 60-number vector per article is
   the actual "embedding": cosine distance between two articles' vectors is
   what "similar topic" means everywhere in this app (nearest neighbors,
   reviewer suggestions, cluster assignment). Nothing downstream uses a
   neural embedding model; this is a from-scratch linear-algebra pipeline,
   deterministic and reproducible without an API key.
4. **Clustering + layout**: average-linkage hierarchical clustering (cosine
   distance) into 45 topics, each auto-labeled by its top TF-IDF terms. The
   2D map position is a separate, purely visual step on top of the 60-dim
   embedding - a two-level "island" layout (cluster centroids placed via
   classical MDS and pushed apart so they don't overlap, then each cluster's
   own members locally laid out around its centroid). A single global
   MDS/t-SNE over 4,095 points tends to produce one soft continuous blob;
   doing it per-cluster is what makes the map read as separated, legible
   topic islands instead.

This whole pipeline (and the "place a new article" projection below) is
pure NumPy/SciPy - see `scripts/build_layout.py` for the exact math.

## How a new submission gets placed

`/submit` doesn't re-run the pipeline above - the fitted model (vocabulary,
IDF weights, the SVD projection matrix, every existing article's 60-dim
vector, and each cluster's centroid) is frozen into `data/model.json` when
`build_layout.py` runs, and `src/lib/placement.ts` reuses it:

1. Tokenize the submitted title/abstract the same way the corpus was
   tokenized, build a TF-IDF vector over the *existing* frozen vocabulary
   (no re-fitting), and project it through the *existing* frozen SVD matrix
   to get a 60-dim vector in the same space as everything else.
2. Cosine-similarity that vector against all 4,095 existing article vectors
   (a few thousand dot products - milliseconds, no retraining).
3. Assign a topic by similarity-weighted majority vote among the nearest
   neighbors (not nearest cluster centroid - centroid similarity can point
   to a different cluster than where the actual nearest articles sit,
   which read as inconsistent next to the neighbor list shown alongside it).
4. Approximate a map position as a similarity-weighted average of the
   nearest neighbors' real x/y coordinates (no full re-layout).
5. Build the reviewer list from a wider pool (~30 neighbors): sum each
   co-author's similarity across every one of their papers in that pool, so
   someone with two decent matches can outrank someone with one great one.

Nothing is persisted - it's a stateless request/response, and the PDF (if
used) never leaves the browser; only the extracted/edited text is sent.
This math was checked before shipping by re-projecting a real, already-
published article's own text through the pipeline and confirming it
reproduced that article's own precomputed nearest neighbors exactly.

## Static demo

`demo/` is a from-scratch vanilla HTML/CSS/JS port of the topic map,
article browser, and article detail pages - no framework, no login, no
backend, reading `data/corpus.json` directly via `fetch`. It's what's
deployed to GitHub Pages (`.github/workflows/deploy-demo.yml`, triggered on
any push touching `demo/**` or `data/corpus.json`) so the landscape is
viewable by anyone with a link, without needing Supabase or Vercel set up.
It intentionally does not include the `/submit` placement feature or
reviewer suggestions.

## Running locally

```bash
npm install
npm run dev
```

Works out of the box with no setup - the login gate auto-disables (with a
visible banner) until Supabase is configured, and reads the same
`data/corpus.json`/`data/model.json` the deployed app uses.

## Auth setup

The whole site is gated behind Supabase Auth (invite-only magic link - no
public signup). To turn it on:

1. Create a free project at [supabase.com/dashboard](https://supabase.com/dashboard).
2. In the SQL Editor, run the three files in `supabase/migrations/` in order.
3. In Project Settings, copy the Project URL, `anon`/publishable key, and
   `service_role`/secret key into `.env.local` (see `.env.local.example`).
4. In Authentication > URL Configuration, set Site URL to your deployed URL
   and add `<your-url>/auth/confirm` (and `http://localhost:3000/auth/confirm`
   for local dev) to Redirect URLs - Supabase's own default Site URL
   (`localhost:3000`) otherwise silently overrides the redirect you ask for.
5. Invite yourself and any AEs/reviewers under Authentication > Users >
   Invite user. Promote an account to admin/editor via:
   `update profiles set role = 'admin' where email = 'you@example.com';`
6. Optionally configure custom SMTP (Authentication > Emails > SMTP
   Settings) so invite/magic-link emails send from your own domain instead
   of Supabase's rate-limited shared sender.

See `supabase/README.md` for the condensed version of the same steps.

## Data pipeline reference

```
scripts/ingest_openalex.py           # fetch 10 years of articles from OpenAlex -> data/corpus.json
scripts/enrich_missing_abstracts.py  # backfill missing abstracts: PubMed first, then Springer Meta API
scripts/build_layout.py              # TF-IDF -> SVD -> clustering -> topic map coords + data/model.json
```

Re-run all three in order to refresh the corpus (`pip install numpy scipy
requests` first; `SPRINGER_META_API_KEY` env var needed for the second).
`data/corpus.json` and `data/model.json` are the single sources of truth for
this mockup - the Next.js app (`src/lib/data.ts`, `src/lib/placement.ts`)
reads them directly, no database required to run. `scripts/load_supabase.py`
can push the same corpus into Postgres once a Supabase project exists, for
moving off the static-JSON data layer.

## Stack

Next.js 16 (App Router) + Tailwind, Supabase (Postgres + Auth), deployed on
Vercel. Static-JSON data layer for now (see above) rather than the Postgres
schema being the live read path, even though both the schema and an
RLS-secured Supabase Auth gate are fully wired up.
