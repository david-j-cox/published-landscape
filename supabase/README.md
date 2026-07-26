# Database setup

1. Create a free project at https://supabase.com/dashboard.
2. In the SQL Editor, run the files in `migrations/` in order (0001, 0002, 0003, 0004) - paste and run each one.
3. In Project Settings > API, copy the Project URL and `anon` `public` key into `.env.local` (see `.env.local.example` at the repo root). Copy the `service_role` key too - the ingestion script needs it, and so does `/admin` (it's the only way to read `auth.users` and to invite or delete accounts). It must be set in the Vercel project's environment variables as well, or `/admin` will report itself unavailable.
4. Promote your own account to admin - this is the bootstrap step, since only an admin can reach `/admin` to promote anyone else: `update profiles set role = 'admin' where email = 'you@example.com';`
5. From then on, invite reviewers and editors from `/admin` in the app (or Authentication > Users > Invite user). Only invited emails can sign in; sign-up is disabled.

`/admin` also lists recent sign-ins, recorded in the `login_events` table by the app. Supabase's own `auth.audit_log_entries` covers the same ground but is pruned on a rolling window, so it can't answer questions about last quarter.

Once configured, run `scripts/ingest_openalex.py` (needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in the environment) to load the corpus, then `scripts/build_layout.py` to compute topic clusters and coordinates.
