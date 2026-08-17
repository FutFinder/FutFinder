-- =============================================================
-- FutFinder — pruebas del resultado del encuentro y el historial
-- real (migraciones 48 y 48b).
--
-- QUÉ SE PRUEBA:
--
--   · PROPONE UN ADMINISTRADOR DE CUALQUIERA DE LOS DOS CLUBES, NUNCA
--     UN AJENO (caso 1) NI QUIEN ADMINISTRA LOS DOS (caso 2).
--   · EL MARCADOR SE VALIDA (caso 3) Y LA ASISTENCIA SE MARCA SOBRE
--     `attendees` EN LA MISMA LLAMADA (caso 4).
--   · UN SOLO RESULTADO ACTIVO POR DESAFÍO: una segunda propuesta
--     mientras la primera sigue `propuesto` se rechaza (caso 5).
--   · CONFIRMA EL CLUB CONTRARIO, NUNCA EL PROPONENTE (caso 6), UN AJENO
--     (caso 7) NI QUIEN TAMBIÉN PERTENECE AL CLUB PROPONENTE AUNQUE
--     ADMINISTRE EL CONTRARIO (caso 8, la regla estricta de la 43d).
--   · RECHAZAR NO TOCA ESTADÍSTICAS: el desafío queda en
--     `resultado_en_disputa` y el partido no se toca (caso 9).
--   · UN RESULTADO YA RECHAZADO NO SE CONFIRMA (caso 10).
--   · SÓLO LA MODERACIÓN REABRE UNA DISPUTA (48b): con el desafío en
--     `resultado_en_disputa`, ni el club proponente ni el contrario pueden
--     proponer un resultado nuevo por su cuenta (caso 11).
--   · NADIE ESCRIBE A MANO `club_match_results` (caso 12) Y SÓLO LOS
--     INTEGRANTES DE LOS DOS CLUBES LA LEEN (caso 13).
--   · UN SEGUNDO ENCUENTRO, SIN DISPUTA: proponer y confirmar cierra el
--     desafío y publica el partido (casos 15-16), confirmar de nuevo es
--     idempotente (caso 17), y SÓLO ENTONCES `club_record()` (caso 18) E
--     `historial_publico_club()` (caso 19) MUESTRAN EL MARCADOR REAL — sin
--     que el 3-1 rechazado del primer encuentro cuente para nada.
--   · UN DESAFÍO YA `finalizado` NO ADMITE UNA PROPUESTA NUEVA (caso 20).
--
-- NOTA SOBRE LOS DATOS: este arnés crea sus propios clubes, usuarios y
-- partidos dentro de la transacción y los deshace con el `rollback`. Hacen
-- falta DOS encuentros entre los mismos clubes: el primero termina en
-- disputa (no se puede reabrir) y el segundo sí llega a confirmarse, que es
-- el único camino para probar `club_record()` y el historial con un
-- confirmado real en la mesa junto a un rechazado que no debe contar.
--
-- Requiere las migraciones 41 a 48b aplicadas, o la 48 y la 48b corridas
-- dentro de la misma transacción que este arnés.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor.
-- Todo corre en una transacción que termina en ROLLBACK.
-- =============================================================

begin;

create temp table t48 (n integer, caso text, detalle text) on commit drop;

do $$
declare
  v_adminA  uuid := gen_random_uuid(); -- club A: local/retador, propone primero
  v_adminB  uuid := gen_random_uuid(); -- club B: visitante/retado, confirma
  v_ambos   uuid := gen_random_uuid(); -- administra A y B
  v_ajeno   uuid := gen_random_uuid(); -- no pertenece a ninguno
  v_j1      uuid := gen_random_uuid(); -- jugador de A, va a asistir
  v_j2      uuid := gen_random_uuid(); -- jugador de A, no asiste
  v_j3      uuid := gen_random_uuid(); -- jugador de B, va a asistir
  v_j4      uuid := gen_random_uuid(); -- jugador de B, no asiste

  v_cA      uuid := gen_random_uuid();
  v_cB      uuid := gen_random_uuid();

  -- Encuentro 1: termina en disputa y ahí se queda.
  v_ch1     uuid := gen_random_uuid();
  v_pr1     uuid := gen_random_uuid();
  v_m1      uuid := gen_random_uuid();

  -- Encuentro 2: mismo par de clubes, sin disputa, llega a confirmarse.
  v_ch2     uuid := gen_random_uuid();
  v_pr2     uuid := gen_random_uuid();
  v_m2      uuid := gen_random_uuid();

  v_j       json;
  v_count   int;
  v_err     text;
  v_res1    uuid;
  v_res2    uuid;
  v_estado  text;
  v_v       int;
  v_e       int;
  v_d       int;
  v_gl      int;
  v_gv      int;
  v_result  text;
begin
  -- ── gente ─────────────────────────────────────────────────────
  insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,email_change,
    email_change_token_new,recovery_token)
  select '00000000-0000-0000-0000-000000000000',u,'authenticated','authenticated',
    'u48-'||u||'@futfinder.test','x',now(),now(),now(),'{}','{}','','','',''
  from unnest(array[v_adminA, v_adminB, v_ambos, v_ajeno, v_j1, v_j2, v_j3, v_j4]) u;

  -- ── clubes ────────────────────────────────────────────────────
  -- `premium` porque el plan estándar admite un solo administrador y los
  -- clubes A y B necesitan dos (el suyo y el que administra los dos).
  insert into public.clubs (id, nombre, slug, plan, created_by)
  values (v_cA, 'Club A 48', 'club-a-48-'||left(v_cA::text,8), 'premium', v_adminA),
         (v_cB, 'Club B 48', 'club-b-48-'||left(v_cB::text,8), 'premium', v_adminB);

  insert into public.club_members (club_id, user_id, rol)
  values (v_cA, v_adminA, 'admin'), (v_cB, v_adminB, 'admin'),
         (v_cA, v_ambos, 'admin'),  (v_cB, v_ambos, 'admin'),
         (v_cA, v_j1, 'jugador'),   (v_cA, v_j2, 'jugador'),
         (v_cB, v_j3, 'jugador'),   (v_cB, v_j4, 'jugador');

  -- ── encuentro 1: ya publicado y jugado, esperando resultado ─────
  -- Se salta directo a `esperando_resultado`: procesar_vencimientos_
  -- desafios() ya tiene su propia prueba en la 43, y acá sólo hace
  -- falta la fila en el estado que consume esta migración.
  insert into public.club_challenges (id, club_retador_id, club_retado_id, creado_por, estado)
  values (v_ch1, v_cA, v_cB, v_adminA, 'esperando_resultado');

  insert into public.club_challenge_proposals (
      id, challenge_id, club_proponente_id, creada_por, fecha, duracion_min,
      direccion, cancha_nombre, comuna, region, latitud, longitud,
      modalidad, cupos_por_club, metodo_inscripcion, cuota_por_persona, estado)
  values
    (v_pr1, v_ch1, v_cA, v_adminA, now() + interval '2 days', 90,
     'Av. Ocho 8', 'Cancha Ocho', 'Providencia', 'Región Metropolitana de Santiago',
     -33.42, -70.61, 'futbol7', 7, 'orden_llegada', 0, 'aprobada');

  -- La hora se inserta en el FUTURO porque `trg_match_future_only`
  -- rechaza cualquier partido con hora pasada; el `update` de después sí
  -- puede moverla al pasado.
  insert into public.matches (
      id, id_organizador, titulo, comuna, region, cancha_nombre, latitud, longitud,
      hora, duracion_min, cupos_totales, cupos_disponibles, estado,
      challenge_proposal_id, challenge_id, club_local_id, club_visitante_id,
      cupos_por_club, metodo_inscripcion, ubicacion_aproximada)
  values
    (v_m1, v_adminA, 'A vs B (1)', 'Providencia', 'Región Metropolitana de Santiago',
     'Cancha Ocho', -33.42, -70.61, now() + interval '2 days', 90, 14, 14, 'abierto',
     v_pr1, v_ch1, v_cA, v_cB, 7, 'orden_llegada', true);

  update public.matches set hora = now() - interval '3 hours' where id = v_m1;
  update public.club_challenges set match_id = v_m1 where id = v_ch1;

  insert into public.attendees (id_partido, id_jugador, estado, club_id, origen)
  values (v_m1, v_j1, 'inscrito', v_cA, 'orden_llegada'),
         (v_m1, v_j2, 'inscrito', v_cA, 'orden_llegada'),
         (v_m1, v_j3, 'inscrito', v_cB, 'orden_llegada'),
         (v_m1, v_j4, 'inscrito', v_cB, 'orden_llegada');

  -- ══ CASO 1: un ajeno no puede proponer ═══════════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_ajeno,'role','authenticated')::text);
  v_j := public.proponer_resultado(v_ch1, 2, 1, null);
  execute 'reset role';
  if (v_j->>'ok')::boolean is not false then
    raise exception 'FALLÓ (caso 1): un ajeno no debería poder proponer: %', v_j;
  end if;
  insert into t48 values (1, 'ajeno no propone', v_j->>'reason');

  -- ══ CASO 2: quien administra los dos clubes no puede proponer ═
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_ambos,'role','authenticated')::text);
  v_j := public.proponer_resultado(v_ch1, 2, 1, null);
  execute 'reset role';
  if (v_j->>'ok')::boolean is not false or (v_j->>'reason') not ilike '%Administras los dos%' then
    raise exception 'FALLÓ (caso 2): doble administrador no debería poder proponer: %', v_j;
  end if;
  insert into t48 values (2, 'doble admin no propone', v_j->>'reason');

  -- ══ CASO 3: el marcador se valida ══════════════════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.proponer_resultado(v_ch1, -1, 2, null);
  execute 'reset role';
  if (v_j->>'ok')::boolean is not false then
    raise exception 'FALLÓ (caso 3): un marcador negativo debería rechazarse: %', v_j;
  end if;
  insert into t48 values (3, 'marcador negativo rechazado', v_j->>'reason');

  -- ══ CASO 4: admin de A propone 3-1 y marca asistencia ═════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.proponer_resultado(v_ch1, 3, 1, to_jsonb(array[v_j1::text, v_j3::text]));
  execute 'reset role';
  if not (v_j->>'ok')::boolean or (v_j->>'estado') <> 'propuesto' then
    raise exception 'FALLÓ (caso 4): la propuesta de A debería quedar en propuesto: %', v_j;
  end if;
  v_res1 := (v_j->>'resultId')::uuid;

  select estado into v_estado from public.attendees where id_partido = v_m1 and id_jugador = v_j1;
  if v_estado <> 'confirmado_gps' then
    raise exception 'FALLÓ (caso 4): j1 debería quedar confirmado_gps, quedó %', v_estado;
  end if;
  select estado into v_estado from public.attendees where id_partido = v_m1 and id_jugador = v_j2;
  if v_estado <> 'no_asistio' then
    raise exception 'FALLÓ (caso 4): j2 debería quedar no_asistio, quedó %', v_estado;
  end if;
  select estado into v_estado from public.attendees where id_partido = v_m1 and id_jugador = v_j3;
  if v_estado <> 'confirmado_gps' then
    raise exception 'FALLÓ (caso 4): j3 debería quedar confirmado_gps, quedó %', v_estado;
  end if;
  select estado into v_estado from public.attendees where id_partido = v_m1 and id_jugador = v_j4;
  if v_estado <> 'no_asistio' then
    raise exception 'FALLÓ (caso 4): j4 debería quedar no_asistio, quedó %', v_estado;
  end if;
  insert into t48 values (4, 'A propone 3-1 y marca asistencia', v_j::text);

  -- ══ CASO 5: una segunda propuesta mientras hay una pendiente ══
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminB,'role','authenticated')::text);
  v_j := public.proponer_resultado(v_ch1, 5, 5, null);
  execute 'reset role';
  if (v_j->>'ok')::boolean is not false or (v_j->>'reason') not ilike '%Ya hay un resultado propuesto%' then
    raise exception 'FALLÓ (caso 5): no debería aceptar una segunda propuesta activa: %', v_j;
  end if;
  insert into t48 values (5, 'no hay dos propuestas activas', v_j->>'reason');

  -- ══ CASO 6: el proponente no confirma su propio resultado ════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.confirmar_resultado(v_res1, true);
  execute 'reset role';
  if (v_j->>'ok')::boolean is not false or (v_j->>'reason') not ilike '%propio resultado%' then
    raise exception 'FALLÓ (caso 6): el proponente no debería poder confirmarse a sí mismo: %', v_j;
  end if;
  insert into t48 values (6, 'proponente no se autoconfirma', v_j->>'reason');

  -- ══ CASO 7: un ajeno no puede confirmar ═══════════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_ajeno,'role','authenticated')::text);
  v_j := public.confirmar_resultado(v_res1, true);
  execute 'reset role';
  if (v_j->>'ok')::boolean is not false then
    raise exception 'FALLÓ (caso 7): un ajeno no debería poder confirmar: %', v_j;
  end if;
  insert into t48 values (7, 'ajeno no confirma', v_j->>'reason');

  -- ══ CASO 8: quien pertenece también al club proponente no confirma,
  --            aunque administre el club contrario (regla de la 43d) ══
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_ambos,'role','authenticated')::text);
  v_j := public.confirmar_resultado(v_res1, true);
  execute 'reset role';
  if (v_j->>'ok')::boolean is not false or (v_j->>'reason') not ilike '%club al que perteneces%' then
    raise exception 'FALLÓ (caso 8): quien pertenece a los dos clubes no debería poder confirmar: %', v_j;
  end if;
  insert into t48 values (8, 'doble pertenencia no confirma', v_j->>'reason');

  -- ══ CASO 9: admin de B rechaza el resultado ════════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminB,'role','authenticated')::text);
  v_j := public.confirmar_resultado(v_res1, false);
  execute 'reset role';
  if (v_j->>'ok')::boolean is not true or (v_j->>'aceptado')::boolean is not false then
    raise exception 'FALLÓ (caso 9): B debería poder rechazar el resultado: %', v_j;
  end if;

  select estado into v_estado from public.club_match_results where id = v_res1;
  if v_estado <> 'rechazado' then
    raise exception 'FALLÓ (caso 9): el resultado debería quedar rechazado, quedó %', v_estado;
  end if;
  select estado into v_estado from public.club_challenges where id = v_ch1;
  if v_estado <> 'resultado_en_disputa' then
    raise exception 'FALLÓ (caso 9): el desafío debería quedar en resultado_en_disputa, quedó %', v_estado;
  end if;
  select estado into v_estado from public.matches where id = v_m1;
  if v_estado not in ('abierto', 'lleno') then
    raise exception 'FALLÓ (caso 9): rechazar no debería tocar el partido, quedó %', v_estado;
  end if;
  insert into t48 values (9, 'B rechaza, queda en disputa', v_j::text);

  -- ══ CASO 10: confirmar un resultado ya rechazado no revive nada ═
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminB,'role','authenticated')::text);
  v_j := public.confirmar_resultado(v_res1, true);
  execute 'reset role';
  if (v_j->>'ok')::boolean is not false or (v_j->>'reason') not ilike '%ya fue rechazado%' then
    raise exception 'FALLÓ (caso 10): un resultado rechazado no debería poder confirmarse: %', v_j;
  end if;
  insert into t48 values (10, 'no se confirma un rechazado', v_j->>'reason');

  -- ══ CASO 11 (48b): en disputa, NADIE puede proponer un resultado
  --                   nuevo por su cuenta — sólo la moderación reabre ══
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.proponer_resultado(v_ch1, 2, 2, null);
  execute 'reset role';
  if (v_j->>'ok')::boolean is not false or (v_j->>'reason') not ilike '%no está esperando%' then
    raise exception 'FALLÓ (caso 11): en disputa nadie debería poder proponer de nuevo: %', v_j;
  end if;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminB,'role','authenticated')::text);
  v_j := public.proponer_resultado(v_ch1, 2, 2, null);
  execute 'reset role';
  if (v_j->>'ok')::boolean is not false or (v_j->>'reason') not ilike '%no está esperando%' then
    raise exception 'FALLÓ (caso 11): tampoco el club contrario reabre la disputa por su cuenta: %', v_j;
  end if;
  insert into t48 values (11, 'en disputa sólo la moderación reabre', v_j->>'reason');

  -- ══ CASO 12: nadie escribe a mano club_match_results ═══════════
  v_err := null;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
    insert into public.club_match_results
      (challenge_id, match_id, club_local_id, club_visitante_id, goles_local, goles_visitante, club_proponente_id)
    values (v_ch1, v_m1, v_cA, v_cB, 9, 9, v_cA);
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_err := SQLERRM;
  end;
  if v_err is null then
    raise exception 'FALLÓ (caso 12): el insert directo debería fallar';
  end if;
  if v_err not ilike '%permission denied%' and v_err not ilike '%permiso denegado%' then
    raise exception 'FALLÓ (caso 12): falló por otra razón: %', v_err;
  end if;
  insert into t48 values (12, 'RLS bloquea escritura directa', v_err);

  -- ══ CASO 13: sólo los integrantes de los dos clubes leen ═══════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_j1,'role','authenticated')::text);
  select count(*) into v_count from public.club_match_results where challenge_id = v_ch1;
  execute 'reset role';
  if v_count < 1 then
    raise exception 'FALLÓ (caso 13): un integrante debería ver al menos una fila, vio %', v_count;
  end if;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_ajeno,'role','authenticated')::text);
  select count(*) into v_count from public.club_match_results where challenge_id = v_ch1;
  execute 'reset role';
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 13): un ajeno no debería ver ninguna fila, vio %', v_count;
  end if;
  insert into t48 values (13, 'RLS de lectura por integrante', 'ok');

  -- ── encuentro 2: mismos clubes, sin disputa esta vez ─────────────
  insert into public.club_challenges (id, club_retador_id, club_retado_id, creado_por, estado)
  values (v_ch2, v_cA, v_cB, v_adminA, 'esperando_resultado');

  insert into public.club_challenge_proposals (
      id, challenge_id, club_proponente_id, creada_por, fecha, duracion_min,
      direccion, cancha_nombre, comuna, region, latitud, longitud,
      modalidad, cupos_por_club, metodo_inscripcion, cuota_por_persona, estado)
  values
    (v_pr2, v_ch2, v_cA, v_adminA, now() + interval '9 days', 90,
     'Av. Nueve 9', 'Cancha Nueve', 'Providencia', 'Región Metropolitana de Santiago',
     -33.43, -70.60, 'futbol7', 7, 'orden_llegada', 0, 'aprobada');

  insert into public.matches (
      id, id_organizador, titulo, comuna, region, cancha_nombre, latitud, longitud,
      hora, duracion_min, cupos_totales, cupos_disponibles, estado,
      challenge_proposal_id, challenge_id, club_local_id, club_visitante_id,
      cupos_por_club, metodo_inscripcion, ubicacion_aproximada)
  values
    (v_m2, v_adminA, 'A vs B (2)', 'Providencia', 'Región Metropolitana de Santiago',
     'Cancha Nueve', -33.43, -70.60, now() + interval '9 days', 90, 14, 14, 'abierto',
     v_pr2, v_ch2, v_cA, v_cB, 7, 'orden_llegada', true);

  update public.matches set hora = now() - interval '3 hours' where id = v_m2;
  update public.club_challenges set match_id = v_m2 where id = v_ch2;

  -- ══ CASO 14: A propone 2-2 en el segundo encuentro ═════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.proponer_resultado(v_ch2, 2, 2, null);
  execute 'reset role';
  if not (v_j->>'ok')::boolean or (v_j->>'estado') <> 'propuesto' then
    raise exception 'FALLÓ (caso 14): A debería poder proponer en un encuentro nuevo: %', v_j;
  end if;
  v_res2 := (v_j->>'resultId')::uuid;
  insert into t48 values (14, 'A propone 2-2 en el segundo encuentro', v_j::text);

  -- ══ CASO 15: B confirma esta vez ═══════════════════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminB,'role','authenticated')::text);
  v_j := public.confirmar_resultado(v_res2, true);
  execute 'reset role';
  if (v_j->>'ok')::boolean is not true or (v_j->>'aceptado')::boolean is not true then
    raise exception 'FALLÓ (caso 15): B debería poder confirmar el resultado: %', v_j;
  end if;

  select estado into v_estado from public.club_match_results where id = v_res2;
  if v_estado <> 'confirmado' then
    raise exception 'FALLÓ (caso 15): el resultado debería quedar confirmado, quedó %', v_estado;
  end if;
  select estado into v_estado from public.matches where id = v_m2;
  if v_estado <> 'finalizado' then
    raise exception 'FALLÓ (caso 15): el partido debería quedar finalizado, quedó %', v_estado;
  end if;
  select estado into v_estado from public.club_challenges where id = v_ch2;
  if v_estado <> 'finalizado' then
    raise exception 'FALLÓ (caso 15): el desafío debería quedar finalizado, quedó %', v_estado;
  end if;
  insert into t48 values (15, 'B confirma, todo finalizado', v_j::text);

  -- ══ CASO 16: confirmar de nuevo es idempotente ═════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminB,'role','authenticated')::text);
  v_j := public.confirmar_resultado(v_res2, true);
  execute 'reset role';
  if (v_j->>'ok')::boolean is not true or (v_j->>'already')::boolean is not true then
    raise exception 'FALLÓ (caso 16): confirmar de nuevo debería ser idempotente: %', v_j;
  end if;
  insert into t48 values (16, 'confirmar de nuevo es idempotente', v_j::text);

  -- ══ CASO 17: club_record() sólo cuenta el confirmado ═══════════
  -- El 3-1 del primer encuentro nunca se confirmó (quedó rechazado, y en
  -- disputa para siempre sin moderación) y el 2-2 del segundo sí: el récord
  -- de los dos clubes tiene que ser un empate cada uno, cero más.
  select v, e, d into v_v, v_e, v_d from public.club_record(v_cA);
  if (v_v, v_e, v_d) <> (0, 1, 0) then
    raise exception 'FALLÓ (caso 17): club_record(A) debería ser 0-1-0, fue %-%-%', v_v, v_e, v_d;
  end if;
  select v, e, d into v_v, v_e, v_d from public.club_record(v_cB);
  if (v_v, v_e, v_d) <> (0, 1, 0) then
    raise exception 'FALLÓ (caso 17): club_record(B) debería ser 0-1-0, fue %-%-%', v_v, v_e, v_d;
  end if;
  insert into t48 values (17, 'club_record ignora el rechazado', '0-1-0 para los dos');

  -- ══ CASO 18: historial_publico_club() muestra el marcador real ═
  -- Sólo el segundo encuentro (finalizado) aparece: el primero se quedó en
  -- disputa y `historial_publico_club()` filtra `estado = 'finalizado'`.
  select goles_local, goles_visitante, resultado
    into v_gl, v_gv, v_result
    from public.historial_publico_club(v_cA)
   where match_id = v_m2;
  if (v_gl, v_gv, v_result) is distinct from (2, 2, 'E') then
    raise exception 'FALLÓ (caso 18): historial de A debería mostrar 2-2 E, fue %-% %', v_gl, v_gv, v_result;
  end if;
  select goles_local, goles_visitante, resultado
    into v_gl, v_gv, v_result
    from public.historial_publico_club(v_cB)
   where match_id = v_m2;
  if (v_gl, v_gv, v_result) is distinct from (2, 2, 'E') then
    raise exception 'FALLÓ (caso 18): historial de B debería mostrar 2-2 E, fue %-% %', v_gl, v_gv, v_result;
  end if;
  if exists (select 1 from public.historial_publico_club(v_cA) where match_id = v_m1) then
    raise exception 'FALLÓ (caso 18): el encuentro en disputa no debería salir en el historial público';
  end if;
  insert into t48 values (18, 'historial_publico_club muestra 2-2 E, sin el en disputa', 'para los dos clubes');

  -- ══ CASO 19: un desafío ya finalizado no admite una propuesta nueva ═
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.proponer_resultado(v_ch2, 1, 1, null);
  execute 'reset role';
  if (v_j->>'ok')::boolean is not false or (v_j->>'reason') not ilike '%no está esperando%' then
    raise exception 'FALLÓ (caso 19): un desafío finalizado no debería admitir una propuesta nueva: %', v_j;
  end if;
  insert into t48 values (19, 'finalizado no admite propuesta nueva', v_j->>'reason');

  raise notice 'Todos los casos de 48_resultado_test.sql pasaron.';
end;
$$;

select n, caso, detalle from t48 order by n;

rollback;
