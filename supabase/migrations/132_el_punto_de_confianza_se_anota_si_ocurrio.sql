-- =============================================================
-- 132. EL PUNTO DE CONFIANZA SE ANOTA SÓLO SI DE VERDAD OCURRIÓ
--
-- `confirm_attendance_gps` sube el Trust Score con
-- `LEAST(trust_score + 1, 100)` —el tope es correcto— pero después escribía
-- SIEMPRE una fila en `trust_score_history` con `change_amount = 1`, aunque
-- el puntaje no se hubiera movido por estar ya en 100.
--
-- NO ES UN CASO RARO, ES EL NORMAL: `profiles.trust_score` nace en 100, y al
-- revisar esto 32 de los 34 perfiles estaban justo ahí. O sea: casi toda
-- confirmación por GPS anotaba un punto que no se dio.
--
-- QUÉ ROMPE. `TrustScoreHistoryScreen` lee esa tabla para explicar de dónde
-- sale el puntaje, así que el historial y el número dejaban de cuadrar. Ya
-- pasó: dos usuarios tienen 100 y un historial que suma 101.
--
-- Y LA APP LO REPETÍA. El hilo del chat decía «+1 a tu Trust Score» y el
-- detalle del partido «Suma a tu Trust Score» pasara lo que pasara, porque
-- la RPC no devolvía con qué distinguirlo. Ahora devuelve `trust_delta` y
-- `trust_score`, y la app dice lo que ocurrió.
--
-- CAMBIOS, y nada más:
--   1. Se lee el puntaje ANTES de subirlo (con `for update`, que además
--      serializa dos confirmaciones del mismo jugador) y el delta sale de
--      restar. Nada de adivinarlo mirando si quedó en 100: alguien que
--      estaba en 99 también termina en 100, y ahí el punto sí se dio.
--   2. La fila del historial sólo se escribe si el delta es mayor que 0.
--   3. La respuesta incluye `trust_delta` y `trust_score`.
--
-- `asistencias_confirmadas` sigue subiendo siempre: eso sí ocurre siempre.
--
-- No se tocan el tope, la ventana de 30 minutos, el radio de 200 metros, ni
-- ninguna otra rama. Lo ya escrito en `trust_score_history` no se corrige
-- acá: son dos filas, y reescribir historial es otra decisión.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

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
    v_match         record;
    v_attendance    record;
    v_distance      numeric;
    v_lat           numeric;
    v_lng           numeric;
    v_within_window boolean;
    v_window_end    timestamptz;
    v_confirmada    uuid;
    v_user_id       uuid := auth.uid();
    v_antes         integer;
    v_despues       integer;
    v_delta         integer;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN json_build_object('ok', false, 'reason', 'No autenticado');
    END IF;

    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
    IF v_match IS NULL THEN
        RETURN json_build_object('ok', false, 'reason', 'Partido no existe');
    END IF;

    -- Se bloquea la inscripción propia, y sólo ella: el partido no, porque
    -- veintidós jugadores confirmando a la vez no tienen por qué hacer fila.
    -- La segunda pestaña espera acá y vuelve a leer DESPUÉS del COMMIT de la
    -- primera, así que ve 'confirmado_gps' y se va por el camino de abajo.
    SELECT * INTO v_attendance
    FROM public.attendees
    WHERE id_partido = p_match_id AND id_jugador = v_user_id
    FOR UPDATE;

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

    -- La transición es la que manda: si la fila ya no está en 'inscrito', no
    -- se premia. El bloqueo de arriba ya lo impide; esto es la red que no
    -- depende de que nadie borre ese `FOR UPDATE` mañana.
    UPDATE public.attendees
       SET estado = 'confirmado_gps', confirmado_at = now(), distancia_metros = v_distance
     WHERE id = v_attendance.id AND estado = 'inscrito'
    RETURNING id INTO v_confirmada;

    IF v_confirmada IS NULL THEN
        RETURN json_build_object('ok', true, 'reason', 'Ya estaba confirmado', 'already', true);
    END IF;

    -- El puntaje ANTES, con la fila bloqueada: así el delta es el de esta
    -- confirmación y no el de una carrera con otra.
    SELECT trust_score INTO v_antes
      FROM public.profiles
     WHERE id = v_user_id
       FOR UPDATE;

    UPDATE public.profiles
       SET trust_score = LEAST(trust_score + 1, 100),
           asistencias_confirmadas = asistencias_confirmadas + 1
     WHERE id = v_user_id
    RETURNING trust_score INTO v_despues;

    v_delta := coalesce(v_despues, 0) - coalesce(v_antes, 0);

    -- Sólo se anota lo que pasó. Con el puntaje en el tope el delta es 0 y
    -- no hay nada que contar en el historial.
    IF v_delta > 0 THEN
        INSERT INTO public.trust_score_history (user_id, change_amount, reason, match_id)
        VALUES (v_user_id, v_delta, 'Asistencia confirmada por GPS', p_match_id);
    END IF;

    RETURN json_build_object('ok', true, 'distance', v_distance,
        'trust_delta', v_delta, 'trust_score', v_despues,
        'reason', 'Asistencia confirmada por GPS');
END;
$$;
