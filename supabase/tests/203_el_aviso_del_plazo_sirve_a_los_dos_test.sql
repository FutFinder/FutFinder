-- =============================================================
-- FutFinder — pruebas de la migración 203 (el aviso del plazo).
--
--   A1. Vencido el plazo, la cancha se suelta (sigue funcionando la 202).
--   A2. Los dos capitanes reciben el aviso de la cancelación.
--   A3. Ninguno de los dos avisos dice «rival»: le llega igual al que no
--       pagó, y no puede culpar al otro.
--
-- Sin la 203 falla en A3. Corre dentro de la transacción y termina en
-- ROLLBACK.
-- =============================================================

begin;

create temp table r203 (caso text, ok boolean, detalle text);
grant all on r203 to authenticated;

do $$
declare
  v_jefe uuid := gen_random_uuid();
  v_rival uuid := gen_random_uuid();
  v_local uuid; v_visita uuid; v_cancha uuid; v_cpl uuid := gen_random_uuid();
  v_match uuid; v_ch uuid; v_res json; v_rid uuid; v_fecha date; v_hora time; v_mitad int;
  mk text := left(replace(gen_random_uuid()::text, '-', ''), 8);
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r203-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_jefe, v_rival]) u;

  insert into public.clubs (nombre, slug, created_by)
  values ('Local 203 ' || mk, 'local-203-' || mk, v_jefe) returning id into v_local;
  insert into public.clubs (nombre, slug, created_by)
  values ('Visita 203 ' || mk, 'visita-203-' || mk, v_rival) returning id into v_visita;
  insert into public.club_members (club_id, user_id, rol) values (v_local, v_jefe, 'capitan')
  on conflict (club_id, user_id) do update set rol = 'capitan';
  insert into public.club_members (club_id, user_id, rol) values (v_visita, v_rival, 'capitan')
  on conflict (club_id, user_id) do update set rol = 'capitan';

  insert into public.complejos (id, nombre, comuna, latitud, longitud, publicado, aprobado_futfinder)
  values (v_cpl, 'Recinto arnés 203', 'Ñuñoa', -33.45, -70.60, true, true);
  insert into public.canchas_reservables (complejo_id, nombre, tipo, precio_hora, duracion_slot_min, activa)
  values (v_cpl, 'Cancha arnés 203', 'futbol_7', 20000, 60, true) returning id into v_cancha;
  insert into public.cancha_horario_reglas (cancha_id, dia_semana, hora_apertura, hora_cierre)
  select v_cancha, d, time '00:00', time '23:00' from generate_series(0, 6) as d;

  v_fecha := (now() at time zone 'America/Santiago')::date + 6;
  select (s->>'hora_inicio')::time into v_hora
    from json_array_elements(public.get_disponibilidad_cancha(v_cancha, v_fecha)->'slots') s
   where (s->>'disponible')::boolean limit 1;

  insert into public.club_challenges (club_retador_id, club_retado_id, creado_por, estado, modalidad)
  values (v_local, v_visita, v_jefe, 'publicado', 'futbol7') returning id into v_ch;
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, precio_cuota, estado, duracion_min, aprobacion,
      min_trust_score, club_local_id, club_visitante_id, challenge_id)
  values (v_jefe, 'prueba 203', 'Ñuñoa', 'Cancha', -33.45, -70.66,
      (v_fecha + v_hora)::timestamptz, 14, 14, 0, 'abierto', 60, 'inmediata', 0, v_local, v_visita, v_ch)
  returning id into v_match;
  update public.club_challenges set match_id = v_match where id = v_ch;

  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jefe, 'role', 'authenticated')::text);
  v_res := public.reservar_cancha_del_partido(v_match, v_cancha, v_fecha, v_hora, 'Prueba', '912345678');
  v_rid := (v_res->>'reserva_id')::uuid;
  select ceil(precio_total::numeric / 2)::int into v_mitad from public.reservas where id = v_rid;
  perform public.autorizar_cobro_reserva(v_rid, v_mitad);
  reset role;

  update public.reserva_participantes set autorizado_at = now() - interval '16 minutes'
   where reserva_id = v_rid and rol = 'organizador';
  perform public.soltar_reservas_de_desafio_vencidas();

  insert into r203 values ('A1 vencido el plazo se suelta',
    (select estado from public.reservas where id = v_rid) = 'cancelada',
    (select estado from public.reservas where id = v_rid));
  insert into r203 values ('A2 los dos capitanes reciben el aviso',
    (select count(distinct user_id) from public.notifications
      where type = 'reserva_cancelada' and user_id in (v_jefe, v_rival)) = 2,
    (select string_agg(user_id::text, ',') from public.notifications
      where type = 'reserva_cancelada' and user_id in (v_jefe, v_rival)));
  insert into r203 values ('A3 ningún aviso culpa al «rival»',
    not exists (select 1 from public.notifications
      where type = 'reserva_cancelada' and user_id in (v_jefe, v_rival) and body ilike '%rival%')
    and exists (select 1 from public.notifications
      where type = 'reserva_cancelada' and user_id = v_rival and body like '%dos mitades%'),
    (select string_agg(distinct body, ' | ') from public.notifications
      where type = 'reserva_cancelada' and user_id in (v_jefe, v_rival)));
end $$;

reset role;
set local request.jwt.claims to '{}';
select caso, case when ok then 'OK' else 'FALLA' end as res, left(detalle, 160) as detalle from r203 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r203;

rollback;
