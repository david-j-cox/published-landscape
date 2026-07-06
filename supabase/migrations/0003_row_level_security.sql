-- The app gates every route in proxy.ts, but the anon key is public, so RLS
-- is the real boundary: anyone with the anon key and no session must see
-- nothing. Bibliographic data is read-only to any signed-in user; writes
-- only happen via the service-role key from the ingestion script.

alter table journals enable row level security;
alter table articles enable row level security;
alter table authors enable row level security;
alter table article_authors enable row level security;
alter table clusters enable row level security;
alter table profiles enable row level security;

create policy "authenticated can read journals" on journals
  for select to authenticated using (true);

create policy "authenticated can read articles" on articles
  for select to authenticated using (true);

create policy "authenticated can read authors" on authors
  for select to authenticated using (true);

create policy "authenticated can read article_authors" on article_authors
  for select to authenticated using (true);

create policy "authenticated can read clusters" on clusters
  for select to authenticated using (true);

create policy "users can read own profile" on profiles
  for select to authenticated using (auth.uid() = id);

create policy "admins can read all profiles" on profiles
  for select to authenticated using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
  );
