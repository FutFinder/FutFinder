-- =============================================================
-- FutFinder — pruebas de la migración 193 (comprobantes de push).
--
--   A1 La primera corrida PIDE (deja la consulta anotada) y no procesa nada.
--   A2 Una segunda corrida sin respuesta todavía no vuelve a pedir lo mismo.
--   A3 Con la respuesta de Expo guardada por pg_net, la corrida siguiente
--      la procesa: ticket ok, ticket en error, y el token del teléfono que
--      ya no existe (DeviceNotRegistered) se borra; el otro no.
--   A4 La consulta leída se borra.
--   A5 Ningún cliente lee la tabla de consultas ni ejecuta la función.
--
-- La respuesta de Expo se simula escribiendo en `net._http_response`, que es
-- donde pg_net la deja; el envío real no sale porque todo termina en ROLLBACK.
-- =============================================================

begin;

create temp table r193 (caso text, ok boolean, detalle text);

do $$
declare
  u1 uuid := gen_random_uuid();
  v_req bigint; v_n int; v_aviso uuid;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', u1, 'authenticated', 'authenticated', 'r193-' || u1 || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '');
  insert into public.profiles (id, username) values (u1, 'r193' || substr(replace(u1::text, '-', ''), 1, 10)) on conflict (id) do nothing;
  insert into public.push_tokens (user_id, token) values (u1, 'ExponentPushToken[r193-vivo]'), (u1, 'ExponentPushToken[r193-muerto]');
  insert into public.notifications (user_id, type, title, body) values (u1, 'friend_request', 'r193', 'r193') returning id into v_aviso;
  insert into public.push_tickets (notification_id, token, ticket_status, ticket_id, receipt_status, created_at)
  values (v_aviso, 'ExponentPushToken[r193-vivo]', 'ok', 'r193-t-ok', 'pending', now() - interval '1 hour'),
         (v_aviso, 'ExponentPushToken[r193-muerto]', 'ok', 'r193-t-muerto', 'pending', now() - interval '1 hour');

  -- ── A1 ──
  perform public.check_push_receipts();
  select request_id into v_req from public.push_receipt_consultas where 'r193-t-ok' = any (ids);
  insert into r193 select 'A1 la primera corrida pide y no procesa',
    v_req is not null
      and (select count(*) from public.push_tickets where ticket_id like 'r193-%' and receipt_status = 'pending') = 2,
    coalesce(v_req::text, 'sin consulta');

  -- ── A2 ──
  perform public.check_push_receipts();
  select count(*) into v_n from public.push_receipt_consultas where 'r193-t-ok' = any (ids);
  insert into r193 values ('A2 sin respuesta no se vuelve a pedir lo mismo', v_n = 1, 'consultas=' || v_n);

  -- ── A3 / A4 ── la respuesta de Expo, donde la deja pg_net
  insert into net._http_response (id, status_code, content_type, content, timed_out, created)
  values (v_req, 200, 'application/json',
          '{"data":{"r193-t-ok":{"status":"ok"},"r193-t-muerto":{"status":"error","message":"no","details":{"error":"DeviceNotRegistered"}}}}',
          false, now());
  perform public.check_push_receipts();

  insert into r193 select 'A3 la corrida siguiente procesa la respuesta',
    (select receipt_status from public.push_tickets where ticket_id = 'r193-t-ok') = 'ok'
      and (select receipt_error from public.push_tickets where ticket_id = 'r193-t-muerto') = 'DeviceNotRegistered'
      and not exists (select 1 from public.push_tokens where token = 'ExponentPushToken[r193-muerto]')
      and exists (select 1 from public.push_tokens where token = 'ExponentPushToken[r193-vivo]'),
    '';
  insert into r193 select 'A4 la consulta leída se borra',
    not exists (select 1 from public.push_receipt_consultas where request_id = v_req), '';

  -- ── A5 ──
  insert into r193 select 'A5 ningún cliente lee la tabla ni ejecuta la función',
    not has_table_privilege('authenticated', 'public.push_receipt_consultas', 'select')
      and not has_table_privilege('anon', 'public.push_receipt_consultas', 'select')
      and not has_function_privilege('authenticated', 'public.check_push_receipts()', 'execute')
      and not has_function_privilege('anon', 'public.check_push_receipts()', 'execute'),
    '';
end $$;

select caso, ok, detalle from r193 order by caso;

rollback;
