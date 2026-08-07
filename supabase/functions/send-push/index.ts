// supabase/functions/send-push/index.ts
//
// Edge Function que recibe una row recién insertada en `notifications`
// (vía Database Webhook) y la envía como push a todos los dispositivos
// del usuario destinatario.
//
// Variables de entorno requeridas (Supabase → Project Settings → Edge Functions → Secrets):
//   SUPABASE_URL            (lo trae Supabase automáticamente)
//   SUPABASE_SERVICE_ROLE_KEY (lo trae Supabase automáticamente)
//
// Opcional:
//   EXPO_ACCESS_TOKEN  → si decides usar Push Security en Expo (recomendado en producción)

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

// CORS para que se pueda invocar desde el dashboard o cualquier cliente
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Espejo de `src/utils/notificationPreferences.js` (Deno no puede importar
// ese archivo directamente). Si se agrega un tipo nuevo a `notifications`,
// hay que sumarlo en ambos lados. Estas preferencias solo controlan el push
// externo — el aviso siempre queda guardado y visible en la bandeja in-app.
const NOTIF_TYPE_TO_PREFERENCE: Record<string, string> = {
  // Partidos y asistencia
  match_join: "notif_matches",
  match_reminder: "notif_matches",
  match_rate: "notif_matches",
  join_request: "notif_matches",
  join_approved: "notif_matches",
  join_rejected: "notif_matches",
  match_cancelled: "notif_matches",
  match_updated: "notif_matches",
  match_slot_free: "notif_matches",
  waitlist_turn: "notif_matches",
  match_left: "notif_matches",
  match_attendance: "notif_matches",

  // Clubes y desafíos
  club_request: "notif_clubs",
  club_request_accepted: "notif_clubs",
  club_request_rejected: "notif_clubs",
  club_member_joined: "notif_clubs",
  club_member_left: "notif_clubs",
  club_invite_accepted: "notif_clubs",
  club_challenge: "notif_clubs",
  club_challenge_accepted: "notif_clubs",
  club_challenge_rejected: "notif_clubs",

  // Mensajes y menciones
  message_new: "notif_chat",

  // Amistades y solicitudes
  friend_request: "notif_friends",
  friend_accept: "notif_friends",
};

function getPreferenceColumn(type: string): string | null {
  return NOTIF_TYPE_TO_PREFERENCE[type] ?? null;
}

// Falla abierto: un tipo sin mapear o un perfil no encontrado nunca bloquean
// el push, solo lo bloquea `false` explícito en la columna correspondiente.
function isPushAllowed(profile: Record<string, any> | null, type: string): boolean {
  const column = getPreferenceColumn(type);
  if (!column) return true;
  if (!profile) return true;
  return profile[column] !== false;
}

interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, any> | null;
  read: boolean;
  sent_push: boolean;
  created_at: string;
}

interface WebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  record: NotificationRow;
  schema: string;
  old_record?: NotificationRow | null;
}

Deno.serve(async (req) => {
  // Preflight CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = (await req.json()) as WebhookPayload;
    console.log("[send-push] payload:", JSON.stringify(payload));

    // Solo procesamos INSERTs en notifications
    if (payload.type !== "INSERT" || payload.table !== "notifications") {
      return new Response(JSON.stringify({ skipped: "not an insert" }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const notif = payload.record;
    if (!notif?.user_id) {
      return new Response(JSON.stringify({ skipped: "no user_id" }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Cliente con service role (puede leer push_tokens y actualizar notifications
    // saltándose RLS — porque corre del lado servidor).
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    // 0) Respetar la preferencia de push del destinatario para esta categoría.
    // El aviso ya quedó guardado en `notifications` (in-app) antes de llegar
    // acá — esto solo decide si además se manda el push externo.
    const preferenceColumn = getPreferenceColumn(notif.type);
    if (preferenceColumn) {
      const { data: profile, error: profileErr } = await admin
        .from("profiles")
        .select(preferenceColumn)
        .eq("id", notif.user_id)
        .maybeSingle();

      if (profileErr) {
        // No se pudo verificar la preferencia: fallamos abierto y seguimos
        // con el envío en vez de perder el push por un error transitorio.
        console.error("[send-push] profile pref error:", profileErr);
      } else if (!isPushAllowed(profile, notif.type)) {
        console.log(
          `[send-push] push omitido por preferencia ${preferenceColumn}=false`,
          notif.user_id,
        );
        // Idempotente: se marca sent_push aunque no se haya enviado, así el
        // webhook nunca reintenta este INSERT por no ver la marca puesta.
        await admin
          .from("notifications")
          .update({ sent_push: true })
          .eq("id", notif.id);
        return new Response(
          JSON.stringify({ skipped: "preference_disabled", preference: preferenceColumn }),
          { headers: { "Content-Type": "application/json", ...corsHeaders } },
        );
      }
    }

    // 1) Buscar push tokens del usuario destinatario
    const { data: tokens, error: tokensErr } = await admin
      .from("push_tokens")
      .select("token, platform")
      .eq("user_id", notif.user_id);

    if (tokensErr) {
      console.error("[send-push] tokens error:", tokensErr);
      return new Response(
        JSON.stringify({ error: tokensErr.message }),
        { status: 500, headers: corsHeaders }
      );
    }

    if (!tokens || tokens.length === 0) {
      console.log("[send-push] usuario sin tokens, marco sent_push igual");
      await admin
        .from("notifications")
        .update({ sent_push: true })
        .eq("id", notif.id);
      return new Response(
        JSON.stringify({ skipped: "no tokens for user" }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // 2) Armar mensajes Expo (uno por token)
    const messages = tokens
      .filter((t) => t.token && t.token.startsWith("ExponentPushToken"))
      .map((t) => ({
        to: t.token,
        sound: "default",
        title: notif.title,
        body: notif.body ?? "",
        data: {
          type: notif.type,
          notificationId: notif.id,
          ...(notif.data || {}),
        },
        // Android specific
        channelId: "default",
        priority: "high" as const,
      }));

    if (messages.length === 0) {
      return new Response(
        JSON.stringify({ skipped: "no valid tokens" }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // 3) Enviar a Expo Push API
    const expoHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
    };
    const accessToken = Deno.env.get("EXPO_ACCESS_TOKEN");
    if (accessToken) {
      expoHeaders["Authorization"] = `Bearer ${accessToken}`;
    }

    const expoResp = await fetch(EXPO_PUSH_ENDPOINT, {
      method: "POST",
      headers: expoHeaders,
      body: JSON.stringify(messages),
    });

    const expoData = await expoResp.json();
    console.log("[send-push] expo response:", JSON.stringify(expoData));

    // 4) Marcar como enviada (aunque haya ticket error en algún device — eso lo
    //    reintenta Expo internamente; aquí solo marcamos que ya intentamos).
    await admin
      .from("notifications")
      .update({ sent_push: true })
      .eq("id", notif.id);

    return new Response(
      JSON.stringify({
        ok: true,
        sent: messages.length,
        expo: expoData,
      }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (err: any) {
    console.error("[send-push] error:", err);
    return new Response(
      JSON.stringify({ error: err?.message ?? String(err) }),
      { status: 500, headers: corsHeaders }
    );
  }
});
