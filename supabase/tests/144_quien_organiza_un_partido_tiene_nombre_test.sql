-- =============================================================
-- FutFinder — pruebas de la migración 144
--
-- Qué cubre:
--   CONTROL. Leyendo `profiles` directo, el organizador que apagó
--     «Visible en búsquedas» NO se entrega: es el fallo que la 143
--     introdujo en la tarjeta del partido y que esta migración repara.
--     Si este control dejara de pasar, la RPC ya no estaría probando
--     nada — estaría midiendo un perfil que igual se leía.
--   1. `organizadores_publicos()` sí devuelve su usuario para un partido
--      abierto.
--   2. Un partido de CLUBES ajeno no entrega su organizador. La función
--      es `security definer`, así que la RLS de `matches` no la alcanza y
--      repite su condición a mano: este caso es el que avisa si
--      `matches_read_publico_o_de_mi_club` cambia y la copia se queda
--      atrás.
--   3. Sin sesión no devuelve nada.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run. Todo corre dentro de una transacción que termina en
-- ROLLBACK, así que no queda nada guardado.
-- =============================================================

begin;

do $$
declare
  v_mira uuid := gen_random_uuid();
  v_org uuid := gen_random_uuid();
  v_orgclub uuid := gen_random_uuid();
  v_marca text := 'm144' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  v_m1 uuid := gen_random_uuid(); v_m2 uuid := gen_random_uuid();
  v_c1 uuid := gen_random_uuid(); v_c2 uuid := gen_random_uuid();
  v_des uuid := gen_random_uuid(); v_prop uuid := gen_random_uuid();
  v_n int; v_user text;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, email_change,
    email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
    'm144-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_mira, v_org, v_orgclub]) u;

  -- Los dos organizadores están OCULTOS y no comparten nada con quien mira.
  insert into public.profiles (id, username, privacy_visible_in_search) values
    (v_mira, v_marca || 'mira', true),
    (v_org, v_marca || 'org', false),
    (v_orgclub, v_marca || 'orgclub', false)
  on conflict (id) do update
    set username = excluded.username, privacy_visible_in_search = excluded.privacy_visible_in_search;

  insert into public.matches (id, id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
    hora, cupos_totales, cupos_disponibles)
    values (v_m1, v_org, v_marca || ' abierto', 'Comuna', 'Cancha', -33.45, -70.66,
            now() + interval '2 days', 10, 8);

  insert into public.clubs (id, nombre, slug, created_by) values
    (v_c1, v_marca || ' A', v_marca || '-a', v_orgclub),
    (v_c2, v_marca || ' B', v_marca || '-b', v_orgclub);
  insert into public.club_members (club_id, user_id, rol) values (v_c1, v_orgclub, 'admin');
  insert into public.club_challenges (id, club_retador_id, club_retado_id, creado_por, estado)
    values (v_des, v_c1, v_c2, v_orgclub, 'negociacion');
  insert into public.club_challenge_proposals (id, challenge_id, club_proponente_id, fecha,
    duracion_min, direccion, cancha_nombre, comuna, region, modalidad, cupos_por_club, metodo_inscripcion)
    values (v_prop, v_des, v_c1, now() + interval '3 days', 60, 'Calle 1', 'Cancha', 'Comuna',
            'Region', 'futbol7', 7, 'orden_llegada');
  insert into public.matches (id, id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
    hora, cupos_totales, cupos_disponibles, challenge_proposal_id, club_local_id, club_visitante_id)
    values (v_m2, v_orgclub, v_marca || ' clubes', 'Comuna', 'Cancha', -33.45, -70.66,
            now() + interval '3 days', 10, 8, v_prop, v_c1, v_c2);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_mira, 'role', 'authenticated')::text, true);

  -- ── CONTROL: la tabla no lo entrega ───────────────────────────
  select count(*) into v_n from public.profiles where id = v_org;
  if v_n <> 0 then
    raise exception 'CONTROL FALLA: el organizador oculto se lee directo de profiles (%) — la RPC no está midiendo nada', v_n;
  end if;

  -- ── Caso 1: la RPC sí ─────────────────────────────────────────
  select username into v_user from public.organizadores_publicos(array[v_m1]);
  if v_user is distinct from v_marca || 'org' then
    raise exception 'CASO 1 FALLA: la tarjeta del partido abierto sigue sin nombre (%)', coalesce(v_user, 'null');
  end if;

  -- ── Caso 2: un partido de clubes ajeno, no ────────────────────
  select count(*) into v_n from public.organizadores_publicos(array[v_m2]);
  if v_n <> 0 then
    raise exception 'CASO 2 FALLA: entrega el organizador de un partido de clubes al que no pertenezco';
  end if;

  -- ── Caso 3: sin sesión, nada ──────────────────────────────────
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  select count(*) into v_n from public.organizadores_publicos(array[v_m1]);
  if v_n <> 0 then raise exception 'CASO 3 FALLA: sin sesión devuelve % filas', v_n; end if;

  reset role;
  raise notice 'MIGRACIÓN 144: control + 3/3 casos OK';
end $$;

rollback;
