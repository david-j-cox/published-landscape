// Reviewers are people the tool suggests, not people who sign in - so the
// roles here are only the ones that get an account.
export const ROLES = ["ae", "eic", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ae: "Associate Editor",
  eic: "Editor-in-Chief",
  admin: "Admin",
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export type LoginMethod = "password" | "magic_link" | "recovery";

export type Viewer = {
  id: string;
  email: string;
  role: Role;
  /** The journal an EiC administers. Null for admins and unassigned AEs. */
  journalId: number | null;
  active: boolean;
  /** True while they are still on the temporary password they were emailed. */
  mustSetPassword: boolean;
};

export type ManagedUser = {
  id: string;
  email: string;
  role: Role;
  journalId: number | null;
  active: boolean;
  createdAt: string | null;
  lastSignInAt: string | null;
  /** False while they are still on the temporary password they were emailed. */
  activated: boolean;
  loginCount: number;
};

export type LoginEvent = {
  id: number;
  email: string;
  method: LoginMethod;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
};

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
