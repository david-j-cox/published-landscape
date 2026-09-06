import "server-only";
import { sql } from "@/lib/corpus-db";
import type { Institution, Lab, Labs } from "@/lib/types";

/**
 * The institutions behind the work: where a paper was written.
 *
 * OpenAlex sends an institution with almost every authorship and the Trellis
 * ingest kept them from 4 September 2026 (corpus_institution, and
 * corpus_article_author.institution_id; 92% of authorships carry one). Two
 * questions here run on it, and they are not the same question.
 *
 * An editor choosing a reviewer needs the affiliation of the person in front
 * of them -- to judge the fit, and to see a conflict before sending the
 * manuscript rather than after. That is institutionsByAuthor.
 *
 * "Who works on this" is the other one: which labs a body of work comes from,
 * and how many separate groups have touched it. A finding shown by six groups
 * is different evidence from one shown by six papers out of the same lab, and
 * an editor reading a submission's neighbourhood should be able to tell those
 * apart. That is labsNear.
 *
 * Both are descriptive and neither ranks anybody. The count is of papers in
 * one neighbourhood of one corpus.
 */

/**
 * Whether the institution tables can be read.
 *
 * information_schema.columns lists only what the connected role has some
 * privilege on, so one query answers both halves of the question: whether
 * Trellis has created the table yet, and whether corpus_reader has been
 * granted it. Neither is this app's to arrange, and both can change without a
 * deployment here, so it is probed once per process and the views that need
 * it are simply absent until it answers.
 */
let probe: Promise<boolean> | null = null;

export function institutionsAvailable(): Promise<boolean> {
  if (probe) return probe;
  probe = (async () => {
    const rows = await sql<{ n: number }[]>`
      select count(*)::int as n from information_schema.columns
      where (table_name = 'corpus_institution' and column_name = 'id')
         or (table_name = 'corpus_article_author' and column_name = 'institution_id')`;
    return (rows[0]?.n ?? 0) === 2;
  })().catch((error) => {
    probe = null;
    throw error;
  });
  return probe;
}

/**
 * The institutions each author wrote from, across a set of articles, keyed by
 * OpenAlex author id.
 *
 * Distinct rather than one: a person who has moved, or who lists two
 * affiliations, has more than one, and collapsing that to the first would
 * quietly assert something false about where they are.
 */
export async function institutionsByAuthor(
  articleIds: string[],
): Promise<Map<string, Institution[]>> {
  const out = new Map<string, Institution[]>();
  if (articleIds.length === 0 || !(await institutionsAvailable())) return out;
  const rows = await sql<
    { author_id: string; id: string; name: string; country: string | null }[]
  >`
    select distinct aa.author_id, i.id, i.name, i.country
    from corpus_article a
    join corpus_article_author aa on aa.article_id = a.id
    join corpus_institution i on i.id = aa.institution_id
    where a.openalex_id = any(${articleIds})
    order by i.name`;
  for (const r of rows) {
    const list = out.get(r.author_id) ?? [];
    list.push({ id: r.id, name: r.name, country: r.country });
    out.set(r.author_id, list);
  }
  return out;
}

/** The labs behind a set of articles, by how many of them each wrote. */
export async function labsNear(articleIds: string[], limit = 12): Promise<Labs | null> {
  if (articleIds.length === 0 || !(await institutionsAvailable())) return null;
  const [rows, coverage] = await Promise.all([
    sql<
      { id: string; name: string; country: string | null; papers: number; authors: number;
        first_year: number | null; last_year: number | null }[]
    >`
      select i.id, i.name, i.country,
        count(distinct a.id)::int as papers,
        count(distinct aa.author_id)::int as authors,
        min(a.year) as first_year, max(a.year) as last_year
      from corpus_article a
      join corpus_article_author aa on aa.article_id = a.id
      join corpus_institution i on i.id = aa.institution_id
      where a.openalex_id = any(${articleIds})
      group by i.id, i.name, i.country
      order by papers desc, authors desc, i.name
      limit ${limit}`,
    sql<{ n: number }[]>`
      select count(distinct a.id)::int as n
      from corpus_article a
      join corpus_article_author aa on aa.article_id = a.id
      where a.openalex_id = any(${articleIds}) and aa.institution_id is not null`,
  ]);
  return {
    institutions: rows.map((r): Lab => ({
      id: r.id,
      name: r.name,
      country: r.country,
      papers: Number(r.papers),
      authors: Number(r.authors),
      firstYear: r.first_year,
      lastYear: r.last_year,
    })),
    withInstitution: Number(coverage[0]?.n ?? 0),
    pool: articleIds.length,
  };
}
