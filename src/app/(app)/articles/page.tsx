import Link from "next/link";
import { getArticles, getClusters, getJournals, getYears } from "@/lib/data";

type SearchParams = {
  q?: string;
  journal?: string;
  cluster?: string;
  year?: string;
  page?: string;
};

export default async function ArticlesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const journals = getJournals();
  const clusters = getClusters();
  const years = getYears();

  const journalId = sp.journal ? Number(sp.journal) : undefined;
  const clusterId = sp.cluster ? Number(sp.cluster) : undefined;
  const year = sp.year ? Number(sp.year) : undefined;
  const page = sp.page ? Number(sp.page) : 1;
  const pageSize = 25;

  const { results, total } = getArticles({
    query: sp.q,
    journalId,
    clusterId,
    year,
    page,
    pageSize,
  });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function hrefWith(overrides: Partial<SearchParams>) {
    const params = new URLSearchParams({
      ...(sp.q ? { q: sp.q } : {}),
      ...(sp.journal ? { journal: sp.journal } : {}),
      ...(sp.cluster ? { cluster: sp.cluster } : {}),
      ...(sp.year ? { year: sp.year } : {}),
      ...overrides,
    });
    // Overrides with empty string mean "clear this filter"
    for (const [k, v] of [...params.entries()]) if (v === "") params.delete(k);
    return `/articles?${params.toString()}`;
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="text-lg font-semibold">Articles</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {total.toLocaleString()} articles across {journals.length} journals, last 10 years.
      </p>

      <form className="mt-4 flex flex-wrap gap-2 text-sm" action="/articles">
        <input
          type="text"
          name="q"
          defaultValue={sp.q}
          placeholder="Search title, abstract, or author"
          className="min-w-56 flex-1 rounded-md border border-neutral-300 px-3 py-1.5 dark:border-neutral-700 dark:bg-neutral-900"
        />
        <select
          name="journal"
          defaultValue={sp.journal ?? ""}
          className="rounded-md border border-neutral-300 px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900"
        >
          <option value="">All journals</option>
          {journals.map((j) => (
            <option key={j.id} value={j.id}>
              {j.name}
            </option>
          ))}
        </select>
        <select
          name="cluster"
          defaultValue={sp.cluster ?? ""}
          className="rounded-md border border-neutral-300 px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900"
        >
          <option value="">All topics</option>
          {clusters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label} ({c.count})
            </option>
          ))}
        </select>
        <select
          name="year"
          defaultValue={sp.year ?? ""}
          className="rounded-md border border-neutral-300 px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900"
        >
          <option value="">All years</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-white dark:bg-neutral-100 dark:text-neutral-900"
        >
          Filter
        </button>
      </form>

      <ul className="mt-6 flex flex-col divide-y divide-neutral-200 dark:divide-neutral-800">
        {results.map((a) => (
          <li key={a.id} className="py-3">
            <Link href={`/articles/${a.id}`} className="font-medium hover:underline">
              {a.title}
            </Link>
            <div className="mt-0.5 text-sm text-neutral-500">
              {a.authorsShort} &middot; {journals[a.journal_id]?.name} &middot; {a.year}
            </div>
          </li>
        ))}
        {results.length === 0 && (
          <li className="py-6 text-sm text-neutral-400">No articles match those filters.</li>
        )}
      </ul>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center gap-3 text-sm">
          {page > 1 && (
            <Link href={hrefWith({ page: String(page - 1) })} className="underline">
              Previous
            </Link>
          )}
          <span className="text-neutral-400">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link href={hrefWith({ page: String(page + 1) })} className="underline">
              Next
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
