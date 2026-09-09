-- =============================================================
-- FutFinder — pruebas de la migración 64 (precio por franja horaria).
--
-- El caso que motivó todo: MaiClub cobra $14.000 de 11:00 a 17:00 y
-- $28.000 de ahí al cierre. Los casos 2 a 4 son exactamente ese recinto.
--
-- QUÉ SE PRUEBA:
--   1.  Sin tarifas cargadas, el precio cae en `precio_hora` (compatible
--       con todo lo anterior a esta migración).
--   2.  El bloque de las 11:00 cuesta $14.000.
--   3.  El de las 16:00 todavía cuesta $14.000 (último de la franja).
--   4.  El de las 17:00 ya cuesta $28.000 — el rango es semiabierto.
--   5.  Una tarifa de un día específico gana sobre la de todos los días.
--   6.  Dos tarifas del MISMO día que se cruzan se rechazan.
--   7.  Una de sábado SÍ puede cruzarse con una de todos los días: es
--       cómo se sobrescribe un día.
--   8.  `crear_reserva` guarda el precio de la franja, no `precio_hora`.
--   9.  La comisión sale de ese precio: $14.000 toca el PISO de $1.000
--       (7,1%), no el 5%.
--   10. `get_disponibilidad_cancha` devuelve el precio de cada bloque.
--   11. El calendario del recinto muestra el MISMO precio que el jugador.
--   12. Un ajeno no puede cargar tarifas; `anon` tampoco.
--
-- Requiere las migraciones 54 a 64 aplicadas.
-- Cómo correr: pégalo en Supabase → SQL Editor → Run. Termina en ROLLBACK.
-- =============================================================

begin;

do $$
declare
  v_dueno    uuid := gen_random_uuid();
  v_ajeno    uuid := gen_random_uuid();
  v_complejo uuid := gen_random_uuid();
  v_cancha   uuid := gen_random_uuid();
  -- Se derivan en vez de hardcodearse: `date_trunc('week')` cae en lunes,
  -- así que +5 es sábado. Hardcodear un día de la semana es la clase de
  -- supuesto que hace fallar un arnés por el motivo equivocado.
  v_lunes    date := date_trunc('week', date '2027-03-08')::date;
  v_sabado   date := date_trunc('week', date '2027-03-08')::date + 5;
  v_res      uuid;
  v_j        json;
  v_n        integer;
  v_rechazado boolean;
begin
  -- Se comprueba el supuesto antes de usarlo.
  if extract(dow from v_sabado) <> 6 or extract(dow from v_lunes) <> 1 then
    raise exception 'MONTAJE MAL: v_sabado dow=% y v_lunes dow=%',
      extract(dow from v_sabado), extract(dow from v_lunes);
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r64-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_dueno, v_ajeno]) as u;

  insert into public.complejos (id, nombre, comuna, latitud, longitud, publicado)
  values (v_complejo, 'Tarifas 64', 'Maipú', -33.53, -70.76, true);
  insert into public.canchas_reservables (id, complejo_id, nombre, tipo, precio_hora, duracion_slot_min, activa)
  values (v_cancha, v_complejo, 'Cancha 1', 'futbol_7', 20000, 60, true);
  insert into public.cancha_horario_reglas (cancha_id, dia_semana, hora_apertura, hora_cierre)
  select v_cancha, d, time '11:00', time '22:00' from generate_series(0, 6) as d;
  insert into public.complejo_admins (complejo_id, user_id, rol) values (v_complejo, v_dueno, 'dueño');

  -- ── Caso 1: sin tarifas, cae en precio_hora ────────────────────
  if public.precio_de_bloque(v_cancha, v_lunes, time '12:00') <> 20000 then
    raise exception 'FALLÓ (caso 1): sin tarifas debería costar precio_hora, cuesta %',
      public.precio_de_bloque(v_cancha, v_lunes, time '12:00');
  end if;
  raise notice 'OK (caso 1): compatible con las canchas de precio único';

  -- ── Las dos franjas de MaiClub ─────────────────────────────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_dueno, 'role', 'authenticated')::text);
  perform public.admin_upsert_tarifa(v_cancha, time '11:00', time '17:00', 14000);
  perform public.admin_upsert_tarifa(v_cancha, time '17:00', time '22:00', 28000);

  -- ── Casos 2-4: el borde de las 17:00 ───────────────────────────
  if public.precio_de_bloque(v_cancha, v_lunes, time '11:00') <> 14000 then
    raise exception 'FALLÓ (caso 2): 11:00 → %', public.precio_de_bloque(v_cancha, v_lunes, time '11:00');
  end if;
  if public.precio_de_bloque(v_cancha, v_lunes, time '16:00') <> 14000 then
    raise exception 'FALLÓ (caso 3): 16:00 debería ser el último barato, cuesta %',
      public.precio_de_bloque(v_cancha, v_lunes, time '16:00');
  end if;
  if public.precio_de_bloque(v_cancha, v_lunes, time '17:00') <> 28000 then
    raise exception 'FALLÓ (caso 4): 17:00 ya es franja de noche, cuesta %',
      public.precio_de_bloque(v_cancha, v_lunes, time '17:00');
  end if;
  raise notice 'OK (casos 2-4): 11:00 y 16:00 a 14.000; 17:00 a 28.000';

  -- ── Caso 5: el sábado gana sobre todos los días ────────────────
  perform public.admin_upsert_tarifa(v_cancha, time '11:00', time '22:00', 28000, 6);
  if public.precio_de_bloque(v_cancha, v_sabado, time '12:00') <> 28000 then
    raise exception 'FALLÓ (caso 5): el sábado al mediodía debería costar 28.000, cuesta %',
      public.precio_de_bloque(v_cancha, v_sabado, time '12:00');
  end if;
  if public.precio_de_bloque(v_cancha, v_lunes, time '12:00') <> 14000 then
    raise exception 'FALLÓ (caso 5): el lunes NO debería cambiar, cuesta %',
      public.precio_de_bloque(v_cancha, v_lunes, time '12:00');
  end if;
  raise notice 'OK (casos 5 y 7): el sábado se sobrescribe sin tocar el resto de la semana';

  -- ── Caso 6: cruces del mismo día se rechazan ───────────────────
  begin
    perform public.admin_upsert_tarifa(v_cancha, time '16:00', time '18:00', 20000);
    v_rechazado := false;
  exception when others then v_rechazado := true; end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 6): 16:00-18:00 se cruza con las dos franjas ya cargadas';
  end if;
  -- Pegada sin cruzarse sí vale: 22:00-23:00 arranca donde termina la otra.
  perform public.admin_upsert_tarifa(v_cancha, time '22:00', time '23:00', 30000);
  raise notice 'OK (caso 6): cruces rechazados, contiguas aceptadas';

  -- ── Casos 8-9: la reserva y su comisión ────────────────────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);
  v_j := public.crear_reserva(v_cancha, v_lunes, time '12:00', 'completa', 'tarjeta');
  if (v_j->>'ok')::boolean is not true then
    raise exception 'FALLÓ (caso 8): no se creó la reserva: %', v_j::text;
  end if;
  v_res := (v_j->>'reserva_id')::uuid;

  select precio_total into v_n from public.reservas where id = v_res;
  if v_n <> 14000 then
    raise exception 'FALLÓ (caso 8): debería guardar el precio de la franja (14.000), guardó %', v_n;
  end if;
  raise notice 'OK (caso 8): la reserva del mediodía quedó en 14.000, no en precio_hora';

  if not exists (select 1 from public.reserva_comisiones
                  where reserva_id = v_res and base = 14000 and monto = 1000) then
    raise exception 'FALLÓ (caso 9): sobre 14.000 la comisión toca el piso de 1.000, quedó %',
      (select row_to_json(rc)::text from public.reserva_comisiones rc where rc.reserva_id = v_res);
  end if;
  raise notice 'OK (caso 9): 14.000 paga el piso de 1.000 — 7,1%%, no 5%%';

  -- ── Casos 10-11: el mismo precio para los dos lados ────────────
  v_j := public.get_disponibilidad_cancha(v_cancha, v_lunes);
  select (s->>'precio')::int into v_n
    from json_array_elements(v_j->'slots') s where s->>'hora_inicio' = '12:00';
  if v_n <> 14000 then
    raise exception 'FALLÓ (caso 10): el jugador vería % a las 12:00', v_n;
  end if;
  select (s->>'precio')::int into v_n
    from json_array_elements(v_j->'slots') s where s->>'hora_inicio' = '18:00';
  if v_n <> 28000 then
    raise exception 'FALLÓ (caso 10): a las 18:00 vería %', v_n;
  end if;

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_dueno, 'role', 'authenticated')::text);
  v_j := public.admin_calendario_cancha(v_cancha, v_lunes);
  select (s->>'precio')::int into v_n
    from json_array_elements(v_j->'slots') s where s->>'hora_inicio' = '12:00';
  if v_n <> 14000 then
    raise exception 'FALLÓ (caso 11): el recinto ve % y el jugador 14.000 — no pueden diferir', v_n;
  end if;
  raise notice 'OK (casos 10-11): jugador y recinto ven el mismo precio';

  -- ── Caso 12: privilegios ───────────────────────────────────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);
  begin
    perform public.admin_upsert_tarifa(v_cancha, time '09:00', time '10:00', 5000);
    v_rechazado := false;
  exception when others then v_rechazado := true; end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 12): un ajeno no debería poder cargar tarifas';
  end if;

  execute format('set local role anon');
  begin
    perform public.admin_upsert_tarifa(v_cancha, time '09:00', time '10:00', 5000);
    v_rechazado := false;
  exception when insufficient_privilege then v_rechazado := true; end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 12): anon no debería ejecutar admin_upsert_tarifa';
  end if;
  -- `precio_de_bloque` SÍ es para anon: el precio se muestra sin sesión.
  if public.precio_de_bloque(v_cancha, v_lunes, time '12:00') <> 14000 then
    raise exception 'FALLÓ (caso 12): anon debería poder ver el precio';
  end if;
  execute 'reset role';
  raise notice 'OK (caso 12)';

  raise notice '=== TODOS LOS CASOS DE LA MIGRACIÓN 64 PASARON ===';
end $$;

rollback;
