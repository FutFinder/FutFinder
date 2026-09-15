-- =============================================================
-- FutFinder — pruebas de la migración 99 (el puente Clubes → Reservas).
--
-- QUÉ SE PRUEBA:
--   P1. Solo quien dirige el club LOCAL reserva la cancha del desafío.
--   P2. La pantalla sabe qué ofrecer ANTES de reservar, y a quién le toca
--       la otra mitad.
--   P3. El capitán del club local reserva.
--   P4. Queda de capitanes, con Balance y los dos clubes anotados.
--   P5. El capitán rival queda invitado en la misma operación — sin él, la
--       reserva no se podría confirmar nunca.
--   P6. El partido queda enlazado a la reserva.
--   P7. No se reserva dos veces el mismo partido.
--   P8. Y la pantalla deja de ofrecerlo.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK. Monta sus
-- propios clubes, miembros y partido: en el proyecto real no había ningún
-- partido de clubes cuando se escribió.
--
-- OJO CON LOS TOPES DEL PLAN: `check_club_limits` corta en 1 administrador
-- por club, así que el montaje suma gente como `capitan` — que además es la
-- otra rama del permiso y conviene probarla.
-- =============================================================

begin;

create temp table r99 (caso text, ok boolean, detalle text);
grant all on r99 to authenticated;

do $$
declare
  v_local uuid; v_visita uuid;
  v_jefe uuid := gen_random_uuid();
  v_rival uuid := gen_random_uuid();
  v_ajeno uuid := gen_random_uuid();
  v_cancha uuid; v_match uuid; v_res json; v_det json; v_rid uuid;
  v_fecha date; v_hora time;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r99-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_jefe, v_rival, v_ajeno]) u;

  select id into v_local from public.clubs order by created_at limit 1;
  select id into v_visita from public.clubs where id <> v_local order by created_at limit 1;
  insert into public.club_members (club_id, user_id, rol) values (v_local, v_jefe, 'capitan');
  insert into public.club_members (club_id, user_id, rol) values (v_visita, v_rival, 'capitan');

  select k.id into v_cancha
    from public.canchas_reservables k join public.complejos c on c.id = k.complejo_id
   where c.publicado and k.activa
     and exists (select 1 from public.cancha_horario_reglas hr where hr.cancha_id = k.id)
   limit 1;

  v_fecha := (now() at time zone 'America/Santiago')::date + 4;
  select (s->>'hora_inicio')::time into v_hora
    from json_array_elements(public.get_disponibilidad_cancha(v_cancha, v_fecha)->'slots') s
   where (s->>'disponible')::boolean limit 1;

  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, precio_cuota, estado, duracion_min, aprobacion,
      min_trust_score, club_local_id, club_visitante_id)
  values (v_jefe, 'prueba 99', 'Santiago', 'Cancha', -33.45, -70.66,
      (v_fecha + v_hora)::timestamptz, 14, 14, 0, 'abierto', 60, 'inmediata', 0, v_local, v_visita)
  returning id into v_match;

  set local role authenticated;

  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);
  v_res := public.reservar_cancha_del_partido(v_match, v_cancha, v_fecha, v_hora, 'Prueba', '912345678');
  insert into r99 values ('P1 solo el club local reserva',
    not (v_res->>'ok')::boolean
      and v_res->>'reason' = 'Solo un admin o capitán del club local puede reservar la cancha',
    v_res->>'reason');

  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_jefe, 'role', 'authenticated')::text);
  v_det := public.cancha_del_partido(v_match);
  insert into r99 values ('P2 la pantalla sabe qué ofrecer',
    (v_det->>'aplica')::boolean and (v_det->>'puedo_reservar')::boolean
      and v_det->>'reserva_id' is null
      and (v_det->>'capitan_rival')::uuid = v_rival,
    'capitán rival identificado');

  v_res := public.reservar_cancha_del_partido(v_match, v_cancha, v_fecha, v_hora, 'Prueba', '912345678');
  v_rid := (v_res->>'reserva_id')::uuid;
  insert into r99 values ('P3 el capitán local reserva',
    (v_res->>'ok')::boolean, coalesce(v_res->>'reason', 'creada'));

  insert into r99 values ('P4 capitanes, balance y los dos clubes',
    (select modalidad = 'capitanes' and medio_pago = 'balance' and es_desafio_club
            and club_organizador_id = v_local and club_rival_id = v_visita
       from public.reservas where id = v_rid),
    (select modalidad || ' · ' || medio_pago from public.reservas where id = v_rid));

  -- Sin el segundo capitán la reserva no se confirmaría NUNCA, así que
  -- invitar va en la misma operación y no en una llamada aparte.
  insert into r99 values ('P5 el capitán rival queda invitado',
    (select count(*) = 1 from public.reserva_participantes
      where reserva_id = v_rid and user_id = v_rival and rol = 'capitan'),
    'rol capitan');

  insert into r99 values ('P6 el partido queda enlazado',
    (select reserva_id = v_rid from public.matches where id = v_match), 'matches.reserva_id');

  v_res := public.reservar_cancha_del_partido(v_match, v_cancha, v_fecha, v_hora, 'Prueba', '912345678');
  insert into r99 values ('P7 no se reserva dos veces',
    not (v_res->>'ok')::boolean and v_res->>'reason' = 'Este partido ya tiene una cancha reservada',
    v_res->>'reason');

  v_det := public.cancha_del_partido(v_match);
  insert into r99 values ('P8 la pantalla deja de ofrecerlo',
    not (v_det->>'puedo_reservar')::boolean
      and (v_det->>'reserva_id')::uuid = v_rid
      and v_det->>'reserva_estado' = 'armando',
    'estado ' || (v_det->>'reserva_estado'));
end $$;

reset role;
set local request.jwt.claims to '{}';
select caso, case when ok then 'OK' else 'FALLA' end as res, detalle from r99 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r99;

rollback;
