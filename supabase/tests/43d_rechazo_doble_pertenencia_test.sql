-- =============================================================
-- FutFinder — prueba de doble pertenencia al rechazar (migración 43d)
--
-- EL CASO QUE CIERRA ESTA MIGRACIÓN. La 43 exigía ser administrador de
-- un club del desafío distinto al proponente. Quien administra el club
-- rival Y ADEMÁS pertenece al club que propuso pasaba ese filtro: la
-- consulta encontraba igual el club contrario y lo dejaba responder por
-- él. Es decir, se contestaba a sí mismo.
--
-- Qué cubre:
--   1. El administrador del club rival que TAMBIÉN pertenece al club
--      proponente NO puede rechazar. Es el caso de la migración.
--   2. Da igual con qué rol pertenezca al club proponente: se prueba
--      como 'jugador', que es el caso que el filtro por `rol = 'admin'`
--      dejaba pasar.
--   3. El club proponente tampoco puede rechazar su propia propuesta.
--   4. Un administrador del club rival SIN vínculo con el proponente sí
--      puede: la regla estricta no rompe el camino normal.
--   5. Rechazar deja el desafío en 'negociacion' y la propuesta con su
--      motivo.
--   6. Rechazar dos veces devuelve lo mismo y no duplica eventos.
--   7. Ningún intento fallido cambió nada.
--   8. PERMISOS: `rechazar_propuesta` no la puede ejecutar `public` ni
--      `anon`, sí `authenticated`.
--
-- Requisito: las migraciones 42, 43, 43b, 43c y 43d tienen que estar
-- aplicadas.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run. Todo corre dentro de una transacción que termina en
-- ROLLBACK, así que no queda nada guardado.
-- =============================================================

begin;

create temp table t43d_resultado (
  n       integer,
  caso    text,
  detalle text
) on commit drop;

do $$
declare
  v_w1 uuid := gen_random_uuid();   -- admin del club W (propone)
  v_z1 uuid := gen_random_uuid();   -- admin del club Z (rival, sin vínculo con W)
  v_dd uuid := gen_random_uuid();   -- admin de Z y, después, jugador de W

  v_club_w uuid;
  v_club_z uuid;

  v_ch    uuid;
  v_prop  public.club_challenge_proposals;
  v_prop2 public.club_challenge_proposals;
  v_prop3 public.club_challenge_proposals;
  v_base  jsonb;

  v_count  int;
  v_estado text;
  v_ok     boolean;
  v_err    text;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
         'doble-' || u.tag || '-' || u.id || '@futfinder.test', 'x', now(), now(), now(),
         '{}', '{}', '', '', '', ''
  from (values (v_w1,'w1'), (v_z1,'z1'), (v_dd,'dd')) as u(id, tag);

  insert into public.clubs (nombre, slug, created_by, plan)
  values ('Club Doble W', 'club-doble-w', v_w1, 'premium') returning id into v_club_w;
  insert into public.clubs (nombre, slug, created_by, plan)
  values ('Club Doble Z', 'club-doble-z', v_z1, 'premium') returning id into v_club_z;

  insert into public.club_members (club_id, user_id, rol) values
    (v_club_w, v_w1, 'admin'),
    (v_club_z, v_z1, 'admin'), (v_club_z, v_dd, 'admin');

  insert into public.club_challenges (club_retador_id, club_retado_id, creado_por, estado)
  values (v_club_w, v_club_z, v_w1, 'pendiente') returning id into v_ch;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_z1, 'role', 'authenticated')::text);
  perform public.aceptar_desafio(v_ch);
  execute 'reset role';

  v_base := jsonb_build_object(
    'fecha',              (now() + interval '6 days')::text,
    'duracion_min',       90,
    'direccion',          'Av. Matta 1200',
    'cancha_nombre',      'Cancha Matta',
    'comuna',             'Santiago',
    'region',             'Metropolitana',
    'latitud',            -33.4601,
    'longitud',           -70.6432,
    'modalidad',          'futbol7',
    'cupos_por_club',     6,
    'metodo_inscripcion', 'orden_llegada',
    'cuota_por_persona',  3000,
    'instrucciones',      null
  );

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_w1, 'role', 'authenticated')::text);
  v_prop := public.crear_propuesta_oficial(v_ch, v_base, gen_random_uuid());
  execute 'reset role';

  -- DD entra al club proponente DESPUÉS de creado el desafío. Se hace
  -- así a propósito: el trigger `club_challenges_valida_rival` impide
  -- crear un desafío entre clubes que ya comparten administrador, así
  -- que la única forma real de llegar a esta situación es que la
  -- membresía cambie después. Y entra como JUGADOR, que es el rol que el
  -- filtro `rol = 'admin'` de la 43 dejaba pasar.
  insert into public.club_members (club_id, user_id, rol)
  values (v_club_w, v_dd, 'jugador');

  -- ══ CASOS 1 y 2: doble pertenencia ═══════════════════════════
  v_ok := false;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L',
      json_build_object('sub', v_dd, 'role', 'authenticated')::text);
    perform public.rechazar_propuesta(v_prop.id, 'No nos acomoda');
    execute 'reset role';
  exception when others then
    execute 'reset role'; v_err := sqlerrm; v_ok := true;
  end;
  if not v_ok then
    raise exception 'FALLÓ (caso 1): quien está en los dos clubes pudo rechazar en nombre del rival';
  end if;
  if v_err not like '%club al que perteneces%' then
    raise exception 'FALLÓ (caso 1): el motivo debería ser la doble pertenencia y dice "%"', v_err;
  end if;
  insert into t43d_resultado values (1, 'caso 1', format('admin del rival que además pertenece al proponente NO rechaza — %s', v_err));
  insert into t43d_resultado values (2, 'caso 2', 'pertenece al proponente como jugador, no como admin: el filtro por rol de la 43 lo dejaba pasar y ahora no');
  raise notice 'OK (casos 1 y 2): la doble pertenencia bloquea el rechazo — %', v_err;

  -- ══ CASO 3: el proponente tampoco ════════════════════════════
  v_ok := false;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L',
      json_build_object('sub', v_w1, 'role', 'authenticated')::text);
    perform public.rechazar_propuesta(v_prop.id, 'Me arrepentí');
    execute 'reset role';
  exception when others then
    execute 'reset role'; v_err := sqlerrm; v_ok := true;
  end;
  if not v_ok then
    raise exception 'FALLÓ (caso 3): el club proponente pudo rechazar su propia propuesta';
  end if;
  insert into t43d_resultado values (3, 'caso 3', format('el club proponente no rechaza lo suyo — %s', v_err));
  raise notice 'OK (caso 3): el proponente no rechaza lo suyo — %', v_err;

  -- ══ CASO 7 (antes del 4): nada cambió ════════════════════════
  select estado into v_estado from public.club_challenge_proposals where id = v_prop.id;
  if v_estado <> 'pendiente' then
    raise exception 'FALLÓ (caso 7): un rechazo bloqueado dejó la propuesta en %', v_estado;
  end if;
  select estado into v_estado from public.club_challenges where id = v_ch;
  if v_estado <> 'esperando_aprobacion' then
    raise exception 'FALLÓ (caso 7): un rechazo bloqueado movió el desafío a %', v_estado;
  end if;
  select count(*) into v_count
    from public.club_challenge_events where challenge_id = v_ch and tipo = 'propuesta_rechazada';
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 7): un rechazo bloqueado dejó % evento(s)', v_count;
  end if;
  insert into t43d_resultado values (7, 'caso 7', 'los rechazos bloqueados no movieron la propuesta, ni el desafío, ni dejaron evento');
  raise notice 'OK (caso 7): los intentos bloqueados no dejaron rastro';

  -- ══ CASOS 4 y 5: el rival limpio sí puede ════════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_z1, 'role', 'authenticated')::text);
  v_prop2 := public.rechazar_propuesta(v_prop.id, 'Esa cancha nos queda muy lejos');
  execute 'reset role';

  if v_prop2.estado <> 'rechazada' then
    raise exception 'FALLÓ (caso 4): la propuesta debería quedar rechazada y está %', v_prop2.estado;
  end if;
  if v_prop2.motivo_rechazo <> 'Esa cancha nos queda muy lejos' then
    raise exception 'FALLÓ (caso 5): no se conservó el motivo del rechazo';
  end if;
  if v_prop2.respondida_por <> v_z1 then
    raise exception 'FALLÓ (caso 5): no se registró quién respondió';
  end if;
  select estado into v_estado from public.club_challenges where id = v_ch;
  if v_estado <> 'negociacion' then
    raise exception 'FALLÓ (caso 5): el desafío debería volver a negociacion y está %', v_estado;
  end if;
  insert into t43d_resultado values (4, 'caso 4', 'un admin del rival sin vínculo con el proponente SÍ rechaza: la regla estricta no rompe el camino normal');
  insert into t43d_resultado values (5, 'caso 5', 'rechazar deja el desafío en negociacion y conserva motivo y autor');
  raise notice 'OK (casos 4 y 5): el rival limpio rechazó y el desafío volvió a negociación';

  -- ══ CASO 6: rechazar dos veces ═══════════════════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_z1, 'role', 'authenticated')::text);
  v_prop3 := public.rechazar_propuesta(v_prop.id, 'Otro motivo distinto');
  execute 'reset role';

  if v_prop3.id <> v_prop2.id or v_prop3.estado <> 'rechazada' then
    raise exception 'FALLÓ (caso 6): el segundo rechazo no devolvió la misma propuesta';
  end if;
  if v_prop3.motivo_rechazo <> 'Esa cancha nos queda muy lejos' then
    raise exception 'FALLÓ (caso 6): el segundo rechazo pisó el motivo original';
  end if;
  select count(*) into v_count
    from public.club_challenge_events where challenge_id = v_ch and tipo = 'propuesta_rechazada';
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 6): rechazar dos veces dejó % eventos', v_count;
  end if;
  insert into t43d_resultado values (6, 'caso 6', 'rechazar dos veces devuelve la misma propuesta, conserva el motivo original y deja 1 solo evento');
  raise notice 'OK (caso 6): el segundo rechazo es idempotente';

  -- ══ CASO 8: permisos de ejecución ════════════════════════════
  if has_function_privilege('public', 'public.rechazar_propuesta(uuid, text)', 'EXECUTE') then
    raise exception 'FALLÓ (caso 8): PUBLIC puede ejecutar rechazar_propuesta';
  end if;
  if has_function_privilege('anon', 'public.rechazar_propuesta(uuid, text)', 'EXECUTE') then
    raise exception 'FALLÓ (caso 8): anon puede ejecutar rechazar_propuesta';
  end if;
  if not has_function_privilege('authenticated', 'public.rechazar_propuesta(uuid, text)', 'EXECUTE') then
    raise exception 'FALLÓ (caso 8): authenticated NO puede ejecutar rechazar_propuesta';
  end if;
  insert into t43d_resultado values (8, 'caso 8', 'rechazar_propuesta: public=NO, anon=NO, authenticated=SÍ');
  raise notice 'OK (caso 8): permisos correctos';

  raise notice '════════ LOS 8 CASOS DE LA 43d PASARON ════════';
end;
$$;

select n, caso, detalle from t43d_resultado order by n;

rollback;
