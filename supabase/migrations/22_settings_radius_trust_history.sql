-- 22 — Radio de búsqueda en perfiles + historial de trust score

-- 1. Columna para radio de búsqueda de partidos
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS search_radius_km integer NOT NULL DEFAULT 10
    CHECK (search_radius_km >= 1 AND search_radius_km <= 50);

-- 2. Tabla de historial de cambios en trust score
CREATE TABLE IF NOT EXISTS public.trust_score_history (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  change_amount integer     NOT NULL,
  reason        text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.trust_score_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "trust_score_history_select_own" ON public.trust_score_history;
CREATE POLICY "trust_score_history_select_own"
  ON public.trust_score_history FOR SELECT
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS trust_score_history_user_created_idx
  ON public.trust_score_history (user_id, created_at DESC);

-- 3. Actualizar confirm_attendance_gps para registrar en historial
CREATE OR REPLACE FUNCTION public.confirm_attendance_gps(
    p_match_id uuid,
    p_user_lat numeric,
    p_user_lng numeric
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_match        record;
    v_attendance   record;
    v_distance     numeric;
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

    v_distance := public.haversine_meters(
        v_match.latitud, v_match.longitud, p_user_lat, p_user_lng
    );

    v_window_end := v_match.hora
        + (COALESCE(v_match.duracion_min, 90) || ' minutes')::interval
        + interval '30 minutes';
    v_within_window := now() BETWEEN (v_match.hora - interval '30 minutes')
                                 AND v_window_end;

    IF v_distance > 200 THEN
        RETURN json_build_object(
            'ok', false,
            'reason', 'Estás demasiado lejos de la cancha',
            'distance', v_distance
        );
    END IF;

    IF NOT v_within_window THEN
        RETURN json_build_object(
            'ok', false,
            'reason', 'Fuera de la ventana de confirmación (30 min antes / hasta 30 min después de terminar)',
            'distance', v_distance
        );
    END IF;

    UPDATE public.attendees
    SET estado = 'confirmado_gps',
        confirmado_at = now(),
        distancia_metros = v_distance
    WHERE id = v_attendance.id;

    UPDATE public.profiles
    SET trust_score             = LEAST(trust_score + 1, 100),
        asistencias_confirmadas = asistencias_confirmadas + 1
    WHERE id = v_user_id;

    INSERT INTO public.trust_score_history (user_id, change_amount, reason)
    VALUES (v_user_id, 1, 'Asistencia confirmada por GPS');

    RETURN json_build_object(
        'ok', true,
        'distance', v_distance,
        'reason', 'Asistencia confirmada por GPS'
    );
END;
$$;
