import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { isRole, type LoginEvent, type LoginMethod, type ManagedUser, type Viewer } from "@/lib/types";

let warnedNoServiceKey = false;

// Identity comes from getUser(), which validates the JWT against the auth
// server rather than trusting the cookie. The role is then read with the
// service-role key on purpose: an authorization decision shouldn't depend on
// the profiles RLS policies being right.
//
// cache() dedupes this per request, so the nav bar and the page it wraps share
// one lookup.
export const getViewer = cache(async (): Promise<Viewer | null> => {
  if (!isSupabaseConfigured) return null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const email = user.email ?? "";
  const admin = createAdminClient();
  // Without a service-role key nobody can be an admin, which is the safe
  // direction to fail: /admin 404s instead of standing open. It also means a
  // missing key looks exactly like "you're not an admin", so say so in the
  // log - otherwise the only symptom is a baffling 404.
  if (!admin) {
    if (!warnedNoServiceKey) {
      console.warn(
        "[admin] SUPABASE_SERVICE_ROLE_KEY is not set - /admin will 404 for everyone, " +
          "including admins. See .env.local.example.",
      );
      warnedNoServiceKey = true;
    }
    return { id: user.id, email, role: "reviewer" };
  }

  const { data } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();

  const role = data?.role;
  return {
    id: user.id,
    email,
    role: typeof role === "string" && isRole(role) ? role : "reviewer",
  };
});

export async function getManagedUsers(): Promise<ManagedUser[]> {
  const admin = createAdminClient();
  if (!admin) return [];

  // auth.users holds the sign-in facts (created, last seen, confirmed);
  // profiles holds the role. Neither is complete on its own.
  const authUsers = [];
  const perPage = 200;
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    authUsers.push(...data.users);
    if (data.users.length < perPage) break;
  }

  const [{ data: profiles }, { data: events }] = await Promise.all([
    admin.from("profiles").select("id, role"),
    admin.from("login_events").select("user_id"),
  ]);

  const roleById = new Map<string, string>((profiles ?? []).map((p) => [p.id, p.role]));
  const loginCounts = new Map<string, number>();
  for (const event of events ?? []) {
    if (event.user_id) loginCounts.set(event.user_id, (loginCounts.get(event.user_id) ?? 0) + 1);
  }

  return authUsers
    .map((user) => {
      const role = roleById.get(user.id);
      return {
        id: user.id,
        email: user.email ?? "(no email)",
        role: typeof role === "string" && isRole(role) ? role : "reviewer",
        createdAt: user.created_at ?? null,
        lastSignInAt: user.last_sign_in_at ?? null,
        activated: Boolean(user.email_confirmed_at ?? user.confirmed_at),
        loginCount: loginCounts.get(user.id) ?? 0,
      };
    })
    .sort((a, b) => (b.lastSignInAt ?? "").localeCompare(a.lastSignInAt ?? ""));
}

export async function getLoginEvents(limit = 100): Promise<LoginEvent[]> {
  const admin = createAdminClient();
  if (!admin) return [];

  const { data, error } = await admin
    .from("login_events")
    .select("id, email, method, ip, user_agent, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
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
