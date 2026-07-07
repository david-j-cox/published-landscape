"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { PLACEMENT_STORAGE_KEY } from "@/lib/constants";
import { extractPdfText, guessAbstract } from "@/lib/pdf-extract";
import type { PlacementResult } from "@/lib/placement";
import { doiUrl } from "@/lib/util";

export default function SubmitPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [abstract, setAbstract] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PlacementResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, abstract }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }
      setResult(data);
    } catch {
      setError("Something went wrong contacting the server.");
    } finally {
      setSubmitting(false);
    }
  }

  function viewOnMap() {
    if (!result) return;
    sessionStorage.setItem(
      PLACEMENT_STORAGE_KEY,
      JSON.stringify({
        title: title || "(untitled submission)",
        x: result.x,
        y: result.y,
        clusterId: result.clusterId,
        clusterLabel: result.clusterLabel,
        neighbors: result.neighbors.slice(0, 5),
      }),
    );
    router.push("/map");
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-lg font-semibold">Place a submitted article</h1>
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

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting || (!title && !abstract)}
          className="mt-2 w-fit rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {submitting ? "Placing..." : "Place in landscape"}
        </button>
      </form>

      {result && (
        <div className="mt-8 border-t border-neutral-200 pt-6 dark:border-neutral-800">
          <div className="w-fit rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
            Closest topic: {result.clusterLabel}
          </div>
          <button
            onClick={viewOnMap}
            className="ml-2 text-xs text-blue-600 underline dark:text-blue-400"
          >
            View placement on topic map
          </button>

          <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Nearest existing articles
          </div>
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
                  {n.authors.map((a) => a.display_name).join(", ")} &middot; {n.year}
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

          <div className="mt-8 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Suggested reviewers
          </div>
          <p className="mt-1 text-xs text-neutral-400">
            Authors of the articles above, ranked by how closely their work matches this
            submission. Open a linked paper to find the corresponding author&apos;s contact
            details on the publisher&apos;s site.
          </p>
          <ul className="mt-2 flex flex-col divide-y divide-neutral-200 dark:divide-neutral-800">
            {result.reviewers.map((r) => (
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

          <Link
            href={`/reviewers?topic=${result.clusterId}`}
            className="mt-4 inline-block text-xs text-blue-600 underline dark:text-blue-400"
          >
            Browse all reviewers for &quot;{result.clusterLabel}&quot; instead &rarr;
          </Link>
        </div>
      )}
    </div>
  );
}
