-- =============================================================
-- FutFinder — pruebas de la migración 120.
--
-- Lo que esta migración promete, y que acá se comprueba de verdad:
--
--   Lo que NO cambió (la parte que da miedo: `crear_` se reescribió para
--   sacarle la copia de la validación)
--   R1. Crear sigue creando: una fila, `reusada: false`, y los datos
--       quedan normalizados igual que antes (teléfono a 9 dígitos,
--       correo en minúsculas, nombre sin espacios sobrantes).
--   R2. Mandar el MISMO recinto dos veces sigue devolviendo la primera
--       con `reusada: true` y SIGUE sin tocar los datos. Eso no es un
--       arreglo pendiente: es el motivo por el que existe `actualizar_`.
--   R3. La validación sigue rechazando lo mismo (teléfono, correo,
--       foto de carpeta ajena, servicio fuera del catálogo).
--
--   Lo que se puede hacer ahora
--   N1. Corregir una solicitud propia en estado `nueva` cambia los datos
--       DE VERDAD.
--   N2. Corregir vuelve a dejar `avisada_at` en null — sin eso el equipo
--       se queda con el correo del dato malo y la corrección no sale
--       nunca de la base.
--   N3. Corregir valida exactamente igual que crear: se comprueba con el
--       mismo teléfono malo y el mismo motivo, que es lo que demuestra
--       que la validación compartida quedó bien enchufada.
--   N4. Renombrar funciona, y después el nombre VIEJO vuelve a estar
--       libre para una solicitud nueva.
--
--   Lo que sigue sin poderse
--   C1. La solicitud de OTRA persona no se corrige, y el mensaje no
--       delata si ese id existe.
--   C2. Una solicitud que el equipo ya tomó (estado <> 'nueva') no se
--       corrige por acá.
--   C3. Renombrarla encima de otra solicitud pendiente propia se
--       rechaza: dejaría dos «nuevas» iguales y `crear_` no sabría cuál
--       devolver.
--   C4. Ni `anon` ni PUBLIC ejecutan ninguna de las tres funciones.
--       `authenticated` sí las dos puertas, pero NO el validador.
--
-- Se ejecuta entero dentro de begin/rollback: no deja nada.
-- =============================================================

begin;
create temp table r120 (caso text, ok boolean, detalle text);
-- El arnés escribe la tabla de resultados desde dentro de `authenticated`,
-- así que hay que concederla: una temp table nace cerrada.
grant all on r120 to authenticated;

do $$
declare
  v_a       uuid := gen_random_uuid();   -- dueño
  v_b       uuid := gen_random_uuid();   -- otra persona
  v_res     jsonb;
  v_id      uuid;
  v_id2     uuid;
  v_fila    public.solicitudes_recinto%rowtype;
  v_n       int;
begin
  -- ── C4: los permisos, antes de tocar nada ────────────────────
  insert into r120 values ('C4a anon y PUBLIC no ejecutan crear_ ni actualizar_',
    not has_function_privilege('anon',
      'public.crear_solicitud_recinto(text,text,text,text,text,text,text,int,text[],text[])', 'EXECUTE')
    and not has_function_privilege('anon',
      'public.actualizar_solicitud_recinto(uuid,text,text,text,text,text,text,text,int,text[],text[])', 'EXECUTE'),
    'anon crear=' || has_function_privilege('anon',
      'public.crear_solicitud_recinto(text,text,text,text,text,text,text,int,text[],text[])', 'EXECUTE')::text);

  insert into r120 values ('C4b authenticated ejecuta las dos puertas',
    has_function_privilege('authenticated',
      'public.crear_solicitud_recinto(text,text,text,text,text,text,text,int,text[],text[])', 'EXECUTE')
    and has_function_privilege('authenticated',
      'public.actualizar_solicitud_recinto(uuid,text,text,text,text,text,text,text,int,text[],text[])', 'EXECUTE'),
    'las dos concedidas');

  -- El validador no es una puerta: nadie lo llama desde afuera.
  insert into r120 values ('C4c el validador no lo ejecuta nadie de afuera',
    not has_function_privilege('anon',
      'public.valida_solicitud_recinto(uuid,text,text,text,text,text,text,text,int,text[],text[])', 'EXECUTE')
    and not has_function_privilege('authenticated',
      'public.valida_solicitud_recinto(uuid,text,text,text,text,text,text,text,int,text[],text[])', 'EXECUTE'),
    'anon=' || has_function_privilege('anon',
      'public.valida_solicitud_recinto(uuid,text,text,text,text,text,text,text,int,text[],text[])', 'EXECUTE')::text
    || ' authenticated=' || has_function_privilege('authenticated',
      'public.valida_solicitud_recinto(uuid,text,text,text,text,text,text,text,int,text[],text[])', 'EXECUTE')::text);

  -- ── Dos personas de mentira ──────────────────────────────────
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r120-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_a, v_b]) u;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);

  -- ── R1: crear sigue creando ──────────────────────────────────
  v_res := public.crear_solicitud_recinto(
    '  Cancha Los Álamos  ', 'Av. Siempre Viva 742', 'Maipú', '  Juan Pérez  ',
    '+56 9 1234 5678', '  JUAN@Ejemplo.CL ', 'Tenemos dos canchas techadas.', 4,
    array[v_a::text || '/foto1.jpg'], array['camarines', 'duchas']);
  v_id := (v_res ->> 'id')::uuid;
  select * into v_fila from public.solicitudes_recinto where id = v_id;

  insert into r120 values ('R1a crear devuelve ok y reusada:false',
    (v_res ->> 'ok') = 'true' and (v_res ->> 'reusada') = 'false',
    coalesce(v_res ->> 'reason', 'creada'));
  insert into r120 values ('R1b crear normaliza igual que antes',
    v_fila.nombre_recinto = 'Cancha Los Álamos'
      and v_fila.nombre_dueno = 'Juan Pérez'
      and v_fila.telefono = '+56912345678'
      and v_fila.correo = 'juan@ejemplo.cl'
      and v_fila.n_canchas = 4
      and v_fila.servicios @> array['camarines','duchas']::text[],
    'tel=' || v_fila.telefono || ' correo=' || v_fila.correo || ' nombre=' || v_fila.nombre_recinto);

  -- ── R2: el mismo recinto otra vez NO corrige ─────────────────
  v_res := public.crear_solicitud_recinto(
    'cancha los álamos', 'OTRA DIRECCIÓN 999', 'Ñuñoa', 'Juan Pérez',
    '+56 9 8765 4321', 'otro@ejemplo.cl', null, 6, null, null);
  select * into v_fila from public.solicitudes_recinto where id = v_id;
  select count(*) into v_n from public.solicitudes_recinto where solicitante_id = v_a;

  insert into r120 values ('R2a el mismo nombre devuelve la primera, sin crear otra',
    (v_res ->> 'reusada') = 'true' and (v_res ->> 'id')::uuid = v_id and v_n = 1,
    'reusada=' || coalesce(v_res ->> 'reusada','-') || ' filas=' || v_n);
  insert into r120 values ('R2b y NO pisa los datos (por eso existe actualizar_)',
    v_fila.direccion = 'Av. Siempre Viva 742' and v_fila.telefono = '+56912345678',
    'sigue: ' || v_fila.direccion);

  -- ── R3: la validación no se aflojó ───────────────────────────
  v_res := public.crear_solicitud_recinto('Otro Recinto', 'Calle 1', 'Maipú', 'Juan',
    '221234567', 'juan@ejemplo.cl', null, null, null, null);
  insert into r120 values ('R3a crear sigue rechazando un fijo',
    (v_res ->> 'ok') = 'false' and v_res ->> 'reason' like 'Revisa el teléfono%', v_res ->> 'reason');

  v_res := public.crear_solicitud_recinto('Otro Recinto', 'Calle 1', 'Maipú', 'Juan',
    '912345678', 'juan@ejemplo.cl', null, null, array[v_b::text || '/ajena.jpg'], null);
  insert into r120 values ('R3b crear sigue rechazando una foto de carpeta ajena',
    (v_res ->> 'ok') = 'false' and v_res ->> 'reason' like '%fotos%', v_res ->> 'reason');

  v_res := public.crear_solicitud_recinto('Otro Recinto', 'Calle 1', 'Maipú', 'Juan',
    '912345678', 'juan@ejemplo.cl', null, null, null, array['helipuerto']);
  insert into r120 values ('R3c crear sigue rechazando un servicio inventado',
    (v_res ->> 'ok') = 'false' and v_res ->> 'reason' like '%servicios%', v_res ->> 'reason');

  -- ── N1 y N2: corregir corrige, y vuelve a avisar ─────────────
  -- Se marca como ya avisada para poder ver que la corrección la
  -- devuelve a null: eso es lo que hace salir el correo nuevo.
  set local role postgres;
  update public.solicitudes_recinto set avisada_at = now() where id = v_id;
  set local role authenticated;

  v_res := public.actualizar_solicitud_recinto(
    v_id, 'Cancha Los Álamos', 'Av. Siempre Viva 742, local 3', 'Maipú', 'Juan Pérez',
    '+56 9 8765 4321', 'juan.perez@ejemplo.cl', 'Corrijo el teléfono.', 5,
    array[v_a::text || '/foto1.jpg', v_a::text || '/foto2.jpg'], array['camarines']);
  select * into v_fila from public.solicitudes_recinto where id = v_id;

  insert into r120 values ('N1a corregir devuelve ok y corregida:true',
    (v_res ->> 'ok') = 'true' and (v_res ->> 'corregida') = 'true',
    coalesce(v_res ->> 'reason', 'corregida'));
  insert into r120 values ('N1b los datos cambiaron DE VERDAD',
    v_fila.telefono = '+56987654321'
      and v_fila.correo = 'juan.perez@ejemplo.cl'
      and v_fila.direccion = 'Av. Siempre Viva 742, local 3'
      and v_fila.n_canchas = 5
      and coalesce(array_length(v_fila.fotos, 1), 0) = 2
      and v_fila.servicios = array['camarines']::text[],
    'tel=' || v_fila.telefono || ' canchas=' || v_fila.n_canchas
      || ' fotos=' || coalesce(array_length(v_fila.fotos,1), 0));
  insert into r120 values ('N2 corregir deja avisada_at en null: el equipo recibe la corrección',
    v_fila.avisada_at is null, 'avisada_at=' || coalesce(v_fila.avisada_at::text, 'null'));

  select count(*) into v_n from public.solicitudes_recinto where solicitante_id = v_a;
  insert into r120 values ('N1c corregir NO crea una segunda solicitud', v_n = 1, v_n || ' fila(s)');

  -- ── N3: corregir valida igual que crear ──────────────────────
  v_res := public.actualizar_solicitud_recinto(v_id, 'Cancha Los Álamos', 'Calle 1', 'Maipú',
    'Juan', '221234567', 'juan@ejemplo.cl', null, null, null, null);
  select * into v_fila from public.solicitudes_recinto where id = v_id;
  insert into r120 values ('N3a corregir rechaza el fijo con el MISMO motivo que crear',
    (v_res ->> 'ok') = 'false' and v_res ->> 'reason' like 'Revisa el teléfono%', v_res ->> 'reason');
  insert into r120 values ('N3b una corrección rechazada no deja nada a medias',
    v_fila.telefono = '+56987654321' and v_fila.direccion = 'Av. Siempre Viva 742, local 3',
    'sigue: ' || v_fila.telefono);

  v_res := public.actualizar_solicitud_recinto(v_id, 'Cancha Los Álamos', 'Calle 1', 'Maipú',
    'Juan', '912345678', 'juan@ejemplo.cl', null, null, array[v_b::text || '/ajena.jpg'], null);
  insert into r120 values ('N3c corregir rechaza una foto de carpeta ajena',
    (v_res ->> 'ok') = 'false' and v_res ->> 'reason' like '%fotos%', v_res ->> 'reason');

  -- ── C1: la de otra persona, no ───────────────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  v_res := public.actualizar_solicitud_recinto(v_id, 'Mío ahora', 'Calle 2', 'Maipú',
    'Otro', '912345678', 'otro@ejemplo.cl', null, null, null, null);
  -- La fila se lee como `postgres`: la RLS no deja que B vea una solicitud
  -- ajena, y lo que se comprueba acá es que NO CAMBIÓ, no quién la ve.
  set local role postgres;
  select * into v_fila from public.solicitudes_recinto where id = v_id;
  set local role authenticated;
  insert into r120 values ('C1 la solicitud de otra persona no se corrige',
    (v_res ->> 'ok') = 'false' and v_fila.nombre_recinto = 'Cancha Los Álamos',
    v_res ->> 'reason');
  -- El motivo tiene que ser el mismo que para un id inventado: si fueran
  -- distintos, probar ids sería una forma de averiguar cuáles existen.
  -- Con datos VÁLIDOS: la validación corre antes que la búsqueda, así que un
  -- nombre de un carácter nunca llegaría a la comprobación de dueño y la
  -- prueba no probaría nada.
  v_res := public.actualizar_solicitud_recinto(gen_random_uuid(), 'Recinto Inventado',
    'Calle 2', 'Maipú', 'Otro', '912345678', 'otro@ejemplo.cl', null, null, null, null);
  insert into r120 values ('C1b un id ajeno y uno inventado dan el MISMO motivo',
    v_res ->> 'reason' = 'No encontramos esa solicitud.', v_res ->> 'reason');

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);

  -- ── C3: chocar con otra pendiente propia ─────────────────────
  v_res := public.crear_solicitud_recinto('Cancha del Sur', 'Calle 9', 'Maipú', 'Juan Pérez',
    '912345678', 'juan@ejemplo.cl', null, 2, null, null);
  v_id2 := (v_res ->> 'id')::uuid;
  insert into r120 values ('C3a preparación: la segunda solicitud existe',
    (v_res ->> 'ok') = 'true' and (v_res ->> 'reusada') = 'false' and v_id2 <> v_id,
    coalesce(v_res ->> 'reason', 'creada'));

  v_res := public.actualizar_solicitud_recinto(v_id2, 'Cancha Los Álamos', 'Calle 9', 'Maipú',
    'Juan Pérez', '912345678', 'juan@ejemplo.cl', null, 2, null, null);
  insert into r120 values ('C3b renombrar encima de otra pendiente se rechaza',
    (v_res ->> 'ok') = 'false' and v_res ->> 'reason' like 'Ya tienes otra solicitud%',
    v_res ->> 'reason');

  -- ── N4: renombrar libera el nombre viejo ─────────────────────
  v_res := public.actualizar_solicitud_recinto(v_id, 'Cancha Los Aromos', 'Av. Siempre Viva 742',
    'Maipú', 'Juan Pérez', '987654321', 'juan.perez@ejemplo.cl', null, 5, null, null);
  insert into r120 values ('N4a renombrar funciona', (v_res ->> 'ok') = 'true', coalesce(v_res ->> 'reason','ok'));

  v_res := public.crear_solicitud_recinto('Cancha Los Álamos', 'Otra 1', 'Maipú', 'Juan Pérez',
    '912345678', 'juan@ejemplo.cl', null, 1, null, null);
  insert into r120 values ('N4b el nombre viejo vuelve a estar libre',
    (v_res ->> 'ok') = 'true' and (v_res ->> 'reusada') = 'false',
    'reusada=' || coalesce(v_res ->> 'reusada','-'));

  -- ── C2: una que el equipo ya tomó ────────────────────────────
  set local role postgres;
  update public.solicitudes_recinto set estado = 'contactada' where id = v_id;
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);

  v_res := public.actualizar_solicitud_recinto(v_id, 'Cambio tardío', 'Calle 3', 'Maipú',
    'Juan Pérez', '912345678', 'juan@ejemplo.cl', null, 1, null, null);
  select * into v_fila from public.solicitudes_recinto where id = v_id;
  insert into r120 values ('C2 una solicitud ya tomada no se corrige por acá',
    (v_res ->> 'ok') = 'false' and v_fila.nombre_recinto = 'Cancha Los Aromos',
    v_res ->> 'reason');

  set local role postgres;
end $$;

reset role;
select caso, case when ok then 'OK' else 'FALLA' end as res, detalle from r120 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r120;

rollback;
