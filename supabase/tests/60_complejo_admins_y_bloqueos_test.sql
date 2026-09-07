-- =============================================================
-- FutFinder — pruebas de la migración 60 (cuentas de administrador de
-- complejo y bloqueos puntuales de cancha).
--
-- QUÉ SE PRUEBA:
--   Autorización de las RPC de administración
--   1.  Un ajeno no puede actualizar el complejo.
--   2.  El dueño sí puede.
--   3.  Un `admin` (no dueño) también puede editar el complejo.
--   4.  Un `admin` NO puede agregar administradores.
--   5.  El dueño sí puede, y le llega el aviso al nombrado.
--   6.  Nadie puede cambiarle el rol a un dueño (ni el dueño a sí mismo:
--       es lo que impide que un complejo quede huérfano).
--   7.  El dueño puede quitar a un `admin`.
--   8.  El dueño NO puede quitar a otro dueño.
--   9.  Un ajeno no puede crear canchas ni horarios.
--   10. `admin_crear_cancha` rechaza un tipo de cancha inválido.
--   11. `admin_upsert_horario_regla` rechaza reglas que se cruzan.
--
--   Los bloqueos bloquean de verdad (el punto de la migración)
--   12. Un bloqueo saca el slot de `get_disponibilidad_cancha`.
--   13. El solape es semiabierto: el bloqueo de 14:00-16:00 no toca el
--       slot de 13:00-14:00.
--   14. `crear_reserva` rechaza un slot bloqueado, con reason 'bloqueado'.
--   15. `admin_crear_bloqueo` rechaza solapar una reserva confirmada.
--   16. `admin_eliminar_bloqueo` devuelve el slot a la disponibilidad.
--
--   RLS y privilegios
--   17. Un ajeno autenticado NO lee `cancha_bloqueos` (motivo privado).
--   18. Un administrador del complejo SÍ lo lee.
--   19. Un ajeno no ve las filas de `complejo_admins` de otros.
--   20. `anon` no puede ejecutar ninguna RPC `admin_*`.
--
-- Requiere las migraciones 54 a 60 aplicadas.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- Run. Todo corre en una transacción que termina en ROLLBACK. Si un
-- caso falla, la ejecución se corta con RAISE EXCEPTION indicando cuál.
-- =============================================================

begin;

do $$
declare
  v_dueno    uuid := gen_random_uuid();
  v_admin    uuid := gen_random_uuid();
  v_ajeno    uuid := gen_random_uuid();
  v_complejo uuid := gen_random_uuid();
  v_cancha   uuid := gen_random_uuid();
  v_bloqueo  uuid;
  v_reserva  uuid := gen_random_uuid();
  v_cancha2  uuid;
  v_regla    uuid;
  v_rechazado boolean;
  v_count    integer;
  v_nombre   text;
  v_j        json;
  v_disp     boolean;
begin
  -- ── Montaje ────────────────────────────────────────────────────
  -- `handle_new_user` crea el perfil al insertar en auth.users.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r60-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_dueno, v_admin, v_ajeno]) as u;

  insert into public.complejos (id, nombre, comuna, latitud, longitud)
  values (v_complejo, 'Complejo Prueba 60', 'Ñuñoa', -33.45, -70.60);

  insert into public.canchas_reservables (id, complejo_id, nombre, tipo, precio_hora, duracion_slot_min, activa)
  values (v_cancha, v_complejo, 'Cancha 1', 'futbol_7', 20000, 60, true);

  -- Abierta todos los días de 13:00 a 20:00, para tener slots de sobra.
  insert into public.cancha_horario_reglas (cancha_id, dia_semana, hora_apertura, hora_cierre)
  select v_cancha, d, time '13:00', time '20:00' from generate_series(0, 6) as d;

  -- El primer dueño lo inserta `service_role` a mano: es exactamente el
  -- arranque que documenta la migración, no hay RPC que lo haga.
  insert into public.complejo_admins (complejo_id, user_id, rol)
  values (v_complejo, v_dueno, 'dueño');

  -- ── Casos 1-3: quién puede editar el complejo ──────────────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);

  begin
    perform public.admin_actualizar_complejo(v_complejo, 'Secuestrado');
    v_rechazado := false;
  exception when others then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 1): un ajeno no debería poder editar el complejo';
  end if;
  raise notice 'OK (caso 1): un ajeno no puede editar el complejo';

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_dueno, 'role', 'authenticated')::text);
  perform public.admin_actualizar_complejo(v_complejo, 'Complejo Renombrado');
  select nombre into v_nombre from public.complejos where id = v_complejo;
  if v_nombre <> 'Complejo Renombrado' then
    raise exception 'FALLÓ (caso 2): el dueño debería poder renombrar el complejo, quedó "%"', v_nombre;
  end if;
  raise notice 'OK (caso 2): el dueño edita el complejo';

  -- Se agrega al segundo administrador con rol 'admin' para los casos
  -- siguientes (caso 5 verifica de paso el aviso).
  perform public.admin_agregar_admin(v_complejo, v_admin, 'admin');

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin, 'role', 'authenticated')::text);
  perform public.admin_actualizar_complejo(v_complejo, null, 'Con pasto sintético nuevo');
  select descripcion into v_nombre from public.complejos where id = v_complejo;
  if v_nombre <> 'Con pasto sintético nuevo' then
    raise exception 'FALLÓ (caso 3): un admin debería poder editar el complejo';
  end if;
  raise notice 'OK (caso 3): un admin (no dueño) edita el complejo';

  -- ── Casos 4-8: gestión de administradores ──────────────────────
  begin
    perform public.admin_agregar_admin(v_complejo, v_ajeno, 'admin');
    v_rechazado := false;
  exception when others then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 4): un admin no debería poder agregar administradores';
  end if;
  raise notice 'OK (caso 4): solo el dueño agrega administradores';

  select count(*) into v_count
    from public.notifications
   where user_id = v_admin and type = 'complejo_admin_agregado';
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 5): esperaba 1 aviso complejo_admin_agregado, hay %', v_count;
  end if;
  raise notice 'OK (caso 5): el dueño agrega un admin y le llega el aviso';

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_dueno, 'role', 'authenticated')::text);
  begin
    -- El dueño intentando rebajarse a sí mismo: el escenario que dejaría
    -- el complejo sin dueño.
    perform public.admin_agregar_admin(v_complejo, v_dueno, 'admin');
    v_rechazado := false;
  exception when others then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 6): no debería poder cambiarse el rol a un dueño';
  end if;
  select count(*) into v_count
    from public.complejo_admins where complejo_id = v_complejo and rol = 'dueño';
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 6): el complejo quedó con % dueños', v_count;
  end if;
  raise notice 'OK (caso 6): a un dueño no se le cambia el rol';

  begin
    perform public.admin_quitar_admin(v_complejo, v_dueno);
    v_rechazado := false;
  exception when others then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 8): no debería poder quitarse a un dueño';
  end if;
  raise notice 'OK (caso 8): a un dueño no se lo quita por RPC';

  perform public.admin_quitar_admin(v_complejo, v_admin);
  select count(*) into v_count
    from public.complejo_admins where complejo_id = v_complejo and user_id = v_admin;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 7): el dueño debería poder quitar a un admin';
  end if;
  raise notice 'OK (caso 7): el dueño quita a un admin';
  -- Se lo devuelve para los casos de RLS de más abajo.
  perform public.admin_agregar_admin(v_complejo, v_admin, 'admin');

  -- ── Casos 9-11: canchas y horarios ─────────────────────────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);
  begin
    perform public.admin_crear_cancha(v_complejo, 'Cancha pirata', 'futbol_5', 10000);
    v_rechazado := false;
  exception when others then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 9): un ajeno no debería poder crear canchas';
  end if;
  raise notice 'OK (caso 9): un ajeno no crea canchas';

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_dueno, 'role', 'authenticated')::text);
  begin
    perform public.admin_crear_cancha(v_complejo, 'Cancha 2', 'futbol_9', 10000);
    v_rechazado := false;
  exception when others then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 10): futbol_9 no es un tipo válido de cancha';
  end if;
  raise notice 'OK (caso 10): tipo de cancha inválido rechazado';

  v_cancha2 := public.admin_crear_cancha(v_complejo, 'Cancha 2', 'futbol_5', 15000);
  v_regla := public.admin_upsert_horario_regla(v_cancha2, 1, time '10:00', time '14:00');
  begin
    -- 12:00-16:00 se cruza con 10:00-14:00 del mismo día.
    perform public.admin_upsert_horario_regla(v_cancha2, 1, time '12:00', time '16:00');
    v_rechazado := false;
  exception when others then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 11): dos reglas de horario cruzadas no deberían aceptarse';
  end if;
  -- Pegada pero sin cruzarse: 14:00-16:00 arranca donde termina la otra.
  perform public.admin_upsert_horario_regla(v_cancha2, 1, time '14:00', time '16:00');
  raise notice 'OK (caso 11): horarios cruzados rechazados, contiguos aceptados';

  -- ── Casos 12-16: los bloqueos bloquean ─────────────────────────
  -- Bloqueo de 14:00 a 16:00 en una fecha futura fija (un lunes, para
  -- que no dependa del día en que se corra el arnés).
  v_bloqueo := public.admin_crear_bloqueo(
    v_cancha, date '2027-03-01', time '14:00', time '16:00', 'Mantención de riego'
  );

  select (s->>'disponible')::boolean into v_disp
    from json_array_elements((public.get_disponibilidad_cancha(v_cancha, date '2027-03-01'))->'slots') s
   where s->>'hora_inicio' = '14:00';
  if v_disp is not false then
    raise exception 'FALLÓ (caso 12): el slot 14:00 bloqueado debería estar no disponible, está %', v_disp;
  end if;
  select (s->>'disponible')::boolean into v_disp
    from json_array_elements((public.get_disponibilidad_cancha(v_cancha, date '2027-03-01'))->'slots') s
   where s->>'hora_inicio' = '15:00';
  if v_disp is not false then
    raise exception 'FALLÓ (caso 12): el slot 15:00 también cae dentro del bloqueo';
  end if;
  raise notice 'OK (caso 12): el bloqueo saca los slots 14:00 y 15:00';

  select (s->>'disponible')::boolean into v_disp
    from json_array_elements((public.get_disponibilidad_cancha(v_cancha, date '2027-03-01'))->'slots') s
   where s->>'hora_inicio' = '13:00';
  if v_disp is not true then
    raise exception 'FALLÓ (caso 13): el slot 13:00-14:00 NO se cruza con un bloqueo 14:00-16:00';
  end if;
  raise notice 'OK (caso 13): el solape es semiabierto, 13:00 sigue libre';

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);
  v_j := public.crear_reserva(v_cancha, date '2027-03-01', time '14:00', 'completa', 'tarjeta');
  if (v_j->>'ok')::boolean is not false or v_j->>'reason' <> 'bloqueado' then
    raise exception 'FALLÓ (caso 14): crear_reserva debería rechazar un slot bloqueado, devolvió %', v_j::text;
  end if;
  raise notice 'OK (caso 14): crear_reserva rechaza el slot bloqueado';

  -- Reserva confirmada a las 18:00 para el caso 15.
  insert into public.reservas (
    id, cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
    precio_total, modalidad, medio_pago, estado
  ) values (
    v_reserva, v_cancha, v_ajeno, date '2027-03-01', time '18:00', time '19:00',
    20000, 'completa', 'tarjeta', 'confirmada'
  );

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_dueno, 'role', 'authenticated')::text);
  begin
    perform public.admin_crear_bloqueo(v_cancha, date '2027-03-01', time '18:00', time '19:00', 'Torneo');
    v_rechazado := false;
  exception when others then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 15): no debería poder bloquearse un horario con reserva confirmada';
  end if;
  raise notice 'OK (caso 15): bloquear sobre una reserva confirmada se rechaza';

  perform public.admin_eliminar_bloqueo(v_bloqueo);
  select (s->>'disponible')::boolean into v_disp
    from json_array_elements((public.get_disponibilidad_cancha(v_cancha, date '2027-03-01'))->'slots') s
   where s->>'hora_inicio' = '14:00';
  if v_disp is not true then
    raise exception 'FALLÓ (caso 16): al borrar el bloqueo el slot 14:00 debería volver a estar libre';
  end if;
  raise notice 'OK (caso 16): borrar el bloqueo devuelve el slot';

  -- ── Casos 17-19: RLS de las tablas nuevas ──────────────────────
  v_bloqueo := public.admin_crear_bloqueo(
    v_cancha, date '2027-03-08', time '14:00', time '16:00', 'Arriendo a una empresa'
  );

  execute format('set local role authenticated');

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);
  select count(*) into v_count from public.cancha_bloqueos where id = v_bloqueo;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 17): un ajeno no debería leer cancha_bloqueos (el motivo es privado)';
  end if;
  raise notice 'OK (caso 17): un ajeno no lee los bloqueos';

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin, 'role', 'authenticated')::text);
  select count(*) into v_count from public.cancha_bloqueos where id = v_bloqueo;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 18): un administrador del complejo debería leer sus bloqueos';
  end if;
  raise notice 'OK (caso 18): un administrador lee sus bloqueos con el motivo';

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);
  select count(*) into v_count from public.complejo_admins where complejo_id = v_complejo;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 19): un ajeno no debería ver quién administra un complejo, vio %', v_count;
  end if;
  raise notice 'OK (caso 19): un ajeno no ve el padrón de administradores';

  execute 'reset role';

  -- ── Caso 20: `anon` no ejecuta nada de administración ──────────
  -- La lección de la migración 58: Supabase concede EXECUTE a `anon` por
  -- defecto en cada función nueva y `revoke from public` no lo quita.
  execute format('set local role anon');

  begin
    perform * from public.admin_mis_complejos();
    v_rechazado := false;
  exception when insufficient_privilege then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 20a): anon no debería poder ejecutar admin_mis_complejos';
  end if;

  begin
    perform public.admin_actualizar_complejo(v_complejo, 'x');
    v_rechazado := false;
  exception when insufficient_privilege then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 20b): anon no debería poder ejecutar admin_actualizar_complejo';
  end if;

  begin
    perform public.admin_crear_bloqueo(v_cancha, date '2027-03-15', time '14:00', time '15:00');
    v_rechazado := false;
  exception when insufficient_privilege then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 20c): anon no debería poder ejecutar admin_crear_bloqueo';
  end if;

  begin
    perform public.admin_agregar_admin(v_complejo, v_ajeno, 'admin');
    v_rechazado := false;
  exception when insufficient_privilege then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 20d): anon no debería poder ejecutar admin_agregar_admin';
  end if;

  begin
    perform public.es_admin_complejo(v_complejo);
    v_rechazado := false;
  exception when insufficient_privilege then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 20e): anon no debería poder sondear es_admin_complejo';
  end if;

  execute 'reset role';

  -- `get_disponibilidad_cancha` sigue siendo pública a propósito: se
  -- muestra sin iniciar sesión, y ahora también respeta los bloqueos.
  execute format('set local role anon');
  v_j := public.get_disponibilidad_cancha(v_cancha, date '2027-03-08');
  if (v_j->>'ok')::boolean is not true then
    raise exception 'FALLÓ (caso 20f): anon debería seguir viendo la disponibilidad';
  end if;
  select (s->>'disponible')::boolean into v_disp
    from json_array_elements(v_j->'slots') s
   where s->>'hora_inicio' = '14:00';
  if v_disp is not false then
    raise exception 'FALLÓ (caso 20f): anon debería ver el slot bloqueado como no disponible';
  end if;
  execute 'reset role';
  raise notice 'OK (caso 20): anon no ejecuta ninguna RPC de administración, pero sí ve la disponibilidad con los bloqueos aplicados';

  raise notice '=== TODOS LOS CASOS DE LA MIGRACIÓN 60 PASARON ===';
end $$;

rollback;
