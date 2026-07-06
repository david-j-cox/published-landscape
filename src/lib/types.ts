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

export type AuthorSummary = {
  id: string;
  display_name: string;
  orcid: string | null;
  articleCount: number;
  clusters: { id: number; label: string; count: number }[];
  articles: { id: string; title: string; year: number | null }[];
};
