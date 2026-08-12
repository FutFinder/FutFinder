-- =============================================================
-- FutFinder — pruebas de ubicación en la propuesta (migración 43c)
--
-- Qué cubre:
--   1. Sin latitud ni longitud, la propuesta oficial NO se crea.
--   2. Con una sola de las dos tampoco.
--   3. Con las coordenadas como texto tampoco: el tipo se comprueba
--      antes de convertir, así que el motivo sale en español en vez de
--      un error de conversión de PostgreSQL.
--   4. Fuera del rango de la Tierra tampoco. No basta con «no es
--      nula»: el cliente llegó a enviar 0 y 0 cuando no había
--      ubicación, porque `Number(null)` es 0 en JavaScript.
--   5. Con coordenadas válidas SÍ se crea, se guardan tal cual y el
--      desafío pasa a 'esperando_aprobacion'.
--   6. Ninguno de los intentos fallidos deja el desafío movido ni una
--      propuesta a medio crear.
--   7. RLS: la dirección exacta la lee cualquier integrante de los dos
--      clubes, incluso sin rol de administrador, y NO la lee nadie
--      más.
--   8. PERMISOS: `crear_propuesta_oficial` no la puede ejecutar
--      `public` ni `anon`, sí `authenticated`.
--
-- Requisito: las migraciones 42, 43, 43b y 43c tienen que estar
-- aplicadas.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run. Todo corre dentro de una transacción que termina en
-- ROLLBACK, así que no queda nada guardado. Si algún caso falla, la
-- ejecución se corta con RAISE EXCEPTION indicando cuál.
-- =============================================================

begin;

create temp table t43c_resultado (
  n       integer,
  caso    text,
  detalle text
) on commit drop;

do $$
declare
  v_a1 uuid := gen_random_uuid();   -- admin del club A (propone)
  v_b1 uuid := gen_random_uuid();   -- admin del club B (rival)
  v_bj uuid := gen_random_uuid();   -- jugador del club B, sin rol
  v_x  uuid := gen_random_uuid();   -- ajeno a los dos clubes

  v_club_a uuid;
  v_club_b uuid;

  v_ch    uuid;
  v_prop  public.club_challenge_proposals;
  v_base  jsonb;

  v_count  int;
  v_estado text;
  v_ok     boolean;
  v_err    text;
  v_lat    double precision;
  v_lng    double precision;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
         'ubicacion-' || u.tag || '-' || u.id || '@futfinder.test', 'x', now(), now(), now(),
         '{}', '{}', '', '', '', ''
  from (values (v_a1,'a1'), (v_b1,'b1'), (v_bj,'bj'), (v_x,'x')) as u(id, tag);

  insert into public.clubs (nombre, slug, created_by, plan)
  values ('Club Ubica A', 'club-ubica-a', v_a1, 'premium') returning id into v_club_a;
  insert into public.clubs (nombre, slug, created_by, plan)
  values ('Club Ubica B', 'club-ubica-b', v_b1, 'premium') returning id into v_club_b;

  insert into public.club_members (club_id, user_id, rol) values
    (v_club_a, v_a1, 'admin'),
    (v_club_b, v_b1, 'admin'), (v_club_b, v_bj, 'jugador');

  insert into public.club_challenges (club_retador_id, club_retado_id, creado_por, estado)
  values (v_club_a, v_club_b, v_a1, 'pendiente') returning id into v_ch;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_b1, 'role', 'authenticated')::text);
  perform public.aceptar_desafio(v_ch);
  execute 'reset role';

  -- Todos los campos menos las coordenadas, que cada caso pone a su modo.
  v_base := jsonb_build_object(
    'fecha',              (now() + interval '5 days')::text,
    'duracion_min',       90,
    'direccion',          'Av. Grecia 3401',
    'cancha_nombre',      'Complejo Deportivo Ñuñoa',
    'comuna',             'Ñuñoa',
    'region',             'Metropolitana',
    'modalidad',          'futbol7',
    'cupos_por_club',     8,
    'metodo_inscripcion', 'orden_llegada',
    'cuota_por_persona',  3500,
    'instrucciones',      'Entrada por calle lateral.'
  );

  -- ══ CASO 1: sin coordenadas ══════════════════════════════════
  v_ok := false;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L',
      json_build_object('sub', v_a1, 'role', 'authenticated')::text);
    perform public.crear_propuesta_oficial(v_ch, v_base, gen_random_uuid());
    execute 'reset role';
  exception when others then
    execute 'reset role'; v_err := sqlerrm; v_ok := true;
  end;
  if not v_ok then
    raise exception 'FALLÓ (caso 1): se creó una propuesta sin coordenadas';
  end if;
  if v_err not like '%ubicación de la cancha en el mapa%' then
    raise exception 'FALLÓ (caso 1): el motivo debería ser la ubicación y dice "%"', v_err;
  end if;
  insert into t43c_resultado values (1, 'caso 1', format('sin coordenadas no se crea — %s', v_err));
  raise notice 'OK (caso 1): sin coordenadas no se crea — %', v_err;

  -- ══ CASO 2: sólo una de las dos ══════════════════════════════
  v_ok := false;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L',
      json_build_object('sub', v_a1, 'role', 'authenticated')::text);
    perform public.crear_propuesta_oficial(
      v_ch, v_base || jsonb_build_object('latitud', -33.4569), gen_random_uuid());
    execute 'reset role';
  exception when others then
    execute 'reset role'; v_err := sqlerrm; v_ok := true;
  end;
  if not v_ok then
    raise exception 'FALLÓ (caso 2): se creó una propuesta con media coordenada';
  end if;
  insert into t43c_resultado values (2, 'caso 2', format('media coordenada tampoco — %s', v_err));
  raise notice 'OK (caso 2): media coordenada tampoco — %', v_err;

  -- ══ CASO 3: coordenadas como texto ═══════════════════════════
  v_ok := false;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L',
      json_build_object('sub', v_a1, 'role', 'authenticated')::text);
    perform public.crear_propuesta_oficial(
      v_ch,
      v_base || jsonb_build_object('latitud', '-33.4569', 'longitud', '-70.6019'),
      gen_random_uuid());
    execute 'reset role';
  exception when others then
    execute 'reset role'; v_err := sqlerrm; v_ok := true;
  end;
  if not v_ok then
    raise exception 'FALLÓ (caso 3): se aceptaron coordenadas en texto';
  end if;
  if v_err not like '%ubicación de la cancha en el mapa%' then
    raise exception 'FALLÓ (caso 3): debería salir el motivo en español y dice "%"', v_err;
  end if;
  insert into t43c_resultado values (3, 'caso 3', format('coordenadas en texto se rechazan con motivo en español — %s', v_err));
  raise notice 'OK (caso 3): coordenadas en texto — %', v_err;

  -- ══ CASO 4: fuera del rango de la Tierra ═════════════════════
  v_ok := false;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L',
      json_build_object('sub', v_a1, 'role', 'authenticated')::text);
    perform public.crear_propuesta_oficial(
      v_ch, v_base || jsonb_build_object('latitud', 91, 'longitud', -70.6019), gen_random_uuid());
    execute 'reset role';
  exception when others then
    execute 'reset role'; v_err := sqlerrm; v_ok := true;
  end;
  if not v_ok then
    raise exception 'FALLÓ (caso 4): se aceptó una latitud de 91';
  end if;
  if v_err not like '%punto válido%' then
    raise exception 'FALLÓ (caso 4): el motivo debería ser el rango y dice "%"', v_err;
  end if;

  v_ok := false;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L',
      json_build_object('sub', v_a1, 'role', 'authenticated')::text);
    perform public.crear_propuesta_oficial(
      v_ch, v_base || jsonb_build_object('latitud', -33.4569, 'longitud', 181), gen_random_uuid());
    execute 'reset role';
  exception when others then
    execute 'reset role'; v_ok := true;
  end;
  if not v_ok then
    raise exception 'FALLÓ (caso 4): se aceptó una longitud de 181';
  end if;
  insert into t43c_resultado values (4, 'caso 4', format('fuera del rango de la Tierra se rechaza — %s', v_err));
  raise notice 'OK (caso 4): fuera de rango — %', v_err;

  -- ══ CASO 6 (antes que el 5): nada quedó a medio hacer ════════
  select count(*) into v_count from public.club_challenge_proposals where challenge_id = v_ch;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 6): los intentos fallidos dejaron % propuesta(s)', v_count;
  end if;
  select estado into v_estado from public.club_challenges where id = v_ch;
  if v_estado <> 'negociacion' then
    raise exception 'FALLÓ (caso 6): un intento fallido movió el desafío a %', v_estado;
  end if;
  insert into t43c_resultado values (6, 'caso 6', 'los 4 intentos fallidos no dejaron propuesta ni movieron el desafío de negociacion');
  raise notice 'OK (caso 6): ningún intento fallido dejó rastro';

  -- ══ CASO 5: propuesta válida ═════════════════════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_a1, 'role', 'authenticated')::text);
  v_prop := public.crear_propuesta_oficial(
    v_ch,
    v_base || jsonb_build_object('latitud', -33.4569, 'longitud', -70.6019),
    gen_random_uuid());
  execute 'reset role';

  if v_prop.id is null then
    raise exception 'FALLÓ (caso 5): la propuesta válida no se creó';
  end if;
  select latitud, longitud into v_lat, v_lng
    from public.club_challenge_proposals where id = v_prop.id;
  if v_lat is null or v_lng is null then
    raise exception 'FALLÓ (caso 5): las coordenadas no se guardaron';
  end if;
  if round(v_lat::numeric, 4) <> -33.4569 or round(v_lng::numeric, 4) <> -70.6019 then
    raise exception 'FALLÓ (caso 5): se guardaron otras coordenadas (%, %)', v_lat, v_lng;
  end if;
  select estado into v_estado from public.club_challenges where id = v_ch;
  if v_estado <> 'esperando_aprobacion' then
    raise exception 'FALLÓ (caso 5): el desafío debería estar esperando aprobación y está %', v_estado;
  end if;
  insert into t43c_resultado values (5, 'caso 5', 'con coordenadas válidas la propuesta se crea, las guarda tal cual y el desafío queda esperando_aprobacion');
  raise notice 'OK (caso 5): la propuesta válida se creó con sus coordenadas';

  -- ══ CASO 7: quién ve la dirección exacta ═════════════════════
  -- Un integrante del club rival SIN rol de administrador tiene que
  -- poder leerla: es lo que necesita para decidir si va.
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_bj, 'role', 'authenticated')::text);
  select count(*) into v_count
    from public.club_challenge_proposals
   where id = v_prop.id and direccion = 'Av. Grecia 3401';
  execute 'reset role';
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 7): un integrante sin rol no puede leer la dirección exacta';
  end if;

  -- Un ajeno a los dos clubes no ve nada.
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_x, 'role', 'authenticated')::text);
  select count(*) into v_count
    from public.club_challenge_proposals where id = v_prop.id;
  execute 'reset role';
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 7): un ajeno pudo leer la propuesta';
  end if;

  -- Y `anon` tampoco.
  --
  -- OJO: hay que BORRAR las claims antes de cambiar de rol. `set local role
  -- anon` no las toca, así que sin esta línea `auth.uid()` seguiría
  -- devolviendo el usuario del bloque anterior y la política se evaluaría
  -- como si hubiera sesión. La comprobación pasaría igual, pero midiendo otra
  -- cosa. Unas claims sin `sub` son lo que ve de verdad una petición anónima.
  execute format('set local request.jwt.claims to %L',
    json_build_object('role', 'anon')::text);
  execute 'set local role anon';
  select count(*) into v_count
    from public.club_challenge_proposals where id = v_prop.id;
  execute 'reset role';
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 7): anon pudo leer la propuesta';
  end if;
  insert into t43c_resultado values (7, 'caso 7', 'la dirección exacta la lee un integrante sin rol de cualquiera de los dos clubes; un ajeno y anon no leen nada');
  raise notice 'OK (caso 7): la dirección exacta sólo la ven los dos clubes';

  -- ══ CASO 8: permisos de ejecución ════════════════════════════
  if has_function_privilege('public', 'public.crear_propuesta_oficial(uuid, jsonb, uuid)', 'EXECUTE') then
    raise exception 'FALLÓ (caso 8): PUBLIC puede ejecutar crear_propuesta_oficial';
  end if;
  if has_function_privilege('anon', 'public.crear_propuesta_oficial(uuid, jsonb, uuid)', 'EXECUTE') then
    raise exception 'FALLÓ (caso 8): anon puede ejecutar crear_propuesta_oficial';
  end if;
  if not has_function_privilege('authenticated', 'public.crear_propuesta_oficial(uuid, jsonb, uuid)', 'EXECUTE') then
    raise exception 'FALLÓ (caso 8): authenticated NO puede ejecutar crear_propuesta_oficial';
  end if;
  insert into t43c_resultado values (8, 'caso 8', 'crear_propuesta_oficial: public=NO, anon=NO, authenticated=SÍ');
  raise notice 'OK (caso 8): permisos correctos';

  raise notice '════════ LOS 8 CASOS DE LA 43c PASARON ════════';
end;
$$;

select n, caso, detalle from t43c_resultado order by n;

rollback;
