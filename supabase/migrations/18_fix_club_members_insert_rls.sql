-- =============================================================
-- FutFinder migration 18: corrige RLS insert en club_members
-- =============================================================
-- PROBLEMA: la policy "club_members_insert" original tiene un bug
-- de auto-referencia: el subquery usa  m.club_id = m.club_id
-- (siempre TRUE), lo que hace que NOT EXISTS bloquee cualquier
-- insert una vez que existe algún miembro en la tabla.
--
-- SOLUCIÓN: agregar una policy separada para el fundador que
-- verifica directamente que sea el creador del club, sin el
-- NOT EXISTS roto. La unique constraint y el trigger
-- check_club_limits ya garantizan la integridad de datos.
-- =============================================================

DROP POLICY IF EXISTS "club_members_founder_insert" ON public.club_members;

CREATE POLICY "club_members_founder_insert"
    ON public.club_members FOR INSERT
    WITH CHECK (
        auth.uid() = user_id
        AND rol = 'admin'
        AND EXISTS (
            SELECT 1 FROM public.clubs c
            WHERE c.id = club_members.club_id
              AND c.created_by = auth.uid()
        )
    );
