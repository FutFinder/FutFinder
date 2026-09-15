-- 107. Corregir una marca de asistencia no le cuesta puntos al jugador.
--
-- Dos fallas que la auditoría del 15 de septiembre vio en su arnés local y
-- pidió confirmar contra el servidor antes de darlas por ciertas. Confirmadas:
--
--  A. ALTERNAR NO VUELVE ATRÁS. El organizador marca ausente (−15), se da
--     cuenta del error y corrige a presente (+2): el jugador queda 13 puntos
--     abajo. Volver a marcar ausente resta otros 15 sobre eso. Un puntaje de
--     80 terminaba en 52 después de dos correcciones, y nada de eso lo hizo el
--     jugador. Medido en producción: 80 → 65 → 67 → 52.
--
--  B. SE REGISTRA ASISTENCIA EN UN PARTIDO CANCELADO. El partido no se jugó y
--     igual se podía marcar ausente a alguien, con su −15 y su notificación.
--
-- LA FORMA DEL ARREGLO. El problema de fondo es que la función aplicaba un
-- movimiento por cada CLIC en vez de dejar al jugador donde corresponde según
-- la marca final. Ahora lleva la cuenta de lo que ella misma aplicó en este
-- partido —en `trust_score_history`, que para eso está— y mueve solo la
-- diferencia. Así el puntaje depende de la marca final y no del camino: da lo
-- mismo cuántas veces se corrija.
--
-- El movimiento que se guarda es el REAL, después del tope de 0 y 100. Si el
-- tope se comió parte de la subida, la próxima corrección parte de lo que de
-- verdad pasó y no de lo que se pretendía.

-- De qué partido viene cada movimiento. Sin esto no hay forma de saber qué
-- aplicó esta función acá, y la corrección tiene que adivinar.
alter table public.trust_score_history
  add column if not exists match_id uuid references public.matches(id) on delete set null;

create index if not exists trust_score_history_match_idx
  on public.trust_score_history (match_id, user_id)
  where match_id is not null;

create or replace function public.save_match_attendance(p_match_id uuid, p_marks jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid       uuid := auth.uid();
    v_match     record;
    v_fin       timestamptz;
    v_plazo     integer := (public.partido_reglas()->>'horas_plazo_asistencia')::int;
    v_key       text;
    v_val       text;
    v_presentes integer := 0;
    v_ausentes  integer := 0;
    v_prev      text;
    v_jug       uuid;
    v_aplicado  integer;
    v_objetivo  integer;
    v_antes     integer;
    v_despues   integer;
    v_motivo    text;
begin
    if v_uid is null then
        return jsonb_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    select * into v_match from public.matches where id = p_match_id;
    if not found then
        return jsonb_build_object('ok', false, 'reason', 'El partido no existe');
    end if;
    if v_match.id_organizador <> v_uid then
        return jsonb_build_object('ok', false, 'reason', 'Solo el organizador puede registrar la asistencia');
    end if;

    -- ── GUARDA 50: un partido entre clubes no pasa por acá ──────
    -- La asistencia y el cierre de un encuentro entre clubes los hace
    -- `proponer_resultado()` con el marcador, y el club CONTRARIO los
    -- confirma. Ver cabecera de la migración 50.
    if v_match.challenge_proposal_id is not null then
        return jsonb_build_object('ok', false, 'reason',
            'La asistencia de un partido entre clubes se registra junto al resultado, y la confirma el club contrario');
    end if;

    -- Un partido que no se jugó no tiene asistencia que registrar, y menos
    -- ausencias que penalizar.
    if v_match.estado = 'cancelado' then
        return jsonb_build_object('ok', false, 'reason',
            'Este partido está cancelado: no se registra asistencia');
    end if;

    v_fin := v_match.hora + make_interval(mins => coalesce(v_match.duracion_min, 90));
    if now() < v_fin then
        return jsonb_build_object('ok', false, 'reason', 'El partido todavía no ha terminado');
    end if;
    if now() > v_fin + make_interval(hours => v_plazo) then
        return jsonb_build_object('ok', false, 'reason',
            format('El plazo para registrar la asistencia era de %s h después del partido', v_plazo));
    end if;

    for v_key, v_val in select * from jsonb_each_text(p_marks) loop
        if v_val not in ('presente', 'ausente') then
            continue;
        end if;
        v_jug := v_key::uuid;

        select estado into v_prev
        from public.attendees
        where id_partido = p_match_id and id_jugador = v_jug;

        if v_prev is null or v_prev in ('pendiente', 'cancelado') then
            continue;
        end if;

        -- Lo que ESTA función ya movió por este partido y este jugador. El
        -- punto que da el GPS no se toca: lo ganó el jugador por estar en la
        -- cancha, no lo otorgó el organizador.
        select coalesce(sum(change_amount), 0) into v_aplicado
          from public.trust_score_history
         where user_id = v_jug
           and match_id = p_match_id
           and reason in ('Asistencia registrada por el organizador',
                          'Ausencia registrada por el organizador');

        if v_val = 'presente' then
            v_objetivo := 2;
            v_motivo := 'Asistencia registrada por el organizador';

            update public.attendees
               set estado = 'confirmado_gps',
                   confirmado_at = coalesce(confirmado_at, now())
             where id_partido = p_match_id and id_jugador = v_jug;

            -- El contador cuenta asistencias, no clics: sube solo al entrar
            -- al estado, y la marca contraria lo devuelve.
            if v_prev <> 'confirmado_gps' then
                update public.profiles
                   set asistencias_confirmadas = asistencias_confirmadas + 1
                 where id = v_jug;
            end if;
            v_presentes := v_presentes + 1;
        else
            v_objetivo := -15;
            v_motivo := 'Ausencia registrada por el organizador';

            update public.attendees
               set estado = 'no_asistio'
             where id_partido = p_match_id and id_jugador = v_jug;

            if v_prev = 'confirmado_gps' then
                update public.profiles
                   set asistencias_confirmadas = greatest(0, asistencias_confirmadas - 1)
                 where id = v_jug;
            end if;

            if v_prev <> 'no_asistio' then
                insert into public.notifications (user_id, type, title, body, data)
                values (v_jug, 'match_attendance', 'Quedaste como ausente',
                        format('El organizador marcó que no asististe a «%s».', v_match.titulo),
                        jsonb_build_object('matchId', p_match_id));
            end if;
            v_ausentes := v_ausentes + 1;
        end if;

        -- Se mueve la DIFERENCIA hasta donde corresponde estar, no un
        -- movimiento nuevo por cada vez que se guarda.
        if v_objetivo <> v_aplicado then
            select trust_score into v_antes from public.profiles where id = v_jug;
            update public.profiles
               set trust_score = least(100, greatest(0, trust_score + (v_objetivo - v_aplicado)))
             where id = v_jug
            returning trust_score into v_despues;

            -- Se guarda lo que de verdad se movió, ya con el tope aplicado.
            if v_despues <> v_antes then
                insert into public.trust_score_history (user_id, change_amount, reason, match_id)
                values (v_jug, v_despues - v_antes, v_motivo, p_match_id);
            end if;
        end if;
    end loop;

    update public.matches
       set estado = 'finalizado'
     where id = p_match_id and estado not in ('cancelado', 'finalizado');

    return jsonb_build_object('ok', true, 'presentes', v_presentes, 'ausentes', v_ausentes);
end;
$$;
revoke all on function public.save_match_attendance(uuid, jsonb) from public, anon;
grant execute on function public.save_match_attendance(uuid, jsonb) to authenticated;

-- El punto del GPS también dice de qué partido viene: el historial del
-- jugador puede llevar a ver el partido, y la corrección de arriba sabe
-- distinguirlo de lo que marcó el organizador.
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

    IF v_match.estado = 'cancelado' THEN
        RETURN json_build_object('ok', false, 'reason', 'Este partido fue cancelado');
    END IF;

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

    INSERT INTO public.trust_score_history (user_id, change_amount, reason, match_id)
    VALUES (v_user_id, 1, 'Asistencia confirmada por GPS', p_match_id);

    RETURN json_build_object('ok', true, 'distance', v_distance,
        'reason', 'Asistencia confirmada por GPS');
END;
$$;
revoke all on function public.confirm_attendance_gps(uuid, numeric, numeric) from public, anon;
grant execute on function public.confirm_attendance_gps(uuid, numeric, numeric) to authenticated;
