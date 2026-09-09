-- =============================================================
-- FutFinder — prueba de CONTRATO de las RPC del recinto.
--
-- Distinta a los otros arneses: estos no prueban comportamiento, prueban
-- que estén TODAS LAS CLAVES que el cliente consume. Existe porque la
-- migración 63 nació de un campo faltante (`fecha` en cada reserva de la
-- agenda) que no producía ningún error: la función del cliente recibía
-- `undefined`, devolvía `false`, y una reserva ya jugada simplemente no
-- se marcaba como jugada. Sin excepción y sin síntoma.
--
-- SI AGREGAS UN CAMPO AL CLIENTE, agrégalo también a la lista de acá. Y
-- si alguna vez se quita uno de estos campos de una RPC, este arnés se
-- cae en vez de dejar la pantalla mostrando datos mudos.
--
-- Las listas salen de `src/utils/recintoAgenda.js` y
-- `src/services/recinto.js`.
--
-- QUÉ SE PRUEBA:
--   1. La respuesta de `admin_agenda_complejo` trae ok, fecha, resumen,
--      reservas y bloqueos.
--   2. El `resumen` trae los nueve contadores que lee `resumenDelPanel`.
--   3. Cada reserva de la agenda trae los campos que leen
--      `estadoOperativo`, `avancePago` y `desgloseComision` — incluida
--      `fecha`, que es la que faltaba.
--   4. Cada bloqueo trae lo que la agenda necesita para pintarlo.
--   5. Cada slot del calendario trae lo que lee `estadoDeBloque`.
--   6. `admin_reserva_detalle` trae el desglose completo.
--   7. `comision_params` trae los cuatro parámetros.
--
-- Requiere las migraciones 54 a 63 aplicadas.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- Run. Todo corre en una transacción que termina en ROLLBACK.
-- =============================================================

begin;

do $$
declare
  v_dueno    uuid := gen_random_uuid();
  v_complejo uuid := gen_random_uuid();
  v_cancha   uuid := gen_random_uuid();
  v_res      uuid := gen_random_uuid();
  v_fecha    date := date '2027-03-01';
  v_j        json;
  v_faltan   text;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_dueno, 'authenticated', 'authenticated',
    'r63-' || v_dueno || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
  );

  insert into public.complejos (id, nombre, comuna, latitud, longitud)
  values (v_complejo, 'Contrato 63', 'Ñuñoa', -33.45, -70.60);
  insert into public.canchas_reservables (id, complejo_id, nombre, tipo, precio_hora, duracion_slot_min, activa)
  values (v_cancha, v_complejo, 'Cancha 1', 'futbol_7', 28000, 60, true);
  insert into public.cancha_horario_reglas (cancha_id, dia_semana, hora_apertura, hora_cierre)
  select v_cancha, d, time '09:00', time '23:00' from generate_series(0, 6) as d;
  insert into public.complejo_admins (complejo_id, user_id, rol)
  values (v_complejo, v_dueno, 'dueño');

  insert into public.reservas (id, cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
                               precio_total, modalidad, medio_pago, estado)
  values (v_res, v_cancha, v_dueno, v_fecha, time '10:00', time '11:00',
          28000, 'completa', 'tarjeta', 'confirmada');
  insert into public.reserva_comisiones (reserva_id, base, tasa, piso, techo, iva_tasa, monto)
  values (v_res, 28000, 0.05, 1000, 2500, 0.19, 1400);
  insert into public.cancha_bloqueos (cancha_id, fecha, hora_inicio, hora_fin, motivo, creado_por)
  values (v_cancha, v_fecha, time '20:00', time '21:00', 'Mantención', v_dueno);

  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_dueno, 'role', 'authenticated')::text);

  -- ── Caso 1: la raíz de la respuesta ────────────────────────────
  v_j := public.admin_agenda_complejo(v_complejo, v_fecha);
  select string_agg(c, ', ') into v_faltan
    from unnest(array['ok', 'fecha', 'resumen', 'reservas', 'bloqueos']) as c
   where not exists (select 1 from json_object_keys(v_j) k where k = c);
  if v_faltan is not null then
    raise exception 'FALLÓ (caso 1): a la respuesta de la agenda le faltan: %', v_faltan;
  end if;
  raise notice 'OK (caso 1)';

  -- ── Caso 2: los contadores del resumen ─────────────────────────
  select string_agg(c, ', ') into v_faltan
    from unnest(array['reservas_confirmadas', 'reservas_en_curso', 'reservas_canceladas',
                      'bloqueos', 'canchas_activas', 'canchas_total',
                      'monto_confirmado', 'comision_confirmada', 'neto_confirmado']) as c
   where not exists (select 1 from json_object_keys(v_j->'resumen') k where k = c);
  if v_faltan is not null then
    raise exception 'FALLÓ (caso 2): al resumen le faltan: % — los lee resumenDelPanel()', v_faltan;
  end if;
  raise notice 'OK (caso 2): los nueve contadores';

  -- ── Caso 3: cada reserva de la agenda ──────────────────────────
  -- `fecha` es la que faltaba y la que motivó la migración 63: sin ella
  -- yaSeJugo() no puede comparar nada.
  select string_agg(c, ', ') into v_faltan
    from unnest(array['id', 'fecha', 'hora_inicio', 'hora_fin', 'estado',
                      'cancha_id', 'cancha_nombre', 'cancha_tipo',
                      'modalidad', 'medio_pago', 'precio_total',
                      'comision_base', 'comision', 'neto',
                      'participantes_total', 'participantes_aceptados',
                      'organizador_username', 'organizador_foto_url',
                      'es_desafio_club', 'n_jugadores', 'cancelada_at']) as c
   where not exists (select 1 from json_object_keys(v_j->'reservas'->0) k where k = c);
  if v_faltan is not null then
    raise exception 'FALLÓ (caso 3): a las reservas de la agenda les faltan: %', v_faltan;
  end if;
  raise notice 'OK (caso 3): incluida `fecha`';

  -- ── Caso 4: cada bloqueo ───────────────────────────────────────
  select string_agg(c, ', ') into v_faltan
    from unnest(array['id', 'cancha_id', 'cancha_nombre', 'hora_inicio', 'hora_fin', 'motivo']) as c
   where not exists (select 1 from json_object_keys(v_j->'bloqueos'->0) k where k = c);
  if v_faltan is not null then
    raise exception 'FALLÓ (caso 4): a los bloqueos les faltan: %', v_faltan;
  end if;
  raise notice 'OK (caso 4)';

  -- ── Caso 5: cada slot del calendario ───────────────────────────
  v_j := public.admin_calendario_cancha(v_cancha, v_fecha);
  select string_agg(c, ', ') into v_faltan
    from unnest(array['hora_inicio', 'hora_fin', 'estado', 'bloqueo', 'reserva', 'grupos_en_curso']) as c
   where not exists (select 1 from json_object_keys(v_j->'slots'->0) k where k = c);
  if v_faltan is not null then
    raise exception 'FALLÓ (caso 5): a los slots les faltan: % — los lee estadoDeBloque()', v_faltan;
  end if;
  raise notice 'OK (caso 5)';

  -- ── Caso 6: el detalle de una reserva ──────────────────────────
  v_j := public.admin_reserva_detalle(v_res);
  select string_agg(c, ', ') into v_faltan
    from unnest(array['ok', 'id', 'fecha', 'hora_inicio', 'hora_fin', 'estado',
                      'cancha_nombre', 'cancha_tipo', 'complejo_id',
                      'precio_total', 'comision_base', 'comision', 'comision_tasa',
                      'comision_iva_tasa', 'neto', 'cuota', 'n_jugadores',
                      'organizador_username', 'organizador_foto_url',
                      'participantes_total', 'participantes_aceptados',
                      'participantes_pendientes', 'cancelacion_estado']) as c
   where not exists (select 1 from json_object_keys(v_j) k where k = c);
  if v_faltan is not null then
    raise exception 'FALLÓ (caso 6): al detalle le faltan: %', v_faltan;
  end if;
  raise notice 'OK (caso 6)';

  -- ── Caso 7: los parámetros de la comisión ──────────────────────
  select string_agg(c, ', ') into v_faltan
    from unnest(array['tasa', 'piso', 'techo', 'iva_tasa']) as c
   where not exists (select 1 from json_object_keys(public.comision_params()) k where k = c);
  if v_faltan is not null then
    raise exception 'FALLÓ (caso 7): a comision_params le faltan: %', v_faltan;
  end if;
  raise notice 'OK (caso 7)';

  raise notice '=== EL CONTRATO DE LAS RPC DEL RECINTO ESTÁ COMPLETO ===';
end $$;

rollback;
