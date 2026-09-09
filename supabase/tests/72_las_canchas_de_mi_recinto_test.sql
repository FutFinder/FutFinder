-- =============================================================
-- FutFinder — pruebas de la migración 72 (las canchas de mi recinto).
--
-- QUÉ SE PRUEBA:
--   El agujero que la motiva
--   1.  Un `select` directo sobre `canchas_reservables`, hecho por el DUEÑO de
--       un recinto NO publicado, devuelve CERO filas. Es la policy de la
--       migración 65 y está bien que sea así; esta prueba existe para que si
--       alguna vez alguien afloja esa policy, se entere acá y no en el
--       buscador del jugador.
--   2.  La RPC, con el mismo usuario y el mismo recinto, sí las devuelve.
--
--   Lo que trae de más
--   3.  `tiene_horario` y `dias_con_horario` reflejan las reglas cargadas.
--   4.  `tiene_tarifas` distingue una cancha con precio único de una con
--       franjas.
--
--   Orden y alcance
--   5.  Las inactivas van al final.
--   6.  No trae canchas de otro complejo.
--
--   Privilegios
--   7.  Un ajeno recibe la excepción de siempre, y `anon` no la ejecuta.
--
-- Requiere las migraciones 54 a 72 aplicadas.
-- Cómo correr: pégalo en Supabase → SQL Editor → Run. Termina en ROLLBACK.
-- =============================================================

begin;

-- Las temporales se crean como el rol del editor; los casos que corren como
-- `authenticated` necesitan poder escribir en ella.
create temp table r72 (caso text, ok boolean, detalle text);
grant all on r72 to authenticated;

do $$
declare
  v_dueno    uuid := gen_random_uuid();
  v_ajeno    uuid := gen_random_uuid();
  v_complejo uuid := gen_random_uuid();
  v_otro_cpl uuid := gen_random_uuid();
  v_k1       uuid := gen_random_uuid();
  v_k2       uuid := gen_random_uuid();
  v_k3       uuid := gen_random_uuid();
  v_ajena    uuid := gen_random_uuid();
  v_n        integer;
  v_fila     record;
  v_ultima   text;
  v_rechazado boolean;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r72-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_dueno, v_ajeno]) as u;

  -- NO publicado a propósito: es el estado en que se carga un recinto nuevo,
  -- y es justo donde el agujero se notaba.
  insert into public.complejos (id, nombre, comuna, latitud, longitud, publicado) values
    (v_complejo, 'Canchas 72', 'Maipú', -33.53, -70.76, false),
    (v_otro_cpl, 'Ajeno 72', 'Ñuñoa', -33.45, -70.60, false);

  insert into public.canchas_reservables (id, complejo_id, nombre, tipo, precio_hora, duracion_slot_min, activa) values
    (v_k1,    v_complejo, 'Cancha 1', 'futbol_7',  28000, 60, true),
    (v_k2,    v_complejo, 'Cancha 2', 'futbol_7',  28000, 60, true),
    (v_k3,    v_complejo, 'Cancha 3', 'futbol_11', 45000, 60, false),
    (v_ajena, v_otro_cpl, 'Cancha X', 'futbol_7',  28000, 60, true);

  insert into public.complejo_admins (complejo_id, user_id, rol) values (v_complejo, v_dueno, 'dueño');

  -- Cancha 1: horario los siete días y una tarifa. Cancha 2: tres días y sin
  -- tarifas. Cancha 3: nada.
  insert into public.cancha_horario_reglas (cancha_id, dia_semana, hora_apertura, hora_cierre)
  select v_k1, d, time '11:00', time '22:00' from generate_series(0, 6) as d;
  insert into public.cancha_horario_reglas (cancha_id, dia_semana, hora_apertura, hora_cierre)
  select v_k2, d, time '15:00', time '23:00' from generate_series(1, 3) as d;
  insert into public.cancha_tarifas (cancha_id, hora_desde, hora_hasta, precio)
  values (v_k1, time '11:00', time '16:00', 14000);

  -- ── Caso 1: el agujero ─────────────────────────────────────────
  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_dueno, 'role', 'authenticated')::text);
  select count(*) into v_n from public.canchas_reservables where complejo_id = v_complejo;
  insert into r72 values ('1', v_n = 0, 'select directo del dueño sobre un recinto no publicado: ' || v_n || ' filas');

  -- ── Caso 2: la RPC sí ──────────────────────────────────────────
  select count(*) into v_n from public.admin_canchas_complejo(v_complejo);
  insert into r72 values ('2', v_n = 3, 'la RPC devolvió ' || v_n || ' canchas');

  -- ── Casos 3 y 4: horario y tarifas ─────────────────────────────
  select * into v_fila from public.admin_canchas_complejo(v_complejo) where id = v_k1;
  insert into r72 values ('3a', v_fila.tiene_horario and v_fila.dias_con_horario = 7,
    'Cancha 1: horario=' || v_fila.tiene_horario || ' días=' || v_fila.dias_con_horario);
  insert into r72 values ('4a', v_fila.tiene_tarifas, 'Cancha 1 tiene tarifas');

  select * into v_fila from public.admin_canchas_complejo(v_complejo) where id = v_k2;
  insert into r72 values ('3b', v_fila.tiene_horario and v_fila.dias_con_horario = 3,
    'Cancha 2: días=' || v_fila.dias_con_horario);
  insert into r72 values ('4b', not v_fila.tiene_tarifas, 'Cancha 2 sin tarifas: precio único');

  select * into v_fila from public.admin_canchas_complejo(v_complejo) where id = v_k3;
  insert into r72 values ('3c', not v_fila.tiene_horario and v_fila.dias_con_horario = 0,
    'Cancha 3 sin horario cargado');

  -- ── Caso 5: las inactivas al final ─────────────────────────────
  select nombre into v_ultima
    from (select nombre, row_number() over () as ord from public.admin_canchas_complejo(v_complejo)) t
   where t.ord = 3;
  insert into r72 values ('5', v_ultima = 'Cancha 3', 'la última de la lista es ' || v_ultima);

  -- ── Caso 6: no se cuela la de otro complejo ────────────────────
  select count(*) into v_n from public.admin_canchas_complejo(v_complejo) where id = v_ajena;
  insert into r72 values ('6', v_n = 0, 'canchas de otro complejo: ' || v_n);

  -- ── Caso 7: privilegios ────────────────────────────────────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);
  begin
    perform * from public.admin_canchas_complejo(v_complejo);
    v_rechazado := false;
  exception when others then v_rechazado := true; end;
  insert into r72 values ('7a', v_rechazado, 'un ajeno queda afuera');

  reset role;
  set local role anon;
  begin
    perform * from public.admin_canchas_complejo(v_complejo);
    v_rechazado := false;
  exception when insufficient_privilege then v_rechazado := true; end;
  reset role;
  insert into r72 values ('7b', v_rechazado, 'anon no la ejecuta');
end $$;

do $$
declare
  v_malos integer;
  v_f record;
begin
  for v_f in select * from r72 order by caso loop
    if v_f.ok then
      raise notice 'OK (caso %): %', v_f.caso, v_f.detalle;
    else
      raise warning 'FALLÓ (caso %): %', v_f.caso, v_f.detalle;
    end if;
  end loop;
  select count(*) into v_malos from r72 where not ok;
  if v_malos > 0 then
    raise exception '% caso(s) de la migración 72 fallaron', v_malos;
  end if;
  raise notice '=== TODOS LOS CASOS DE LA MIGRACIÓN 72 PASARON ===';
end $$;

rollback;
