-- Onboarding no longer goes through Supabase's invite email. That email
-- carried a one-time, time-limited token, which failed two ways in practice:
-- it timed out while the message sat in a junk folder, and corporate mail
-- scanners (Safe Links, Proofpoint) spent the token by fetching it before the
-- human ever clicked. Both landed people on /auth/error.
--
-- The account is now created outright with a temporary password, mailed from
-- this app's own sender alongside a plain, tokenless link to /login. Nothing
-- in that email can expire or be consumed in transit.
--
-- This flag is what keeps the temporary password temporary: set when the
-- account is created (or when an editor issues a fresh one), cleared the
-- moment the person chooses their own, and the app refuses to serve any page
-- while it is true.
alter table profiles add column must_set_password boolean not null default false;

comment on column profiles.must_set_password is
  'True from account creation (or an admin-issued password reset) until the person sets their own password.';

-- Everyone already on the roster picked their own password through the old
-- invite flow, so the default of false is correct for them and no backfill is
-- needed. Anyone still stuck on an unusable invite link gets a fresh
-- temporary password from /admin, which sets this itself.
