-- =============================================================
-- FutFinder — pruebas de la migración 180 (de un pago, el cliente lee lo
-- justo).
--
--   A  El dueño lee su pago con la consulta de la app; no puede leer
--      `datos`, el token ni la nota de devolución (42501, no «vacío»).
--   B  Otro usuario no ve la fila (control de la RLS, que no cambió).
--   C  `anon` no lee nada; `authenticated` no escribe (42501).
--   D  Lo que corre como dueño sigue igual: iniciar y confirmar un pago.
--   E  `service_role` sigue leyendo todo.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK. Si un caso
-- falla, el arnés falla.
-- =============================================================

begin;

create temp table r180 (caso text, ok boolean, detalle text);
grant all on r180 to authenticated, anon, service_role;

create or replace function pg_temp.como(p_uid uuid, p_sql text, p_rol text default 'authenticated')
returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_rol, 'aal', 'aal1')::text, true);
  execute format('set local role %I', p_rol);
  begin
    execute p_sql into v; execute 'reset role'; v := 'ok:' || coalesce(v, '');
  exception when others then execute 'reset role'; v := 'err:' || sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  return v;
end $$;

do $$
declare
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); u_admin uuid := gen_random_uuid();
  v_comp uuid; v_cancha uuid; v_res uuid; v_res2 uuid; v_pago uuid;
  v_j json; r text; col text;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'r180-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}'
    from unnest(array[u1, u2, u_admin]) u;
  insert into public.profiles (id, username) select u, 'r180' || substr(replace(u::text, '-', ''), 1, 10) from unnest(array[u1, u2, u_admin]) u on conflict (id) do nothing;

  insert into public.complejos (nombre, comuna, latitud, longitud) values ('r180 recinto', 'Ñuñoa', -33.45, -70.6) returning id into v_comp;
  insert into public.complejo_admins (complejo_id, user_id, rol) values (v_comp, u_admin, 'dueño');
  insert into public.canchas_reservables (complejo_id, nombre, tipo, precio_hora) values (v_comp, 'r180 cancha', 'futbol_7', 20000) returning id into v_cancha;

  insert into public.reservas (cancha_id, organizador_id, fecha, hora_inicio, hora_fin, precio_total, modalidad, medio_pago, precio_cancha, estado)
  values (v_cancha, u1, current_date + 200, '05:17', '06:17', 20000, 'completa', 'tarjeta', 20000, 'armando') returning id into v_res;
  insert into public.reservas (cancha_id, organizador_id, fecha, hora_inicio, hora_fin, precio_total, modalidad, medio_pago, precio_cancha, estado)
  values (v_cancha, u1, current_date + 201, '05:17', '06:17', 20000, 'completa', 'tarjeta', 20000, 'armando') returning id into v_res2;
  insert into public.pagos (user_id, reserva_id, monto, proveedor, orden_comercio, estado, referencia_externa, datos, reversa_nota)
  values (u1, v_res, 20000, 'flow', 'R180-A', 'pendiente', 'TOKENR180SECRETO', '{"payer": "alguien@futfinder.test", "url": "https://flow.test/pay"}', 'nota interna')
  returning id into v_pago;

  -- ── A: el dueño ──
  -- La consulta EXACTA de `estadoDePago` (src/services/pagos.js).
  r := pg_temp.como(u1, format($q$select row_to_json(t)::text from (select id, estado, monto, orden_comercio, pagado_at from public.pagos where reserva_id = %L order by created_at desc limit 1) t$q$, v_res));
  insert into r180 values ('A1 control: el dueño lee su pago con la consulta de la app', r like 'ok:%"orden_comercio":"R180-A"%', r);
  foreach col in array array['datos', 'referencia_externa', 'reversa_nota', 'reversado_por'] loop
    r := pg_temp.como(u1, format($q$select %I::text from public.pagos where id = %L$q$, col, v_pago));
    insert into r180 values ('A2 el dueño no lee ' || col || ' (42501)', r like 'err:42501%', r);
  end loop;
  r := pg_temp.como(u1, format($q$select row_to_json(p)::text from public.pagos p where id = %L$q$, v_pago));
  insert into r180 values ('A3 un select * tampoco (42501)', r like 'err:42501%', r);
  r := pg_temp.como(u1, format($q$select count(*)::text from public.pagos where id = %L and datos is not null$q$, v_pago));
  insert into r180 values ('A4 ni filtrar por una columna cerrada (42501)', r like 'err:42501%', r);

  -- ── B: otro usuario ──
  r := pg_temp.como(u2, format($q$select count(*)::text from public.pagos where reserva_id = %L$q$, v_res));
  insert into r180 values ('B1 control: otro usuario no ve la fila', r = 'ok:0', r);

  -- ── C: anon y escrituras ──
  r := pg_temp.como(null, 'select count(*)::text from public.pagos', 'anon');
  insert into r180 values ('C1 anon no lee pagos (42501)', r like 'err:42501%', r);
  r := pg_temp.como(u1, format($q$update public.pagos set estado = 'pagado' where id = %L returning 'cambiado'$q$, v_pago));
  insert into r180 values ('C2 el dueño no actualiza su pago (42501)', r like 'err:42501%', r);
  r := pg_temp.como(u1, format($q$insert into public.pagos (user_id, reserva_id, monto, proveedor, orden_comercio) values (%L, %L, 1, 'flow', 'R180-X') returning 'creado'$q$, u1, v_res2));
  insert into r180 values ('C3 ni inserta uno a mano (42501)', r like 'err:42501%', r);
  r := pg_temp.como(u1, format($q$delete from public.pagos where id = %L returning 'borrado'$q$, v_pago));
  insert into r180 values ('C4 ni lo borra (42501)', r like 'err:42501%', r);
  insert into r180 select 'C5 el pago sigue igual', estado = 'pendiente' and referencia_externa = 'TOKENR180SECRETO', estado from public.pagos where id = v_pago;

  -- ── D: lo que corre como dueño ──
  r := pg_temp.como(u1, format($q$select public.iniciar_pago_reserva(%L)::text$q$, v_res2));
  insert into r180 values ('D1 iniciar_pago_reserva sigue creando el pago', r like 'ok:%"ok" : true%', r);
  v_j := public.confirmar_pago('R180-A', 'TOKENR180SECRETO', '{"amount": 20000}'::jsonb);
  r := pg_temp.como(u1, format($q$select estado from public.pagos where id = %L$q$, v_pago));
  insert into r180 values ('D2 confirmar_pago sigue, y el dueño ve el estado nuevo', (v_j->>'ok')::boolean and r = 'ok:pagado', v_j::text || ' ' || r);

  -- ── E: service_role ──
  r := pg_temp.como(null, format($q$select (datos->>'amount') || '/' || referencia_externa from public.pagos where id = %L$q$, v_pago), 'service_role');
  insert into r180 values ('E1 service_role sigue leyendo datos y el token', r = 'ok:20000/TOKENR180SECRETO', r);
end $$;

select caso, ok, detalle from r180 order by caso;

do $$
declare v text;
begin
  select string_agg(caso || ' → ' || detalle, E'\n') into v from r180 where ok is not true;
  if v is not null then raise exception E'180: casos fallidos:\n%', v; end if;
end $$;

rollback;
