-- =============================================================
-- FutFinder — pruebas de aprobación y publicación (migración 44)
--
-- Qué cubre:
--   1. El club PROPONENTE no puede aprobar su propia propuesta.
--   2. Un integrante sin rol de administrador del club rival tampoco.
--   3. Un tercero ajeno a los dos clubes tampoco.
--   4. Quien administra el club rival PERO pertenece también al club
--      proponente tampoco: nadie se aprueba a sí mismo en nombre del
--      rival.
--   5. El administrador del club contrario sí: se crea UN partido con
--      cupos_totales = 2 × cupos_por_club, el desafío queda
--      'publicado' con su match_id, se registra el evento y se avisa a
--      TODOS los integrantes de los dos clubes (no sólo a los
--      administradores).
--   6. El organizador NO queda autoinscrito en un partido de clubes:
--      eso le gastaría un cupo a su club sin pedirlo.
--   7. IDEMPOTENCIA: aprobar de nuevo —con el otro administrador y con
--      el mismo— devuelve EL MISMO partido y no crea un segundo
--      partido, ni un segundo evento, ni un segundo aviso.
--   8. El índice único de `challenge_proposal_id` rechaza un segundo
--      partido para la misma propuesta.
--   9. Una propuesta sin coordenadas no publica, y lo dice. (9b) Unas
--      coordenadas fuera del rango de la Tierra tampoco.
--  10. Una propuesta cuya fecha ya pasó no publica, y lo dice.
--  11. PERMISOS: `aprobar_propuesta` no la puede ejecutar `public` ni
--      `anon`, sí `authenticated`; `club_esta_sancionado` no la puede
--      ejecutar ninguno de los tres roles del cliente. (`service_role`
--      conserva el suyo: es la llave de servidor y no viaja al cliente.)
--  12. COMPATIBILIDAD: en un partido normal el organizador sigue
--      quedando inscrito solo, como siempre.
--
-- Requisito: las migraciones 42, 43, 43b, 43c, 43d y 44 tienen que estar
-- aplicadas.
--
-- EL TIEMPO NO SE CONGELA: para provocar una propuesta vencida se
-- mueve la fecha de la fila hacia atrás, nunca el reloj. Así lo que se
-- prueba es la comparación contra `now()` que hace el servidor.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run. Todo corre dentro de una transacción que termina en
-- ROLLBACK, así que no queda nada guardado. Si algún caso falla, la
-- ejecución se corta con RAISE EXCEPTION indicando cuál.
--
-- A DIFERENCIA de las pruebas 42 y 43, ésta va dejando cada caso en una
-- tabla temporal y la devuelve al final, además de los RAISE NOTICE.
-- Los `notice` se pierden según por dónde se corra la prueba; la tabla
-- se ve siempre, y lo que se busca acá es justamente poder mostrar el
-- resultado completo.
-- =============================================================

begin;

create temp table t44_resultado (
  n       integer,
  caso    text,
  detalle text
) on commit drop;

do $$
declare
  -- Club P (proponente / retador) y club R (rival / retado).
  v_p1 uuid := gen_random_uuid();   -- admin de P
  v_p2 uuid := gen_random_uuid();   -- admin de P
  v_pj uuid := gen_random_uuid();   -- jugador de P
  v_r1 uuid := gen_random_uuid();   -- admin de R
  v_r2 uuid := gen_random_uuid();   -- admin de R
  v_rj uuid := gen_random_uuid();   -- jugador de R
  v_d  uuid := gen_random_uuid();   -- admin de R y, después, jugador de P
  v_x  uuid := gen_random_uuid();   -- ajeno a todo

  -- Clubes S/T (propuesta sin coordenadas) y U/V (fecha pasada).
  v_s1 uuid := gen_random_uuid();
  v_t1 uuid := gen_random_uuid();
  v_u1 uuid := gen_random_uuid();
  v_v1 uuid := gen_random_uuid();

  v_club_p uuid;
  v_club_r uuid;
  v_club_s uuid;
  v_club_t uuid;
  v_club_u uuid;
  v_club_v uuid;

  v_ch     uuid;
  v_ch_s   uuid;
  v_ch_u   uuid;
  v_prop   public.club_challenge_proposals;
  v_prop_s public.club_challenge_proposals;
  v_prop_u public.club_challenge_proposals;

  v_match  public.matches;
  v_match2 public.matches;
  v_match3 public.matches;

  v_count  int;
  v_estado text;
  v_mid    uuid;
  v_ok     boolean;
  v_err    text;
  v_normal uuid;

  v_payload jsonb;
begin
  -- ── Setup: usuarios ──────────────────────────────────────────
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
         'partido-clubes-' || u.tag || '-' || u.id || '@futfinder.test', 'x', now(), now(), now(),
         '{}', '{}', '', '', '', ''
  from (values
    (v_p1, 'p1'), (v_p2, 'p2'), (v_pj, 'pj'),
    (v_r1, 'r1'), (v_r2, 'r2'), (v_rj, 'rj'),
    (v_d, 'd'), (v_x, 'x'),
    (v_s1, 's1'), (v_t1, 't1'), (v_u1, 'u1'), (v_v1, 'v1')
  ) as u(id, tag);

  -- Plan premium: el plan estándar sólo admite 1 administrador y acá
  -- hacen falta varios por club para probar que la aprobación es del
  -- CLUB y no de una persona concreta.
  insert into public.clubs (nombre, slug, created_by, plan)
  values ('Club Publica P', 'club-publica-p', v_p1, 'premium') returning id into v_club_p;
  insert into public.clubs (nombre, slug, created_by, plan)
  values ('Club Publica R', 'club-publica-r', v_r1, 'premium') returning id into v_club_r;
  insert into public.clubs (nombre, slug, created_by, plan)
  values ('Club Publica S', 'club-publica-s', v_s1, 'premium') returning id into v_club_s;
  insert into public.clubs (nombre, slug, created_by, plan)
  values ('Club Publica T', 'club-publica-t', v_t1, 'premium') returning id into v_club_t;
  insert into public.clubs (nombre, slug, created_by, plan)
  values ('Club Publica U', 'club-publica-u', v_u1, 'premium') returning id into v_club_u;
  insert into public.clubs (nombre, slug, created_by, plan)
  values ('Club Publica V', 'club-publica-v', v_v1, 'premium') returning id into v_club_v;

  insert into public.club_members (club_id, user_id, rol) values
    (v_club_p, v_p1, 'admin'), (v_club_p, v_p2, 'admin'), (v_club_p, v_pj, 'jugador'),
    (v_club_r, v_r1, 'admin'), (v_club_r, v_r2, 'admin'), (v_club_r, v_rj, 'jugador'),
    (v_club_r, v_d,  'admin'),
    (v_club_s, v_s1, 'admin'), (v_club_t, v_t1, 'admin'),
    (v_club_u, v_u1, 'admin'), (v_club_v, v_v1, 'admin');

  -- ── Setup: desafío P → R hasta 'esperando_aprobacion' ────────
  -- Se recorre el flujo real, no se fuerzan estados a mano.
  insert into public.club_challenges (club_retador_id, club_retado_id, creado_por, estado)
  values (v_club_p, v_club_r, v_p1, 'pendiente')
  returning id into v_ch;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_r1, 'role', 'authenticated')::text);
  perform public.aceptar_desafio(v_ch);
  execute 'reset role';

  v_payload := jsonb_build_object(
    'fecha',              (now() + interval '3 days')::text,
    'duracion_min',       90,
    'direccion',          'Av. Siempre Viva 742',
    'cancha_nombre',      'Complejo Las Ánimas',
    'comuna',             'Ñuñoa',
    'region',             'Metropolitana',
    'latitud',            -33.4569,
    'longitud',           -70.6483,
    'modalidad',          'futbol7',
    'cupos_por_club',     7,
    'metodo_inscripcion', 'orden_llegada',
    'cuota_por_persona',  4000,
    'instrucciones',      'Lleguen 15 minutos antes.'
  );

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_p1, 'role', 'authenticated')::text);
  v_prop := public.crear_propuesta_oficial(v_ch, v_payload, gen_random_uuid());
  execute 'reset role';

  select estado into v_estado from public.club_challenges where id = v_ch;
  if v_estado <> 'esperando_aprobacion' then
    raise exception 'SETUP: el desafío debería estar en esperando_aprobacion y está %', v_estado;
  end if;

  -- Ahora D entra también al club proponente. Se hace DESPUÉS de crear
  -- el desafío a propósito: el trigger `club_challenges_valida_rival`
  -- impide crearlo cuando los clubes ya comparten administrador, y lo
  -- que se prueba acá es que la RPC vuelve a comprobarlo en el momento
  -- de aprobar, porque las membresías cambian.
  insert into public.club_members (club_id, user_id, rol)
  values (v_club_p, v_d, 'jugador');

  -- ══ CASO 1: el club proponente no aprueba lo suyo ════════════
  v_ok := false;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L',
      json_build_object('sub', v_p1, 'role', 'authenticated')::text);
    perform public.aprobar_propuesta(v_prop.id);
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_err := sqlerrm; v_ok := true;
  end;
  if not v_ok then
    raise exception 'FALLÓ (caso 1): el administrador del club proponente pudo aprobar su propia propuesta';
  end if;
  if v_err not like '%administrador del club contrario%' then
    raise exception 'FALLÓ (caso 1): el motivo debería hablar del club contrario y dice "%"', v_err;
  end if;
  insert into t44_resultado values (1, 'caso 1', format('el club proponente no puede aprobar — %s', v_err));
  raise notice 'OK (caso 1): el club proponente no puede aprobar — %', v_err;

  -- ══ CASO 2: integrante sin rol de administrador ══════════════
  v_ok := false;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L',
      json_build_object('sub', v_rj, 'role', 'authenticated')::text);
    perform public.aprobar_propuesta(v_prop.id);
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_err := sqlerrm; v_ok := true;
  end;
  if not v_ok then
    raise exception 'FALLÓ (caso 2): un jugador sin rol de administrador pudo aprobar';
  end if;
  insert into t44_resultado values (2, 'caso 2', 'un integrante sin rol de administrador no puede aprobar');
  raise notice 'OK (caso 2): un integrante sin rol de administrador no puede aprobar';

  -- ══ CASO 3: ajeno a los dos clubes ═══════════════════════════
  v_ok := false;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L',
      json_build_object('sub', v_x, 'role', 'authenticated')::text);
    perform public.aprobar_propuesta(v_prop.id);
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_err := sqlerrm; v_ok := true;
  end;
  if not v_ok then
    raise exception 'FALLÓ (caso 3): un tercero ajeno pudo aprobar';
  end if;
  insert into t44_resultado values (3, 'caso 3', 'un tercero ajeno no puede aprobar');
  raise notice 'OK (caso 3): un tercero ajeno no puede aprobar';

  -- ══ CASO 4: administrador del rival que además está en el
  --            club proponente ════════════════════════════════
  v_ok := false;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L',
      json_build_object('sub', v_d, 'role', 'authenticated')::text);
    perform public.aprobar_propuesta(v_prop.id);
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_err := sqlerrm; v_ok := true;
  end;
  if not v_ok then
    raise exception 'FALLÓ (caso 4): quien pertenece a los dos clubes pudo aprobar en nombre del rival';
  end if;
  if v_err not like '%club al que perteneces%' then
    raise exception 'FALLÓ (caso 4): el motivo debería ser la doble pertenencia y dice "%"', v_err;
  end if;
  insert into t44_resultado values (4, 'caso 4', format('quien está en los dos clubes no aprueba — %s', v_err));
  raise notice 'OK (caso 4): quien está en los dos clubes no aprueba — %', v_err;

  -- Nada de lo anterior debe haber publicado nada.
  select count(*) into v_count from public.matches where challenge_proposal_id = v_prop.id;
  if v_count <> 0 then
    raise exception 'FALLÓ (casos 1-4): un rechazo dejó % partido(s) creado(s)', v_count;
  end if;
  select estado into v_estado from public.club_challenges where id = v_ch;
  if v_estado <> 'esperando_aprobacion' then
    raise exception 'FALLÓ (casos 1-4): un rechazo movió el desafío a %', v_estado;
  end if;

  -- ══ CASO 5: el administrador del club contrario aprueba ══════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_r1, 'role', 'authenticated')::text);
  v_match := public.aprobar_propuesta(v_prop.id);
  execute 'reset role';

  if v_match.id is null then
    raise exception 'FALLÓ (caso 5): aprobar no devolvió partido';
  end if;
  if v_match.cupos_por_club <> 7 then
    raise exception 'FALLÓ (caso 5): cupos_por_club debería ser 7 y es %', v_match.cupos_por_club;
  end if;
  if v_match.cupos_totales <> 14 then
    raise exception 'FALLÓ (caso 5): cupos_totales debería ser 14 (2 × 7) y es %', v_match.cupos_totales;
  end if;
  if v_match.cupos_disponibles <> 14 then
    raise exception 'FALLÓ (caso 5): cupos_disponibles debería ser 14 y es %', v_match.cupos_disponibles;
  end if;
  if v_match.aprobacion <> 'inmediata' then
    raise exception 'FALLÓ (caso 5): orden_llegada debería dar aprobacion=inmediata y dio %', v_match.aprobacion;
  end if;
  if v_match.club_local_id <> v_club_p or v_match.club_visitante_id <> v_club_r then
    raise exception 'FALLÓ (caso 5): el retador debería ser local y el retado visitante';
  end if;
  if v_match.challenge_id <> v_ch or v_match.challenge_proposal_id <> v_prop.id then
    raise exception 'FALLÓ (caso 5): el partido no quedó atado al desafío y a la propuesta';
  end if;
  if v_match.precio_cuota <> 4000 or v_match.modalidad <> 'futbol7' then
    raise exception 'FALLÓ (caso 5): la cuota o la modalidad no vinieron de la propuesta';
  end if;

  select estado, match_id into v_estado, v_mid from public.club_challenges where id = v_ch;
  if v_estado <> 'publicado' then
    raise exception 'FALLÓ (caso 5): el desafío debería estar publicado y está %', v_estado;
  end if;
  if v_mid <> v_match.id then
    raise exception 'FALLÓ (caso 5): el desafío no apunta al partido publicado';
  end if;

  select estado into v_estado from public.club_challenge_proposals where id = v_prop.id;
  if v_estado <> 'aprobada' then
    raise exception 'FALLÓ (caso 5): la propuesta debería estar aprobada y está %', v_estado;
  end if;

  select count(*) into v_count
  from public.club_challenge_events where challenge_id = v_ch and tipo = 'partido_publicado';
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 5): debería haber 1 evento partido_publicado y hay %', v_count;
  end if;

  -- TODOS los integrantes de los dos clubes: p1, p2, pj, r1, r2, rj y
  -- d (que está en ambos, y recibe UN aviso, no dos).
  select count(*) into v_count
  from public.notifications
  where type = 'club_match_published' and (data ->> 'matchId')::uuid = v_match.id;
  if v_count <> 7 then
    raise exception 'FALLÓ (caso 5): debería haber 7 avisos de publicación y hay %', v_count;
  end if;

  select count(*) into v_count
  from public.notifications
  where type = 'club_match_published'
    and (data ->> 'matchId')::uuid = v_match.id
    and user_id in (v_pj, v_rj);
  if v_count <> 2 then
    raise exception 'FALLÓ (caso 5): los jugadores sin rol también tienen que recibir el aviso';
  end if;

  select count(*) into v_count
  from public.notifications
  where type = 'club_match_published'
    and (data ->> 'matchId')::uuid = v_match.id
    and user_id = v_x;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 5): un ajeno no debería recibir el aviso';
  end if;
  insert into t44_resultado values (5, 'caso 5', 'el rival aprobó, se publicó 1 partido de 14 cupos y se avisó a los 7 integrantes');
  raise notice 'OK (caso 5): el rival aprobó, se publicó 1 partido de 14 cupos y se avisó a los 7 integrantes';

  -- ══ CASO 6: el organizador NO queda autoinscrito ═════════════
  select count(*) into v_count from public.attendees where id_partido = v_match.id;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 6): el partido de clubes nace con % inscrito(s) y debería nacer vacío', v_count;
  end if;
  insert into t44_resultado values (6, 'caso 6', 'el administrador que aprobó no se autoinscribió');
  raise notice 'OK (caso 6): el administrador que aprobó no se autoinscribió';

  -- ══ CASO 7: idempotencia ═════════════════════════════════════
  -- El otro administrador del mismo club vuelve a aprobar.
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_r2, 'role', 'authenticated')::text);
  v_match2 := public.aprobar_propuesta(v_prop.id);
  execute 'reset role';

  -- Y el mismo de antes, otra vez (doble pulsación).
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_r1, 'role', 'authenticated')::text);
  v_match3 := public.aprobar_propuesta(v_prop.id);
  execute 'reset role';

  if v_match2.id <> v_match.id or v_match3.id <> v_match.id then
    raise exception 'FALLÓ (caso 7): reaprobar devolvió un partido distinto';
  end if;

  select count(*) into v_count from public.matches where challenge_proposal_id = v_prop.id;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 7): hay % partidos para la misma propuesta', v_count;
  end if;

  select count(*) into v_count from public.matches where challenge_id = v_ch;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 7): hay % partidos para el mismo desafío', v_count;
  end if;

  select count(*) into v_count
  from public.club_challenge_events where challenge_id = v_ch and tipo = 'partido_publicado';
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 7): reaprobar dejó % eventos de publicación', v_count;
  end if;

  select count(*) into v_count
  from public.notifications
  where type = 'club_match_published' and (data ->> 'matchId')::uuid = v_match.id;
  if v_count <> 7 then
    raise exception 'FALLÓ (caso 7): reaprobar dejó % avisos en vez de 7', v_count;
  end if;
  insert into t44_resultado values (7, 'caso 7', 'tres aprobaciones = 1 partido, 1 evento, 7 avisos');
  raise notice 'OK (caso 7): tres aprobaciones = 1 partido, 1 evento, 7 avisos';

  -- ══ CASO 8: el índice único rechaza el partido duplicado ═════
  v_ok := false;
  begin
    insert into public.matches (
      id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, challenge_proposal_id
    ) values (
      v_r1, 'Duplicado a mano', 'Ñuñoa', 'Complejo Las Ánimas', -33.4569, -70.6483,
      now() + interval '3 days', 14, 14, v_prop.id
    );
  exception when unique_violation then
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'FALLÓ (caso 8): se pudo crear un segundo partido para la misma propuesta';
  end if;
  insert into t44_resultado values (8, 'caso 8', 'challenge_proposal_id es único, el duplicado se rechaza en la base');
  raise notice 'OK (caso 8): challenge_proposal_id es único, el duplicado se rechaza en la base';

  -- ══ CASO 9: propuesta sin coordenadas ════════════════════════
  insert into public.club_challenges (club_retador_id, club_retado_id, creado_por, estado)
  values (v_club_s, v_club_t, v_s1, 'pendiente')
  returning id into v_ch_s;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_t1, 'role', 'authenticated')::text);
  perform public.aceptar_desafio(v_ch_s);
  execute 'reset role';

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_s1, 'role', 'authenticated')::text);
  v_prop_s := public.crear_propuesta_oficial(
    v_ch_s,
    v_payload || jsonb_build_object('fecha', (now() + interval '4 days')::text),
    gen_random_uuid()
  );
  execute 'reset role';

  -- Desde la 43c la RPC ya no deja crear una propuesta sin coordenadas, así
  -- que la fila se vacía a mano para simular una anterior a esa migración.
  -- Lo que se prueba acá es que `aprobar_propuesta` NO confía en que otra
  -- función haya validado antes.
  update public.club_challenge_proposals
     set latitud = null, longitud = null
   where id = v_prop_s.id;

  v_ok := false;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L',
      json_build_object('sub', v_t1, 'role', 'authenticated')::text);
    perform public.aprobar_propuesta(v_prop_s.id);
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_err := sqlerrm; v_ok := true;
  end;
  if not v_ok then
    raise exception 'FALLÓ (caso 9): se publicó un partido sin coordenadas';
  end if;
  if v_err not like '%mapa%' then
    raise exception 'FALLÓ (caso 9): el motivo debería hablar del mapa y dice "%"', v_err;
  end if;
  select count(*) into v_count from public.matches where challenge_proposal_id = v_prop_s.id;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 9): quedó un partido a medio crear';
  end if;
  insert into t44_resultado values (9, 'caso 9', format('sin coordenadas no se publica — %s', v_err));
  raise notice 'OK (caso 9): sin coordenadas no se publica — %', v_err;

  -- ══ CASO 9b: coordenadas fuera del rango de la Tierra ════════
  -- No basta con «no es nula»: el cliente llegó a enviar 0 y 0 cuando no
  -- había ubicación, porque `Number(null)` es 0 en JavaScript. Ese cliente
  -- ya está corregido, pero el servidor no depende de ello.
  update public.club_challenge_proposals
     set latitud = 91, longitud = -70.6483
   where id = v_prop_s.id;

  v_ok := false;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L',
      json_build_object('sub', v_t1, 'role', 'authenticated')::text);
    perform public.aprobar_propuesta(v_prop_s.id);
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_err := sqlerrm; v_ok := true;
  end;
  if not v_ok then
    raise exception 'FALLÓ (caso 9b): se publicó un partido con latitud 91';
  end if;
  if v_err not like '%punto válido%' then
    raise exception 'FALLÓ (caso 9b): el motivo debería ser el punto del mapa y dice "%"', v_err;
  end if;
  select count(*) into v_count from public.matches where challenge_proposal_id = v_prop_s.id;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 9b): quedó un partido a medio crear';
  end if;
  insert into t44_resultado values (91, 'caso 9b', format('coordenadas fuera de rango no se publican — %s', v_err));
  raise notice 'OK (caso 9b): coordenadas fuera de rango no se publican — %', v_err;

  -- ══ CASO 10: propuesta con fecha ya pasada ═══════════════════
  insert into public.club_challenges (club_retador_id, club_retado_id, creado_por, estado)
  values (v_club_u, v_club_v, v_u1, 'pendiente')
  returning id into v_ch_u;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_v1, 'role', 'authenticated')::text);
  perform public.aceptar_desafio(v_ch_u);
  execute 'reset role';

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_u1, 'role', 'authenticated')::text);
  v_prop_u := public.crear_propuesta_oficial(v_ch_u, v_payload, gen_random_uuid());
  execute 'reset role';

  -- Se envejece la fila, no el reloj.
  update public.club_challenge_proposals
     set fecha = now() - interval '1 hour'
   where id = v_prop_u.id;

  v_ok := false;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L',
      json_build_object('sub', v_v1, 'role', 'authenticated')::text);
    perform public.aprobar_propuesta(v_prop_u.id);
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_err := sqlerrm; v_ok := true;
  end;
  if not v_ok then
    raise exception 'FALLÓ (caso 10): se publicó un partido con la fecha ya pasada';
  end if;
  if v_err not like '%ya pasó%' then
    raise exception 'FALLÓ (caso 10): el motivo debería ser la fecha y dice "%"', v_err;
  end if;
  insert into t44_resultado values (10, 'caso 10', format('la fecha pasada no se publica — %s', v_err));
  raise notice 'OK (caso 10): la fecha pasada no se publica — %', v_err;

  -- ══ CASO 11: permisos de ejecución ═══════════════════════════
  if has_function_privilege('public', 'public.aprobar_propuesta(uuid)', 'EXECUTE') then
    raise exception 'FALLÓ (caso 11): PUBLIC puede ejecutar aprobar_propuesta';
  end if;
  if has_function_privilege('anon', 'public.aprobar_propuesta(uuid)', 'EXECUTE') then
    raise exception 'FALLÓ (caso 11): anon puede ejecutar aprobar_propuesta';
  end if;
  if not has_function_privilege('authenticated', 'public.aprobar_propuesta(uuid)', 'EXECUTE') then
    raise exception 'FALLÓ (caso 11): authenticated NO puede ejecutar aprobar_propuesta';
  end if;
  if has_function_privilege('public', 'public.club_esta_sancionado(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.club_esta_sancionado(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.club_esta_sancionado(uuid)', 'EXECUTE') then
    raise exception 'FALLÓ (caso 11): el marcador club_esta_sancionado quedó expuesto a algún rol';
  end if;
  insert into t44_resultado values (11, 'caso 11', 'aprobar_propuesta: public=NO, anon=NO, authenticated=SÍ; club_esta_sancionado: ninguno de los tres roles del cliente');
  raise notice 'OK (caso 11): aprobar_propuesta sólo para authenticated; el marcador de sanciones, para ninguno de los tres roles del cliente';

  -- ══ CASO 12: el partido normal no cambia ═════════════════════
  insert into public.matches (
    id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
    hora, cupos_totales, cupos_disponibles
  ) values (
    v_x, 'Pichanga de siempre', 'Providencia', 'Cancha del barrio', -33.42, -70.61,
    now() + interval '2 days', 10, 10
  ) returning id into v_normal;

  select count(*) into v_count
  from public.attendees where id_partido = v_normal and id_jugador = v_x;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 12): el organizador de un partido normal debería quedar inscrito solo y hay % filas', v_count;
  end if;
  insert into t44_resultado values (12, 'caso 12', 'en un partido normal el organizador sigue quedando inscrito solo');
  raise notice 'OK (caso 12): en un partido normal el organizador sigue quedando inscrito solo';

  raise notice '════════ LOS 13 CASOS PASARON ════════';
end;
$$;

-- El resultado completo, caso por caso.
select n, caso, detalle from t44_resultado order by n;

rollback;
