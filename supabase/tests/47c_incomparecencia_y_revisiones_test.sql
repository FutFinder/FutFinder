-- =============================================================
-- FutFinder — pruebas de la incomparecencia y de la revisión de
-- sanciones (migración 47c).
--
-- QUÉ SE PRUEBA. Un club que no se presenta al partido puede ser
-- informado por el rival DESPUÉS de la hora del encuentro, y eso le deja
-- una sanción PROVISIONAL de 14 días. Provisional porque todavía no la
-- revisó nadie: el club afectado puede pedir una revisión, y quien la
-- resuelve —hoy, una persona con `service_role` desde el panel de
-- Supabase— puede retirarla o mantenerla.
--
-- LAS SEIS REGLAS Y DÓNDE SE COMPRUEBAN:
--
--   · ANTES DE LA HORA NO HAY INCOMPARECENCIA. Con el partido todavía
--     por delante no se puede informar nada (caso 5). El corte lo hace
--     el `now()` de PostgreSQL, no el teléfono.
--   · LA SANCIÓN NACE 'provisional' (caso 7) y bloquea igual que una
--     vigente mientras nadie la revise (caso 9).
--   · EL DESAFÍO SE CONGELA Y RECUERDA DE DÓNDE VINO.
--     `estado_previo_sancion` guarda el estado anterior y el desafío
--     pasa a `bloqueado_sancion` (caso 7); retirar la sanción lo
--     devuelve exactamente a ese estado (caso 15).
--   · RETIRAR NO BORRA. La fila de `club_sanctions` queda con
--     `estado = 'retirada'` y su motivo intacto (caso 15). El historial
--     del club no se reescribe.
--   · LA RESOLUCIÓN NO ES DEL CLIENTE. Un `authenticated` no puede
--     ejecutar `resolver_revision_sancion` (caso 13), ni escribir a mano
--     en ninguna de las dos tablas nuevas (caso 19).
--   · EL TRUST SCORE NO SE MUEVE (caso 8). La sanción es del club, igual
--     que en la 47.
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
  v_adminC   uuid := gen_random_uuid();
  v_adminD   uuid := gen_random_uuid();
  v_adminE   uuid := gen_random_uuid();
  v_ambos    uuid := gen_random_uuid(); -- administra A y B
  v_ajeno    uuid := gen_random_uuid(); -- no pertenece a ninguno
  v_jugador  uuid := gen_random_uuid(); -- integrante de A sin rol, inscrito

  v_cA       uuid := gen_random_uuid();
  v_cB       uuid := gen_random_uuid();
  v_cC       uuid := gen_random_uuid();
  v_cD       uuid := gen_random_uuid();
  -- El quinto club existe por `club_challenges_unique_activo`, que es
  -- único sobre el PAR de clubes en los estados activos: el desafío
  -- pendiente que sirve para probar el bloqueo no puede ser entre A y D,
  -- porque A y D ya tienen un encuentro publicado.
  v_cE       uuid := gen_random_uuid();

  -- Encuentro 1: incomparecencia + revisión que RETIRA la sanción.
  v_ch1      uuid := gen_random_uuid();
  v_pr1      uuid := gen_random_uuid();
  v_m1       uuid := gen_random_uuid();
  -- Encuentro 2: incomparecencia + revisión que MANTIENE la sanción.
  v_ch2      uuid := gen_random_uuid();
  v_pr2      uuid := gen_random_uuid();
  v_m2       uuid := gen_random_uuid();
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
  v_rev1     uuid;
  v_rev2     uuid;
  v_rev3     uuid;
  v_san1     uuid;
  v_san2     uuid;
  v_ctx      jsonb;
  v_dias     int := (public.desafio_reglas() ->> 'sancion_dias')::int;
begin
  -- ── gente ─────────────────────────────────────────────────────
  insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,email_change,
    email_change_token_new,recovery_token)
  select '00000000-0000-0000-0000-000000000000',u,'authenticated','authenticated',
    'u47c-'||u||'@futfinder.test','x',now(),now(),now(),'{}','{}','','','',''
  from unnest(array[v_adminA, v_adminB, v_adminC, v_adminD, v_adminE,
                    v_ambos, v_ajeno, v_jugador]) u;

  -- ── clubes ────────────────────────────────────────────────────
  -- `premium` porque el plan estándar admite un solo administrador y el
  -- club A necesita dos (el suyo y el que administra los dos).
  insert into public.clubs (id, nombre, slug, plan, created_by)
  values (v_cA, 'Club A 47c', 'club-a-47c-'||left(v_cA::text,8), 'premium', v_adminA),
         (v_cB, 'Club B 47c', 'club-b-47c-'||left(v_cB::text,8), 'premium', v_adminB),
         (v_cC, 'Club C 47c', 'club-c-47c-'||left(v_cC::text,8), 'premium', v_adminC),
         (v_cD, 'Club D 47c', 'club-d-47c-'||left(v_cD::text,8), 'premium', v_adminD),
         (v_cE, 'Club E 47c', 'club-e-47c-'||left(v_cE::text,8), 'premium', v_adminE);

  insert into public.club_members (club_id, user_id, rol)
  values (v_cA, v_adminA, 'admin'), (v_cB, v_adminB, 'admin'),
         (v_cC, v_adminC, 'admin'), (v_cD, v_adminD, 'admin'),
         (v_cE, v_adminE, 'admin'),
         (v_cA, v_ambos, 'admin'),  (v_cB, v_ambos, 'admin'),
         (v_cA, v_jugador, 'jugador');

  -- ── los tres encuentros ───────────────────────────────────────
  -- Se crean TODOS antes de que exista ninguna sanción: con una encima,
  -- el trigger de la 47 impediría insertar el desafío y el arnés no
  -- podría probar lo que viene después.
  insert into public.club_challenges (id, club_retador_id, club_retado_id, creado_por, estado)
  values (v_ch1, v_cA, v_cB, v_adminA, 'publicado'),
         (v_ch2, v_cA, v_cC, v_adminA, 'publicado'),
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
    (v_pr2, v_ch2, v_cA, v_adminA, now() + interval '3 days', 90,
     'Av. Dos 2', 'Cancha Dos', 'Ñuñoa', 'Región Metropolitana de Santiago',
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
    (v_m2, v_adminA, 'A vs C', 'Ñuñoa', 'Región Metropolitana de Santiago',
     'Cancha Dos', -33.45, -70.60, now() + interval '3 days', 90, 14, 14, 'abierto',
     v_pr2, v_ch2, v_cA, v_cC, 7, 'orden_llegada', true),
    (v_m3, v_adminA, 'A vs D', 'Macul', 'Región Metropolitana de Santiago',
     'Cancha Tres', -33.48, -70.59, now() + interval '4 days', 90, 14, 14, 'abierto',
     v_pr3, v_ch3, v_cA, v_cD, 7, 'orden_llegada', true);

  update public.club_challenges set match_id = v_m1 where id = v_ch1;
  update public.club_challenges set match_id = v_m2 where id = v_ch2;
  update public.club_challenges set match_id = v_m3 where id = v_ch3;

  insert into public.attendees (id_partido, id_jugador, estado, club_id, origen)
  values (v_m1, v_jugador, 'inscrito', v_cA, 'orden_llegada');

  -- ══ CASO 1: las dos tablas existen y no se escriben desde el cliente ══
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
  insert into t47c values (1,'las tablas existen con RLS',
    'club_match_noshow_reports y club_sanction_reviews existen y tienen row level security');

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
  insert into t47c values (3,'motivo en blanco y con tope',
    '«   » y 301 caracteres se rechazan igual que el motivo ausente');

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
  insert into t47c values (4,'solo un administrador, y de un solo club',
    format('ajeno, jugador y doble pertenencia quedan fuera — «%s»', v_j->>'reason'));

  -- ══ CASO 5: antes de la hora del partido, nada ═══════════════
  -- El corte lo hace el reloj del servidor. Es la regla que impide
  -- «informar» una incomparecencia de un partido que todavía no empieza.
  update public.matches set hora = now() + interval '3 hours' where id = v_m1;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminB,'role','authenticated')::text);
  v_j := public.reportar_incomparecencia(v_ch1, 'sé que no van a llegar');
  execute 'reset role';
  if (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 5): se informó una incomparecencia antes de la hora del partido';
  end if;
  select count(*) into v_count from public.club_sanctions where club_id = v_cA;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 5): quedó una sanción de un partido que no ha empezado';
  end if;
  insert into t47c values (5,'sólo después de la hora',
    format('con el partido por delante no hay incomparecencia que informar — «%s»', v_j->>'reason'));

  -- ══ CASO 6: un encuentro cancelado no admite incomparecencia ══
  update public.matches set hora = now() - interval '2 hours', estado = 'cancelado' where id = v_m1;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminB,'role','authenticated')::text);
  v_j := public.reportar_incomparecencia(v_ch1, 'no llegaron');
  execute 'reset role';
  if (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 6): se informó una incomparecencia de un partido cancelado';
  end if;
  update public.matches set estado = 'abierto' where id = v_m1;
  insert into t47c values (6,'partido cancelado, sin incomparecencia',
    format('nadie falta a un partido que no se jugó — «%s»', v_j->>'reason'));

  -- ══ CASO 7: se informa, y la sanción nace PROVISIONAL ════════
  select trust_score into v_trust  from public.profiles where id = v_jugador;
  select trust_score into v_trust2 from public.profiles where id = v_adminA;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminB,'role','authenticated')::text);
  v_j := public.reportar_incomparecencia(v_ch1, 'no llegó nadie del club rival');
  execute 'reset role';
  if not (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 7): no se pudo informar la incomparecencia — %', v_j->>'reason';
  end if;

  select * into v_rep from public.club_match_noshow_reports where challenge_id = v_ch1;
  if not found then
    raise exception 'FALLÓ (caso 7): no quedó el informe de incomparecencia';
  end if;
  if v_rep.club_reportado_id <> v_cA or v_rep.club_reportante_id <> v_cB then
    raise exception 'FALLÓ (caso 7): el informe apunta al club equivocado';
  end if;

  select * into v_san from public.club_sanctions where club_id = v_cA;
  if not found then
    raise exception 'FALLÓ (caso 7): la incomparecencia no dejó sanción';
  end if;
  v_san1 := v_san.id;
  if v_san.estado <> 'provisional' then
    raise exception 'FALLÓ (caso 7): la sanción nació «%» y debería nacer provisional', v_san.estado;
  end if;
  if v_san.tipo <> 'incomparecencia' then
    raise exception 'FALLÓ (caso 7): la sanción quedó de tipo «%»', v_san.tipo;
  end if;
  if v_san.fin_at::date <> (v_san.inicio_at + make_interval(days => v_dias))::date then
    raise exception 'FALLÓ (caso 7): la sanción no dura % días', v_dias;
  end if;

  select estado, estado_previo_sancion into v_estado, v_texto
    from public.club_challenges where id = v_ch1;
  if v_estado <> 'bloqueado_sancion' then
    raise exception 'FALLÓ (caso 7): el desafío quedó en «%» y debería quedar bloqueado_sancion', v_estado;
  end if;
  if v_texto <> 'publicado' then
    raise exception 'FALLÓ (caso 7): estado_previo_sancion guardó «%» en vez de «publicado»', v_texto;
  end if;
  insert into t47c values (7,'incomparecencia informada',
    format('sanción provisional de %s días sobre el club que no se presentó, y el desafío congelado con su estado anterior guardado', v_dias));

  -- ══ CASO 8: el Trust Score no se mueve ═══════════════════════
  if (select trust_score from public.profiles where id = v_jugador) <> v_trust then
    raise exception 'FALLÓ (caso 8): la incomparecencia cambió el Trust Score del jugador inscrito';
  end if;
  if (select trust_score from public.profiles where id = v_adminA) <> v_trust2 then
    raise exception 'FALLÓ (caso 8): la incomparecencia cambió el Trust Score del administrador';
  end if;
  insert into t47c values (8,'la sanción es del club',
    'ni el jugador inscrito ni el administrador pierden un solo punto de Trust Score');

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

  -- ══ CASO 10: informar dos veces no duplica nada ══════════════
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
    raise exception 'FALLÓ (caso 10): quedaron % sanciones tras informar dos veces', v_count;
  end if;
  select count(*) into v_count from public.club_match_noshow_reports where challenge_id = v_ch1;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 10): quedaron % informes del mismo encuentro', v_count;
  end if;
  insert into t47c values (10,'idempotencia del informe',
    'informar dos veces devuelve «ya estaba», sin segunda sanción ni segundo informe');

  -- ══ CASO 11: el hilo queda de solo lectura mientras dura ═════
  -- Consecuencia buscada de `bloqueado_sancion`: no está en los estados
  -- activos de `desafio_reglas()`, así que `chat_puede_escribir_desafio`
  -- deja de dar permiso. La conversación se conserva y se sigue leyendo.
  if public.chat_puede_escribir_desafio(v_ch1, v_adminA) then
    raise exception 'FALLÓ (caso 11): el hilo sigue abierto para escribir con el desafío bloqueado';
  end if;
  if not public.chat_puede_ver_desafio(v_ch1, v_adminA) then
    raise exception 'FALLÓ (caso 11): el hilo dejó de verse, y debería conservarse como historial';
  end if;
  insert into t47c values (11,'el hilo se congela, no se borra',
    'con el desafío en bloqueado_sancion nadie escribe, pero los dos clubes siguen leyendo la conversación');

  -- ══ CASO 12: el club afectado pide la revisión ═══════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_ajeno,'role','authenticated')::text);
  v_j := public.solicitar_revision_sancion(v_ch1, 'no tengo nada que ver', null::uuid);
  execute 'reset role';
  if (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 12): un ajeno pidió la revisión de una sanción';
  end if;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.solicitar_revision_sancion(v_ch1,
      'Sí nos presentamos: el árbitro y el club rival llegaron a otra cancha', null::uuid);
  execute 'reset role';
  if not (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 12): el club sancionado no pudo pedir la revisión — %', v_j->>'reason';
  end if;
  v_rev1 := (v_j->>'reviewId')::uuid;

  select * into v_rev from public.club_sanction_reviews where id = v_rev1;
  if v_rev.estado <> 'pendiente' then
    raise exception 'FALLÓ (caso 12): la revisión nació «%» y debería nacer pendiente', v_rev.estado;
  end if;
  if v_rev.club_id <> v_cA or v_rev.sancion_id <> v_san1 then
    raise exception 'FALLÓ (caso 12): la revisión no quedó atada al club ni a la sanción';
  end if;

  -- El expediente: motivo, historial del partido, tiempos y eventos.
  v_ctx := v_rev.contexto;
  if v_ctx is null or v_ctx = '{}'::jsonb then
    raise exception 'FALLÓ (caso 12): la revisión no guardó contexto';
  end if;
  if v_ctx -> 'partido' ->> 'hora' is null then
    raise exception 'FALLÓ (caso 12): el contexto no guardó la hora del partido';
  end if;
  if v_ctx -> 'sancion' ->> 'motivo' is null then
    raise exception 'FALLÓ (caso 12): el contexto no guardó el motivo de la sanción';
  end if;
  if v_ctx -> 'tiempos' ->> 'capturado_at' is null then
    raise exception 'FALLÓ (caso 12): el contexto no guardó los tiempos';
  end if;
  if jsonb_array_length(coalesce(v_ctx -> 'eventos', '[]'::jsonb)) = 0 then
    raise exception 'FALLÓ (caso 12): el contexto no guardó ningún evento del hilo';
  end if;
  if v_ctx -> 'incomparecencia' ->> 'motivo' is null then
    raise exception 'FALLÓ (caso 12): el contexto no guardó el informe de incomparecencia';
  end if;
  insert into t47c values (12,'la revisión guarda el expediente',
    'motivo, partido, sanción, informe, tiempos y eventos del hilo quedan copiados en la fila de la revisión');

  -- ══ CASO 13: un authenticated NO resuelve revisiones ═════════
  -- Es el requisito central de la 5.2: la resolución no tiene interfaz
  -- porque no tiene permiso de cliente. Se prueba con el privilegio, no
  -- con una comprobación dentro del cuerpo: PostgreSQL corta antes de
  -- ejecutar la primera línea.
  v_err := null;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
    perform public.resolver_revision_sancion(v_rev1, 'retirar', 'me la retiro yo mismo');
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_err := SQLERRM;
  end;
  if v_err is null then
    raise exception 'FALLÓ (caso 13): un authenticated resolvió su propia revisión';
  end if;
  if v_err not ilike '%permission denied%' and v_err not ilike '%permiso denegado%' then
    raise exception 'FALLÓ (caso 13): falló por otra cosa, no por falta de privilegio — «%»', v_err;
  end if;
  if (select estado from public.club_sanction_reviews where id = v_rev1) <> 'pendiente' then
    raise exception 'FALLÓ (caso 13): la revisión cambió de estado pese al rechazo';
  end if;
  insert into t47c values (13,'la resolución no es del cliente',
    format('resolver_revision_sancion está revocada de authenticated — «%s»', v_err));

  -- El mismo corte para `anon`.
  v_err := null;
  begin
    execute 'set local role anon';
    perform public.resolver_revision_sancion(v_rev1, 'retirar', 'anónimo');
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_err := SQLERRM;
  end;
  if v_err is null then
    raise exception 'FALLÓ (caso 13): un anónimo resolvió una revisión';
  end if;

  -- ══ CASO 14: pedir dos veces la misma revisión no duplica ════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.solicitar_revision_sancion(v_ch1, 'insisto', null::uuid);
  execute 'reset role';
  select count(*) into v_count from public.club_sanction_reviews
   where challenge_id = v_ch1 and club_id = v_cA;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 14): quedaron % revisiones de la misma medida', v_count;
  end if;
  insert into t47c values (14,'una revisión por medida',
    'pedir la revisión dos veces devuelve la que ya estaba en curso');

  -- ══ CASO 15: retirar la sanción ══════════════════════════════
  -- Corre como dueño de la función, que es como la ejecutará una persona
  -- con `service_role` desde el panel de Supabase. Se limpian las claves
  -- del JWT antes: `reset role` devuelve el rol, pero `set local
  -- request.jwt.claims` sigue puesto hasta el final de la transacción, y
  -- desde el panel no hay ninguna sesión de usuario detrás.
  execute 'set local request.jwt.claims to ''{}''';
  v_j := public.resolver_revision_sancion(v_rev1, 'retirar', 'Se confirmó que la cancha estaba cambiada');
  if not (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 15): no se pudo retirar la sanción — %', v_j->>'reason';
  end if;

  select * into v_san from public.club_sanctions where id = v_san1;
  if not found then
    raise exception 'FALLÓ (caso 15): la sanción se BORRÓ en vez de quedar retirada';
  end if;
  if v_san.estado <> 'retirada' then
    raise exception 'FALLÓ (caso 15): la sanción quedó «%» y debería quedar retirada', v_san.estado;
  end if;
  if v_san.motivo is null or length(trim(v_san.motivo)) = 0 then
    raise exception 'FALLÓ (caso 15): se perdió el motivo de la sanción retirada';
  end if;

  select estado, estado_previo_sancion into v_estado, v_texto
    from public.club_challenges where id = v_ch1;
  if v_estado <> 'publicado' then
    raise exception 'FALLÓ (caso 15): el desafío quedó en «%» y debía volver a publicado', v_estado;
  end if;
  if v_texto is not null then
    raise exception 'FALLÓ (caso 15): estado_previo_sancion no se limpió — «%»', v_texto;
  end if;

  select * into v_rev from public.club_sanction_reviews where id = v_rev1;
  if v_rev.estado <> 'resuelta' or v_rev.decision <> 'retirada' then
    raise exception 'FALLÓ (caso 15): la revisión quedó «%»/«%»', v_rev.estado, v_rev.decision;
  end if;
  if v_rev.nota is null then
    raise exception 'FALLÓ (caso 15): no se guardó la nota de quien resolvió';
  end if;
  if v_rev.resuelta_at is null then
    raise exception 'FALLÓ (caso 15): no se guardó cuándo se resolvió';
  end if;
  insert into t47c values (15,'retirar no borra',
    'la fila queda con estado retirada y su motivo, el desafío vuelve a publicado y la revisión guarda decisión, nota y hora');

  -- ══ CASO 16: retirada la sanción, el club vuelve a operar ════
  if public.club_esta_sancionado(v_cA) then
    raise exception 'FALLÓ (caso 16): el club sigue bloqueado con la sanción retirada';
  end if;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  perform public.aceptar_desafio(v_ch4);
  execute 'reset role';
  if (select estado from public.club_challenges where id = v_ch4) <> 'negociacion' then
    raise exception 'FALLÓ (caso 16): el club no volvió a operar tras la revisión';
  end if;
  if not public.chat_puede_escribir_desafio(v_ch1, v_adminA) then
    raise exception 'FALLÓ (caso 16): el hilo del encuentro no se reabrió';
  end if;
  insert into t47c values (16,'la revisión desbloquea de verdad',
    'con la sanción retirada el club vuelve a aceptar desafíos y el hilo del encuentro se reabre');

  -- ══ CASO 17: el aviso y el evento de la resolución ═══════════
  select count(*) into v_count from public.notifications
   where type = 'club_revision_resuelta' and user_id = v_adminA;
  if v_count = 0 then
    raise exception 'FALLÓ (caso 17): nadie avisó al club de cómo terminó su revisión';
  end if;
  select count(*) into v_count from public.club_challenge_events
   where challenge_id = v_ch1 and tipo = 'revision_resuelta';
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 17): la bitácora tiene % resoluciones y debería tener 1', v_count;
  end if;
  select count(*) into v_count from public.club_challenge_events
   where challenge_id = v_ch1 and tipo = 'incomparecencia_reportada';
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 17): la incomparecencia no quedó en la bitácora del hilo';
  end if;
  select count(*) into v_count from public.club_challenge_events
   where challenge_id = v_ch1 and tipo = 'revision_solicitada';
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 17): la solicitud de revisión no quedó en la bitácora';
  end if;
  insert into t47c values (17,'todo queda escrito',
    'informe, solicitud y resolución dejan su evento en el hilo, y el club recibe el aviso del resultado');

  -- ══ CASO 18: mantener la sanción ═════════════════════════════
  update public.matches set hora = now() - interval '2 hours' where id = v_m2;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminC,'role','authenticated')::text);
  v_j := public.reportar_incomparecencia(v_ch2, 'no se presentaron y no avisaron');
  execute 'reset role';
  if not (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 18): no se pudo informar la segunda incomparecencia — %', v_j->>'reason';
  end if;
  v_san2 := (v_j->>'sancionId')::uuid;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.solicitar_revision_sancion(v_ch2, 'Tuvimos un choque en el camino', null::uuid);
  execute 'reset role';
  v_rev2 := (v_j->>'reviewId')::uuid;

  execute 'set local request.jwt.claims to ''{}''';
  v_j := public.resolver_revision_sancion(v_rev2, 'mantener', 'No hay prueba del impedimento');
  if not (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 18): no se pudo mantener la sanción — %', v_j->>'reason';
  end if;

  select * into v_san from public.club_sanctions where id = v_san2;
  if v_san.estado <> 'vigente' then
    raise exception 'FALLÓ (caso 18): mantener dejó la sanción en «%» y debía quedar vigente', v_san.estado;
  end if;
  if (select estado from public.club_challenges where id = v_ch2) <> 'bloqueado_sancion' then
    raise exception 'FALLÓ (caso 18): mantener devolvió el desafío a su estado anterior';
  end if;
  if (select decision from public.club_sanction_reviews where id = v_rev2) <> 'mantenida' then
    raise exception 'FALLÓ (caso 18): la revisión no quedó marcada como mantenida';
  end if;
  if not public.club_esta_sancionado(v_cA) then
    raise exception 'FALLÓ (caso 18): la sanción mantenida dejó de bloquear';
  end if;
  insert into t47c values (18,'mantener confirma la sanción',
    'la provisional pasa a vigente, el desafío sigue bloqueado y el club sigue sin poder operar');

  -- ══ CASO 19: resolver dos veces no cambia nada ═══════════════
  v_j := public.resolver_revision_sancion(v_rev2, 'retirar', 'me arrepentí');
  if not coalesce((v_j->>'already')::boolean, false) then
    raise exception 'FALLÓ (caso 19): una revisión resuelta se volvió a resolver';
  end if;
  if (select estado from public.club_sanctions where id = v_san2) <> 'vigente' then
    raise exception 'FALLÓ (caso 19): la segunda resolución cambió la sanción';
  end if;
  insert into t47c values (19,'la resolución es única',
    'volver a resolver devuelve «ya estaba» y no reabre la sanción');

  -- ══ CASO 20: revisar una CANCELACIÓN sin sanción ═════════════
  -- «Solicitar revisión» tiene que estar disponible ante cualquier
  -- cancelación, aunque no haya dejado sanción: es la que sufre el club
  -- rival, que se quedó sin partido.
  update public.matches set hora = now() + interval '4 days' where id = v_m3;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.cancelar_encuentro_club(v_ch3, 'no conseguimos cancha');
  execute 'reset role';
  if not (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 20): no se pudo cancelar el tercer encuentro — %', v_j->>'reason';
  end if;
  if (v_j->>'sanciona')::boolean then
    raise exception 'FALLÓ (caso 20): cancelar con 4 días de aviso sancionó';
  end if;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminD,'role','authenticated')::text);
  v_j := public.solicitar_revision_sancion(v_ch3, 'Nos dejaron sin partido a última hora', null::uuid);
  execute 'reset role';
  if not (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 20): el club afectado no pudo pedir la revisión de una cancelación — %', v_j->>'reason';
  end if;
  v_rev3 := (v_j->>'reviewId')::uuid;
  execute 'set local request.jwt.claims to ''{}''';
  select * into v_rev from public.club_sanction_reviews where id = v_rev3;
  if v_rev.tipo <> 'cancelacion' then
    raise exception 'FALLÓ (caso 20): la revisión quedó de tipo «%»', v_rev.tipo;
  end if;
  if v_rev.sancion_id is not null then
    raise exception 'FALLÓ (caso 20): la revisión de una cancelación se ató a una sanción';
  end if;
  if v_rev.contexto -> 'partido' ->> 'motivo_cancelacion' is null then
    raise exception 'FALLÓ (caso 20): el contexto no guardó el motivo de la cancelación';
  end if;

  -- Retirar no tiene sentido sin sanción: se dice, no se finge.
  v_j := public.resolver_revision_sancion(v_rev3, 'retirar', 'no hay nada que retirar');
  if (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 20): se «retiró» una sanción que no existe';
  end if;
  v_j := public.resolver_revision_sancion(v_rev3, 'mantener', 'La cancelación fue con aviso suficiente');
  if not (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 20): no se pudo cerrar la revisión de la cancelación — %', v_j->>'reason';
  end if;
  insert into t47c values (20,'también se revisa una cancelación',
    'el club que se quedó sin partido pide revisión aunque no haya sanción, y «retirar» se rechaza porque no hay qué retirar');

  -- ══ CASO 21: ninguna de las dos tablas se escribe a mano ═════
  v_err := null;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
    insert into public.club_sanction_reviews (club_id, challenge_id, tipo, motivo)
    values (v_cA, v_ch2, 'sancion', 'me la reviso yo');
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_err := SQLERRM;
  end;
  if v_err is null then
    raise exception 'FALLÓ (caso 21): un authenticated insertó una revisión a mano';
  end if;

  v_err := null;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminB,'role','authenticated')::text);
    insert into public.club_match_noshow_reports (challenge_id, match_id, club_reportante_id, club_reportado_id, motivo)
    values (v_ch2, v_m2, v_cB, v_cA, 'informe a mano');
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_err := SQLERRM;
  end;
  if v_err is null then
    raise exception 'FALLÓ (caso 21): un authenticated insertó un informe a mano';
  end if;

  v_err := null;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
    update public.club_sanction_reviews set estado = 'resuelta', decision = 'retirada' where id = v_rev2;
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_err := SQLERRM;
  end;
  if v_err is null and (select decision from public.club_sanction_reviews where id = v_rev2) <> 'mantenida' then
    raise exception 'FALLÓ (caso 21): un authenticated cambió la decisión de su revisión';
  end if;
  insert into t47c values (21,'sólo las RPC escriben',
    'insertar o modificar informes y revisiones desde el cliente queda cortado por privilegios y RLS');

  -- ══ CASO 22: cada club lee lo suyo y nada más ════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  select count(*) into v_count from public.club_sanction_reviews where club_id = v_cA;
  execute 'reset role';
  if v_count = 0 then
    raise exception 'FALLÓ (caso 22): el club no puede leer su propia revisión';
  end if;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_ajeno,'role','authenticated')::text);
  select count(*) into v_count from public.club_sanction_reviews;
  execute 'reset role';
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 22): un ajeno leyó % revisiones', v_count;
  end if;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_ajeno,'role','authenticated')::text);
  select count(*) into v_count from public.club_match_noshow_reports;
  execute 'reset role';
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 22): un ajeno leyó % informes de incomparecencia', v_count;
  end if;
  insert into t47c values (22,'la lectura es de los involucrados',
    'los integrantes de los clubes del encuentro leen informes y revisiones; un ajeno no ve ninguna fila');
end;
$$;

select n, caso, detalle from t47c order by n;

rollback;
