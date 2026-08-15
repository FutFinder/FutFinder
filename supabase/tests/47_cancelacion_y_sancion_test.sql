-- =============================================================
-- FutFinder — pruebas de la cancelación del encuentro y de la
-- sanción del club (migración 47).
--
-- QUÉ SE PRUEBA. Un administrador puede cancelar un encuentro
-- publicado sin permiso del rival, pero tiene que decir por qué, y si lo
-- hace con el partido encima su CLUB queda 14 días sin poder abrir
-- desafíos nuevos.
--
-- LAS CINCO REGLAS Y DÓNDE SE COMPRUEBAN:
--
--   · El motivo es obligatorio: vacío, en blanco o de más de 300
--     caracteres se rechaza y no queda ninguna fila (casos 1, 2 y 3).
--   · Cancela un administrador de uno de los dos clubes; quien
--     administra los dos, no (casos 4 y 5).
--   · A 3 h del encuentro NO hay sanción; a 1 h SÍ, y dura 14 días
--     (casos 7 y 12).
--   · EL TRUST SCORE NO SE MUEVE. Se mide antes y después, sobre el
--     jugador inscrito y sobre el administrador que cancela (casos 10 y
--     14). Es la diferencia con `cancel_match()`, que sí penaliza al
--     organizador: acá la sanción es del club.
--   · El club sancionado no crea, no acepta y no propone desafíos
--     nuevos (casos 16, 17 y 18), pero CONSERVA el partido que ya tenía
--     publicado (caso 19, decisión C3 del plan).
--
-- Requisito: migraciones 41 a 46 aplicadas, y la 47 aplicada o corrida
-- dentro de la misma transacción que este arnés.
--
-- NOTA SOBRE LA CONCURRENCIA. Este arnés corre en UNA sola sesión, así
-- que no puede lanzar dos transacciones en paralelo: lo que prueba es el
-- invariante —cancelar dos veces no abre una segunda sanción—, no la
-- carrera real. Lo que la cubre es el `update ... where estado in
-- (...)` sobre el partido, que es lo que serializa: el segundo no mueve
-- ninguna fila. Una prueba de carrera de verdad necesita dos sesiones y
-- un arnés aparte, como el que se hizo para U3.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor.
-- Todo corre en una transacción que termina en ROLLBACK. Usa el partido
-- de clubes que ya exista en la base y lo devuelve intacto. Los clubes,
-- usuarios, desafíos y partidos que CREA desaparecen con el `rollback`.
-- =============================================================

begin;

create temp table t47 (n integer, caso text, detalle text) on commit drop;

do $$
declare
  v_m        uuid;                      -- el partido de clubes que se cancela
  v_ch       uuid;                      -- su desafío
  v_cA       uuid;                      -- club que cancela (y que se sanciona)
  v_cB       uuid;                      -- club rival
  v_adminA   uuid;                      -- administrador del club que cancela
  v_adminA2  uuid := gen_random_uuid(); -- segundo administrador del mismo club
  v_adminB   uuid;                      -- administrador del club rival
  v_ambos    uuid := gen_random_uuid(); -- administra los DOS clubes
  v_inscrito uuid := gen_random_uuid(); -- jugador inscrito: recibe el aviso
  v_ajeno    uuid := gen_random_uuid(); -- no pertenece a ninguno de los dos

  v_cC       uuid := gen_random_uuid(); -- club del partido que NO se cancela
  v_cD       uuid := gen_random_uuid(); -- club que desafía al sancionado
  v_cE       uuid := gen_random_uuid(); -- club que negocia con el sancionado
  v_adminC   uuid := gen_random_uuid();
  v_adminD   uuid := gen_random_uuid();
  v_adminE   uuid := gen_random_uuid();

  v_ch2      uuid := gen_random_uuid(); -- A vs C, publicado (el que sobrevive)
  v_prop2    uuid := gen_random_uuid();
  v_m2       uuid := gen_random_uuid();
  v_ch3      uuid := gen_random_uuid(); -- D → A, pendiente (aceptar)
  v_ch4      uuid := gen_random_uuid(); -- A vs E, negociación (proponer)

  v_hora0    timestamptz;
  v_j        json;
  v_count    int;
  v_estado   text;
  v_texto    text;
  v_trust    int;
  v_trust2   int;
  v_sancion  public.club_sanctions;
  v_payload  jsonb;
  v_dias     int := (public.desafio_reglas() ->> 'sancion_dias')::int;
  v_horas    int := (public.desafio_reglas() ->> 'cancelacion_sancion_horas')::int;
  v_err      text;
begin
  -- ── el partido con el que se trabaja ──────────────────────────
  select m.id, m.challenge_id, m.club_local_id, m.club_visitante_id
    into v_m, v_ch, v_cA, v_cB
    from public.matches m
    join public.club_challenges c on c.id = m.challenge_id
   where m.challenge_proposal_id is not null
   order by m.created_at desc
   limit 1;
  if v_m is null then
    raise exception 'No hay ningún partido de clubes en la base contra el que probar';
  end if;

  select user_id into v_adminA from public.club_members where club_id = v_cA and rol = 'admin' limit 1;
  select user_id into v_adminB from public.club_members where club_id = v_cB and rol = 'admin' limit 1;
  if v_adminA is null or v_adminB is null then
    raise exception 'Alguno de los dos clubes no tiene administrador: este arnés no puede probar la autorización';
  end if;
  if exists (select 1 from public.club_members where user_id = v_adminB and club_id = v_cA)
     or exists (select 1 from public.club_members where user_id = v_adminA and club_id = v_cB) then
    raise exception 'Los administradores de los dos clubes comparten membresía: este arnés necesita clubes separados';
  end if;

  -- Estado de partida conocido, siempre dentro de la transacción.
  v_hora0 := date_trunc('hour', now()) + interval '5 days';
  update public.matches set estado = 'abierto', hora = v_hora0, motivo_cancelacion = null
   where id = v_m;
  update public.club_challenges set estado = 'publicado', motivo_cierre = null where id = v_ch;
  delete from public.club_sanctions where club_id in (v_cA, v_cB);
  -- La bitácora del encuentro también entra al estado de partida. El arnés
  -- toma un partido REAL —el último de clubes que exista— y cuenta cuántas
  -- cancelaciones deja (caso 15): si ese encuentro ya se canceló alguna vez
  -- de verdad, la cuenta arranca en uno y el caso falla sin que nada del
  -- código haya cambiado. Pasó con el partido que dejó la comprobación
  -- manual de la U5.1. Se borra dentro de la transacción, que termina en
  -- ROLLBACK: la bitácora real queda intacta.
  delete from public.club_challenge_events
   where challenge_id = v_ch
     and tipo in ('encuentro_cancelado', 'sancion_aplicada');

  -- ── gente de prueba ───────────────────────────────────────────
  insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,email_change,
    email_change_token_new,recovery_token)
  select '00000000-0000-0000-0000-000000000000',u,'authenticated','authenticated',
    'u47-'||u||'@futfinder.test','x',now(),now(),now(),'{}','{}','','','',''
  from unnest(array[v_adminA2, v_ambos, v_inscrito, v_ajeno,
                    v_adminC, v_adminD, v_adminE]) u;

  -- El plan estándar admite un solo administrador: los dos clubes reales
  -- suben a premium DENTRO de la transacción para que el arnés no falle
  -- por el tope del plan.
  update public.clubs set plan = 'premium' where id in (v_cA, v_cB);
  insert into public.club_members (club_id, user_id, rol) values (v_cA, v_adminA2, 'admin');
  insert into public.club_members (club_id, user_id, rol) values (v_cA, v_ambos, 'admin');
  insert into public.club_members (club_id, user_id, rol) values (v_cB, v_ambos, 'admin');
  insert into public.club_members (club_id, user_id, rol) values (v_cA, v_inscrito, 'jugador');

  insert into public.attendees (id_partido, id_jugador, estado, club_id, origen)
  values (v_m, v_inscrito, 'inscrito', v_cA, 'orden_llegada');

  -- ── tres clubes más, para las cuatro puertas de la sanción ────
  -- Se crean ANTES de sancionar: con la sanción encima, el propio trigger
  -- de la 47 impediría crear el desafío, y entonces el arnés no podría
  -- comprobar que impide aceptarlo y proponerlo.
  insert into public.clubs (id, nombre, slug, plan, created_by)
  values (v_cC, 'Club C 47', 'club-c-47-'||left(v_cC::text,8), 'premium', v_adminC),
         (v_cD, 'Club D 47', 'club-d-47-'||left(v_cD::text,8), 'premium', v_adminD),
         (v_cE, 'Club E 47', 'club-e-47-'||left(v_cE::text,8), 'premium', v_adminE);
  insert into public.club_members (club_id, user_id, rol)
  values (v_cC, v_adminC, 'admin'), (v_cD, v_adminD, 'admin'), (v_cE, v_adminE, 'admin');

  -- El OTRO partido del club A, ya publicado. Es el que la decisión C3
  -- dice que no se toca.
  insert into public.club_challenges (id, club_retador_id, club_retado_id, creado_por, estado)
  values (v_ch2, v_cA, v_cC, v_adminA, 'publicado');
  insert into public.club_challenge_proposals (
      id, challenge_id, club_proponente_id, creada_por, fecha, duracion_min,
      direccion, cancha_nombre, comuna, region, latitud, longitud,
      modalidad, cupos_por_club, metodo_inscripcion, cuota_por_persona, estado)
  values (v_prop2, v_ch2, v_cA, v_adminA, now() + interval '9 days', 90,
      'Av. Siempre Viva 100', 'Cancha Dos', 'Ñuñoa', 'Región Metropolitana de Santiago',
      -33.45, -70.60, 'futbol7', 7, 'orden_llegada', 0, 'aprobada');
  insert into public.matches (
      id, id_organizador, titulo, comuna, region, cancha_nombre, latitud, longitud,
      hora, duracion_min, cupos_totales, cupos_disponibles, estado,
      challenge_proposal_id, challenge_id, club_local_id, club_visitante_id,
      cupos_por_club, metodo_inscripcion, ubicacion_aproximada)
  values (v_m2, v_adminA, 'Club A vs Club C', 'Ñuñoa', 'Región Metropolitana de Santiago',
      'Cancha Dos', -33.45, -70.60, now() + interval '9 days', 90, 14, 14, 'abierto',
      v_prop2, v_ch2, v_cA, v_cC, 7, 'orden_llegada', true);
  update public.club_challenges set match_id = v_m2 where id = v_ch2;

  -- Un desafío pendiente que el club A tendría que poder aceptar…
  insert into public.club_challenges (id, club_retador_id, club_retado_id, creado_por, estado)
  values (v_ch3, v_cD, v_cA, v_adminD, 'pendiente');
  -- …y uno en negociación en el que tendría que poder proponer.
  insert into public.club_challenges (id, club_retador_id, club_retado_id, creado_por,
      estado, negociacion_vence_at)
  values (v_ch4, v_cA, v_cE, v_adminA, 'negociacion', now() + interval '3 days');

  delete from public.notifications where data ->> 'matchId' in (v_m::text, v_m2::text);
  delete from public.notifications where data ->> 'challengeId' = v_ch::text;

  -- ══ CASO 1: sin motivo no se cancela ═════════════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.cancelar_encuentro_club(v_ch, null::text);
  execute 'reset role';
  if (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 1): se canceló un encuentro sin motivo';
  end if;
  if (select estado from public.matches where id = v_m) <> 'abierto' then
    raise exception 'FALLÓ (caso 1): el partido cambió de estado pese al rechazo';
  end if;
  insert into t47 values (1,'motivo obligatorio',
    format('un motivo nulo no cancela nada — «%s»', v_j->>'reason'));

  -- ══ CASO 2: tres espacios tampoco son un motivo ══════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.cancelar_encuentro_club(v_ch, '   ');
  execute 'reset role';
  if (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 2): tres espacios pasaron como motivo';
  end if;
  insert into t47 values (2,'motivo en blanco','«   » se rechaza igual que el motivo ausente');

  -- ══ CASO 3: un motivo larguísimo se rechaza, no se recorta ═══
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.cancelar_encuentro_club(v_ch, repeat('x', 301));
  execute 'reset role';
  if (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 3): se aceptó un motivo de 301 caracteres';
  end if;
  insert into t47 values (3,'motivo con tope',
    'un motivo de 301 caracteres se rechaza en vez de guardarse cortado a la mitad');

  -- ══ CASO 4: quien no es administrador no cancela ═════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_ajeno,'role','authenticated')::text);
  v_j := public.cancelar_encuentro_club(v_ch, 'me da lo mismo');
  execute 'reset role';
  if (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 4): un ajeno canceló el encuentro';
  end if;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_inscrito,'role','authenticated')::text);
  v_j := public.cancelar_encuentro_club(v_ch, 'no quiero jugar');
  execute 'reset role';
  if (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 4): un jugador sin rol canceló el encuentro de su club';
  end if;
  insert into t47 values (4,'solo administradores',
    'ni un ajeno ni un integrante sin rol pueden cancelar');

  -- ══ CASO 5: quien administra los DOS clubes no cancela ═══════
  -- La sanción recae sobre un club concreto y acá no hay forma de decidir
  -- cuál. Mismo conflicto de doble pertenencia que cierran la 43d y la 46.
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_ambos,'role','authenticated')::text);
  v_j := public.cancelar_encuentro_club(v_ch, 'cancelo por los dos');
  execute 'reset role';
  if (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 5): quien administra los dos clubes canceló en nombre de uno';
  end if;
  insert into t47 values (5,'doble pertenencia',
    format('administrar los dos clubes no da derecho a cancelar — «%s»', v_j->>'reason'));

  -- ══ CASO 6: un desafío sin partido publicado no entra acá ════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.cancelar_encuentro_club(v_ch4, 'todavía no hay nada que cancelar');
  execute 'reset role';
  if (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 6): se «canceló el encuentro» de un desafío sin partido';
  end if;
  insert into t47 values (6,'sin partido no hay encuentro',
    format('un desafío en negociación no se cancela por esta puerta — «%s»', v_j->>'reason'));

  -- ══ CASO 7: a 3 h del encuentro, cancelar NO sanciona ════════
  select trust_score into v_trust  from public.profiles where id = v_inscrito;
  select trust_score into v_trust2 from public.profiles where id = v_adminA;
  update public.matches set hora = now() + interval '3 hours' where id = v_m;
  delete from public.notifications where data ->> 'matchId' = v_m::text;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.cancelar_encuentro_club(v_ch, 'se nos inundó la cancha');
  execute 'reset role';
  if not (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 7): no se pudo cancelar a 3 h — %', v_j->>'reason';
  end if;
  if (v_j->>'sanciona')::boolean then
    raise exception 'FALLÓ (caso 7): cancelar con 3 h de anticipación sancionó al club';
  end if;
  select count(*) into v_count from public.club_sanctions where club_id = v_cA;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 7): quedaron % sanciones tras una cancelación con aviso', v_count;
  end if;
  insert into t47 values (7,'a 3 h no hay sanción',
    format('cancelar con más de %s horas de anticipación no deja ninguna fila en club_sanctions', v_horas));

  -- ══ CASO 8: el partido se conserva, no se borra ══════════════
  select estado, motivo_cancelacion into v_estado, v_texto from public.matches where id = v_m;
  if v_estado is null then
    raise exception 'FALLÓ (caso 8): el partido se borró en vez de quedar cancelado';
  end if;
  if v_estado <> 'cancelado' then
    raise exception 'FALLÓ (caso 8): el partido quedó en «%» y debería quedar cancelado', v_estado;
  end if;
  if v_texto <> 'se nos inundó la cancha' then
    raise exception 'FALLÓ (caso 8): el motivo no quedó registrado en el partido — «%»', v_texto;
  end if;
  if (select estado from public.club_challenges where id = v_ch) <> 'cancelado' then
    raise exception 'FALLÓ (caso 8): el desafío no quedó cancelado';
  end if;
  if (select motivo_cierre from public.club_challenges where id = v_ch) <> 'se nos inundó la cancha' then
    raise exception 'FALLÓ (caso 8): el motivo no quedó en el desafío';
  end if;
  -- La nómina sigue existiendo: el partido permanece en el historial de
  -- los jugadores, igual que con `cancel_match` desde la migración 34.
  select count(*) into v_count from public.attendees where id_partido = v_m;
  if v_count = 0 then
    raise exception 'FALLÓ (caso 8): se borraron los attendees del partido cancelado';
  end if;
  insert into t47 values (8,'conserva el historial',
    'el partido queda cancelado con su motivo, y su nómina y su desafío siguen existiendo');

  -- ══ CASO 9: avisos a administradores e inscritos ═════════════
  select count(*) into v_count from public.notifications
   where type = 'match_cancelled' and data ->> 'matchId' = v_m::text and user_id = v_inscrito;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 9): el jugador inscrito recibió % avisos de cancelación', v_count;
  end if;
  -- Los tres conteos van ACOTADOS AL PARTIDO DE ESTA PRUEBA. Contar por
  -- tipo a secas parecía más estricto y era justo lo contrario: `v_adminA`
  -- y `v_adminB` son personas REALES de la base —el arnés toma el último
  -- partido de clubes que exista— y cualquier `club_match_cancelled` que
  -- ya tuvieran de OTRO encuentro entraba en la cuenta. Pasó de verdad: la
  -- comprobación manual de la U5.1 dejó uno, y el caso 9 empezó a fallar
  -- sin que nada del código hubiera cambiado.
  select count(*) into v_count from public.notifications
   where type = 'club_match_cancelled' and user_id = v_adminB
     and data ->> 'matchId' = v_m::text;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 9): el administrador del club rival recibió % avisos', v_count;
  end if;
  select count(*) into v_count from public.notifications
   where type = 'club_match_cancelled' and user_id = v_adminA2
     and data ->> 'matchId' = v_m::text;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 9): el otro administrador del club que canceló recibió % avisos', v_count;
  end if;
  select count(*) into v_count from public.notifications
   where user_id = v_adminA and data ->> 'matchId' = v_m::text;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 9): se le avisó a quien canceló, que ya sabe lo que hizo';
  end if;
  select count(*) into v_count from public.notifications
   where data ->> 'matchId' = v_m::text and user_id = v_ajeno;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 9): se avisó a alguien que no es de ninguno de los dos clubes';
  end if;
  insert into t47 values (9,'avisos',
    'inscritos con match_cancelled, administradores de los dos clubes con club_match_cancelled, y a quien canceló no se le avisa');

  -- ══ CASO 10: el Trust Score no se movió ══════════════════════
  -- ÉSTA es la diferencia con `cancel_match()`, que descuenta puntos al
  -- organizador. La sanción de clubes es del club.
  if (select trust_score from public.profiles where id = v_inscrito) <> v_trust then
    raise exception 'FALLÓ (caso 10): cambió el Trust Score del jugador inscrito';
  end if;
  if (select trust_score from public.profiles where id = v_adminA) <> v_trust2 then
    raise exception 'FALLÓ (caso 10): cambió el Trust Score del administrador que canceló';
  end if;
  insert into t47 values (10,'el Trust Score no se toca',
    'ni el del jugador inscrito ni el del administrador que cancela');

  -- ══ CASO 11: el evento del hilo trae club, motivo y sanción ══
  select payload into v_payload from public.club_challenge_events
   where challenge_id = v_ch and tipo = 'encuentro_cancelado'
   order by created_at desc limit 1;
  if v_payload is null then
    raise exception 'FALLÓ (caso 11): no se registró el evento «encuentro_cancelado» en el hilo';
  end if;
  if (v_payload ->> 'club_cancela_id') <> v_cA::text
     or (v_payload ->> 'motivo') <> 'se nos inundó la cancha'
     or (v_payload ->> 'sanciona')::boolean <> false then
    raise exception 'FALLÓ (caso 11): el evento no dice quién canceló, por qué y si sancionó — %', v_payload;
  end if;
  if (v_payload ->> 'actor_id') <> v_adminA::text then
    raise exception 'FALLÓ (caso 11): el evento no registra al administrador que canceló';
  end if;
  insert into t47 values (11,'bitácora',
    'el evento guarda club, administrador, motivo y si hubo sanción: datos, no una frase');

  -- ══ CASO 12: cancelar dentro de las 2 h sí sanciona ══════════
  -- Se rebobina el partido al estado de antes y se cancela otra vez, esta
  -- vez con el encuentro a una hora.
  update public.matches
     set estado = 'abierto', hora = now() + interval '1 hour', motivo_cancelacion = null
   where id = v_m;
  update public.club_challenges set estado = 'publicado', motivo_cierre = null where id = v_ch;
  delete from public.notifications where data ->> 'matchId' = v_m::text;
  delete from public.notifications where type = 'club_sancionado';

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.cancelar_encuentro_club(v_ch, 'no llegamos con el equipo');
  execute 'reset role';
  if not (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 12): no se pudo cancelar a 1 h — %', v_j->>'reason';
  end if;
  if not (v_j->>'sanciona')::boolean then
    raise exception 'FALLÓ (caso 12): cancelar a 1 h del encuentro NO sancionó';
  end if;

  select * into v_sancion from public.club_sanctions where club_id = v_cA order by created_at desc limit 1;
  if v_sancion.id is null then
    raise exception 'FALLÓ (caso 12): no se creó la sanción';
  end if;
  if v_sancion.estado <> 'vigente' then
    raise exception 'FALLÓ (caso 12): la sanción nace en «%» y debería nacer vigente', v_sancion.estado;
  end if;
  if v_sancion.fin_at <> v_sancion.inicio_at + make_interval(days => v_dias) then
    raise exception 'FALLÓ (caso 12): la sanción no dura % días', v_dias;
  end if;
  if length(trim(coalesce(v_sancion.motivo,''))) = 0 then
    raise exception 'FALLÓ (caso 12): la sanción quedó sin motivo';
  end if;
  if v_sancion.challenge_id <> v_ch or v_sancion.match_id <> v_m then
    raise exception 'FALLÓ (caso 12): la sanción no apunta al encuentro que la originó';
  end if;
  insert into t47 values (12,'a 1 h sí hay sanción',
    format('sanción de %s días, vigente, con motivo y apuntando al encuentro que la originó', v_dias));

  -- ══ CASO 13: la sanción es del CLUB y se avisa ═══════════════
  select count(*) into v_count from public.notifications
   where type = 'club_sancionado' and user_id in (v_adminA, v_adminA2);
  if v_count <> 2 then
    raise exception 'FALLÓ (caso 13): los administradores del club sancionado recibieron % avisos', v_count;
  end if;
  select count(*) into v_count from public.notifications
   where type = 'club_sancionado' and user_id = v_adminB;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 13): se avisó de la sanción a un administrador del club rival';
  end if;
  select payload into v_payload from public.club_challenge_events
   where challenge_id = v_ch and tipo = 'sancion_aplicada' order by created_at desc limit 1;
  if v_payload is null or (v_payload ->> 'club_id') <> v_cA::text then
    raise exception 'FALLÓ (caso 13): el evento «sancion_aplicada» no nombra al club sancionado';
  end if;
  insert into t47 values (13,'la sanción es del club',
    'la avisan sus propios administradores y el evento del hilo nombra al club, no a la persona');

  -- ══ CASO 14: tampoco acá se movió el Trust Score ═════════════
  if (select trust_score from public.profiles where id = v_inscrito) <> v_trust then
    raise exception 'FALLÓ (caso 14): la sanción tocó el Trust Score del jugador inscrito';
  end if;
  if (select trust_score from public.profiles where id = v_adminA) <> v_trust2 then
    raise exception 'FALLÓ (caso 14): la sanción tocó el Trust Score del administrador';
  end if;
  insert into t47 values (14,'sancionar no baja Trust Score',
    'la sanción de 14 días no descuenta un solo punto a ninguna persona');

  -- ══ CASO 15: cancelar dos veces no abre dos sanciones ════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.cancelar_encuentro_club(v_ch, 'no llegamos con el equipo');
  execute 'reset role';
  if not (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 15): la segunda cancelación devolvió error en vez de «ya estaba»';
  end if;
  if not coalesce((v_j->>'already')::boolean, false) then
    raise exception 'FALLÓ (caso 15): la segunda cancelación no se reconoció como repetida';
  end if;
  select count(*) into v_count from public.club_sanctions where club_id = v_cA;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 15): quedaron % sanciones tras cancelar dos veces', v_count;
  end if;
  select count(*) into v_count from public.club_challenge_events
   where challenge_id = v_ch and tipo = 'encuentro_cancelado';
  if v_count <> 2 then
    -- Dos: la del caso 7 (sin sanción) y la del caso 12 (con sanción). La
    -- repetida no debe dejar una tercera.
    raise exception 'FALLÓ (caso 15): la bitácora tiene % cancelaciones y debería tener 2', v_count;
  end if;
  insert into t47 values (15,'idempotencia',
    'cancelar dos veces devuelve «ya estaba», sin segunda sanción ni segundo evento');

  -- ══ CASO 16: el club sancionado no CREA desafíos ═════════════
  v_err := null;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
    insert into public.club_challenges (club_retador_id, club_retado_id, creado_por, estado)
    values (v_cA, v_cD, v_adminA, 'pendiente');
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_err := SQLERRM;
  end;
  if v_err is null then
    raise exception 'FALLÓ (caso 16): el club sancionado creó un desafío nuevo';
  end if;
  -- Se exige que el error sea POR LA SANCIÓN. Sin esto, un fallo de RLS o
  -- de otra restricción daría el caso por bueno sin haber probado nada.
  if v_err not like '%sancionado%' then
    raise exception 'FALLÓ (caso 16): el insert falló por otra cosa, no por la sanción — «%»', v_err;
  end if;
  insert into t47 values (16,'sancionado no crea',
    format('el insert directo del cliente lo corta el trigger — «%s»', v_err));

  -- ══ CASO 17: el club sancionado no ACEPTA desafíos ═══════════
  v_err := null;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
    perform public.aceptar_desafio(v_ch3);
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_err := SQLERRM;
  end;
  if v_err is null then
    raise exception 'FALLÓ (caso 17): el club sancionado aceptó un desafío';
  end if;
  if v_err not like '%sancionado%' then
    raise exception 'FALLÓ (caso 17): aceptar falló por otra cosa, no por la sanción — «%»', v_err;
  end if;
  if (select estado from public.club_challenges where id = v_ch3) <> 'pendiente' then
    raise exception 'FALLÓ (caso 17): el desafío cambió de estado pese al rechazo';
  end if;
  insert into t47 values (17,'sancionado no acepta',
    format('aceptar_desafio se niega y el desafío sigue pendiente — «%s»', v_err));

  -- ══ CASO 18: el club sancionado no PROPONE ═══════════════════
  v_err := null;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
    perform public.crear_propuesta_oficial(v_ch4, jsonb_build_object(
      'fecha', (now() + interval '10 days')::text, 'duracion_min', 90,
      'direccion', 'Av. Uno 1', 'cancha_nombre', 'Cancha Tres', 'comuna', 'Macul',
      'region', 'Región Metropolitana de Santiago', 'latitud', -33.48, 'longitud', -70.59,
      'modalidad', 'futbol7', 'cupos_por_club', 7,
      'metodo_inscripcion', 'orden_llegada', 'cuota_por_persona', 0), null::uuid);
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_err := SQLERRM;
  end;
  if v_err is null then
    raise exception 'FALLÓ (caso 18): el club sancionado creó una propuesta oficial';
  end if;
  if v_err not like '%sancionado%' then
    raise exception 'FALLÓ (caso 18): proponer falló por otra cosa, no por la sanción — «%»', v_err;
  end if;
  insert into t47 values (18,'sancionado no propone',
    format('crear_propuesta_oficial se niega — «%s»', v_err));

  -- ══ CASO 19: pero CONSERVA sus partidos ya publicados (C3) ═══
  -- Cancelar automáticamente todos los partidos del club sancionado
  -- castigaría al club rival y a los jugadores ya inscritos, que no
  -- hicieron nada. Sólo se cancela el que originó la sanción.
  select estado into v_estado from public.matches where id = v_m2;
  if v_estado <> 'abierto' then
    raise exception 'FALLÓ (caso 19): la sanción arrastró el otro partido del club, que quedó en «%»', v_estado;
  end if;
  if (select estado from public.club_challenges where id = v_ch2) <> 'publicado' then
    raise exception 'FALLÓ (caso 19): la sanción cerró el otro desafío del club';
  end if;
  if (select motivo_cancelacion from public.matches where id = v_m2) is not null then
    raise exception 'FALLÓ (caso 19): al otro partido le apareció un motivo de cancelación';
  end if;
  insert into t47 values (19,'conserva lo ya publicado',
    'el partido que el club sancionado ya tenía publicado sigue abierto, con su desafío publicado (decisión C3)');

  -- ══ CASO 20: el rival NO queda sancionado ════════════════════
  select count(*) into v_count from public.club_sanctions where club_id = v_cB;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 20): se sancionó también al club que no canceló';
  end if;
  insert into t47 values (20,'sanciona quien cancela',
    'el club rival, que no hizo nada, no recibe ninguna sanción');

  -- ══ CASO 21: quién ve la sanción ═════════════════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_inscrito,'role','authenticated')::text);
  select count(*) into v_count from public.club_sanctions where club_id = v_cA;
  execute 'reset role';
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 21): un integrante del club sancionado no ve la sanción de su club';
  end if;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_ajeno,'role','authenticated')::text);
  select count(*) into v_count from public.club_sanctions;
  execute 'reset role';
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 21): alguien ajeno a los clubes ve % sanciones', v_count;
  end if;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminB,'role','authenticated')::text);
  select count(*) into v_count from public.club_sanctions;
  execute 'reset role';
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 21): el club rival lee la sanción ajena desde la tabla';
  end if;
  insert into t47 values (21,'privacidad de la sanción',
    'la ve su propio club; ni el rival ni un ajeno la leen desde la tabla');

  -- ══ CASO 22: nadie escribe club_sanctions desde el cliente ═══
  v_err := null;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
    insert into public.club_sanctions (club_id, motivo, fin_at)
    values (v_cB, 'me caen mal', now() + interval '14 days');
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_err := SQLERRM;
  end;
  if v_err is null then
    raise exception 'FALLÓ (caso 22): un authenticated escribió una sanción a mano';
  end if;
  insert into t47 values (22,'sanciones solo por RPC',
    format('un insert directo se rechaza — «%s»', v_err));

  -- ══ CASO 23: permisos de ejecución ═══════════════════════════
  if has_function_privilege('public', 'public.cancelar_encuentro_club(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.cancelar_encuentro_club(uuid,text)', 'EXECUTE') then
    raise exception 'FALLÓ (caso 23): cancelar_encuentro_club quedó expuesta a public o anon';
  end if;
  if not has_function_privilege('authenticated', 'public.cancelar_encuentro_club(uuid,text)', 'EXECUTE') then
    raise exception 'FALLÓ (caso 23): authenticated no puede cancelar el encuentro';
  end if;
  if has_function_privilege('public', 'public.club_esta_sancionado(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.club_esta_sancionado(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.club_esta_sancionado(uuid)', 'EXECUTE') then
    raise exception 'FALLÓ (caso 23): club_esta_sancionado quedó expuesta a algún rol del cliente';
  end if;
  if has_function_privilege('public', 'public.aplicar_sancion_club(uuid,text,text,uuid,uuid,uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.aplicar_sancion_club(uuid,text,text,uuid,uuid,uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.aplicar_sancion_club(uuid,text,text,uuid,uuid,uuid,text)', 'EXECUTE') then
    raise exception 'FALLÓ (caso 23): aplicar_sancion_club quedó expuesta a algún rol del cliente';
  end if;
  insert into t47 values (23,'permisos',
    'cancelar_encuentro_club: public=NO, anon=NO, authenticated=SÍ; club_esta_sancionado y aplicar_sancion_club: ningún rol del cliente');

  -- ══ CASO 24: cumplida la sanción, el club vuelve a operar ════
  -- Se adelanta el final de la sanción en vez de esperar 14 días: lo que
  -- se comprueba es que `club_esta_sancionado` mira `fin_at` y no que la
  -- fila exista.
  update public.club_sanctions
     set inicio_at = now() - interval '15 days', fin_at = now() - interval '1 day'
   where club_id = v_cA;
  if public.club_esta_sancionado(v_cA) then
    raise exception 'FALLÓ (caso 24): una sanción ya cumplida sigue bloqueando al club';
  end if;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  perform public.aceptar_desafio(v_ch3);
  execute 'reset role';
  if (select estado from public.club_challenges where id = v_ch3) <> 'negociacion' then
    raise exception 'FALLÓ (caso 24): el club no volvió a operar después de cumplir la sanción';
  end if;
  insert into t47 values (24,'la sanción caduca sola',
    'pasados los 14 días el club vuelve a aceptar desafíos, sin que nadie tenga que retirar la fila');

  -- ══ CASO 25: una sanción retirada deja de bloquear ═══════════
  -- Es la puerta que abre la Tarea 5.2: la revisión no borra la fila, la
  -- marca 'retirada'. Acá sólo se comprueba que ese estado ya no bloquea.
  update public.club_sanctions
     set inicio_at = now(), fin_at = now() + make_interval(days => v_dias), estado = 'vigente'
   where club_id = v_cA;
  if not public.club_esta_sancionado(v_cA) then
    raise exception 'FALLÓ (caso 25): la sanción reactivada no bloquea';
  end if;
  update public.club_sanctions set estado = 'retirada' where club_id = v_cA;
  if public.club_esta_sancionado(v_cA) then
    raise exception 'FALLÓ (caso 25): una sanción retirada sigue bloqueando al club';
  end if;
  insert into t47 values (25,'retirar la sanción desbloquea',
    'estado «retirada» deja de contar sin borrar la fila: el historial se conserva (puerta de la Tarea 5.2)');
end;
$$;

select n, caso, detalle from t47 order by n;

rollback;
