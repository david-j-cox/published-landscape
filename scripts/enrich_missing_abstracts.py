#!/usr/bin/env python3
"""Backfill abstracts for articles data/corpus.json has none for.

Mostly targets Behavior Analysis in Practice (Springer), which OpenAlex only
covers abstracts for ~15% of the time (see scripts/ingest_openalex.py).
Two free, ToS-clean sources, tried in order per article:

  1. PubMed/PMC (NCBI E-utilities) - unambiguously open, no API key
     required, no crawler restrictions. Matched by DOI.
  2. Springer Nature Meta API (dev.springernature.com) - Springer's own
     sanctioned metadata/abstracts API, distinct from scraping
     link.springer.com directly (which their robots.txt disallows for AI
     agents). Requires SPRINGER_META_API_KEY.

Verified both return the exact same abstract text as the publisher page
before writing this. Marks each backfilled article with "abstract_source"
for provenance/debugging.
"""
import datetime
import json
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
CORPUS = Path(os.environ.get("CORPUS_PATH") or (ROOT / "data" / "corpus.json"))
CONTACT_EMAIL = "cox.david.j@gmail.com"

NCBI_SLEEP = 0.35  # E-utilities allows 3 req/sec without an API key
SPRINGER_SLEEP = 0.65  # observed free-tier limit: 100/min, 500/day

SPRINGER_META_KEY = os.environ.get("SPRINGER_META_API_KEY")
SPRINGER_DAILY_CAP = 480  # stay under the 500/day free-tier limit

# Most misses are permanent - the source simply doesn't carry an abstract for
# that article - so re-attempting every failed DOI on every weekly run just
# burns the Springer daily quota (and NCBI time) on known dead ends. Record the
# date of a failed attempt and don't retry until this cooldown lapses; recent
# articles still get another chance later (PubMed sometimes indexes an abstract
# weeks after publication). RETRY_FAILED=1 forces a full re-attempt.
ABSTRACT_RETRY_COOLDOWN_DAYS = int(os.environ.get("ABSTRACT_RETRY_COOLDOWN_DAYS", "45"))
RETRY_FAILED = os.environ.get("RETRY_FAILED") == "1"


def recently_attempted(article):
    if RETRY_FAILED:
        return False
    ts = article.get("abstract_attempted")
    if not ts:
        return False
    try:
        attempted = datetime.date.fromisoformat(ts)
    except (TypeError, ValueError):
        return True  # malformed marker: treat as attempted, skip
    return (datetime.date.today() - attempted).days < ABSTRACT_RETRY_COOLDOWN_DAYS


def doi_of(article):
    doi = article.get("doi") or ""
    return doi.replace("https://doi.org/", "").replace("http://doi.org/", "")


def pubmed_abstract(doi):
    search = requests.get(
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
        params={"db": "pubmed", "term": doi, "retmode": "json", "email": CONTACT_EMAIL},
        timeout=20,
    )
    time.sleep(NCBI_SLEEP)
    ids = search.json().get("esearchresult", {}).get("idlist", [])
    if not ids:
        return None
    fetch = requests.get(
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi",
        params={"db": "pubmed", "id": ids[0], "rettype": "abstract", "retmode": "xml", "email": CONTACT_EMAIL},
        timeout=20,
    )
    time.sleep(NCBI_SLEEP)
    try:
        root = ET.fromstring(fetch.content)
    except ET.ParseError:
        return None
    # Verify the returned record is actually this DOI, not a coincidental match.
    article_ids = [el.text for el in root.iter("ArticleId") if el.get("IdType") == "doi"]
    if doi.lower() not in [a.lower() for a in article_ids if a]:
        return None
    parts = []
    for el in root.iter("AbstractText"):
        label = el.get("Label")
        text = "".join(el.itertext()).strip()
        if not text:
            continue
        parts.append(f"{label}: {text}" if label else text)
    return re.sub(r"\s+", " ", " ".join(parts)).strip() or None


def springer_abstract(doi, budget):
    if not SPRINGER_META_KEY or budget[0] <= 0 or not doi.startswith("10.1007/"):
        return None
    resp = requests.get(
        "https://api.springernature.com/meta/v2/json",
        params={"q": f"doi:{doi}", "api_key": SPRINGER_META_KEY},
        timeout=20,
    )
    budget[0] -= 1
    time.sleep(SPRINGER_SLEEP)
    if not resp.ok:
        return None
    records = resp.json().get("records", [])
    if not records:
        return None
    abstract = records[0].get("abstract")
    return abstract.strip() if abstract else None


def main():
    corpus = json.loads(CORPUS.read_text())
    candidates = [a for a in corpus["articles"] if not a["has_full_abstract"] and a.get("doi")]
    missing = [a for a in candidates if not recently_attempted(a)]
    skipped = len(candidates) - len(missing)
    print(
        f"{len(missing)} articles to attempt "
        f"({skipped} skipped: failed within last {ABSTRACT_RETRY_COOLDOWN_DAYS}d)",
        file=sys.stderr,
    )

    springer_budget = [SPRINGER_DAILY_CAP]
    found_pubmed = found_springer = still_missing = 0

    for i, article in enumerate(missing):
        doi = doi_of(article)
        if not doi:
            still_missing += 1
            continue
        abstract = pubmed_abstract(doi)
        source = "pubmed"
        if not abstract:
            abstract = springer_abstract(doi, springer_budget)
            source = "springer_meta"
        if abstract:
            article["abstract"] = abstract
            article["has_full_abstract"] = True
            article["abstract_source"] = source
            article.pop("abstract_attempted", None)  # succeeded; clear any stale marker
            if source == "pubmed":
                found_pubmed += 1
            else:
                found_springer += 1
        else:
            # Record the failed attempt so future runs honor the cooldown
            # instead of re-burning quota on this DOI.
            article["abstract_attempted"] = datetime.date.today().isoformat()
            still_missing += 1

        if (i + 1) % 50 == 0:
            print(
                f"  {i + 1}/{len(missing)} processed - pubmed={found_pubmed} "
                f"springer={found_springer} still_missing={still_missing} "
                f"(springer budget left={springer_budget[0]})",
                file=sys.stderr,
            )
            CORPUS.write_text(json.dumps(corpus, indent=2, ensure_ascii=False))

    CORPUS.write_text(json.dumps(corpus, indent=2, ensure_ascii=False))
    print(
        f"done: pubmed={found_pubmed} springer={found_springer} "
        f"still_missing={still_missing} -> {CORPUS}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
