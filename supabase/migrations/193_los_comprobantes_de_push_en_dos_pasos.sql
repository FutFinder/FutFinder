-- =============================================================
-- 193. LOS COMPROBANTES DE PUSH, EN DOS PASOS
--
-- `check_push_receipts()` (migración 38, cron cada 15 minutos) le pide a Expo
-- los comprobantes de entrega y, con ellos, borra los tokens de teléfonos que
-- ya no existen (`DeviceNotRegistered`). Nunca funcionó: hacía el
-- `net.http_post` y en la MISMA transacción llamaba
-- `net.http_collect_response`. pg_net manda la petición recién cuando la
-- transacción termina, así que la respuesta no podía estar: la función
-- registraba un fallo y salía, cada 15 minutos, sin procesar nada. No se notó
-- porque hasta el 2026-11-18 no había ni un ticket de push (un solo token
-- registrado en toda la base): el cron terminaba en el `return` del principio.
-- Con usuarios reales, los tokens muertos se iban a acumular para siempre y
-- cada aviso les mandaría un push que no llega.
--
-- AHORA, EN DOS PASOS, en cada corrida:
--   1. Lee las respuestas de las consultas que dejó la corrida ANTERIOR
--      (`net._http_response`, donde pg_net las guarda) y las procesa igual que
--      antes: `ok`, `error`, y borra el token si Expo dice DeviceNotRegistered.
--   2. Pide los comprobantes de los tickets pendientes que no estén ya
--      pedidos, y anota el id de la petición en `push_receipt_consultas`.
-- Una consulta sin respuesta en 30 minutos se olvida y sus tickets se vuelven
-- a pedir; los tickets de más de dos días se cierran como antes.
--
-- De paso: si algún día se activa la seguridad reforzada de Expo y se guarda
-- el token de acceso en Vault con el nombre `expo_access_token`, la consulta
-- lo manda. Sin ese secreto todo sigue igual.
--
-- Pruebas: supabase/tests/193_los_comprobantes_de_push_en_dos_pasos_test.sql
-- =============================================================

create table if not exists public.push_receipt_consultas (
  request_id bigint primary key,
  ids        text[] not null,
  pedida_at  timestamptz not null default now()
);
alter table public.push_receipt_consultas enable row level security;
revoke all on public.push_receipt_consultas from public, anon, authenticated;
comment on table public.push_receipt_consultas is
  'Consultas de comprobantes de push enviadas a Expo y todavía no leídas (migración 193). La llena y la vacía check_push_receipts().';

create or replace function public.check_push_receipts()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_consulta record;
  v_resp record;
  v_body jsonb;
  v_row record;
  v_receipt jsonb;
  v_error_code text;
  v_ids text[];
  v_token text;
  v_headers jsonb;
  v_request_id bigint;
begin
  -- ── 1. Las respuestas de lo que se pidió antes ──
  for v_consulta in
    select * from public.push_receipt_consultas order by pedida_at
  loop
    select * into v_resp from net._http_response where id = v_consulta.request_id;

    if v_resp.id is null then
      -- Todavía no responde; si ya pasó media hora, se olvida y sus tickets
      -- se vuelven a pedir en el paso 2.
      if v_consulta.pedida_at < now() - interval '30 minutes' then
        delete from public.push_receipt_consultas where request_id = v_consulta.request_id;
      end if;
      continue;
    end if;

    delete from public.push_receipt_consultas where request_id = v_consulta.request_id;

    if v_resp.status_code is distinct from 200 or v_resp.content is null then
      raise notice '[check_push_receipts] Expo contestó % (%)', v_resp.status_code, coalesce(v_resp.error_msg, '');
      continue;
    end if;

    begin
      v_body := v_resp.content::jsonb;
    exception when others then
      raise notice '[check_push_receipts] respuesta que no es JSON';
      continue;
    end;

    for v_row in
      select id, ticket_id, token
        from public.push_tickets
       where ticket_id = any (v_consulta.ids)
         and receipt_status = 'pending'
    loop
      v_receipt := v_body #> array['data', v_row.ticket_id];
      if v_receipt is null then
        continue; -- Expo todavía no lo tiene listo: se vuelve a pedir
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
  end loop;

  -- ── 2. Pedir lo pendiente que no esté ya pedido ──
  select array_agg(ticket_id) into v_ids
    from (
      select t.ticket_id
        from public.push_tickets t
       where t.receipt_status = 'pending'
         and t.ticket_id is not null
         and t.created_at <= now() - interval '15 minutes'
         and not exists (select 1 from public.push_receipt_consultas c
                          where t.ticket_id = any (c.ids))
       order by t.created_at
       limit 300
    ) s;

  if coalesce(array_length(v_ids, 1), 0) > 0 then
    v_headers := jsonb_build_object('Content-Type', 'application/json', 'Accept', 'application/json');
    begin
      select decrypted_secret into v_token
        from vault.decrypted_secrets where name = 'expo_access_token';
    exception when others then
      v_token := null;
    end;
    if coalesce(v_token, '') <> '' then
      v_headers := v_headers || jsonb_build_object('Authorization', 'Bearer ' || v_token);
    end if;

    v_request_id := net.http_post(
      url := 'https://exp.host/--/api/v2/push/getReceipts',
      body := jsonb_build_object('ids', to_jsonb(v_ids)),
      headers := v_headers,
      timeout_milliseconds := 10000
    );
    insert into public.push_receipt_consultas (request_id, ids) values (v_request_id, v_ids);
  end if;

  -- ── 3. Tickets que Expo nunca resolvió: se cortan ──
  update public.push_tickets
     set receipt_status = 'error', receipt_error = 'expired_unchecked', checked_at = now()
   where receipt_status = 'pending'
     and created_at <= now() - interval '2 days';
exception when others then
  raise notice '[check_push_receipts] error inesperado: %', sqlerrm;
end;
$$;

revoke all on function public.check_push_receipts() from public, anon, authenticated;
