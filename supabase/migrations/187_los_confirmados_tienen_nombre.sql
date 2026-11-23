-- 187. Al publicar, cada confirmado dice quién es.
--
-- Pedido de Vicente (2026-11-18): «no quiero que se publiquen partidos solo
-- con jugador reservado, jugador reservado, jugador reservado». Desde la 182,
-- `publicar_partido_con_asientos` aceptaba asientos `reservado` (sin cuenta
-- y sin nombre), y un nombre podía ser cualquier texto de 1 a 40 letras,
-- incluido «Jugador reservado».
--
-- Esta migración:
--   1. `publicar_partido_con_asientos` rechaza todo asiento que no sea un
--      amigo o un nombre: ASIENTO_SIN_IDENTIFICAR, antes de crear nada.
--   2. `_asiento_nombre_limpio` rechaza los nombres que no identifican a
--      nadie —el texto de la propia app, «Jugador 3», «X»—: ASIENTO_NOMBRE_GENERICO.
--      Vale en las tres puertas que escriben nombres (publicar, agregar y
--      cambiar), no sólo al publicar.
--
-- Lo que NO cambia, a propósito: en «Gestionar partido», ya publicado, el
-- organizador puede seguir reservando asientos para el link de invitación
-- (`asiento_agregar`, `asiento_cambiar` a reservado, `asientos_armar`). Lo
-- pedido es sobre publicar; quitar las reservas del todo apaga el link y es
-- otra decisión.
--
-- La lista de nombres genéricos es la misma que `NOMBRES_GENERICOS` en
-- `src/utils/asientos.js`; una prueba de Node compara las dos.
--
-- Idempotente: sólo `create or replace` y permisos.

-- ── 1. Qué es un nombre genérico ─────────────────────────────────
-- Se compara sin tildes, sin mayúsculas, sin números ni signos: «Jugador-3»
-- y «JUGADOR reservado» caen igual que «jugador» y «jugador reservado».
create or replace function public._asiento_nombre_generico(p_nombre text)
returns boolean
language sql
immutable
set search_path = public
as $$
  with c as (
    select btrim(regexp_replace(regexp_replace(lower(translate(coalesce(p_nombre, ''),
             'ÁÉÍÓÚÜÑÀÈÌÒÙÂÊÎÔÛáéíóúüñàèìòùâêîôû',
             'AEIOUUNAEIOUAEIOUaeiouunaeiouaeiou')), '[^a-z ]', ' ', 'g'), '\s+', ' ', 'g')) as clave
  )
  select char_length(replace(clave, ' ', '')) < 2
      or clave = any (array[
           'amiga', 'amigo', 'asiento', 'asiento reservado', 'confirmada', 'confirmado',
           'cupo', 'cupo libre', 'invitada', 'invitado', 'jugador', 'jugador confirmado',
           'jugador reservado', 'jugadora', 'jugadora confirmada', 'jugadora reservada',
           'libre', 'na', 'nn', 'nombre', 'pendiente', 'por definir', 'reservada',
           'reservado', 'sin nombre'])
    from c;
$$;

revoke all on function public._asiento_nombre_generico(text) from public, anon, authenticated;

-- ── 2. El nombre limpio, ahora sin genéricos ─────────────────────
create or replace function public._asiento_nombre_limpio(p_nombre text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v text := btrim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g'));
begin
  if not public.flag_activo('asientos_por_nombre') then raise exception 'ASIENTO_NOMBRES_APAGADO'; end if;
  if char_length(v) < 1 or char_length(v) > 40 then raise exception 'ASIENTO_NOMBRE_INVALIDO'; end if;
  if public._asiento_nombre_generico(v) then raise exception 'ASIENTO_NOMBRE_GENERICO'; end if;
  return v;
end $$;

revoke all on function public._asiento_nombre_limpio(text) from public, anon, authenticated;

-- ── 3. Publicar sólo con confirmados identificados ───────────────
-- Igual que en la 182 salvo el chequeo del principio. Sigue `security
-- invoker`: el INSERT corre con el GRANT por columnas, la RLS y los
-- disparadores del alta directa.
create or replace function public.publicar_partido_con_asientos(p_partido jsonb, p_asientos jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_total integer := (p_partido->>'jugadores_total')::integer;
  v_token uuid := nullif(p_partido->>'client_token', '')::uuid;
  v_id uuid;
  v_libres integer;
  r public.matches;
begin
  if v_uid is null then raise exception 'ASIENTO_NO_AUTENTICADO'; end if;
  if v_total is null or v_total < 2 or v_total > 31 then raise exception 'ASIENTO_TOTAL_INVALIDO'; end if;

  if v_token is not null then
    select id into v_id from public.matches where client_token = v_token and id_organizador = v_uid;
    if found then
      return jsonb_build_object('match', (select to_jsonb(x) from public.matches x where x.id = v_id), 'duplicate', true);
    end if;
  end if;

  -- Cada confirmado es un amigo o un nombre. Un nombre vacío o genérico lo
  -- rechaza `_asiento_nombre_limpio` más abajo, y un amigo sin cuenta,
  -- `_asiento_sentar_amigo`.
  if jsonb_typeof(coalesce(p_asientos, '[]'::jsonb)) <> 'array' then raise exception 'ASIENTO_TIPO_INVALIDO'; end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_asientos, '[]'::jsonb)) a
     where coalesce(a->>'tipo', '') not in ('amigo', 'nombre')
  ) then
    raise exception 'ASIENTO_SIN_IDENTIFICAR';
  end if;

  r := jsonb_populate_record(null::public.matches, p_partido);

  insert into public.matches (
    id_organizador, titulo, region, comuna, cancha_nombre, direccion, latitud, longitud, hora,
    cupos_totales, cupos_disponibles, precio_cuota, nivel, descripcion, duracion_min, aprobacion,
    min_trust_score, modalidad, edad_min, edad_max, recordatorio_1h, pedir_asistencia, client_token
  ) values (
    v_uid, r.titulo, r.region, r.comuna, r.cancha_nombre, r.direccion, r.latitud, r.longitud, r.hora,
    v_total - 1, v_total - 1, coalesce(r.precio_cuota, 0), coalesce(r.nivel, 'recreativo'), r.descripcion,
    coalesce(r.duracion_min, 90), coalesce(r.aprobacion, 'inmediata'), coalesce(r.min_trust_score, 0),
    r.modalidad, r.edad_min, r.edad_max, coalesce(r.recordatorio_1h, true), coalesce(r.pedir_asistencia, true),
    v_token
  ) returning id into v_id;

  perform public.asientos_armar(v_id, coalesce(p_asientos, '[]'::jsonb));

  -- Un partido se publica para buscar gente: tiene que quedar al menos un
  -- asiento libre.
  select cupos_disponibles into v_libres from public.matches where id = v_id;
  if coalesce(v_libres, 0) < 1 then raise exception 'ASIENTO_SIN_LIBRES'; end if;

  return jsonb_build_object('match', (select to_jsonb(x) from public.matches x where x.id = v_id), 'duplicate', false);
end $$;

revoke all on function public.publicar_partido_con_asientos(jsonb, jsonb) from public, anon;
grant execute on function public.publicar_partido_con_asientos(jsonb, jsonb) to authenticated;
