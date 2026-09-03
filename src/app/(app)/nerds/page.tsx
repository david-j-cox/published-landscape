import {
  DendrogramFigure,
  LabelScoreFigure,
  LayoutFigure,
  PipelineFigure,
} from "@/components/nerds-figures";
import { getClusters, getCorpusStats, getYears } from "@/lib/data";
import { getModelStats } from "@/lib/placement";

export const metadata = {
  title: "The Published Landscape for Nerds",
  description: "How the topic model behind this is built.",
};

export default async function NerdsPage() {
  const [{ articles, abstractCoverage }, { vocabSize, svdDims }, clusters, years] =
    await Promise.all([getCorpusStats(), getModelStats(), getClusters(), getYears()]);
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
          topic model is a few hundred lines of NumPy and SciPy, which makes it
          deterministic and reproducible. The same corpus in, the same map out. And any
          data entered here never goes anywhere. The script that builds it is{" "}
          <a
            href="https://github.com/david-j-cox/published-landscape/blob/main/scripts/build_layout.py"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            public
          </a>
          , if you want to read it.
        </p>

        <PipelineFigure
          vocabSize={vocabSize}
          svdDims={svdDims}
          topicCount={clusters.length}
        />

        <p>
          Each article starts as a bag of words from its title and abstract.{" "}
          {(abstractCoverage * 100).toFixed(1)}% of the {articles.toLocaleString()}{" "}
          articles have a real abstract, backfilled from PubMed and Springer&apos;s
          metadata API wherever OpenAlex lacked one. For the rest, the title is weighted
          more heavily and OpenAlex&apos;s own topic and keyword tags stand in. Articles 
          like this are flagged as such throughout the site. Words are
          scored by TF-IDF over a{" "}
          {vocabSize.toLocaleString()}-term vocabulary, keeping terms that appear in at
          least three articles but no more than 40% of them. That makes the included words 
          rare enough to be informative and common enough to be reliable.
        </p>

        <p>
          That long sparse vector is compressed to {svdDims} dimensions by a truncated
          singular value decomposition. Those {svdDims}{" "}
          numbers are the article&apos;s embedding.
          The cosine distance between two of them is what &ldquo;related&rdquo; means
          everywhere on this site such as nearest articles, suggested reviewers, and topic
          assignment.
        </p>

        <p>
          Topics come from Ward-linkage hierarchical clustering over those vectors, cut
          into {clusters.length} groups. Ward merges whichever pair of clusters adds 
          the least within-cluster variance, which keeps sizes comparable. The 
          largest topic now holds{" "}
          {largest.count.toLocaleString()} articles.
        </p>

        <DendrogramFigure topicCount={clusters.length} articles={articles} />

        <p>
          Each topic is named by the terms most characteristic of it. To do this, we 
          calculated mean TF-IDF inside the cluster minus mean TF-IDF outside it. 
          Subtracting the outside average is what stops a large cluster from being 
          labelled with the corpus&apos;s background vocabulary. These names are 
          generated, never hand-written, so they read like keyword lists rather 
          than phrases a behavior analyst would choose. Treat them as data-driven 
          signposts, not a human-validated taxonomy.
        </p>

        <LabelScoreFigure />

        <p>
          The map&apos;s coordinates are a separate and purely visual step. Cluster
          centroids are placed by classical multidimensional scaling and pushed apart
          until they stop overlapping, then each cluster&apos;s members are laid out
          around their own centroid. A single global projection of{" "}
          {articles.toLocaleString()} points tends to smear into one continuous blob;
          doing it per-cluster is what makes the islands legible. Distance on screen is a
          rough guide. Distance in the {svdDims}-dimensional space is the real measure.
        </p>

        <LayoutFigure />

        <p>
          When you paste a manuscript into <em>See where a new article lands</em>, that
          frozen model is reused rather than recomputed. Your text is tokenized against
          the same vocabulary and IDF weights, projected through the same SVD matrix, and
          compared against every stored article vector. That model is one static file
          that ships with the site and sits in this server&apos;s memory, so the
          comparison happens here and nowhere else. Your text is never written to a
          database and never sent to a third party. It lives for the length of the
          request and then it is gone. Upload a PDF and the file itself never leaves your
          browser at all, only the text pulled out of it. The corpus covers {years.at(-1)}
          &ndash;{years[0]} and rebuilds every Monday, which reshuffles topic boundaries
          as new articles change what clusters with what.
        </p>
      </div>
    </div>
  );
}
