#!/usr/bin/env python3
"""Fetch the last 10 years of articles for the target journals from OpenAlex.

OpenAlex is free, keyless, and covers all these journals well enough for a
v1 corpus (see JOURNALS below for per-journal abstract-availability notes -
the Springer-published ones have thin abstract coverage here and rely on
scripts/enrich_missing_abstracts.py to backfill from PubMed/Springer Meta).
Output is data/corpus.json: normalized journals/authors/articles, independent
of any database - the Next.js app can read this file directly, and
scripts/load_supabase.py can push the same file into Postgres once a
Supabase project exists.
"""
import json
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "corpus.json"
CONTACT_EMAIL = "cox.david.j@gmail.com"  # OpenAlex "polite pool" identification
YEARS_BACK = 10

# OpenAlex source ids, resolved via https://api.openalex.org/sources?search=...
JOURNALS = [
    {"openalex_source_id": "S125122479", "name": "Journal of Applied Behavior Analysis", "issn_l": "0021-8855"},
    {"openalex_source_id": "S2764616832", "name": "Behavior Analysis in Practice", "issn_l": "1998-1929"},
    {"openalex_source_id": "S203327754", "name": "Behavioral Interventions", "issn_l": "1072-0847"},
    {"openalex_source_id": "S168850678", "name": "Journal of the Experimental Analysis of Behavior", "issn_l": "0022-5002"},
    {"openalex_source_id": "S4210188225", "name": "Perspectives on Behavior Science", "issn_l": "2520-8969"},
    {"openalex_source_id": "S113178815", "name": "The Analysis of Verbal Behavior", "issn_l": "0889-9401"},
    {"openalex_source_id": "S92682373", "name": "The Psychological Record", "issn_l": "0033-2933"},
    # Appended last so existing journal ids (enumerate index) stay stable.
    {"openalex_source_id": "S4210228049", "name": "Behavior Analysis: Research and Practice", "issn_l": "2372-9414"},
]

NOISE_TITLE_RE = re.compile(
    r"(issue information|front matter|back matter|cover|editorial board|"
    r"guest eds? ?(?:&|&amp;) ?revs? acknowledge?ment|call for (nominations|applications)|"
    r"correction:?|correction to:|corrigendum|erratum|"
    r"guest reviewers?\b|reviewers? (?:and|&|&amp;) associate editors? list|"
    r"reviewer list|acknowledge?ment of.*guest)",
    re.IGNORECASE,
)

API = "https://api.openalex.org/works"
SELECT = ",".join([
    "id", "title", "abstract_inverted_index", "authorships", "publication_year",
    "publication_date", "doi", "type", "topics", "keywords",
])


def today_iso():
    # Date.now()-equivalent isn't available in this environment; the caller
    # (a human running this script) supplies "now" implicitly via the OS clock.
    import datetime
    return datetime.date.today().isoformat()


def from_date_iso():
    import datetime
    d = datetime.date.today()
    return d.replace(year=d.year - YEARS_BACK).isoformat()


def fetch_all(source_id: str):
    works = []
    cursor = "*"
    while cursor:
        params = (
            f"filter=primary_location.source.id:{source_id},"
            f"from_publication_date:{from_date_iso()},"
            f"to_publication_date:{today_iso()},"
            # Excludes paratext (issue info/front matter), errata, editorials,
            # letters - not substantive articles, and their near-empty titles
            # otherwise collapse into degenerate single-item topic clusters.
            f"type:article|review"
            f"&select={SELECT}&per_page=200&cursor={cursor}&mailto={CONTACT_EMAIL}"
        )
        url = f"{API}?{params}"
        for attempt in range(5):
            try:
                # This Python install's SSL trust store is unreliable in this
                # environment; curl uses the system trust store and works.
                result = subprocess.run(
                    ["curl", "-fsS", "--max-time", "30", url],
                    capture_output=True, check=True,
                )
                payload = json.loads(result.stdout.decode("utf-8"))
                break
            except (subprocess.CalledProcessError, json.JSONDecodeError) as e:
                if attempt == 4:
                    raise
                print(f"  retry ({e}) in {2 ** attempt}s", file=sys.stderr)
                time.sleep(2 ** attempt)
        works.extend(payload["results"])
        cursor = payload.get("meta", {}).get("next_cursor")
        print(f"  fetched {len(works)}/{payload['meta']['count']}", file=sys.stderr)
        if not payload["results"]:
            break
    return works


def reconstruct_abstract(inverted_index):
    if not inverted_index:
        return None
    length = max(pos for positions in inverted_index.values() for pos in positions) + 1
    words = [""] * length
    for word, positions in inverted_index.items():
        for pos in positions:
            words[pos] = word
    return re.sub(r"\s+", " ", " ".join(words)).strip()


def normalize_author_id(openalex_url):
    return openalex_url.rsplit("/", 1)[-1]


def normalize_work(work, journal_id):
    abstract = reconstruct_abstract(work.get("abstract_inverted_index"))
    topics = [
        {"display_name": t["display_name"], "score": t.get("score")}
        for t in (work.get("topics") or [])
    ]
    keywords = [k["display_name"] for k in (work.get("keywords") or [])]

    authors = []
    for a in work.get("authorships") or []:
        author = a.get("author") or {}
        if not author.get("id"):
            continue
        authors.append({
            "id": normalize_author_id(author["id"]),
            "display_name": author.get("display_name", ""),
            "orcid": author.get("orcid"),
            "position": a.get("author_position"),
            "is_corresponding": bool(a.get("is_corresponding")),
        })

    return {
        "id": normalize_author_id(work["id"]),
        "journal_id": journal_id,
        "title": (work.get("title") or "").strip(),
        "abstract": abstract,
        "has_full_abstract": abstract is not None,
        "openalex_topics": topics,
        "openalex_keywords": keywords,
        "year": work.get("publication_year"),
        "publication_date": work.get("publication_date"),
        "doi": work.get("doi"),
        "type": work.get("type"),
        "authors": authors,
    }


def main():
    all_articles = []
    all_authors = {}
    for journal_id, journal in enumerate(JOURNALS):
        print(f"Fetching {journal['name']} ({journal['openalex_source_id']})...", file=sys.stderr)
        works = fetch_all(journal["openalex_source_id"])
        for w in works:
            article = normalize_work(w, journal_id)
            # A handful of front-matter/administrative pages and corrections
            # are misclassified as type "article"/"review" in OpenAlex and
            # slip past the type:article|review filter above.
            if not article["title"] or NOISE_TITLE_RE.search(article["title"].strip()):
                continue
            for a in article["authors"]:
                all_authors.setdefault(a["id"], {
                    "id": a["id"], "display_name": a["display_name"], "orcid": a["orcid"],
                })
            all_articles.append(article)

    n_with_abstract = sum(1 for a in all_articles if a["has_full_abstract"])
    corpus = {
        "generated_at": today_iso(),
        "journals": [{**j, "id": i} for i, j in enumerate(JOURNALS)],
        "authors": list(all_authors.values()),
        "articles": all_articles,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(corpus, indent=2, ensure_ascii=False))
    print(
        f"articles={len(all_articles)} (abstracts={n_with_abstract}) "
        f"authors={len(all_authors)} -> {OUT}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
