-- =============================================================
-- 135. TRUESCORE — FASE 2
--
-- `docs/truescore-spec.md` §5 y las decisiones de su sección 8. Todo detrás
-- de `truescore_fase2`, que nace apagado; con él apagado nada cambia.
--
--   1. Reincidencia: tardanza −15 con 2 o más en la ventana; plantón
--      −35 × (1 + 0,5 × plantones en la ventana). La ventana son los últimos
--      10 eventos que cuentan (asistencias, tardanzas, plantones, salidas) y
--      que ocurrieron con la fase 2 activa: al activarla se parte de cero.
--   2. Reclamos: 48 h desde la marca para reclamar y para que 2 compañeros
--      que asistieron lo confirmen. Aceptado, se agrega un evento de
--      reversión —el original no se toca—, se rehacen puntaje, racha y
--      reincidencia desde ese punto y el organizador pierde 20.
--   3. Prioridad en la lista de espera para el nivel «Muy confiable».
--   4. Bono al organizador por confirmar la asistencia: +5 antes de 12 h
--      desde el fin, +2 entre 12 y 24 h. Sólo si alguien asistió.
--
-- EL HISTORIAL EFECTIVO. Un evento revertido cuenta como el tipo que le dio
-- su reversión (`detalle.tipo_nuevo`), en SU posición. `truescore_repasar`
-- recorre así el registro y es la única definición del estado; la
-- escritura en vivo (`truescore_registrar`) usa el caché y la misma ventana
-- (`truescore_ventana`), y el arnés exige que las dos coincidan.
--
-- Se activa con `select public.truescore_activar_fase2();`.
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

insert into public.truescore_config (clave, valor, descripcion) values
  ('ventana_reincidencia_eventos', '10', 'Eventos anteriores que mira la reincidencia (sin neutros).'),
  ('tarde_reincidencia_umbral', '2', 'Tardanzas previas en la ventana desde las que la tardanza sube de pena.'),
  ('tarde_reincidente_puntos', '15', 'Penalización por llegar tarde con reincidencia.'),
  ('planton_factor_reincidencia', '0.5', 'Plantón: 35 × (1 + factor × plantones previos en la ventana).'),
  ('reclamo_plazo_horas', '48', 'Horas desde la marca para reclamar y para que confirmen los compañeros.'),
  ('reclamo_confirmaciones', '2', 'Compañeros que asistieron y deben confirmar el reclamo.'),
  ('reclamo_organizador_puntos', '20', 'Penalización al organizador cuando un reclamo prueba que marcó mal.'),
  ('bono_rapido_horas', '12', 'Confirmar la asistencia antes de estas horas desde el fin da el bono mayor.'),
  ('bono_rapido_puntos', '5', 'Bono por confirmar la asistencia antes de 12 h.'),
  ('bono_confirmacion_puntos', '2', 'Bono por confirmar la asistencia entre 12 y 24 h.'),
  ('prioridad_espera_nivel', '"muy_confiable"', 'Nivel con prioridad en las listas de espera.')
on conflict (clave) do nothing;

-- ── El registro gana reversiones y los eventos nuevos del organizador ──

alter table public.truescore_eventos
  add column if not exists revierte_evento_id bigint references public.truescore_eventos(id);

create unique index if not exists truescore_eventos_una_reversion
  on public.truescore_eventos (revierte_evento_id) where revierte_evento_id is not null;

alter table public.truescore_eventos drop constraint if exists truescore_eventos_tipo_check;
alter table public.truescore_eventos add constraint truescore_eventos_tipo_check check (tipo in (
  'inicio', 'asistio', 'tarde', 'planton', 'salida', 'neutro',
  'cancelacion_organizador', 'sin_confirmar_organizador',
  'reversion', 'reclamo_organizador', 'bono_organizador'));

-- ── Cálculo con reincidencia ──
-- La firma cambia: se borra la de cuatro argumentos para que no quede una
-- sobrecarga que haga ambigua la llamada.
drop function if exists public.truescore_calcular(text, integer, integer, numeric);

create or replace function public.truescore_calcular(
  p_tipo text, p_puntaje integer, p_racha integer, p_horas numeric default null,
  p_tardes integer default 0, p_plantones integer default 0, p_fase2 boolean default false)
returns table (nominal integer, puntaje integer, racha integer)
language plpgsql stable security definer set search_path = public as $$
declare
  v_nom int := 0;
  v_racha int := coalesce(p_racha, 0);
  v_tabla jsonb;
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
      -- Se redondea el valor absoluto, 0,5 hacia arriba: 52,5 → 53.
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
    -- `p_horas` son aquí las horas desde el fin del partido.
    if p_horas < (public.truescore_cfg('bono_rapido_horas'))::numeric then
      v_nom := (public.truescore_cfg('bono_rapido_puntos'))::int;
    else
      v_nom := (public.truescore_cfg('bono_confirmacion_puntos'))::int;
    end if;
  else
    raise exception 'TRUESCORE_TIPO_DESCONOCIDO:%', p_tipo;
  end if;
  return query select v_nom,
    least((public.truescore_cfg('puntaje_maximo'))::int, greatest((public.truescore_cfg('puntaje_minimo'))::int, p_puntaje + v_nom)),
    v_racha;
end $$;
revoke all on function public.truescore_calcular(text, integer, integer, numeric, integer, integer, boolean) from public, anon, authenticated;

-- Tardanzas y plantones en la ventana actual del jugador, sobre el
-- historial efectivo. Sólo cuentan eventos ocurridos con la fase 2 activa.
create or replace function public.truescore_ventana(p_user uuid)
returns table (tardes integer, plantones integer)
language sql stable security definer set search_path = public as $$
  select (count(*) filter (where w.tipo_ef = 'tarde'))::int,
         (count(*) filter (where w.tipo_ef = 'planton'))::int
    from (select coalesce(r.detalle->>'tipo_nuevo', ev.tipo) as tipo_ef
            from public.truescore_eventos ev
            left join public.truescore_eventos r on r.revierte_evento_id = ev.id
           where ev.user_id = p_user
             and ev.tipo in ('asistio', 'tarde', 'planton', 'salida')
             and coalesce((ev.detalle->>'fase2')::boolean, false)
           order by ev.id desc
           limit (public.truescore_cfg('ventana_reincidencia_eventos'))::int) w;
$$;
revoke all on function public.truescore_ventana(uuid) from public, anon, authenticated;

-- El estado de un jugador rehecho desde cero, con el historial efectivo.
-- `p_revertir`/`p_tipo_nuevo` simulan una reversión todavía no escrita: así
-- el evento de reversión nace con su puntaje final, sin editarlo después.
create or replace function public.truescore_repasar(p_user uuid, p_revertir bigint default null, p_tipo_nuevo text default null)
returns table (eventos integer, puntaje integer, racha integer)
language plpgsql stable security definer set search_path = public as $$
declare
  e record; c record;
  v_puntaje int; v_racha int := 0; v_n int := 0;
  v_ventana text[] := '{}';
  v_tam int := (public.truescore_cfg('ventana_reincidencia_eventos'))::int;
  v_tardes int; v_plantones int; v_f2 boolean;
begin
  for e in
    select ev.id, ev.horas_aviso, ev.detalle,
           case when ev.id = p_revertir then p_tipo_nuevo
                else coalesce(r.detalle->>'tipo_nuevo', ev.tipo) end as tipo_ef
      from public.truescore_eventos ev
      left join public.truescore_eventos r on r.revierte_evento_id = ev.id
     where ev.user_id = p_user and ev.tipo <> 'reversion'
     order by ev.id
  loop
    v_f2 := coalesce((e.detalle->>'fase2')::boolean, false);
    select count(*) filter (where x = 'tarde'), count(*) filter (where x = 'planton')
      into v_tardes, v_plantones
      from unnest(v_ventana[greatest(1, cardinality(v_ventana) - v_tam + 1):]) as x;
    select * into c from public.truescore_calcular(e.tipo_ef, coalesce(v_puntaje, 0), v_racha,
                                                   e.horas_aviso, v_tardes, v_plantones, v_f2);
    v_puntaje := c.puntaje;
    v_racha := c.racha;
    v_n := v_n + 1;
    if v_f2 and e.tipo_ef in ('asistio', 'tarde', 'planton', 'salida') then
      v_ventana := v_ventana || e.tipo_ef;
    end if;
  end loop;
  return query select v_n, v_puntaje, v_racha;
end $$;
revoke all on function public.truescore_repasar(uuid, bigint, text) from public, anon, authenticated;

create or replace function public.truescore_recalcular(p_user uuid, p_escribir boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v record; v_cache int; v_cache_racha int;
begin
  select * into v from public.truescore_repasar(p_user);
  select trust_score, truescore_racha into v_cache, v_cache_racha from public.profiles where id = p_user;
  if p_escribir and v.eventos > 0 then
    update public.profiles set trust_score = v.puntaje, truescore_racha = v.racha where id = p_user;
  end if;
  return jsonb_build_object('eventos', v.eventos, 'puntaje', v.puntaje, 'racha', v.racha,
    'cache_puntaje', v_cache, 'cache_racha', v_cache_racha,
    'coincide', v.eventos = 0 or (v.puntaje = v_cache and v.racha = v_cache_racha));
end $$;

create or replace function public.truescore_registrar(p_user uuid, p_match uuid, p_tipo text, p_clave text, p_motivo text, p_horas numeric default null, p_detalle jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_antes int; v_racha int; c record; v_id bigint; v_f2 boolean; v_tardes int; v_plantones int;
begin
  if not public.flag_activo('truescore_fase1') then
    return jsonb_build_object('ok', false, 'reason', 'TrueScore inactivo');
  end if;
  perform public.truescore_iniciar(p_user);
  select trust_score, truescore_racha into v_antes, v_racha from public.profiles where id = p_user for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'El perfil no existe'); end if;
  if exists (select 1 from public.truescore_eventos where clave = p_clave) then
    return jsonb_build_object('ok', true, 'duplicado', true, 'puntos', 0, 'nominal', 0, 'puntaje', v_antes, 'racha', v_racha);
  end if;
  v_f2 := public.flag_activo('truescore_fase2');
  select w.tardes, w.plantones into v_tardes, v_plantones from public.truescore_ventana(p_user) w;
  select * into c from public.truescore_calcular(p_tipo, v_antes, v_racha, p_horas, v_tardes, v_plantones, v_f2);
  insert into public.truescore_eventos (user_id, match_id, tipo, puntos_nominales, puntos_aplicados, puntaje_antes, puntaje_despues, racha_antes, racha_despues, horas_aviso, motivo, detalle, clave)
  values (p_user, p_match, p_tipo, c.nominal, c.puntaje - v_antes, v_antes, c.puntaje, v_racha, c.racha, p_horas, p_motivo,
          coalesce(p_detalle, '{}'::jsonb) || jsonb_build_object('fase2', v_f2), p_clave)
  on conflict (clave) do nothing
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('ok', true, 'duplicado', true, 'puntos', 0, 'nominal', 0, 'puntaje', v_antes, 'racha', v_racha);
  end if;
  update public.profiles set trust_score = c.puntaje, truescore_racha = c.racha where id = p_user;
  return jsonb_build_object('ok', true, 'duplicado', false, 'nominal', c.nominal, 'puntos', c.puntaje - v_antes, 'puntaje', c.puntaje, 'racha', c.racha);
end $$;

create or replace function public.truescore_activar_fase2() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.flag_activo('truescore_fase1') then
    return jsonb_build_object('ok', false, 'reason', 'Primero hay que activar la fase 1');
  end if;
  update public.feature_flags set activo = true, activado_at = coalesce(activado_at, now()) where nombre = 'truescore_fase2';
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.truescore_activar_fase2() from public, anon, authenticated;

-- ── Bono al organizador al confirmar la asistencia ──
-- Cuerpo de la 134 más el bono al final.
create or replace function public.truescore_guardar_asistencia(p_match_id uuid, p_marks jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_match record; v_fin timestamptz; r record; v_mark text;
  v_faltan int := 0; v_asis int := 0; v_tarde int := 0; v_no int := 0; v_bono jsonb;
  v_plazo int := (public.truescore_cfg('confirmacion_plazo_horas'))::int;
begin
  select * into v_match from public.matches where id = p_match_id;
  if v_match.asistencia_confirmada_at is not null then
    return jsonb_build_object('ok', true, 'already', true, 'reason', 'Ya confirmaste la asistencia de este partido');
  end if;
  if v_match.asistencia_vencida_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'Se venció el plazo para confirmar: el partido quedó neutro');
  end if;
  v_fin := v_match.hora + make_interval(mins => coalesce(v_match.duracion_min, 90));
  if now() < v_fin then return jsonb_build_object('ok', false, 'reason', 'El partido todavía no ha terminado'); end if;
  if now() > v_fin + make_interval(hours => v_plazo) then
    return jsonb_build_object('ok', false, 'reason', format('El plazo para confirmar la asistencia era de %s h después del partido', v_plazo));
  end if;
  for r in select a.id_jugador from public.attendees a
     where a.id_partido = p_match_id and a.estado in ('inscrito', 'confirmado_gps') and a.id_jugador <> v_match.id_organizador
  loop
    if public.truescore_normalizar_marca(p_marks->>(r.id_jugador::text)) is null then v_faltan := v_faltan + 1; end if;
  end loop;
  if v_faltan > 0 then
    return jsonb_build_object('ok', false, 'faltan', v_faltan, 'reason', format('Marca a todos los jugadores antes de confirmar (faltan %s)', v_faltan));
  end if;
  for r in select a.id, a.id_jugador, a.estado from public.attendees a
     where a.id_partido = p_match_id and a.estado in ('inscrito', 'confirmado_gps') and a.id_jugador <> v_match.id_organizador
     order by a.id_jugador for update
  loop
    v_mark := public.truescore_normalizar_marca(p_marks->>(r.id_jugador::text));
    if v_mark in ('asistio', 'tarde') then
      update public.attendees set estado = 'confirmado_gps', asistencia = v_mark, confirmado_at = coalesce(confirmado_at, now()) where id = r.id;
      if r.estado <> 'confirmado_gps' then
        update public.profiles set asistencias_confirmadas = asistencias_confirmadas + 1 where id = r.id_jugador;
      end if;
    else
      update public.attendees set estado = 'no_asistio', asistencia = v_mark where id = r.id;
      if r.estado = 'confirmado_gps' then
        update public.profiles set asistencias_confirmadas = greatest(0, asistencias_confirmadas - 1) where id = r.id_jugador;
      end if;
    end if;
    if v_mark = 'asistio' then
      perform public.truescore_registrar(r.id_jugador, p_match_id, 'asistio', 'asistencia:' || r.id, format('Asististe a «%s»', v_match.titulo));
      v_asis := v_asis + 1;
    elsif v_mark = 'tarde' then
      perform public.truescore_registrar(r.id_jugador, p_match_id, 'tarde', 'asistencia:' || r.id, format('Llegaste tarde a «%s»', v_match.titulo));
      insert into public.notifications (user_id, type, title, body, data)
      values (r.id_jugador, 'match_attendance', 'Quedaste con llegada tarde', format('El organizador marcó que llegaste tarde a «%s».', v_match.titulo), jsonb_build_object('matchId', p_match_id));
      v_tarde := v_tarde + 1;
    else
      perform public.truescore_registrar(r.id_jugador, p_match_id, 'planton', 'asistencia:' || r.id, format('No fuiste a «%s» y no avisaste', v_match.titulo));
      insert into public.notifications (user_id, type, title, body, data)
      values (r.id_jugador, 'match_attendance', 'Quedaste como ausente', format('El organizador marcó que no asististe a «%s».', v_match.titulo), jsonb_build_object('matchId', p_match_id));
      v_no := v_no + 1;
    end if;
  end loop;
  update public.matches set asistencia_confirmada_at = now(), estado = case when estado in ('cancelado', 'finalizado') then estado else 'finalizado' end where id = p_match_id;
  -- 135: «partido realizado» = alguien asistió.
  if public.flag_activo('truescore_fase2') and v_asis + v_tarde > 0 then
    v_bono := public.truescore_registrar(v_match.id_organizador, p_match_id, 'bono_organizador', 'bono:' || p_match_id,
      format('Confirmaste a tiempo la asistencia de «%s»', v_match.titulo),
      extract(epoch from (now() - v_fin)) / 3600.0);
  end if;
  return jsonb_build_object('ok', true, 'presentes', v_asis, 'tarde', v_tarde, 'ausentes', v_no,
    'bono', coalesce((v_bono->>'nominal')::int, 0));
end $$;

-- ── Reclamos ──

create table if not exists public.truescore_reclamos (
  id             bigint generated always as identity primary key,
  evento_id      bigint not null unique references public.truescore_eventos(id),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  match_id       uuid not null references public.matches(id) on delete cascade,
  organizador_id uuid references public.profiles(id) on delete set null,
  estado         text not null default 'abierto' check (estado in ('abierto', 'aceptado', 'vencido')),
  vence_at       timestamptz not null,
  created_at     timestamptz not null default now(),
  resuelto_at    timestamptz
);
create table if not exists public.truescore_reclamo_confirmaciones (
  reclamo_id     bigint not null references public.truescore_reclamos(id) on delete cascade,
  confirmador_id uuid not null references public.profiles(id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (reclamo_id, confirmador_id)
);
alter table public.truescore_reclamos enable row level security;
alter table public.truescore_reclamo_confirmaciones enable row level security;
revoke all on public.truescore_reclamos from public, anon, authenticated;
revoke all on public.truescore_reclamo_confirmaciones from public, anon, authenticated;

-- Aplica un reclamo aceptado. El evento original no se toca: se agrega la
-- reversión con el puntaje ya rehecho desde ese punto.
create or replace function public.truescore_aplicar_reclamo(p_reclamo bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_rec record; v_ev record; v_antes int; v_racha int; v record; v_att record; v_titulo text;
begin
  select * into v_rec from public.truescore_reclamos where id = p_reclamo for update;
  if not found or v_rec.estado <> 'abierto' then return jsonb_build_object('ok', false); end if;
  select * into v_ev from public.truescore_eventos where id = v_rec.evento_id;
  select trust_score, truescore_racha into v_antes, v_racha from public.profiles where id = v_rec.user_id for update;
  select * into v from public.truescore_repasar(v_rec.user_id, v_ev.id, 'asistio');
  select titulo into v_titulo from public.matches where id = v_rec.match_id;

  insert into public.truescore_eventos (user_id, match_id, tipo, puntos_nominales, puntos_aplicados,
      puntaje_antes, puntaje_despues, racha_antes, racha_despues, motivo, detalle, clave, revierte_evento_id)
  values (v_rec.user_id, v_rec.match_id, 'reversion', v.puntaje - v_antes, v.puntaje - v_antes,
      v_antes, v.puntaje, v_racha, v.racha,
      format('Reclamo aceptado: sí estuviste en «%s»', v_titulo),
      jsonb_build_object('tipo_nuevo', 'asistio', 'tipo_original', v_ev.tipo, 'reclamo_id', v_rec.id,
                         'fase2', coalesce((v_ev.detalle->>'fase2')::boolean, false)),
      'reversion:' || v_ev.id, v_ev.id);
  update public.profiles set trust_score = v.puntaje, truescore_racha = v.racha where id = v_rec.user_id;

  select * into v_att from public.attendees where id_partido = v_rec.match_id and id_jugador = v_rec.user_id for update;
  if found then
    if v_att.estado <> 'confirmado_gps' then
      update public.profiles set asistencias_confirmadas = asistencias_confirmadas + 1 where id = v_rec.user_id;
    end if;
    update public.attendees set estado = 'confirmado_gps', asistencia = 'asistio',
           confirmado_at = coalesce(confirmado_at, now()) where id = v_att.id;
  end if;

  update public.truescore_reclamos set estado = 'aceptado', resuelto_at = now() where id = v_rec.id;

  if v_rec.organizador_id is not null then
    perform public.truescore_registrar(v_rec.organizador_id, v_rec.match_id, 'reclamo_organizador', 'reclamo:' || v_rec.id,
      format('Un reclamo probó que marcaste mal a un jugador en «%s»', v_titulo));
    insert into public.notifications (user_id, type, title, body, data)
    values (v_rec.organizador_id, 'match_attendance', 'Un reclamo fue aceptado',
            format('Dos compañeros confirmaron que un jugador sí estuvo en «%s». Se corrigió su marca y tu TrueScore bajó %s puntos.',
                   v_titulo, public.truescore_cfg('reclamo_organizador_puntos')),
            jsonb_build_object('matchId', v_rec.match_id));
  end if;
  insert into public.notifications (user_id, type, title, body, data)
  values (v_rec.user_id, 'match_attendance', 'Tu reclamo fue aceptado',
          format('Tus compañeros confirmaron que estuviste en «%s». Tu TrueScore quedó en %s.', v_titulo, v.puntaje),
          jsonb_build_object('matchId', v_rec.match_id));
  return jsonb_build_object('ok', true, 'puntaje', v.puntaje, 'racha', v.racha);
end $$;
revoke all on function public.truescore_aplicar_reclamo(bigint) from public, anon, authenticated;

create or replace function public.truescore_reclamar(p_match_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_ev record; v_match record; v_id bigint; v_companeros int; r record; v_username text;
  v_plazo interval := make_interval(hours => (public.truescore_cfg('reclamo_plazo_horas'))::int);
  v_min int := (public.truescore_cfg('reclamo_confirmaciones'))::int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'No autenticado'); end if;
  if not (public.flag_activo('truescore_fase1') and public.flag_activo('truescore_fase2')) then
    return jsonb_build_object('ok', false, 'reason', 'Los reclamos todavía no están disponibles');
  end if;
  select * into v_match from public.matches where id = p_match_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'El partido no existe'); end if;
  select * into v_ev from public.truescore_eventos
   where user_id = v_uid and match_id = p_match_id and tipo in ('tarde', 'planton') and clave like 'asistencia:%'
   order by id desc limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'No tienes una tardanza ni una ausencia marcada en este partido');
  end if;
  if exists (select 1 from public.truescore_eventos where revierte_evento_id = v_ev.id) then
    return jsonb_build_object('ok', false, 'reason', 'Esa marca ya se corrigió');
  end if;
  if exists (select 1 from public.truescore_reclamos where evento_id = v_ev.id) then
    return jsonb_build_object('ok', false, 'reason', 'Ya reclamaste esta marca');
  end if;
  if now() > v_ev.created_at + v_plazo then
    return jsonb_build_object('ok', false, 'reason',
      format('Pasaron las %s h para reclamar esta marca', public.truescore_cfg('reclamo_plazo_horas')));
  end if;
  select count(*) into v_companeros from public.attendees a
   where a.id_partido = p_match_id and a.asistencia in ('asistio', 'tarde')
     and a.id_jugador not in (v_uid, v_match.id_organizador);
  if v_companeros < v_min then
    return jsonb_build_object('ok', false, 'reason',
      format('Para reclamar se necesitan %s compañeros que hayan asistido, y en este partido no los hay', v_min));
  end if;

  insert into public.truescore_reclamos (evento_id, user_id, match_id, organizador_id, vence_at)
  values (v_ev.id, v_uid, p_match_id, v_match.id_organizador, v_ev.created_at + v_plazo)
  returning id into v_id;

  select username into v_username from public.profiles where id = v_uid;
  for r in select a.id_jugador from public.attendees a
     where a.id_partido = p_match_id and a.asistencia in ('asistio', 'tarde')
       and a.id_jugador not in (v_uid, v_match.id_organizador)
  loop
    insert into public.notifications (user_id, type, title, body, data)
    values (r.id_jugador, 'match_attendance', format('@%s dice que sí estuvo', coalesce(v_username, 'Un jugador')),
            format('Reclama su marca en «%s». Si llegó a tiempo, confírmalo desde el partido.', v_match.titulo),
            jsonb_build_object('matchId', p_match_id, 'reclamoId', v_id));
  end loop;
  insert into public.notifications (user_id, type, title, body, data)
  values (v_match.id_organizador, 'match_attendance', 'Reclamaron una marca de asistencia',
          format('@%s dice que sí estuvo en «%s». Si %s compañeros lo confirman, se corrige.', coalesce(v_username, 'Un jugador'), v_match.titulo, v_min),
          jsonb_build_object('matchId', p_match_id));
  return jsonb_build_object('ok', true, 'reclamo_id', v_id, 'companeros', v_companeros, 'vence_at', v_ev.created_at + v_plazo);
end $$;
revoke all on function public.truescore_reclamar(uuid) from public, anon;
grant execute on function public.truescore_reclamar(uuid) to authenticated;

create or replace function public.truescore_confirmar_reclamo(p_reclamo_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_rec record; v_n int; v_min int := (public.truescore_cfg('reclamo_confirmaciones'))::int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'No autenticado'); end if;
  if not public.flag_activo('truescore_fase2') then
    return jsonb_build_object('ok', false, 'reason', 'Los reclamos todavía no están disponibles');
  end if;
  select * into v_rec from public.truescore_reclamos where id = p_reclamo_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'El reclamo no existe'); end if;
  if v_rec.estado <> 'abierto' then
    return jsonb_build_object('ok', false, 'reason', 'Este reclamo ya se cerró', 'estado', v_rec.estado);
  end if;
  if now() > v_rec.vence_at then return jsonb_build_object('ok', false, 'reason', 'Terminó el plazo para confirmar este reclamo'); end if;
  if v_uid = v_rec.user_id then return jsonb_build_object('ok', false, 'reason', 'No puedes confirmar tu propio reclamo'); end if;
  if v_uid = v_rec.organizador_id then return jsonb_build_object('ok', false, 'reason', 'El organizador no confirma reclamos'); end if;
  if not exists (select 1 from public.attendees where id_partido = v_rec.match_id and id_jugador = v_uid and asistencia in ('asistio', 'tarde')) then
    return jsonb_build_object('ok', false, 'reason', 'Solo pueden confirmar compañeros que asistieron a ese partido');
  end if;
  insert into public.truescore_reclamo_confirmaciones (reclamo_id, confirmador_id) values (v_rec.id, v_uid)
  on conflict do nothing;
  if not found then return jsonb_build_object('ok', true, 'already', true); end if;
  select count(*) into v_n from public.truescore_reclamo_confirmaciones where reclamo_id = v_rec.id;
  if v_n >= v_min then
    perform public.truescore_aplicar_reclamo(v_rec.id);
    return jsonb_build_object('ok', true, 'aceptado', true, 'confirmaciones', v_n);
  end if;
  return jsonb_build_object('ok', true, 'aceptado', false, 'confirmaciones', v_n, 'faltan', v_min - v_n);
end $$;
revoke all on function public.truescore_confirmar_reclamo(bigint) from public, anon;
grant execute on function public.truescore_confirmar_reclamo(bigint) to authenticated;

-- Los reclamos de un partido que quien llama puede ver: el suyo, los que le
-- toca confirmar como compañero que asistió, o todos si es el organizador.
create or replace function public.truescore_reclamos_del_partido(p_match_id uuid)
returns table (id bigint, usuario text, es_mio boolean, estado text, confirmaciones integer,
               necesarias integer, vence_at timestamptz, puedo_confirmar boolean, ya_confirme boolean)
language sql stable security definer set search_path = public as $$
  select rc.id, p.username, rc.user_id = auth.uid(), rc.estado,
         (select count(*)::int from public.truescore_reclamo_confirmaciones c where c.reclamo_id = rc.id),
         (public.truescore_cfg('reclamo_confirmaciones'))::int,
         rc.vence_at,
         rc.estado = 'abierto' and now() <= rc.vence_at and rc.user_id <> auth.uid()
           and auth.uid() is distinct from rc.organizador_id
           and exists (select 1 from public.attendees a where a.id_partido = rc.match_id
                         and a.id_jugador = auth.uid() and a.asistencia in ('asistio', 'tarde'))
           and not exists (select 1 from public.truescore_reclamo_confirmaciones c
                            where c.reclamo_id = rc.id and c.confirmador_id = auth.uid()),
         exists (select 1 from public.truescore_reclamo_confirmaciones c
                  where c.reclamo_id = rc.id and c.confirmador_id = auth.uid())
    from public.truescore_reclamos rc
    join public.profiles p on p.id = rc.user_id
   where rc.match_id = p_match_id
     and (rc.user_id = auth.uid() or rc.organizador_id = auth.uid()
          or exists (select 1 from public.attendees a where a.id_partido = rc.match_id
                       and a.id_jugador = auth.uid() and a.asistencia in ('asistio', 'tarde')))
   order by rc.id;
$$;
revoke all on function public.truescore_reclamos_del_partido(uuid) from public, anon;
grant execute on function public.truescore_reclamos_del_partido(uuid) to authenticated;

-- Mis reclamos, para el historial: estado por evento.
create or replace function public.truescore_mis_reclamos()
returns table (evento_id bigint, match_id uuid, estado text, confirmaciones integer, necesarias integer, vence_at timestamptz)
language sql stable security definer set search_path = public as $$
  select rc.evento_id, rc.match_id, rc.estado,
         (select count(*)::int from public.truescore_reclamo_confirmaciones c where c.reclamo_id = rc.id),
         (public.truescore_cfg('reclamo_confirmaciones'))::int, rc.vence_at
    from public.truescore_reclamos rc
   where rc.user_id = auth.uid();
$$;
revoke all on function public.truescore_mis_reclamos() from public, anon;
grant execute on function public.truescore_mis_reclamos() to authenticated;

create or replace function public.truescore_cerrar_reclamos_vencidos() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; v_n int := 0;
begin
  for r in
    update public.truescore_reclamos rc set estado = 'vencido', resuelto_at = now()
     where rc.estado = 'abierto' and rc.vence_at <= now()
    returning rc.user_id, rc.match_id
  loop
    insert into public.notifications (user_id, type, title, body, data)
    values (r.user_id, 'match_attendance', 'Tu reclamo se cerró',
            'No alcanzaron a confirmarlo los compañeros necesarios dentro del plazo, así que la marca se mantiene.',
            jsonb_build_object('matchId', r.match_id));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.truescore_cerrar_reclamos_vencidos() from public, anon, authenticated;
do $$ begin perform cron.unschedule('futfinder-truescore-reclamos'); exception when others then null; end $$;
select cron.schedule('futfinder-truescore-reclamos', '*/15 * * * *', 'select public.truescore_cerrar_reclamos_vencidos()');

-- ── Prioridad en la lista de espera ──

create or replace function public.truescore_prioridad_espera(p_puntaje integer) returns boolean
language sql stable security definer set search_path = public as $$
  select public.flag_activo('truescore_fase1') and public.flag_activo('truescore_fase2')
     and coalesce(public.truescore_nivel(p_puntaje)->>'clave', '') = (public.truescore_cfg('prioridad_espera_nivel') #>> '{}');
$$;
revoke all on function public.truescore_prioridad_espera(integer) from public, anon;
grant execute on function public.truescore_prioridad_espera(integer) to authenticated;

-- La cola en su orden real. Corre con los permisos de quien llama: ve lo
-- que la RLS de `match_waitlist` le deja ver.
create or replace function public.lista_de_espera(p_match_id uuid)
returns table (id uuid, id_jugador uuid, created_at timestamptz, avisado_at timestamptz,
               confirmar_antes_de timestamptz, prioridad boolean, posicion integer)
language sql stable set search_path = public as $$
  select w.id, w.id_jugador, w.created_at, w.avisado_at, w.confirmar_antes_de, x.prio,
         (row_number() over (order by x.prio desc, w.created_at))::int
    from public.match_waitlist w
    join public.profiles p on p.id = w.id_jugador
    cross join lateral (select public.truescore_prioridad_espera(p.trust_score) as prio) x
   where w.id_partido = p_match_id
   order by x.prio desc, w.created_at;
$$;
revoke all on function public.lista_de_espera(uuid) from public, anon;
grant execute on function public.lista_de_espera(uuid) to authenticated;

-- Cuerpo de la 105 con el orden nuevo: la prioridad antes que la llegada.
create or replace function public.avanzar_lista_de_espera(p_match_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
    v_match     record;
    v_minutos   integer := coalesce((public.partido_reglas()->>'minutos_confirmar_lista_espera')::int, 30);
    v_vencido   record;
    v_siguiente record;
    v_vigentes  integer;
    v_faltan    integer;
    v_avisados  integer := 0;
begin
    select * into v_match from public.matches where id = p_match_id for update;
    if not found then return 0; end if;
    for v_vencido in
        select * from public.match_waitlist
         where id_partido = p_match_id and confirmar_antes_de is not null and confirmar_antes_de <= now()
    loop
        delete from public.match_waitlist where id = v_vencido.id;
        insert into public.notifications (user_id, type, title, body, data)
        values (v_vencido.id_jugador, 'waitlist_turno_vencido', 'Se te pasó el turno',
            format('Pasaron los %s min para tomar el cupo en «%s» y le tocó al siguiente de la cola. Puedes volver a entrar cuando quieras.',
                   v_minutos, coalesce(v_match.titulo, 'el partido')),
            jsonb_build_object('matchId', p_match_id));
    end loop;
    if v_match.estado not in ('abierto', 'lleno') or v_match.hora <= now() then return 0; end if;
    select count(*) into v_vigentes from public.match_waitlist where id_partido = p_match_id and confirmar_antes_de > now();
    v_faltan := greatest(coalesce(v_match.cupos_disponibles, 0), 0) - v_vigentes;
    while v_faltan > 0 loop
        select w.* into v_siguiente
          from public.match_waitlist w
          join public.profiles p on p.id = w.id_jugador
         where w.id_partido = p_match_id and w.avisado_at is null
         order by public.truescore_prioridad_espera(p.trust_score) desc, w.created_at
         limit 1;
        exit when not found;
        update public.match_waitlist set avisado_at = now(), confirmar_antes_de = now() + make_interval(mins => v_minutos)
         where id = v_siguiente.id;
        insert into public.notifications (user_id, type, title, body, data)
        values (v_siguiente.id_jugador, 'waitlist_turn', 'Se liberó un cupo',
            format('Quedó un cupo en «%s». Tienes %s min para confirmarlo.', coalesce(v_match.titulo, 'el partido'), v_minutos),
            jsonb_build_object('matchId', p_match_id, 'minutos', v_minutos));
        v_avisados := v_avisados + 1;
        v_faltan := v_faltan - 1;
    end loop;
    return v_avisados;
end;
$$;

-- Cuerpo de la 33 con la posición en el orden real de la cola.
create or replace function public.join_waitlist(p_match_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    v_uid uuid := auth.uid(); v_match record; v_pos integer; v_trust integer; v_edad integer;
begin
    if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'No autenticado'); end if;
    select * into v_match from public.matches where id = p_match_id;
    if not found then return jsonb_build_object('ok', false, 'reason', 'El partido no existe'); end if;
    if v_match.estado <> 'abierto' and v_match.estado <> 'lleno' then
        return jsonb_build_object('ok', false, 'reason', 'Este partido ya no acepta jugadores');
    end if;
    if v_match.hora <= now() then return jsonb_build_object('ok', false, 'reason', 'Este partido ya comenzó'); end if;
    if v_match.id_organizador = v_uid then return jsonb_build_object('ok', false, 'reason', 'Organizas este partido'); end if;
    if exists (select 1 from public.attendees where id_partido = p_match_id and id_jugador = v_uid and estado <> 'cancelado') then
        return jsonb_build_object('ok', false, 'reason', 'Ya tienes cupo o una solicitud en este partido');
    end if;
    select trust_score, edad into v_trust, v_edad from public.profiles where id = v_uid;
    if coalesce(v_match.min_trust_score, 0) > 0 and coalesce(v_trust, 0) < v_match.min_trust_score then
        return jsonb_build_object('ok', false, 'reason',
            format('Este partido pide Trust Score %s o más y tú tienes %s', v_match.min_trust_score, coalesce(v_trust, 0)));
    end if;
    if v_edad is not null and ((v_match.edad_min is not null and v_edad < v_match.edad_min)
        or (v_match.edad_max is not null and v_edad > v_match.edad_max)) then
        return jsonb_build_object('ok', false, 'reason', 'Tu edad está fuera del rango del partido');
    end if;
    insert into public.match_waitlist (id_partido, id_jugador) values (p_match_id, v_uid)
    on conflict (id_partido, id_jugador) do nothing;
    select l.posicion into v_pos from public.lista_de_espera(p_match_id) l where l.id_jugador = v_uid;
    return jsonb_build_object('ok', true, 'posicion', v_pos,
      'prioridad', public.truescore_prioridad_espera(v_trust));
end;
$$;

create or replace function public.truescore_ajustes() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'fase1', public.flag_activo('truescore_fase1'),
    'fase2', public.flag_activo('truescore_fase2'),
    'telefono_obligatorio', public.flag_activo('telefono_obligatorio'),
    'niveles', public.truescore_cfg('niveles'),
    'tarde_minutos', public.truescore_cfg('tarde_minutos'),
    'confirmacion_plazo_horas', public.truescore_cfg('confirmacion_plazo_horas'),
    'puntaje_inicial', public.truescore_cfg('puntaje_inicial'),
    'reclamo_plazo_horas', public.truescore_cfg('reclamo_plazo_horas'),
    'reclamo_confirmaciones', public.truescore_cfg('reclamo_confirmaciones'));
$$;
