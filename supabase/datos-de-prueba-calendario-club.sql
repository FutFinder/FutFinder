-- Datos de prueba para el calendario de partidos del club "Los Xupa Rrazo".
--
-- ESTE ARCHIVO NO ES UNA MIGRACIÓN NI UNA PRUEBA AUTOMATIZADA. No vive en
-- `migrations/` (no cambia el esquema) ni en `tests/` (no hace `rollback` —
-- deja los datos puestos a propósito, para poder abrir la app y ver el
-- calendario con partidos de verdad). Ejecútalo tú mismo, una sola vez,
-- desde el editor SQL de Supabase o con:
--
--   supabase db execute -f supabase/datos-de-prueba-calendario-club.sql
--
-- Crea:
--   - un club rival de prueba nuevo ("Rival de Prueba FC"), con su propio
--     admin de prueba (no toca ningún club ni usuario real más que "Los
--     Xupa Rrazo", que sólo se LEE para tomar su id y su administrador)
--   - 2 desafíos ya jugados y confirmados (uno ganado, uno perdido), para
--     probar el historial
--   - 2 desafíos programados a futuro, para probar lo que viene
--
-- Requiere que el club "Los Xupa Rrazo" ya exista (créalo desde la app si
-- todavía no existe) y que tenga al menos un administrador real.
--
-- Para deshacer esto más adelante, hay un bloque de limpieza comentado al
-- final del archivo.

begin;

do $$
declare
  v_mi_club      uuid;
  v_mi_admin     uuid;
  v_rival_club   uuid := gen_random_uuid();
  v_rival_admin  uuid := gen_random_uuid();
  v_slug_rival   text;
  v_desafio1     uuid := gen_random_uuid(); -- pasado, local: Los Xupa Rrazo, ganado 3-1
  v_desafio2     uuid := gen_random_uuid(); -- pasado, visitante: Los Xupa Rrazo, perdido 1-2
  v_desafio3     uuid := gen_random_uuid(); -- futuro, local: Los Xupa Rrazo
  v_desafio4     uuid := gen_random_uuid(); -- futuro, visitante: Los Xupa Rrazo
  v_match1       uuid := gen_random_uuid();
  v_match2       uuid := gen_random_uuid();
  v_match3       uuid := gen_random_uuid();
  v_match4       uuid := gen_random_uuid();
begin
  select id, created_by into v_mi_club, v_mi_admin
  from public.clubs
  where lower(nombre) = lower('Los Xupa Rrazo')
  limit 1;

  if v_mi_club is null then
    raise exception 'No se encontró el club "Los Xupa Rrazo". Créalo desde la app antes de correr este script.';
  end if;

  v_slug_rival := 'rival-de-prueba-' || left(v_rival_club::text, 8);

  -- 1) Usuario y club rival de prueba (sólo para dar contexto a los desafíos;
  --    no representa a nadie real).
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  values (
    '00000000-0000-0000-0000-000000000000', v_rival_admin, 'authenticated', 'authenticated',
    'rival-prueba-' || v_rival_admin || '@futfinder.test', 'x', now(),
    now(), now(), '{}', '{"username":"rival_prueba_calendario"}',
    '', '', '', ''
  );
  -- `handle_new_user` (trigger sobre auth.users) crea el `profiles` de v_rival_admin solo.

  insert into public.clubs (id, nombre, slug, comuna, region, created_by)
  values (v_rival_club, 'Rival de Prueba FC', v_slug_rival, 'Providencia', 'Metropolitana', v_rival_admin);

  insert into public.club_members (club_id, user_id, rol)
  values (v_rival_club, v_rival_admin, 'admin');

  -- 2) Desafío pasado #1 — Los Xupa Rrazo de local, ganado 3-1.
  insert into public.club_challenges (id, club_retador_id, club_retado_id, creado_por, estado, modalidad)
  values (v_desafio1, v_mi_club, v_rival_club, v_mi_admin, 'finalizado', 'futbol7');

  insert into public.matches (
    id, id_organizador, titulo, comuna, cancha_nombre, latitud, longitud, hora,
    cupos_totales, cupos_disponibles, estado, modalidad, club_local_id, club_visitante_id, challenge_id
  ) values (
    v_match1, v_mi_admin, 'Los Xupa Rrazo vs Rival de Prueba FC', 'Ñuñoa', 'Cancha de Prueba Los Xupa',
    -33.4569, -70.5931, '2026-07-18 19:00:00-04', 14, 0, 'finalizado', 'futbol7',
    v_mi_club, v_rival_club, v_desafio1
  );

  insert into public.club_match_results (
    challenge_id, match_id, club_local_id, club_visitante_id, goles_local, goles_visitante,
    club_proponente_id, propuesto_por, confirmado_por, confirmado_at, estado
  ) values (
    v_desafio1, v_match1, v_mi_club, v_rival_club, 3, 1,
    v_mi_club, v_mi_admin, v_rival_admin, '2026-07-18 21:30:00-04', 'confirmado'
  );

  -- 3) Desafío pasado #2 — Los Xupa Rrazo de visitante, perdido 1-2.
  insert into public.club_challenges (id, club_retador_id, club_retado_id, creado_por, estado, modalidad)
  values (v_desafio2, v_rival_club, v_mi_club, v_rival_admin, 'finalizado', 'futbol7');

  insert into public.matches (
    id, id_organizador, titulo, comuna, cancha_nombre, latitud, longitud, hora,
    cupos_totales, cupos_disponibles, estado, modalidad, club_local_id, club_visitante_id, challenge_id
  ) values (
    v_match2, v_rival_admin, 'Rival de Prueba FC vs Los Xupa Rrazo', 'Providencia', 'Cancha de Prueba Rival',
    -33.4260, -70.6089, '2026-08-30 20:00:00-04', 14, 0, 'finalizado', 'futbol7',
    v_rival_club, v_mi_club, v_desafio2
  );

  insert into public.club_match_results (
    challenge_id, match_id, club_local_id, club_visitante_id, goles_local, goles_visitante,
    club_proponente_id, propuesto_por, confirmado_por, confirmado_at, estado
  ) values (
    v_desafio2, v_match2, v_rival_club, v_mi_club, 2, 1,
    v_rival_club, v_rival_admin, v_mi_admin, '2026-08-30 22:15:00-04', 'confirmado'
  );

  -- 4) Desafío futuro #1 — Los Xupa Rrazo de local.
  insert into public.club_challenges (id, club_retador_id, club_retado_id, creado_por, estado, modalidad)
  values (v_desafio3, v_mi_club, v_rival_club, v_mi_admin, 'publicado', 'futbol7');

  insert into public.matches (
    id, id_organizador, titulo, comuna, cancha_nombre, latitud, longitud, hora,
    cupos_totales, cupos_disponibles, estado, modalidad, club_local_id, club_visitante_id, challenge_id
  ) values (
    v_match3, v_mi_admin, 'Los Xupa Rrazo vs Rival de Prueba FC', 'Ñuñoa', 'Cancha de Prueba Los Xupa',
    -33.4569, -70.5931, '2026-09-27 19:00:00-04', 14, 14, 'abierto', 'futbol7',
    v_mi_club, v_rival_club, v_desafio3
  );

  -- 5) Desafío futuro #2 — Los Xupa Rrazo de visitante.
  insert into public.club_challenges (id, club_retador_id, club_retado_id, creado_por, estado, modalidad)
  values (v_desafio4, v_rival_club, v_mi_club, v_rival_admin, 'publicado', 'futbol7');

  insert into public.matches (
    id, id_organizador, titulo, comuna, cancha_nombre, latitud, longitud, hora,
    cupos_totales, cupos_disponibles, estado, modalidad, club_local_id, club_visitante_id, challenge_id
  ) values (
    v_match4, v_rival_admin, 'Rival de Prueba FC vs Los Xupa Rrazo', 'Providencia', 'Cancha de Prueba Rival',
    -33.4260, -70.6089, '2026-10-15 20:00:00-04', 14, 14, 'abierto', 'futbol7',
    v_rival_club, v_mi_club, v_desafio4
  );

  raise notice 'Listo: club rival % (%), 2 partidos jugados (18/07 y 30/08) y 2 programados (27/09 y 15/10) para Los Xupa Rrazo.',
    'Rival de Prueba FC', v_rival_club;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- LIMPIEZA — corre esto más adelante para deshacer todo lo de arriba.
-- Sólo borra lo que creó este script (club rival + sus partidos/desafíos);
-- no toca "Los Xupa Rrazo" en ningún momento.
-- ---------------------------------------------------------------------------
-- begin;
-- delete from public.club_match_results
--   where club_local_id in (select id from public.clubs where slug like 'rival-de-prueba-%')
--      or club_visitante_id in (select id from public.clubs where slug like 'rival-de-prueba-%');
-- delete from public.matches
--   where club_local_id in (select id from public.clubs where slug like 'rival-de-prueba-%')
--      or club_visitante_id in (select id from public.clubs where slug like 'rival-de-prueba-%');
-- delete from public.club_challenges
--   where club_retador_id in (select id from public.clubs where slug like 'rival-de-prueba-%')
--      or club_retado_id in (select id from public.clubs where slug like 'rival-de-prueba-%');
-- delete from public.club_members
--   where club_id in (select id from public.clubs where slug like 'rival-de-prueba-%');
-- delete from auth.users where email like 'rival-prueba-%@futfinder.test';
-- delete from public.clubs where slug like 'rival-de-prueba-%';
-- commit;
