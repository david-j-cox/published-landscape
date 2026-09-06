import Link from "next/link";
import { citationGraphAvailable, translationForTopic } from "@/lib/citations";
import { TopicConeView } from "@/components/topic-cone-view";
import { conePoints } from "@/lib/cone";
import { getClusters, getJournals } from "@/lib/data";

/**
 * A topic with time as the third dimension.
 *
 * The map answers "what is near what" and cannot answer "when did this
 * happen", which for an editor judging whether a literature is live is half
 * the question: a topic that stopped in 2019 and one still being published
 * are the same cloud of dots seen from above. Picking a topic here draws its
 * articles in a cone, height being the year, so the shape of its history is
 * the shape on screen.
 *
 * This page carried small multiples of publication and citation counts until
 * 6 September 2026. They were accurate and nobody wanted them: a bar chart
 * per topic says how much and not what, and the questions an editor actually
 * arrives with -- has anyone reviewed this, what has been left out of the
 * reviews, is this still moving -- are all questions about individual
 * articles, which is what the cone draws.
 */
export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string }>;
}) {
  const { topic } = await searchParams;
  const clusters = await getClusters();
  const selectedId = topic === undefined ? null : Number(topic);
  const selected =
    selectedId !== null ? (clusters.find((c) => c.id === selectedId) ?? null) : null;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      {selected ? (
        <SelectedTopic id={selected.id} label={selected.label} count={selected.count} />
      ) : (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">Topics over time</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
            The map shows what is near what. Pick a topic to see when it happened: its
            articles drawn as a cone with the year as height, reviews picked out, and the
            work no review here has cited shown apart from the work that has.
          </p>
          <ul className="mt-8 grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {clusters.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/trends?topic=${c.id}`}
                  className="flex items-baseline justify-between gap-3 rounded-md px-2 py-1.5 -mx-2 hover:bg-neutral-100 dark:hover:bg-neutral-900"
                >
                  <span className="min-w-0 truncate text-sm">{c.label}</span>
                  <span className="shrink-0 text-xs tabular-nums text-neutral-400">
                    {c.count.toLocaleString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

async function SelectedTopic({
  id,
  label,
  count,
}: {
  id: number;
  label: string;
  count: number;
}) {
  const [points, hasGraph] = await Promise.all([conePoints(id), citationGraphAvailable()]);
  const [translation, journals] = await Promise.all([
    hasGraph ? translationForTopic(id) : null,
    getJournals(),
  ]);
  const journalName = new Map(journals.map((j) => [j.id, j.name]));

  /*
   * Mapped to the cone's own short keys here rather than in the browser.
   * Every one of these crosses the wire in the flight payload, and at a
   * thousand articles the long names cost more than the coordinates do.
   * Absent rather than zero for the citation count, which is zero for most.
   */
  const conePayload = points.map((p) => ({
    x: p.x,
    y: p.y,
    y0: p.year,
    t: p.title,
    r: p.isReview ? 1 : 0,
    d: p.doi,
    ...(p.reviewedBy > 0 ? { n: p.reviewedBy } : {}),
  }));

  return (
    <>
      <Link href="/trends" className="text-sm text-neutral-500 hover:underline">
        &larr; All topics
      </Link>
      <div className="mt-4">
        {conePayload.length > 0 ? (
          <TopicConeView points={conePayload} label={label} backHref="/trends" />
        ) : (
          <p className="text-sm text-neutral-500">
            Nothing in this topic carries both a position and a year, so there is no shape
            to draw.
          </p>
        )}
      </div>
      <p className="mt-2 text-xs text-neutral-400">
        {count.toLocaleString()} articles in this topic.
      </p>

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
