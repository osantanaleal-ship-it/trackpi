import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response({ error: "Método no permitido" }, 405);

  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) return response({ error: "Sesión necesaria" }, 401);

  try {
    const { code } = await request.json();
    const normalizedCode = String(code || "").trim().toUpperCase();
    if (!/^SAL-[A-F0-9]{6}$/.test(normalizedCode)) {
      return response({ error: "Código de miembro no válido" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return response({ error: "Servicio no configurado" }, 503);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return response({ error: "Sesión no válida" }, 401);

    const { data: member, error } = await admin
      .from("salvi_profiles")
      .select("id, display_name, member_code")
      .eq("member_code", normalizedCode)
      .neq("id", authData.user.id)
      .maybeSingle();

    if (error) return response({ error: "No se pudo buscar el miembro" }, 500);
    if (!member) return response({ member: null }, 200);
    return response({ member });
  } catch {
    return response({ error: "Petición no válida" }, 400);
  }
});
