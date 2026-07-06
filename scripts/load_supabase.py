#!/usr/bin/env python3
"""Push data/corpus.json into a Supabase project's Postgres tables.

Not runnable yet in this environment - it needs a real Supabase project
(supabase/README.md walks through creating one and running the migrations
first). Uses plain PostgREST HTTP calls (upsert via `Prefer:
resolution=merge-duplicates`) rather than the supabase-py SDK, so there's
one fewer dependency to install for a one-shot loader.

Usage:
    SUPABASE_URL=https://xxxx.supabase.co \\
    SUPABASE_SERVICE_ROLE_KEY=... \\
    python3 scripts/load_supabase.py
"""
import json
import os
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
CORPUS = ROOT / "data" / "corpus.json"
BATCH_SIZE = 500


def env(name):
    val = os.environ.get(name)
    if not val:
        sys.exit(f"missing required env var {name}")
    return val


def upsert(base_url, headers, table, rows, on_conflict):
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        resp = requests.post(
            f"{base_url}/rest/v1/{table}?on_conflict={on_conflict}",
            headers={**headers, "Prefer": "resolution=merge-duplicates"},
            json=batch,
            timeout=60,
        )
        if not resp.ok:
            sys.exit(f"upsert into {table} failed ({resp.status_code}): {resp.text[:500]}")
        print(f"  {table}: {min(i + BATCH_SIZE, len(rows))}/{len(rows)}", file=sys.stderr)


def main():
    supabase_url = env("SUPABASE_URL").rstrip("/")
    service_key = env("SUPABASE_SERVICE_ROLE_KEY")
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }

    corpus = json.loads(CORPUS.read_text())

    print("upserting journals...", file=sys.stderr)
    journals = [
        {"id": j["id"], "name": j["name"], "issn_l": j["issn_l"], "openalex_source_id": j["openalex_source_id"]}
        for j in corpus["journals"]
    ]
    upsert(supabase_url, headers, "journals", journals, "openalex_source_id")

    print("upserting authors...", file=sys.stderr)
    authors = [
        {"id": a["id"], "display_name": a["display_name"], "orcid": a["orcid"]}
        for a in corpus["authors"]
    ]
    upsert(supabase_url, headers, "authors", authors, "id")

    print("upserting clusters...", file=sys.stderr)
    clusters = [{"id": c["id"], "label": c["label"]} for c in corpus.get("clusters", [])]
    if clusters:
        upsert(supabase_url, headers, "clusters", clusters, "id")

    print("upserting articles...", file=sys.stderr)
    articles = [
        {
            "id": a["id"],
            "journal_id": a["journal_id"],
            "title": a["title"],
            "abstract": a["abstract"],
            "has_full_abstract": a["has_full_abstract"],
            "openalex_topics": a["openalex_topics"],
            "openalex_keywords": a["openalex_keywords"],
            "year": a["year"],
            "publication_date": a["publication_date"],
            "doi": a["doi"],
            "cluster_id": a.get("cluster_id"),
            "x": a.get("x"),
            "y": a.get("y"),
            "related": a.get("related", []),
        }
        for a in corpus["articles"]
    ]
    upsert(supabase_url, headers, "articles", articles, "id")

    print("upserting article_authors...", file=sys.stderr)
    article_authors = [
        {
            "article_id": a["id"],
            "author_id": au["id"],
            "author_position": au["position"],
            "is_corresponding": au["is_corresponding"],
        }
        for a in corpus["articles"]
        for au in a["authors"]
    ]
    upsert(supabase_url, headers, "article_authors", article_authors, "article_id,author_id")

    print("done", file=sys.stderr)


if __name__ == "__main__":
    main()
