-- =============================================================
-- FutFinder — pruebas de la migración 75 (servicios y foto del recinto).
--
-- QUÉ SE PRUEBA:
--   1. Guarda la lista de servicios.
--   2. La siguiente llamada REEMPLAZA, no suma: lo que no viene, se va. Es
--      la razón por la que la RPC recibe la lista entera.
--   3. Y deja exactamente los que se mandaron.
--   4. Un servicio fuera del catálogo se rechaza.
--   5. Y al rechazarlo NO borró nada: la validación corre antes del delete.
--      Sin ese orden, un error de la pantalla vaciaría la ficha.
--   6. Se puede dejar el recinto sin ningún servicio.
--   7. Un ajeno no puede tocarlos.
--   8. El bucket `complejo-fotos` existe, es público y acota los tipos.
--   9. `admin_quitar_foto_complejo` vacía `foto_url` — cosa que
--      `admin_actualizar_complejo` no puede hacer, porque su `coalesce`
--      trata el null como «no cambiar».
--
-- OJO: usa el complejo real (MaiClub) porque necesita un admin de verdad.
-- Corre entero dentro de la transacción y termina en ROLLBACK.
--
-- Requiere las migraciones 54 a 75 aplicadas.
-- Cómo correr: pégalo en Supabase → SQL Editor → Run. Termina en ROLLBACK.
-- =============================================================

begin;

create temp table r75 (caso text, ok boolean, detalle text);
grant all on r75 to authenticated, anon;

do $$
declare
  v_dueno uuid;
  v_cpl   uuid;
  v_ajeno uuid := gen_random_uuid();
  v_n integer;
  v_url text;
  v_rechazado boolean;
begin
  select a.complejo_id, a.user_id into v_cpl, v_dueno
    from public.complejo_admins a where a.rol = 'dueño' limit 1;
  if v_cpl is null then
    raise exception 'La prueba necesita al menos un complejo con dueño cargado';
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', v_ajeno, 'authenticated', 'authenticated',
         'r75-' || v_ajeno || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '';

  set local role authenticated;
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_dueno, 'role', 'authenticated')::text);

  perform public.admin_actualizar_servicios(v_cpl, array['estacionamiento','camarines','duchas']);
  select count(*) into v_n from public.complejo_servicios where complejo_id = v_cpl;
  insert into r75 values ('1', v_n = 3, v_n || ' servicios');

  perform public.admin_actualizar_servicios(v_cpl, array['estacionamiento','camarines','quincho']);
  select count(*) into v_n from public.complejo_servicios where complejo_id = v_cpl and servicio = 'duchas';
  insert into r75 values ('2', v_n = 0, 'duchas quedó en ' || v_n);
  select count(*) into v_n from public.complejo_servicios where complejo_id = v_cpl;
  insert into r75 values ('3', v_n = 3, v_n || ' servicios');

  begin
    perform public.admin_actualizar_servicios(v_cpl, array['piscina']);
    v_rechazado := false;
  exception when others then v_rechazado := true; end;
  insert into r75 values ('4', v_rechazado, 'un servicio fuera del catálogo');
  select count(*) into v_n from public.complejo_servicios where complejo_id = v_cpl;
  insert into r75 values ('5', v_n = 3, 'después del rechazo quedan ' || v_n);

  perform public.admin_actualizar_servicios(v_cpl, array[]::text[]);
  select count(*) into v_n from public.complejo_servicios where complejo_id = v_cpl;
  insert into r75 values ('6', v_n = 0, v_n || ' servicios');

  -- Caso 9 antes de cambiar de usuario: el dueño quita su foto.
  update public.complejos set foto_url = 'https://ejemplo/portada.jpg' where id = v_cpl;
  perform public.admin_quitar_foto_complejo(v_cpl);
  select foto_url into v_url from public.complejos where id = v_cpl;
  insert into r75 values ('9', v_url is null, 'foto_url quedó en ' || coalesce(v_url, 'null'));

  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);
  begin
    perform public.admin_actualizar_servicios(v_cpl, array['wifi']);
    v_rechazado := false;
  exception when others then v_rechazado := true; end;
  insert into r75 values ('7', v_rechazado, 'un ajeno no toca los servicios');

  reset role;

  select count(*) into v_n from storage.buckets
   where id = 'complejo-fotos' and public
     and 'image/jpeg' = any(allowed_mime_types)
     and 'application/pdf' <> all(allowed_mime_types);
  insert into r75 values ('8', v_n = 1, 'bucket público y acotado a imágenes');
end $$;

do $$
declare v_malos integer; v_f record;
begin
  for v_f in select * from r75 order by caso loop
    if v_f.ok then raise notice 'OK (caso %): %', v_f.caso, v_f.detalle;
    else raise warning 'FALLÓ (caso %): %', v_f.caso, v_f.detalle; end if;
  end loop;
  select count(*) into v_malos from r75 where not ok;
  if v_malos > 0 then raise exception '% caso(s) de la migración 75 fallaron', v_malos; end if;
  raise notice '=== TODOS LOS CASOS DE LA MIGRACIÓN 75 PASARON ===';
end $$;

rollback;
