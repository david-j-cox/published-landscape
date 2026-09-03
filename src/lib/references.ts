import "server-only";

/** What the check needs of an article: enough to recognise it in a bibliography. */
export type Citable = {
  id: string;
  title: string;
  doi: string | null;
  year: number | null;
  authors: { display_name: string }[];
};

/**
 * Reference-list checking for a submission.
 *
 * Answers the question an editor actually asks of a manuscript's bibliography:
 * what related work in these journals did the author NOT cite? Recent,
 * on-topic work in their own journal that belongs in the paper.
 *
 * The reverse direction - which of the author's references we do not hold -
 * is deliberately not reported. The corpus is one decade of a specific set of
 * journals, so almost every book, older classic and out-of-scope citation
 * comes back "missing" and the signal is drowned in it.
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
  /** How many entries the reference list was split into. */
  entryCount: number;
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
function cites(article: Citable, blobNorm: string, blobRaw: string): boolean {
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
 */
export function checkReferences(candidates: Citable[], references: string): CitationCheck {
  const blobRaw = references;
  const blobNorm = norm(references);
  return {
    uncited: candidates.filter((a) => !cites(a, blobNorm, blobRaw)).map((a) => a.id),
    entryCount: splitReferences(references).length,
  };
}
