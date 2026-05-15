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
    // Sonido custom: usa el nombre del archivo declarado en app.json
    // (en assets/sounds/whistle.wav). En iOS NO se pone extensión.
    // En Android el canal "default" del cliente ya lo trae configurado.
    const messages = tokens
      .filter((t) => t.token && t.token.startsWith("ExponentPushToken"))
      .map((t) => ({
        to: t.token,
        sound: t.platform === "ios" ? "whistle.wav" : "default",
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
