-- One row per invited user. Invitation itself happens outside this schema
-- (Supabase Dashboard > Authentication > Users > Invite, or the admin API);
-- this trigger just mirrors auth.users into a queryable profile row with a
-- role, since the app needs to tell an AE apart from a plain reviewer.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'reviewer' check (role in ('reviewer', 'editor', 'admin')),
  created_at timestamptz not null default now()
);

create function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();
