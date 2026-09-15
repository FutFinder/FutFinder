-- 103. Las reglas del partido también se exigen en el servidor.
--
-- La auditoría del 15 de septiembre de 2026 encontró cuatro reglas que sólo
-- vivían en la pantalla: la aprobación manual, el rango de edad, el estado del
-- partido al aprobar y la inscripción válida al confirmar por GPS. Una llamada
-- directa a la RPC, o una sesión con datos viejos, se las saltaba entera.
--
-- Política explícita sobre la edad: un perfil SIN edad no queda fuera. No
-- podemos demostrar que incumple el rango, y es lo mismo que ya hacían
-- `join_waitlist` y `getBlockReason` en el cliente. El día que la edad sea
-- obligatoria en el perfil, esta regla se endurece en un solo lugar.

-- Un solo sitio donde se decide qué es "fuera de rango", para que las cuatro
-- puertas no se separen con el tiempo.
create or replace function public.edad_fuera_de_rango(
    p_edad integer,
    p_edad_min integer,
    p_edad_max integer
)
returns boolean
language sql
immutable
set search_path = public
as $$
    select p_edad is not null
       and ((p_edad_min is not null and p_edad < p_edad_min)
         or (p_edad_max is not null and p_edad > p_edad_max));
$$;
revoke all on function public.edad_fuera_de_rango(integer, integer, integer) from public, anon;

-- Frase legible del rango, para no repetir el `case` en cada mensaje.
create or replace function public.rango_de_edad_legible(
    p_edad_min integer,
    p_edad_max integer
)
returns text
language sql
immutable
set search_path = public
as $$
    select case
        when p_edad_min is not null and p_edad_max is not null
            then format('de %s a %s años', p_edad_min, p_edad_max)
        when p_edad_min is not null then format('desde %s años', p_edad_min)
        when p_edad_max is not null then format('hasta %s años', p_edad_max)
        else 'sin restricción de edad'
    end;
$$;
revoke all on function public.rango_de_edad_legible(integer, integer) from public, anon;

-- ---------------------------------------------------------------------------
-- 4 y 5. El ingreso inmediato respeta la aprobación manual y la edad.
-- ---------------------------------------------------------------------------
create or replace function public.join_match(p_match_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_match record;
    v_edad integer;
    v_inserted_id uuid;
begin
    if v_user_id is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    if exists (select 1 from public.matches m
                where m.id = p_match_id and m.challenge_proposal_id is not null) then
        return json_build_object('ok', false,
            'reason', 'Este es un partido entre clubes: la inscripción es por club');
    end if;

    select * into v_match from public.matches where id = p_match_id for update;
    if v_match is null then
        return json_build_object('ok', false, 'reason', 'Partido no existe');
    end if;
    if v_match.cupos_disponibles <= 0 then
        return json_build_object('ok', false, 'reason', 'Partido lleno');
    end if;
    if v_match.estado <> 'abierto' then
        return json_build_object('ok', false, 'reason', 'Partido no está abierto');
    end if;

    -- Esta puerta es sólo para la inscripción inmediata. Si el organizador
    -- revisa cada solicitud, el camino es `request_join`.
    if v_match.aprobacion = 'manual' then
        return json_build_object('ok', false,
            'reason', 'Este partido lo revisa el organizador: manda una solicitud en vez de tomar el cupo');
    end if;

    select edad into v_edad from public.profiles where id = v_user_id;
    if public.edad_fuera_de_rango(v_edad, v_match.edad_min, v_match.edad_max) then
        return json_build_object('ok', false,
            'reason', format('Este partido es para jugadores %s y tu perfil dice %s',
                             public.rango_de_edad_legible(v_match.edad_min, v_match.edad_max),
                             v_edad));
    end if;

    insert into public.attendees(id_partido, id_jugador)
    values (p_match_id, v_user_id)
    on conflict (id_partido, id_jugador) do nothing
    returning id into v_inserted_id;

    if v_inserted_id is null then
        return json_build_object('ok', true, 'already', true,
                                 'reason', 'Ya estabas inscrito en este partido');
    end if;

    update public.matches
    set cupos_disponibles = cupos_disponibles - 1,
        estado = case when cupos_disponibles - 1 = 0 then 'lleno' else estado end
    where id = p_match_id;

    return json_build_object('ok', true);
end;
$$;
revoke all on function public.join_match(uuid) from public, anon;
grant execute on function public.join_match(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. La solicitud tampoco es una puerta trasera para la edad.
-- ---------------------------------------------------------------------------
create or replace function public.request_join(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_match record; v_existing record; v_username text; v_prof record;
begin
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'No autenticado'); end if;
  select * into v_match from public.matches where id = p_match_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'Partido no encontrado'); end if;
  if v_match.estado <> 'abierto' then return jsonb_build_object('ok', false, 'reason', 'El partido no está abierto'); end if;
  if v_match.id_organizador = v_user then return jsonb_build_object('ok', false, 'reason', 'Eres el organizador'); end if;
  if v_match.cupos_disponibles <= 0 then return jsonb_build_object('ok', false, 'reason', 'No quedan cupos'); end if;

  select trust_score, estado, suspended_until, edad into v_prof from public.profiles where id = v_user;
  if v_prof.estado = 'suspendido' and (v_prof.suspended_until is null or v_prof.suspended_until > now()) then
    return jsonb_build_object('ok', false, 'reason', 'Tu cuenta está suspendida temporalmente');
  end if;
  if coalesce(v_prof.trust_score,0) < coalesce(v_match.min_trust_score,0) then
    return jsonb_build_object('ok', false, 'reason',
      'Trust Score insuficiente: necesitas ' || v_match.min_trust_score || ' y tienes ' || coalesce(v_prof.trust_score,0));
  end if;
  if public.edad_fuera_de_rango(v_prof.edad, v_match.edad_min, v_match.edad_max) then
    return jsonb_build_object('ok', false, 'reason',
      format('Este partido es para jugadores %s y tu perfil dice %s',
             public.rango_de_edad_legible(v_match.edad_min, v_match.edad_max), v_prof.edad));
  end if;

  select * into v_existing from public.attendees where id_partido = p_match_id and id_jugador = v_user;
  if found then
    if v_existing.estado = 'pendiente' then return jsonb_build_object('ok', false, 'reason', 'Ya enviaste una solicitud');
    elsif v_existing.estado in ('inscrito','confirmado_gps') then return jsonb_build_object('ok', false, 'reason', 'Ya estás en el partido');
    else update public.attendees set estado = 'pendiente' where id = v_existing.id; end if;
  else
    insert into public.attendees (id_partido, id_jugador, estado) values (p_match_id, v_user, 'pendiente');
  end if;

  select username into v_username from public.profiles where id = v_user;
  perform public.create_notification(
    v_match.id_organizador, 'join_request',
    coalesce(v_username, 'Alguien') || ' quiere unirse a tu partido',
    coalesce(v_match.titulo, 'Partido') || case when v_match.cancha_nombre is not null then ' · ' || v_match.cancha_nombre else '' end,
    jsonb_build_object('matchId', p_match_id, 'playerId', v_user)
  );
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.request_join(uuid) from public, anon;
grant execute on function public.request_join(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8 (y 5 al aprobar). No se acepta a nadie en un partido cancelado, ni
-- después de la hora, ni fuera del rango de edad.
-- ---------------------------------------------------------------------------
create or replace function public.approve_join(p_match_id uuid, p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_match record;
  v_att   record;
  v_edad  integer;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'No autenticado');
  end if;

  -- `for update`: sin esto, dos aprobaciones simultáneas leían el mismo
  -- `cupos_disponibles` y ambas pasaban.
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'Partido no encontrado');
  end if;

  -- En un partido de clubes el `id_organizador` es el administrador del
  -- club RIVAL: dejarle aprobar aquí sería dejarle elegir la nómina del
  -- otro club. La nómina por club se confirma con confirmar_nomina_club.
  if v_match.challenge_proposal_id is not null then
    return jsonb_build_object('ok', false,
      'reason', 'En un partido entre clubes la nómina la confirma un administrador de cada club');
  end if;

  if v_match.id_organizador <> v_user then
    return jsonb_build_object('ok', false, 'reason', 'Solo el organizador puede aprobar');
  end if;

  -- Dentro del mismo bloqueo de fila: la pantalla puede venir de una sesión
  -- que todavía cree que el partido sigue en pie.
  if v_match.estado = 'cancelado' then
    return jsonb_build_object('ok', false, 'reason', 'Cancelaste este partido: ya no puedes aceptar jugadores');
  end if;
  if v_match.estado not in ('abierto','lleno') then
    return jsonb_build_object('ok', false, 'reason', 'El partido ya no admite jugadores');
  end if;
  if v_match.hora <= now() then
    return jsonb_build_object('ok', false, 'reason', 'El partido ya empezó: ya no puedes aceptar jugadores');
  end if;

  select * into v_att from public.attendees
   where id_partido = p_match_id and id_jugador = p_player_id and estado = 'pendiente';
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'No hay solicitud pendiente de ese jugador');
  end if;
  if v_match.cupos_disponibles <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'No quedan cupos');
  end if;

  select edad into v_edad from public.profiles where id = p_player_id;
  if public.edad_fuera_de_rango(v_edad, v_match.edad_min, v_match.edad_max) then
    return jsonb_build_object('ok', false,
      'reason', format('Ese jugador tiene %s años y tu partido es %s',
                       v_edad, public.rango_de_edad_legible(v_match.edad_min, v_match.edad_max)));
  end if;

  update public.attendees set estado = 'inscrito' where id = v_att.id;
  update public.matches
     set cupos_disponibles = cupos_disponibles - 1,
         estado = case when cupos_disponibles - 1 = 0 then 'lleno' else estado end
   where id = p_match_id;

  perform public.create_notification(
    p_player_id, 'join_approved', 'Tu solicitud fue aceptada ✓',
    'Ya estás dentro de ' || coalesce(v_match.titulo, 'el partido'),
    jsonb_build_object('matchId', p_match_id)
  );

  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.approve_join(uuid, uuid) from public, anon;
grant execute on function public.approve_join(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Estar en la cancha a la hora no convierte a nadie en jugador del partido.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_attendance_gps(
    p_match_id uuid,
    p_user_lat numeric,
    p_user_lng numeric
)
returns json
language plpgsql
security definer
set search_path = public
as $$
DECLARE
    v_match        record;
    v_attendance   record;
    v_distance     numeric;
    v_lat          numeric;
    v_lng          numeric;
    v_within_window boolean;
    v_window_end   timestamptz;
    v_user_id      uuid := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN
        RETURN json_build_object('ok', false, 'reason', 'No autenticado');
    END IF;

    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
    IF v_match IS NULL THEN
        RETURN json_build_object('ok', false, 'reason', 'Partido no existe');
    END IF;

    SELECT * INTO v_attendance
    FROM public.attendees
    WHERE id_partido = p_match_id AND id_jugador = v_user_id;

    IF v_attendance IS NULL THEN
        RETURN json_build_object('ok', false, 'reason', 'No estás inscrito en este partido');
    END IF;

    IF v_attendance.estado = 'confirmado_gps' THEN
        RETURN json_build_object('ok', true, 'reason', 'Ya estaba confirmado', 'already', true);
    END IF;

    -- Un partido caído no reparte asistencias ni Trust Score.
    IF v_match.estado = 'cancelado' THEN
        RETURN json_build_object('ok', false, 'reason', 'Este partido fue cancelado');
    END IF;

    -- Una solicitud pendiente no es un cupo: confirmarla por GPS dejaba
    -- jugando a alguien que el organizador nunca aceptó, y sin descontar cupo.
    IF v_attendance.estado <> 'inscrito' THEN
        RETURN json_build_object('ok', false, 'reason',
            CASE v_attendance.estado
                WHEN 'pendiente' THEN 'Tu solicitud todavía está esperando la aprobación del organizador'
                ELSE 'Ya no tienes cupo en este partido'
            END);
    END IF;

    IF v_match.challenge_proposal_id IS NOT NULL THEN
        SELECT l.latitud, l.longitud INTO v_lat, v_lng
          FROM public.club_match_locations l
         WHERE l.match_id = p_match_id;
    ELSE
        v_lat := v_match.latitud;
        v_lng := v_match.longitud;
    END IF;

    IF v_lat IS NULL OR v_lng IS NULL THEN
        RETURN json_build_object(
            'ok', false,
            'reason', 'Este partido no tiene ubicación guardada, así que no podemos confirmar por GPS'
        );
    END IF;

    v_distance := public.haversine_meters(v_lat, v_lng, p_user_lat, p_user_lng);

    v_window_end := v_match.hora
        + (COALESCE(v_match.duracion_min, 90) || ' minutes')::interval
        + interval '30 minutes';
    v_within_window := now() BETWEEN (v_match.hora - interval '30 minutes') AND v_window_end;

    IF v_distance IS NULL OR v_distance > 200 THEN
        RETURN json_build_object('ok', false,
            'reason', 'Estás demasiado lejos de la cancha', 'distance', v_distance);
    END IF;

    IF NOT v_within_window THEN
        RETURN json_build_object('ok', false,
            'reason', 'Fuera de la ventana de confirmación (30 min antes / hasta 30 min después de terminar)',
            'distance', v_distance);
    END IF;

    UPDATE public.attendees
    SET estado = 'confirmado_gps', confirmado_at = now(), distancia_metros = v_distance
    WHERE id = v_attendance.id;

    UPDATE public.profiles
    SET trust_score = LEAST(trust_score + 1, 100),
        asistencias_confirmadas = asistencias_confirmadas + 1
    WHERE id = v_user_id;

    INSERT INTO public.trust_score_history (user_id, change_amount, reason)
    VALUES (v_user_id, 1, 'Asistencia confirmada por GPS');

    RETURN json_build_object('ok', true, 'distance', v_distance,
        'reason', 'Asistencia confirmada por GPS');
END;
$$;
revoke all on function public.confirm_attendance_gps(uuid, numeric, numeric) from public, anon;
grant execute on function public.confirm_attendance_gps(uuid, numeric, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 5, red de seguridad. `swap_match` y `cancel_match_and_join` insertan en
-- attendees por su cuenta: la edad se exige también en el trigger, donde ya
-- viven la suspensión, el Trust Score y el choque de horario.
-- ---------------------------------------------------------------------------
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
begin
  if new.estado not in ('inscrito','pendiente') then return new; end if;

  select min_trust_score, id_organizador, hora, duracion_min,
         challenge_proposal_id is not null, edad_min, edad_max
    into v_min, v_org, v_hora, v_dur, v_es_de_clubes, v_edad_min, v_edad_max
  from public.matches where id = new.id_partido;

  if v_org = new.id_jugador and not coalesce(v_es_de_clubes, false) then
    return new;
  end if;

  select trust_score, estado, suspended_until, edad
    into v_trust, v_estado, v_until, v_edad
  from public.profiles where id = new.id_jugador;

  if v_estado = 'suspendido' and (v_until is null or v_until > now()) then
    raise exception 'SUSPENDIDO';
  end if;
  if coalesce(v_trust,0) < coalesce(v_min,0) then
    raise exception 'TRUST_BAJO:%:%', coalesce(v_trust,0), coalesce(v_min,0);
  end if;
  if public.edad_fuera_de_rango(v_edad, v_edad_min, v_edad_max) then
    raise exception 'EDAD_FUERA_DE_RANGO';
  end if;

  select 1 into v_clash
  from public.attendees a
  join public.matches m on m.id = a.id_partido
  where a.id_jugador = new.id_jugador
    and a.estado in ('inscrito','confirmado_gps')
    and m.id <> new.id_partido
    and m.estado = 'abierto'
    and v_hora < m.hora + make_interval(mins => coalesce(m.duracion_min,90))
    and m.hora < v_hora + make_interval(mins => coalesce(v_dur,90))
  limit 1;
  if found then raise exception 'CHOQUE_HORARIO'; end if;

  return new;
end;
$$;
