-- =============================================================
-- FutFinder migration 102: el Trust Score no se edita a mano
-- =============================================================
-- HALLAZGO P1-2 DE LA AUDITORÍA DE PARTIDOS (2026-09-15). Cualquier
-- cuenta podía escribir su propia reputación:
--
--     update profiles set trust_score = 100, asistencias_confirmadas = 999
--      where id = auth.uid();
--
-- Reproducido: pasó de 42 a 100 y de 0 a 999 sin ningún privilegio. Eso
-- borra el efecto de una sanción, supera el mínimo de Trust Score de un
-- partido y falsea el historial de asistencia — las tres cosas que la
-- app usa para decidir a quién dejar entrar.
--
-- POR QUÉ ESTABA ABIERTO. La policy `profiles_update_self` dice
-- `using (auth.uid() = id)` y nada más: autoriza la FILA, no las
-- COLUMNAS. Y `authenticated` tenía `UPDATE` sobre las 37 columnas,
-- incluidas `id`, `estado` y `suspended_until`.
--
-- EL CLIENTE YA TENÍA LA LISTA CORRECTA. `updateMyProfile` filtra por una
-- lista blanca de 24 campos desde hace tiempo. Pero una lista blanca en
-- el cliente no protege nada: la API de Supabase acepta el UPDATE
-- directo. Esta migración pone ESA MISMA LISTA en la base, que es donde
-- se puede hacer cumplir.
--
-- ── POR QUÉ PERMISOS DE COLUMNA Y NO UN TRIGGER ──
-- Un trigger tendría que distinguir «lo escribió la persona» de «lo
-- escribió el sistema», y no puede: las funciones legítimas
-- (`recalc_user_ratings`, `leave_match_penalized`, `confirm_attendance_gps`)
-- son `security definer` pero las invoca el propio usuario, así que
-- `auth.uid()` está puesto en las dos situaciones. Habría que inventar
-- una marca de sesión, que es una puerta nueva.
--
-- Los permisos de columna no tienen ese problema: una función
-- `security definer` corre como su dueño —`postgres`, que es dueño de la
-- tabla— y los grants de `authenticated` no la afectan. Comprobado: las
-- siete funciones que tocan reputación son `security definer` de
-- `postgres`.
--
-- ── `anon` NO ACTUALIZA NADA ──
-- Tenía `UPDATE` sobre las 37 columnas igual que `authenticated`. Hoy la
-- RLS lo frena porque `auth.uid()` es nulo, pero el privilegio sobraba:
-- dos capas que dicen lo mismo y solo una lo dice bien.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- Se quita todo y se devuelve solo lo que la persona edita de verdad.
revoke update on public.profiles from anon, authenticated;

grant update (
    -- Quién soy y cómo me veo
    username, foto_url, banner_url, bio,
    -- Cómo juego
    posicion_preferida, flanco, edad, modalidad, nivel,
    -- Dónde estoy
    region, comuna, latitud, longitud, location_updated_at,
    -- Preferencias y avisos
    privacy_friend_requests, privacy_visible_in_search,
    notif_matches, notif_clubs, notif_chat, notif_friends,
    pref_region, pref_comuna, search_radius_km,
    -- Estado del alta
    onboarding_completed,
    updated_at
) on public.profiles to authenticated;

-- Lo que queda FUERA, y por qué:
--   trust_score, partidos_jugados, asistencias_confirmadas, mvps,
--   rating_puntualidad_avg, rating_fairplay_avg, rating_nivel_avg,
--   rating_count   → reputación: la calcula el servidor con lo que pasó.
--   estado, suspended_until                → sanciones.
--   id, created_at                         → identidad.
