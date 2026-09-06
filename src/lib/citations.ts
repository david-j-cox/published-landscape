import "server-only";
import { scope, sql } from "@/lib/corpus-db";

/**
 * The citation graph, read from the Writer's Trellis corpus.
 *
 * Four columns and one table arrived on the shared corpus after this app
 * started reading it (Trellis migrations 0067 and 0068, on production since
 * 4 September 2026): corpus_article.cited_by_count is OpenAlex's lifetime
 * count from anywhere, cited_by_year the same broken out by year, refs_total
 * and refs_in_corpus how many works an article cites and how many of those
 * are here, and corpus_citation is one row per reference from one article in
 * the corpus to another -- 368,947 edges.
 *
 * Everything in this file is a question that could not be asked before:
 * whether a finding travels outside these journals, how a topic's output and
 * its citations moved over the years, and whether the applied literature has
 * taken up what the basic literature found.
 *
 * Two limits the wording upstream is careful about, and so is this file.
 * "Cited", never "included" or "covered": a reference list does not separate
 * what a paper synthesised from what it read for its introduction. And
 * coverage thins going back, because OpenAlex holds reference lists for most
 * recent work and much less of the older literature -- an older article with
 * no citing paper here may only mean nobody deposited the references that
 * would prove otherwise.
 */

/**
 * Whether corpus_citation can be read at all.
 *
 * The corpus_reader role is granted table by table, deliberately, so a new
 * table does not join the list by accident (thesis-scaffold's
 * scripts/create-corpus-reader.sql). The GRANT for corpus_citation was added
 * to that script on 3 September, after the role was first provisioned here,
 * so a deployment can be pointed at a corpus whose graph it cannot select
 * from. Probed once per process rather than assumed: the views that need the
 * graph hide themselves, and the rest of the app is unaffected.
 */
let graphProbe: Promise<boolean> | null = null;

/**
 * Whether corpus_article carries cited_here_count.
 *
 * The same number this file computes by counting corpus_citation rows, but
 * precomputed by the weekly pipeline (Trellis migration 0072). Where it
 * exists it replaces an aggregate over 368,947 edges with a column read, and
 * where it does not the count is still correct, just dearer. Probed for the
 * same reason as everything else here: the column lands on the other
 * project's schedule.
 */
let citedHereProbe: Promise<boolean> | null = null;

export function citedHereCounted(): Promise<boolean> {
  if (citedHereProbe) return citedHereProbe;
  citedHereProbe = (async () => {
    const rows = await sql<{ n: number }[]>`
      select count(*)::int as n from information_schema.columns
      where table_name = 'corpus_article' and column_name = 'cited_here_count'`;
    return (rows[0]?.n ?? 0) > 0;
  })().catch((error) => {
    citedHereProbe = null;
    throw error;
  });
  return citedHereProbe;
}

export function citationGraphAvailable(): Promise<boolean> {
  if (graphProbe) return graphProbe;
  graphProbe = (async () => {
    try {
      await sql`select 1 from corpus_citation limit 1`;
      return true;
    } catch (error) {
      console.error(
        "[citations] corpus_citation is not readable; the citation views are hidden.",
        error instanceof Error ? error.message : error,
      );
      return false;
    }
  })();
  return graphProbe;
}

export type CitationCounts = {
  /** OpenAlex's lifetime count, from any journal anywhere. */
  citedByCount: number;
  /** Citations from inside this corpus. Null when the graph is unreadable. */
  citedHere: number | null;
  /**
   * Citations from outside these journals: the lifetime count less the ones
   * from inside. Null when the graph is unreadable, and floored at zero --
   * OpenAlex's count and the edges here are refreshed on different days, so
   * the subtraction can go slightly negative on a recent paper.
   */
  reach: number | null;
  /** How many works it cites, and how many of those are in this corpus. */
  refsTotal: number;
  refsInCorpus: number;
  /** Citations per year, oldest first. OpenAlex keeps roughly the last decade. */
  byYear: { year: number; count: number }[];
};

/**
 * Whether a per-year citation count sits before the work it belongs to.
 *
 * OpenAlex's counts_by_year carries a stray bucket on some records -- a
 * single citation filed years before the article was published, 665 of them
 * across 631 articles in the corpus on 5 September 2026, most often 2012 or
 * 2013. Nothing can cite a paper that does not exist yet, so these are
 * dropped rather than drawn. Left in, they stretch every citation chart back
 * a decade to show one bar and a gap.
 */
function isBeforePublication(year: number, published: number | null): boolean {
  return published !== null && year < published;
}

function reachOf(citedByCount: number, citedHere: number | null): number | null {
  if (citedHere === null) return null;
  return Math.max(citedByCount - citedHere, 0);
}

/** The citation record of one article, by OpenAlex id. */
export async function citationsFor(openalexId: string): Promise<CitationCounts | null> {
  const [hasGraph, hasColumn] = await Promise.all([
    citationGraphAvailable(),
    citedHereCounted(),
  ]);
  const [row] = await sql<
    {
      year: number | null;
      cited_by_count: number;
      cited_by_year: Record<string, number> | null;
      refs_total: number;
      refs_in_corpus: number;
      cited_here: number | null;
    }[]
  >`
    select a.year, a.cited_by_count, a.cited_by_year, a.refs_total, a.refs_in_corpus,
      ${
        hasColumn
          ? sql`a.cited_here_count`
          : hasGraph
            ? sql`(select count(*)::int from corpus_citation c where c.cited = a.openalex_id)`
            : sql`null::int`
      } as cited_here
    from corpus_article a
    where a.openalex_id = ${openalexId}`;
  if (!row) return null;
  const citedHere = row.cited_here === null ? null : Number(row.cited_here);
  return {
    citedByCount: Number(row.cited_by_count ?? 0),
    citedHere,
    reach: reachOf(Number(row.cited_by_count ?? 0), citedHere),
    refsTotal: Number(row.refs_total ?? 0),
    refsInCorpus: Number(row.refs_in_corpus ?? 0),
    byYear: Object.entries(row.cited_by_year ?? {})
      .map(([year, count]) => ({ year: Number(year), count: Number(count) }))
      .filter((p) => Number.isFinite(p.year) && !isBeforePublication(p.year, row.year))
      .sort((a, b) => a.year - b.year),
  };
}

export type Reach = { citedByCount: number; citedHere: number; reach: number };

/*
 * Reach for every article on the map, cached alongside it.
 *
 * The map is drawn once per visit from a ten-minute cache (getMapPoints), and
 * this is the same shape of query against the same rows, so it is cached the
 * same way rather than run per visitor. Null when the graph cannot be read,
 * which is what makes the Reach mode disappear rather than error.
 */
let reachCache: { at: number; byId: Map<string, Reach> } | null = null;
const REACH_TTL_MS = 10 * 60 * 1000;

export async function reachByArticle(): Promise<Map<string, Reach> | null> {
  const [hasGraph, hasColumn] = await Promise.all([
    citationGraphAvailable(),
    citedHereCounted(),
  ]);
  if (!hasGraph && !hasColumn) return null;
  if (reachCache && Date.now() - reachCache.at < REACH_TTL_MS) return reachCache.byId;
  const inScope = (await scope()).where;
  const rows = hasColumn
    ? await sql<{ openalex_id: string; cited_by_count: number; cited_here: number }[]>`
        select a.openalex_id, a.cited_by_count, a.cited_here_count as cited_here
        from corpus_article a
        where a.openalex_id is not null and ${inScope}`
    : await sql<{ openalex_id: string; cited_by_count: number; cited_here: number }[]>`
        with scoped as (
          select a.openalex_id, a.cited_by_count
          from corpus_article a
          where a.openalex_id is not null and ${inScope}
        ),
        inside as (select c.cited, count(*)::int as n from corpus_citation c group by c.cited)
        select s.openalex_id, s.cited_by_count, coalesce(i.n, 0)::int as cited_here
        from scoped s left join inside i on i.cited = s.openalex_id`;
  const byId = new Map<string, Reach>();
  for (const r of rows) {
    const citedByCount = Number(r.cited_by_count ?? 0);
    const citedHere = Number(r.cited_here ?? 0);
    byId.set(r.openalex_id, {
      citedByCount,
      citedHere,
      reach: Math.max(citedByCount - citedHere, 0),
    });
  }
  reachCache = { at: Date.now(), byId };
  return byId;
}

export type TopicYear = {
  year: number;
  /** Articles published in this topic that year. */
  articles: number;
  /** Citations this topic's articles received that year, from anywhere. */
  citations: number;
};

export type TopicTrend = {
  clusterId: number;
  label: string;
  total: number;
  byYear: TopicYear[];
};

/**
 * Every topic's output and its citations, year by year.
 *
 * Two different measurements on one axis, and they do not cover the same
 * span. Publication counts run the length of the window this app shows.
 * Citation counts come from cited_by_year, which OpenAlex keeps for roughly
 * the last decade, so the citation line simply stops before the publication
 * line does. Callers draw only the years that carry both rather than letting
 * a reader read the truncation as a collapse in citation.
 */
export async function topicTrends(): Promise<TopicTrend[]> {
  const inScope = (await scope()).where;
  const [published, cited, labels] = await Promise.all([
    sql<{ cluster_id: number; year: number; n: number }[]>`
      select a.cluster_id, a.year, count(*)::int as n
      from corpus_article a
      where a.year is not null and a.cluster_id is not null and ${inScope}
      group by a.cluster_id, a.year`,
    /*
     * jsonb_each_text over cited_by_year turns {"2019": 4, "2020": 7} into
     * rows. A lateral join rather than a comma join so an article with an
     * empty object does not drop out of the count on the other side.
     *
     * Buckets earlier than the article's own year are dropped here for the
     * reason isBeforePublication gives: they are an artifact of OpenAlex's
     * data, and they are what would otherwise set the left edge of every
     * topic's citation chart.
     */
    sql<{ cluster_id: number; year: number; n: number }[]>`
      select a.cluster_id, y.key::int as year, sum(y.value::numeric)::int as n
      from corpus_article a
      cross join lateral jsonb_each_text(a.cited_by_year) y
      where a.cluster_id is not null
        and (a.year is null or y.key::int >= a.year)
        and ${inScope}
      group by a.cluster_id, y.key`,
    sql<{ id: number; label: string }[]>`select id, label from corpus_cluster`,
  ]);

  const labelOf = new Map(labels.map((c) => [c.id, c.label]));
  const byCluster = new Map<number, Map<number, TopicYear>>();
  const yearOf = (clusterId: number, year: number) => {
    let years = byCluster.get(clusterId);
    if (!years) byCluster.set(clusterId, (years = new Map()));
    let point = years.get(year);
    if (!point) years.set(year, (point = { year, articles: 0, citations: 0 }));
    return point;
  };
  for (const r of published) yearOf(r.cluster_id, r.year).articles += Number(r.n);
  for (const r of cited) {
    if (!Number.isFinite(r.year)) continue;
    yearOf(r.cluster_id, r.year).citations += Number(r.n);
  }

  return [...byCluster.entries()]
    .map(([clusterId, years]) => {
      const byYear = [...years.values()].sort((a, b) => a.year - b.year);
      return {
        clusterId,
        label: labelOf.get(clusterId) ?? `Topic ${clusterId}`,
        total: byYear.reduce((s, y) => s + y.articles, 0),
        byYear,
      };
    })
    .filter((t) => t.total > 0)
    .sort((a, b) => b.total - a.total);
}

/**
 * Which journals are basic and which are applied, by ISSN-L.
 *
 * Trellis keys the same split on corpus_journal.id, which is the pipeline's
 * own index, assigned by the order of JOURNALS in ingest_openalex.py. This
 * app keys everything on the ISSN-L instead, as its map colors already do:
 * the index moves when a journal is added ahead of another, and the ISSN-L
 * does not.
 *
 * The Psychological Record, Perspectives, Behavior Modification, The
 * Analysis of Verbal Behavior, Behavior and Social Issues and the
 * developmental journals are wholly neither, and are left out of both sides
 * rather than assigned to one, so a crossing is a crossing and not a guess.
 * They are still counted, as `other`, because a reader should be able to see
 * how much of a topic the question does not speak for.
 */
const BASIC_ISSNS = [
  "0022-5002", // Journal of the Experimental Analysis of Behavior
  "0376-6357", // Behavioural Processes
  "1543-4494", // Learning & Behavior
  "2329-8456", // Journal of Experimental Psychology: Animal Learning and Cognition
];

const APPLIED_ISSNS = [
  "0021-8855", // Journal of Applied Behavior Analysis
  "1998-1929", // Behavior Analysis in Practice
  "1072-0847", // Behavioral Interventions
  "2372-9414", // Behavior Analysis: Research and Practice
  "0748-8491", // Education and Treatment of Children
  "1053-0819", // Journal of Behavioral Education
  "1098-3007", // Journal of Positive Behavior Interventions (only in scope when
  //              CORPUS_JOURNALS names it; see corpus-db.ts)
];

let splitPromise: Promise<{ basic: number[]; applied: number[] }> | null = null;

/** The two sides as journal ids, resolved from the ISSN-Ls once per process. */
function journalSplit(): Promise<{ basic: number[]; applied: number[] }> {
  if (splitPromise) return splitPromise;
  splitPromise = (async () => {
    const rows = await sql<{ id: number; issn_l: string }[]>`
      select id, issn_l from corpus_journal
      where issn_l = any(${[...BASIC_ISSNS, ...APPLIED_ISSNS]})`;
    const idsFor = (issns: string[]) =>
      rows.filter((r) => issns.includes(r.issn_l)).map((r) => r.id);
    return { basic: idsFor(BASIC_ISSNS), applied: idsFor(APPLIED_ISSNS) };
  })().catch((error) => {
    splitPromise = null;
    throw error;
  });
  return splitPromise;
}

export type TranslationArticle = {
  id: string;
  title: string;
  year: number | null;
  journalId: number;
  doi: string | null;
  citedByCount: number;
  /** How many applied articles in this corpus cite it. */
  appliedCiters: number;
};

export type Translation = {
  basic: number;
  applied: number;
  other: number;
  /** Basic work in this topic that the applied journals cite, most cited first. */
  bridges: TranslationArticle[];
  /** Basic work in this topic that no applied article here cites. */
  gaps: TranslationArticle[];
};

/**
 * Basic to applied, for one topic: which of the basic findings in it the
 * applied literature has taken up, and which it has not.
 *
 * The basic side is held to this app's scope, because it is what a reader is
 * looking at. The citing side deliberately is not: an applied paper from 2004
 * that took up a finding is uptake, and hiding it behind the ten-year window
 * would report a gap where there is a bridge. Only the journal has to be an
 * applied one.
 *
 * A gap is not a verdict. The reference lists thin out going back, so the
 * older an article is, the more readily it lands in this list without having
 * been ignored.
 */
export async function translationForTopic(clusterId: number): Promise<Translation | null> {
  if (!(await citationGraphAvailable())) return null;
  const { basic, applied } = await journalSplit();
  if (basic.length === 0 || applied.length === 0) return null;
  const inScope = (await scope()).where;

  const [counts] = await sql<{ basic: number; applied: number; other: number }[]>`
    select
      count(*) filter (where a.journal_id = any(${basic}))::int as basic,
      count(*) filter (where a.journal_id = any(${applied}))::int as applied,
      count(*) filter (where not (a.journal_id = any(${[...basic, ...applied]})))::int as other
    from corpus_article a
    where a.cluster_id = ${clusterId} and ${inScope}`;

  const rows = await sql<
    {
      openalex_id: string;
      title: string;
      year: number | null;
      journal_id: number;
      doi: string | null;
      cited_by_count: number;
      applied_citers: number;
    }[]
  >`
    select a.openalex_id, a.title, a.year, a.journal_id, a.doi, a.cited_by_count,
      (select count(*)::int
         from corpus_citation c
         join corpus_article citer on citer.openalex_id = c.citing
        where c.cited = a.openalex_id and citer.journal_id = any(${applied})) as applied_citers
    from corpus_article a
    where a.cluster_id = ${clusterId} and a.journal_id = any(${basic})
      and a.openalex_id is not null and ${inScope}`;

  const shaped: TranslationArticle[] = rows.map((r) => ({
    id: r.openalex_id,
    title: r.title,
    year: r.year,
    journalId: r.journal_id,
    doi: r.doi,
    citedByCount: Number(r.cited_by_count ?? 0),
    appliedCiters: Number(r.applied_citers ?? 0),
  }));

  return {
    basic: Number(counts?.basic ?? 0),
    applied: Number(counts?.applied ?? 0),
    other: Number(counts?.other ?? 0),
    bridges: shaped
      .filter((a) => a.appliedCiters > 0)
      .sort((a, b) => b.appliedCiters - a.appliedCiters || b.citedByCount - a.citedByCount),
    // The interesting gap is a finding the wider literature rates and the
    // applied journals here have not cited, so the well-cited come first.
    gaps: shaped
      .filter((a) => a.appliedCiters === 0)
      .sort((a, b) => b.citedByCount - a.citedByCount || (b.year ?? 0) - (a.year ?? 0)),
  };
}
