import "server-only";
import corpusJson from "@/data/corpus.json";
import modelJson from "@/data/model.json";
import { getClusters } from "@/lib/data";
import type { Article, ArticleSummary } from "@/lib/types";

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

function shortAuthors(authors: Article["authors"]): string {
  const names = authors.map((a) => a.display_name.split(" ").pop() as string);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names[0]} et al.`;
}

function toSummary(a: Article): ArticleSummary {
  return {
    id: a.id,
    title: a.title,
    year: a.year,
    journal_id: a.journal_id,
    cluster_id: a.cluster_id,
    authorsShort: shortAuthors(a.authors),
    hasAbstract: a.has_full_abstract,
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

export type PlacementResult = {
  clusterId: number;
  clusterLabel: string;
  clusterSimilarity: number;
  x: number;
  y: number;
  neighbors: (ArticleSummary & { similarity: number })[];
  matchedTermCount: number;
};

export function placeArticle(title: string, abstract: string, topK = 10): PlacementResult {
  const latent = projectToLatent(title, abstract);
  const matchedTermCount = tokenize(`${title} ${title} ${title} ${abstract}`).filter((t) =>
    vocabIndex.has(t),
  ).length;

  const sims = model.article_vectors.map((vec) => dot(vec, latent));
  const order = [...sims.keys()].sort((a, b) => sims[b] - sims[a]).slice(0, topK);

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

  const neighbors = order.map((i) => ({ ...toSummary(articles[i]), similarity: sims[i] }));

  const topForXY = order.slice(0, 8);
  let wx = 0, wy = 0, wsum = 0;
  for (const i of topForXY) {
    const w = Math.max(sims[i], 0.001);
    wx += w * articles[i].x;
    wy += w * articles[i].y;
    wsum += w;
  }

  const clusters = getClusters();
  return {
    clusterId: bestCluster,
    clusterLabel: clusters.find((c) => c.id === bestCluster)?.label ?? `Cluster ${bestCluster}`,
    clusterSimilarity: clusterSims[bestCluster],
    x: wsum > 0 ? wx / wsum : 0,
    y: wsum > 0 ? wy / wsum : 0,
    neighbors,
    matchedTermCount,
  };
}
