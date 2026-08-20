import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { isRole, type LoginEvent, type LoginMethod, type ManagedUser, type Role, type Viewer } from "@/lib/types";

let warnedNoServiceKey = false;

function toRole(value: unknown): Role {
  return typeof value === "string" && isRole(value) ? value : "ae";
}

// Identity comes from getUser(), which validates the JWT against the auth
// server rather than trusting the cookie. The role is then read with the
// service-role key on purpose: an authorization decision shouldn't depend on
// the profiles RLS policies being right.
//
// cache() dedupes this per request, so the nav bar, the layout's deactivation
// check, and the page they wrap share one lookup.
export const getViewer = cache(async (): Promise<Viewer | null> => {
  if (!isSupabaseConfigured) return null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const email = user.email ?? "";
  const admin = createAdminClient();
  // Without a service-role key nobody can be an admin or an EiC, which is the
  // safe direction to fail: /admin 404s instead of standing open. It also
  // means a missing key looks exactly like "you're not an admin", so say so in
  // the log - otherwise the only symptom is a baffling 404.
  if (!admin) {
    if (!warnedNoServiceKey) {
      console.warn(
        "[admin] SUPABASE_SERVICE_ROLE_KEY is not set - /admin will 404 for everyone, " +
          "including admins. See .env.local.example.",
      );
      warnedNoServiceKey = true;
    }
    return { id: user.id, email, role: "ae", journalId: null, active: true, mustSetPassword: false };
  }

  const { data } = await admin
    .from("profiles")
    .select("role, journal_id, active, must_set_password")
    .eq("id", user.id)
    .maybeSingle();

  return {
    id: user.id,
    email,
    role: toRole(data?.role),
    journalId: data?.journal_id ?? null,
    // Absent profile row means something is wrong with the signup trigger;
    // treat it as active so a broken trigger doesn't lock everyone out.
    active: data?.active ?? true,
    // Same reasoning in the other direction: if we can't tell, don't trap
    // them on the set-a-password page.
    mustSetPassword: data?.must_set_password ?? false,
  };
});

/** Admins see everyone; an EiC sees only their own journal's people. */
export async function getManagedUsers(viewer: Viewer): Promise<ManagedUser[]> {
  const admin = createAdminClient();
  if (!admin) return [];

  // auth.users holds the sign-in facts (created, last seen, confirmed);
  // profiles holds role, journal, and active. Neither is complete on its own.
  const authUsers = [];
  const perPage = 200;
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    authUsers.push(...data.users);
    if (data.users.length < perPage) break;
  }

  const [{ data: profiles }, { data: events }] = await Promise.all([
    admin.from("profiles").select("id, role, journal_id, active, must_set_password"),
    admin.from("login_events").select("user_id"),
  ]);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const loginCounts = new Map<string, number>();
  for (const event of events ?? []) {
    if (event.user_id) loginCounts.set(event.user_id, (loginCounts.get(event.user_id) ?? 0) + 1);
  }

  return authUsers
    .map((user) => {
      const profile = profileById.get(user.id);
      return {
        id: user.id,
        email: user.email ?? "(no email)",
        role: toRole(profile?.role),
        journalId: profile?.journal_id ?? null,
        active: profile?.active ?? true,
        createdAt: user.created_at ?? null,
        lastSignInAt: user.last_sign_in_at ?? null,
        // Their account is real from the moment it's created now, so what
        // "activated" means is whether they've replaced the password we
        // mailed them with one of their own.
        activated: !(profile?.must_set_password ?? false),
        loginCount: loginCounts.get(user.id) ?? 0,
      };
    })
    .filter((user) => canManage(viewer, user))
    .sort((a, b) => (b.lastSignInAt ?? "").localeCompare(a.lastSignInAt ?? ""));
}

// The single authority on who may act on whom. Both the page (what to render)
// and every Server Action (what to allow) go through this, so the UI can't
// drift out of step with what's actually enforced.
export function canManage(
  viewer: Viewer,
  target: { id: string; role: Role; journalId: number | null },
): boolean {
  if (viewer.role === "admin") return true;
  if (viewer.role !== "eic" || viewer.journalId === null) return false;
  // An EiC administers the AEs of their own journal - not other EiCs, not
  // admins, and not themselves (no self-promotion, no self-removal).
  return target.role === "ae" && target.journalId === viewer.journalId && target.id !== viewer.id;
}

/** Roles the viewer is allowed to assign. EiCs can only ever make AEs. */
export function assignableRoles(viewer: Viewer): Role[] {
  return viewer.role === "admin" ? ["ae", "eic", "admin"] : ["ae"];
}

export async function getLoginEvents(viewer: Viewer, limit = 100): Promise<LoginEvent[]> {
  const admin = createAdminClient();
  if (!admin) return [];

  let query = admin
    .from("login_events")
    .select("id, email, method, ip, user_agent, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  // An EiC's sign-in log is scoped the same way their roster is. Events whose
  // user has since been deleted (user_id nulled) are only an admin's business.
  if (viewer.role !== "admin") {
    const { data: scoped } = await admin
      .from("profiles")
      .select("id")
      .eq("journal_id", viewer.journalId)
      .eq("role", "ae");
    const ids = (scoped ?? []).map((p) => p.id);
    if (ids.length === 0) return [];
    query = query.in("user_id", ids);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    method: row.method as LoginMethod,
    ip: row.ip,
    userAgent: row.user_agent,
    createdAt: row.created_at,
  }));
}
