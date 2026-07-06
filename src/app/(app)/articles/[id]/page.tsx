import Link from "next/link";
import { notFound } from "next/navigation";
import { getArticleById } from "@/lib/data";

export default async function ArticleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const article = getArticleById(id);
  if (!article) notFound();

  return (
    <div className="mx-auto max-w-2xl p-6">
      <Link href="/articles" className="text-sm text-neutral-500 hover:underline">
        &larr; Back to articles
      </Link>

      <div className="mt-3 w-fit rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
        {article.cluster.label}
      </div>
      <h1 className="mt-2 text-xl font-semibold leading-snug">{article.title}</h1>
      <div className="mt-1 text-sm text-neutral-500">
        {article.authors.map((a) => a.display_name).join(", ")}
      </div>
      <div className="mt-1 text-sm text-neutral-400">
        {article.journal.name} &middot; {article.year}
      </div>

      {article.abstract ? (
        <p className="mt-5 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
          {article.abstract}
        </p>
      ) : (
        <p className="mt-5 text-sm italic text-neutral-400">
          No abstract available from the source index. OpenAlex topics:{" "}
          {article.openalex_topics.map((t) => t.display_name).join(", ")}
        </p>
      )}

      <div className="mt-5 flex gap-4 text-sm">
        {article.doi && (
          <a
            href={`https://doi.org/${article.doi.replace(/^https?:\/\/doi\.org\//, "")}`}
            target="_blank"
            rel="noopener"
            className="text-blue-600 underline dark:text-blue-400"
          >
            View paper (DOI)
          </a>
        )}
        <Link href={`/map#article=${article.id}`} className="text-blue-600 underline dark:text-blue-400">
          View on topic map
        </Link>
      </div>

      {article.relatedArticles.length > 0 && (
        <div className="mt-8">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Related work
          </div>
          <ul className="flex flex-col gap-2 text-sm">
            {article.relatedArticles.map((r) => (
              <li key={r.id}>
                <Link href={`/articles/${r.id}`} className="hover:underline">
                  {r.title}
                </Link>{" "}
                <span className="text-neutral-400">({r.year})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
