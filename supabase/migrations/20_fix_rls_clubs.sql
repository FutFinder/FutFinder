-- =============================================================
-- FutFinder migration 20: corrige RLS de clubs y club_members
-- =============================================================
-- BUGS encontrados (referencias de columna incorrectas):
--
--  clubs_delete/update:     m.club_id = m.id
--    → siempre FALSE (compara FK con PK de la misma tabla)
--    → ningún admin podía borrar ni actualizar su club
--
--  club_members_delete:     m.club_id = m.club_id
--    → siempre TRUE (auto-referencia)
--    → cualquier admin podía borrar miembros de cualquier club
--
--  club_join_requests_*:    m.club_id = m.club_id
--    → mismo bug de auto-referencia (demasiado permisivo)
--
-- SOLUCIÓN: corregir referencia a la tabla padre en cada policy.
-- Se agrega también una función RPC SECURITY DEFINER para el
-- borrado explícito del club (con orden correcto de FKs).
-- =============================================================

-- ── clubs: DELETE ────────────────────────────────────────────
DROP POLICY IF EXISTS "clubs_delete" ON public.clubs;
CREATE POLICY "clubs_delete"
    ON public.clubs FOR DELETE
    USING (
        -- creador siempre puede borrar su club
        auth.uid() = created_by
        -- admin activo del club
        OR EXISTS (
            SELECT 1 FROM public.club_members m
            WHERE m.club_id = clubs.id
              AND m.user_id = auth.uid()
              AND m.rol = 'admin'
        )
        -- último miembro restante (sin importar rol)
        OR NOT EXISTS (
            SELECT 1 FROM public.club_members m
            WHERE m.club_id = clubs.id
              AND m.user_id <> auth.uid()
        )
    );

-- ── clubs: UPDATE ────────────────────────────────────────────
DROP POLICY IF EXISTS "clubs_update" ON public.clubs;
CREATE POLICY "clubs_update"
    ON public.clubs FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.club_members m
            WHERE m.club_id = clubs.id
              AND m.user_id = auth.uid()
              AND m.rol = 'admin'
        )
    );

-- ── club_members: DELETE ─────────────────────────────────────
DROP POLICY IF EXISTS "club_members_delete" ON public.club_members;
CREATE POLICY "club_members_delete"
    ON public.club_members FOR DELETE
    USING (
        -- el usuario se borra a sí mismo (leave)
        auth.uid() = user_id
        -- un admin del mismo club puede expulsar/borrar cualquier miembro
        OR EXISTS (
            SELECT 1 FROM public.club_members m
            WHERE m.club_id = club_members.club_id
              AND m.user_id = auth.uid()
              AND m.rol = 'admin'
        )
    );

-- ── club_join_requests: READ ─────────────────────────────────
DROP POLICY IF EXISTS "club_join_requests_read" ON public.club_join_requests;
CREATE POLICY "club_join_requests_read"
    ON public.club_join_requests FOR SELECT
    USING (
        auth.uid() = user_id
        OR EXISTS (
            SELECT 1 FROM public.club_members m
            WHERE m.club_id = club_join_requests.club_id
              AND m.user_id = auth.uid()
              AND m.rol = 'admin'
        )
    );

-- ── club_join_requests: INSERT ───────────────────────────────
DROP POLICY IF EXISTS "club_join_requests_insert" ON public.club_join_requests;
CREATE POLICY "club_join_requests_insert"
    ON public.club_join_requests FOR INSERT
    WITH CHECK (
        (tipo = 'solicitud' AND auth.uid() = user_id)
        OR (
            tipo = 'invitacion'
            AND auth.uid() <> user_id
            AND EXISTS (
                SELECT 1 FROM public.club_members m
                WHERE m.club_id = club_join_requests.club_id
                  AND m.user_id = auth.uid()
                  AND m.rol = 'admin'
            )
        )
    );

-- ── club_join_requests: UPDATE ───────────────────────────────
DROP POLICY IF EXISTS "club_join_requests_update" ON public.club_join_requests;
CREATE POLICY "club_join_requests_update"
    ON public.club_join_requests FOR UPDATE
    USING (
        (tipo = 'solicitud' AND EXISTS (
            SELECT 1 FROM public.club_members m
            WHERE m.club_id = club_join_requests.club_id
              AND m.user_id = auth.uid()
              AND m.rol = 'admin'
        ))
        OR (tipo = 'invitacion' AND auth.uid() = user_id)
    );

-- ── club_join_requests: DELETE ───────────────────────────────
-- Reemplaza la policy existente y agrega permiso para admins
DROP POLICY IF EXISTS "club_join_requests_delete" ON public.club_join_requests;
CREATE POLICY "club_join_requests_delete"
    ON public.club_join_requests FOR DELETE
    USING (
        -- el solicitante puede cancelar su propia solicitud pendiente
        (auth.uid() = user_id AND status = 'pending')
        -- un admin puede limpiar todas las requests de su club
        OR EXISTS (
            SELECT 1 FROM public.club_members m
            WHERE m.club_id = club_join_requests.club_id
              AND m.user_id = auth.uid()
              AND m.rol = 'admin'
        )
    );

-- ── messages: DELETE ─────────────────────────────────────────
-- No existía policy de DELETE para mensajes
DROP POLICY IF EXISTS "messages_delete" ON public.messages;
CREATE POLICY "messages_delete"
    ON public.messages FOR DELETE
    USING (
        -- autor puede borrar sus propios mensajes
        auth.uid() = sender_id
        -- admin del club puede borrar mensajes del chat del club
        OR (
            club_id IS NOT NULL
            AND EXISTS (
                SELECT 1 FROM public.club_members m
                WHERE m.club_id = messages.club_id
                  AND m.user_id = auth.uid()
                  AND m.rol = 'admin'
            )
        )
    );

-- ── RPC: delete_club_as_admin ────────────────────────────────
-- Borra el club con orden explícito de FKs usando SECURITY DEFINER
-- (evita el problema de perder la membresía de admin antes de borrar el club)
CREATE OR REPLACE FUNCTION public.delete_club_as_admin(p_club_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'No autenticado');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM club_members
    WHERE club_id = p_club_id
      AND user_id = v_user_id
      AND rol = 'admin'
  ) THEN
    RETURN jsonb_build_object('error', 'No tienes permiso para eliminar este club');
  END IF;

  -- Orden explícito de borrado para respetar las FK
  DELETE FROM messages          WHERE club_id = p_club_id;
  DELETE FROM club_join_requests WHERE club_id = p_club_id;
  DELETE FROM club_members      WHERE club_id = p_club_id;
  DELETE FROM clubs             WHERE id       = p_club_id;

  RETURN jsonb_build_object('success', true);
END;
$$;
