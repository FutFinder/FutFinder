-- 182 · Asientos de partido
--
-- Un partido publicado muestra «confirmados / total» (10/14) en vez de sólo
-- los cupos que faltan. Para eso el organizador arma sus asientos al publicar:
--
--   · Creador ............ su fila de `attendees` de siempre.
--   · Cuenta vinculada ... un amigo, sentado directamente en `attendees`
--                          (origen `asiento_asignado`).
--   · Reservado .......... fila en `match_asientos` (tipo `reservado`). Sólo se
--                          toma con el link de invitación del partido
--                          (origen `asiento_link`).
--   · Invitado por nombre  fila en `match_asientos` (tipo `nombre`). Sólo
--                          mientras dure la bandera `asientos_por_nombre`.
--   · Libre .............. lo que sobra: `cupos_disponibles`, como siempre.
--
-- LO QUE NO CAMBIA, Y POR QUÉ. Quien tiene cuenta sigue viviendo en
-- `attendees`: de ahí cuelgan historial, asistencia, TrueScore, fair play,
-- calificaciones y chat. `match_asientos` guarda sólo lo que NO tiene cuenta.
-- `cupos_totales` conserva su significado (plazas aparte del organizador), así
-- que el total del partido es `cupos_totales + 1`, los confirmados son
-- `cupos_totales + 1 - cupos_disponibles`, y ni los partidos ya publicados ni
-- las RPC de ingreso y salida necesitan migrarse: `matches_guard_cupos` es el
-- único sitio que cuenta, y ahora resta también los asientos sin cuenta.
--
-- Los partidos de clubes no se tocan.

-- ── 1. La bandera con fecha de término ───────────────────────────
alter table public.feature_flags add column if not exists termina_at timestamptz;

comment on column public.feature_flags.termina_at is
  'Si no es null, la bandera deja de estar activa sola al pasar esta fecha.';

create or replace function public.flag_activo(p_nombre text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select activo and (termina_at is null or termina_at > now())
                     from public.feature_flags where nombre = p_nombre), false);
$$;

-- Período de lanzamiento: 45 días desde que se aplica. Para moverlo o apagarlo
-- basta un UPDATE de esta fila (`termina_at` o `activo`), sin tocar código.
insert into public.feature_flags (nombre, activo, activado_at, termina_at, descripcion) values
  ('asientos_por_nombre', true, now(), now() + interval '45 days',
   'Lanzamiento: el organizador puede ocupar un asiento escribiendo sólo un nombre, sin cuenta de FutFinder.')
on conflict (nombre) do nothing;

-- ── 2. Las tablas ────────────────────────────────────────────────
create table if not exists public.match_asientos (
  id          uuid primary key default gen_random_uuid(),
  id_partido  uuid not null references public.matches(id) on delete cascade,
  tipo        text not null check (tipo in ('reservado', 'nombre')),
  nombre      text,
  created_at  timestamptz not null default now(),
  constraint match_asientos_nombre_check check (
    (tipo = 'nombre' and nombre is not null and char_length(btrim(nombre)) between 1 and 40)
    or (tipo = 'reservado' and nombre is null)
  )
);

create index if not exists match_asientos_partido_idx on public.match_asientos (id_partido);

alter table public.match_asientos enable row level security;
revoke all on public.match_asientos from public, anon, authenticated;
grant select on public.match_asientos to authenticated;

drop policy if exists match_asientos_read_si_veo_el_partido on public.match_asientos;
create policy match_asientos_read_si_veo_el_partido on public.match_asientos
  for select to authenticated
  using (exists (select 1 from public.matches m where m.id = match_asientos.id_partido));

drop policy if exists mfa_exigida on public.match_asientos;
create policy mfa_exigida on public.match_asientos as restrictive
  for select to authenticated using ((select public.mfa_cumplida()));

-- El token del link vive aparte de `matches` a propósito: la app lee los
-- partidos con `select *`, y en una columna lo vería cualquiera.
create table if not exists public.match_invitaciones (
  id_partido  uuid primary key references public.matches(id) on delete cascade,
  token       uuid not null default gen_random_uuid(),
  created_at  timestamptz not null default now()
);

alter table public.match_invitaciones enable row level security;
revoke all on public.match_invitaciones from public, anon, authenticated;

-- ── 3. Los orígenes nuevos de la nómina ──────────────────────────
alter table public.attendees drop constraint if exists attendees_origen_check;
alter table public.attendees add constraint attendees_origen_check check (
  origen = any (array['orden_llegada', 'postulacion', 'postulacion_aprobada',
                      'reserva_proponente', 'reserva_aprobador', 'organizador', 'legado',
                      'asiento_asignado', 'asiento_link'])
);

-- ── 4. El único sitio que cuenta los cupos ───────────────────────
create or replace function public.matches_guard_cupos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ocupadas integer;
    v_sin_cuenta integer := 0;
    v_es_de_clubes boolean := new.challenge_proposal_id is not null;
begin
    select count(*) into v_ocupadas
    from public.attendees
    where id_partido = new.id
      and estado in ('inscrito', 'confirmado_gps', 'no_asistio')
      and (v_es_de_clubes or id_jugador is distinct from new.id_organizador);

    if not v_es_de_clubes then
        -- Reservados e invitados por nombre: ocupan plaza sin tener cuenta.
        select count(*) into v_sin_cuenta
        from public.match_asientos where id_partido = new.id;
        v_ocupadas := v_ocupadas + v_sin_cuenta;
    end if;

    if new.cupos_totales < v_ocupadas then
        raise exception 'CUPOS_MENOR_QUE_CONFIRMADOS:%:%', new.cupos_totales, v_ocupadas;
    end if;

    if v_es_de_clubes then
        if new.cupos_disponibles > new.cupos_totales then
            new.cupos_disponibles := new.cupos_totales;
        end if;
    else
        new.cupos_disponibles := greatest(new.cupos_totales - v_ocupadas, 0);
        -- `abierto` y `lleno` describen la misma realidad desde dos lados: se
        -- deducen juntos. Ampliar un partido lleno lo reabre, y el último
        -- cupo tomado lo llena, sin que nadie tenga que acordarse.
        if new.estado in ('abierto', 'lleno') then
            new.estado := case when new.cupos_disponibles > 0 then 'abierto' else 'lleno' end;
        end if;
    end if;

    return new;
end;
$$;

-- ── 5. Las reglas de ingreso y la gente del organizador ──────────
-- Quien entra por un asiento del organizador (amigo asignado o link) no pasa
-- por el mínimo de puntaje, el rango de edad ni el turno de la lista de
-- espera: esos filtros son para los cupos libres, y el asiento ya estaba
-- apartado. Expulsión, suspensión, teléfono y choque de horario siguen.
create or replace function public.tg_enforce_join_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_min int; v_org uuid; v_hora timestamptz; v_dur int;
  v_trust int; v_estado text; v_until timestamptz; v_clash int;
  v_es_de_clubes boolean;
  v_edad_min int; v_edad_max int; v_edad int;
  v_libres int; v_turnos_de_otros int;
  v_de_la_casa boolean := new.origen in ('asiento_asignado', 'asiento_link');
begin
  if new.estado not in ('inscrito','pendiente') then return new; end if;
  perform pg_advisory_xact_lock(107, hashtext(new.id_jugador::text));
  select min_trust_score, id_organizador, hora, duracion_min, challenge_proposal_id is not null, edad_min, edad_max, cupos_disponibles
    into v_min, v_org, v_hora, v_dur, v_es_de_clubes, v_edad_min, v_edad_max, v_libres
  from public.matches where id = new.id_partido;
  if v_org = new.id_jugador and not coalesce(v_es_de_clubes, false) then return new; end if;
  if exists (select 1 from public.match_expulsiones where match_id = new.id_partido and jugador_id = new.id_jugador) then
    raise exception 'EXPULSADO';
  end if;
  if not coalesce(v_es_de_clubes, false) and public.flag_activo('telefono_obligatorio') and not public.telefono_cumple(new.id_jugador) then
    raise exception 'TELEFONO_NO_VERIFICADO';
  end if;
  select trust_score, estado, suspended_until, edad into v_trust, v_estado, v_until, v_edad from public.profiles where id = new.id_jugador;
  if v_estado = 'suspendido' and (v_until is null or v_until > now()) then raise exception 'SUSPENDIDO'; end if;
  if not coalesce(v_de_la_casa, false) then
    if coalesce(v_trust,0) < coalesce(v_min,0) then raise exception 'TRUST_BAJO:%:%', coalesce(v_trust,0), coalesce(v_min,0); end if;
    if public.edad_fuera_de_rango(v_edad, v_edad_min, v_edad_max) then raise exception 'EDAD_FUERA_DE_RANGO'; end if;
    if new.estado = 'inscrito' and not coalesce(v_es_de_clubes, false) then
      select count(*) into v_turnos_de_otros from public.match_waitlist w
       where w.id_partido = new.id_partido and w.confirmar_antes_de > now() and w.id_jugador <> new.id_jugador;
      if coalesce(v_libres, 0) <= v_turnos_de_otros then raise exception 'CUPO_RESERVADO'; end if;
    end if;
  end if;
  select 1 into v_clash from public.attendees a join public.matches m on m.id = a.id_partido
  where a.id_jugador = new.id_jugador and a.estado in ('inscrito','confirmado_gps') and m.id <> new.id_partido
    and m.estado = any (public.estados_que_ocupan_horario())
    and v_hora < m.hora + make_interval(mins => coalesce(m.duracion_min,90))
    and m.hora < v_hora + make_interval(mins => coalesce(v_dur,90))
  limit 1;
  if found then raise exception 'CHOQUE_HORARIO'; end if;
  return new;
end;
$$;

-- El organizador no necesita que le avisen que «se unió» alguien a quien él
-- mismo acaba de sentar.
create or replace function public.tg_notify_match_join()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organizador uuid; v_titulo text; v_username text; v_es_de_clubes boolean;
begin
  if new.estado = 'pendiente' then
    return new;  -- solicitud manual → la maneja request_join
  end if;
  if new.origen = 'asiento_asignado' then
    return new;  -- lo sentó el propio organizador
  end if;

  select id_organizador, titulo, challenge_proposal_id is not null
    into v_organizador, v_titulo, v_es_de_clubes
  from public.matches where id = new.id_partido;

  if v_es_de_clubes then
    return new;  -- la nómina por club avisa por su cuenta
  end if;

  if v_organizador is null or v_organizador = new.id_jugador then
    return new;
  end if;

  select username into v_username from public.profiles where id = new.id_jugador;

  perform public.create_notification(
    v_organizador, 'match_join',
    coalesce(v_username, 'Alguien') || ' se unió a tu partido',
    coalesce(v_titulo, 'Partido'),
    jsonb_build_object('matchId', new.id_partido, 'playerId', new.id_jugador)
  );
  return new;
end;
$$;

-- ── 6. Salirse de un asiento que uno no pidió no cuesta puntos ───
-- A un amigo asignado nadie le preguntó. Si se baja, el asiento vuelve a
-- quedar libre y su puntaje no se toca.
create or replace function public.leave_match_penalized(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_match record; v_estado text; v_att uuid; v_pen int := 0; v_freed boolean := false;
  v_ts jsonb; v_horas numeric; v_origen text;
begin
  if v_user is null then return jsonb_build_object('ok',false,'reason','No autenticado'); end if;
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then return jsonb_build_object('ok',false,'reason','Partido no existe'); end if;
  if v_match.challenge_proposal_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'Este es un partido entre clubes: las bajas se gestionan por club');
  end if;
  if v_match.id_organizador = v_user then
    return jsonb_build_object('ok',false,'reason','Eres el anfitrión: debes cancelar el partido');
  end if;
  if v_match.estado = 'cancelado' then
    return jsonb_build_object('ok', false, 'reason', 'Este partido fue cancelado por el organizador: no tienes que salirte');
  end if;
  if v_match.estado = 'finalizado' or v_match.hora + make_interval(mins => coalesce(v_match.duracion_min, 90)) <= now() then
    return jsonb_build_object('ok', false, 'reason', 'Este partido ya terminó');
  end if;
  delete from public.attendees where id_partido = p_match_id and id_jugador = v_user and estado in ('inscrito','confirmado_gps','pendiente')
  returning estado, id, origen into v_estado, v_att, v_origen;
  if not found then return jsonb_build_object('ok',false,'reason','No estás en este partido'); end if;
  if v_estado in ('inscrito','confirmado_gps') then
    v_freed := true;
    update public.matches set cupos_disponibles = cupos_disponibles + 1, estado = case when estado = 'lleno' then 'abierto' else estado end where id = p_match_id;
    insert into public.messages (sender_id, match_id, content) values (v_user, p_match_id, 'Un jugador se ha salido, ¡vuelve a haber un cupo disponible!');
    if v_origen = 'asiento_asignado' then
      return jsonb_build_object('ok', true, 'penalty', 0, 'freed', v_freed, 'sin_costo', true);
    end if;
    if public.flag_activo('truescore_fase1') then
      v_horas := greatest(extract(epoch from (v_match.hora - now())) / 3600.0, 0);
      v_ts := public.truescore_registrar(v_user, p_match_id, 'salida', 'salida:' || v_att, format('Te saliste con %s h de aviso', round(v_horas, 1)), v_horas);
      v_pen := abs(coalesce((v_ts->>'nominal')::int, 0));
      return jsonb_build_object('ok', true, 'penalty', v_pen, 'freed', v_freed, 'truescore', v_ts);
    end if;
    v_pen := case when v_match.hora > now() + interval '2 hours' then 3 else 20 end;
    update public.profiles set trust_score = greatest(trust_score - v_pen, 0) where id = v_user;
  end if;
  return jsonb_build_object('ok', true, 'penalty', v_pen, 'freed', v_freed);
end $$;

create or replace function public.truescore_costo_salida(p_match_id uuid, p_tipo_cancelacion text default 'otro')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_match record; v_horas numeric; v_pen int; v_racha int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'No autenticado'); end if;
  if not public.flag_activo('truescore_fase1') then return jsonb_build_object('ok', false, 'reason', 'TrueScore inactivo'); end if;
  select * into v_match from public.matches where id = p_match_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'El partido no existe'); end if;
  v_horas := extract(epoch from (v_match.hora - now())) / 3600.0;
  if v_match.id_organizador = v_uid then
    v_pen := case when coalesce(p_tipo_cancelacion, 'otro') in ('lluvia', 'cierre_cancha') then 0 else public.truescore_penalizacion_cancelacion(v_horas) end;
    return jsonb_build_object('ok', true, 'rol', 'organizador', 'horas', round(v_horas, 2), 'puntos', v_pen, 'rompe_racha', false,
      'horas_sin_costo', public.truescore_cfg('cancelacion_horas_sin_costo'));
  end if;
  if exists (select 1 from public.attendees
              where id_partido = p_match_id and id_jugador = v_uid and origen = 'asiento_asignado') then
    return jsonb_build_object('ok', true, 'rol', 'jugador', 'horas', round(v_horas, 2), 'puntos', 0,
      'rompe_racha', false, 'sin_costo', true);
  end if;
  select truescore_racha into v_racha from public.profiles where id = v_uid;
  v_pen := public.truescore_penalizacion_salida(greatest(v_horas, 0));
  return jsonb_build_object('ok', true, 'rol', 'jugador', 'horas', round(v_horas, 2), 'puntos', v_pen,
    'rompe_racha', coalesce(v_racha, 0) > 0 and v_horas < (public.truescore_cfg('salida_horas_mantiene_racha'))::numeric);
end $$;

-- ── 7. Ayudantes internos (no son puertas) ───────────────────────

-- Bloquea el partido y comprueba que quien llama puede armar sus asientos.
create or replace function public._asiento_partido(p_match_id uuid)
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  m public.matches;
begin
  if v_uid is null then raise exception 'ASIENTO_NO_AUTENTICADO'; end if;
  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'ASIENTO_PARTIDO_NO_EXISTE'; end if;
  if m.id_organizador is distinct from v_uid then raise exception 'ASIENTO_SOLO_ORGANIZADOR'; end if;
  if m.challenge_proposal_id is not null then raise exception 'ASIENTO_PARTIDO_DE_CLUBES'; end if;
  if m.estado not in ('abierto', 'lleno') or m.hora <= now() then raise exception 'ASIENTO_PARTIDO_CERRADO'; end if;
  return m;
end $$;

-- Cupos libres de verdad: los disponibles menos los turnos vigentes de la
-- lista de espera, que ya están prometidos a alguien.
create or replace function public._asiento_libres(p_match_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    (select cupos_disponibles from public.matches where id = p_match_id)
    - (select count(*)::int from public.match_waitlist w
        where w.id_partido = p_match_id and w.confirmar_antes_de > now()), 0);
$$;

-- Hace que `matches_guard_cupos` vuelva a contar.
create or replace function public._asiento_recontar(p_match_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.matches set cupos_disponibles = cupos_disponibles where id = p_match_id;
$$;

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
  return v;
end $$;

-- Sienta a un amigo del organizador. No cuenta cupos: eso lo hace quien llama.
create or replace function public._asiento_sentar_amigo(p_match public.matches, p_amigo uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_estado text;
  v_username text;
begin
  if p_amigo is null or p_amigo = p_match.id_organizador then raise exception 'ASIENTO_JUGADOR_INVALIDO'; end if;
  if not exists (select 1 from public.friendships f
                  where f.status = 'accepted'
                    and ((f.requester_id = v_uid and f.addressee_id = p_amigo)
                      or (f.requester_id = p_amigo and f.addressee_id = v_uid))) then
    raise exception 'ASIENTO_NO_ES_AMIGO';
  end if;
  if exists (select 1 from public.blocked_users b
              where (b.blocker_id = v_uid and b.blocked_id = p_amigo)
                 or (b.blocker_id = p_amigo and b.blocked_id = v_uid)) then
    raise exception 'ASIENTO_NO_ES_AMIGO';
  end if;

  select estado into v_estado from public.attendees
   where id_partido = p_match.id and id_jugador = p_amigo for update;
  if v_estado in ('inscrito', 'confirmado_gps', 'no_asistio') then
    raise exception 'ASIENTO_YA_EN_PARTIDO';
  elsif v_estado is not null then
    -- Tenía una solicitud pendiente (o una fila vieja): se convierte.
    update public.attendees set estado = 'inscrito', origen = 'asiento_asignado', inscrito_at = now()
     where id_partido = p_match.id and id_jugador = p_amigo;
    delete from public.match_waitlist where id_partido = p_match.id and id_jugador = p_amigo;
  else
    insert into public.attendees (id_partido, id_jugador, estado, origen)
    values (p_match.id, p_amigo, 'inscrito', 'asiento_asignado');
  end if;

  select username into v_username from public.profiles where id = v_uid;
  perform public.create_notification(
    p_amigo, 'join_approved',
    coalesce(v_username, 'Un amigo') || ' te sumó a su partido',
    coalesce(p_match.titulo, 'Partido') || ' · Si no puedes ir, puedes bajarte sin costo.',
    jsonb_build_object('matchId', p_match.id, 'asiento', 'asignado')
  );
end $$;

revoke all on function public._asiento_partido(uuid) from public, anon, authenticated;
revoke all on function public._asiento_libres(uuid) from public, anon, authenticated;
revoke all on function public._asiento_recontar(uuid) from public, anon, authenticated;
revoke all on function public._asiento_nombre_limpio(text) from public, anon, authenticated;
revoke all on function public._asiento_sentar_amigo(public.matches, uuid) from public, anon, authenticated;

-- ── 8. Las puertas del organizador ───────────────────────────────

-- Agrega varios asientos de una vez. `p_asientos` es un arreglo de
--   {"tipo":"amigo","user_id":"…"} | {"tipo":"reservado"} | {"tipo":"nombre","nombre":"Johan"}
create or replace function public.asientos_armar(p_match_id uuid, p_asientos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.matches;
  a jsonb;
  n integer := coalesce(jsonb_array_length(coalesce(p_asientos, '[]'::jsonb)), 0);
begin
  m := public._asiento_partido(p_match_id);
  if n = 0 then return jsonb_build_object('ok', true, 'agregados', 0); end if;
  if n > public._asiento_libres(p_match_id) then raise exception 'ASIENTO_SIN_LIBRES'; end if;

  for a in select * from jsonb_array_elements(p_asientos) loop
    case a->>'tipo'
      when 'amigo' then
        perform public._asiento_sentar_amigo(m, (a->>'user_id')::uuid);
      when 'reservado' then
        insert into public.match_asientos (id_partido, tipo) values (p_match_id, 'reservado');
      when 'nombre' then
        insert into public.match_asientos (id_partido, tipo, nombre)
        values (p_match_id, 'nombre', public._asiento_nombre_limpio(a->>'nombre'));
      else
        raise exception 'ASIENTO_TIPO_INVALIDO';
    end case;
  end loop;

  perform public._asiento_recontar(p_match_id);
  return jsonb_build_object('ok', true, 'agregados', n);
end $$;

-- Publica el partido y sus asientos en una sola transacción. Es `security
-- invoker` a propósito: el INSERT corre como quien llama, con el mismo GRANT
-- por columnas, la misma RLS y los mismos disparadores que el alta directa.
-- `p_partido` trae las columnas de siempre más `jugadores_total`.
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

-- Sienta a un amigo. Con `p_asiento_id` reemplaza un asiento reservado o por
-- nombre; sin él, ocupa un cupo libre.
create or replace function public.asiento_asignar_amigo(p_match_id uuid, p_amigo uuid, p_asiento_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.matches;
begin
  m := public._asiento_partido(p_match_id);
  if p_asiento_id is not null then
    delete from public.match_asientos where id = p_asiento_id and id_partido = p_match_id;
    if not found then raise exception 'ASIENTO_NO_EXISTE'; end if;
  elsif public._asiento_libres(p_match_id) < 1 then
    raise exception 'ASIENTO_SIN_LIBRES';
  end if;
  perform public._asiento_sentar_amigo(m, p_amigo);
  perform public._asiento_recontar(p_match_id);
  return jsonb_build_object('ok', true);
end $$;

-- Reserva asientos o los ocupa con un nombre, tomándolos de los libres.
create or replace function public.asiento_agregar(p_match_id uuid, p_tipo text, p_nombre text default null, p_cantidad integer default 1)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer := case when p_tipo = 'nombre' then 1 else greatest(coalesce(p_cantidad, 1), 1) end;
  v_nombre text;
begin
  perform public._asiento_partido(p_match_id);
  if p_tipo not in ('reservado', 'nombre') then raise exception 'ASIENTO_TIPO_INVALIDO'; end if;
  if p_tipo = 'nombre' then v_nombre := public._asiento_nombre_limpio(p_nombre); end if;
  if v_n > public._asiento_libres(p_match_id) then raise exception 'ASIENTO_SIN_LIBRES'; end if;
  insert into public.match_asientos (id_partido, tipo, nombre)
  select p_match_id, p_tipo, v_nombre from generate_series(1, v_n);
  perform public._asiento_recontar(p_match_id);
  return jsonb_build_object('ok', true, 'agregados', v_n);
end $$;

-- Cambia un asiento sin cuenta: de nombre a reservado, de reservado a nombre,
-- o corrige el nombre.
create or replace function public.asiento_cambiar(p_asiento_id uuid, p_tipo text, p_nombre text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match uuid;
begin
  if auth.uid() is null then raise exception 'ASIENTO_NO_AUTENTICADO'; end if;
  select id_partido into v_match from public.match_asientos where id = p_asiento_id;
  if not found then raise exception 'ASIENTO_NO_EXISTE'; end if;
  perform public._asiento_partido(v_match);
  if p_tipo = 'reservado' then
    update public.match_asientos set tipo = 'reservado', nombre = null where id = p_asiento_id;
  elsif p_tipo = 'nombre' then
    update public.match_asientos set tipo = 'nombre', nombre = public._asiento_nombre_limpio(p_nombre)
     where id = p_asiento_id;
  else
    raise exception 'ASIENTO_TIPO_INVALIDO';
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Libera un asiento reservado o por nombre: vuelve a ser un cupo público.
create or replace function public.asiento_liberar(p_asiento_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match uuid;
begin
  if auth.uid() is null then raise exception 'ASIENTO_NO_AUTENTICADO'; end if;
  select id_partido into v_match from public.match_asientos where id = p_asiento_id;
  if not found then raise exception 'ASIENTO_NO_EXISTE'; end if;
  perform public._asiento_partido(v_match);
  delete from public.match_asientos where id = p_asiento_id;
  perform public._asiento_recontar(v_match);
  return jsonb_build_object('ok', true);
end $$;

-- Deshace la asignación de un amigo. Sólo vale para quien el organizador
-- sentó: a quien entró por su cuenta se le aplica la expulsión de siempre.
create or replace function public.asiento_quitar_amigo(p_match_id uuid, p_jugador uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.matches;
begin
  m := public._asiento_partido(p_match_id);
  delete from public.attendees
   where id_partido = p_match_id and id_jugador = p_jugador
     and origen = 'asiento_asignado' and estado = 'inscrito';
  if not found then raise exception 'ASIENTO_NO_EXISTE'; end if;
  perform public._asiento_recontar(p_match_id);
  perform public.create_notification(
    p_jugador, 'match_updated', 'Ya no estás en el partido',
    coalesce(m.titulo, 'Partido') || ' · El organizador liberó tu asiento.',
    jsonb_build_object('matchId', p_match_id)
  );
  return jsonb_build_object('ok', true);
end $$;

-- El token del link de invitación. Se crea la primera vez que se pide.
create or replace function public.asientos_link(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid;
begin
  perform public._asiento_partido(p_match_id);
  insert into public.match_invitaciones (id_partido) values (p_match_id)
  on conflict (id_partido) do nothing;
  select token into v_token from public.match_invitaciones where id_partido = p_match_id;
  return jsonb_build_object('ok', true, 'token', v_token);
end $$;

-- ── 9. La puerta de quien llega con el link ──────────────────────
-- Convierte UN asiento reservado en la inscripción de quien llama. Nunca toca
-- los cupos libres: si no quedan reservas, responde SIN_RESERVAS.
create or replace function public.tomar_asiento_reservado(p_match_id uuid, p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  m public.matches;
  v_asiento uuid;
  v_estado text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'NO_AUTENTICADO'); end if;
  select * into m from public.matches where id = p_match_id for update;
  if not found or p_token is null or not exists (
       select 1 from public.match_invitaciones i where i.id_partido = p_match_id and i.token = p_token) then
    return jsonb_build_object('ok', false, 'reason', 'LINK_INVALIDO');
  end if;
  if m.estado not in ('abierto', 'lleno') or m.hora <= now() then
    return jsonb_build_object('ok', false, 'reason', 'PARTIDO_CERRADO');
  end if;

  select estado into v_estado from public.attendees
   where id_partido = p_match_id and id_jugador = v_uid for update;
  if v_estado in ('inscrito', 'confirmado_gps', 'no_asistio') then
    return jsonb_build_object('ok', true, 'ya_estaba', true);
  end if;

  select id into v_asiento from public.match_asientos
   where id_partido = p_match_id and tipo = 'reservado'
   order by created_at, id limit 1 for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'SIN_RESERVAS'); end if;

  begin
    delete from public.match_asientos where id = v_asiento;
    if v_estado is not null then
      update public.attendees set estado = 'inscrito', origen = 'asiento_link', inscrito_at = now()
       where id_partido = p_match_id and id_jugador = v_uid;
      delete from public.match_waitlist where id_partido = p_match_id and id_jugador = v_uid;
    else
      insert into public.attendees (id_partido, id_jugador, estado, origen)
      values (p_match_id, v_uid, 'inscrito', 'asiento_link');
    end if;
    perform public._asiento_recontar(p_match_id);
  exception when raise_exception then
    -- EXPULSADO, SUSPENDIDO, CHOQUE_HORARIO…: la reserva vuelve a su sitio.
    return jsonb_build_object('ok', false, 'reason', split_part(sqlerrm, ':', 1));
  end;

  return jsonb_build_object('ok', true, 'ya_estaba', false);
end $$;

-- ── 10. Lo que la app necesita saber ─────────────────────────────
create or replace function public.partidos_ajustes()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'asientos_por_nombre', public.flag_activo('asientos_por_nombre'),
    'asientos_por_nombre_termina',
      (select termina_at from public.feature_flags where nombre = 'asientos_por_nombre')
  );
$$;

-- ── 11. Los asientos mueren con su partido ───────────────────────
-- 24 horas después del término (o al cancelarse) se borran los nombres
-- escritos, las reservas sin tomar y el link. La nómina con cuenta no se toca.
create or replace function public.limpiar_asientos_vencidos()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  with vencidos as (
    select id from public.matches
     where estado = 'cancelado'
        or hora + make_interval(mins => coalesce(duracion_min, 90)) + interval '24 hours' < now()
  ), borrados as (
    delete from public.match_asientos a using vencidos v where a.id_partido = v.id returning 1
  ), links as (
    delete from public.match_invitaciones i using vencidos v where i.id_partido = v.id returning 1
  )
  select (select count(*) from borrados) into v_n;
  return v_n;
end $$;

revoke all on function public.limpiar_asientos_vencidos() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('futfinder-limpiar-asientos', '20 * * * *', 'select public.limpiar_asientos_vencidos();');
  end if;
end $$;

-- ── 12. Quién puede llamar qué ───────────────────────────────────
revoke all on function public.asientos_armar(uuid, jsonb) from public, anon;
revoke all on function public.publicar_partido_con_asientos(jsonb, jsonb) from public, anon;
revoke all on function public.asiento_asignar_amigo(uuid, uuid, uuid) from public, anon;
revoke all on function public.asiento_agregar(uuid, text, text, integer) from public, anon;
revoke all on function public.asiento_cambiar(uuid, text, text) from public, anon;
revoke all on function public.asiento_liberar(uuid) from public, anon;
revoke all on function public.asiento_quitar_amigo(uuid, uuid) from public, anon;
revoke all on function public.asientos_link(uuid) from public, anon;
revoke all on function public.tomar_asiento_reservado(uuid, uuid) from public, anon;
revoke all on function public.partidos_ajustes() from public, anon;

grant execute on function public.asientos_armar(uuid, jsonb) to authenticated;
grant execute on function public.publicar_partido_con_asientos(jsonb, jsonb) to authenticated;
grant execute on function public.asiento_asignar_amigo(uuid, uuid, uuid) to authenticated;
grant execute on function public.asiento_agregar(uuid, text, text, integer) to authenticated;
grant execute on function public.asiento_cambiar(uuid, text, text) to authenticated;
grant execute on function public.asiento_liberar(uuid) to authenticated;
grant execute on function public.asiento_quitar_amigo(uuid, uuid) to authenticated;
grant execute on function public.asientos_link(uuid) to authenticated;
grant execute on function public.tomar_asiento_reservado(uuid, uuid) to authenticated;
grant execute on function public.partidos_ajustes() to authenticated;
