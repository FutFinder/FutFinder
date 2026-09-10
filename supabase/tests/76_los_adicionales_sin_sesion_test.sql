-- =============================================================
-- FutFinder — pruebas de la migración 76 (adicionales y servicios sin sesión).
--
-- QUÉ SE PRUEBA:
--   1. `anon` puede LEER `complejo_cobros` sin que la consulta reviente.
--      Antes fallaba con «permission denied for function es_admin_complejo»,
--      porque la policy llamaba a esa función dentro de un `or` y Postgres
--      no garantiza el orden de evaluación.
--   2. Lo mismo con `complejo_servicios`.
--   3. Sin sesión se ven los cobros ACTIVOS de un recinto publicado…
--   4. …y NO se ven los apagados.
--   5. Ni los de un recinto sin publicar.
--   6. Quien administra el recinto sigue viendo TODOS, apagados incluidos:
--      es la lista que edita, y partir la policy en dos no debía cambiarlo.
--
-- Requiere las migraciones 54 a 76 aplicadas.
-- Cómo correr: pégalo en Supabase → SQL Editor → Run. Termina en ROLLBACK.
-- =============================================================

begin;

create temp table r76 (caso text, ok boolean, detalle text);
grant all on r76 to anon, authenticated;

do $$
declare
  v_dueno    uuid := gen_random_uuid();
  v_pub      uuid := gen_random_uuid();
  v_oculto   uuid := gen_random_uuid();
  v_apagado  uuid;
  v_n integer;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', v_dueno, 'authenticated', 'authenticated',
         'r76-' || v_dueno || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '';

  insert into public.complejos (id, nombre, comuna, latitud, longitud, publicado) values
    (v_pub,    'Publicado 76',  'Maipú', -33.53, -70.76, true),
    (v_oculto, 'Sin publicar 76', 'Ñuñoa', -33.45, -70.60, false);
  insert into public.complejo_admins (complejo_id, user_id, rol) values
    (v_pub, v_dueno, 'dueño'), (v_oculto, v_dueno, 'dueño');

  insert into public.complejo_cobros (complejo_id, nombre, precio, activo) values
    (v_pub, 'Balón', 3000, true),
    (v_pub, 'Estacionamiento', 1000, false),
    (v_oculto, 'Árbitro', 12000, true)
    returning id into v_apagado;
  insert into public.complejo_servicios (complejo_id, servicio) values
    (v_pub, 'estacionamiento'), (v_oculto, 'wifi');

  -- ── Sin sesión ─────────────────────────────────────────────────
  set local role anon;
  begin
    select count(*) into v_n from public.complejo_cobros;
    insert into r76 values ('1', true, 'anon leyó complejo_cobros sin reventar');
  exception when others then
    insert into r76 values ('1', false, sqlerrm);
  end;

  begin
    select count(*) into v_n from public.complejo_servicios;
    insert into r76 values ('2', true, 'anon leyó complejo_servicios sin reventar');
  exception when others then
    insert into r76 values ('2', false, sqlerrm);
  end;

  select count(*) into v_n from public.complejo_cobros where complejo_id = v_pub and nombre = 'Balón';
  insert into r76 values ('3', v_n = 1, 'el activo de un recinto publicado: ' || v_n);

  select count(*) into v_n from public.complejo_cobros where complejo_id = v_pub and nombre = 'Estacionamiento';
  insert into r76 values ('4', v_n = 0, 'el apagado: ' || v_n);

  select count(*) into v_n from public.complejo_cobros where complejo_id = v_oculto;
  insert into r76 values ('5', v_n = 0, 'los de un recinto sin publicar: ' || v_n);
  reset role;

  -- ── Con sesión de quien administra ─────────────────────────────
  set local role authenticated;
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_dueno, 'role', 'authenticated')::text);
  select count(*) into v_n from public.complejo_cobros where complejo_id = v_pub;
  insert into r76 values ('6a', v_n = 2, 'el dueño ve activos y apagados: ' || v_n);
  select count(*) into v_n from public.complejo_cobros where complejo_id = v_oculto;
  insert into r76 values ('6b', v_n = 1, 'y los de su recinto sin publicar: ' || v_n);
  select count(*) into v_n from public.complejo_servicios where complejo_id = v_oculto;
  insert into r76 values ('6c', v_n = 1, 'y sus servicios sin publicar: ' || v_n);
  reset role;
end $$;

do $$
declare v_malos integer; v_f record;
begin
  for v_f in select * from r76 order by caso loop
    if v_f.ok then raise notice 'OK (caso %): %', v_f.caso, v_f.detalle;
    else raise warning 'FALLÓ (caso %): %', v_f.caso, v_f.detalle; end if;
  end loop;
  select count(*) into v_malos from r76 where not ok;
  if v_malos > 0 then raise exception '% caso(s) de la migración 76 fallaron', v_malos; end if;
  raise notice '=== TODOS LOS CASOS DE LA MIGRACIÓN 76 PASARON ===';
end $$;

rollback;
