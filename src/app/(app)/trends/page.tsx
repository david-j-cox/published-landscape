import Link from "next/link";
import { CitationHistory, CitationHistoryAxis } from "@/components/citation-history";
import { citationGraphAvailable, topicTrends, translationForTopic } from "@/lib/citations";
import { getJournals } from "@/lib/data";

/**
 * How the field's topics have moved, and what the applied literature has
 * taken up from the basic.
 *
 * The map answers "what is next to what". This page answers the two
 * questions the map cannot: what has happened to a topic over the years,
 * and whether a finding in one part of the field reached another. Both are
 * read from the citation graph the Writer's Trellis corpus gained in
 * September 2026; neither was answerable while this app carried its own copy
 * of the literature.
 *
 * The topic is chosen by a link rather than a control, so every view has a
 * URL an editor can send to somebody.
 */
export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string }>;
}) {
  const { topic } = await searchParams;
  const [trends, hasGraph] = await Promise.all([topicTrends(), citationGraphAvailable()]);
  const selectedId = topic === undefined ? null : Number(topic);
  const selected =
    selectedId !== null ? (trends.find((t) => t.clusterId === selectedId) ?? null) : null;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Topics over time</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
        How much each topic publishes, year by year, and how often its articles are
        cited. Pick a topic to see its two curves next to each other, and which of its
        basic findings the applied journals have taken up.
      </p>

      {selected ? (
        <SelectedTopic trend={selected} hasGraph={hasGraph} />
      ) : (
        <AllTopics trends={trends} />
      )}
    </div>
  );
}

/**
 * Every topic at once, as small multiples.
 *
 * Forty-four topics is far past the point where one chart with a series each
 * can be read, and past the point where any set of hues can be told apart.
 * The same small chart repeated, in one ink, sorted by size, is the form that
 * survives that count: the shapes are comparable because nothing else varies.
 */
function AllTopics({ trends }: { trends: Awaited<ReturnType<typeof topicTrends>> }) {
  return (
    <>
      <div className="mt-8 grid gap-x-6 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
        {trends.map((t) => (
          <Link
            key={t.clusterId}
            href={`/trends?topic=${t.clusterId}`}
            className="group rounded-md p-2 -m-2 hover:bg-neutral-50 dark:hover:bg-neutral-900"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-sm font-medium group-hover:underline">{t.label}</span>
              <span className="shrink-0 text-xs tabular-nums text-neutral-400">
                {t.total.toLocaleString()}
              </span>
            </div>
            <div className="mt-1.5">
              <CitationHistory
                points={t.byYear.map((y) => ({ year: y.year, count: y.articles }))}
                height={40}
                unit="article"
              />
              <CitationHistoryAxis
                points={t.byYear.map((y) => ({ year: y.year, count: y.articles }))}
                peakLabel={false}
              />
            </div>
          </Link>
        ))}
      </div>
      <p className="mt-8 text-xs leading-relaxed text-neutral-400">
        Articles published per year, one chart per topic, all on their own scale: the
        number beside each label is the total, and the shapes show the shape of a topic&rsquo;s
        history, not its size against another&rsquo;s.
      </p>
    </>
  );
}

async function SelectedTopic({
  trend,
  hasGraph,
}: {
  trend: Awaited<ReturnType<typeof topicTrends>>[number];
  hasGraph: boolean;
}) {
  const [translation, journals] = await Promise.all([
    hasGraph ? translationForTopic(trend.clusterId) : null,
    getJournals(),
  ]);
  const journalName = new Map(journals.map((j) => [j.id, j.name]));

  const published = trend.byYear.map((y) => ({ year: y.year, count: y.articles }));
  /*
   * cited_by_year is roughly the last decade, so the citation series is
   * shorter than the publication one. Drawn over its own years and labelled
   * with them, rather than padded with zeros across the earlier years: a zero
   * would say "not cited" where the truth is "not recorded".
   */
  const citedYears = trend.byYear.filter((y) => y.citations > 0);
  const cited =
    citedYears.length > 1
      ? trend.byYear
          .filter((y) => y.year >= citedYears[0].year && y.year <= citedYears[citedYears.length - 1].year)
          .map((y) => ({ year: y.year, count: y.citations }))
      : [];

  return (
    <>
      <div className="mt-6 flex items-baseline gap-3">
        <Link href="/trends" className="text-sm text-neutral-500 hover:underline">
          &larr; All topics
        </Link>
      </div>
      <h2 className="mt-3 text-xl font-semibold">{trend.label}</h2>
      <div className="mt-1 text-sm text-neutral-500">
        {trend.total.toLocaleString()} articles in view
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        <figure>
          <figcaption className="text-sm font-medium">Articles published per year</figcaption>
          <div className="mt-2">
            <CitationHistory points={published} height={110} unit="article" />
            <CitationHistoryAxis points={published} />
          </div>
        </figure>

        {cited.length > 1 ? (
          <figure>
            <figcaption className="text-sm font-medium">Citations received per year</figcaption>
            <div className="mt-2">
              <CitationHistory points={cited} height={110} />
              <CitationHistoryAxis points={cited} />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-neutral-400">
              Citations to this topic&rsquo;s articles from anywhere, in the years OpenAlex keeps
              them. It covers a shorter span than the chart beside it, which is why the two
              are drawn separately rather than on one pair of axes.
            </p>
          </figure>
        ) : (
          <figure>
            <figcaption className="text-sm font-medium">Citations received per year</figcaption>
            <p className="mt-2 text-sm text-neutral-500">
              No per-year citation counts are recorded for this topic.
            </p>
          </figure>
        )}
      </div>

      <details className="mt-6 text-sm">
        <summary className="cursor-pointer text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">
          The numbers behind these charts
        </summary>
        <table className="mt-3 w-full max-w-md text-left tabular-nums">
          <thead className="text-xs uppercase tracking-wide text-neutral-400">
            <tr>
              <th className="py-1 font-medium">Year</th>
              <th className="py-1 font-medium">Articles</th>
              <th className="py-1 font-medium">Citations</th>
            </tr>
          </thead>
          <tbody>
            {[...trend.byYear].reverse().map((y) => (
              <tr key={y.year} className="border-t border-neutral-100 dark:border-neutral-800">
                <td className="py-1">{y.year}</td>
                <td className="py-1">{y.articles.toLocaleString()}</td>
                <td className="py-1">{y.citations ? y.citations.toLocaleString() : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      {translation && <Translation translation={translation} journalName={journalName} />}
    </>
  );
}

/**
 * Basic to applied, for one topic.
 *
 * Translation is a standing concern of this field and, until the citation
 * graph arrived, not something anybody could look at. The two lists are the
 * whole point: what the applied journals cite, and what they have not.
 */
function Translation({
  translation,
  journalName,
}: {
  translation: NonNullable<Awaited<ReturnType<typeof translationForTopic>>>;
  journalName: Map<number, string>;
}) {
  const { basic, applied, other, bridges, gaps } = translation;
  if (basic === 0 && applied === 0) return null;

  return (
    <section className="mt-10 border-t border-neutral-200 pt-8 dark:border-neutral-800">
      <h3 className="text-lg font-semibold">Basic to applied</h3>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
        Of this topic&rsquo;s articles, {basic.toLocaleString()} are in the basic journals and{" "}
        {applied.toLocaleString()} in the applied ones
        {other > 0 && <> ({other.toLocaleString()} in journals that are wholly neither)</>}. Below,
        which of the basic ones the applied journals here cite.
      </p>

      {basic === 0 ? (
        <p className="mt-4 text-sm text-neutral-500">
          Nothing in this topic was published in the basic journals, so there is no crossing to
          look at.
        </p>
      ) : (
        <div className="mt-6 grid gap-8 lg:grid-cols-2">
          <TranslationList
            title="Taken up"
            note={`${bridges.length} of ${basic} basic articles here are cited by an applied one`}
            articles={bridges}
            journalName={journalName}
            showCiters
          />
          <TranslationList
            title="Not taken up"
            note={`${gaps.length} are cited by no applied article in this corpus, most-cited first`}
            articles={gaps}
            journalName={journalName}
          />
        </div>
      )}

      <p className="mt-6 max-w-2xl text-[11px] leading-relaxed text-neutral-400">
        A citation is a reference, not evidence that a finding was applied, and an absence is
        not evidence that it was ignored: OpenAlex holds reference lists for most recent work
        and much less of the older literature, so an older basic article lands in the second
        list more readily than a recent one. The citing side is not held to the years this app
        shows &mdash; uptake in 2004 is still uptake &mdash; only to the applied journals.
      </p>
    </section>
  );
}

function TranslationList({
  title,
  note,
  articles,
  journalName,
  showCiters = false,
}: {
  title: string;
  note: string;
  articles: NonNullable<Awaited<ReturnType<typeof translationForTopic>>>["bridges"];
  journalName: Map<number, string>;
  showCiters?: boolean;
}) {
  return (
    <div>
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-0.5 text-xs text-neutral-400">{note}</div>
      {articles.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-500">None.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {articles.slice(0, 10).map((a) => (
            <li key={a.id} className="text-sm">
              <Link href={`/articles/${a.id}`} className="hover:underline">
                {a.title}
              </Link>
              <div className="mt-0.5 text-xs text-neutral-400">
                {journalName.get(a.journalId) ?? "Unknown journal"} &middot; {a.year ?? "n.d."}{" "}
                &middot; cited {a.citedByCount.toLocaleString()} times
                {showCiters && <> &middot; {a.appliedCiters} applied</>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
