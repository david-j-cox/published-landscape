/* Shared data layer for the static demo. Loads data/corpus.json once and
   exposes read helpers on window.PL - same shape as the real app's
   src/lib/data.ts, ported to vanilla JS since this build has no server. */
(() => {
  const PL = { ready: null };

  function authorsShort(article) {
    const names = article.authors.map((a) => a.display_name.split(" ").pop());
    if (names.length === 0) return "";
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} & ${names[1]}`;
    return `${names[0]} et al.`;
  }

  function boot(corpus) {
    const journalsById = new Map(corpus.journals.map((j) => [j.id, j]));
    const clustersById = new Map(corpus.clusters.map((c) => [c.id, c]));
    const articlesById = new Map(corpus.articles.map((a) => [a.id, a]));

    PL.corpus = corpus;
    PL.journals = corpus.journals;
    PL.clusters = [...corpus.clusters].sort((a, b) => b.count - a.count);
    PL.articles = corpus.articles;
    PL.years = [...new Set(corpus.articles.map((a) => a.year).filter(Boolean))].sort((a, b) => b - a);
    PL.journalsById = journalsById;
    PL.clustersById = clustersById;
    PL.articlesById = articlesById;
    PL.authorsShort = authorsShort;

    PL.getArticles = (filters = {}) => {
      const { query, journalId, clusterId, year } = filters;
      const q = query && query.trim().toLowerCase();
      let matches = corpus.articles;
      if (journalId !== undefined && journalId !== "") {
        matches = matches.filter((a) => String(a.journal_id) === String(journalId));
      }
      if (clusterId !== undefined && clusterId !== "") {
        matches = matches.filter((a) => String(a.cluster_id) === String(clusterId));
      }
      if (year !== undefined && year !== "") {
        matches = matches.filter((a) => String(a.year) === String(year));
      }
      if (q) {
        matches = matches.filter(
          (a) =>
            a.title.toLowerCase().includes(q) ||
            (a.abstract && a.abstract.toLowerCase().includes(q)) ||
            a.authors.some((au) => au.display_name.toLowerCase().includes(q)),
        );
      }
      return [...matches].sort((a, b) => (b.year || 0) - (a.year || 0));
    };

    function summarizeAuthors(byAuthor) {
      const summaries = [];
      for (const [authorId, articles] of byAuthor) {
        const first = articles[0].authors.find((a) => a.id === authorId);
        const clusterCounts = new Map();
        for (const a of articles) clusterCounts.set(a.cluster_id, (clusterCounts.get(a.cluster_id) || 0) + 1);
        const clusters = [...clusterCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([id, count]) => ({ id, label: (clustersById.get(id) || {}).label || `Cluster ${id}`, count }));
        summaries.push({
          id: authorId,
          display_name: first.display_name,
          orcid: first.orcid,
          articleCount: articles.length,
          clusters,
          articles: [...articles].sort((a, b) => (b.year || 0) - (a.year || 0)),
        });
      }
      return summaries.sort((a, b) => b.articleCount - a.articleCount);
    }

    PL.getReviewersByCluster = (clusterId, limit = 30) => {
      const byAuthor = new Map();
      for (const article of corpus.articles) {
        if (String(article.cluster_id) !== String(clusterId)) continue;
        for (const author of article.authors) {
          const list = byAuthor.get(author.id) || [];
          list.push(article);
          byAuthor.set(author.id, list);
        }
      }
      return summarizeAuthors(byAuthor).slice(0, limit);
    };

    PL.searchAuthors = (query, limit = 20) => {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      const byAuthor = new Map();
      for (const article of corpus.articles) {
        for (const author of article.authors) {
          if (!author.display_name.toLowerCase().includes(q)) continue;
          const list = byAuthor.get(author.id) || [];
          list.push(article);
          byAuthor.set(author.id, list);
        }
      }
      return summarizeAuthors(byAuthor).slice(0, limit);
    };
  }

  PL.ready = fetch("data/corpus.json")
    .then((r) => r.json())
    .then((corpus) => {
      boot(corpus);
      document.dispatchEvent(new CustomEvent("pl:ready"));
      return PL;
    })
    .catch((err) => {
      console.error("Failed to load data/corpus.json", err);
      document.dispatchEvent(new CustomEvent("pl:error", { detail: err }));
    });

  window.PL = PL;
})();
