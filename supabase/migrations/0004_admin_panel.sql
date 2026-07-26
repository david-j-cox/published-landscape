-- Backs the /admin panel: a non-recursive admin check, and a durable record
-- of sign-ins.
--
-- Supabase's own auth.audit_log_entries already records logins, but it is
-- pruned on a rolling window and isn't reachable from the REST API (the auth
-- schema is hidden), so "who signed in last quarter" needs our own table.

-- 0003's "admins can read all profiles" policy queried profiles from inside a
-- policy ON profiles, which Postgres rejects with "infinite recursion detected
-- in policy for relation profiles" - and because policies are OR'd together,
-- that error takes down every authenticated read of profiles, including a
-- user's own row. A security definer function runs as its owner, so the
-- lookup inside it is not subject to RLS and the cycle is broken.
create function is_admin(uid uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from profiles where id = uid and role = 'admin');
$$;

revoke execute on function is_admin(uuid) from anon;

drop policy "admins can read all profiles" on profiles;

create policy "admins can read all profiles" on profiles
  for select to authenticated using (is_admin());

-- One row per established session. Written server-side with the service-role
-- key (see src/lib/supabase/login-events.ts); there is deliberately no insert
-- policy, so a signed-in user cannot forge or backdate their own history.
create table login_events (
  id bigint generated always as identity primary key,
  -- Kept nullable with `set null`: deleting a user should not erase the
  -- record that they used to sign in. email preserves who it was.
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  method text not null check (method in ('password', 'magic_link', 'recovery')),
  ip inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index login_events_created_at_idx on login_events(created_at desc);
create index login_events_user_id_idx on login_events(user_id);

alter table login_events enable row level security;

create policy "admins can read login events" on login_events
  for select to authenticated using (is_admin());
