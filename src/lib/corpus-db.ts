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
 * Ten years unless CORPUS_YEARS_BACK says otherwise, which is the window this
 * app always showed: an editor looking for a reviewer wants who is publishing
 * now, and the map draws a circle per point, which is comfortable at sixteen
 * thousand points and not at forty-six. Setting it to 0 or "all" shows the
 * whole corpus. Computed against the current year, so the window rolls
 * forward without anyone editing an environment variable each January.
 */
const DEFAULT_YEARS_BACK = 10;

export function yearFloor(): number | null {
  const raw = (process.env.CORPUS_YEARS_BACK ?? "").trim().toLowerCase();
  if (raw === "all") return null;
  const back = raw === "" ? DEFAULT_YEARS_BACK : Number(raw);
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
