# Database setup

1. Create a free project at https://supabase.com/dashboard.
2. In the SQL Editor, run the files in `migrations/` in order (0001 through 0006) - paste and run each one. Paste from the clipboard rather than copying out of a terminal; long statements pick up dropped characters at wrap points and fail with confusing syntax errors.
3. In Project Settings > API, copy the Project URL and `anon` `public` key into `.env.local` (see `.env.local.example` at the repo root). Copy the `service_role` key too - the ingestion script needs it, and so does `/admin` (it's the only way to read `auth.users` and to invite, ban, or delete accounts). It must be set in the Vercel project's environment variables as well, or `/admin` 404s for everyone including admins.
4. Promote your own account to admin - this is the bootstrap step, since only an admin can reach `/admin` to promote anyone else: `update profiles set role = 'admin' where email = 'you@example.com';`
5. From then on, manage people from `/admin` in the app. Only addresses added there can sign in; sign-up is disabled.

Adding someone from `/admin` creates their account with a temporary password and emails it, rather than sending Supabase's invite link - that link is one-time and short-lived, so it expired in junk folders and got spent by mail scanners before anyone clicked it. `profiles.must_set_password` (migration 0006) pins the person to `/update-password` until they replace it. Do not use Authentication > Users > Invite user in the dashboard; it sends the broken flow. Reissue a password from the "New password" link on a person's row.

## Roles

`ae` (Associate Editor), `eic` (Editor-in-Chief), `admin`. Everyone sees all 12 journals in the app; `profiles.journal_id` only decides whose accounts an EiC administers. An EiC must have a journal, an admin has none. See the Roles section of the root README for the full model.

Offboarding is `profiles.active = false`, not deletion - it bans the account at the auth level, frees a seat, and keeps the person's sign-in history for when they rotate back.

`/admin` also lists recent sign-ins, recorded in the `login_events` table by the app. Supabase's own `auth.audit_log_entries` covers the same ground but is pruned on a rolling window, so it can't answer questions about last quarter.

## Corpus tables

`journals` is populated by migration 0005 (12 rows, ids matching `data/corpus.json`) because `profiles.journal_id` references it. The `articles`/`authors`/`clusters` tables exist but are empty: the app renders from `data/corpus.json` at build time, not from Postgres. Run `scripts/ingest_openalex.py` then `scripts/build_layout.py` to regenerate that JSON; `scripts/load_supabase.py` pushes it into these tables if you ever want them filled.
