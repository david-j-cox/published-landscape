import "server-only";
import type { Article } from "@/lib/types";

/**
 * Reference-list checking for a submission.
 *
 * Two questions an editor asks of a manuscript's bibliography, both answered
 * against a reference list pasted as free text (any style - APA, numbered,
 * whatever the author used):
 *
 *   1. What related work in these journals did the author NOT cite? This is
 *      the one editors ask for: recent, on-topic work in their own journal
 *      that belongs in the paper.
 *   2. Which of the author's references are not in the landscape at all? Those
 *      are the corpus's blind spots - out-of-scope journals, books, or work
 *      older than the ten-year window.
 *
 * Matching is deliberately conservative in the direction that matters: it is
 * far worse to tell an editor a paper is missing when the author did cite it
 * (they lose trust in the whole list) than to stay quiet about one they
 * missed. So anything that plausibly looks cited is treated as cited.
 */

const STRIP = /[‐-―‘’“”.,;:()[\]{}'"`?!/\\&*]/g;

/** Lowercase, strip punctuation and accents, collapse whitespace. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(STRIP, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The bare DOI suffix, lowercased - references cite it in many wrappers. */
function doiKey(doi: string | null): string | null {
  if (!doi) return null;
  const m = doi.toLowerCase().match(/10\.\d{4,9}\/\S+/);
  return m ? m[0].replace(/[).,;]+$/, "") : null;
}

function surnameOf(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  return norm(parts[parts.length - 1] ?? "");
}

export type CitationCheck = {
  /** Related articles in the corpus that the reference list does not appear to cite. */
  uncited: string[];
  /** Reference entries that matched nothing in the corpus. */
  unmatched: string[];
  /** How many entries the reference list was split into. */
  entryCount: number;
  /** How many entries matched a corpus article. */
  matchedCount: number;
};

/**
 * Split pasted text into individual reference entries.
 *
 * Reference lists arrive in wildly different shapes, so rather than parse a
 * citation style, split on the markers that survive every style: a blank line,
 * a leading [n] or n. enumerator, or - the common case for APA pasted out of a
 * PDF - a line that starts a new author surname after the previous entry has
 * already produced a year.
 */
export function splitReferences(text: string): string[] {
  const cleaned = text.replace(/\r/g, "").trim();
  if (!cleaned) return [];

  if (/\n\s*\n/.test(cleaned)) {
    return cleaned
      .split(/\n\s*\n/)
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter((s) => s.length > 20);
  }

  const lines = cleaned.split("\n").map((l) => l.trim());
  const entries: string[] = [];
  let current = "";
  for (const line of lines) {
    if (!line) continue;
    const enumerated = /^(\[\d+\]|\(\d+\)|\d+[.)])\s+/.test(line);
    // A capitalised surname opening a line, once the entry in hand already
    // carries a year, is the usual sign that the next reference has started.
    const newAuthor = /^[A-Z][A-Za-z'’-]+,/.test(line) && /\(?(19|20)\d{2}\)?/.test(current);
    if (current && (enumerated || newAuthor)) {
      entries.push(current.replace(/\s+/g, " ").trim());
      current = line;
    } else {
      current = current ? `${current} ${line}` : line;
    }
  }
  if (current.trim()) entries.push(current.replace(/\s+/g, " ").trim());
  return entries.map((e) => e.replace(/^(\[\d+\]|\(\d+\)|\d+[.)])\s*/, "")).filter((e) => e.length > 20);
}

/** Does this reference blob appear to cite this article? */
function cites(article: Article, blobNorm: string, blobRaw: string): boolean {
  const dk = doiKey(article.doi);
  if (dk && blobRaw.toLowerCase().includes(dk)) return true;

  const title = norm(article.title);
  if (title.length >= 25) {
    // Full title first, then a long distinctive prefix: reference lists
    // sometimes truncate subtitles after a colon.
    if (blobNorm.includes(title)) return true;
    const prefix = title.slice(0, 45);
    if (prefix.length >= 30 && blobNorm.includes(prefix)) return true;
  }

  // Fall back to first-author surname near the year - enough to avoid calling
  // a paper uncited when it is cited in a style we did not match on title.
  const first = article.authors?.[0]?.display_name;
  if (first && article.year) {
    const sn = surnameOf(first);
    if (sn.length >= 4) {
      const year = String(article.year);
      let from = 0;
      for (;;) {
        const at = blobNorm.indexOf(sn, from);
        if (at === -1) break;
        if (blobNorm.slice(at, at + 160).includes(year)) return true;
        from = at + sn.length;
      }
    }
  }
  return false;
}

/**
 * @param candidates  corpus articles ranked by relevance to the submission
 * @param references  the reference list, pasted as free text
 * @param corpus      every article, for the "not in the landscape" direction
 */
export function checkReferences(
  candidates: Article[],
  references: string,
  corpus: Article[],
): CitationCheck {
  const blobRaw = references;
  const blobNorm = norm(references);

  const uncited = candidates.filter((a) => !cites(a, blobNorm, blobRaw)).map((a) => a.id);

  // The other direction: which pasted entries match nothing we hold. Indexed
  // by title prefix and by DOI so each entry is one lookup rather than a scan
  // over the whole corpus.
  const byTitlePrefix = new Map<string, true>();
  const byDoi = new Map<string, true>();
  for (const a of corpus) {
    const t = norm(a.title);
    if (t.length >= 30) byTitlePrefix.set(t.slice(0, 30), true);
    const dk = doiKey(a.doi);
    if (dk) byDoi.set(dk, true);
  }

  const entries = splitReferences(references);
  const unmatched: string[] = [];
  for (const entry of entries) {
    const dk = doiKey(entry);
    if (dk && byDoi.has(dk)) continue;
    const en = norm(entry);
    let hit = false;
    for (const [prefix] of byTitlePrefix) {
      if (en.includes(prefix)) {
        hit = true;
        break;
      }
    }
    if (!hit) unmatched.push(entry.length > 220 ? `${entry.slice(0, 220)}...` : entry);
  }

  return {
    uncited,
    unmatched,
    entryCount: entries.length,
    matchedCount: entries.length - unmatched.length,
  };
}
