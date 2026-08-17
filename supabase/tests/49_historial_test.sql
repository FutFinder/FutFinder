-- =============================================================
-- FutFinder — pruebas del historial real del club y sus
-- estadísticas (migración 49).
--
-- QUÉ SE PRUEBA:
--
--   · UN CLUB QUE NO JUGÓ TIENE HISTORIAL VACÍO, no un relleno (caso 1).
--   · VICTORIA COMO LOCAL y DERROTA COMO VISITANTE son la MISMA fila
--     leída desde los dos clubes, con el marcador invertido (caso 2).
--   · VICTORIA COMO VISITANTE y DERROTA COMO LOCAL, para que nadie
--     asuma que el club que pregunta es el local (caso 3).
--   · EL EMPATE ES EMPATE PARA LOS DOS (caso 4).
--   · UN PARTIDO `finalizado` SIN RESULTADO CONFIRMADO NO SALE. Es el
--     fallo que motiva esta migración: `save_match_attendance()` (33)
--     pone `estado = 'finalizado'` sin mirar `club_match_results`, y
--     `historial_publico_club()` lo publicaba con marcador nulo
--     (caso 5).
--   · UN RESULTADO `propuesto` TAMPOCO SALE (caso 6) NI UNO
--     `rechazado` (caso 7): garantía 5 de la 48.
--   · VARIOS PARTIDOS SALEN COMPLETOS Y EN ORDEN, del más reciente al
--     más antiguo, y `p_limit` se respeta (caso 8).
--   · LA HORA EXACTA Y LA CANCHA SON SÓLO DE LOS DOS CLUBES: un
--     integrante las recibe (caso 9), un `authenticated` ajeno y `anon`
--     no, pero sí ven clubes, escudos, marcador, resultado y nivel
--     (casos 10 y 11).
--   · `club_estadisticas()` DEVUELVE PJ/V/E/D/GF/GC REALES, desde la
--     perspectiva de cada club, sin contar el propuesto ni el
--     rechazado (caso 12), y CEROS —no nulos— para el club que no jugó
--     (caso 13).
--
-- QUÉ NO SE PRUEBA ACÁ: que un partido `cancelado` no aparezca. El
-- filtro `m.estado = 'finalizado'` es el mismo que la 44d ya trae y su
-- prueba lo cubre (`44d_partido_privado_test.sql`, caso 16). Y un
-- partido cancelado CON resultado confirmado no existe: confirmar cierra
-- el desafío y cancelar exige que siga activo.
--
-- NOTA SOBRE LOS DATOS: el arnés crea sus propios clubes, usuarios,
-- desafíos y partidos dentro de la transacción y los deshace con el
-- `rollback`. Los resultados se insertan DIRECTAMENTE en
-- `club_match_results` —no por `proponer_resultado()`/
-- `confirmar_resultado()`, que ya tienen su prueba en la 48— porque acá
-- lo que se comprueba es la LECTURA, y armar seis encuentros por el
-- ciclo completo sólo agregaría ruido.
--
-- Requiere las migraciones 41 a 49 aplicadas, o la 49 corrida dentro de
-- la misma transacción que este arnés.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor.
-- Todo corre en una transacción que termina en ROLLBACK.
-- =============================================================

begin;

create temp table t49 (n integer, caso text, detalle text) on commit drop;

do $$
declare
  v_adminA uuid := gen_random_uuid(); -- integrante (admin) del club A
  v_adminB uuid := gen_random_uuid(); -- integrante (admin) del club B
  v_ajeno  uuid := gen_random_uuid(); -- autenticado, sin club

  v_cA uuid := gen_random_uuid();
  v_cB uuid := gen_random_uuid();
  v_cC uuid := gen_random_uuid(); -- juega uno, sin confirmar: historial vacío

  -- Seis encuentros entre A y B. `A` es local salvo donde se indica.
  v_ch1 uuid := gen_random_uuid(); v_pr1 uuid := gen_random_uuid(); v_m1 uuid := gen_random_uuid();
  v_ch2 uuid := gen_random_uuid(); v_pr2 uuid := gen_random_uuid(); v_m2 uuid := gen_random_uuid();
  v_ch3 uuid := gen_random_uuid(); v_pr3 uuid := gen_random_uuid(); v_m3 uuid := gen_random_uuid();
  v_ch4 uuid := gen_random_uuid(); v_pr4 uuid := gen_random_uuid(); v_m4 uuid := gen_random_uuid();
  v_ch5 uuid := gen_random_uuid(); v_pr5 uuid := gen_random_uuid(); v_m5 uuid := gen_random_uuid();
  v_ch6 uuid := gen_random_uuid(); v_pr6 uuid := gen_random_uuid(); v_m6 uuid := gen_random_uuid();

  v_count  int;
  v_mid    uuid;
  v_gl     int;
  v_gv     int;
  v_result text;
  v_hora   timestamptz;
  v_cancha text;
  v_nivel  text;
  v_soy    boolean;
  v_logo   text;
  v_fechas date[];
  v_pj int; v_v int; v_e int; v_d int; v_gf int; v_gc int;
begin
  -- ── gente ─────────────────────────────────────────────────────
  insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,email_change,
    email_change_token_new,recovery_token)
  select '00000000-0000-0000-0000-000000000000',u,'authenticated','authenticated',
    'u49-'||u||'@futfinder.test','x',now(),now(),now(),'{}','{}','','','',''
  from unnest(array[v_adminA, v_adminB, v_ajeno]) u;

  -- ── clubes ────────────────────────────────────────────────────
  -- Con escudo: la tarjeta del historial los dibuja y el caso 11
  -- comprueba que son públicos.
  insert into public.clubs (id, nombre, slug, plan, created_by, foto_url)
  values (v_cA, 'Club A 49', 'club-a-49-'||left(v_cA::text,8), 'estandar', v_adminA,
          'https://cdn.futfinder.test/a.png'),
         (v_cB, 'Club B 49', 'club-b-49-'||left(v_cB::text,8), 'estandar', v_adminB,
          'https://cdn.futfinder.test/b.png'),
         (v_cC, 'Club C 49', 'club-c-49-'||left(v_cC::text,8), 'estandar', v_ajeno, null);

  insert into public.club_members (club_id, user_id, rol)
  values (v_cA, v_adminA, 'admin'), (v_cB, v_adminB, 'admin');

  -- ── los seis encuentros ───────────────────────────────────────
  -- Se salta el ciclo de estados: acá sólo importa la fila final.
  --
  -- LOS PARES NO SON DECORATIVOS. `club_challenges_unique_activo`
  -- admite UN solo desafío activo por par de clubes, y
  -- `esperando_resultado` está entre los estados que cuenta. Los tres
  -- confirmados y el rechazado caben todos en el par A/B porque
  -- `finalizado` y `resultado_en_disputa` quedan fuera del índice; el
  -- quinto encuentro —el del resultado propuesto, que en producción
  -- vive en `esperando_resultado`— se juega contra C para no chocar con
  -- el cuarto. C sigue con el historial y las estadísticas en cero: un
  -- resultado `propuesto` no cuenta para nadie, que es justamente lo
  -- que comprueban los casos 1, 6 y 13.
  insert into public.club_challenges (id, club_retador_id, club_retado_id, creado_por, estado)
  values (v_ch1, v_cA, v_cB, v_adminA, 'finalizado'),
         (v_ch2, v_cB, v_cA, v_adminB, 'finalizado'),
         (v_ch3, v_cA, v_cB, v_adminA, 'finalizado'),
         (v_ch4, v_cA, v_cB, v_adminA, 'esperando_resultado'),
         (v_ch5, v_cA, v_cC, v_adminA, 'esperando_resultado'),
         (v_ch6, v_cA, v_cB, v_adminA, 'resultado_en_disputa');

  insert into public.club_challenge_proposals (
      id, challenge_id, club_proponente_id, creada_por, fecha, duracion_min,
      direccion, cancha_nombre, comuna, region, latitud, longitud,
      modalidad, cupos_por_club, metodo_inscripcion, cuota_por_persona, estado)
  select p.id, p.ch, p.club, p.autor, now() + interval '2 days', 90,
         'Av. Nueve 9', p.cancha, 'Providencia', 'Región Metropolitana de Santiago',
         -33.42, -70.61, 'futbol7', 7, 'orden_llegada', 0, 'aprobada'
    from (values
      (v_pr1, v_ch1, v_cA, v_adminA, 'Cancha Uno'),
      (v_pr2, v_ch2, v_cB, v_adminB, 'Cancha Dos'),
      (v_pr3, v_ch3, v_cA, v_adminA, 'Cancha Tres'),
      (v_pr4, v_ch4, v_cA, v_adminA, 'Cancha Cuatro'),
      (v_pr5, v_ch5, v_cA, v_adminA, 'Cancha Cinco'),
      (v_pr6, v_ch6, v_cA, v_adminA, 'Cancha Seis')
    ) as p(id, ch, club, autor, cancha);

  -- `trg_match_future_only` rechaza una hora pasada al insertar; el
  -- `update` de después sí puede moverla al pasado.
  insert into public.matches (
      id, id_organizador, titulo, comuna, region, cancha_nombre, latitud, longitud,
      hora, duracion_min, cupos_totales, cupos_disponibles, estado, nivel,
      challenge_proposal_id, challenge_id, club_local_id, club_visitante_id,
      cupos_por_club, metodo_inscripcion, ubicacion_aproximada)
  select m.id, v_adminA, m.titulo, 'Providencia', 'Región Metropolitana de Santiago',
         m.cancha, -33.42, -70.61, now() + interval '2 days', 90, 14, 14, 'abierto',
         m.nivel, m.pr, m.ch, m.local, m.visita, 7, 'orden_llegada', true
    from (values
      (v_m1, 'A 3-1 B',        'Cancha Uno',    'competitivo', v_pr1, v_ch1, v_cA, v_cB),
      (v_m2, 'B 0-2 A',        'Cancha Dos',    'intermedio',  v_pr2, v_ch2, v_cB, v_cA),
      (v_m3, 'A 2-2 B',        'Cancha Tres',   'recreativo',  v_pr3, v_ch3, v_cA, v_cB),
      (v_m4, 'A ? B sin res.', 'Cancha Cuatro', 'recreativo',  v_pr4, v_ch4, v_cA, v_cB),
      (v_m5, 'A ? C propuesto','Cancha Cinco',  'recreativo',  v_pr5, v_ch5, v_cA, v_cC),
      (v_m6, 'A ? B rechazado','Cancha Seis',   'recreativo',  v_pr6, v_ch6, v_cA, v_cB)
    ) as m(id, titulo, cancha, nivel, pr, ch, local, visita);

  -- Ya jugados, en orden: m1 el más antiguo, m3 el más reciente de los
  -- tres confirmados. El caso 8 comprueba ese orden.
  update public.matches set hora = now() - interval '30 days', estado = 'finalizado' where id = v_m1;
  update public.matches set hora = now() - interval '20 days', estado = 'finalizado' where id = v_m2;
  update public.matches set hora = now() - interval '10 days', estado = 'finalizado' where id = v_m3;
  -- El caso 5: finalizado por `save_match_attendance()`, sin resultado.
  update public.matches set hora = now() - interval '5 days',  estado = 'finalizado' where id = v_m4;
  update public.matches set hora = now() - interval '4 days',  estado = 'finalizado' where id = v_m5;
  update public.matches set hora = now() - interval '3 days',  estado = 'finalizado' where id = v_m6;

  update public.club_challenges set match_id = v_m1 where id = v_ch1;
  update public.club_challenges set match_id = v_m2 where id = v_ch2;
  update public.club_challenges set match_id = v_m3 where id = v_ch3;
  update public.club_challenges set match_id = v_m4 where id = v_ch4;
  update public.club_challenges set match_id = v_m5 where id = v_ch5;
  update public.club_challenges set match_id = v_m6 where id = v_ch6;

  -- ── los resultados ────────────────────────────────────────────
  insert into public.club_match_results (
      challenge_id, match_id, club_local_id, club_visitante_id,
      goles_local, goles_visitante, club_proponente_id, propuesto_por,
      confirmado_por, confirmado_at, estado)
  values
    (v_ch1, v_m1, v_cA, v_cB, 3, 1, v_cA, v_adminA, v_adminB, now(), 'confirmado'),
    (v_ch2, v_m2, v_cB, v_cA, 0, 2, v_cB, v_adminB, v_adminA, now(), 'confirmado'),
    (v_ch3, v_m3, v_cA, v_cB, 2, 2, v_cA, v_adminA, v_adminB, now(), 'confirmado'),
    -- m4 no tiene ninguna fila: es el partido sin resultado.
    (v_ch5, v_m5, v_cA, v_cC, 9, 0, v_cA, v_adminA, null, null, 'propuesto'),
    (v_ch6, v_m6, v_cA, v_cB, 8, 0, v_cA, v_adminA, null, null, 'rechazado');

  -- ══ CASO 1: el club que no jugó tiene historial vacío ═════════
  select count(*) into v_count from public.historial_club(v_cC, 20);
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 1): el club sin partidos devolvió % filas', v_count;
  end if;
  insert into t49 values (1, 'historial vacío',
    'C jugó un encuentro cuyo resultado sólo está propuesto: 0 filas, no un relleno');

  -- ══ CASO 2: victoria como local == derrota como visitante ═════
  select goles_local, goles_visitante, resultado into v_gl, v_gv, v_result
    from public.historial_club(v_cA, 20) where match_id = v_m1;
  if v_gl <> 3 or v_gv <> 1 or v_result <> 'V' then
    raise exception 'FALLÓ (caso 2): para A el 3-1 en casa dio %-% %', v_gl, v_gv, v_result;
  end if;
  select goles_local, goles_visitante, resultado into v_gl, v_gv, v_result
    from public.historial_club(v_cB, 20) where match_id = v_m1;
  if v_gl <> 3 or v_gv <> 1 or v_result <> 'D' then
    raise exception 'FALLÓ (caso 2): para B el mismo partido dio %-% %', v_gl, v_gv, v_result;
  end if;
  insert into t49 values (2, 'victoria local / derrota visitante',
    'la MISMA fila 3-1 es V para el local A y D para el visitante B');

  -- ══ CASO 3: victoria como visitante / derrota como local ══════
  select goles_local, goles_visitante, resultado into v_gl, v_gv, v_result
    from public.historial_club(v_cA, 20) where match_id = v_m2;
  if v_gl <> 0 or v_gv <> 2 or v_result <> 'V' then
    raise exception 'FALLÓ (caso 3): A de visita ganando 0-2 dio %-% %', v_gl, v_gv, v_result;
  end if;
  select resultado into v_result from public.historial_club(v_cB, 20) where match_id = v_m2;
  if v_result <> 'D' then
    raise exception 'FALLÓ (caso 3): B como local perdiendo 0-2 dio %', v_result;
  end if;
  insert into t49 values (3, 'victoria visitante / derrota local',
    'el 0-2 es V para el VISITANTE A y D para el local B: no se asume que quien pregunta es local');

  -- ══ CASO 4: el empate es empate para los dos ══════════════════
  select resultado into v_result from public.historial_club(v_cA, 20) where match_id = v_m3;
  if v_result <> 'E' then raise exception 'FALLÓ (caso 4): el 2-2 dio % para A', v_result; end if;
  select resultado into v_result from public.historial_club(v_cB, 20) where match_id = v_m3;
  if v_result <> 'E' then raise exception 'FALLÓ (caso 4): el 2-2 dio % para B', v_result; end if;
  insert into t49 values (4, 'empate', 'el 2-2 es E para los dos clubes');

  -- ══ CASO 5: finalizado SIN resultado confirmado no sale ═══════
  if exists (select 1 from public.historial_club(v_cA, 20) where match_id = v_m4) then
    raise exception 'FALLÓ (caso 5): un partido finalizado sin resultado apareció en el historial';
  end if;
  -- Y la proyección de la 44d SÍ lo publica: es la diferencia que
  -- justifica esta función, no una suposición.
  if not exists (select 1 from public.historial_publico_club(v_cA, 20) where match_id = v_m4) then
    raise exception 'FALLÓ (caso 5): historial_publico_club() cambió de contrato';
  end if;
  insert into t49 values (5, 'finalizado sin resultado',
    'no aparece en historial_club() aunque historial_publico_club() sí lo publique con marcador nulo');

  -- ══ CASO 6: un resultado propuesto no sale ════════════════════
  if exists (select 1 from public.historial_club(v_cA, 20) where match_id = v_m5) then
    raise exception 'FALLÓ (caso 6): un resultado propuesto apareció en el historial';
  end if;
  insert into t49 values (6, 'resultado propuesto', 'no cuenta como partido jugado hasta que lo confirmen');

  -- ══ CASO 7: un resultado rechazado no sale ════════════════════
  if exists (select 1 from public.historial_club(v_cA, 20) where match_id = v_m6) then
    raise exception 'FALLÓ (caso 7): un resultado rechazado apareció en el historial';
  end if;
  insert into t49 values (7, 'resultado rechazado', 'un 8-0 en disputa no entra en el historial de nadie');

  -- ══ CASO 8: varios partidos, en orden, con el límite ══════════
  select count(*) into v_count from public.historial_club(v_cA, 20);
  if v_count <> 3 then
    raise exception 'FALLÓ (caso 8): A debería tener 3 partidos, tuvo %', v_count;
  end if;
  -- Sin `order by` en el agregado: así se comprueba el orden que trae la
  -- FUNCIÓN, no uno que la prueba se aplique a sí misma.
  select array_agg(fecha) into v_fechas from public.historial_club(v_cA, 20);
  if not (v_fechas[1] > v_fechas[2] and v_fechas[2] > v_fechas[3]) then
    raise exception 'FALLÓ (caso 8): el historial no viene del más reciente al más antiguo: %', v_fechas;
  end if;
  select match_id into v_mid from public.historial_club(v_cA, 1);
  if v_mid <> v_m3 then
    raise exception 'FALLÓ (caso 8): con p_limit = 1 no salió el más reciente';
  end if;
  select count(*) into v_count from public.historial_club(v_cA, 1);
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 8): p_limit = 1 devolvió % filas', v_count;
  end if;
  insert into t49 values (8, 'varios partidos', '3 encuentros, del más reciente al más antiguo, y p_limit se respeta');

  -- ══ CASO 9: el integrante recibe hora y cancha ════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  select hora, cancha_nombre, nivel, soy_integrante
    into v_hora, v_cancha, v_nivel, v_soy
    from public.historial_club(v_cA, 20) where match_id = v_m1;
  execute 'reset role';
  if v_hora is null or v_cancha is distinct from 'Cancha Uno' or v_soy is not true then
    raise exception 'FALLÓ (caso 9): al integrante le faltó hora (%) o cancha (%), soy_integrante=%',
      v_hora, v_cancha, v_soy;
  end if;
  if v_nivel <> 'competitivo' then
    raise exception 'FALLÓ (caso 9): el nivel del partido llegó como %', v_nivel;
  end if;
  insert into t49 values (9, 'integrante',
    'quien pertenece a uno de los dos clubes recibe hora exacta, cancha y nivel');

  -- ══ CASO 10: el autenticado ajeno NO las recibe ═══════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_ajeno,'role','authenticated')::text);
  select hora, cancha_nombre, goles_local, resultado, soy_integrante
    into v_hora, v_cancha, v_gl, v_result, v_soy
    from public.historial_club(v_cA, 20) where match_id = v_m1;
  execute 'reset role';
  if v_hora is not null or v_cancha is not null or v_soy is not false then
    raise exception 'FALLÓ (caso 10): un ajeno recibió hora (%) o cancha (%), soy_integrante=%',
      v_hora, v_cancha, v_soy;
  end if;
  if v_gl <> 3 or v_result <> 'V' then
    raise exception 'FALLÓ (caso 10): el ajeno perdió el marcador público: %-, %', v_gl, v_result;
  end if;
  insert into t49 values (10, 'autenticado ajeno',
    'sin hora ni cancha, pero con clubes, marcador y resultado: es historial público');

  -- ══ CASO 11: anon ve lo público, escudos incluidos ════════════
  execute format('set local request.jwt.claims to %L', json_build_object('role','anon')::text);
  execute 'set local role anon';
  select hora, cancha_nombre, club_local_foto_url, nivel, soy_integrante
    into v_hora, v_cancha, v_logo, v_nivel, v_soy
    from public.historial_club(v_cA, 20) where match_id = v_m1;
  select count(*) into v_count from public.historial_club(v_cA, 20);
  execute 'reset role';
  if v_hora is not null or v_cancha is not null or v_soy is not false then
    raise exception 'FALLÓ (caso 11): anon recibió hora (%) o cancha (%)', v_hora, v_cancha;
  end if;
  if v_logo is distinct from 'https://cdn.futfinder.test/a.png' or v_nivel <> 'competitivo' then
    raise exception 'FALLÓ (caso 11): anon no vio el escudo (%) o el nivel (%)', v_logo, v_nivel;
  end if;
  if v_count <> 3 then
    raise exception 'FALLÓ (caso 11): anon vio % partidos en vez de 3', v_count;
  end if;
  insert into t49 values (11, 'anon',
    'el historial es público: 3 partidos con escudos, marcador y nivel, y sin hora ni cancha');

  -- ══ CASO 12: estadísticas reales, por perspectiva ═════════════
  select pj, v, e, d, gf, gc into v_pj, v_v, v_e, v_d, v_gf, v_gc
    from public.club_estadisticas(v_cA);
  if v_pj <> 3 or v_v <> 2 or v_e <> 1 or v_d <> 0 or v_gf <> 7 or v_gc <> 3 then
    raise exception 'FALLÓ (caso 12): A debería ser 3 PJ 2-1-0 7:3, fue % PJ %-%-% %:%',
      v_pj, v_v, v_e, v_d, v_gf, v_gc;
  end if;
  select pj, v, e, d, gf, gc into v_pj, v_v, v_e, v_d, v_gf, v_gc
    from public.club_estadisticas(v_cB);
  if v_pj <> 3 or v_v <> 0 or v_e <> 1 or v_d <> 2 or v_gf <> 3 or v_gc <> 7 then
    raise exception 'FALLÓ (caso 12): B debería ser 3 PJ 0-1-2 3:7, fue % PJ %-%-% %:%',
      v_pj, v_v, v_e, v_d, v_gf, v_gc;
  end if;
  insert into t49 values (12, 'estadísticas reales',
    'A 3 PJ 2-1-0 7:3 y B 3 PJ 0-1-2 3:7 — el 9-0 propuesto y el 8-0 rechazado no cuentan');

  -- ══ CASO 13: el club sin partidos da ceros, no nulos ══════════
  select pj, v, e, d, gf, gc into v_pj, v_v, v_e, v_d, v_gf, v_gc
    from public.club_estadisticas(v_cC);
  if v_pj is null or v_gf is null or v_gc is null then
    raise exception 'FALLÓ (caso 13): el club sin partidos devolvió nulos (% % %)', v_pj, v_gf, v_gc;
  end if;
  if v_pj <> 0 or v_v <> 0 or v_e <> 0 or v_d <> 0 or v_gf <> 0 or v_gc <> 0 then
    raise exception 'FALLÓ (caso 13): el club sin partidos no dio ceros: % %-%-% %:%',
      v_pj, v_v, v_e, v_d, v_gf, v_gc;
  end if;
  insert into t49 values (13, 'estadísticas en cero',
    'C, con su único resultado sin confirmar, devuelve una fila de ceros: ni nulos ni ninguna fila');
end;
$$;

select n, caso, detalle from t49 order by n;

rollback;
