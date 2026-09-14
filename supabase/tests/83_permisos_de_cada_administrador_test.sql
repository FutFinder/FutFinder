-- =============================================================
-- FutFinder — pruebas de la migración 83 (permisos por administrador).
--
-- CADA CASO DE DENEGACIÓN COMPRUEBA EL MENSAJE, no solo que haya reventado.
-- Una regla de negocio —«ya hay un horario que se cruza con este ese día»—
-- también revienta, y contarla como éxito da un verde falso. Pasó de verdad
-- la primera vez que se corrió este arnés: el caso del horario «pasaba»
-- porque chocaba con otro horario, no porque faltara el permiso.
--
-- Por la misma razón la prueba CREA SU PROPIA CANCHA: sobre una cancha que
-- ya tiene horarios y tarifas cargados, los choques tapan lo que se quiere
-- medir.
--
-- QUÉ SE PRUEBA:
--   1. Los administradores que ya estaban conservan los tres permisos.
--   2. Un administrador nuevo nace sin ninguno.
--   3. Sin `canchas` no puede crear una cancha…
--   4. …ni cargar horarios, ni tarifas.
--   5. Sin `cobros` no puede crear un cobro adicional.
--   6. Sin `ficha` no puede editar el complejo, ni servicios, ni fotos.
--   7. Con el permiso encendido, sí puede — y lo que no se le dio sigue cerrado.
--   8. EL DÍA A DÍA NO SE BLOQUEA: sin ningún permiso ocupa una hora y lee la
--      agenda. Es para lo que se suma a alguien.
--   9. El dueño puede todo aunque sus banderas estén apagadas.
--  10. Solo el dueño reparte permisos.
--  11. Al dueño no se le editan: los tiene por ser dueño.
--  12. Publicar y pedir revisión pasan a ser del dueño.
--  13. El disparador de la ficha NO vigila `rating_avg`: si lo hiciera,
--      calificar un recinto reventaría — lo escribe `recalc_complejo_rating`
--      en nombre de un jugador que no administra nada.
--  14. Sin sesión (el equipo por SQL) se sigue pudiendo escribir.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- Requiere las migraciones 54 a 83 aplicadas.
-- =============================================================

begin;

create temp table r83 (caso text, ok boolean, detalle text);
grant all on r83 to authenticated, anon;

do $$
declare
  v_dueno uuid; v_cpl uuid; v_cancha uuid;
  v_mano uuid := gen_random_uuid();
  v_res json; v_n integer; v_b boolean; v_err text; v_id uuid;
begin
  select a.complejo_id, a.user_id into v_cpl, v_dueno
    from public.complejo_admins a where a.rol = 'dueño' limit 1;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', v_mano, 'authenticated', 'authenticated',
         'r83-' || v_mano || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '';

  select count(*) into v_n from public.complejo_admins
   where not (puede_canchas and puede_cobros and puede_ficha) and created_at < now();
  insert into r83 values ('1', v_n = 0, v_n || ' admins viejos sin permisos');

  insert into public.complejo_admins (complejo_id, user_id, rol) values (v_cpl, v_mano, 'admin');
  select puede_canchas or puede_cobros or puede_ficha into v_b
    from public.complejo_admins where complejo_id = v_cpl and user_id = v_mano;
  insert into r83 values ('2', not v_b, 'alguno encendido: ' || v_b);

  -- Una cancha limpia, creada por el dueño, para que ningún choque tape lo
  -- que se quiere medir.
  set local role authenticated;
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_dueno, 'role', 'authenticated')::text);
  v_cancha := public.admin_crear_cancha(v_cpl, 'Cancha de la prueba 83', 'futbol_7', 20000, 60);

  -- ── Como el administrador sin permisos ───────────────────────
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_mano, 'role', 'authenticated')::text);

  begin perform public.admin_crear_cancha(v_cpl, 'X', 'futbol_7', 1000, 60); v_err := 'no lo rechazó';
  exception when others then v_err := sqlerrm; end;
  insert into r83 values ('3', v_err like '%No tienes permiso%', 'crear cancha: ' || v_err);

  begin perform public.admin_upsert_horario_regla(v_cancha, 1, '09:00'::time, '22:00'::time, null);
    v_err := 'no lo rechazó';
  exception when others then v_err := sqlerrm; end;
  insert into r83 values ('4a', v_err like '%No tienes permiso%', 'horario: ' || v_err);

  begin perform public.admin_upsert_tarifa(v_cancha, '11:00'::time, '13:00'::time, 9999, null, null);
    v_err := 'no lo rechazó';
  exception when others then v_err := sqlerrm; end;
  insert into r83 values ('4b', v_err like '%No tienes permiso%', 'tarifa: ' || v_err);

  begin perform public.admin_crear_cobro(v_cpl, 'Petos de la prueba 83', 2000); v_err := 'no lo rechazó';
  exception when others then v_err := sqlerrm; end;
  insert into r83 values ('5', v_err like '%No tienes permiso%', 'cobro: ' || v_err);

  begin perform public.admin_actualizar_complejo(v_cpl, 'Otro nombre', null, null, null);
    v_err := 'no lo rechazó';
  exception when others then v_err := sqlerrm; end;
  insert into r83 values ('6a', v_err like '%No tienes permiso%', 'ficha: ' || v_err);

  begin perform public.admin_actualizar_servicios(v_cpl, array['quincho']); v_err := 'no lo rechazó';
  exception when others then v_err := sqlerrm; end;
  insert into r83 values ('6b', v_err like '%No tienes permiso%', 'servicios: ' || v_err);

  begin perform public.admin_agregar_foto_complejo(v_cpl, 'https://x/prueba83.jpg');
    v_err := 'no lo rechazó';
  exception when others then v_err := sqlerrm; end;
  insert into r83 values ('6c', v_err like '%No tienes permiso%', 'galería: ' || v_err);

  -- 8. El día a día NO se bloquea.
  -- `perform` y no `v_res := ...`: esta RPC devuelve el uuid del bloqueo, no
  -- un json. Asignarlo a un json hacía fallar el caso por un error de la
  -- prueba y no del permiso.
  begin perform public.admin_crear_bloqueo(v_cancha, current_date + 30, '08:00'::time,
                                           '09:00'::time, 'prueba 83', 'cerrado', null, null);
    v_err := 'ok';
  exception when others then v_err := sqlerrm; end;
  insert into r83 values ('8a', v_err = 'ok', 'ocupar una hora: ' || v_err);

  begin perform public.admin_agenda_complejo(v_cpl, current_date); v_err := 'ok';
  exception when others then v_err := sqlerrm; end;
  insert into r83 values ('8b', v_err = 'ok', 'leer la agenda: ' || v_err);

  -- 12. Publicar y revisión son del dueño.
  begin perform public.admin_publicar_complejo(v_cpl, false); v_err := 'no lo rechazó';
  exception when others then v_err := sqlerrm; end;
  insert into r83 values ('12a', v_err like '%dueño%', 'publicar: ' || v_err);

  begin perform public.admin_solicitar_revision_complejo(v_cpl); v_err := 'no lo rechazó';
  exception when others then v_err := sqlerrm; end;
  insert into r83 values ('12b', v_err like '%dueño%', 'revisión: ' || v_err);

  begin perform public.admin_permisos_admin(v_cpl, v_mano, true, true, true); v_err := 'no lo rechazó';
  exception when others then v_err := sqlerrm; end;
  insert into r83 values ('10', v_err like '%dueño%', 'repartir permisos: ' || v_err);

  -- ── El dueño enciende `canchas` y `cobros`, deja `ficha` apagado ──
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_dueno, 'role', 'authenticated')::text);
  v_res := public.admin_permisos_admin(v_cpl, v_mano, true, true, false);
  insert into r83 values ('10b', (v_res->>'ok')::boolean, v_res::text);

  v_res := public.admin_permisos_admin(v_cpl, v_dueno, false, false, false);
  insert into r83 values ('11', not (v_res->>'ok')::boolean, v_res->>'reason');

  -- 9. El dueño puede aunque sus banderas estén apagadas.
  update public.complejo_admins set puede_canchas = false, puede_cobros = false, puede_ficha = false
   where complejo_id = v_cpl and user_id = v_dueno;
  begin perform public.admin_actualizar_complejo(v_cpl, null, 'Descripción del dueño', null, null);
    v_err := 'ok';
  exception when others then v_err := sqlerrm; end;
  insert into r83 values ('9', v_err = 'ok', 'el dueño edita con las banderas apagadas: ' || v_err);

  -- ── De vuelta como el administrador, ya con dos permisos ─────
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_mano, 'role', 'authenticated')::text);

  begin v_id := public.admin_crear_cancha(v_cpl, 'Cancha con permiso 83', 'futbol_7', 1000, 60);
    v_err := 'ok';
  exception when others then v_err := sqlerrm; end;
  insert into r83 values ('7a', v_err = 'ok' and v_id is not null, 'crear cancha: ' || v_err);

  begin perform public.admin_upsert_horario_regla(v_cancha, 1, '09:00'::time, '22:00'::time, null);
    v_err := 'ok';
  exception when others then v_err := sqlerrm; end;
  insert into r83 values ('7b', v_err = 'ok', 'horario con permiso: ' || v_err);

  begin perform public.admin_crear_cobro(v_cpl, 'Petos con permiso 83', 2000); v_err := 'ok';
  exception when others then v_err := sqlerrm; end;
  insert into r83 values ('7c', v_err = 'ok', 'cobro con permiso: ' || v_err);

  begin perform public.admin_actualizar_complejo(v_cpl, 'Nombre intruso', null, null, null);
    v_err := 'no lo rechazó';
  exception when others then v_err := sqlerrm; end;
  insert into r83 values ('7d', v_err like '%No tienes permiso%', 'ficha sigue cerrada: ' || v_err);

  -- `reset role` NO alcanza: `auth.uid()` sale de `request.jwt.claims`, no
  -- del rol, y sin limpiarlo el caso 14 correría como el administrador.
  reset role;
  set local request.jwt.claims to '{}';

  select count(*) into v_n from pg_trigger t
   where t.tgrelid = 'public.complejos'::regclass and t.tgname = 'tg_permiso_ficha'
     and (select attnum from pg_attribute
           where attrelid = 'public.complejos'::regclass and attname = 'rating_avg')
         = any (string_to_array(coalesce(t.tgattr::text, ''), ' ')::smallint[]);
  insert into r83 values ('13', v_n = 0, 'rating_avg entre las columnas vigiladas: ' || v_n);

  begin update public.complejos set descripcion = coalesce(descripcion, 'x') where id = v_cpl;
    v_err := 'ok';
  exception when others then v_err := sqlerrm; end;
  insert into r83 values ('14', v_err = 'ok', 'el equipo escribe sin sesión: ' || v_err);
end $$;

reset role;

select caso, case when ok then 'PASA' else 'FALLA' end as resultado, detalle
  from r83 order by caso;

do $$
declare v_malos integer; v_f record;
begin
  for v_f in select * from r83 where not ok order by caso loop
    raise warning 'FALLÓ (caso %): %', v_f.caso, v_f.detalle;
  end loop;
  select count(*) into v_malos from r83 where not ok;
  if v_malos > 0 then raise exception '% caso(s) de la migración 83 fallaron', v_malos; end if;
  raise notice '=== TODOS LOS CASOS DE LA MIGRACIÓN 83 PASARON ===';
end $$;

rollback;
