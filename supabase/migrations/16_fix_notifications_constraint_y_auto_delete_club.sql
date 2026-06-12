-- =============================================================
-- FutFinder migration 16
-- 1. Amplía el CHECK constraint de notifications para incluir
--    todos los tipos de club introducidos en migraciones 13-15
-- 2. Trigger que elimina automáticamente un club cuando queda
--    sin integrantes
-- =============================================================

-- 1. FIX: ampliar notifications_type_check -------------------
ALTER TABLE public.notifications
    DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check
    CHECK (type = ANY (ARRAY[
        -- tipos originales
        'match_join',
        'friend_request',
        'friend_accept',
        'message_new',
        'match_reminder',
        'match_rate',
        'join_request',
        'join_approved',
        'join_rejected',
        'match_cancelled',
        -- tipos de club (migraciones 13 y 14)
        'club_request',
        'club_request_accepted',
        'club_request_rejected',
        'club_member_joined',
        'club_member_left',
        -- tipo de invitación de club (aceptar invitación envía notif al admin)
        'club_invite_accepted'
    ]::text[]));

-- 2. Notificación al admin cuando el invitado ACEPTA la invitación ---
-- (el trigger notify_club_request_responded solo cubre solicitudes;
--  añadimos el flujo simétrico para invitaciones)
CREATE OR REPLACE FUNCTION public.notify_club_invite_accepted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_club_nombre text;
    v_username    text;
    v_admin       record;
BEGIN
    -- solo invitaciones que el jugador acepta
    IF NEW.tipo <> 'invitacion' OR OLD.status <> 'pending' THEN
        RETURN NEW;
    END IF;
    IF NEW.status <> 'approved' THEN
        RETURN NEW;
    END IF;

    SELECT nombre INTO v_club_nombre FROM public.clubs WHERE id = NEW.club_id;
    SELECT username INTO v_username  FROM public.profiles WHERE id = NEW.user_id;

    -- notifica a todos los admins del club
    FOR v_admin IN
        SELECT user_id FROM public.club_members
        WHERE club_id = NEW.club_id AND rol = 'admin'
    LOOP
        INSERT INTO public.notifications (user_id, type, title, body, data)
        VALUES (
            v_admin.user_id,
            'club_invite_accepted',
            '✅ ' || COALESCE(v_username, 'Un jugador') || ' aceptó tu invitación a ' || COALESCE(v_club_nombre, 'el club'),
            'Ya es parte del equipo.',
            jsonb_build_object(
                'clubId',     NEW.club_id,
                'fromUserId', NEW.user_id
            )
        );
    END LOOP;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_club_invite_accepted ON public.club_join_requests;
CREATE TRIGGER trg_notify_club_invite_accepted
    AFTER UPDATE OF status ON public.club_join_requests
    FOR EACH ROW EXECUTE FUNCTION public.notify_club_invite_accepted();

-- 3. AUTO-DELETE: club sin integrantes -------------------------
CREATE OR REPLACE FUNCTION public.auto_delete_empty_club()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Si el club ya no tiene ningún miembro, lo eliminamos
    IF NOT EXISTS (
        SELECT 1 FROM public.club_members WHERE club_id = OLD.club_id
    ) THEN
        DELETE FROM public.clubs WHERE id = OLD.club_id;
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_delete_empty_club ON public.club_members;
CREATE TRIGGER trg_auto_delete_empty_club
    AFTER DELETE ON public.club_members
    FOR EACH ROW EXECUTE FUNCTION public.auto_delete_empty_club();
