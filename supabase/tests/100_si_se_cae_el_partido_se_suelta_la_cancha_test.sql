-- =============================================================
-- FutFinder — pruebas de la migración 100.
--
-- EL CASO QUE IMPORTA: los dos capitanes ya pusieron su mitad —la plata
-- SE MOVIÓ— y después se cancela el partido. Antes la reserva se quedaba
-- viva: cancha arrendada y pagada para un encuentro que no existe.
--
--   P1. Cancelar el partido cancela su cancha, sola.
--   P2. Se le devuelve a CADA capitán lo que puso.
--   P3. El saldo neto de la reserva queda en cero: nada quedó en la mano.
--   P4. Los dos reciben el aviso.
--   P5. Cancelar dos veces no devuelve dos veces.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r100 (caso text, ok boolean, detalle text);
grant all on r100 to authenticated;

do $$
declare
  v_jefe uuid := gen_random_uuid();
  v_rival uuid := gen_random_uuid();
  v_local uuid; v_visita uuid; v_cancha uuid;
  v_match uuid; v_res json; v_rid uuid; v_fecha date; v_hora time; v_mitad int;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r100-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_jefe, v_rival]) u;

  -- Saldo para que la reserva llegue a CONFIRMARSE: sin plata movida, no
  -- habría nada que devolver y la prueba no probaría nada.
  insert into public.balance_movimientos (user_id, tipo, monto, metodo_carga)
  select u, 'carga', 500000, 'transferencia' from unnest(array[v_jefe, v_rival]) u;

  -- SIEMBRA SUS DOS CLUBES (2026-10-16). Antes tomaba los dos más
  -- antiguos que hubiera en la base; contra una recién construida no hay
  -- ninguno y moría con «Club no encontrado». No estaba roto, no era
  -- autosuficiente.
  insert into public.clubs (nombre, slug, created_by)
  values ('Local 100 ' || left(v_jefe::text, 8), 'local-100-' || left(v_jefe::text, 8), v_jefe)
  returning id into v_local;
  insert into public.clubs (nombre, slug, created_by)
  values ('Visita 100 ' || left(v_rival::text, 8), 'visita-100-' || left(v_rival::text, 8), v_rival)
  returning id into v_visita;
  insert into public.club_members (club_id, user_id, rol) values (v_local, v_jefe, 'capitan');
  insert into public.club_members (club_id, user_id, rol) values (v_visita, v_rival, 'capitan');

  -- Y SU RECINTO, por lo mismo. Antes buscaba cualquier cancha publicada
  -- con horario; contra una base recién construida no hay ninguna,
  -- `v_cancha` quedaba nulo, la disponibilidad venía vacía y el partido
  -- moría en «null value in column hora». El horario cubre los siete días
  -- porque la fecha pedida —`hoy + 6`— cae en otro día de la semana según
  -- cuándo se corra.
  declare
    v_cpl100 uuid := gen_random_uuid();
  begin
    insert into public.complejos (id, nombre, comuna, latitud, longitud, publicado)
    values (v_cpl100, 'Recinto arnés 100', 'Ñuñoa', -33.45, -70.60, true);
    insert into public.canchas_reservables (complejo_id, nombre, tipo, precio_hora, duracion_slot_min, activa)
    values (v_cpl100, 'Cancha arnés 100', 'futbol_7', 20000, 60, true)
    returning id into v_cancha;
    insert into public.cancha_horario_reglas (cancha_id, dia_semana, hora_apertura, hora_cierre)
    select v_cancha, d, time '00:00', time '23:00' from generate_series(0, 6) as d;
  end;

  v_fecha := (now() at time zone 'America/Santiago')::date + 6;
  select (s->>'hora_inicio')::time into v_hora
    from json_array_elements(public.get_disponibilidad_cancha(v_cancha, v_fecha)->'slots') s
   where (s->>'disponible')::boolean limit 1;

  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, precio_cuota, estado, duracion_min, aprobacion,
      min_trust_score, club_local_id, club_visitante_id)
  values (v_jefe, 'prueba 100', 'Santiago', 'Cancha', -33.45, -70.66,
      (v_fecha + v_hora)::timestamptz, 14, 14, 0, 'abierto', 60, 'inmediata', 0, v_local, v_visita)
  returning id into v_match;

  set local role authenticated;
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_jefe, 'role', 'authenticated')::text);
  v_res := public.reservar_cancha_del_partido(v_match, v_cancha, v_fecha, v_hora, 'Prueba', '912345678');
  v_rid := (v_res->>'reserva_id')::uuid;

  -- `cuota` es null en 'capitanes': la mitad se calcula, igual que en el servidor.
  select ceil(precio_total::numeric / 2)::int into v_mitad from public.reservas where id = v_rid;

  perform public.autorizar_cobro_reserva(v_rid, v_mitad);
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_rival, 'role', 'authenticated')::text);
  perform public.autorizar_cobro_reserva(v_rid, v_mitad);

  reset role;
  set local request.jwt.claims to '{}';

  -- El montaje se comprueba ACÁ, ya sin RLS. Contar los cobros desde la
  -- sesión de un capitán devuelve 1 de 2 —`balance_movimientos` solo deja
  -- ver lo propio, que es su gracia— y parece un cobro perdido. Es la
  -- tercera vez que este proyecto tropieza con lo mismo: las cuentas de
  -- plata se hacen fuera de la sesión de quien paga.
  insert into r100 values ('montaje: confirmada y cobrada a los dos',
    (select estado from public.reservas where id = v_rid) = 'confirmada'
      and (select count(*) from public.balance_movimientos
            where reserva_id = v_rid and tipo = 'cobro_reserva') = 2,
    (select count(*) from public.balance_movimientos
      where reserva_id = v_rid and tipo = 'cobro_reserva')::text || ' cobros');

  -- ── Y AHORA SE CAE EL PARTIDO ──
  update public.matches set estado = 'cancelado' where id = v_match;

  insert into r100 values ('P1 la cancha se suelta sola',
    (select estado from public.reservas where id = v_rid) = 'cancelada',
    (select estado from public.reservas where id = v_rid));

  insert into r100 values ('P2 se devolvió a cada capitán lo suyo',
    (select count(*) from public.balance_movimientos
      where reserva_id = v_rid and tipo = 'devolucion_cancelacion' and monto = v_mitad) = 2,
    'dos devoluciones de ' || v_mitad);

  -- La prueba que de verdad cierra el caso: sumando TODO lo que esta
  -- reserva movió, no quedó un peso en la mano de nadie.
  insert into r100 values ('P3 el neto de la reserva queda en cero',
    (select coalesce(sum(monto), 0) from public.balance_movimientos where reserva_id = v_rid) = 0,
    (select coalesce(sum(monto), 0)::text from public.balance_movimientos where reserva_id = v_rid));

  insert into r100 values ('P4 los dos reciben el aviso',
    (select count(*) from public.notifications
      where type = 'reserva_cancelada' and data->>'reservaId' = v_rid::text) = 2, 'dos avisos');

  -- Volver a 'abierto' y recancelar: el trigger se dispara de nuevo, pero
  -- la reserva ya está muerta y no se devuelve dos veces.
  update public.matches set estado = 'abierto' where id = v_match;
  update public.matches set estado = 'cancelado' where id = v_match;
  insert into r100 values ('P5 no devuelve dos veces',
    (select count(*) from public.balance_movimientos
      where reserva_id = v_rid and tipo = 'devolucion_cancelacion') = 2, 'sigue en dos');
end $$;

reset role;
set local request.jwt.claims to '{}';
select caso, case when ok then 'OK' else 'FALLA' end as res, detalle from r100 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r100;

rollback;
