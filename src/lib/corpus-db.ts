import "server-only";
import postgres from "postgres";

/**
 * The literature, read from the Writer's Trellis database.
 *
 * Until 2026-09-03 this app carried its own corpus in data/corpus.json and
 * data/model.json, built by scripts/ here. The thesis-scaffold project forked
 * that pipeline and outran it: 46,000 articles across 35 years against 7,700
 * across 10, vectors in pgvector instead of in memory, and the citation edges
 * from every review in the corpus. Rather than port each new feature onto the
 * smaller copy, this app reads that corpus, through a role that can SELECT
 * from the corpus tables and reach nothing else.
 *
 * CORPUS_DATABASE_URL is that role's pooled Neon connection string. The two
 * optional scope variables narrow what this app shows without touching what
 * is stored: CORPUS_YEARS_BACK keeps the last N years (ten by default), and
 * CORPUS_JOURNALS is a comma-separated list of ISSN-Ls (the behavior-analytic
 * journals by default, see DEFAULT_JOURNALS). "all" on either shows the lot.
 */
const url = process.env.CORPUS_DATABASE_URL;

export const isCorpusConfigured = Boolean(url);

const isPooled = /pgbouncer=true|-pooler\./.test(url ?? "");
const isLocal = /localhost|127\.0\.0\.1/.test(url ?? "");

const globalForCorpus = globalThis as unknown as {
  corpusSql: ReturnType<typeof postgres> | undefined;
};

function connect() {
  if (!url) {
    throw new Error(
      "CORPUS_DATABASE_URL is not set. This app reads the literature from the Writer's Trellis database; see README.md.",
    );
  }
  return postgres(url, {
    // Serverless functions are single-request; a large pool per instance only
    // multiplies connections against the database.
    max: process.env.NODE_ENV === "production" ? 1 : 5,
    // PgBouncer in transaction mode cannot hold prepared statements.
    prepare: !isPooled,
    ssl: isLocal ? false : "require",
    idle_timeout: 20,
    connect_timeout: 10,
  });
}

function instance() {
  if (!globalForCorpus.corpusSql) globalForCorpus.corpusSql = connect();
  return globalForCorpus.corpusSql;
}

type Sql = ReturnType<typeof postgres>;

/**
 * Connected on first use, not on import.
 *
 * `next build` imports every route module to collect page data, in an
 * environment that has no database: CI has no CORPUS_DATABASE_URL at all,
 * and a Vercel build does not need one. Opening the connection at module
 * level threw there and failed the build (2026-09-03). The proxy forwards a
 * tagged-template call and every property (`begin`, `json`, `unsafe`) to a
 * real instance created the first time anything asks.
 */
export const sql: Sql = new Proxy(function proxied() {} as unknown as Sql, {
  apply(_target, _thisArg, args: unknown[]) {
    return (instance() as unknown as (...a: unknown[]) => unknown)(...args);
  },
  get(_target, prop) {
    const real = instance() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(real) : value;
  },
});

export type Fragment = ReturnType<typeof sql>;

/**
 * A scope, wrapped. A postgres.js fragment is a thenable, so returning one
 * from an async function would have the promise adopt it and run it as a
 * query of its own. Wrapped in an object it is inert until it is spliced into
 * a real statement.
 */
export type Scope = { where: Fragment };

/** ANDs fragments together, starting from a condition that is always true. */
export function all(parts: Fragment[]): Fragment {
  return parts.reduce((acc, part) => sql`${acc} and ${part}`, sql`true`);
}

/**
 * The years in scope, as a lower bound on the year column, or null for all.
 *
 * Twelve years unless CORPUS_YEARS_BACK says otherwise: an editor looking for
 * a reviewer wants who is publishing now, and the map draws a circle per
 * point, which is comfortable at sixteen thousand points and not at
 * forty-six. Setting it to 0 or "all" shows the whole corpus. Computed
 * against the current year, so the window rolls forward without anyone
 * editing an environment variable each January.
 *
 * Ten until 2026-09-06, when the topic cone made the cost of the shorter
 * window visible: it marks a plane every five years, and a ten-year window
 * drew exactly one of them, which gives the eye a single height to read
 * everything against. Twelve reaches 2015, so a cone now carries 2015, 2020
 * and 2025. It costs 1,353 articles, 7,681 to 9,034 measured against
 * production, which the map absorbs without noticing.
 */
const DEFAULT_YEARS_BACK = 12;

export function yearFloor(): number | null {
  const raw = (process.env.CORPUS_YEARS_BACK ?? "").trim().toLowerCase();
  if (raw === "all") return null;
  const back = raw === "" ? DEFAULT_YEARS_BACK : Number(raw);
  if (!Number.isFinite(back) || back <= 0) return null;
  return new Date().getUTCFullYear() - Math.floor(back) + 1;
}

/**
 * The behavior-analytic journals, by ISSN-L.
 *
 * The shared corpus also holds seven journals the Writer's Trellis added for
 * the school-based and autism work that reviews draw on: JADD, Research in
 * Developmental Disabilities, JPBI, Focus on Autism, AJIDD, AAC, and
 * Research in Autism. They belong in a review's search and not in an
 * editor's reviewer pool, so this app shows the field's own journals unless
 * CORPUS_JOURNALS says otherwise ("all" for everything in the corpus).
 */
const DEFAULT_JOURNALS = [
  "0021-8855", // Journal of Applied Behavior Analysis
  "1998-1929", // Behavior Analysis in Practice
  "1072-0847", // Behavioral Interventions
  "0022-5002", // Journal of the Experimental Analysis of Behavior
  "2520-8969", // Perspectives on Behavior Science
  "0889-9401", // The Analysis of Verbal Behavior
  "0033-2933", // The Psychological Record
  "2372-9414", // Behavior Analysis: Research and Practice
  "1064-9506", // Behavior and Social Issues
  "0748-8491", // Education and Treatment of Children
  "0376-6357", // Behavioural Processes
  "1053-0819", // Journal of Behavioral Education
  "0145-4455", // Behavior Modification
  "1543-4494", // Learning & Behavior
  "2329-8456", // Journal of Experimental Psychology: Animal Learning and Cognition
];

let journalScope: Promise<number[] | null> | null = null;

/** The journal ids in scope, resolved from the ISSN-L list once per process. */
export function journalIds(): Promise<number[] | null> {
  if (journalScope) return journalScope;
  journalScope = (async () => {
    const raw = (process.env.CORPUS_JOURNALS ?? "").trim();
    if (raw.toLowerCase() === "all") return null;
    const wanted = raw
      ? raw.split(",").map((s) => s.trim()).filter(Boolean)
      : DEFAULT_JOURNALS;
    const rows = await sql<{ id: number }[]>`
      select id from corpus_journal where issn_l = any(${wanted})`;
    return rows.map((r) => r.id);
  })().catch((error) => {
    journalScope = null;
    throw error;
  });
  return journalScope;
}

/**
 * Whether corpus_article carries the non_scholarly column.
 *
 * Obituaries, annual author indexes, conference notices, membership lists,
 * editorials and reprinted quotations were searchable here, sat on the map,
 * and counted toward how many articles cover a topic. None of them is
 * something an editor can send to a reviewer. The Trellis pipeline marks them
 * (corpus-pipeline/scholarly_filter.py, deferring to 600 human labels), and
 * this app leaves them out of everything it shows.
 *
 * Probed rather than assumed, because the column arrives in the shared corpus
 * on Trellis's release schedule and not this app's. Asked once per process
 * against the catalog, so the two deployments can go out in either order and
 * neither breaks the other. Same reasoning as iterativeScanAvailable in
 * placement.ts.
 */
let scholarlyColumn: Promise<boolean> | null = null;

/**
 * The "is a paper" half of the scope, on its own.
 *
 * scope() narrows to a window of years and a list of journals, which is a
 * question about what this app is showing. Whether a row is scholarly work at
 * all is a different question, and it has to hold even where the other one
 * does not: an article page is addressed by id and never asked what year it
 * is from, so it needs this without the rest.
 *
 * Wrapped in a Scope for the reason given on that type: a fragment returned
 * bare from an async function is adopted by the promise and run as a query.
 * Always a usable clause, `true` where the column is not there yet.
 */
export async function scholarlyOnly(alias = "a"): Promise<Scope> {
  const known = await nonScholarlyKnown();
  return { where: known ? sql`not ${sql(alias)}.non_scholarly` : sql`true` };
}

export function nonScholarlyKnown(): Promise<boolean> {
  if (scholarlyColumn) return scholarlyColumn;
  scholarlyColumn = (async () => {
    const rows = await sql<{ n: number }[]>`
      select count(*)::int as n from information_schema.columns
      where table_name = 'corpus_article' and column_name = 'non_scholarly'`;
    return (rows[0]?.n ?? 0) > 0;
  })().catch((error) => {
    scholarlyColumn = null;
    throw error;
  });
  return scholarlyColumn;
}

/**
 * The WHERE clause that keeps a query inside the configured scope. Every
 * query that returns articles goes through it, so the map, the article list,
 * the placement and the reviewer pool all agree about what the field is.
 */
export async function scope(alias = "a"): Promise<Scope> {
  const parts: Fragment[] = [];
  const floor = yearFloor();
  if (floor !== null) parts.push(sql`${sql(alias)}.year >= ${floor}`);
  const ids = await journalIds();
  if (ids) parts.push(sql`${sql(alias)}.journal_id = any(${ids})`);
  parts.push((await scholarlyOnly(alias)).where);
  return { where: all(parts) };
}
