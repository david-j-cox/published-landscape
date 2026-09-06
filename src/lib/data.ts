import "server-only";
import { all, journalIds, scholarlyOnly, scope, sql } from "@/lib/corpus-db";
import type {
  Article,
  ArticleAuthor,
  ArticleDetail,
  ArticleSummary,
  Cluster,
  Journal,
  MapPoint,
} from "@/lib/types";

/*
 * Every function here used to read data/corpus.json. The bodies are now SQL
 * against the shared corpus (see corpus-db.ts) and the callers changed only
 * in becoming async. Articles are addressed by OpenAlex id throughout, as
 * they always were; the corpus stores that in corpus_article.openalex_id.
 */

/**
 * Authors in the order OpenAlex lists them: first, then middle, then last.
 * A function, not a constant: a fragment built at module level would open
 * the connection on import, which `next build` does with no database.
 */
const positionOrder = () =>
  sql`case aa.position when 'first' then 0 when 'middle' then 1 else 2 end`;

function authorsShortOf(names: string[]): string {
  const surnames = names.map((n) => n.split(" ").pop() ?? n);
  if (surnames.length === 0) return "";
  if (surnames.length === 1) return surnames[0]!;
  if (surnames.length === 2) return `${surnames[0]} & ${surnames[1]}`;
  return `${surnames[0]} et al.`;
}

interface ArticleRow {
  openalex_id: string;
  journal_id: number | null;
  title: string;
  abstract: string;
  has_full_abstract: boolean;
  keywords: string[];
  year: number | null;
  publication_date: string | null;
  doi: string | null;
  type: string | null;
  map_x: number | null;
  map_y: number | null;
  cluster_id: number | null;
  related: string[];
}

/** The authors of a set of articles, keyed by the article's OpenAlex id. */
export async function authorsFor(ids: string[]): Promise<Map<string, ArticleAuthor[]>> {
  const out = new Map<string, ArticleAuthor[]>();
  if (ids.length === 0) return out;
  const rows = await sql<
    { openalex_id: string; id: string; display_name: string; orcid: string | null;
      position: string | null; is_corresponding: boolean }[]
  >`
    select a.openalex_id, au.id, au.display_name, au.orcid, aa.position, aa.is_corresponding
    from corpus_article_author aa
    join corpus_article a on a.id = aa.article_id
    join corpus_author au on au.id = aa.author_id
    where a.openalex_id = any(${ids})
    order by a.openalex_id, ${positionOrder()}, au.display_name`;
  for (const r of rows) {
    const list = out.get(r.openalex_id) ?? [];
    list.push({
      id: r.id,
      display_name: r.display_name,
      orcid: r.orcid,
      position: (r.position as ArticleAuthor["position"]) ?? null,
      is_corresponding: r.is_corresponding,
    });
    out.set(r.openalex_id, list);
  }
  return out;
}

function toArticle(r: ArticleRow, authors: ArticleAuthor[]): Article {
  return {
    id: r.openalex_id,
    journal_id: r.journal_id ?? -1,
    title: r.title,
    abstract: r.abstract || null,
    has_full_abstract: r.has_full_abstract,
    // The corpus keeps the cleaned subject tags rather than OpenAlex's scored
    // topic list; the article page shows them where an abstract is missing.
    openalex_topics: (r.keywords ?? []).map((k) => ({ display_name: k, score: null })),
    openalex_keywords: r.keywords ?? [],
    year: r.year,
    publication_date: r.publication_date,
    doi: r.doi,
    type: r.type ?? "article",
    authors,
    x: r.map_x ?? 0,
    y: r.map_y ?? 0,
    cluster_id: r.cluster_id ?? -1,
    related: r.related ?? [],
  };
}

function toSummary(a: Article): ArticleSummary {
  return {
    id: a.id,
    title: a.title,
    year: a.year,
    journal_id: a.journal_id,
    cluster_id: a.cluster_id,
    authorsShort: authorsShortOf(a.authors.map((au) => au.display_name)),
    hasAbstract: a.has_full_abstract,
  };
}

const articleColumns = () => sql`
  a.openalex_id, a.journal_id, a.title, a.abstract, a.has_full_abstract, a.keywords,
  a.year, a.publication_date, a.doi, a.type, a.map_x, a.map_y, a.cluster_id, a.related`;

/** The journals in scope: the ones the filters, legend and map can show. */
export async function getJournals(): Promise<Journal[]> {
  const ids = await journalIds();
  const rows = await sql<
    { id: number; name: string; issn_l: string | null; openalex_source_id: string | null }[]
  >`select id, name, issn_l, openalex_source_id from corpus_journal
    where ${ids ? sql`id = any(${ids})` : sql`true`} order by id`;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    issn_l: r.issn_l ?? "",
    openalex_source_id: r.openalex_source_id ?? "",
  }));
}

/** Topic groups with how many in-scope articles each holds, largest first. */
export async function getClusters(): Promise<Cluster[]> {
  const rows = await sql<{ id: number; label: string; count: number }[]>`
    select c.id, c.label, count(a.id)::int as count
    from corpus_cluster c
    left join corpus_article a on a.cluster_id = c.id and ${(await scope()).where}
    group by c.id, c.label
    having count(a.id) > 0
    order by count desc, c.id`;
  return rows;
}

/*
 * The whole map, cached for a while. Forty-six thousand rows with an author
 * string each is the largest thing this app sends, the corpus changes once a
 * week, and every visit to /map would otherwise run the same query.
 */
let mapCache: { at: number; points: MapPoint[] } | null = null;
const MAP_TTL_MS = 10 * 60 * 1000;

export async function getMapPoints(): Promise<MapPoint[]> {
  if (mapCache && Date.now() - mapCache.at < MAP_TTL_MS) return mapCache.points;
  const rows = await sql<
    { openalex_id: string; map_x: number; map_y: number; cluster_id: number;
      journal_id: number; year: number | null; title: string; names: string | null }[]
  >`
    select a.openalex_id, a.map_x, a.map_y, a.cluster_id, a.journal_id, a.year, a.title,
      (select string_agg(au.display_name, '|' order by ${positionOrder()}, au.display_name)
         from corpus_article_author aa join corpus_author au on au.id = aa.author_id
        where aa.article_id = a.id) as names
    from corpus_article a
    where a.map_x is not null and a.map_y is not null and a.cluster_id is not null
      and a.openalex_id is not null and ${(await scope()).where}`;
  const points = rows.map((r) => ({
    id: r.openalex_id,
    x: r.map_x,
    y: r.map_y,
    cluster_id: r.cluster_id,
    journal_id: r.journal_id,
    year: r.year,
    title: r.title,
    authorsShort: authorsShortOf(r.names ? r.names.split("|") : []),
  }));
  mapCache = { at: Date.now(), points };
  return points;
}

export type ArticleFilters = {
  query?: string;
  journalId?: number;
  clusterId?: number;
  year?: number;
  page?: number;
  pageSize?: number;
};

export async function getArticles(filters: ArticleFilters = {}): Promise<{
  results: ArticleSummary[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const { query, journalId, clusterId, year, page = 1, pageSize = 25 } = filters;
  const q = query?.trim();

  const parts = [(await scope()).where];
  if (journalId !== undefined) parts.push(sql`a.journal_id = ${journalId}`);
  if (clusterId !== undefined) parts.push(sql`a.cluster_id = ${clusterId}`);
  if (year !== undefined) parts.push(sql`a.year = ${year}`);
  if (q) {
    const like = `%${q}%`;
    parts.push(sql`(
      a.title ilike ${like} or a.abstract ilike ${like}
      or exists (
        select 1 from corpus_article_author aa join corpus_author au on au.id = aa.author_id
        where aa.article_id = a.id and au.display_name ilike ${like}))`);
  }
  const where = all(parts);

  const rows = await sql<(ArticleRow & { total: number })[]>`
    select ${articleColumns()}, count(*) over()::int as total
    from corpus_article a
    where a.openalex_id is not null and ${where}
    order by a.year desc nulls last, a.title
    limit ${pageSize} offset ${(page - 1) * pageSize}`;
  const authors = await authorsFor(rows.map((r) => r.openalex_id));
  return {
    results: rows.map((r) => toSummary(toArticle(r, authors.get(r.openalex_id) ?? []))),
    total: rows[0]?.total ?? 0,
    page,
    pageSize,
  };
}

/*
 * Addressed by id, so the year window and the journal list do not apply: a
 * link to an article from outside the current window should still open, and
 * an out-of-scope journal is already refused by getArticleById, which cannot
 * find a journal to show. What does apply is scholarlyOnly. An obituary is
 * not an article whichever way a reader arrives at it, and without this the
 * one route that skips scope() was the one that made them reachable.
 */
export async function getArticlesByIds(ids: string[]): Promise<Article[]> {
  if (ids.length === 0) return [];
  const scholarly = await scholarlyOnly();
  const rows = await sql<ArticleRow[]>`
    select ${articleColumns()} from corpus_article a
    where a.openalex_id = any(${ids}) and ${scholarly.where}`;
  const authors = await authorsFor(ids);
  const byId = new Map(rows.map((r) => [r.openalex_id, r]));
  return ids.flatMap((id) => {
    const r = byId.get(id);
    return r ? [toArticle(r, authors.get(id) ?? [])] : [];
  });
}

export async function getArticleById(id: string): Promise<ArticleDetail | null> {
  const [article] = await getArticlesByIds([id]);
  if (!article) return null;
  const [journals, clusters] = await Promise.all([getJournals(), sql<Cluster[]>`
    select id, label, count from corpus_cluster where id = ${article.cluster_id}`]);
  const journal = journals.find((j) => j.id === article.journal_id);
  const cluster = clusters[0];
  if (!journal || !cluster) return null;
  const relatedArticles = (await getArticlesByIds(article.related)).map(toSummary);
  return { ...article, journal, cluster, relatedArticles };
}

export async function getCorpusStats(): Promise<{ articles: number; abstractCoverage: number }> {
  const [row] = await sql<{ n: number; with_abstract: number }[]>`
    select count(*)::int as n, count(*) filter (where a.has_full_abstract)::int as with_abstract
    from corpus_article a where ${(await scope()).where}`;
  return {
    articles: row?.n ?? 0,
    abstractCoverage: row && row.n > 0 ? row.with_abstract / row.n : 0,
  };
}

export async function getYears(): Promise<number[]> {
  const rows = await sql<{ year: number }[]>`
    select distinct a.year from corpus_article a
    where a.year is not null and ${(await scope()).where} order by a.year desc`;
  return rows.map((r) => r.year);
}
