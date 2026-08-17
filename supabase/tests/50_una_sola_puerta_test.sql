-- =============================================================
-- FutFinder — pruebas de la migración 50: el encuentro entre clubes
-- tiene una sola puerta, y el rechazo del resultado dejó de invitar a
-- proponer otro.
--
-- QUÉ SE PRUEBA:
--
--   · `save_match_attendance()` RECHAZA un partido nacido de una
--     propuesta entre clubes, con el motivo que lo explica, y NO deja
--     rastro: el partido no queda `finalizado`, el inscrito sigue
--     `inscrito` y su Trust Score no se mueve (casos 1 y 2).
--   · Y SIGUE FUNCIONANDO IGUAL en un partido normal: cierra el partido
--     y mueve el Trust Score de presentes y ausentes (caso 3).
--   · `cancel_match()` RECHAZA un partido entre clubes y lo deja vivo
--     (caso 4), y sigue cancelando un partido normal con su
--     penalización personal de siempre (caso 5).
--   · RECHAZAR UN RESULTADO ya no manda a nadie a proponer otro: el
--     aviso `club_resultado_disputado` no dice «Propongan uno nuevo»,
--     habla de la disputa y de la moderación (caso 6), y el motivo de
--     error al confirmar algo ya rechazado tampoco lo dice (caso 7).
--   · LA REGLA DE LA 48b SIGUE VIVA: con el desafío en
--     `resultado_en_disputa`, proponer otra vez se rechaza (caso 8).
--     Ya lo cubre `48_resultado_test.sql` (caso 11); se repite acá
--     porque los textos de la 50 sólo son correctos si la guarda sigue
--     donde estaba.
--
-- POR QUÉ SE EXIGE EL MOTIVO Y NO CUALQUIER ERROR: un fallo de RLS, de
-- plazo o de permiso daría los casos 1 y 4 por buenos sin haber probado
-- la guarda nueva. Por eso los partidos se preparan DENTRO de la ventana
-- de las 72 horas de asistencia y con el organizador correcto: lo único
-- que puede hacerlos fallar es la guarda de la 50.
--
-- Requiere las migraciones 33, 34, 41 a 49 y la 50 aplicadas, o la 50
-- corrida dentro de la misma transacción que este arnés.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor.
-- Todo corre en una transacción que termina en ROLLBACK.
-- =============================================================

begin;

create temp table t50 (n integer, caso text, detalle text) on commit drop;

do $$
declare
  v_adminA  uuid := gen_random_uuid(); -- admin del club A y organizador del encuentro
  v_adminB  uuid := gen_random_uuid(); -- admin del club B, el que confirma
  v_jugA    uuid := gen_random_uuid(); -- inscrito del club A
  v_jugB    uuid := gen_random_uuid(); -- inscrito del club B
  v_orgN    uuid := gen_random_uuid(); -- organizador de los partidos normales
  v_jugN    uuid := gen_random_uuid(); -- inscrito del partido normal jugado
  v_jugN2   uuid := gen_random_uuid(); -- inscrito del partido normal por cancelar

  v_cA uuid := gen_random_uuid();
  v_cB uuid := gen_random_uuid();

  v_ch  uuid := gen_random_uuid();
  v_pr  uuid := gen_random_uuid();
  v_mC  uuid := gen_random_uuid(); -- partido ENTRE CLUBES, ya jugado
  v_mN  uuid := gen_random_uuid(); -- partido NORMAL, ya jugado
  v_mN2 uuid := gen_random_uuid(); -- partido NORMAL, todavía por jugarse

  v_j       json;
  v_jb      jsonb;
  v_estado  text;
  v_trust   int;
  v_body    text;
  v_res     uuid;
  v_recv    int;
  v_rece    int;
  v_recd    int;
begin
  -- ── gente ─────────────────────────────────────────────────────
  insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,email_change,
    email_change_token_new,recovery_token)
  select '00000000-0000-0000-0000-000000000000',u,'authenticated','authenticated',
    'u50-'||u||'@futfinder.test','x',now(),now(),now(),'{}','{}','','','',''
  from unnest(array[v_adminA, v_adminB, v_jugA, v_jugB, v_orgN, v_jugN, v_jugN2]) u;

  insert into public.clubs (id, nombre, slug, plan, created_by)
  values (v_cA, 'Club A 50', 'club-a-50-'||left(v_cA::text,8), 'estandar', v_adminA),
         (v_cB, 'Club B 50', 'club-b-50-'||left(v_cB::text,8), 'estandar', v_adminB);

  insert into public.club_members (club_id, user_id, rol)
  values (v_cA, v_adminA, 'admin'), (v_cB, v_adminB, 'admin'),
         (v_cA, v_jugA, 'jugador'), (v_cB, v_jugB, 'jugador');

  -- ── el encuentro entre clubes, ya jugado y esperando resultado ──
  insert into public.club_challenges (id, club_retador_id, club_retado_id, creado_por, estado)
  values (v_ch, v_cA, v_cB, v_adminA, 'esperando_resultado');

  insert into public.club_challenge_proposals (
      id, challenge_id, club_proponente_id, creada_por, fecha, duracion_min,
      direccion, cancha_nombre, comuna, region, latitud, longitud,
      modalidad, cupos_por_club, metodo_inscripcion, cuota_por_persona, estado)
  values (v_pr, v_ch, v_cA, v_adminA, now() + interval '2 days', 90,
     'Av. Diez 10', 'Cancha Diez', 'Providencia', 'Región Metropolitana de Santiago',
     -33.42, -70.61, 'futbol7', 7, 'orden_llegada', 0, 'aprobada');

  -- `trg_match_future_only` rechaza una hora pasada al insertar; el
  -- `update` de después sí puede moverla al pasado.
  insert into public.matches (
      id, id_organizador, titulo, comuna, region, cancha_nombre, latitud, longitud,
      hora, duracion_min, cupos_totales, cupos_disponibles, estado,
      challenge_proposal_id, challenge_id, club_local_id, club_visitante_id,
      cupos_por_club, metodo_inscripcion, ubicacion_aproximada)
  values (v_mC, v_adminA, 'A vs B (50)', 'Providencia', 'Región Metropolitana de Santiago',
     'Cancha Diez', -33.42, -70.61, now() + interval '2 days', 90, 14, 12, 'abierto',
     v_pr, v_ch, v_cA, v_cB, 7, 'orden_llegada', true);

  -- Ya se jugó: terminó hace hora y media y la ventana de asistencia
  -- (72 h) está abierta. Así lo ÚNICO que puede rechazar la llamada es
  -- la guarda de la 50.
  update public.matches set hora = now() - interval '3 hours' where id = v_mC;
  update public.club_challenges set match_id = v_mC where id = v_ch;

  insert into public.attendees (id_partido, id_jugador, estado, club_id, origen)
  values (v_mC, v_jugA, 'inscrito', v_cA, 'orden_llegada'),
         (v_mC, v_jugB, 'inscrito', v_cB, 'orden_llegada');

  -- ── un partido NORMAL ya jugado, y otro por jugarse ────────────
  insert into public.matches (
      id, id_organizador, titulo, comuna, region, cancha_nombre, latitud, longitud,
      hora, duracion_min, cupos_totales, cupos_disponibles, estado)
  values (v_mN, v_orgN, 'Pichanga normal (50)', 'Ñuñoa', 'Región Metropolitana de Santiago',
     'Cancha Once', -33.45, -70.60, now() + interval '3 days', 90, 10, 8, 'abierto'),
         (v_mN2, v_orgN, 'Pichanga por cancelar (50)', 'Ñuñoa', 'Región Metropolitana de Santiago',
     'Cancha Doce', -33.46, -70.62, now() + interval '9 days', 90, 10, 9, 'abierto');

  update public.matches set hora = now() - interval '3 hours' where id = v_mN;

  insert into public.attendees (id_partido, id_jugador, estado)
  values (v_mN, v_jugN, 'inscrito'), (v_mN2, v_jugN2, 'inscrito');

  -- ══ CASO 1: la asistencia de un partido de clubes se rechaza ═══
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_jb := public.save_match_attendance(v_mC, jsonb_build_object(v_jugB::text, 'ausente'));
  execute 'reset role';
  if (v_jb->>'ok')::boolean is not false then
    raise exception 'FALLÓ (caso 1): save_match_attendance aceptó un partido entre clubes — %', v_jb;
  end if;
  if position('entre clubes' in coalesce(v_jb->>'reason','')) = 0 then
    raise exception 'FALLÓ (caso 1): se rechazó por otra razón, no por la guarda: %', v_jb->>'reason';
  end if;
  insert into t50 values (1, 'asistencia de un partido de clubes',
    'save_match_attendance la rechaza con su propio motivo, no con un error cualquiera');

  -- ══ CASO 2: y no dejó rastro ══════════════════════════════════
  select estado into v_estado from public.matches where id = v_mC;
  if v_estado = 'finalizado' then
    raise exception 'FALLÓ (caso 2): el partido de clubes quedó finalizado sin resultado confirmado';
  end if;
  select estado into v_estado from public.attendees where id_partido = v_mC and id_jugador = v_jugB;
  if v_estado <> 'inscrito' then
    raise exception 'FALLÓ (caso 2): el inscrito del club rival quedó como %', v_estado;
  end if;
  select trust_score into v_trust from public.profiles where id = v_jugB;
  if v_trust <> 100 then
    raise exception 'FALLÓ (caso 2): el jugador del club rival perdió Trust Score (%)', v_trust;
  end if;
  insert into t50 values (2, 'sin rastro',
    'el partido no quedó finalizado, el inscrito sigue inscrito y su Trust Score sigue en 100');

  -- ══ CASO 3: el partido normal sigue funcionando igual ══════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_orgN,'role','authenticated')::text);
  v_jb := public.save_match_attendance(v_mN, jsonb_build_object(v_jugN::text, 'ausente'));
  execute 'reset role';
  if (v_jb->>'ok')::boolean is not true then
    raise exception 'FALLÓ (caso 3): la asistencia de un partido normal dejó de funcionar — %', v_jb;
  end if;
  select estado into v_estado from public.matches where id = v_mN;
  if v_estado <> 'finalizado' then
    raise exception 'FALLÓ (caso 3): el partido normal no quedó finalizado, quedó %', v_estado;
  end if;
  select trust_score into v_trust from public.profiles where id = v_jugN;
  if v_trust <> 85 then
    raise exception 'FALLÓ (caso 3): el ausente de un partido normal debería quedar en 85, quedó %', v_trust;
  end if;
  insert into t50 values (3, 'partido normal',
    'cierra el partido y el ausente pierde sus 15 puntos, exactamente como antes de la 50');

  -- ══ CASO 4: cancelar un partido de clubes se rechaza ═══════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_jb := public.cancel_match(v_mC);
  execute 'reset role';
  if (v_jb->>'ok')::boolean is not false then
    raise exception 'FALLÓ (caso 4): cancel_match aceptó un partido entre clubes — %', v_jb;
  end if;
  if position('entre clubes' in coalesce(v_jb->>'reason','')) = 0 then
    raise exception 'FALLÓ (caso 4): se rechazó por otra razón: %', v_jb->>'reason';
  end if;
  select estado into v_estado from public.matches where id = v_mC;
  if v_estado = 'cancelado' then
    raise exception 'FALLÓ (caso 4): el encuentro entre clubes quedó cancelado por la puerta de atrás';
  end if;
  select trust_score into v_trust from public.profiles where id = v_adminA;
  if v_trust <> 100 then
    raise exception 'FALLÓ (caso 4): el administrador perdió Trust Score (%) por un intento rechazado', v_trust;
  end if;
  insert into t50 values (4, 'cancelar un partido de clubes',
    'cancel_match lo rechaza, el partido sigue vivo y nadie pierde Trust Score');

  -- ══ CASO 5: cancelar un partido normal sigue igual ═════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_orgN,'role','authenticated')::text);
  v_jb := public.cancel_match(v_mN2);
  execute 'reset role';
  if (v_jb->>'ok')::boolean is not true then
    raise exception 'FALLÓ (caso 5): cancelar un partido normal dejó de funcionar — %', v_jb;
  end if;
  select estado into v_estado from public.matches where id = v_mN2;
  if v_estado <> 'cancelado' then
    raise exception 'FALLÓ (caso 5): el partido normal no quedó cancelado, quedó %', v_estado;
  end if;
  select trust_score into v_trust from public.profiles where id = v_orgN;
  if v_trust <> 85 then
    raise exception 'FALLÓ (caso 5): el organizador debería quedar en 85 (penalización temprana), quedó %', v_trust;
  end if;
  insert into t50 values (5, 'cancelar un partido normal',
    'sigue cancelándose y el organizador conserva su penalización personal de siempre');

  -- ══ CASO 6: el aviso del rechazo ya no invita a proponer otro ══
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.proponer_resultado(v_ch, 3, 1, null);
  execute 'reset role';
  if (v_j->>'ok')::boolean is not true then
    raise exception 'FALLÓ (caso 6): no se pudo proponer el resultado — %', v_j->>'reason';
  end if;
  v_res := (v_j->>'resultId')::uuid;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminB,'role','authenticated')::text);
  v_j := public.confirmar_resultado(v_res, false);
  execute 'reset role';
  if (v_j->>'ok')::boolean is not true then
    raise exception 'FALLÓ (caso 6): no se pudo rechazar el resultado — %', v_j->>'reason';
  end if;

  select estado into v_estado from public.club_challenges where id = v_ch;
  if v_estado <> 'resultado_en_disputa' then
    raise exception 'FALLÓ (caso 6): el desafío quedó en % y no en resultado_en_disputa', v_estado;
  end if;

  select body into v_body
    from public.notifications
   where type = 'club_resultado_disputado' and user_id = v_adminA
   order by created_at desc limit 1;
  if v_body is null then
    raise exception 'FALLÓ (caso 6): el rechazo no avisó al club proponente';
  end if;
  if position('Propongan uno nuevo' in v_body) > 0 then
    raise exception 'FALLÓ (caso 6): el aviso sigue pidiendo proponer otro resultado: %', v_body;
  end if;
  if position('disputa' in v_body) = 0 or position('moderación' in v_body) = 0 then
    raise exception 'FALLÓ (caso 6): el aviso no explica que queda en disputa hasta la moderación: %', v_body;
  end if;
  insert into t50 values (6, 'aviso del rechazo',
    'habla de la disputa y de la moderación, y ya no manda a proponer un resultado que el servidor rechaza');

  -- ══ CASO 7: el motivo de error tampoco lo dice ════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminB,'role','authenticated')::text);
  v_j := public.confirmar_resultado(v_res, true);
  execute 'reset role';
  if (v_j->>'ok')::boolean is not false then
    raise exception 'FALLÓ (caso 7): se confirmó un resultado ya rechazado — %', v_j;
  end if;
  if position('propongan uno nuevo' in lower(coalesce(v_j->>'reason',''))) > 0 then
    raise exception 'FALLÓ (caso 7): el motivo sigue invitando a proponer otro: %', v_j->>'reason';
  end if;
  if position('moderación' in coalesce(v_j->>'reason','')) = 0 then
    raise exception 'FALLÓ (caso 7): el motivo no nombra a la moderación: %', v_j->>'reason';
  end if;
  insert into t50 values (7, 'motivo al confirmar un rechazado',
    'dice que el encuentro está en disputa y que sólo la moderación lo reabre');

  -- ══ CASO 8: la regla de la 48b sigue en su lugar ══════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.proponer_resultado(v_ch, 2, 2, null);
  execute 'reset role';
  if (v_j->>'ok')::boolean is not false then
    raise exception 'FALLÓ (caso 8): en disputa se pudo proponer un resultado nuevo — %', v_j;
  end if;
  select v, e, d into v_recv, v_rece, v_recd from public.club_record(v_cA);
  if v_recv <> 0 or v_rece <> 0 or v_recd <> 0 then
    raise exception 'FALLÓ (caso 8): un rechazo movió el récord del club: %-%-%', v_recv, v_rece, v_recd;
  end if;
  insert into t50 values (8, 'la 48b sigue viva',
    'con el desafío en disputa nadie propone otro resultado, y el récord del club sigue en 0-0-0');
end;
$$;

select n, caso, detalle from t50 order by n;

rollback;
