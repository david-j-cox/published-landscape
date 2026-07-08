#!/usr/bin/env python3
"""Enrich data/corpus.json with topic clusters and 2D map coordinates.

Same pure-numpy shape as the bds-lab-website approach (TF-IDF -> truncated
SVD -> classical MDS -> clustering -> "topic islands" layout), scaled to a
~4,000-article, 8-journal corpus and adapted for two data quirks here:

  - No manual labels.json to override clustering (this corpus is too big to
    hand-label): clusters and their labels are fully derived from text.
  - A meaningful minority of articles (mostly the Springer-published
    journals, before scripts/enrich_missing_abstracts.py runs) have no
    abstract. For those, doc_text() falls back to title + OpenAlex's own
    computed topics/keywords, which OpenAlex assigns from title/venue/refs
    even without abstract text - degraded signal, not absent signal.

Requires numpy + scipy (`pip install numpy scipy`); scipy.cluster.hierarchy
replaces the from-scratch agglomerative loop the lab site uses, which is
O(n^3) and too slow past a few hundred articles.
"""
import json
import math
import re
import sys
from collections import Counter
from pathlib import Path

import numpy as np
from scipy.cluster.hierarchy import fcluster, linkage
from scipy.spatial.distance import squareform

ROOT = Path(__file__).resolve().parent.parent
CORPUS = ROOT / "data" / "corpus.json"
MODEL = ROOT / "data" / "model.json"
K_CLUSTERS = int(sys.argv[1]) if len(sys.argv) > 1 else 45
SVD_DIMS = 60
SEED = 7

STOPWORDS = set("""
a an the of and or to in on for with without by from as at is are was were be been being
this that these those it its their our your his her they we you i he she them us
into over under between within across about more most less least than then thus
can may might will would should could also however therefore
study studies analysis analyses effect effects effect's results result data approach approaches
behavior behavioral behaviour via toward towards based across new non per et al using used use
review article paper case study single-case
""".split())

LABEL_STOP = STOPWORDS | set("""
human humans participants participant model models modeling quantitative
intro introduction special section issue chapter guide editorial editors
supplementary contains material materials online available doi https www
version unlabelled esm publisher published copyright information
""".split())


def tokenize(text):
    toks = re.findall(r"[a-zA-Z][a-zA-Z\-]+", text.lower())
    return [t for t in toks if len(t) >= 3 and t not in STOPWORDS]


def doc_text(article):
    # Author names deliberately excluded: a handful of prolific co-author
    # groups publish narrowly enough that their surnames out-score real topic
    # terms in TF-IDF and produce labels like "leaf, cihon" instead of a topic.
    if article["has_full_abstract"]:
        body = article["abstract"]
        # A real abstract is much richer than the title - repeating the
        # title 3x let generic academic phrasing ("a replication and
        # extension of prior research") outweigh a specific, on-topic
        # abstract for at least one observed case. Title still gets a
        # single pass: it's a useful disambiguator, just not a dominant one
        # when there's real body text to lean on.
        title_weight = 1
    else:
        topics = " ".join(t["display_name"] for t in article.get("openalex_topics", []))
        keywords = " ".join(article.get("openalex_keywords", []))
        # No abstract text; lean harder on title repetition plus OpenAlex's
        # own topic/keyword tags as the substitute signal.
        body = " ".join([topics, topics, keywords])
        title_weight = 3
    return " ".join([(article["title"] + " ") * title_weight, body])


def build_tfidf(docs):
    tokenized = [tokenize(d) for d in docs]
    n = len(docs)
    df = {}
    for toks in tokenized:
        for t in set(toks):
            df[t] = df.get(t, 0) + 1
    vocab = sorted(t for t, c in df.items() if 3 <= c <= 0.4 * n)
    vindex = {t: i for i, t in enumerate(vocab)}
    idf = np.array([math.log((1 + n) / (1 + df[t])) + 1 for t in vocab])
    X = np.zeros((n, len(vocab)), dtype=np.float32)
    for i, toks in enumerate(tokenized):
        counts = Counter(t for t in toks if t in vindex)
        for t, c in counts.items():
            X[i, vindex[t]] = (1 + math.log(c)) * idf[vindex[t]]
    norms = np.linalg.norm(X, axis=1, keepdims=True)
    norms[norms == 0] = 1
    X = X / norms
    return X, vocab, idf


def truncated_svd(X, dims):
    U, S, Vt = np.linalg.svd(X, full_matrices=False)
    d = min(dims, len(S))
    return U[:, :d] * S[:d], Vt[:d]


def classical_mds(coords, out_dim=2):
    norm = coords / (np.linalg.norm(coords, axis=1, keepdims=True) + 1e-9)
    sim = norm @ norm.T
    D2 = np.clip(1 - sim, 0, None) ** 2
    n = D2.shape[0]
    J = np.eye(n) - np.ones((n, n)) / n
    B = -0.5 * J @ D2 @ J
    w, V = np.linalg.eigh(B)
    idx = np.argsort(w)[::-1][:out_dim]
    L = np.sqrt(np.clip(w[idx], 0, None))
    return V[:, idx] * L


def _separate(points, radii, iters=300, seed=SEED):
    rng = np.random.default_rng(seed)
    pos = points.astype(float) + rng.normal(0, 1e-3, points.shape)
    for _ in range(iters):
        moved = False
        for i in range(len(pos)):
            for j in range(i + 1, len(pos)):
                d = pos[j] - pos[i]
                dist = np.linalg.norm(d) + 1e-9
                need = radii[i] + radii[j]
                if dist < need:
                    push = (need - dist) / 2 * (d / dist)
                    pos[i] -= push
                    pos[j] += push
                    moved = True
        pos -= pos.mean(0) * 0.05
        if not moved:
            break
    return pos


def island_layout(unit, labels, seed=SEED):
    """Two-level layout: cluster centroids placed and separated, then each
    cluster's members packed tightly around its centroid via local MDS."""
    rng = np.random.default_rng(seed)
    ids = sorted(np.unique(labels))
    cvecs = np.array([unit[labels == c].mean(0) for c in ids])
    cvecs /= np.linalg.norm(cvecs, axis=1, keepdims=True) + 1e-9
    centers = classical_mds(cvecs, 2)
    centers = (centers - centers.mean(0)) / (centers.std(0) + 1e-9)
    rad = np.linalg.norm(centers, axis=1, keepdims=True)
    centers = centers / (rad + 1e-9) * np.tanh(rad)
    counts = np.array([(labels == c).sum() for c in ids])
    radii = 0.4 + 0.26 * np.sqrt(counts)
    centers = _separate(centers * 2.0, radii + 0.3)

    pos = np.zeros((len(labels), 2))
    for ci, c in enumerate(ids):
        idx = np.where(labels == c)[0]
        m = unit[idx]
        if len(idx) >= 3:
            # classical_mds is O(n^2) in memory per cluster; large clusters
            # (JABA's ~900-article corpus can produce a dominant one) get
            # subsampled for the MDS basis, then everyone projects onto it.
            if len(idx) > 400:
                sample = rng.choice(len(idx), 400, replace=False)
                basis_local = classical_mds(m[sample], 2)
                # project remaining points via nearest sampled neighbour's offset
                local = np.zeros((len(idx), 2))
                local[sample] = basis_local
                remaining = [i for i in range(len(idx)) if i not in set(sample.tolist())]
                if remaining:
                    sim_to_sample = m[remaining] @ m[sample].T
                    nearest = sim_to_sample.argmax(axis=1)
                    local[remaining] = basis_local[nearest]
            else:
                local = classical_mds(m, 2)
            span = np.abs(local).max(0)
            span[span == 0] = 1
            local = local / span * radii[ci] * 0.8
        elif len(idx) == 2:
            local = np.array([[-radii[ci] * 0.4, 0], [radii[ci] * 0.4, 0]])
        else:
            local = np.zeros((1, 2))
        local += rng.normal(0, radii[ci] * 0.05, local.shape)
        pos[idx] = centers[ci] + local
    return pos


def hierarchical_clusters(unit, k):
    """Average-linkage clustering via scipy (C-optimized), cosine distance."""
    sim = unit @ unit.T
    D = np.clip(1 - sim, 0, 2)
    np.fill_diagonal(D, 0)
    condensed = squareform(D, checks=False)
    Z = linkage(condensed, method="average")
    raw_labels = fcluster(Z, t=k, criterion="maxclust") - 1  # 0-indexed
    # Renumber so cluster 0 is the largest (matches legend ordering elsewhere).
    counts = Counter(raw_labels.tolist())
    order = [c for c, _ in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))]
    remap = {old: new for new, old in enumerate(order)}
    return np.array([remap[c] for c in raw_labels])


def cluster_labels(X_tfidf, vocab, labels, k, top=4):
    out = {}
    for j in range(k):
        members = X_tfidf[labels == j]
        score = members.sum(axis=0) if len(members) else np.zeros(X_tfidf.shape[1])
        if not len(members) or score.max() == 0:
            out[j] = "Uncategorized"
            continue
        order = np.argsort(score)[::-1]
        terms = []
        for idx in order:
            term = vocab[idx]
            if term in LABEL_STOP:
                continue
            terms.append(term)
            if len(terms) == top:
                break
        out[j] = ", ".join(terms)
    return out


def main():
    raw = json.loads(CORPUS.read_text())
    articles = raw["articles"]
    docs = [doc_text(a) for a in articles]
    print(f"building TF-IDF over {len(docs)} documents...", file=sys.stderr)
    X, vocab, idf = build_tfidf(docs)
    print(f"vocab={len(vocab)}", file=sys.stderr)

    reduced, Vt = truncated_svd(X, SVD_DIMS)
    unit = reduced / (np.linalg.norm(reduced, axis=1, keepdims=True) + 1e-9)

    print(f"clustering into k={K_CLUSTERS}...", file=sys.stderr)
    labels = hierarchical_clusters(unit, K_CLUSTERS)
    names = cluster_labels(X, vocab, labels, K_CLUSTERS)
    k = len(names)

    print("computing layout...", file=sys.stderr)
    xy = island_layout(unit, labels)
    xy = (xy - xy.mean(0)) / (xy.std(0) + 1e-9)
    _, V = np.linalg.eigh(np.cov(xy.T))
    xy = xy @ V[:, ::-1]
    xy = (xy - xy.mean(0)) / (xy.std(0) + 1e-9)

    print("computing nearest neighbours...", file=sys.stderr)
    sim = unit @ unit.T
    np.fill_diagonal(sim, -1)
    for i, art in enumerate(articles):
        art["x"] = round(float(xy[i, 0]), 4)
        art["y"] = round(float(xy[i, 1]), 4)
        art["cluster_id"] = int(labels[i])
        order = np.argsort(sim[i])[::-1][:6]
        art["related"] = [articles[j]["id"] for j in order if sim[i, j] > 0.05][:5]

    clusters = [
        {"id": j, "label": names[j], "count": int((labels == j).sum())}
        for j in range(k)
    ]
    raw["clusters"] = clusters
    CORPUS.write_text(json.dumps(raw, indent=2, ensure_ascii=False))
    print(f"clusters={k}", file=sys.stderr)
    for c in clusters:
        print(f"  [{c['id']:2d}] n={c['count']:4d}  {c['label']}", file=sys.stderr)

    print("exporting projection model...", file=sys.stderr)
    centroids_unit = np.array([unit[labels == j].mean(0) for j in range(k)])
    centroids_unit /= np.linalg.norm(centroids_unit, axis=1, keepdims=True) + 1e-9
    model = {
        "svd_dims": Vt.shape[0],
        "vocab": vocab,
        "idf": [round(float(v), 5) for v in idf],
        # components[d][vocab_idx]: projects a new tf-idf vector into the
        # same latent space via a plain dot product (new_doc_tfidf @ components.T).
        "components": [[round(float(v), 5) for v in row] for row in Vt],
        "cluster_centroids": [[round(float(v), 5) for v in row] for row in centroids_unit],
        # article_vectors[i] lines up 1:1 with data/corpus.json's articles array.
        "article_vectors": [[round(float(v), 5) for v in row] for row in unit],
    }
    MODEL.write_text(json.dumps(model, ensure_ascii=False))
    print(f"model -> {MODEL}", file=sys.stderr)


if __name__ == "__main__":
    main()
