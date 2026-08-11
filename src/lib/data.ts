import "server-only";
import corpusJson from "@/data/corpus.json";
import type { Article, ArticleDetail, ArticleSummary, Cluster, Journal, MapPoint } from "@/lib/types";

// v1 data source: the OpenAlex-derived static corpus checked into the repo
// (scripts/ingest_openalex.py + scripts/build_layout.py). Every function
// here is written so that swapping to live Supabase queries later only
// means rewriting these bodies - callers (pages, API routes) don't change.
const corpus = corpusJson as {
  journals: Journal[];
  clusters: Cluster[];
  articles: Article[];
};

const articlesById = new Map(corpus.articles.map((a) => [a.id, a]));
const journalsById = new Map(corpus.journals.map((j) => [j.id, j]));
const clustersById = new Map(corpus.clusters.map((c) => [c.id, c]));

function authorsShort(article: Article): string {
  const names = article.authors.map((a) => a.display_name.split(" ").pop());
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
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
    authorsShort: authorsShort(a),
    hasAbstract: a.has_full_abstract,
  };
}

export function getJournals(): Journal[] {
  return corpus.journals;
}

export function getClusters(): Cluster[] {
  return [...corpus.clusters].sort((a, b) => b.count - a.count);
}

export function getMapPoints(): MapPoint[] {
  return corpus.articles.map((a) => ({
    id: a.id,
    x: a.x,
    y: a.y,
    cluster_id: a.cluster_id,
    journal_id: a.journal_id,
    year: a.year,
    title: a.title,
    authorsShort: authorsShort(a),
  }));
}

export type ArticleFilters = {
  query?: string;
  journalId?: number;
  clusterId?: number;
  year?: number;
  page?: number;
  pageSize?: number;
};

export function getArticles(filters: ArticleFilters = {}): {
  results: ArticleSummary[];
  total: number;
  page: number;
  pageSize: number;
} {
  const { query, journalId, clusterId, year, page = 1, pageSize = 25 } = filters;
  const q = query?.trim().toLowerCase();

  let matches = corpus.articles;
  if (journalId !== undefined) matches = matches.filter((a) => a.journal_id === journalId);
  if (clusterId !== undefined) matches = matches.filter((a) => a.cluster_id === clusterId);
  if (year !== undefined) matches = matches.filter((a) => a.year === year);
  if (q) {
    matches = matches.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        (a.abstract && a.abstract.toLowerCase().includes(q)) ||
        a.authors.some((au) => au.display_name.toLowerCase().includes(q)),
    );
  }

  matches = [...matches].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  const total = matches.length;
  const start = (page - 1) * pageSize;
  const results = matches.slice(start, start + pageSize).map(toSummary);
  return { results, total, page, pageSize };
}

export function getArticleById(id: string): ArticleDetail | null {
  const article = articlesById.get(id);
  if (!article) return null;
  const journal = journalsById.get(article.journal_id);
  const cluster = clustersById.get(article.cluster_id);
  if (!journal || !cluster) return null;
  const relatedArticles = article.related
    .map((rid) => articlesById.get(rid))
    .filter((a): a is Article => Boolean(a))
    .map(toSummary);
  return { ...article, journal, cluster, relatedArticles };
}

export function getCorpusStats(): { articles: number; abstractCoverage: number } {
  const withAbstract = corpus.articles.filter((a) => a.has_full_abstract).length;
  return {
    articles: corpus.articles.length,
    abstractCoverage: withAbstract / corpus.articles.length,
  };
}

export function getYears(): number[] {
  const years = new Set(corpus.articles.map((a) => a.year).filter((y): y is number => y != null));
  return [...years].sort((a, b) => b - a);
}
