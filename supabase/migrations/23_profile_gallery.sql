-- 23 — Galería de fotos de perfil

-- 1. Tabla de fotos
CREATE TABLE IF NOT EXISTS public.profile_photos (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  photo_url  text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profile_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profile_photos_select" ON public.profile_photos;
DROP POLICY IF EXISTS "profile_photos_insert" ON public.profile_photos;
DROP POLICY IF EXISTS "profile_photos_update" ON public.profile_photos;
DROP POLICY IF EXISTS "profile_photos_delete" ON public.profile_photos;

CREATE POLICY "profile_photos_select"
  ON public.profile_photos FOR SELECT USING (true);

CREATE POLICY "profile_photos_insert"
  ON public.profile_photos FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "profile_photos_update"
  ON public.profile_photos FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "profile_photos_delete"
  ON public.profile_photos FOR DELETE
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS profile_photos_user_created_idx
  ON public.profile_photos (user_id, created_at DESC);

-- 2. Bucket de storage
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-gallery', 'profile-gallery', true)
ON CONFLICT (id) DO NOTHING;

-- 3. Políticas de storage
DROP POLICY IF EXISTS "profile_gallery_public_select" ON storage.objects;
DROP POLICY IF EXISTS "profile_gallery_owner_insert" ON storage.objects;
DROP POLICY IF EXISTS "profile_gallery_owner_delete" ON storage.objects;

CREATE POLICY "profile_gallery_public_select"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'profile-gallery');

CREATE POLICY "profile_gallery_owner_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'profile-gallery'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "profile_gallery_owner_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'profile-gallery'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
