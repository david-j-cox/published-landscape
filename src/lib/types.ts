export type Journal = {
  id: number;
  name: string;
  issn_l: string;
  openalex_source_id: string;
};

export type Cluster = {
  id: number;
  label: string;
  count: number;
};

export type ArticleAuthor = {
  id: string;
  display_name: string;
  orcid: string | null;
  position: "first" | "middle" | "last" | null;
  is_corresponding: boolean;
};

export type Topic = { display_name: string; score: number | null };

export type Article = {
  id: string;
  journal_id: number;
  title: string;
  abstract: string | null;
  has_full_abstract: boolean;
  openalex_topics: Topic[];
  openalex_keywords: string[];
  year: number | null;
  publication_date: string | null;
  doi: string | null;
  type: string;
  authors: ArticleAuthor[];
  x: number;
  y: number;
  cluster_id: number;
  related: string[];
};

export type MapPoint = {
  id: string;
  x: number;
  y: number;
  cluster_id: number;
  journal_id: number;
  year: number | null;
  title: string;
  authorsShort: string;
};

export type ArticleSummary = {
  id: string;
  title: string;
  year: number | null;
  journal_id: number;
  cluster_id: number;
  authorsShort: string;
  hasAbstract: boolean;
};

export type ArticleDetail = Article & {
  journal: Journal;
  cluster: Cluster;
  relatedArticles: ArticleSummary[];
};

export type PlacementNeighbor = {
  id: string;
  title: string;
  year: number | null;
  journal_id: number;
  doi: string | null;
  similarity: number;
  authors: ArticleAuthor[];
};

// A candidate reviewer surfaced by /submit: someone who co-authored one or
// more of the nearest existing articles to a placed submission, ranked by
// the summed similarity of those articles (not just raw article count).
export type CandidateReviewer = {
  id: string;
  display_name: string;
  orcid: string | null;
  score: number;
  papers: { id: string; title: string; year: number | null; doi: string | null; similarity: number }[];
};

// Stashed in sessionStorage by /submit's "View on topic map" so the map can
// render one ephemeral, not-yet-published point without a server round trip.
export type PendingPlacement = {
  title: string;
  x: number;
  y: number;
  clusterId: number;
  clusterLabel: string;
  neighbors: PlacementNeighbor[];
};
