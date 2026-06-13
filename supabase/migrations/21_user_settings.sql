-- =============================================================
-- FutFinder migration 21: columnas de configuración en profiles
--   + RPC delete_my_account
-- =============================================================

-- ── Nuevas columnas en profiles ──────────────────────────────
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS privacy_friend_requests text NOT NULL DEFAULT 'everyone'
        CHECK (privacy_friend_requests IN ('everyone', 'nobody')),
    ADD COLUMN IF NOT EXISTS privacy_visible_in_search boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS notif_matches  boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS notif_clubs    boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS notif_chat     boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS notif_friends  boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS pref_region    text,
    ADD COLUMN IF NOT EXISTS pref_comuna    text;

-- ── RPC: delete_my_account ────────────────────────────────────
-- Borra todos los datos del usuario en orden correcto de FK
-- y luego elimina el usuario de auth.users.
CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  -- Tokens de push
  DELETE FROM push_tokens   WHERE user_id        = v_user_id;
  -- Notificaciones in-app
  DELETE FROM notifications WHERE user_id        = v_user_id;
  -- Historial de chats ocultos
  DELETE FROM chat_hides    WHERE user_id        = v_user_id;
  -- Membresías de club (trigger de auto-delete si queda vacío)
  DELETE FROM club_members  WHERE user_id        = v_user_id;
  -- Solicitudes de club
  DELETE FROM club_join_requests WHERE user_id   = v_user_id;
  -- Amistades (como solicitante o receptor)
  DELETE FROM friendships
    WHERE requester_id = v_user_id OR addressee_id = v_user_id;
  -- Mensajes enviados
  DELETE FROM messages      WHERE sender_id      = v_user_id;
  -- Calificaciones emitidas
  DELETE FROM ratings       WHERE rater_id       = v_user_id;
  -- Asistencias a partidos
  DELETE FROM attendees     WHERE id_jugador     = v_user_id;
  -- Partidos organizados: se cancelan, no se borran (ya hay asistentes)
  UPDATE matches
    SET estado = 'cancelado'
    WHERE id_organizador = v_user_id
      AND estado IN ('abierto', 'lleno');
  -- Perfil (la FK ON DELETE CASCADE desde auth.users lo haría igual,
  -- pero lo hacemos explícito para limpieza ordenada)
  DELETE FROM profiles      WHERE id             = v_user_id;
  -- Finalmente eliminar el usuario de auth
  DELETE FROM auth.users    WHERE id             = v_user_id;
END;
$$;
