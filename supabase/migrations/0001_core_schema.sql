-- Core bibliographic schema: journals, articles, authors, and the join
-- between them. Article/author primary keys reuse OpenAlex ids (e.g.
-- "W2908361203", "A5021350373") so re-running the ingestion script is a
-- plain upsert with no local id-mapping step.

create extension if not exists pg_trgm;

create table journals (
  -- Not an identity column: the loader assigns ids explicitly (matching
  -- data/corpus.json's journal index) so upserts stay stable across reruns.
  id bigint primary key,
  name text not null,
  issn_l text,
  openalex_source_id text unique not null
);

create table authors (
  id text primary key, -- OpenAlex author id, e.g. 'A5021350373'
  display_name text not null,
  orcid text
);

create table articles (
  id text primary key, -- OpenAlex work id, e.g. 'W2908361203'
  journal_id bigint not null references journals(id),
  title text not null,
  abstract text,
  has_full_abstract boolean not null default false,
  openalex_topics jsonb not null default '[]'::jsonb,
  openalex_keywords jsonb not null default '[]'::jsonb,
  year int,
  publication_date date,
  doi text,
  -- populated by the topic-modeling pipeline (scripts/build_layout.py), not ingestion
  cluster_id int,
  x double precision,
  y double precision,
  related text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index articles_journal_id_idx on articles(journal_id);
create index articles_year_idx on articles(year);
create index articles_cluster_id_idx on articles(cluster_id);
create index articles_title_trgm_idx on articles using gin (title gin_trgm_ops);

create table article_authors (
  article_id text not null references articles(id) on delete cascade,
  author_id text not null references authors(id) on delete cascade,
  author_position text, -- 'first' | 'middle' | 'last'
  is_corresponding boolean not null default false,
  primary key (article_id, author_id)
);

create index article_authors_author_id_idx on article_authors(author_id);

create table clusters (
  id int primary key,
  label text not null,
  description text
);
