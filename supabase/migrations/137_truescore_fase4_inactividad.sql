-- =============================================================
-- 137. TRUESCORE — FASE 4: INACTIVIDAD
--
-- `docs/truescore-spec.md` §1.5: job mensual; si el jugador lleva 6 meses
-- sin partidos, su TrueScore se acerca a 65 en 2 puntos por mes (sube o
-- baja), sin pasarse de 65. Detrás de `truescore_fase4`, apagado.
--
--   · «Partido» = un evento que cuenta para los últimos 10: asistencia,
--     tardanza, plantón o salida. Quien nunca jugó cuenta desde su evento
--     de inicio de TrueScore.
--   · El evento `inactividad` es del registro de TrueScore: se calcula
--     desde el puntaje (se acerca a 65 como máximo 2), no toca la racha ni
--     cuenta en la ventana de reincidencia.
--   · Idempotente por mes: la clave lleva el mes de Chile, así que correr
--     el job dos veces en el mismo mes no mueve dos veces.
--
-- Se activa con `select public.truescore_activar_fase4();`.
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

insert into public.truescore_config (clave, valor, descripcion) values
  ('inactividad_meses', '6', 'Meses sin partidos desde los que el TrueScore se acerca al objetivo.'),
  ('inactividad_objetivo', '65', 'Puntaje al que se acerca un jugador inactivo.'),
  ('inactividad_paso', '2', 'Puntos por mes que se acerca, sin pasarse del objetivo.')
on conflict (clave) do nothing;

alter table public.truescore_eventos drop constraint if exists truescore_eventos_tipo_check;
alter table public.truescore_eventos add constraint truescore_eventos_tipo_check check (tipo in (
  'inicio', 'asistio', 'tarde', 'planton', 'salida', 'neutro',
  'cancelacion_organizador', 'sin_confirmar_organizador',
  'reversion', 'reclamo_organizador', 'bono_organizador', 'inactividad'));

-- Cuerpo de la 135 más el tipo `inactividad`.
create or replace function public.truescore_calcular(
  p_tipo text, p_puntaje integer, p_racha integer, p_horas numeric default null,
  p_tardes integer default 0, p_plantones integer default 0, p_fase2 boolean default false)
returns table (nominal integer, puntaje integer, racha integer)
language plpgsql stable security definer set search_path = public as $$
declare
  v_nom int := 0;
  v_racha int := coalesce(p_racha, 0);
  v_tabla jsonb;
  v_obj int;
begin
  if p_tipo = 'inicio' then
    return query select (public.truescore_cfg('puntaje_inicial'))::int, (public.truescore_cfg('puntaje_inicial'))::int, 0;
    return;
  elsif p_tipo = 'asistio' then
    v_tabla := public.truescore_cfg('racha_puntos');
    v_nom := (v_tabla->>(least(v_racha + 1, jsonb_array_length(v_tabla)) - 1))::int;
    v_racha := v_racha + 1;
  elsif p_tipo = 'tarde' then
    if p_fase2 and coalesce(p_tardes, 0) >= (public.truescore_cfg('tarde_reincidencia_umbral'))::int then
      v_nom := -(public.truescore_cfg('tarde_reincidente_puntos'))::int;
    else
      v_nom := -(public.truescore_cfg('tarde_puntos'))::int;
    end if;
    v_racha := 0;
  elsif p_tipo = 'planton' then
    if p_fase2 then
      v_nom := -round((public.truescore_cfg('planton_puntos'))::numeric
                 * (1 + (public.truescore_cfg('planton_factor_reincidencia'))::numeric * coalesce(p_plantones, 0)))::int;
    else
      v_nom := -(public.truescore_cfg('planton_puntos'))::int;
    end if;
    v_racha := 0;
  elsif p_tipo = 'salida' then
    v_nom := -public.truescore_penalizacion_salida(p_horas);
    if p_horas < (public.truescore_cfg('salida_horas_mantiene_racha'))::numeric then v_racha := 0; end if;
  elsif p_tipo = 'neutro' then
    v_nom := 0;
  elsif p_tipo = 'cancelacion_organizador' then
    v_nom := -public.truescore_penalizacion_cancelacion(p_horas);
  elsif p_tipo = 'sin_confirmar_organizador' then
    v_nom := -(public.truescore_cfg('sin_confirmar_puntos'))::int;
  elsif p_tipo = 'reclamo_organizador' then
    v_nom := -(public.truescore_cfg('reclamo_organizador_puntos'))::int;
  elsif p_tipo = 'bono_organizador' then
    if p_horas < (public.truescore_cfg('bono_rapido_horas'))::numeric then
      v_nom := (public.truescore_cfg('bono_rapido_puntos'))::int;
    else
      v_nom := (public.truescore_cfg('bono_confirmacion_puntos'))::int;
    end if;
  elsif p_tipo = 'inactividad' then
    -- Se acerca al objetivo como mucho un paso, sin pasarse.
    v_obj := (public.truescore_cfg('inactividad_objetivo'))::int;
    v_nom := sign(v_obj - p_puntaje)::int
             * least(abs(v_obj - p_puntaje), (public.truescore_cfg('inactividad_paso'))::int);
  else
    raise exception 'TRUESCORE_TIPO_DESCONOCIDO:%', p_tipo;
  end if;
  return query select v_nom,
    least((public.truescore_cfg('puntaje_maximo'))::int, greatest((public.truescore_cfg('puntaje_minimo'))::int, p_puntaje + v_nom)),
    v_racha;
end $$;

-- La última vez que jugó: su último evento que cuenta, o el inicio de
-- TrueScore si nunca jugó.
create or replace function public.truescore_ultima_actividad(p_user uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select max(e.created_at) from public.truescore_eventos e
      where e.user_id = p_user and e.tipo in ('asistio', 'tarde', 'planton', 'salida')),
    (select min(e.created_at) from public.truescore_eventos e
      where e.user_id = p_user and e.tipo = 'inicio'));
$$;
revoke all on function public.truescore_ultima_actividad(uuid) from public, anon, authenticated;

create or replace function public.truescore_inactividad() returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record; v_n int := 0; v_res jsonb;
  v_meses int := (public.truescore_cfg('inactividad_meses'))::int;
  v_obj int := (public.truescore_cfg('inactividad_objetivo'))::int;
  v_mes text := to_char(now() at time zone 'America/Santiago', 'YYYY-MM');
begin
  if not (public.flag_activo('truescore_fase1') and public.flag_activo('truescore_fase4')) then return 0; end if;
  for r in
    select p.id from public.profiles p
     where p.trust_score <> v_obj
       and public.truescore_ultima_actividad(p.id) <= now() - make_interval(months => v_meses)
     order by p.id
  loop
    v_res := public.truescore_registrar(r.id, null, 'inactividad', 'inactividad:' || r.id || ':' || v_mes,
      format('Llevas %s meses sin partidos: tu TrueScore se acerca a %s', v_meses, v_obj));
    if not coalesce((v_res->>'duplicado')::boolean, true) then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.truescore_inactividad() from public, anon, authenticated;

-- El día 1 de cada mes a las 09:00 UTC (madrugada en Chile).
do $$ begin perform cron.unschedule('futfinder-truescore-inactividad'); exception when others then null; end $$;
select cron.schedule('futfinder-truescore-inactividad', '0 9 1 * *', 'select public.truescore_inactividad()');

create or replace function public.truescore_activar_fase4() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.flag_activo('truescore_fase1') then
    return jsonb_build_object('ok', false, 'reason', 'Primero hay que activar la fase 1');
  end if;
  update public.feature_flags set activo = true, activado_at = coalesce(activado_at, now()) where nombre = 'truescore_fase4';
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.truescore_activar_fase4() from public, anon, authenticated;
