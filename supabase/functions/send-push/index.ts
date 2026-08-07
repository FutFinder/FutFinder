// supabase/functions/send-push/index.ts
//
// Edge Function que recibe una row recién insertada en `notifications`
// (vía Database Webhook) y la envía como push a todos los dispositivos
// del usuario destinatario.
//
// Flujo (recomendado por Expo — https://docs.expo.dev/push-notifications/sending-notifications/):
//   1. Se reclama la notificación de forma atómica (evita doble envío
//      si el webhook reintenta la misma fila).
//   2. Se arman los mensajes y se mandan a Expo en tandas de 100.
//   3. Cada ticket que Expo devuelve al toque se guarda en
//      `push_tickets`; un ticket con error nunca marca la notif como
//      enviada, y si el error es DeviceNotRegistered el token se borra
//      ahí mismo.
//   4. Los tickets que salieron 'ok' quedan pendientes de receipt —
//      eso lo procesa después el cron `check_push_receipts()` (ver
//      migración 38), porque Expo recomienda esperar al menos ~15 min
//      antes de consultarlo.
//
// Variables de entorno requeridas (Supabase → Project Settings → Edge Functions → Secrets):
//   SUPABASE_URL              (lo trae Supabase automáticamente)
//   SUPABASE_SERVICE_ROLE_KEY (lo trae Supabase automáticamente)
//
// Opcional:
//   EXPO_ACCESS_TOKEN  → si decides usar Push Security en Expo (recomendado en producción)

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildExpoMessage,
  chunk,
  classifyTickets,
  dedupeValidTokens,
  getPreferenceColumn,
  isPushAllowed,
  maskToken,
  summarizePushStatus,
  type ExpoTicket,
  type PushStatus,
} from "./pushLogic.ts";

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
const EXPO_CHUNK_SIZE = 100;
const CLAIM_STALE_AFTER_MINUTES = 2;

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
  push_status: PushStatus;
  created_at: string;
}

interface WebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  record: NotificationRow;
  schema: string;
  old_record?: NotificationRow | null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let notif: NotificationRow | null = null;
  let admin: any = null;

  try {
    const payload = (await req.json()) as WebhookPayload;

    if (payload.type !== "INSERT" || payload.table !== "notifications") {
      return json({ skipped: "not an insert" });
    }

    notif = payload.record;
    if (!notif?.user_id || !notif?.id) {
      return json({ skipped: "no user_id" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    // 0) Reclamar la fila de forma atómica. Si el webhook reintenta el
    // mismo INSERT mientras un envío anterior sigue en curso (o ya
    // terminó), esta condición no matchea ninguna fila y se corta acá
    // sin volver a mandar nada. `push_claimed_at` vencido recupera
    // reclamos de una invocación anterior que se cayó a mitad de camino.
    const staleCutoff = new Date(
      Date.now() - CLAIM_STALE_AFTER_MINUTES * 60_000,
    ).toISOString();

    const { data: claimed, error: claimErr } = await admin
      .from("notifications")
      .update({ push_status: "sending", push_claimed_at: new Date().toISOString() })
      .eq("id", notif.id)
      .or(`push_status.eq.pending,and(push_status.eq.sending,push_claimed_at.lt.${staleCutoff})`)
      .select()
      .maybeSingle();

    if (claimErr) {
      console.error("[send-push] claim error:", claimErr.message);
      return json({ error: claimErr.message }, 500);
    }
    if (!claimed) {
      console.log(`[send-push] notif ${notif.id} ya reclamada, se omite (reintento del webhook)`);
      return json({ skipped: "already_processing_or_done" });
    }
    notif = claimed as NotificationRow;

    // 1) Respetar la preferencia de push del destinatario para esta
    // categoría. El aviso ya quedó guardado en `notifications` (in-app)
    // antes de llegar acá — esto solo decide si además se manda el push
    // externo.
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
        console.error("[send-push] profile pref error:", profileErr.message);
      } else if (!isPushAllowed(profile, notif.type)) {
        console.log(
          `[send-push] push omitido por preferencia ${preferenceColumn}=false para notif ${notif.id}`,
        );
        await admin
          .from("notifications")
          .update({ push_status: "skipped_preference" })
          .eq("id", notif.id);
        return json({ skipped: "preference_disabled", preference: preferenceColumn });
      }
    }

    // 2) Buscar push tokens del usuario destinatario
    const { data: tokenRows, error: tokensErr } = await admin
      .from("push_tokens")
      .select("token, platform")
      .eq("user_id", notif.user_id);

    if (tokensErr) {
      console.error("[send-push] tokens error:", tokensErr.message);
      await admin
        .from("notifications")
        .update({ push_status: "failed" })
        .eq("id", notif.id);
      return json({ error: tokensErr.message }, 500);
    }

    const validTokens = dedupeValidTokens(tokenRows || []);

    if (validTokens.length === 0) {
      console.log(`[send-push] notif ${notif.id}: usuario sin tokens válidos`);
      await admin
        .from("notifications")
        .update({ push_status: "skipped_no_token" })
        .eq("id", notif.id);
      return json({ skipped: "no valid tokens" });
    }

    // 3) Enviar a Expo en tandas de EXPO_CHUNK_SIZE, procesando cada
    // tanda con su propio try/catch: si una tanda falla (red, 5xx de
    // Expo), las demás igual se intentan y el resultado final refleja
    // el mix real en vez de perder todo el lote por un error parcial.
    const tokens = validTokens.map((t) => t.token);
    const tokenChunks = chunk(tokens, EXPO_CHUNK_SIZE);

    const expoHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
    };
    const accessToken = Deno.env.get("EXPO_ACCESS_TOKEN");
    if (accessToken) {
      expoHeaders["Authorization"] = `Bearer ${accessToken}`;
    }

    const allResults: ReturnType<typeof classifyTickets> = [];

    for (const tokenChunk of tokenChunks) {
      const messages = tokenChunk.map((t) => buildExpoMessage(notif!, t));
      try {
        const expoResp = await fetch(EXPO_PUSH_ENDPOINT, {
          method: "POST",
          headers: expoHeaders,
          body: JSON.stringify(messages),
        });
        const expoData = await expoResp.json();
        const tickets: ExpoTicket[] = Array.isArray(expoData?.data)
          ? expoData.data
          : [];
        if (!expoResp.ok || tickets.length !== tokenChunk.length) {
          console.error(
            `[send-push] respuesta inesperada de Expo (http=${expoResp.status}, tickets=${tickets.length}/${tokenChunk.length})`,
          );
        }
        allResults.push(...classifyTickets(tokenChunk, tickets));
      } catch (fetchErr: any) {
        console.error("[send-push] fallo llamando a Expo:", fetchErr?.message ?? fetchErr);
        // Toda la tanda queda como error de ticket (sin id de Expo) —
        // no se borra ningún token, es un fallo de red, no del token.
        allResults.push(
          ...tokenChunk.map((token) => ({
            token,
            ticketStatus: "error" as const,
            ticketId: null,
            ticketError: "expo_request_failed",
            removeToken: false,
          })),
        );
      }
    }

    // 4) Registrar un ticket por token (auditable, sin exponer el token
    // completo en logs) y limpiar los tokens que Expo marcó como
    // definitivamente inválidos.
    const ticketRows = allResults.map((r) => ({
      notification_id: notif!.id,
      token: r.token,
      ticket_status: r.ticketStatus,
      ticket_id: r.ticketId,
      ticket_error: r.ticketError,
      receipt_status: r.ticketStatus === "ok" ? "pending" : "skipped",
    }));
    const { error: ticketsInsertErr } = await admin
      .from("push_tickets")
      .insert(ticketRows);
    if (ticketsInsertErr) {
      console.error("[send-push] error guardando push_tickets:", ticketsInsertErr.message);
    }

    const tokensToRemove = allResults.filter((r) => r.removeToken).map((r) => r.token);
    if (tokensToRemove.length > 0) {
      const { error: deleteErr } = await admin
        .from("push_tokens")
        .delete()
        .in("token", tokensToRemove);
      if (deleteErr) {
        console.error("[send-push] error borrando tokens inválidos:", deleteErr.message);
      } else {
        console.log(
          `[send-push] notif ${notif.id}: ${tokensToRemove.length} token(s) inválido(s) eliminado(s) (${tokensToRemove.map(maskToken).join(", ")})`,
        );
      }
    }

    const finalStatus = summarizePushStatus(allResults);
    await admin
      .from("notifications")
      .update({ push_status: finalStatus })
      .eq("id", notif.id);

    const okCount = allResults.filter((r) => r.ticketStatus === "ok").length;
    console.log(
      `[send-push] notif ${notif.id}: ${okCount}/${allResults.length} ticket(s) ok, status final=${finalStatus}`,
    );

    return json({
      ok: true,
      pushStatus: finalStatus,
      sent: okCount,
      failed: allResults.length - okCount,
      tokensRemoved: tokensToRemove.length,
    });
  } catch (err: any) {
    console.error("[send-push] error:", err?.message ?? err);
    // Si ya habíamos reclamado la notif antes de reventar, la dejamos
    // en 'failed' en vez de 'sending' colgado — igual es recuperable:
    // el claim por staleness la vuelve a tomar si hiciera falta.
    if (admin && notif?.id) {
      try {
        await admin
          .from("notifications")
          .update({ push_status: "failed" })
          .eq("id", notif.id);
      } catch (_) {
        // noop — ya estamos en el catch general, no hay mucho más que hacer
      }
    }
    return json({ error: err?.message ?? String(err) }, 500);
  }
});
