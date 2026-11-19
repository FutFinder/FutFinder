-- =============================================================
-- FutFinder — pruebas de la migración 192 (exportar mis datos).
--
--   A1 Trae lo propio: teléfono, reserva, pago, calificación dada, reporte,
--      ticket y un mensaje escrito.
--   A2 No trae nada de otra persona: ni su teléfono, ni su pago, ni su
--      mensaje, ni la calificación que ella dio.
--   A3 Sin cuenta no se puede.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r192 (caso text, ok boolean, detalle text);
grant all on r192 to authenticated, anon;

create or replace function pg_temp.como(p_rol text, p_uid uuid, p_sql text)
returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims',
    json_strip_nulls(json_build_object('sub', p_uid, 'role', p_rol, 'aal', 'aal1'))::text, true);
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
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid();
  v_cancha uuid; v_res uuid; v_partido uuid; r text; j jsonb;
begin
  update public.feature_flags set activo = false where nombre = 'telefono_obligatorio';
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'r192-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[u1, u2]) u;
  insert into public.profiles (id, username) select u, 'r192' || substr(replace(u::text, '-', ''), 1, 10)
    from unnest(array[u1, u2]) u on conflict (id) do nothing;

  insert into public.perfil_telefonos (user_id, telefono) values (u1, '+56911111111'), (u2, '+56922222222');
  select id into v_cancha from public.canchas_reservables limit 1;
  insert into public.reservas (cancha_id, organizador_id, fecha, hora_inicio, hora_fin, precio_total, modalidad, medio_pago, precio_cancha, estado)
  values (v_cancha, u1, current_date + 250, '05:19', '06:19', 20000, 'completa', 'tarjeta', 20000, 'armando') returning id into v_res;
  insert into public.pagos (user_id, reserva_id, monto, proveedor, orden_comercio) values (u1, v_res, 20000, 'flow', 'R192-U1'), (u2, v_res, 1000, 'flow', 'R192-U2');
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud, hora, cupos_totales, cupos_disponibles)
  values (u1, 'r192', 'Ñuñoa', 'Cancha', -33.45, -70.6, now() + interval '3 days', 10, 9) returning id into v_partido;
  insert into public.ratings (match_id, rater_id, rated_id, puntualidad, fairplay, nivel) values (v_partido, u1, u2, 5, 5, 4), (v_partido, u2, u1, 1, 1, 1);
  insert into public.user_reports (reporter_id, reported_id, motivo, elemento) values (u1, u2, 'spam', 'partido:' || v_partido);
  insert into public.support_tickets (user_id, category, title) values (u1, 'fallo_tecnico', 'r192 ticket');
  insert into public.messages (sender_id, match_id, content) values (u1, v_partido, 'r192 mío'), (u2, v_partido, 'r192 ajeno');

  r := pg_temp.como('authenticated', u1, 'select public.exportar_mis_datos()::text');
  j := case when r like 'ok:%' then substr(r, 4)::jsonb else null end;

  insert into r192 values ('A1 trae lo propio',
    j is not null
      and j->'telefono'->>'telefono' = '+56911111111'
      and jsonb_array_length(j->'reservas') = 1 and j->'reservas'->0->>'rol' = 'organizador'
      and exists (select 1 from jsonb_array_elements(j->'pagos') e where e->>'orden_comercio' = 'R192-U1')
      and exists (select 1 from jsonb_array_elements(j->'calificaciones_que_diste') e where (e->>'nivel')::int = 4)
      and jsonb_array_length(j->'reportes_que_hiciste') = 1
      and exists (select 1 from jsonb_array_elements(j->'tickets_de_soporte') e where e->>'titulo' = 'r192 ticket')
      and exists (select 1 from jsonb_array_elements(j->'mensajes_que_escribiste') e where e->>'texto' = 'r192 mío' and e->>'conversacion' = 'partido'),
    left(coalesce(j::text, r), 400));

  insert into r192 values ('A2 no trae nada de otra persona',
    j is not null
      and position('+56922222222' in j::text) = 0
      and position('R192-U2' in j::text) = 0
      and position('r192 ajeno' in j::text) = 0
      and not exists (select 1 from jsonb_array_elements(j->'calificaciones_que_diste') e where (e->>'nivel')::int = 1),
    '');

  r := pg_temp.como('anon', null, 'select public.exportar_mis_datos()::text');
  insert into r192 values ('A3 sin cuenta no se puede', r like 'err:42501%', r);
end $$;

select caso, ok, detalle from r192 order by caso;

rollback;
