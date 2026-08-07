-- =============================================================
-- FutFinder migration 38: fiabilidad del push externo (send-push)
-- =============================================================
-- Pega esto entero en Supabase → SQL Editor → New query → Run.
--
-- Qué estaba mal: la edge function `send-push` marcaba `sent_push =
-- true` apenas terminaba de llamar a la API de Expo, sin mirar si los
-- tickets que Expo devolvió venían con error, y sin nunca consultar
-- los receipts (Expo entrega el ticket al toque, pero el receipt real
-- —si el push llegó o el token está muerto— se sabe recién unos
-- minutos después). Con eso: tokens inválidos nunca se limpiaban,
-- push fallidos quedaban marcados como "enviados", y un reintento del
-- webhook podía reprocesar la misma notificación en paralelo.
--
-- Qué agrega esta migración:
--   1. `notifications.push_status` reemplaza a `sent_push` (que nunca
--      se leyó desde el cliente, ver src/services/notifications.js)
--      con 5 estados: pending / sending / sent / skipped_preference /
--      skipped_no_token / failed. `push_claimed_at` sirve para que la
--      edge function reclame la fila de forma atómica (evita doble
--      envío si el webhook reintenta) y para recuperar reclamos
--      abandonados si la función se cae a mitad de camino.
--   2. `push_tickets`: una fila por token al que se le mandó un
--      mensaje, con el ticket que devolvió Expo al toque y, más
--      tarde, el receipt real. Así el token malo se puede identificar
--      y borrar de `push_tokens` sin tocar los tokens buenos del
--      mismo usuario cuando el lote es mixto.
--   3. `check_push_receipts()`: función programada (cron, cada 15
--      minutos — el mínimo que recomienda Expo antes de pedir el
--      receipt) que consulta `getReceipts`, guarda el resultado y
--      borra los tokens que Expo marcó `DeviceNotRegistered`.
-- =============================================================

-- ── 1. notifications: push_status reemplaza a sent_push ─────────
alter table public.notifications
  add column if not exists push_status text not null default 'pending',
  add column if not exists push_claimed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.notifications'::regclass
      and conname = 'notifications_push_status_check'
  ) then
    alter table public.notifications
      add constraint notifications_push_status_check
      check (push_status in (
        'pending', 'sending', 'sent',
        'skipped_preference', 'skipped_no_token', 'failed'
      ));
  end if;
end $$;

alter table public.notifications drop column if exists sent_push;

-- ── 2. push_tickets ───────────────────────────────────────────
create table if not exists public.push_tickets (
  id bigint generated always as identity primary key,
  notification_id uuid not null references public.notifications(id) on delete cascade,
  token text not null,
  ticket_status text not null check (ticket_status in ('ok', 'error')),
  ticket_id text,
  ticket_error text,
  receipt_status text not null default 'pending' check (receipt_status in ('pending', 'ok', 'error', 'skipped')),
  receipt_error text,
  created_at timestamptz not null default now(),
  checked_at timestamptz,
  constraint push_tickets_ok_has_id check (ticket_status <> 'ok' or ticket_id is not null)
);

create index if not exists push_tickets_pending_idx
  on public.push_tickets (created_at)
  where receipt_status = 'pending';

alter table public.push_tickets enable row level security;
-- Sin policies a propósito: solo service_role (edge function) y el
-- SECURITY DEFINER de abajo tocan esta tabla, nunca el cliente.

-- ── 3. Consulta de receipts (flujo recomendado por Expo) ────────
create or replace function public.check_push_receipts()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ids text[];
  v_row record;
  v_request_id bigint;
  v_result net.http_response_result;
  v_body jsonb;
  v_receipt jsonb;
  v_error_code text;
begin
  select array_agg(ticket_id) into v_ids
  from (
    select ticket_id
    from public.push_tickets
    where receipt_status = 'pending'
      and ticket_id is not null
      and created_at <= now() - interval '15 minutes'
    order by created_at
    limit 300
  ) t;

  if v_ids is null or array_length(v_ids, 1) = 0 then
    return;
  end if;

  v_request_id := net.http_post(
    url := 'https://exp.host/--/api/v2/push/getReceipts',
    body := jsonb_build_object('ids', to_jsonb(v_ids)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Accept', 'application/json'),
    timeout_milliseconds := 10000
  );

  v_result := net.http_collect_response(v_request_id, false);

  if v_result.status <> 'SUCCESS' or (v_result.response).status_code is distinct from 200 then
    raise notice '[check_push_receipts] fallo consultando receipts (status=%, http=%)',
      v_result.status, (v_result.response).status_code;
    return;
  end if;

  v_body := (v_result.response).body::jsonb;

  for v_row in
    select id, ticket_id, token
    from public.push_tickets
    where ticket_id = any (v_ids)
      and receipt_status = 'pending'
  loop
    v_receipt := v_body #> array['data', v_row.ticket_id];
    if v_receipt is null then
      continue; -- Expo todavía no lo tiene listo, se reintenta en la próxima corrida
    end if;

    if (v_receipt ->> 'status') = 'ok' then
      update public.push_tickets
         set receipt_status = 'ok', checked_at = now()
       where id = v_row.id;
    else
      v_error_code := v_receipt #>> array['details', 'error'];
      update public.push_tickets
         set receipt_status = 'error',
             receipt_error = coalesce(v_error_code, left(v_receipt ->> 'message', 200)),
             checked_at = now()
       where id = v_row.id;

      if v_error_code = 'DeviceNotRegistered' then
        delete from public.push_tokens where token = v_row.token;
      end if;
    end if;
  end loop;

  -- Tickets que Expo nunca resolvió (típicamente ids muy viejos):
  -- se cortan para no reintentarlos para siempre.
  update public.push_tickets
     set receipt_status = 'error', receipt_error = 'expired_unchecked', checked_at = now()
   where receipt_status = 'pending'
     and created_at <= now() - interval '2 days';
exception when others then
  raise notice '[check_push_receipts] error inesperado: %', sqlerrm;
end;
$function$;

-- No es una RPC de la app: solo debe correr desde el cron (rol
-- postgres). Sin este revoke, PostgREST la expone en
-- /rest/v1/rpc/check_push_receipts y cualquier `anon` podría
-- dispararla (mismo tipo de leak que corrigió la migración 37).
revoke execute on function public.check_push_receipts() from public, anon, authenticated;

select cron.schedule(
  'futfinder-push-receipts',
  '*/15 * * * *',
  $$select public.check_push_receipts();$$
);
