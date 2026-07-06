// Client-only PDF text extraction. The PDF never leaves the browser - only
// the extracted text (or whatever the user edits it to) gets sent to the
// server for placement. Abstract-detection heuristic ported from the
// bds-lab-website corpus builder's Python regex approach.

const ABSTRACT_RE = /a\s?b\s?s\s?t\s?r\s?a\s?c\s?t/i;
const STOP_AT = /(keywords?|introduction|©|\b1\.\s)/i;
const NOISE_LINE =
  /(university|department|institute|college|@|http|www\.|doi|contents lists|sciencedirect|elsevier|springer|wiley|sage|taylor|journal homepage|published online|copyright|©|all rights reserved|corresponding author)/i;

export async function extractPdfText(file: File, maxPages = 2): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const pages = Math.min(doc.numPages, maxPages);
  let text = "";
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n";
  }
  return text;
}

function polish(text: string): string {
  let t = text;
  for (let i = 0; i < 2; i++) {
    t = t.replace(/^\s*[A-Z][A-Za-z.&\- ]{3,40}\s+\d{1,4}\s*\(\d{4}\)\s*[\d:–—-]*\s*/, "");
  }
  t = t.replace(/^(BOOK REVIEW|RESEARCH ARTICLE|ORIGINAL ARTICLE|ARTICLE HISTORY|ARTICLE)\b[:\s]*/i, "");
  t = t.replace(/^([A-Z][A-Z.]+[,]?\s+){2,}/, "");
  return t.trim();
}

// Best-effort guess at the abstract from raw first-page(s) text. Always
// show the result to the user for review before submitting - PDF text
// extraction is inherently lossy (column order, headers/footers, etc).
export function guessAbstract(raw: string, maxChars = 2500): string {
  const marks = [...raw.matchAll(new RegExp(ABSTRACT_RE, "gi"))].filter((m) => (m.index ?? 0) < 3500);
  if (marks.length) {
    const m = marks[marks.length - 1];
    const start = (m.index ?? 0) + m[0].length;
    let chunk = raw.slice(start, start + 2500);
    const stop = chunk.match(STOP_AT);
    if (stop && stop.index !== undefined) chunk = chunk.slice(0, stop.index);
    const text = polish(chunk.replace(/\s+/g, " ").trim());
    if (text.length > 120) return text.slice(0, maxChars);
  }
  const keep = raw
    .split("\n")
    .filter((ln) => ln.trim() && !NOISE_LINE.test(ln));
  return polish(keep.join(" ").replace(/\s+/g, " ").trim()).slice(0, maxChars);
}
