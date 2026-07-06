# Database setup

1. Create a free project at https://supabase.com/dashboard.
2. In the SQL Editor, run the three files in `migrations/` in order (0001, 0002, 0003) - paste and run each one.
3. In Project Settings > API, copy the Project URL and `anon` `public` key into `.env.local` (see `.env.local.example` at the repo root). Copy the `service_role` key too - only the ingestion script uses it, never the Next.js app.
4. Invite yourself and any AEs/reviewers under Authentication > Users > Invite user. Only invited emails can sign in (magic-link sign-up is disabled in the app).
5. Optionally promote an account to editor/admin: `update profiles set role = 'admin' where email = 'you@example.com';`

Once configured, run `scripts/ingest_openalex.py` (needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in the environment) to load the corpus, then `scripts/build_layout.py` to compute topic clusters and coordinates.
