import "server-only";
import { checkReferences } from "@/lib/references";
import { all, scope, sql, type Fragment } from "@/lib/corpus-db";
import { authorsFor } from "@/lib/data";
import type { ArticleAuthor, CandidateReviewer, PlacementNeighbor } from "@/lib/types";

/*
 * Projects a new title/abstract into the same TF-IDF -> SVD latent space the
 * corpus was built in, then asks pgvector for the nearest articles.
 *
 * The math is the one build_layout.py uses and the one this file always had:
 * sublinear term frequency, the corpus IDF, L2 normalization, the SVD
 * components. What changed on 2026-09-03 is where the other side of the
 * comparison lives. The 46,000 article vectors used to be a 40 MB JSON file
 * held in memory and scanned with a dot product per request; they are now a
 * pgvector column with an index, and the model that projects a query into
 * their space is one row in corpus_model, read once per process.
 */

interface Model {
  dims: number;
  vocab: string[];
  idf: number[];
  components: number[][];
}

let modelPromise: Promise<{ model: Model; vocabIndex: Map<string, number> }> | null = null;

function loadModel() {
  if (modelPromise) return modelPromise;
  modelPromise = (async () => {
    const [row] = await sql<
      { dims: number; vocab: string[]; idf: number[]; components: number[][] }[]
    >`select dims, vocab, idf, components from corpus_model where id = 1`;
    if (!row) throw new Error("corpus_model is empty: the corpus has not been loaded.");
    const model: Model = {
      dims: row.dims,
      vocab: row.vocab,
      idf: row.idf,
      components: row.components,
    };
    return { model, vocabIndex: new Map(model.vocab.map((t, i) => [t, i])) };
  })().catch((error) => {
    // A transient connection failure must not disable placement for the life
    // of the instance.
    modelPromise = null;
    throw error;
  });
  return modelPromise;
}

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

/** The exact text build_layout.py's doc_text() would have built for this
 *  document. A submission must be vectorized the way the corpus was, or it is
 *  compared against documents weighted differently from itself: doc_text drops
 *  the title to a single pass once there is a real abstract to lean on, and
 *  only repeats it 3x when there is no body text to carry the topic. */
export function queryText(title: string, abstract: string): string {
  const body = abstract.trim();
  const titleWeight = body ? 1 : 3;
  return `${`${title} `.repeat(titleWeight)}${body}`;
}

function projectToLatent(
  title: string,
  abstract: string,
  model: Model,
  vocabIndex: Map<string, number>,
): { latent: number[]; matchedTermCount: number } {
  const tokens = tokenize(queryText(title, abstract));
  const counts = new Map<number, number>();
  let matchedTermCount = 0;
  for (const t of tokens) {
    const idx = vocabIndex.get(t);
    if (idx === undefined) continue;
    matchedTermCount += 1;
    counts.set(idx, (counts.get(idx) ?? 0) + 1);
  }
  const weighted = new Map<number, number>();
  let norm = 0;
  for (const [idx, c] of counts) {
    const w = (1 + Math.log(c)) * model.idf[idx];
    weighted.set(idx, w);
    norm += w * w;
  }
  norm = Math.sqrt(norm) || 1;

  const latent = new Array<number>(model.dims).fill(0);
  for (const [idx, w] of weighted) {
    const scaled = w / norm;
    for (let d = 0; d < model.dims; d += 1) latent[d] += scaled * model.components[d][idx];
  }
  return { latent, matchedTermCount };
}

let iterativePromise: Promise<boolean> | null = null;

/** Whether this pgvector knows hnsw.iterative_scan, checked once per process. */
function iterativeScanAvailable(): Promise<boolean> {
  if (iterativePromise) return iterativePromise;
  iterativePromise = (async () => {
    const [row] = await sql<{ extversion: string }[]>`
      select extversion from pg_extension where extname = 'vector'`;
    const [major, minor] = (row?.extversion ?? "0.0").split(".").map(Number);
    return major > 0 || minor >= 8;
  })().catch(() => {
    iterativePromise = null;
    return false;
  });
  return iterativePromise;
}

export async function getModelStats(): Promise<{ vocabSize: number; svdDims: number }> {
  const { model } = await loadModel();
  return { vocabSize: model.vocab.length, svdDims: model.dims };
}

export type PlacementResult = {
  clusterId: number;
  clusterLabel: string;
  x: number;
  y: number;
  neighbors: PlacementNeighbor[];
  reviewers: CandidateReviewer[];
  matchedTermCount: number;
  /** Present only when a reference list was supplied. */
  citations?: {
    /** Related work in the corpus the reference list does not appear to cite. */
    uncited: PlacementNeighbor[];
    entryCount: number;
    /** How far down the ranking the check looked. */
    scanned: number;
  };
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

interface NearRow {
  openalex_id: string;
  title: string;
  year: number | null;
  journal_id: number | null;
  doi: string | null;
  cluster_id: number | null;
  map_x: number | null;
  map_y: number | null;
  similarity: number;
}

const NEAR_COLUMNS = sql`
  a.openalex_id, a.title, a.year, a.journal_id, a.doi, a.cluster_id, a.map_x, a.map_y`;

function toNeighbor(r: NearRow, authors: ArticleAuthor[]): PlacementNeighbor {
  return {
    id: r.openalex_id,
    title: r.title,
    year: r.year,
    journal_id: r.journal_id ?? -1,
    doi: r.doi,
    similarity: r.similarity,
    authors,
  };
}

export async function placeArticle(
  title: string,
  abstract: string,
  topK = 10,
  reviewerPoolSize = 30,
  filters: PlacementFilters = {},
  references = "",
): Promise<PlacementResult> {
  const { model, vocabIndex } = await loadModel();
  const { latent, matchedTermCount } = projectToLatent(title, abstract, model, vocabIndex);
  const vec = JSON.stringify(latent);
  const { where: inScope } = await scope();

  /**
   * `<=>` is cosine distance, so 1 minus it is the cosine similarity the
   * in-memory dot product used to produce. Ordered by the distance itself so
   * the index does the ranking rather than a scan.
   *
   * The index is HNSW, and an HNSW scan returns at most hnsw.ef_search rows,
   * forty by default, however large the LIMIT. The reference check asks for
   * two hundred and was silently getting forty. Raised for the transaction,
   * which also gives a journal-and-year filter more candidates to keep after
   * the index has done its part: a rare journal would otherwise come back
   * short of ten neighbours.
   */
  const nearest = (tx: typeof sql, where: Fragment, limit: number) => tx<NearRow[]>`
    select ${NEAR_COLUMNS}, 1 - (a.embedding <=> ${vec}::vector) as similarity
    from corpus_article a
    where a.openalex_id is not null and ${where}
    order by a.embedding <=> ${vec}::vector
    limit ${limit}`;

  const { yearMin, yearMax, journalId } = filters;
  const filtered = yearMin !== undefined || yearMax !== undefined || journalId !== undefined;
  const filterParts = [inScope];
  if (journalId !== undefined) filterParts.push(sql`a.journal_id = ${journalId}`);
  if (yearMin !== undefined) filterParts.push(sql`a.year >= ${yearMin}`);
  if (yearMax !== undefined) filterParts.push(sql`a.year <= ${yearMax}`);
  const withFilters = all(filterParts);

  // Reference check runs over a wider slice than the displayed neighbour list:
  // an editor wants "related work in our journals you did not cite", which is
  // a longer tail than the handful shown as nearest articles.
  const CITATION_RESULTS = 20;
  const CITATION_SCAN = 200;
  const wantCitations = references.trim().length > 0;

  // A wider pool feeds the reviewer suggestions (more candidate authors to
  // rank), while the displayed "nearest articles" and cluster/xy placement
  // stay tighter, to the closest matches only.
  const [pool, filteredNeighbors, scanned] = await sql.begin(async (tx) => {
    await tx`set local hnsw.ef_search = ${sql.unsafe(String(Math.max(CITATION_SCAN, reviewerPoolSize)))}`;
    /*
     * The scope and the filters are WHERE clauses, and an HNSW scan applies
     * them after it has picked its ef_search candidates. With a ten-year
     * window over a 35-year corpus, most of the two hundred nearest are older
     * and the reference check came back with forty-four. Iterative scanning,
     * from pgvector 0.8, keeps walking the index until the LIMIT is met.
     */
    if (await iterativeScanAvailable()) {
      await tx`set local hnsw.iterative_scan = relaxed_order`;
    }
    const p = await nearest(tx as unknown as typeof sql, inScope, reviewerPoolSize);
    const f = filtered ? await nearest(tx as unknown as typeof sql, withFilters, topK) : null;
    const c = wantCitations
      ? await nearest(tx as unknown as typeof sql, withFilters, CITATION_SCAN)
      : ([] as NearRow[]);
    return [p, f, c] as const;
  });
  const order = pool.slice(0, topK);

  // Assign by plurality vote among the nearest neighbors (weighted by
  // similarity) rather than nearest cluster centroid: centroid similarity
  // reflects a cluster's average member, which can point to a different
  // cluster than where this document's actual nearest neighbors sit,
  // especially for small/diffuse clusters - confusing next to a neighbor
  // list that doesn't agree with the labeled topic.
  const clusterWeight = new Map<number, number>();
  for (const r of order) {
    if (r.cluster_id === null) continue;
    clusterWeight.set(r.cluster_id, (clusterWeight.get(r.cluster_id) ?? 0) + Math.max(r.similarity, 0));
  }
  let bestCluster = order[0]?.cluster_id ?? 0;
  let bestWeight = -Infinity;
  for (const [cid, w] of clusterWeight) {
    if (w > bestWeight) {
      bestWeight = w;
      bestCluster = cid;
    }
  }

  // Only neighbors from the assigned cluster steer the marker's position.
  // build_layout places cluster centroids and then packs each cluster's
  // members locally around its own centroid, so map coordinates are not a
  // metric space: averaging across islands lands the marker in the gap
  // between them, or inside an unrelated island. Measured over 400 real
  // articles, the unrestricted average put the marker outside its own
  // cluster 39% of the time; restricted to the assigned cluster, 0%.
  const placed = order.filter((r) => r.map_x !== null && r.map_y !== null);
  const inCluster = placed.filter((r) => r.cluster_id === bestCluster);
  const topForXY = (inCluster.length ? inCluster : placed).slice(0, 8);
  let wx = 0, wy = 0, wsum = 0;
  for (const r of topForXY) {
    const w = Math.max(r.similarity, 0.001);
    wx += w * (r.map_x as number);
    wy += w * (r.map_y as number);
    wsum += w;
  }

  // One authors query for everything on the page: the pool, the filtered
  // neighbours, and the citation scan.
  const neighborRows = filteredNeighbors ?? order;
  const ids = [...new Set([...pool, ...neighborRows, ...scanned].map((r) => r.openalex_id))];
  const authors = await authorsFor(ids);
  const authorsOf = (r: NearRow) => authors.get(r.openalex_id) ?? [];

  const neighbors = neighborRows.map((r) => toNeighbor(r, authorsOf(r)));

  // Candidate reviewers: authors of the nearest articles, ranked by the
  // summed similarity of the articles they co-authored (so someone who
  // wrote two closely-related papers outranks someone who wrote one
  // marginally-related one).
  const byAuthor = new Map<
    string,
    { display_name: string; orcid: string | null; score: number; papers: CandidateReviewer["papers"] }
  >();
  for (const r of pool) {
    if (r.similarity <= 0) continue;
    for (const au of authorsOf(r)) {
      const entry = byAuthor.get(au.id) ?? {
        display_name: au.display_name,
        orcid: au.orcid,
        score: 0,
        papers: [],
      };
      entry.score += r.similarity;
      entry.papers.push({ id: r.openalex_id, title: r.title, year: r.year, doi: r.doi, similarity: r.similarity });
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

  // Return a full page of UNCITED work rather than a fixed slice of candidates:
  // truncating the candidate pool first meant a well-cited manuscript returned
  // almost nothing, since most of the top slice had already been cited. Scan
  // down the ranking until the page is filled or the scan budget runs out.
  let citations: PlacementResult["citations"];
  if (wantCitations) {
    const check = checkReferences(
      scanned.map((r) => ({
        id: r.openalex_id, title: r.title, doi: r.doi, year: r.year, authors: authorsOf(r),
      })),
      references,
    );
    const uncitedSet = new Set(check.uncited);
    citations = {
      uncited: scanned
        .filter((r) => uncitedSet.has(r.openalex_id))
        .slice(0, CITATION_RESULTS)
        .map((r) => toNeighbor(r, authorsOf(r))),
      entryCount: check.entryCount,
      scanned: scanned.length,
    };
  }

  const [cluster] = await sql<{ label: string }[]>`
    select label from corpus_cluster where id = ${bestCluster}`;
  return {
    clusterId: bestCluster,
    clusterLabel: cluster?.label ?? `Cluster ${bestCluster}`,
    x: wsum > 0 ? wx / wsum : 0,
    y: wsum > 0 ? wy / wsum : 0,
    neighbors,
    reviewers,
    citations,
    matchedTermCount,
  };
}
