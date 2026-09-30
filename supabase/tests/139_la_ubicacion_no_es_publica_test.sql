-- =============================================================
-- FutFinder — pruebas de la migración 139
--
-- Qué cubre:
--   1. Ningún perfil conserva coordenadas en `profiles`.
--   2. El UPDATE que mandan las apps ya instaladas sigue funcionando:
--      guarda la ubicación en `perfil_ubicaciones`, deja `profiles` en null
--      y el `update ... returning *` (el `.select()` de updateMyProfile) no
--      falla.
--   3. `mi_ubicacion()` le devuelve a A su propia ubicación.
--   4. B no ve la ubicación de A: ni en `profiles`, ni leyendo la tabla
--      privada, y su `mi_ubicacion()` no trae la de A.
--   5. anon no lee la tabla privada ni ejecuta `mi_ubicacion()`.
--   6. anon ya no obtiene coordenadas de ningún perfil.
--   7. Escribir coordenadas saltándose el trigger choca con el CHECK.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run. Todo corre dentro de una transacción que termina en
-- ROLLBACK, así que no queda nada guardado. Si algún caso falla, la
-- ejecución se corta con RAISE EXCEPTION indicando cuál.
-- =============================================================

begin;

do $$
declare
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_n int;
  v_pudo boolean;
  v_json jsonb;
  v_lat numeric;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values
    ('00000000-0000-0000-0000-000000000000', v_a, 'authenticated','authenticated','m139-a-' || v_a || '@futfinder.test','x',now(),now(),now(),'{}','{}','','','',''),
    ('00000000-0000-0000-0000-000000000000', v_b, 'authenticated','authenticated','m139-b-' || v_b || '@futfinder.test','x',now(),now(),now(),'{}','{}','','','','');

  -- ── Caso 1: profiles quedó sin coordenadas ────────────────────
  select count(*) into v_n from public.profiles
   where latitud is not null or longitud is not null or location_updated_at is not null;
  if v_n > 0 then
    raise exception 'FALLÓ (caso 1): % perfiles conservan coordenadas', v_n;
  end if;
  raise notice 'OK (caso 1): ningún perfil conserva coordenadas';

  -- ── Caso 2: el UPDATE de siempre guarda en la tabla privada ───
  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_a, 'role','authenticated')::text);
  update public.profiles
     set latitud = -33.4372100, longitud = -70.6506300, location_updated_at = now(), updated_at = now()
   where id = v_a
  returning latitud into v_lat;
  if v_lat is not null then
    raise exception 'FALLÓ (caso 2): el UPDATE devolvió la latitud en profiles';
  end if;
  reset role;
  select count(*) into v_n from public.perfil_ubicaciones where user_id = v_a and latitud = -33.4372100;
  if v_n <> 1 then
    raise exception 'FALLÓ (caso 2): la ubicación no llegó a perfil_ubicaciones';
  end if;
  raise notice 'OK (caso 2): el UPDATE guarda en la tabla privada y profiles queda en null';

  -- ── Caso 3: A ve su propia ubicación ──────────────────────────
  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_a, 'role','authenticated')::text);
  v_json := public.mi_ubicacion();
  if v_json is null or (v_json ->> 'latitud')::numeric <> -33.4372100 then
    raise exception 'FALLÓ (caso 3): mi_ubicacion() no devolvió la ubicación de A: %', v_json;
  end if;
  reset role;
  raise notice 'OK (caso 3): mi_ubicacion() devuelve la ubicación propia';

  -- ── Caso 4: B no ve la ubicación de A ─────────────────────────
  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_b, 'role','authenticated')::text);
  select latitud into v_lat from public.profiles where id = v_a;
  if v_lat is not null then
    raise exception 'FALLÓ (caso 4): B leyó la latitud de A en profiles';
  end if;
  begin
    select count(*) into v_n from public.perfil_ubicaciones;
    v_pudo := true;
  exception when insufficient_privilege then v_pudo := false;
  end;
  if v_pudo then
    raise exception 'FALLÓ (caso 4): B pudo leer perfil_ubicaciones';
  end if;
  if public.mi_ubicacion() is not null then
    raise exception 'FALLÓ (caso 4): mi_ubicacion() de B devolvió una ubicación';
  end if;
  reset role;
  raise notice 'OK (caso 4): otra cuenta no ve la ubicación';

  -- ── Caso 5: anon no lee la tabla ni la función ────────────────
  set local role anon;
  begin
    select count(*) into v_n from public.perfil_ubicaciones;
    v_pudo := true;
  exception when insufficient_privilege then v_pudo := false;
  end;
  if v_pudo then
    raise exception 'FALLÓ (caso 5): anon pudo leer perfil_ubicaciones';
  end if;
  begin
    v_json := public.mi_ubicacion();
    v_pudo := true;
  exception when insufficient_privilege then v_pudo := false;
  end;
  if v_pudo then
    raise exception 'FALLÓ (caso 5): anon pudo ejecutar mi_ubicacion()';
  end if;

  -- ── Caso 6: anon no obtiene coordenadas de ningún perfil ──────
  select count(*) into v_n from public.profiles where latitud is not null or longitud is not null;
  if v_n > 0 then
    raise exception 'FALLÓ (caso 6): anon ve % perfiles con coordenadas', v_n;
  end if;
  reset role;
  raise notice 'OK (casos 5 y 6): anon no llega a ninguna ubicación';

  -- ── Caso 7: saltarse el trigger choca con el CHECK ────────────
  alter table public.profiles disable trigger trg_perfil_guarda_ubicacion;
  begin
    update public.profiles set latitud = 1, longitud = 1 where id = v_b;
    v_pudo := true;
  exception when check_violation then v_pudo := false;
  end;
  alter table public.profiles enable trigger trg_perfil_guarda_ubicacion;
  if v_pudo then
    raise exception 'FALLÓ (caso 7): sin el trigger se pudo volver a escribir coordenadas en profiles';
  end if;
  raise notice 'OK (caso 7): el CHECK frena un camino que se salte el trigger';

  raise notice 'TODAS LAS PRUEBAS DE LA MIGRACIÓN 139 PASARON';
end $$;

rollback;
