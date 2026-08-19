"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PLACEMENT_STORAGE_KEY, SUBMIT_STATE_KEY } from "@/lib/constants";
import { extractPdfText, guessAbstract } from "@/lib/pdf-extract";
import type { PlacementResult } from "@/lib/placement";
import type { Journal } from "@/lib/types";
import { doiUrl } from "@/lib/util";

type NeighborFilters = { journalId?: number; yearMin?: number; yearMax?: number };

const numOrUndef = (v: number | "") => (v === "" ? undefined : v);

const REVIEWER_PAGE = 15;

export function SubmitForm({ journals, years }: { journals: Journal[]; years: number[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [abstract, setAbstract] = useState("");
  const [references, setReferences] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PlacementResult | null>(null);
  // Suggested reviewers arrive ranked and complete; the list is revealed a
  // page at a time so a fresh placement opens on the strongest matches.
  const [reviewerCount, setReviewerCount] = useState(REVIEWER_PAGE);
  // Neighbor filters ("" = no constraint). Changing one re-queries /api/place
  // so the nearest list is re-ranked within the filter, not just hidden.
  const [fJournal, setFJournal] = useState<number | "">("");
  const [fYearMin, setFYearMin] = useState<number | "">("");
  const [fYearMax, setFYearMax] = useState<number | "">("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const journalName = (id: number) => journals.find((j) => j.id === id)?.name ?? `Journal ${id}`;

  async function handlePdfUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setExtracting(true);
    setError(null);
    try {
      const raw = await extractPdfText(file);
      const guessed = guessAbstract(raw);
      if (guessed.length > 60) setAbstract(guessed);
      else setError("Couldn't confidently find an abstract in that PDF - please paste it in manually.");
    } catch (err) {
      console.error("PDF extraction failed:", err);
      setError("Couldn't read that PDF - please paste the title/abstract in manually instead.");
    } finally {
      setExtracting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // Coming back from the map restores the last query and its results rather
  // than making the user paste the title and abstract in again.
  useEffect(() => {
    const raw = sessionStorage.getItem(SUBMIT_STATE_KEY);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as {
        title: string;
        abstract: string;
        references?: string;
        result: PlacementResult;
      };
      if (!saved.result) return;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTitle(saved.title);
      setAbstract(saved.abstract);
      setReferences(saved.references ?? "");
      setResult(saved.result);
    } catch {
      // malformed entry - ignore
    }
  }, []);

  // Single code path for the initial placement and every filter re-query.
  async function runPlacement(filters: NeighborFilters) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, abstract, references, ...filters }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }
      setResult(data);
      setReviewerCount(REVIEWER_PAGE);
      sessionStorage.setItem(
        SUBMIT_STATE_KEY,
        JSON.stringify({ title, abstract, references, result: data }),
      );
      return data as PlacementResult;
    } catch {
      setError("Something went wrong contacting the server.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    setReviewerCount(REVIEWER_PAGE);
    // A fresh submission starts from an unfiltered nearest list.
    setFJournal("");
    setFYearMin("");
    setFYearMax("");
    await runPlacement({});
  }

  // Re-run with the given filter overrides merged onto current selections.
  function applyFilters(next: { journalId?: number | ""; yearMin?: number | ""; yearMax?: number | "" }) {
    const journalId = next.journalId ?? fJournal;
    const yearMin = next.yearMin ?? fYearMin;
    const yearMax = next.yearMax ?? fYearMax;
    void runPlacement({
      journalId: numOrUndef(journalId),
      yearMin: numOrUndef(yearMin),
      yearMax: numOrUndef(yearMax),
    });
  }

  function clearFilters() {
    setFJournal("");
    setFYearMin("");
    setFYearMax("");
    void runPlacement({});
  }

  const filtersActive = fJournal !== "" || fYearMin !== "" || fYearMax !== "";

  // Reset for the next article. Also drops the saved state, otherwise
  // returning from the map would repopulate the form we just cleared.
  function clearAll() {
    setTitle("");
    setAbstract("");
    setReferences("");
    setResult(null);
    setError(null);
    setReviewerCount(REVIEWER_PAGE);
    setFJournal("");
    setFYearMin("");
    setFYearMax("");
    sessionStorage.removeItem(SUBMIT_STATE_KEY);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function viewOnMap() {
    const placement = result ?? (await runPlacement({}));
    if (!placement) return;
    sessionStorage.setItem(
      PLACEMENT_STORAGE_KEY,
      JSON.stringify({
        title: title || "(untitled submission)",
        x: placement.x,
        y: placement.y,
        clusterId: placement.clusterId,
        clusterLabel: placement.clusterLabel,
        neighbors: placement.neighbors.slice(0, 5),
      }),
    );
    router.push("/map");
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-lg font-semibold">See where a new article lands</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Paste (or upload a PDF to autofill) a submission&apos;s title and abstract to see where it
        would land in the topic landscape and which existing articles are nearest to it - useful
        for spotting overlap or finding reviewers with closely related work.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
        <label className="text-sm font-medium">
          Title
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Manuscript title"
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-normal dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>

        <label className="text-sm font-medium">
          Abstract
          <textarea
            value={abstract}
            onChange={(e) => setAbstract(e.target.value)}
            placeholder="Paste the abstract here"
            rows={8}
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-normal leading-relaxed dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>

        <div className="flex items-center gap-3 text-sm">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={handlePdfUpload}
            className="text-sm"
          />
          {extracting && <span className="text-neutral-400">Extracting text...</span>}
        </div>
        <p className="text-xs text-neutral-400">
          PDF text extraction is best-effort and stays in your browser - always review the
          autofilled abstract before submitting.
        </p>

        <div className="mt-2 flex flex-col gap-1">
          <label htmlFor="references" className="text-sm font-medium">
            References <span className="font-normal text-neutral-400">(optional)</span>
          </label>
          <p className="mb-1 text-xs text-neutral-400">
            Paste the manuscript&apos;s reference list in any style. We&apos;ll flag related work in
            these journals that it doesn&apos;t appear to cite, and show which references aren&apos;t
            in the landscape at all.
          </p>
          <textarea
            id="references"
            value={references}
            onChange={(e) => setReferences(e.target.value)}
            rows={5}
            placeholder="Smith, J. (2021). Title of the work. Journal Name, 54(2), 101-118. https://doi.org/..."
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={submitting || (!title && !abstract)}
            className="w-fit rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {submitting ? "Finding..." : "Find Similar Articles/Reviewers"}
          </button>
          <button
            type="button"
            onClick={() => void viewOnMap()}
            disabled={submitting || (!title && !abstract)}
            className="w-fit rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            Place in Landscape
          </button>
          {(title || abstract || references || result) && (
            <button
              type="button"
              onClick={clearAll}
              className="w-fit rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Clear
            </button>
          )}
        </div>
      </form>

      {result && (
        <div className="mt-8 border-t border-neutral-200 pt-6 dark:border-neutral-800">
          <div className="w-fit rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
            Closest topic: {result.clusterLabel}
          </div>

          {result.citations && (
            <div className="mt-6 rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
              <div className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                Reference check
              </div>
              <p className="mt-1 text-xs text-neutral-400">
                {result.citations.entryCount} reference
                {result.citations.entryCount === 1 ? "" : "s"} read
                {filtersActive ? ", checked against the filtered journals below" : ""}.
              </p>

              <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                Related work not cited
              </div>
              {result.citations.uncited.length === 0 ? (
                <p className="mt-1 text-sm text-neutral-500">
                  Nothing to flag - the closest related work in these journals already appears in
                  the reference list.
                </p>
              ) : (
                <>
                  <p className="mt-1 text-xs text-neutral-400">
                    Closely related work in these journals that the reference list doesn&apos;t
                    appear to cite. Worth a look before recommending anything to the author.
                  </p>
                  <ul className="mt-2 flex flex-col divide-y divide-neutral-200 dark:divide-neutral-800">
                    {result.citations.uncited.map((n) => (
                      <li key={n.id} className="flex items-baseline justify-between gap-3 py-2">
                        <div className="text-sm">
                          {n.doi ? (
                            <a
                              href={doiUrl(n.doi)}
                              target="_blank"
                              rel="noopener"
                              className="text-blue-600 underline dark:text-blue-400"
                            >
                              {n.title}
                            </a>
                          ) : (
                            <Link href={`/articles/${n.id}`} className="hover:underline">
                              {n.title}
                            </Link>
                          )}{" "}
                          <span className="text-neutral-400">({n.year})</span>
                        </div>
                        <span className="shrink-0 text-xs text-neutral-400">
                          {Math.round(n.similarity * 100)}% similar
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

            </div>
          )}

          <div className="mt-4 flex items-center justify-between gap-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Nearest existing articles
            </div>
            {filtersActive && (
              <button
                onClick={clearFilters}
                className="text-xs text-blue-600 underline dark:text-blue-400"
              >
                Clear filters
              </button>
            )}
          </div>

          {/* Filter the nearest list by journal and/or year. Each change
              re-ranks the whole corpus within the filter server-side. */}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <select
              value={fJournal}
              onChange={(e) => {
                const v = e.target.value === "" ? "" : Number(e.target.value);
                setFJournal(v);
                applyFilters({ journalId: v });
              }}
              className="rounded-md border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
              aria-label="Filter nearest articles by journal"
            >
              <option value="">All journals</option>
              {journals.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name}
                </option>
              ))}
            </select>
            <select
              value={fYearMin}
              onChange={(e) => {
                const v = e.target.value === "" ? "" : Number(e.target.value);
                setFYearMin(v);
                applyFilters({ yearMin: v });
              }}
              className="rounded-md border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
              aria-label="Earliest year"
            >
              <option value="">From year</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <select
              value={fYearMax}
              onChange={(e) => {
                const v = e.target.value === "" ? "" : Number(e.target.value);
                setFYearMax(v);
                applyFilters({ yearMax: v });
              }}
              className="rounded-md border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
              aria-label="Latest year"
            >
              <option value="">To year</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          {result.neighbors.length === 0 ? (
            <p className="mt-3 text-sm italic text-neutral-400">
              No articles match this filter
              {fJournal !== "" ? ` in ${journalName(fJournal)}` : ""}. Widen the year range or clear
              the filters.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col divide-y divide-neutral-200 dark:divide-neutral-800">
              {result.neighbors.map((n) => (
                <li key={n.id} className="py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <Link href={`/articles/${n.id}`} className="text-sm font-medium hover:underline">
                      {n.title}
                    </Link>
                    <span className="shrink-0 text-xs text-neutral-400">
                      {Math.round(n.similarity * 100)}% similar
                    </span>
                  </div>
                  <div className="text-xs text-neutral-500">
                    {n.authors.map((a) => a.display_name).join(", ")} &middot; {journalName(n.journal_id)}{" "}
                    &middot; {n.year}
                    {n.doi && (
                      <>
                        {" "}
                        &middot;{" "}
                        <a
                          href={doiUrl(n.doi)}
                          target="_blank"
                          rel="noopener"
                          className="text-blue-600 underline dark:text-blue-400"
                        >
                          View paper
                        </a>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-8 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Suggested reviewers
          </div>
          <p className="mt-1 text-xs text-neutral-400">
            Authors of the closest articles across the whole field (unaffected by the filters above),
            ranked by how closely their work matches this submission. Open a linked paper to find the
            corresponding author&apos;s contact details on the publisher&apos;s site.
          </p>
          <ul className="mt-2 flex flex-col divide-y divide-neutral-200 dark:divide-neutral-800">
            {result.reviewers.slice(0, reviewerCount).map((r) => (
              <li key={r.id} className="py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium">{r.display_name}</span>
                  {r.orcid && (
                    <a
                      href={r.orcid}
                      target="_blank"
                      rel="noopener"
                      className="shrink-0 text-xs text-blue-600 underline dark:text-blue-400"
                    >
                      ORCID
                    </a>
                  )}
                </div>
                <ul className="mt-1 flex flex-col gap-0.5 text-xs text-neutral-500">
                  {r.papers.map((p) => (
                    <li key={p.id}>
                      {p.doi ? (
                        <a
                          href={doiUrl(p.doi)}
                          target="_blank"
                          rel="noopener"
                          className="text-blue-600 underline dark:text-blue-400"
                        >
                          {p.title}
                        </a>
                      ) : (
                        <Link href={`/articles/${p.id}`} className="hover:underline">
                          {p.title}
                        </Link>
                      )}{" "}
                      ({p.year}) &middot; {Math.round(p.similarity * 100)}% similar
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {reviewerCount < result.reviewers.length && (
            <button
              type="button"
              onClick={() =>
                setReviewerCount((n) => Math.min(n + REVIEWER_PAGE, result.reviewers.length))
              }
              className="mt-3 w-full rounded-md border border-neutral-300 py-2 text-sm text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Show more reviewers
              <span className="ml-2 text-xs text-neutral-400">
                showing {reviewerCount} of {result.reviewers.length}
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
