-- =============================================================
-- FutFinder — pruebas de la incomparecencia y de la revisión de
-- sanciones (migración 47c).
--
-- QUÉ SE PRUEBA. Un club que no se presenta al partido puede ser
-- informado por el rival dentro de las 24 horas siguientes a la hora del
-- encuentro, y eso le deja una sanción PROVISIONAL de 14 días.
-- Provisional porque todavía no la revisó nadie: el club afectado puede
-- pedir una revisión, y quien la resuelve —hoy, una persona con
-- `service_role` desde el panel de Supabase— la retira o la mantiene.
--
-- LAS SIETE REGLAS Y DÓNDE SE COMPRUEBAN:
--
--   · LA VENTANA ES DE 24 HORAS. Antes de la hora del partido no hay
--     nada que informar (caso 5); pasadas las 24 horas, tampoco
--     (caso 6). Al filo de las 23:30 sí (caso 7). El corte lo hace el
--     `now()` de PostgreSQL, no el teléfono.
--   · UN INFORME POR PARTIDO Y POR CLUB ACUSADO. El mismo club no
--     informa dos veces (caso 10), pero el club acusado SÍ puede acusar
--     de vuelta (caso 11), y entonces quedan dos informes y dos
--     sanciones que se revisan por separado.
--   · SE INFORMA CONTRA EL RIVAL, NUNCA CONTRA EL PROPIO CLUB
--     (caso 12), y sólo un administrador de uno de los dos clubes
--     (caso 4).
--   · LA SANCIÓN NACE 'provisional' (caso 7) y bloquea igual que una
--     vigente mientras nadie la revise (caso 9).
--   · EL DESAFÍO SE CONGELA MIENTRAS HAY UNA REVISIÓN PENDIENTE, y no
--     antes: informar NO congela nada (caso 8), pedir la revisión sí
--     (caso 14), y resolverla lo devuelve a su estado exacto en cuanto
--     no queda ninguna pendiente (casos 19 y 20).
--   · RETIRAR NO BORRA. La fila queda con `estado = 'retirada'` y su
--     motivo intacto (caso 20).
--   · LA RESOLUCIÓN NO ES DEL CLIENTE. Un `authenticated` no puede
--     ejecutar `resolver_revision_sancion` (caso 17), ni escribir a mano
--     en ninguna de las dos tablas nuevas (caso 24).
--
-- Y el Trust Score no se mueve (caso 8): la sanción es del club, igual
-- que en la 47.
--
-- Requisito: migraciones 41 a 47b aplicadas, y la 47c aplicada o corrida
-- dentro de la misma transacción que este arnés.
--
-- NOTA SOBRE LOS DATOS. Este arnés NO reutiliza ningún partido ni club
-- de la base: crea los suyos dentro de la transacción y los deshace con
-- el `rollback`. Es la diferencia con `47_cancelacion_y_sancion_test.sql`,
-- que sí toma el último partido de clubes que exista; acá hace falta un
-- partido con la hora YA PASADA, y moverle la hora a un partido real
-- —aunque sea dentro de una transacción— es tocar datos de prueba que
-- alguien está usando para otra cosa.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor.
-- Todo corre en una transacción que termina en ROLLBACK.
-- =============================================================

begin;

create temp table t47c (n integer, caso text, detalle text) on commit drop;

do $$
declare
  v_adminA   uuid := gen_random_uuid(); -- club A: el que no se presenta
  v_adminB   uuid := gen_random_uuid(); -- club B: el que informa
  v_adminD   uuid := gen_random_uuid();
  v_adminE   uuid := gen_random_uuid();
  v_ambos    uuid := gen_random_uuid(); -- administra A y B
  v_ajeno    uuid := gen_random_uuid(); -- no pertenece a ninguno
  v_jugador  uuid := gen_random_uuid(); -- integrante de A sin rol, inscrito

  v_cA       uuid := gen_random_uuid();
  v_cB       uuid := gen_random_uuid();
  v_cD       uuid := gen_random_uuid();
  -- El club E existe por `club_challenges_unique_activo`, que es único
  -- sobre el PAR de clubes en los estados activos: el desafío pendiente
  -- que sirve para probar el bloqueo no puede ser entre A y D, porque A
  -- y D ya tienen un encuentro publicado.
  v_cE       uuid := gen_random_uuid();

  -- Encuentro 1: incomparecencia cruzada y las dos revisiones.
  v_ch1      uuid := gen_random_uuid();
  v_pr1      uuid := gen_random_uuid();
  v_m1       uuid := gen_random_uuid();
  -- Encuentro 3: cancelación SIN sanción, para la revisión de una
  -- cancelación (que no tiene sanción que retirar).
  v_ch3      uuid := gen_random_uuid();
  v_pr3      uuid := gen_random_uuid();
  v_m3       uuid := gen_random_uuid();
  -- Un desafío pendiente para comprobar que la provisional bloquea.
  v_ch4      uuid := gen_random_uuid();

  v_j        json;
  v_count    int;
  v_estado   text;
  v_texto    text;
  v_trust    int;
  v_trust2   int;
  v_err      text;
  v_rep      public.club_match_noshow_reports;
  v_rev      public.club_sanction_reviews;
  v_san      public.club_sanctions;
  v_revA     uuid;   -- la revisión del club A (sobre la sanción de A)
  v_revB     uuid;   -- la revisión del club B (sobre la sanción de B)
  v_sanA     uuid;
  v_sanB     uuid;
  v_ctx      jsonb;
  v_dias     int := (public.desafio_reglas() ->> 'sancion_dias')::int;
  v_horas    int := (public.desafio_reglas() ->> 'incomparecencia_horas')::int;
begin
  -- ── gente ─────────────────────────────────────────────────────
  insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,email_change,
    email_change_token_new,recovery_token)
  select '00000000-0000-0000-0000-000000000000',u,'authenticated','authenticated',
    'u47c-'||u||'@futfinder.test','x',now(),now(),now(),'{}','{}','','','',''
  from unnest(array[v_adminA, v_adminB, v_adminD, v_adminE,
                    v_ambos, v_ajeno, v_jugador]) u;

  -- ── clubes ────────────────────────────────────────────────────
  -- `premium` porque el plan estándar admite un solo administrador y los
  -- clubes A y B necesitan dos (el suyo y el que administra los dos).
  insert into public.clubs (id, nombre, slug, plan, created_by)
  values (v_cA, 'Club A 47c', 'club-a-47c-'||left(v_cA::text,8), 'premium', v_adminA),
         (v_cB, 'Club B 47c', 'club-b-47c-'||left(v_cB::text,8), 'premium', v_adminB),
         (v_cD, 'Club D 47c', 'club-d-47c-'||left(v_cD::text,8), 'premium', v_adminD),
         (v_cE, 'Club E 47c', 'club-e-47c-'||left(v_cE::text,8), 'premium', v_adminE);

  insert into public.club_members (club_id, user_id, rol)
  values (v_cA, v_adminA, 'admin'), (v_cB, v_adminB, 'admin'),
         (v_cD, v_adminD, 'admin'), (v_cE, v_adminE, 'admin'),
         (v_cA, v_ambos, 'admin'),  (v_cB, v_ambos, 'admin'),
         (v_cA, v_jugador, 'jugador');

  -- ── los dos encuentros ────────────────────────────────────────
  -- Se crean ANTES de que exista ninguna sanción: con una encima, el
  -- trigger de la 47 impediría insertar el desafío y el arnés no podría
  -- probar lo que viene después.
  insert into public.club_challenges (id, club_retador_id, club_retado_id, creado_por, estado)
  values (v_ch1, v_cA, v_cB, v_adminA, 'publicado'),
         (v_ch3, v_cA, v_cD, v_adminA, 'publicado'),
         (v_ch4, v_cE, v_cA, v_adminE, 'pendiente');

  insert into public.club_challenge_proposals (
      id, challenge_id, club_proponente_id, creada_por, fecha, duracion_min,
      direccion, cancha_nombre, comuna, region, latitud, longitud,
      modalidad, cupos_por_club, metodo_inscripcion, cuota_por_persona, estado)
  values
    (v_pr1, v_ch1, v_cA, v_adminA, now() + interval '2 days', 90,
     'Av. Uno 1', 'Cancha Uno', 'Ñuñoa', 'Región Metropolitana de Santiago',
     -33.45, -70.60, 'futbol7', 7, 'orden_llegada', 0, 'aprobada'),
    (v_pr3, v_ch3, v_cA, v_adminA, now() + interval '4 days', 90,
     'Av. Tres 3', 'Cancha Tres', 'Macul', 'Región Metropolitana de Santiago',
     -33.48, -70.59, 'futbol7', 7, 'orden_llegada', 0, 'aprobada');

  -- La hora se inserta en el FUTURO porque `trg_match_future_only`
  -- rechaza cualquier partido con hora pasada. Es un trigger BEFORE
  -- INSERT: el `update` que viene después sí puede moverla al pasado, que
  -- es justo lo que necesita una incomparecencia.
  insert into public.matches (
      id, id_organizador, titulo, comuna, region, cancha_nombre, latitud, longitud,
      hora, duracion_min, cupos_totales, cupos_disponibles, estado,
      challenge_proposal_id, challenge_id, club_local_id, club_visitante_id,
      cupos_por_club, metodo_inscripcion, ubicacion_aproximada)
  values
    (v_m1, v_adminA, 'A vs B', 'Ñuñoa', 'Región Metropolitana de Santiago',
     'Cancha Uno', -33.45, -70.60, now() + interval '2 days', 90, 14, 14, 'abierto',
     v_pr1, v_ch1, v_cA, v_cB, 7, 'orden_llegada', true),
    (v_m3, v_adminA, 'A vs D', 'Macul', 'Región Metropolitana de Santiago',
     'Cancha Tres', -33.48, -70.59, now() + interval '4 days', 90, 14, 14, 'abierto',
     v_pr3, v_ch3, v_cA, v_cD, 7, 'orden_llegada', true);

  update public.club_challenges set match_id = v_m1 where id = v_ch1;
  update public.club_challenges set match_id = v_m3 where id = v_ch3;

  insert into public.attendees (id_partido, id_jugador, estado, club_id, origen)
  values (v_m1, v_jugador, 'inscrito', v_cA, 'orden_llegada');

  -- ══ CASO 1: las dos tablas existen con RLS ═══════════════════
  if to_regclass('public.club_match_noshow_reports') is null then
    raise exception 'FALLÓ (caso 1): falta la tabla club_match_noshow_reports';
  end if;
  if to_regclass('public.club_sanction_reviews') is null then
    raise exception 'FALLÓ (caso 1): falta la tabla club_sanction_reviews';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.club_match_noshow_reports'::regclass) then
    raise exception 'FALLÓ (caso 1): club_match_noshow_reports sin RLS';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.club_sanction_reviews'::regclass) then
    raise exception 'FALLÓ (caso 1): club_sanction_reviews sin RLS';
  end if;
  if v_horas is null then
    raise exception 'FALLÓ (caso 1): desafio_reglas() no declara incomparecencia_horas';
  end if;
  insert into t47c values (1,'las tablas y la regla existen',
    format('club_match_noshow_reports y club_sanction_reviews con RLS, y el plazo de %s horas sale de desafio_reglas()', v_horas));

  -- ══ CASO 2: sin motivo no se informa nada ════════════════════
  update public.matches set hora = now() - interval '2 hours' where id = v_m1;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminB,'role','authenticated')::text);
  v_j := public.reportar_incomparecencia(v_ch1, null::text);
  execute 'reset role';
  if (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 2): se informó una incomparecencia sin motivo';
  end if;
  select count(*) into v_count from public.club_match_noshow_reports where challenge_id = v_ch1;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 2): quedó un informe pese al rechazo';
  end if;
  insert into t47c values (2,'motivo obligatorio',
    format('un motivo nulo no informa nada — «%s»', v_j->>'reason'));

  -- ══ CASO 3: tres espacios y 301 caracteres tampoco ═══════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminB,'role','authenticated')::text);
  v_j := public.reportar_incomparecencia(v_ch1, '   ');
  execute 'reset role';
  if (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 3): tres espacios pasaron como motivo';
  end if;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminB,'role','authenticated')::text);
  v_j := public.reportar_incomparecencia(v_ch1, repeat('x', 301));
  execute 'reset role';
  if (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 3): se aceptó un motivo de 301 caracteres';
  end if;
  select count(*) into v_count from public.club_match_noshow_reports where challenge_id = v_ch1;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 3): quedó un informe con motivo inválido';
  end if;
  insert into t47c values (3,'motivo en blanco y con tope',
    '«   » y 301 caracteres se rechazan igual que el motivo ausente, y no dejan fila');

  -- ══ CASO 4: quién puede informar ═════════════════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_ajeno,'role','authenticated')::text);
  v_j := public.reportar_incomparecencia(v_ch1, 'no llegaron');
  execute 'reset role';
  if (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 4): un ajeno informó una incomparecencia';
  end if;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_jugador,'role','authenticated')::text);
  v_j := public.reportar_incomparecencia(v_ch1, 'no llegaron');
  execute 'reset role';
  if (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 4): un integrante sin rol informó una incomparecencia';
  end if;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_ambos,'role','authenticated')::text);
  v_j := public.reportar_incomparecencia(v_ch1, 'no llegó ninguno de mis dos clubes');
  execute 'reset role';
  if (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 4): quien administra los dos clubes informó contra uno de ellos';
  end if;
  select count(*) into v_count from public.club_sanctions where club_id in (v_cA, v_cB);
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 4): alguno de los rechazos dejó una sanción';
  end if;
  insert into t47c values (4,'solo un administrador, y de un solo club',
    format('ajeno, jugador y doble pertenencia quedan fuera — «%s»', v_j->>'reason'));

  -- ══ CASO 5: antes de la hora del partido, nada ═══════════════
  update public.matches set hora = now() + interval '3 hours' where id = v_m1;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminB,'role','authenticated')::text);
  v_j := public.reportar_incomparecencia(v_ch1, 'sé que no van a llegar');
  execute 'reset role';
  if (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 5): se informó una incomparecencia antes de la hora del partido';
  end if;
  insert into t47c values (5,'borde de abajo: la hora del partido',
    format('con el partido por delante no hay incomparecencia que informar — «%s»', v_j->>'reason'));

  -- ══ CASO 6: pasadas las 24 horas, tampoco ════════════════════
  -- Es el borde que cierra la denuncia tardía: a los tres días nadie se
  -- acuerda de quién llegó a la cancha, y quien revise la sanción tampoco
  -- tendría con qué. Sin este corte, un club bloquea a otro dos semanas
  -- por un partido de hace un mes.
  update public.matches set hora = now() - make_interval(hours => v_horas + 1) where id = v_m1;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminB,'role','authenticated')::text);
  v_j := public.reportar_incomparecencia(v_ch1, 'me acordé recién de que no llegaron');
  execute 'reset role';
  if (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 6): se informó una incomparecencia % horas después del partido', v_horas + 1;
  end if;
  select count(*) into v_count from public.club_match_noshow_reports where challenge_id = v_ch1;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 6): la denuncia tardía dejó un informe';
  end if;
  select count(*) into v_count from public.club_sanctions where club_id = v_cA;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 6): la denuncia tardía sancionó al club';
  end if;
  insert into t47c values (6,'borde de arriba: 24 horas',
    format('a las %s horas del partido ya no se informa, y no queda ni informe ni sanción — «%s»',
           v_horas + 1, v_j->>'reason'));

  -- ══ CASO 7: al filo del plazo sí, y la sanción nace PROVISIONAL ══
  update public.matches set hora = now() - interval '23 hours 30 minutes' where id = v_m1;
  select trust_score into v_trust  from public.profiles where id = v_jugador;
  select trust_score into v_trust2 from public.profiles where id = v_adminA;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminB,'role','authenticated')::text);
  v_j := public.reportar_incomparecencia(v_ch1, 'no llegó nadie del club rival');
  execute 'reset role';
  if not (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 7): dentro del plazo no se pudo informar — %', v_j->>'reason';
  end if;
  v_sanA := (v_j->>'sancionId')::uuid;

  select * into v_rep from public.club_match_noshow_reports where club_reportado_id = v_cA;
  if not found then
    raise exception 'FALLÓ (caso 7): no quedó el informe de incomparecencia';
  end if;
  if v_rep.club_reportante_id <> v_cB then
    raise exception 'FALLÓ (caso 7): el informe no registra al club que informó';
  end if;

  select * into v_san from public.club_sanctions where id = v_sanA;
  if v_san.estado <> 'provisional' then
    raise exception 'FALLÓ (caso 7): la sanción nació «%» y debería nacer provisional', v_san.estado;
  end if;
  if v_san.tipo <> 'incomparecencia' then
    raise exception 'FALLÓ (caso 7): la sanción quedó de tipo «%»', v_san.tipo;
  end if;
  if v_san.club_id <> v_cA then
    raise exception 'FALLÓ (caso 7): la sanción cayó sobre el club equivocado';
  end if;
  if v_san.fin_at::date <> (v_san.inicio_at + make_interval(days => v_dias))::date then
    raise exception 'FALLÓ (caso 7): la sanción no dura % días', v_dias;
  end if;
  insert into t47c values (7,'dentro del plazo, sanción provisional',
    format('a 23:30 del partido el informe entra y deja una sanción provisional de %s días sobre el club que no se presentó', v_dias));

  -- ══ CASO 8: informar NO congela el desafío ═══════════════════
  -- El congelado dura lo que dura una revisión, no lo que dura la
  -- sanción. Si se congelara acá, un encuentro cuyo club nunca pide la
  -- revisión —el caso más frecuente— se quedaría bloqueado para siempre.
  select estado, estado_previo_sancion into v_estado, v_texto
    from public.club_challenges where id = v_ch1;
  if v_estado <> 'publicado' then
    raise exception 'FALLÓ (caso 8): informar dejó el desafío en «%»', v_estado;
  end if;
  if v_texto is not null then
    raise exception 'FALLÓ (caso 8): informar escribió estado_previo_sancion «%»', v_texto;
  end if;
  if not public.chat_puede_escribir_desafio(v_ch1, v_adminA) then
    raise exception 'FALLÓ (caso 8): informar dejó el hilo de solo lectura antes de que nadie pidiera revisión';
  end if;
  -- Y el Trust Score no se movió: la sanción es del club.
  if (select trust_score from public.profiles where id = v_jugador) <> v_trust then
    raise exception 'FALLÓ (caso 8): la incomparecencia cambió el Trust Score del jugador inscrito';
  end if;
  if (select trust_score from public.profiles where id = v_adminA) <> v_trust2 then
    raise exception 'FALLÓ (caso 8): la incomparecencia cambió el Trust Score del administrador';
  end if;
  insert into t47c values (8,'informar no congela ni descuenta',
    'el desafío sigue publicado, el hilo abierto y ningún Trust Score se movió: la sanción es del club');

  -- ══ CASO 9: la provisional bloquea igual que una vigente ═════
  if not public.club_esta_sancionado(v_cA) then
    raise exception 'FALLÓ (caso 9): una sanción provisional no bloquea al club';
  end if;
  v_err := null;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
    perform public.aceptar_desafio(v_ch4);
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_err := SQLERRM;
  end;
  if v_err is null then
    raise exception 'FALLÓ (caso 9): el club con sanción provisional aceptó un desafío';
  end if;
  if v_err not like '%sancionado%' then
    raise exception 'FALLÓ (caso 9): aceptar falló por otra cosa — «%»', v_err;
  end if;
  insert into t47c values (9,'la provisional bloquea',
    format('mientras nadie la revise, la sanción provisional cierra las mismas puertas — «%s»', v_err));

  -- ══ CASO 10: el mismo club no informa dos veces ══════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminB,'role','authenticated')::text);
  v_j := public.reportar_incomparecencia(v_ch1, 'insisto, no llegaron');
  execute 'reset role';
  if not (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 10): el segundo informe devolvió error en vez de «ya estaba»';
  end if;
  if not coalesce((v_j->>'already')::boolean, false) then
    raise exception 'FALLÓ (caso 10): el segundo informe no se reconoció como repetido';
  end if;
  select count(*) into v_count from public.club_sanctions where club_id = v_cA;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 10): quedaron % sanciones sobre el club acusado', v_count;
  end if;
  select count(*) into v_count from public.club_match_noshow_reports where club_reportado_id = v_cA;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 10): quedaron % informes contra el mismo club', v_count;
  end if;
  insert into t47c values (10,'idempotencia: uno por club acusado',
    'informar dos veces contra el mismo club devuelve «ya estaba», sin segunda sanción ni segundo informe');

  -- ══ CASO 11: el club acusado puede acusar de vuelta ══════════
  -- Uno por partido y POR CLUB ACUSADO: si los dos dicen que el otro no
  -- llegó, quedan los dos informes y las dos sanciones. No se le da la
  -- razón al que informó primero.
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.reportar_incomparecencia(v_ch1, 'los que no llegaron fueron ellos');
  execute 'reset role';
  if not (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 11): el club acusado no pudo acusar de vuelta — %', v_j->>'reason';
  end if;
  if coalesce((v_j->>'already')::boolean, false) then
    raise exception 'FALLÓ (caso 11): el informe cruzado se leyó como un repetido del otro';
  end if;
  v_sanB := (v_j->>'sancionId')::uuid;

  select count(*) into v_count from public.club_match_noshow_reports where challenge_id = v_ch1;
  if v_count <> 2 then
    raise exception 'FALLÓ (caso 11): quedaron % informes y deberían quedar 2', v_count;
  end if;
  if (select estado from public.club_sanctions where id = v_sanB) <> 'provisional'
     or (select club_id from public.club_sanctions where id = v_sanB) <> v_cB then
    raise exception 'FALLÓ (caso 11): el informe cruzado no dejó una provisional sobre el otro club';
  end if;
  -- Y ese segundo informe también es idempotente.
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.reportar_incomparecencia(v_ch1, 'lo repito');
  execute 'reset role';
  if not coalesce((v_j->>'already')::boolean, false) then
    raise exception 'FALLÓ (caso 11): el informe cruzado no es idempotente';
  end if;
  select count(*) into v_count from public.club_match_noshow_reports where challenge_id = v_ch1;
  if v_count <> 2 then
    raise exception 'FALLÓ (caso 11): el repetido dejó un tercer informe';
  end if;
  insert into t47c values (11,'acusación cruzada',
    'cada club informa una vez contra el otro: dos informes, dos sanciones provisionales, y cada uno idempotente por su lado');

  -- ══ CASO 12: siempre contra el rival, nunca contra el propio ══
  if exists (
    select 1 from public.club_match_noshow_reports
     where challenge_id = v_ch1 and club_reportante_id = club_reportado_id
  ) then
    raise exception 'FALLÓ (caso 12): un club se informó a sí mismo';
  end if;
  if (select club_reportado_id from public.club_match_noshow_reports
       where challenge_id = v_ch1 and club_reportante_id = v_cB) <> v_cA
     or (select club_reportado_id from public.club_match_noshow_reports
       where challenge_id = v_ch1 and club_reportante_id = v_cA) <> v_cB then
    raise exception 'FALLÓ (caso 12): el acusado no es el club rival del que informa';
  end if;
  insert into t47c values (12,'se acusa al rival, no al propio',
    'el club acusado sale de la fila del desafío, no de un argumento que mande quien llama');

  -- ══ CASO 13: quién puede pedir la revisión ═══════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_ajeno,'role','authenticated')::text);
  v_j := public.solicitar_revision_sancion(v_ch1, 'no tengo nada que ver', null::uuid);
  execute 'reset role';
  if (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 13): un ajeno pidió la revisión de una sanción';
  end if;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_ambos,'role','authenticated')::text);
  v_j := public.solicitar_revision_sancion(v_ch1, 'pido por los dos', null::uuid);
  execute 'reset role';
  if (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 13): quien administra los dos clubes pidió una revisión';
  end if;
  insert into t47c values (13,'la revisión la pide el club afectado',
    format('ni un ajeno ni quien administra los dos clubes — «%s»', v_j->>'reason'));

  -- ══ CASO 14: pedir la revisión SÍ congela el desafío ═════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.solicitar_revision_sancion(v_ch1,
      'Sí nos presentamos: el árbitro y el club rival llegaron a otra cancha', null::uuid);
  execute 'reset role';
  if not (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 14): el club sancionado no pudo pedir la revisión — %', v_j->>'reason';
  end if;
  v_revA := (v_j->>'reviewId')::uuid;

  select * into v_rev from public.club_sanction_reviews where id = v_revA;
  if v_rev.estado <> 'pendiente' then
    raise exception 'FALLÓ (caso 14): la revisión nació «%» y debería nacer pendiente', v_rev.estado;
  end if;
  if v_rev.club_id <> v_cA or v_rev.sancion_id <> v_sanA then
    raise exception 'FALLÓ (caso 14): la revisión no quedó atada al club ni a la sanción';
  end if;

  select estado, estado_previo_sancion into v_estado, v_texto
    from public.club_challenges where id = v_ch1;
  if v_estado <> 'bloqueado_sancion' then
    raise exception 'FALLÓ (caso 14): el desafío quedó en «%» y debería quedar bloqueado_sancion', v_estado;
  end if;
  if v_texto <> 'publicado' then
    raise exception 'FALLÓ (caso 14): estado_previo_sancion guardó «%» en vez de «publicado»', v_texto;
  end if;
  insert into t47c values (14,'la revisión pendiente congela el desafío',
    'pedirla pasa el desafío a bloqueado_sancion y guarda su estado anterior para poder deshacerlo sin adivinar');

  -- ══ CASO 15: el expediente ═══════════════════════════════════
  v_ctx := v_rev.contexto;
  if v_ctx is null or v_ctx = '{}'::jsonb then
    raise exception 'FALLÓ (caso 15): la revisión no guardó contexto';
  end if;
  if v_ctx -> 'partido' ->> 'hora' is null then
    raise exception 'FALLÓ (caso 15): el contexto no guardó la hora del partido';
  end if;
  if v_ctx -> 'sancion' ->> 'motivo' is null then
    raise exception 'FALLÓ (caso 15): el contexto no guardó el motivo de la sanción';
  end if;
  if v_ctx -> 'tiempos' ->> 'capturado_at' is null then
    raise exception 'FALLÓ (caso 15): el contexto no guardó los tiempos';
  end if;
  if jsonb_array_length(coalesce(v_ctx -> 'eventos', '[]'::jsonb)) = 0 then
    raise exception 'FALLÓ (caso 15): el contexto no guardó ningún evento del hilo';
  end if;
  if v_ctx -> 'incomparecencia' ->> 'motivo' is null then
    raise exception 'FALLÓ (caso 15): el contexto no guardó el informe de incomparecencia';
  end if;
  insert into t47c values (15,'la revisión guarda el expediente',
    'motivo, partido, sanción, informe, tiempos y eventos del hilo quedan copiados en la fila de la revisión');

  -- ══ CASO 16: el hilo queda de solo lectura, no se borra ══════
  if public.chat_puede_escribir_desafio(v_ch1, v_adminA) then
    raise exception 'FALLÓ (caso 16): el hilo sigue abierto para escribir con la revisión pendiente';
  end if;
  if not public.chat_puede_ver_desafio(v_ch1, v_adminA) then
    raise exception 'FALLÓ (caso 16): el hilo dejó de verse, y debería conservarse como historial';
  end if;
  insert into t47c values (16,'el hilo se congela, no se borra',
    'con el desafío en bloqueado_sancion nadie escribe, pero los dos clubes siguen leyendo la conversación');

  -- ══ CASO 17: un authenticated NO resuelve revisiones ═════════
  -- Es el requisito central de la 5.2: la resolución no tiene interfaz
  -- porque no tiene permiso de cliente. Se prueba con el privilegio, no
  -- con una comprobación dentro del cuerpo: PostgreSQL corta antes de
  -- ejecutar la primera línea.
  v_err := null;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
    perform public.resolver_revision_sancion(v_revA, 'retirar', 'me la retiro yo mismo');
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_err := SQLERRM;
  end;
  if v_err is null then
    raise exception 'FALLÓ (caso 17): un authenticated resolvió su propia revisión';
  end if;
  if v_err not ilike '%permission denied%' and v_err not ilike '%permiso denegado%' then
    raise exception 'FALLÓ (caso 17): falló por otra cosa, no por falta de privilegio — «%»', v_err;
  end if;
  if (select estado from public.club_sanction_reviews where id = v_revA) <> 'pendiente' then
    raise exception 'FALLÓ (caso 17): la revisión cambió de estado pese al rechazo';
  end if;
  insert into t47c values (17,'la resolución no es del cliente',
    format('resolver_revision_sancion está revocada de authenticated — «%s»', v_err));

  v_err := null;
  begin
    execute 'set local role anon';
    perform public.resolver_revision_sancion(v_revA, 'retirar', 'anónimo');
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_err := SQLERRM;
  end;
  if v_err is null then
    raise exception 'FALLÓ (caso 17): un anónimo resolvió una revisión';
  end if;

  -- ══ CASO 18: una revisión por medida ═════════════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.solicitar_revision_sancion(v_ch1, 'insisto', null::uuid);
  execute 'reset role';
  select count(*) into v_count from public.club_sanction_reviews
   where challenge_id = v_ch1 and club_id = v_cA;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 18): quedaron % revisiones de la misma medida', v_count;
  end if;
  -- El OTRO club pide la suya, sobre su propia sanción: ésa sí es otra.
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminB,'role','authenticated')::text);
  v_j := public.solicitar_revision_sancion(v_ch1, 'Nosotros sí llegamos, hay fotos', null::uuid);
  execute 'reset role';
  if not (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 18): el otro club no pudo pedir la revisión de SU sanción — %', v_j->>'reason';
  end if;
  v_revB := (v_j->>'reviewId')::uuid;
  if (select sancion_id from public.club_sanction_reviews where id = v_revB) <> v_sanB then
    raise exception 'FALLÓ (caso 18): la revisión del otro club no apunta a su propia sanción';
  end if;
  -- El segundo congelado no pisa el estado guardado por el primero.
  if (select estado_previo_sancion from public.club_challenges where id = v_ch1) <> 'publicado' then
    raise exception 'FALLÓ (caso 18): la segunda revisión pisó el estado previo con bloqueado_sancion';
  end if;
  insert into t47c values (18,'una por medida, no una por club',
    'pedirla dos veces devuelve la que ya estaba; el otro club pide la suya y el estado previo guardado no se pisa');

  -- ══ CASO 19: con otra revisión pendiente, NO se descongela ═══
  execute 'set local request.jwt.claims to ''{}''';
  v_j := public.resolver_revision_sancion(v_revA, 'retirar', 'Se confirmó que la cancha estaba cambiada');
  if not (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 19): no se pudo retirar la sanción — %', v_j->>'reason';
  end if;
  if (select estado from public.club_sanctions where id = v_sanA) <> 'retirada' then
    raise exception 'FALLÓ (caso 19): la sanción no quedó retirada';
  end if;
  if (select estado from public.club_challenges where id = v_ch1) <> 'bloqueado_sancion' then
    raise exception 'FALLÓ (caso 19): el desafío se descongeló con una revisión todavía pendiente';
  end if;
  if v_j->>'estadoRestaurado' is not null then
    raise exception 'FALLÓ (caso 19): la respuesta dice que restauró un estado que no restauró';
  end if;
  insert into t47c values (19,'con una revisión pendiente sigue congelado',
    'resolver la primera retira su sanción pero no descongela el encuentro: falta la del otro club');

  -- ══ CASO 20: resuelta la última, el desafío vuelve ═══════════
  -- Y vuelve TAMBIÉN cuando la decisión es mantener: lo que congela es la
  -- revisión en curso, no la sanción. Mantenerla deja al club sin abrir
  -- desafíos nuevos 14 días, que es el castigo, pero no deja este
  -- encuentro atrapado para siempre.
  v_j := public.resolver_revision_sancion(v_revB, 'mantener', 'No hay prueba de la asistencia');
  if not (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 20): no se pudo mantener la sanción — %', v_j->>'reason';
  end if;

  select * into v_san from public.club_sanctions where id = v_sanB;
  if v_san.estado <> 'vigente' then
    raise exception 'FALLÓ (caso 20): mantener dejó la sanción en «%» y debía quedar vigente', v_san.estado;
  end if;
  if v_san.motivo is null or length(trim(v_san.motivo)) = 0 then
    raise exception 'FALLÓ (caso 20): se perdió el motivo de la sanción';
  end if;
  if (select estado from public.club_sanctions where id = v_sanA) <> 'retirada' then
    raise exception 'FALLÓ (caso 20): la sanción retirada se BORRÓ o cambió de estado';
  end if;

  select estado, estado_previo_sancion into v_estado, v_texto
    from public.club_challenges where id = v_ch1;
  if v_estado <> 'publicado' then
    raise exception 'FALLÓ (caso 20): el desafío quedó en «%» y debía volver a publicado', v_estado;
  end if;
  if v_texto is not null then
    raise exception 'FALLÓ (caso 20): estado_previo_sancion no se limpió — «%»', v_texto;
  end if;
  if v_j->>'estadoRestaurado' <> 'publicado' then
    raise exception 'FALLÓ (caso 20): la respuesta no informa el estado restaurado';
  end if;

  select * into v_rev from public.club_sanction_reviews where id = v_revB;
  if v_rev.estado <> 'resuelta' or v_rev.decision <> 'mantenida'
     or v_rev.nota is null or v_rev.resuelta_at is null then
    raise exception 'FALLÓ (caso 20): la revisión no guardó estado, decisión, nota y hora';
  end if;
  insert into t47c values (20,'resuelta la última, el desafío vuelve',
    'las dos decisiones descongelan cuando ya no queda ninguna pendiente; la retirada conserva su fila y su motivo');

  -- ══ CASO 21: el club con la sanción retirada vuelve a operar ══
  if public.club_esta_sancionado(v_cA) then
    raise exception 'FALLÓ (caso 21): el club sigue bloqueado con la sanción retirada';
  end if;
  if not public.club_esta_sancionado(v_cB) then
    raise exception 'FALLÓ (caso 21): la sanción mantenida dejó de bloquear al otro club';
  end if;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  perform public.aceptar_desafio(v_ch4);
  execute 'reset role';
  if (select estado from public.club_challenges where id = v_ch4) <> 'negociacion' then
    raise exception 'FALLÓ (caso 21): el club no volvió a operar tras la revisión';
  end if;
  if not public.chat_puede_escribir_desafio(v_ch1, v_adminA) then
    raise exception 'FALLÓ (caso 21): el hilo del encuentro no se reabrió';
  end if;
  insert into t47c values (21,'la revisión desbloquea de verdad',
    'con su sanción retirada el club vuelve a aceptar desafíos y el hilo se reabre; el club cuya sanción se mantuvo sigue bloqueado');

  -- ══ CASO 22: todo queda escrito ══════════════════════════════
  select count(*) into v_count from public.notifications
   where type = 'club_revision_resuelta' and user_id = v_adminA;
  if v_count = 0 then
    raise exception 'FALLÓ (caso 22): nadie avisó al club de cómo terminó su revisión';
  end if;
  select count(*) into v_count from public.club_challenge_events
   where challenge_id = v_ch1 and tipo = 'incomparecencia_reportada';
  if v_count <> 2 then
    raise exception 'FALLÓ (caso 22): la bitácora tiene % informes y debería tener 2', v_count;
  end if;
  select count(*) into v_count from public.club_challenge_events
   where challenge_id = v_ch1 and tipo = 'revision_solicitada';
  if v_count <> 2 then
    raise exception 'FALLÓ (caso 22): la bitácora tiene % solicitudes y debería tener 2', v_count;
  end if;
  select count(*) into v_count from public.club_challenge_events
   where challenge_id = v_ch1 and tipo = 'revision_resuelta';
  if v_count <> 2 then
    raise exception 'FALLÓ (caso 22): la bitácora tiene % resoluciones y debería tener 2', v_count;
  end if;
  insert into t47c values (22,'todo queda escrito',
    'los dos informes, las dos solicitudes y las dos resoluciones dejan su evento en el hilo, y cada club recibe el aviso de su resultado');

  -- ══ CASO 23: resolver dos veces no cambia nada ═══════════════
  v_j := public.resolver_revision_sancion(v_revB, 'retirar', 'me arrepentí');
  if not coalesce((v_j->>'already')::boolean, false) then
    raise exception 'FALLÓ (caso 23): una revisión resuelta se volvió a resolver';
  end if;
  if (select estado from public.club_sanctions where id = v_sanB) <> 'vigente' then
    raise exception 'FALLÓ (caso 23): la segunda resolución cambió la sanción';
  end if;
  -- Y una decisión que no existe no se inventa.
  v_j := public.resolver_revision_sancion(v_revB, 'lo que sea', null);
  if (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 23): se aceptó una decisión que no existe';
  end if;
  insert into t47c values (23,'la resolución es única',
    'volver a resolver devuelve «ya estaba», y una decisión que no es retirar ni mantener se rechaza');

  -- ══ CASO 24: revisar una CANCELACIÓN sin sanción ═════════════
  -- «Solicitar revisión» tiene que estar disponible ante cualquier
  -- cancelación, aunque no haya dejado sanción: es la que sufre el club
  -- rival, que se quedó sin partido.
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.cancelar_encuentro_club(v_ch3, 'no conseguimos cancha');
  execute 'reset role';
  if not (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 24): no se pudo cancelar el otro encuentro — %', v_j->>'reason';
  end if;
  if (v_j->>'sanciona')::boolean then
    raise exception 'FALLÓ (caso 24): cancelar con 4 días de aviso sancionó';
  end if;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminD,'role','authenticated')::text);
  v_j := public.solicitar_revision_sancion(v_ch3, 'Nos dejaron sin partido a última hora', null::uuid);
  execute 'reset role';
  if not (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 24): el club afectado no pudo pedir la revisión de una cancelación — %', v_j->>'reason';
  end if;
  execute 'set local request.jwt.claims to ''{}''';
  select * into v_rev from public.club_sanction_reviews where challenge_id = v_ch3;
  if v_rev.tipo <> 'cancelacion' or v_rev.sancion_id is not null then
    raise exception 'FALLÓ (caso 24): la revisión de una cancelación quedó de tipo «%» o atada a una sanción', v_rev.tipo;
  end if;
  if v_rev.contexto -> 'partido' ->> 'motivo_cancelacion' is null then
    raise exception 'FALLÓ (caso 24): el contexto no guardó el motivo de la cancelación';
  end if;
  -- Un desafío ya cerrado no se congela: no hay a qué volver.
  if (select estado from public.club_challenges where id = v_ch3) <> 'cancelado' then
    raise exception 'FALLÓ (caso 24): la revisión congeló un desafío ya cancelado';
  end if;

  -- Retirar no tiene sentido sin sanción: se dice, no se finge.
  v_j := public.resolver_revision_sancion(v_rev.id, 'retirar', 'no hay nada que retirar');
  if (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 24): se «retiró» una sanción que no existe';
  end if;
  v_j := public.resolver_revision_sancion(v_rev.id, 'mantener', 'La cancelación fue con aviso suficiente');
  if not (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 24): no se pudo cerrar la revisión de la cancelación — %', v_j->>'reason';
  end if;
  if (select estado from public.club_challenges where id = v_ch3) <> 'cancelado' then
    raise exception 'FALLÓ (caso 24): resolverla movió el estado de un desafío cancelado';
  end if;
  insert into t47c values (24,'también se revisa una cancelación',
    'el club que se quedó sin partido pide revisión aunque no haya sanción; no congela un desafío cerrado y «retirar» se rechaza porque no hay qué retirar');

  -- ══ CASO 25: ninguna de las dos tablas se escribe a mano ═════
  v_err := null;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
    insert into public.club_sanction_reviews (club_id, challenge_id, tipo, motivo)
    values (v_cA, v_ch1, 'sancion', 'me la reviso yo');
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_err := SQLERRM;
  end;
  if v_err is null then
    raise exception 'FALLÓ (caso 25): un authenticated insertó una revisión a mano';
  end if;

  v_err := null;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminB,'role','authenticated')::text);
    insert into public.club_match_noshow_reports (challenge_id, match_id, club_reportante_id, club_reportado_id, motivo)
    values (v_ch3, v_m3, v_cB, v_cA, 'informe a mano');
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_err := SQLERRM;
  end;
  if v_err is null then
    raise exception 'FALLÓ (caso 25): un authenticated insertó un informe a mano';
  end if;

  v_err := null;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
    update public.club_sanction_reviews set decision = 'retirada' where id = v_revB;
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_err := SQLERRM;
  end;
  if v_err is null and (select decision from public.club_sanction_reviews where id = v_revB) <> 'mantenida' then
    raise exception 'FALLÓ (caso 25): un authenticated cambió la decisión de su revisión';
  end if;
  insert into t47c values (25,'sólo las RPC escriben',
    'insertar o modificar informes y revisiones desde el cliente queda cortado por privilegios y RLS');

  -- ══ CASO 26: cada club lee lo suyo y nada más ════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  select count(*) into v_count from public.club_sanction_reviews where club_id = v_cA;
  execute 'reset role';
  if v_count = 0 then
    raise exception 'FALLÓ (caso 26): el club no puede leer su propia revisión';
  end if;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  select count(*) into v_count from public.club_sanction_reviews where club_id = v_cB;
  execute 'reset role';
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 26): un club leyó la revisión del rival';
  end if;

  -- El informe SÍ lo leen los dos: al acusado hay que decirle de qué se
  -- le acusa y con qué palabras, o no puede defenderse.
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  select count(*) into v_count from public.club_match_noshow_reports where club_reportado_id = v_cA;
  execute 'reset role';
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 26): el club acusado no puede leer el informe que lo acusa';
  end if;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_ajeno,'role','authenticated')::text);
  select count(*) into v_count from public.club_sanction_reviews;
  execute 'reset role';
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 26): un ajeno leyó % revisiones', v_count;
  end if;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_ajeno,'role','authenticated')::text);
  select count(*) into v_count from public.club_match_noshow_reports;
  execute 'reset role';
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 26): un ajeno leyó % informes de incomparecencia', v_count;
  end if;
  insert into t47c values (26,'la lectura es de los involucrados',
    'el acusado lee el informe que lo acusa; la revisión sólo la lee quien la pidió; un ajeno no ve ninguna fila');
end;
$$;

select n, caso, detalle from t47c order by n;

rollback;
