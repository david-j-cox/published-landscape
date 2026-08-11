import { getClusters, getCorpusStats, getYears } from "@/lib/data";
import { getModelStats } from "@/lib/placement";

export const metadata = {
  title: "For Nerds - Published Landscape",
  description: "How the topic model behind this site is built.",
};

export default function NerdsPage() {
  const { articles, abstractCoverage } = getCorpusStats();
  const { vocabSize, svdDims } = getModelStats();
  const clusters = getClusters();
  const years = getYears();
  const largest = clusters[0];

  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">For Nerds</h1>
      <p className="mt-2 text-sm text-neutral-400">
        How an article ends up where it does.
      </p>

      <div className="mt-8 space-y-5 text-base leading-relaxed text-neutral-700 dark:text-neutral-300">
        <p>
          Nothing here uses a neural embedding model, a hosted API, or a key. The whole
          topic model is a few hundred lines of NumPy and SciPy in{" "}
          <code className="rounded bg-neutral-100 px-1 py-0.5 text-sm dark:bg-neutral-800">
            scripts/build_layout.py
          </code>
          , which makes it deterministic and reproducible: the same corpus in, the same
          map out.
        </p>

        <p>
          Each article starts as a bag of words from its title and abstract.{" "}
          {(abstractCoverage * 100).toFixed(1)}% of the {articles.toLocaleString()}{" "}
          articles have a real abstract, backfilled from PubMed and Springer&apos;s
          metadata API wherever OpenAlex lacked one. For the rest, the title is weighted
          more heavily and OpenAlex&apos;s own topic and keyword tags stand in - thinner
          signal, not absent signal, and flagged as such throughout the site. Words are
          scored by TF-IDF over a{" "}
          {vocabSize.toLocaleString()}-term vocabulary, keeping terms that appear in at
          least three articles but no more than 40% of them: rare enough to be
          informative, common enough to be reliable.
        </p>

        <p>
          That long sparse vector is compressed to {svdDims} dimensions by a truncated
          singular value decomposition. Those {svdDims} numbers are the actual embedding,
          and cosine distance between two of them is what &ldquo;related&rdquo; means
          everywhere on this site - nearest articles, suggested reviewers, topic
          assignment.
        </p>

        <p>
          Topics come from Ward-linkage hierarchical clustering over those vectors, cut
          into {clusters.length} groups. The linkage matters more than it sounds. Ward
          merges whichever pair of clusters adds the least within-cluster variance, which
          keeps sizes comparable; the obvious alternative, average linkage, chains. An
          earlier version of this map used it and swept 1,079 articles - essentially
          every animal-behavior study in the corpus - into one cluster whose four-word
          label came out as &ldquo;species, males, females, animals.&rdquo; Ward separates
          that into foraging, mating, vocal communication, social groups, animal
          personality, and rodent stress models. The largest topic now holds{" "}
          {largest.count.toLocaleString()} articles.
        </p>

        <p>
          Each topic is named by the terms most characteristic of it: mean TF-IDF inside
          the cluster minus mean TF-IDF outside it. Subtracting the outside average is
          what stops a large cluster from being labelled with the corpus&apos;s
          background vocabulary. These names are generated, never hand-written, so they
          read like keyword lists rather than phrases a behavior analyst would choose.
          Treat them as signposts, not a taxonomy.
        </p>

        <p>
          The map&apos;s coordinates are a separate and purely visual step. Cluster
          centroids are placed by classical multidimensional scaling and pushed apart
          until they stop overlapping, then each cluster&apos;s members are laid out
          around their own centroid. A single global projection of{" "}
          {articles.toLocaleString()} points tends to smear into one continuous blob;
          doing it per-cluster is what makes the islands legible. Distance on screen is a
          rough guide - distance in the {svdDims}-dimensional space is the real measure.
        </p>

        <p>
          When you paste a manuscript into <em>See where a new article lands</em>, that
          frozen model is reused rather than recomputed. Your text is tokenized against
          the same vocabulary and IDF weights, projected through the same SVD matrix, and
          compared against every stored article vector. The corpus covers {years.at(-1)}
          &ndash;{years[0]} and rebuilds every Monday, which reshuffles topic boundaries
          as new articles change what clusters with what.
        </p>
      </div>
    </div>
  );
}
