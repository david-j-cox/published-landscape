-- Replaces the placeholder reviewer/editor/admin roles with the editorial
-- structure the ABAI proposal describes: an Editor-in-Chief per journal, a
-- rotating pool of Associate Editors under them, and global admins.
--
-- Reviewers never sign in - they are people the tool *suggests*, not users -
-- so the 'reviewer' role is retired rather than kept as a no-privilege tier.
--
-- Journal affiliation is an administrative boundary only. Every signed-in
-- user browses all 12 journals on the map, in /articles, and in reviewer
-- suggestions; cross-journal reviewer discovery is the point of the tool.
-- What journal_id scopes is who an EiC can see and manage.

-- profiles.journal_id needs something to reference. The loader in
-- scripts/load_supabase.py assigns these same ids from data/corpus.json's
-- journal index, so this stays consistent if the full corpus is ever loaded.
insert into journals (id, name, issn_l, openalex_source_id) values
  (0, 'Journal of Applied Behavior Analysis', '0021-8855', 'S125122479'),
  (1, 'Behavior Analysis in Practice', '1998-1929', 'S2764616832'),
  (2, 'Behavioral Interventions', '1072-0847', 'S203327754'),
  (3, 'Journal of the Experimental Analysis of Behavior', '0022-5002', 'S168850678'),
  (4, 'Perspectives on Behavior Science', '2520-8969', 'S4210188225'),
  (5, 'The Analysis of Verbal Behavior', '0889-9401', 'S113178815'),
  (6, 'The Psychological Record', '0033-2933', 'S92682373'),
  (7, 'Behavior Analysis: Research and Practice', '2372-9414', 'S4210228049'),
  (8, 'Behavior and Social Issues', '1064-9506', 'S2764486203'),
  (9, 'Education and Treatment of Children', '0748-8491', 'S144739066'),
  (10, 'Behavioural Processes', '0376-6357', 'S128158437'),
  (11, 'Journal of Behavioral Education', '1053-0819', 'S90932718')
on conflict (id) do nothing;

alter table profiles drop constraint profiles_role_check;

update profiles set role = 'ae' where role in ('reviewer', 'editor');

alter table profiles
  add constraint profiles_role_check check (role in ('ae', 'eic', 'admin'));

alter table profiles alter column role set default 'ae';

-- Which journal this person is attached to. Null for admins, who aren't
-- scoped to one; required for an EiC, whose whole remit is a single journal.
alter table profiles add column journal_id bigint references journals(id);

-- Guest AEs rotate by special issue, so offboarding has to be reversible:
-- deactivating frees a seat and keeps the person's history, and reactivating
-- is one click when they come back for the next issue. Enforced in two
-- places - the app signs a deactivated user out on their next request, and
-- the account is banned at the Supabase auth level so no new token issues.
alter table profiles add column active boolean not null default true;

alter table profiles
  add constraint profiles_eic_needs_journal
  check (role <> 'eic' or journal_id is not null);

create index profiles_journal_id_idx on profiles(journal_id);

-- An EiC reads their own journal's roster through the service-role key, so
-- this policy isn't what the panel relies on - but leaving profiles readable
-- only by admins would silently break any future session-scoped query.
create function is_eic_of(target_journal bigint, uid uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from profiles
    where id = uid and role = 'eic' and journal_id = target_journal
  );
$$;

revoke execute on function is_eic_of(bigint, uuid) from anon;

create policy "eics can read their journal's profiles" on profiles
  for select to authenticated using (is_eic_of(journal_id));

-- The signup trigger inserts with the column default, which is now 'ae'.
-- New accounts still land with no journal until someone assigns one.
