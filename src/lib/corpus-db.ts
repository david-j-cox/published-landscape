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
 * is stored: CORPUS_YEARS_BACK keeps the last N years, and CORPUS_JOURNALS is
 * a comma-separated list of ISSN-Ls. Unset, everything in the corpus is in.
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

export const sql = globalForCorpus.corpusSql ?? connect();
if (process.env.NODE_ENV !== "production") globalForCorpus.corpusSql = sql;

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
 * Computed against the current year, so "last 10 years" rolls forward without
 * anyone editing an environment variable each January.
 */
export function yearFloor(): number | null {
  const back = Number(process.env.CORPUS_YEARS_BACK);
  if (!Number.isFinite(back) || back <= 0) return null;
  return new Date().getUTCFullYear() - Math.floor(back) + 1;
}

let journalScope: Promise<number[] | null> | null = null;

/** The journal ids in scope, resolved from the ISSN-L list once per process. */
export function journalIds(): Promise<number[] | null> {
  if (journalScope) return journalScope;
  journalScope = (async () => {
    const wanted = (process.env.CORPUS_JOURNALS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (wanted.length === 0) return null;
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
  return { where: all(parts) };
}
