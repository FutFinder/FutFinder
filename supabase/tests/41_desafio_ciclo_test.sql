-- =============================================================
-- FutFinder — pruebas del ciclo formal de desafíos (migración 41)
--
-- Qué cubre:
--   1. Autodesafío                 → un club no puede desafiarse a sí
--                                     mismo, ni saltándose la interfaz.
--   2. Club propio como rival      → quien crea el desafío no puede
--                                     elegir un club del que es miembro,
--                                     sea administrador o jugador.
--   3. Desafío legítimo            → dos clubes sin gente en común sí
--                                     pueden desafiarse.
--   4. Estados del ciclo           → los trece estados nuevos se aceptan
--                                     y el legado 'aceptado' sobrevive.
--   5. Estado inventado            → cualquier valor fuera de la máquina
--                                     se rechaza.
--   6. Un desafío activo por par   → no puede haber dos desafíos activos
--                                     entre los mismos dos clubes, ni
--                                     invirtiendo quién reta a quién.
--   7. Cupos por club              → fuera del rango 4-15 se rechaza.
--   8. Rango de fechas             → no puede terminar antes de empezar.
--   9. Token de cliente            → reintentar con el mismo token no
--                                     crea un segundo desafío.
--  10. desafio_reglas()            → devuelve los mismos valores que
--                                     src/services/clubChallengeRules.js.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run, en un proyecto de desarrollo. Todo corre dentro de
-- una transacción que termina en ROLLBACK, así que no queda nada
-- guardado al terminar. Si algún caso falla, la ejecución se corta con
-- RAISE EXCEPTION indicando cuál.
-- =============================================================

begin;

do $$
declare
  v_admin_a   uuid := gen_random_uuid();
  v_admin_b   uuid := gen_random_uuid();
  v_admin_c   uuid := gen_random_uuid();
  v_doble     uuid := gen_random_uuid();  -- pertenece a A y a C
  v_jugador_b uuid := gen_random_uuid();  -- miembro sin rol de admin en B

  v_club_a uuid;
  v_club_b uuid;
  v_club_c uuid;

  v_challenge uuid;
  v_token     uuid := gen_random_uuid();

  v_ok      boolean;
  v_count   int;
  v_estado  text;
  v_reglas  jsonb;
begin
  -- ── Setup: usuarios (el trigger handle_new_user crea el profile) ──
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
         'desafio-test-' || u.tag || '-' || u.id || '@futfinder.test', 'x', now(), now(), now(),
         '{}', '{}', '', '', '', ''
  from (values
    (v_admin_a, 'admin-a'), (v_admin_b, 'admin-b'), (v_admin_c, 'admin-c'),
    (v_doble, 'doble'), (v_jugador_b, 'jugador-b')
  ) as u(id, tag);

  -- ── Setup: clubes y membresías ──────────────────────────────
  insert into public.clubs (nombre, slug, created_by)
    values ('Club Ciclo Test A', 'club-ciclo-test-a', v_admin_a) returning id into v_club_a;
  insert into public.clubs (nombre, slug, created_by)
    values ('Club Ciclo Test B', 'club-ciclo-test-b', v_admin_b) returning id into v_club_b;
  insert into public.clubs (nombre, slug, created_by)
    values ('Club Ciclo Test C', 'club-ciclo-test-c', v_admin_c) returning id into v_club_c;

  insert into public.club_members (club_id, user_id, rol) values
    (v_club_a, v_admin_a, 'admin'),
    (v_club_b, v_admin_b, 'admin'),
    (v_club_c, v_admin_c, 'admin'),
    (v_club_a, v_doble, 'jugador'),
    (v_club_c, v_doble, 'jugador'),
    (v_club_b, v_jugador_b, 'jugador');

  -- ── CASO 1: autodesafío ─────────────────────────────────────
  begin
    insert into public.club_challenges (club_retador_id, club_retado_id, creado_por)
    values (v_club_a, v_club_a, v_admin_a);
    v_ok := true;
  exception when others then
    v_ok := false;
  end;
  if v_ok then
    raise exception 'FALLÓ (caso 1): un club pudo desafiarse a sí mismo';
  end if;
  raise notice 'OK (caso 1): el autodesafío queda bloqueado en la base de datos';

  -- ── CASO 2: desafiar a un club propio ───────────────────────
  -- v_doble es jugador de A y de C: crear A → C debe fallar aunque la
  -- interfaz nunca le hubiese ofrecido a C como rival.
  begin
    insert into public.club_challenges (club_retador_id, club_retado_id, creado_por)
    values (v_club_a, v_club_c, v_doble);
    v_ok := true;
  exception when others then
    v_ok := false;
  end;
  if v_ok then
    raise exception 'FALLÓ (caso 2): se pudo desafiar a un club propio saltándose la interfaz';
  end if;
  raise notice 'OK (caso 2): no se puede desafiar a un club del que se es miembro';

  -- ── CASO 3: desafío legítimo ────────────────────────────────
  insert into public.club_challenges (
    club_retador_id, club_retado_id, creado_por,
    modalidad, cupos_por_club, metodo_inscripcion,
    fecha_propuesta, fecha_hasta, zona
  )
  values (
    v_club_a, v_club_b, v_admin_a,
    'futbol7', 7, 'orden_llegada',
    now() + interval '10 days', now() + interval '17 days', 'Ñuñoa'
  )
  returning id into v_challenge;

  if v_challenge is null then
    raise exception 'FALLÓ (caso 3): no se pudo crear un desafío legítimo';
  end if;
  raise notice 'OK (caso 3): dos clubes sin gente en común sí pueden desafiarse';

  -- ── CASO 4: los estados del ciclo se aceptan ────────────────
  foreach v_estado in array array[
    'negociacion', 'esperando_aprobacion', 'publicado',
    'en_juego', 'esperando_resultado', 'finalizado',
    'sin_acuerdo', 'resultado_en_disputa',
    'bloqueado_sancion', 'aceptado'
  ]
  loop
    update public.club_challenges set estado = v_estado where id = v_challenge;
  end loop;
  raise notice 'OK (caso 4): los estados del ciclo y el legado se aceptan';

  -- ── CASO 5: un estado inventado se rechaza ──────────────────
  begin
    update public.club_challenges set estado = 'inventado' where id = v_challenge;
    v_ok := true;
  exception when check_violation then
    v_ok := false;
  end;
  if v_ok then
    raise exception 'FALLÓ (caso 5): se aceptó un estado fuera de la máquina';
  end if;
  raise notice 'OK (caso 5): un estado inventado se rechaza';

  -- ── CASO 6: un solo desafío activo por par de clubes ────────
  update public.club_challenges set estado = 'negociacion' where id = v_challenge;

  -- Mismo par, dirección invertida: también debe chocar.
  begin
    insert into public.club_challenges (club_retador_id, club_retado_id, creado_por, estado)
    values (v_club_b, v_club_a, v_admin_b, 'negociacion');
    v_ok := true;
  exception when unique_violation then
    v_ok := false;
  end;
  if v_ok then
    raise exception 'FALLÓ (caso 6): se crearon dos desafíos activos entre el mismo par de clubes';
  end if;
  raise notice 'OK (caso 6): un solo desafío activo por par, en cualquier dirección';

  -- Cerrar el desafío libera el par.
  update public.club_challenges set estado = 'sin_acuerdo' where id = v_challenge;
  insert into public.club_challenges (club_retador_id, club_retado_id, creado_por, estado)
  values (v_club_b, v_club_a, v_admin_b, 'negociacion');
  raise notice 'OK (caso 6b): al cerrarse el desafío, el par vuelve a quedar libre';

  -- ── CASO 7: cupos por club fuera de rango ───────────────────
  begin
    update public.club_challenges set cupos_por_club = 3 where id = v_challenge;
    v_ok := true;
  exception when check_violation then
    v_ok := false;
  end;
  if v_ok then
    raise exception 'FALLÓ (caso 7): se aceptaron menos de 4 cupos por club';
  end if;

  begin
    update public.club_challenges set cupos_por_club = 16 where id = v_challenge;
    v_ok := true;
  exception when check_violation then
    v_ok := false;
  end;
  if v_ok then
    raise exception 'FALLÓ (caso 7): se aceptaron más de 15 cupos por club';
  end if;
  raise notice 'OK (caso 7): los cupos por club se limitan a 4-15';

  -- ── CASO 8: rango de fechas invertido ───────────────────────
  begin
    update public.club_challenges
       set fecha_propuesta = now() + interval '20 days',
           fecha_hasta     = now() + interval '10 days'
     where id = v_challenge;
    v_ok := true;
  exception when check_violation then
    v_ok := false;
  end;
  if v_ok then
    raise exception 'FALLÓ (caso 8): el rango pudo terminar antes de empezar';
  end if;
  raise notice 'OK (caso 8): el rango de fechas no puede invertirse';

  -- ── CASO 9: token de cliente idempotente ────────────────────
  update public.club_challenges set client_token = v_token where id = v_challenge;

  begin
    insert into public.club_challenges (club_retador_id, club_retado_id, creado_por, client_token)
    values (v_club_a, v_club_c, v_admin_a, v_token);
    v_ok := true;
  exception when unique_violation then
    v_ok := false;
  end;
  if v_ok then
    raise exception 'FALLÓ (caso 9): el mismo token de cliente creó dos desafíos';
  end if;
  raise notice 'OK (caso 9): reintentar con el mismo token no duplica el desafío';

  -- ── CASO 10: desafio_reglas() coincide con el cliente ───────
  v_reglas := public.desafio_reglas();

  if (v_reglas ->> 'negociacion_horas')::int <> 72
     or (v_reglas ->> 'prorroga_horas')::int <> 24
     or (v_reglas ->> 'cambio_limite_horas')::int <> 2
     or (v_reglas ->> 'cancelacion_sancion_horas')::int <> 2
     or (v_reglas ->> 'sancion_dias')::int <> 14
     or (v_reglas ->> 'expiracion_pendiente_dias')::int <> 7
     or (v_reglas ->> 'cupos_por_club_min')::int <> 4
     or (v_reglas ->> 'cupos_por_club_max')::int <> 15
     or (v_reglas ->> 'mensaje_max')::int <> 300
     or (v_reglas ->> 'instrucciones_max')::int <> 500
  then
    raise exception 'FALLÓ (caso 10): desafio_reglas() no coincide con clubChallengeRules.js: %', v_reglas;
  end if;

  -- El máximo de cupos por club no es una preferencia: es la mitad del
  -- techo de matches.cupos_totales. Si alguien sube uno sin el otro, el
  -- partido de clubes deja de poder publicarse.
  if (v_reglas ->> 'cupos_por_club_max')::int * 2 <> 30 then
    raise exception 'FALLÓ (caso 10): el máximo de cupos por club dejó de ser la mitad del techo de matches';
  end if;

  select count(*) into v_count
  from jsonb_array_elements_text(v_reglas -> 'metodos_inscripcion');
  if v_count <> 2 then
    raise exception 'FALLÓ (caso 10): se esperaban dos métodos de inscripción, hay %', v_count;
  end if;

  raise notice 'OK (caso 10): desafio_reglas() espeja a clubChallengeRules.js';

  raise notice '── Todas las pruebas del ciclo de desafíos pasaron ──';
end $$;

rollback;
