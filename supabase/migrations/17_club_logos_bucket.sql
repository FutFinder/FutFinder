-- =============================================================
-- FutFinder migration 17: bucket para logos de clubes
-- =============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('club-logos', 'club-logos', true, 5242880, ARRAY['image/jpeg','image/png','image/webp','image/gif'])
ON CONFLICT (id) DO NOTHING;

-- Lectura pública
DROP POLICY IF EXISTS "club_logos_public_read" ON storage.objects;
CREATE POLICY "club_logos_public_read"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'club-logos');

-- Subida: solo admins del club (primer segmento del path = club_id)
DROP POLICY IF EXISTS "club_logos_admin_upload" ON storage.objects;
CREATE POLICY "club_logos_admin_upload"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'club-logos'
        AND EXISTS (
            SELECT 1 FROM public.club_members m
            WHERE m.club_id::text = (storage.foldername(name))[1]
              AND m.user_id = auth.uid()
              AND m.rol = 'admin'
        )
    );

DROP POLICY IF EXISTS "club_logos_admin_update" ON storage.objects;
CREATE POLICY "club_logos_admin_update"
    ON storage.objects FOR UPDATE
    USING (
        bucket_id = 'club-logos'
        AND EXISTS (
            SELECT 1 FROM public.club_members m
            WHERE m.club_id::text = (storage.foldername(name))[1]
              AND m.user_id = auth.uid()
              AND m.rol = 'admin'
        )
    );

DROP POLICY IF EXISTS "club_logos_admin_delete" ON storage.objects;
CREATE POLICY "club_logos_admin_delete"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'club-logos'
        AND EXISTS (
            SELECT 1 FROM public.club_members m
            WHERE m.club_id::text = (storage.foldername(name))[1]
              AND m.user_id = auth.uid()
              AND m.rol = 'admin'
        )
    );
