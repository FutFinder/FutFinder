-- =============================================================
-- FutFinder — pruebas de la migración 82 (el dueño crea su recinto).
--
-- QUÉ SE PRUEBA:
--   1. Sin autorización no se crea nada.
--   2. Con autorización se crea, y nace SIN PUBLICAR y SIN VERIFICAR.
--   3. Quien llamó queda de dueño en el mismo movimiento.
--   4. La autorización queda usada y apuntando a ese recinto.
--   5. DE UN SOLO USO: la segunda llamada ya no tiene con qué.
--   6. Coordenadas fuera de Chile se rechazan (el error de signo típico).
--   7. Sin coordenadas se rechaza.
--   8. Sin nombre se rechaza.
--   9. Y ningún rechazo gastó la autorización.
--  10. Un recinto recién creado NO se puede publicar: falta la revisión.
--  11. Pedir revisión sin cancha con horario se rechaza.
--  12. Con cancha y horario, pedir revisión deja la marca.
--  13. Aprobado por FutFinder, publicar funciona.
--  14. Despublicar nunca exige aprobación.
--  15. Los recintos que ya existían quedaron aprobados: no se les rompió nada.
--  16. `admin_mis_complejos` trae el estado de revisión.
--  17. Un ajeno no puede pedir revisión de un recinto que no administra.
--  18. Cada quien ve solo sus autorizaciones.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
--
-- Requiere las migraciones 54 a 82 aplicadas.
-- Cómo correr: pégalo en Supabase → SQL Editor → Run. Termina en ROLLBACK.
-- =============================================================

begin;

create temp table r82 (caso text, ok boolean, detalle text);
grant all on r82 to authenticated, anon;

do $$
declare
  v_yo    uuid := gen_random_uuid();
  v_ajeno uuid := gen_random_uuid();
  v_auth  uuid;
  v_res   json;
  v_cpl   uuid;
  v_cancha uuid;
  v_n integer;
  v_b boolean;
  v_t timestamptz;
  v_rechazado boolean;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r82-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_yo, v_ajeno]) u;

  -- ── Todavía sin autorización ─────────────────────────────────
  set local role authenticated;
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_yo, 'role', 'authenticated')::text);

  v_res := public.crear_mi_recinto('Mi Recinto', 'Calle 1', 'Maipú', 'Metropolitana',
                                   -33.51, -70.77, null);
  insert into r82 values ('1', not (v_res->>'ok')::boolean, v_res->>'reason');

  -- ── El equipo autoriza ───────────────────────────────────────
  reset role;
  insert into public.autorizaciones_recinto (user_id, nota)
  values (v_yo, 'Prueba 82') returning id into v_auth;

  set local role authenticated;
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_yo, 'role', 'authenticated')::text);

  -- ── Los rechazos NO gastan la autorización ───────────────────
  v_res := public.crear_mi_recinto('Mi Recinto', 'Calle 1', 'Maipú', 'Metropolitana',
                                   33.51, -70.77, null);  -- latitud sin signo
  insert into r82 values ('6', not (v_res->>'ok')::boolean, v_res->>'reason');

  v_res := public.crear_mi_recinto('Mi Recinto', 'Calle 1', 'Maipú', 'Metropolitana',
                                   null, null, null);
  insert into r82 values ('7', not (v_res->>'ok')::boolean, v_res->>'reason');

  v_res := public.crear_mi_recinto('   ', 'Calle 1', 'Maipú', 'Metropolitana',
                                   -33.51, -70.77, null);
  insert into r82 values ('8', not (v_res->>'ok')::boolean, v_res->>'reason');

  select count(*) into v_n from public.autorizaciones_recinto
   where id = v_auth and usada_at is null;
  insert into r82 values ('9', v_n = 1, 'autorizaciones sin usar: ' || v_n);

  -- ── Ahora sí ─────────────────────────────────────────────────
  v_res := public.crear_mi_recinto('Mi Recinto', 'Calle 1', 'Maipú', 'Metropolitana',
                                   -33.51, -70.77, 'Dos canchas');
  v_cpl := (v_res->>'complejo_id')::uuid;
  insert into r82 values ('2a', (v_res->>'ok')::boolean and v_cpl is not null, v_res::text);

  reset role;
  select publicado, verificado_futfinder into v_b, v_rechazado
    from public.complejos where id = v_cpl;
  insert into r82 values ('2b', v_b = false and v_rechazado = false,
                          'publicado=' || v_b || ' verificado=' || v_rechazado);
  select aprobado_futfinder into v_b from public.complejos where id = v_cpl;
  insert into r82 values ('2c', v_b = false, 'aprobado_futfinder=' || v_b);

  select count(*) into v_n from public.complejo_admins
   where complejo_id = v_cpl and user_id = v_yo and rol = 'dueño';
  insert into r82 values ('3', v_n = 1, v_n || ' dueño(s)');

  select count(*) into v_n from public.autorizaciones_recinto
   where id = v_auth and usada_at is not null and complejo_id = v_cpl;
  insert into r82 values ('4', v_n = 1, 'autorización marcada como usada');

  -- ── De un solo uso ───────────────────────────────────────────
  set local role authenticated;
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_yo, 'role', 'authenticated')::text);
  v_res := public.crear_mi_recinto('Otro Recinto', 'Calle 2', 'Maipú', 'Metropolitana',
                                   -33.52, -70.78, null);
  insert into r82 values ('5', not (v_res->>'ok')::boolean, v_res->>'reason');

  -- ── Publicar exige la revisión ───────────────────────────────
  begin
    perform public.admin_publicar_complejo(v_cpl, true);
    v_rechazado := false;
  exception when others then v_rechazado := true; end;
  insert into r82 values ('10', v_rechazado, 'publicar sin aprobación');

  -- ── Pedir revisión sin cancha con horario ────────────────────
  v_res := public.admin_solicitar_revision_complejo(v_cpl);
  insert into r82 values ('11', not (v_res->>'ok')::boolean, v_res->>'reason');

  -- ── Con cancha y horario sí ──────────────────────────────────
  -- `admin_crear_cancha` devuelve el uuid directo, no un json.
  v_cancha := public.admin_crear_cancha(v_cpl, 'Cancha 1', 'futbol_7', 20000, 60);
  perform public.admin_upsert_horario_regla(
    v_cancha, extract(dow from current_date)::int, '09:00'::time, '22:00'::time, null);

  v_res := public.admin_solicitar_revision_complejo(v_cpl);
  insert into r82 values ('12a', (v_res->>'ok')::boolean, v_res::text);

  reset role;
  select revision_pedida_at into v_t from public.complejos where id = v_cpl;
  insert into r82 values ('12b', v_t is not null, coalesce(v_t::text, 'null'));

  -- ── FutFinder aprueba (lo hace el equipo, no el dueño) ───────
  update public.complejos set aprobado_futfinder = true where id = v_cpl;

  set local role authenticated;
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_yo, 'role', 'authenticated')::text);
  begin
    perform public.admin_publicar_complejo(v_cpl, true);
    v_rechazado := false;
  exception when others then v_rechazado := true; end;
  reset role;
  select publicado into v_b from public.complejos where id = v_cpl;
  insert into r82 values ('13', not v_rechazado and v_b, 'publicado=' || v_b);

  -- ── Despublicar nunca exige nada ─────────────────────────────
  update public.complejos set aprobado_futfinder = false where id = v_cpl;
  set local role authenticated;
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_yo, 'role', 'authenticated')::text);
  begin
    perform public.admin_publicar_complejo(v_cpl, false);
    v_rechazado := false;
  exception when others then v_rechazado := true; end;
  reset role;
  select publicado into v_b from public.complejos where id = v_cpl;
  insert into r82 values ('14', not v_rechazado and not v_b, 'publicado=' || v_b);

  -- ── Los que ya existían no perdieron nada ────────────────────
  select count(*) into v_n from public.complejos
   where id <> v_cpl and not aprobado_futfinder;
  insert into r82 values ('15', v_n = 0, v_n || ' recinto(s) viejo(s) sin aprobar');

  -- ── El panel ve el estado ────────────────────────────────────
  set local role authenticated;
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_yo, 'role', 'authenticated')::text);
  select count(*) into v_n from public.admin_mis_complejos() c
   where c.id = v_cpl and c.revision_pedida_at is not null and c.aprobado_futfinder = false;
  insert into r82 values ('16', v_n = 1, v_n || ' fila con el estado de revisión');

  -- ── El ajeno ─────────────────────────────────────────────────
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);
  begin
    perform public.admin_solicitar_revision_complejo(v_cpl);
    v_rechazado := false;
  exception when others then v_rechazado := true; end;
  insert into r82 values ('17', v_rechazado, 'pedir revisión siendo ajeno');

  select count(*) into v_n from public.autorizaciones_recinto;
  insert into r82 values ('18', v_n = 0, v_n || ' autorizaciones visibles para el ajeno');
end $$;

reset role;

select caso, case when ok then 'PASA' else 'FALLA' end as resultado, detalle
  from r82 order by caso;

do $$
declare v_malos integer; v_f record;
begin
  for v_f in select * from r82 order by caso loop
    if v_f.ok then raise notice 'OK (caso %): %', v_f.caso, v_f.detalle;
    else raise warning 'FALLÓ (caso %): %', v_f.caso, v_f.detalle; end if;
  end loop;
  select count(*) into v_malos from r82 where not ok;
  if v_malos > 0 then raise exception '% caso(s) de la migración 82 fallaron', v_malos; end if;
  raise notice '=== TODOS LOS CASOS DE LA MIGRACIÓN 82 PASARON ===';
end $$;

rollback;
