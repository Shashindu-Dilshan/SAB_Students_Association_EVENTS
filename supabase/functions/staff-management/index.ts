import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const validPages = new Set(["dashboard", "participants", "tickets", "event", "scanner", "settings"]);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "Server configuration is incomplete." }, 500);

  const authorization = request.headers.get("Authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json({ error: "Sign in is required." }, 401);

  const adminClient = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await adminClient.auth.getUser(token);
  if (authError || !authData.user) return json({ error: "Your session is invalid or expired." }, 401);
  const userId = authData.user.id;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "A valid JSON body is required." }, 400);
  }
  const action = body.action;

  if (action === "change-password") {
    const password = body.password;
    if (typeof password !== "string" || password.length < 12 || password.length > 128) {
      return json({ error: "Use a password between 12 and 128 characters." }, 400);
    }
    const { data: staff, error } = await adminClient.from("admins")
      .select("role,is_active,must_change_password").eq("id", userId).maybeSingle();
    if (error) return json({ error: "Unable to verify your staff account." }, 500);
    if (!staff || staff.role !== "STAFF" || !staff.is_active || !staff.must_change_password) {
      return json({ error: "A first-login password change is not pending for this account." }, 403);
    }
    const { error: passwordError } = await adminClient.auth.admin.updateUserById(userId, { password });
    if (passwordError) return json({ error: passwordError.message }, 400);
    const { error: flagError } = await adminClient.from("admins")
      .update({ must_change_password: false }).eq("id", userId);
    if (flagError) return json({ error: "Password saved. Sign in again to finish account setup." }, 500);
    return json({ ok: true });
  }

  const { data: actor, error: actorError } = await adminClient.from("admins")
    .select("role,is_active").eq("id", userId).maybeSingle();
  if (actorError) return json({ error: "Unable to verify administrator access." }, 500);
  if (!actor || actor.role !== "ADMIN" || !actor.is_active) {
    return json({ error: "Only an active ADMIN can manage staff accounts." }, 403);
  }

  if (action === "list") {
    const { data, error } = await adminClient.from("admins")
      .select("id,email,role,page_permissions,is_active,must_change_password,created_at")
      .eq("role", "STAFF").order("created_at", { ascending: false });
    if (error) return json({ error: "Unable to load staff accounts." }, 500);
    return json({ staff: data });
  }

  if (action === "create") {
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = body.temporary_password;
    const permissions = body.page_permissions;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
    if (typeof password !== "string" || password.length < 12 || password.length > 128) {
      return json({ error: "Use a temporary password between 12 and 128 characters." }, 400);
    }
    if (!Array.isArray(permissions) || permissions.length === 0 ||
      permissions.some((page) => typeof page !== "string" || !validPages.has(page))) {
      return json({ error: "Choose at least one valid page permission." }, 400);
    }
    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { role: "STAFF" },
    });
    if (createError || !created.user) return json({ error: createError?.message || "Could not create the account." }, 400);
    const { error: insertError } = await adminClient.from("admins").insert({
      id: created.user.id,
      email,
      role: "STAFF",
      page_permissions: [...new Set(permissions as string[])],
      must_change_password: true,
      is_active: true,
    });
    if (insertError) {
      await adminClient.auth.admin.deleteUser(created.user.id);
      return json({ error: "Could not save staff permissions. The new Auth account was rolled back." }, 500);
    }
    return json({ ok: true, staff: { id: created.user.id, email } }, 201);
  }

  const staffId = typeof body.id === "string" ? body.id : "";
  if (!staffId || staffId === userId) return json({ error: "Select a valid staff account." }, 400);
  const { data: target, error: targetError } = await adminClient.from("admins")
    .select("id,role").eq("id", staffId).maybeSingle();
  if (targetError) return json({ error: "Unable to verify the selected account." }, 500);
  if (!target || target.role !== "STAFF") return json({ error: "Only staff accounts can be managed here." }, 404);

  if (action === "update-permissions") {
    const permissions = body.page_permissions;
    if (!Array.isArray(permissions) || permissions.length === 0 ||
      permissions.some((page) => typeof page !== "string" || !validPages.has(page))) {
      return json({ error: "Choose at least one valid page permission." }, 400);
    }
    const { error } = await adminClient.from("admins")
      .update({ page_permissions: [...new Set(permissions as string[])] }).eq("id", staffId);
    if (error) return json({ error: "Unable to update staff permissions." }, 500);
    return json({ ok: true });
  }

  if (action === "set-active" && typeof body.is_active === "boolean") {
    const { error } = await adminClient.from("admins")
      .update({ is_active: body.is_active }).eq("id", staffId);
    if (error) return json({ error: "Unable to update the staff account." }, 500);
    return json({ ok: true });
  }

  return json({ error: "Unknown staff management action." }, 400);
});

