-- =============================================================
-- FutFinder — pruebas de la migración 176 (borrar la cuenta, de verdad).
--
-- u1 es la cuenta que se borra. Antes de borrarse fundó un club donde u2
-- juega, organizó un partido ya jugado y otro por jugar (u2 inscrito en los
-- dos), está inscrito en un partido de u2, organizó una reserva pasada que
-- pagó con tarjeta y otra por jugar donde u2 participa.
--
--   A1  La cuenta y el perfil desaparecen, y la cuenta queda en la cola de
--       archivos por borrar.
--   A2  El club que fundó SIGUE, sin autor, y u2 pasa a administrarlo (con
--       aviso).
--   A3  El partido ya jugado SIGUE, sin organizador, con la asistencia de u2.
--   A4  Su partido por jugar se cancela y u2 recibe el aviso con el motivo.
--   A5  Sale del partido de u2 devolviendo el cupo.
--   A6  La reserva pasada y su pago SIGUEN, anonimizados (registro contable).
--   A7  Su reserva por jugar se cancela y u2 recibe el aviso.
--   B1  Con saldo a favor no se borra: el mensaje lo dice y la cuenta sigue.
--   B2  Siendo la única admin de un recinto, tampoco.
--   B3  Con una reserva por jugar ya pagada, tampoco.
--   C1  Un partido huérfano no lo cancela cualquiera (`cancel_match`).
--   C2  Una reserva huérfana no la toca cualquiera (`quitar_participante_reserva`).
--   C3  Ninguna de las 21 funciones parchadas compara al organizador con `<>`.
--   D1  `cuentas_por_limpiar` no la lee ningún cliente.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r176 (caso text, ok boolean, detalle text);
grant all on r176 to authenticated, anon;

-- Ejecuta `p_sql` como `authenticated` con el `sub` dado. Devuelve 'ok:<texto>'
-- con lo que devolvió la primera columna, o 'err:<mensaje>'.
create or replace function pg_temp.como(p_uid uuid, p_sql text)
returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    execute p_sql into v;
    execute 'reset role';
    v := 'ok:' || coalesce(v, '');
  exception when others then
    execute 'reset role';
    v := 'err:' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  return v;
end $$;

do $$
declare
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  u3 uuid := gen_random_uuid();
  u4 uuid := gen_random_uuid();   -- con saldo
  u5 uuid := gen_random_uuid();   -- única admin de un recinto
  u6 uuid := gen_random_uuid();   -- reserva por jugar ya pagada
  v_club uuid; v_complejo uuid; v_cancha uuid;
  m_jugado uuid; m_futuro uuid; m_ajeno uuid; m_huerfano uuid;
  r_pasada uuid; r_futura uuid; r_pagada uuid;
  v_pago uuid;
  v_cupos_antes int;
  r text;
begin
  -- El teléfono obligatorio no es lo que se prueba acá.
  update public.feature_flags set activo = false where nombre = 'telefono_obligatorio';

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r176-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[u1, u2, u3, u4, u5, u6]) u;
  insert into public.profiles (id, username)
  select u, 'r176' || substr(replace(u::text, '-', ''), 1, 10) from unnest(array[u1, u2, u3, u4, u5, u6]) u
  on conflict (id) do nothing;

  -- Club fundado por u1, con u2 de jugador.
  insert into public.clubs (nombre, slug, created_by)
  values ('Club r176', 'club-r176-' || substr(u1::text, 1, 8), u1) returning id into v_club;
  insert into public.club_members (club_id, user_id, rol) values (v_club, u1, 'admin'), (v_club, u2, 'jugador');

  -- Partidos de u1: uno que "ya se jugó" y otro por jugar, u2 inscrito en ambos.
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud, hora, cupos_totales, cupos_disponibles)
  values (u1, 'Jugado r176', 'Ñuñoa', 'Cancha', -33.45, -70.6, now() + interval '2 days', 10, 9) returning id into m_jugado;
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud, hora, cupos_totales, cupos_disponibles)
  values (u1, 'Futuro r176', 'Ñuñoa', 'Cancha', -33.45, -70.6, now() + interval '3 days', 10, 9) returning id into m_futuro;
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud, hora, cupos_totales, cupos_disponibles)
  values (u1, 'Huerfano r176', 'Ñuñoa', 'Cancha', -33.45, -70.6, now() + interval '4 days', 10, 9) returning id into m_huerfano;
  insert into public.attendees (id_partido, id_jugador, estado)
  values (m_jugado, u2, 'inscrito'), (m_futuro, u2, 'inscrito'), (m_huerfano, u2, 'inscrito');
  update public.matches set hora = now() - interval '2 days', estado = 'finalizado' where id = m_jugado;
  update public.matches set hora = now() - interval '1 day' where id = m_huerfano;   -- pasado y sin cerrar

  -- Partido de u2 donde u1 está inscrito.
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud, hora, cupos_totales, cupos_disponibles)
  values (u2, 'Ajeno r176', 'Ñuñoa', 'Cancha', -33.45, -70.6, now() + interval '5 days', 10, 9) returning id into m_ajeno;
  insert into public.attendees (id_partido, id_jugador, estado) values (m_ajeno, u1, 'inscrito');
  update public.matches set cupos_disponibles = 8 where id = m_ajeno;
  select cupos_disponibles into v_cupos_antes from public.matches where id = m_ajeno;

  -- Reservas. La pasada se crea a futuro (el pago no se acepta para el
  -- pasado) y después se corre al pasado.
  select id into v_cancha from public.canchas_reservables limit 1;
  insert into public.reservas (cancha_id, organizador_id, fecha, hora_inicio, hora_fin, precio_total, modalidad, medio_pago, precio_cancha, estado)
  values (v_cancha, u1, current_date + 300, '05:17', '06:17', 30000, 'completa', 'tarjeta', 30000, 'confirmada') returning id into r_pasada;
  insert into public.pagos (user_id, reserva_id, monto, proveedor, orden_comercio, estado, pagado_at)
  values (u1, r_pasada, 30000, 'flow', 'r176-' || r_pasada, 'pagado', now()) returning id into v_pago;
  update public.reservas set fecha = current_date - 10 where id = r_pasada;

  insert into public.reservas (cancha_id, organizador_id, fecha, hora_inicio, hora_fin, precio_total, modalidad, medio_pago, precio_cancha, estado)
  values (v_cancha, u1, current_date + 301, '05:17', '06:17', 30000, 'capitanes', 'balance', 30000, 'armando') returning id into r_futura;
  insert into public.reserva_participantes (reserva_id, user_id, rol, estado) values (r_futura, u2, 'capitan', 'aceptado');

  -- ── A. Borrar u1 ──────────────────────────────────────────────
  r := pg_temp.como(u1, 'select public.delete_my_account()::text');
  insert into r176 values ('A0 delete_my_account de u1 no falla', r like 'ok:%', r);

  insert into r176 select 'A1 la cuenta y el perfil desaparecen',
    not exists (select 1 from auth.users where id = u1) and not exists (select 1 from public.profiles where id = u1), '';
  insert into r176 select 'A1 queda en la cola de archivos',
    exists (select 1 from public.cuentas_por_limpiar where user_id = u1 and archivos_limpios_at is null), '';

  insert into r176 select 'A2 el club sigue, sin autor',
    exists (select 1 from public.clubs where id = v_club and created_by is null), '';
  insert into r176 select 'A2 u2 lo administra y fue avisado',
    exists (select 1 from public.club_members where club_id = v_club and user_id = u2 and rol = 'admin')
    and exists (select 1 from public.notifications where user_id = u2 and title like 'Ahora administras%'), '';

  insert into r176 select 'A3 el partido jugado sigue, sin organizador, con u2',
    exists (select 1 from public.matches where id = m_jugado and id_organizador is null)
    and exists (select 1 from public.attendees where id_partido = m_jugado and id_jugador = u2), '';

  insert into r176 select 'A4 su partido por jugar se cancela y u2 se entera del motivo',
    exists (select 1 from public.matches where id = m_futuro and estado = 'cancelado')
    and exists (select 1 from public.notifications where user_id = u2 and type = 'match_cancelled'
                  and body like '%eliminó su cuenta%' and data->>'matchId' = m_futuro::text),
    (select estado from public.matches where id = m_futuro);

  insert into r176 select 'A5 sale del partido ajeno y devuelve el cupo',
    (select cupos_disponibles from public.matches where id = m_ajeno) = v_cupos_antes + 1
    and not exists (select 1 from public.attendees where id_partido = m_ajeno and id_jugador = u1),
    'antes=' || v_cupos_antes || ' despues=' || (select cupos_disponibles from public.matches where id = m_ajeno);

  insert into r176 select 'A6 la reserva pasada y su pago siguen, anonimizados',
    exists (select 1 from public.reservas where id = r_pasada and organizador_id is null)
    and exists (select 1 from public.pagos where id = v_pago and user_id is null and estado = 'pagado'), '';

  insert into r176 select 'A7 su reserva por jugar se cancela y u2 se entera',
    exists (select 1 from public.reservas where id = r_futura and estado = 'cancelada')
    and exists (select 1 from public.notifications where user_id = u2 and type = 'reserva_cancelada'
                  and data->>'reservaId' = r_futura::text),
    (select estado from public.reservas where id = r_futura);

  -- ── B. Lo que no deja borrar ──────────────────────────────────
  insert into public.balance_movimientos (user_id, tipo, monto, metodo_carga) values (u4, 'carga', 3000, 'transferencia');
  r := pg_temp.como(u4, 'select public.delete_my_account()::text');
  insert into r176 select 'B1 con saldo a favor no se borra, y lo dice',
    r like 'err:%$3.000 de saldo a favor%' and exists (select 1 from auth.users where id = u4), r;

  insert into public.complejos (nombre, comuna, latitud, longitud, created_by)
  values ('Recinto r176', 'Ñuñoa', -33.45, -70.6, u5) returning id into v_complejo;
  insert into public.complejo_admins (complejo_id, user_id, rol) values (v_complejo, u5, 'dueño');
  r := pg_temp.como(u5, 'select public.delete_my_account()::text');
  insert into r176 select 'B2 la única admin de un recinto no se borra, y lo dice',
    r like 'err:%Administras el recinto «Recinto r176»%' and exists (select 1 from auth.users where id = u5), r;

  insert into public.reservas (cancha_id, organizador_id, fecha, hora_inicio, hora_fin, precio_total, modalidad, medio_pago, precio_cancha, estado)
  values (v_cancha, u6, current_date + 302, '05:17', '06:17', 30000, 'completa', 'tarjeta', 30000, 'confirmada') returning id into r_pagada;
  insert into public.pagos (user_id, reserva_id, monto, proveedor, orden_comercio, estado, pagado_at)
  values (u6, r_pagada, 30000, 'flow', 'r176-' || r_pagada, 'pagado', now());
  r := pg_temp.como(u6, 'select public.delete_my_account()::text');
  insert into r176 select 'B3 con una reserva por jugar ya pagada no se borra',
    r like 'err:%reservas por jugar que ya pagaste%' and exists (select 1 from auth.users where id = u6), r;

  -- ── C. Un autor nulo no abre puertas ──────────────────────────
  r := pg_temp.como(u3, format('select public.cancel_match(%L)::text', m_huerfano));
  insert into r176 select 'C1 un tercero no cancela el partido huérfano',
    r like '%"ok": false%' and (select estado from public.matches where id = m_huerfano) <> 'cancelado', r;

  r := pg_temp.como(u3, format('select public.quitar_participante_reserva(%L, %L)::text', r_pasada, u2));
  insert into r176 select 'C2 un tercero no toca la reserva huérfana',
    r like '%Solo el organizador%', r;

  insert into r176
  select 'C3 ninguna función parchada compara al organizador con <>',
         count(*) = 0, coalesce(string_agg(p.proname, ', '), '')
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and pg_get_functiondef(p.oid) ~ '(\.(id_organizador|organizador_id)\M\s*<>|<>\s*[a-z_]+\.(id_organizador|organizador_id)\M)';

  -- ── D. La cola es sólo del servidor ───────────────────────────
  r := pg_temp.como(u2, 'select count(*)::text from public.cuentas_por_limpiar');
  insert into r176 select 'D1 un cliente no lee la cola', r like 'err:%permission denied%', r;
end $$;

select caso, ok, detalle from r176 order by caso;

rollback;
