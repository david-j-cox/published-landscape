import "server-only";
import corpusJson from "@/data/corpus.json";
import modelJson from "@/data/model.json";
import { getClusters } from "@/lib/data";
import type { Article, CandidateReviewer, PlacementNeighbor } from "@/lib/types";

// Projects a new title/abstract into the same TF-IDF -> SVD latent space
// computed by scripts/build_layout.py (see data/model.json), so a
// not-yet-published article can be placed among the existing corpus without
// recomputing the whole model. Math verified in Python to reproduce an
// existing article's own nearest neighbors exactly (see build_layout.py's
// exported article_vectors) before being ported here.
const model = modelJson as {
  svd_dims: number;
  vocab: string[];
  idf: number[];
  components: number[][]; // svd_dims x vocab.length
  cluster_centroids: number[][]; // n_clusters x svd_dims
  article_vectors: number[][]; // n_articles x svd_dims, aligned with corpus.articles order
};

// article_vectors is aligned with data/corpus.json's articles array in its
// original ingestion order - import corpus.json directly here (rather than
// via lib/data.ts's getArticles, which re-sorts by year for display) so the
// index lines up with article_vectors.
const articles = (corpusJson as { articles: Article[] }).articles;

const vocabIndex = new Map(model.vocab.map((t, i) => [t, i]));

const STOPWORDS = new Set(
  `a an the of and or to in on for with without by from as at is are was were be been being
   this that these those it its their our your his her they we you i he she them us
   into over under between within across about more most least than then thus
   can may might will would should could also however therefore
   study studies analysis analyses effect effects results result data approach approaches
   behavior behavioral behaviour via toward towards based across new non per et al using used use
   review article paper case study single-case`
    .split(/\s+/)
    .filter(Boolean),
);

function tokenize(text: string): string[] {
  const toks = text.toLowerCase().match(/[a-z][a-z-]+/g) ?? [];
  return toks.filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function norm(a: number[]): number {
  return Math.sqrt(dot(a, a));
}

function toNeighbor(a: Article, similarity: number): PlacementNeighbor {
  return {
    id: a.id,
    title: a.title,
    year: a.year,
    journal_id: a.journal_id,
    doi: a.doi,
    similarity,
    authors: a.authors,
  };
}

function projectToLatent(title: string, abstract: string): number[] {
  const text = `${title} ${title} ${title} ${abstract}`;
  const tokens = tokenize(text);
  const counts = new Map<number, number>();
  for (const t of tokens) {
    const idx = vocabIndex.get(t);
    if (idx === undefined) continue;
    counts.set(idx, (counts.get(idx) ?? 0) + 1);
  }
  const tfidf = new Array(model.vocab.length).fill(0);
  for (const [idx, c] of counts) tfidf[idx] = (1 + Math.log(c)) * model.idf[idx];
  const tfidfNorm = norm(tfidf);
  if (tfidfNorm > 0) for (let i = 0; i < tfidf.length; i++) tfidf[i] /= tfidfNorm;

  const latent = model.components.map((row) => dot(row, tfidf));
  const latentNorm = norm(latent);
  if (latentNorm > 0) for (let i = 0; i < latent.length; i++) latent[i] /= latentNorm;
  return latent;
}

export function getModelStats(): { vocabSize: number; svdDims: number } {
  return { vocabSize: model.vocab.length, svdDims: model.svd_dims };
}

export type PlacementResult = {
  clusterId: number;
  clusterLabel: string;
  clusterSimilarity: number;
  x: number;
  y: number;
  neighbors: PlacementNeighbor[];
  reviewers: CandidateReviewer[];
  matchedTermCount: number;
};

// Optional narrowing for the displayed "nearest articles" only. When set, the
// neighbor list is re-ranked over the whole corpus WITHIN the filter (so a
// rare journal+year still surfaces its genuinely most-similar papers, not just
// whichever happened to land in the overall top-K). Cluster/xy placement and
// the reviewer pool deliberately ignore these - placement must stay stable
// regardless of the filter, and reviewers should be drawn from the full field.
export type PlacementFilters = {
  yearMin?: number;
  yearMax?: number;
  journalId?: number;
};

// The UI reveals these a page at a time. reviewerPoolSize is deliberately left
// alone: the 30 nearest articles already yield ~110 distinct authors, so the
// deeper list costs nothing and the leading ranks stay exactly as they were.
const MAX_REVIEWERS = 100;

export function placeArticle(
  title: string,
  abstract: string,
  topK = 10,
  reviewerPoolSize = 30,
  filters: PlacementFilters = {},
): PlacementResult {
  const latent = projectToLatent(title, abstract);
  const matchedTermCount = tokenize(`${title} ${title} ${title} ${abstract}`).filter((t) =>
    vocabIndex.has(t),
  ).length;

  const sims = model.article_vectors.map((vec) => dot(vec, latent));
  // A wider pool feeds the reviewer suggestions (more candidate authors to
  // rank), while the displayed "nearest articles" and cluster/xy placement
  // stay tighter, to the closest matches only.
  const fullOrder = [...sims.keys()].sort((a, b) => sims[b] - sims[a]).slice(0, reviewerPoolSize);
  const order = fullOrder.slice(0, topK);

  // Assign by plurality vote among the nearest neighbors (weighted by
  // similarity) rather than nearest cluster centroid: centroid similarity
  // reflects a cluster's average member, which can point to a different
  // cluster than where this document's actual nearest neighbors sit,
  // especially for small/diffuse clusters - confusing next to a neighbor
  // list that doesn't agree with the labeled topic.
  const clusterWeight = new Map<number, number>();
  for (const i of order) {
    const cid = articles[i].cluster_id;
    clusterWeight.set(cid, (clusterWeight.get(cid) ?? 0) + Math.max(sims[i], 0));
  }
  let bestCluster = order.length ? articles[order[0]].cluster_id : 0;
  let bestWeight = -Infinity;
  for (const [cid, w] of clusterWeight) {
    if (w > bestWeight) {
      bestWeight = w;
      bestCluster = cid;
    }
  }
  const clusterSims = model.cluster_centroids.map((c) => dot(c, latent));

  // Neighbors: when a year/journal filter is active, re-rank the ENTIRE corpus
  // within the filter (not just the unfiltered top-K) so the closest matches in
  // that slice always surface. With no filter this is exactly `order`.
  const { yearMin, yearMax, journalId } = filters;
  const filtered = yearMin !== undefined || yearMax !== undefined || journalId !== undefined;
  const neighborOrder = filtered
    ? [...sims.keys()]
        .filter((i) => {
          const a = articles[i];
          if (journalId !== undefined && a.journal_id !== journalId) return false;
          if (yearMin !== undefined && (a.year == null || a.year < yearMin)) return false;
          if (yearMax !== undefined && (a.year == null || a.year > yearMax)) return false;
          return true;
        })
        .sort((a, b) => sims[b] - sims[a])
        .slice(0, topK)
    : order;
  const neighbors = neighborOrder.map((i) => toNeighbor(articles[i], sims[i]));

  const topForXY = order.slice(0, 8);
  let wx = 0, wy = 0, wsum = 0;
  for (const i of topForXY) {
    const w = Math.max(sims[i], 0.001);
    wx += w * articles[i].x;
    wy += w * articles[i].y;
    wsum += w;
  }

  // Candidate reviewers: authors of the nearest articles, ranked by the
  // summed similarity of the articles they co-authored (so someone who
  // wrote two closely-related papers outranks someone who wrote one
  // marginally-related one).
  const byAuthor = new Map<
    string,
    { display_name: string; orcid: string | null; score: number; papers: CandidateReviewer["papers"] }
  >();
  for (const i of fullOrder) {
    const sim = sims[i];
    if (sim <= 0) continue;
    const art = articles[i];
    for (const au of art.authors) {
      const entry = byAuthor.get(au.id) ?? {
        display_name: au.display_name,
        orcid: au.orcid,
        score: 0,
        papers: [],
      };
      entry.score += sim;
      entry.papers.push({ id: art.id, title: art.title, year: art.year, doi: art.doi, similarity: sim });
      byAuthor.set(au.id, entry);
    }
  }
  const reviewers: CandidateReviewer[] = [...byAuthor.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, MAX_REVIEWERS)
    .map(([id, e]) => ({
      id,
      display_name: e.display_name,
      orcid: e.orcid,
      score: e.score,
      papers: e.papers.sort((a, b) => b.similarity - a.similarity).slice(0, 3),
    }));

  const clusters = getClusters();
  return {
    clusterId: bestCluster,
    clusterLabel: clusters.find((c) => c.id === bestCluster)?.label ?? `Cluster ${bestCluster}`,
    clusterSimilarity: clusterSims[bestCluster],
    x: wsum > 0 ? wx / wsum : 0,
    y: wsum > 0 ? wy / wsum : 0,
    neighbors,
    reviewers,
    matchedTermCount,
  };
}
