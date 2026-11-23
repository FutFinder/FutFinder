-- =============================================================
-- FutFinder — arnés de la migración 164
--
-- Qué cubre:
--   1. Quien NO está en el padrón no ve la cola ni puede aprobar: las dos
--      funciones levantan NO_MODERA (42501).
--   2. Un recinto que pidió revisión y no está aprobado APARECE en
--      `recintos_esperando`, con su comuna y con cuántas canchas activas
--      con horario tiene.
--   3. Un recinto aprobado NO aparece, y uno que nunca pidió revisión
--      tampoco. Es el control negativo: sin él, una cola que devolviera
--      todos los recintos pasaría el caso 2.
--   4. `moderacion_aprobar_recinto` aprueba, lo saca de la cola, y NO lo
--      publica — publicar es del dueño.
--   5. Aprobar dos veces no es un error (`ya_estaba: true`), y aprobar algo
--      que no existe devuelve ok:false en vez de reventar.
--   6. Las tres colas de la 151 siguen estando: la 164 agrega, no pisa.
--
-- Cómo correr: pegar completo en el SQL Editor. Todo va dentro de una
-- transacción que termina en ROLLBACK. Si algo falla, se corta con
-- RAISE EXCEPTION diciendo cuál.
-- =============================================================

begin;

do $$
declare
  v_mod        uuid := gen_random_uuid();
  v_ajeno      uuid := gen_random_uuid();
  v_esperando  uuid;
  v_aprobado   uuid;
  v_sin_pedir  uuid;
  v_cancha     uuid;
  v_cola       jsonb;
  v_fila       jsonb;
  v_r          json;
  v_raised     boolean;
  v_n          int;
begin
  -- ── Dos cuentas: una modera, la otra no ────────────────────────
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
      'mod164-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_mod, v_ajeno]) u;

  insert into public.moderadores (user_id) values (v_mod);

  -- ── Tres recintos, uno por cada estado que importa ─────────────
  insert into public.complejos (nombre, direccion, comuna, region, latitud, longitud, created_by,
                                revision_pedida_at, aprobado_futfinder, publicado)
  values ('Recinto que espera 164', 'Av. Prueba 100', 'Ñuñoa',
          'Región Metropolitana de Santiago', -33.4569, -70.6107, v_mod, now() - interval '35 days', false, false)
  returning id into v_esperando;

  insert into public.complejos (nombre, direccion, comuna, region, latitud, longitud, created_by,
                                revision_pedida_at, aprobado_futfinder, publicado)
  values ('Recinto ya aprobado 164', 'Av. Prueba 200', 'Ñuñoa',
          'Región Metropolitana de Santiago', -33.4569, -70.6107, v_mod, now() - interval '9 days', true, false)
  returning id into v_aprobado;

  insert into public.complejos (nombre, direccion, comuna, region, latitud, longitud, created_by,
                                revision_pedida_at, aprobado_futfinder, publicado)
  values ('Recinto que nunca pidió 164', 'Av. Prueba 300', 'Ñuñoa',
          'Región Metropolitana de Santiago', -33.4569, -70.6107, v_mod, null, false, false)
  returning id into v_sin_pedir;

  -- Dos canchas en el que espera: una activa con horario, otra sin horario.
  -- El conteo tiene que decir 1, no 2.
  insert into public.canchas_reservables (complejo_id, nombre, tipo, precio_hora, duracion_slot_min, activa)
  values (v_esperando, 'Cancha con horario', 'futbol_7', 28000, 60, true)
  returning id into v_cancha;
  insert into public.cancha_horario_reglas (cancha_id, dia_semana, hora_apertura, hora_cierre)
  values (v_cancha, 3, '09:00', '23:00');

  insert into public.canchas_reservables (complejo_id, nombre, tipo, precio_hora, duracion_slot_min, activa)
  values (v_esperando, 'Cancha sin horario', 'futbol_5', 20000, 60, true);

  -- ══ CASO 1: sin padrón no se ve nada ════════════════════════════
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_ajeno::text, true);

  v_raised := false;
  begin perform public.moderacion_cola();
  exception when insufficient_privilege then v_raised := true; end;
  if not v_raised then
    raise exception 'FALLÓ (caso 1): quien no modera no debería poder leer la cola';
  end if;

  v_raised := false;
  begin perform public.moderacion_aprobar_recinto(v_esperando);
  exception when insufficient_privilege then v_raised := true; end;
  if not v_raised then
    raise exception 'FALLÓ (caso 1): quien no modera no debería poder aprobar un recinto';
  end if;
  raise notice 'OK (caso 1): las dos puertas vuelven a comprobar el padrón';

  -- ══ CASO 2: el que espera aparece, con sus datos ════════════════
  perform set_config('request.jwt.claim.sub', v_mod::text, true);
  v_cola := public.moderacion_cola();

  select j into v_fila
    from jsonb_array_elements(v_cola->'recintos_esperando') j
   where (j->>'id')::uuid = v_esperando;

  if v_fila is null then
    raise exception 'FALLÓ (caso 2): el recinto que pidió revisión no está en la cola';
  end if;
  if v_fila->>'nombre' <> 'Recinto que espera 164' then
    raise exception 'FALLÓ (caso 2): nombre equivocado: %', v_fila->>'nombre';
  end if;
  if v_fila->>'comuna' <> 'Ñuñoa' then
    raise exception 'FALLÓ (caso 2): la cola no trae la comuna';
  end if;
  if (v_fila->>'canchas')::int <> 1 then
    raise exception 'FALLÓ (caso 2): debería contar 1 cancha activa CON horario, no %', v_fila->>'canchas';
  end if;
  if v_fila->>'pedida_at' is null then
    raise exception 'FALLÓ (caso 2): sin la fecha no se sabe cuánto lleva esperando';
  end if;
  raise notice 'OK (caso 2): el recinto que espera aparece con comuna, fecha y canchas reservables';

  -- ══ CASO 3: control negativo ════════════════════════════════════
  if exists (select 1 from jsonb_array_elements(v_cola->'recintos_esperando') j
              where (j->>'id')::uuid = v_aprobado) then
    raise exception 'FALLÓ (caso 3): un recinto YA APROBADO no debería seguir en la cola';
  end if;
  if exists (select 1 from jsonb_array_elements(v_cola->'recintos_esperando') j
              where (j->>'id')::uuid = v_sin_pedir) then
    raise exception 'FALLÓ (caso 3): un recinto que nunca pidió revisión no debería estar en la cola';
  end if;
  raise notice 'OK (caso 3): la cola es la de los que esperan, no la de todos los recintos';

  -- ══ CASO 4: aprobar lo saca de la cola y NO lo publica ══════════
  v_r := public.moderacion_aprobar_recinto(v_esperando);
  if (v_r->>'ok')::boolean is distinct from true then
    raise exception 'FALLÓ (caso 4): aprobar falló: %', v_r;
  end if;
  if (v_r->>'ya_estaba')::boolean then
    raise exception 'FALLÓ (caso 4): no estaba aprobado y dijo que sí';
  end if;

  -- SE LEE FUERA DEL ROL. `complejos` sólo deja ver lo publicado a quien no
  -- lo administra, y este recinto justamente no está publicado: leyéndolo
  -- como `authenticated` la fila no aparece y el arnés culparía a la
  -- función. Lo que se mide acá es lo que la función ESCRIBIÓ.
  execute 'reset role';
  select count(*) into v_n from public.complejos
   where id = v_esperando and aprobado_futfinder and not publicado;
  execute 'set local role authenticated';
  if v_n <> 1 then
    raise exception 'FALLÓ (caso 4): tras aprobar debería quedar aprobado y SIN publicar';
  end if;

  v_cola := public.moderacion_cola();
  if exists (select 1 from jsonb_array_elements(v_cola->'recintos_esperando') j
              where (j->>'id')::uuid = v_esperando) then
    raise exception 'FALLÓ (caso 4): aprobado y todavía en la cola';
  end if;
  raise notice 'OK (caso 4): aprobar lo saca de la cola y deja publicar al dueño';

  -- ══ CASO 5: idempotente, y sin reventar con lo que no existe ════
  v_r := public.moderacion_aprobar_recinto(v_esperando);
  if (v_r->>'ok')::boolean is distinct from true or not (v_r->>'ya_estaba')::boolean then
    raise exception 'FALLÓ (caso 5): aprobar dos veces debería decir ya_estaba, no fallar: %', v_r;
  end if;

  v_r := public.moderacion_aprobar_recinto(gen_random_uuid());
  if (v_r->>'ok')::boolean is distinct from false then
    raise exception 'FALLÓ (caso 5): aprobar un recinto inexistente debería devolver ok:false: %', v_r;
  end if;
  raise notice 'OK (caso 5): doble toque y recinto borrado no son excepciones';

  -- ══ CASO 6: la 164 agrega, no pisa ══════════════════════════════
  if v_cola->'revisiones_de_sancion' is null
     or v_cola->'resultados_en_disputa' is null
     or v_cola->'reportes_sin_mirar' is null then
    raise exception 'FALLÓ (caso 6): la cuarta cola se comió alguna de las tres de la 151';
  end if;
  raise notice 'OK (caso 6): las tres colas de la 151 siguen ahí';

  raise notice '✅ TODOS LOS CASOS DE LA 164 PASARON';
end $$;

reset role;
rollback;
