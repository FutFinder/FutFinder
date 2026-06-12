-- 09 — Ventana de confirmación GPS atada a la duración real del partido.
--
-- Antes: la ventana era fija [hora - 30min, hora + 90min], sin importar
-- cuánto durara el partido. Eso provocaba dos problemas:
--   • Partidos > 90 min: la ventana cerraba antes de que terminaran.
--   • El botón "GPS" del chat post-partido aparece recién en hora+duracion,
--     justo cuando la ventana vieja ya estaba por cerrar → casi nunca usable.
--
-- Ahora: [hora - 30min, hora + duracion_min + 30min de gracia].
--   • Se puede confirmar desde 30 min antes (calentando en la cancha),
--   • durante todo el partido (con su duración real),
--   • y hasta 30 min después del pitazo final, que es cuando el chat muestra
--     la barra post-partido con el botón GPS.

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
declare
    v_match record;
    v_attendance record;
    v_distance numeric;
    v_within_window boolean;
    v_window_end timestamptz;
    v_user_id uuid := auth.uid();
begin
    if v_user_id is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    select * into v_match from public.matches where id = p_match_id;
    if v_match is null then
        return json_build_object('ok', false, 'reason', 'Partido no existe');
    end if;

    select * into v_attendance
    from public.attendees
    where id_partido = p_match_id and id_jugador = v_user_id;

    if v_attendance is null then
        return json_build_object('ok', false, 'reason', 'No estás inscrito en este partido');
    end if;

    if v_attendance.estado = 'confirmado_gps' then
        return json_build_object('ok', true, 'reason', 'Ya estaba confirmado', 'already', true);
    end if;

    v_distance := public.haversine_meters(
        v_match.latitud, v_match.longitud, p_user_lat, p_user_lng
    );

    -- Fin de ventana = fin real del partido + 30 min de gracia.
    v_window_end := v_match.hora
        + (coalesce(v_match.duracion_min, 90) || ' minutes')::interval
        + interval '30 minutes';
    v_within_window := now() between (v_match.hora - interval '30 minutes')
                                 and v_window_end;

    if v_distance > 200 then
        return json_build_object(
            'ok', false,
            'reason', 'Estás demasiado lejos de la cancha',
            'distance', v_distance
        );
    end if;

    if not v_within_window then
        return json_build_object(
            'ok', false,
            'reason', 'Fuera de la ventana de confirmación (30 min antes / hasta 30 min después de terminar)',
            'distance', v_distance
        );
    end if;

    update public.attendees
    set estado = 'confirmado_gps',
        confirmado_at = now(),
        distancia_metros = v_distance
    where id = v_attendance.id;

    update public.profiles
    set trust_score = least(trust_score + 1, 100),
        asistencias_confirmadas = asistencias_confirmadas + 1
    where id = v_user_id;

    return json_build_object(
        'ok', true,
        'distance', v_distance,
        'reason', 'Asistencia confirmada por GPS'
    );
end;
$$;
