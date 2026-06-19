-- =============================================================
-- FutFinder migration 25: banner del club + galería de fotos
-- =============================================================
-- Pega esto entero en Supabase → SQL Editor → New query → Run.
--
-- Crea:
--   - Columna clubs.banner_url (foto de portada; reusa el bucket club-logos)
--   - Tabla club_photos (galería del club)
--   - Bucket club-gallery con RLS de admin (espejo de club-logos)
-- =============================================================

-- 1. BANNER --------------------------------------------------------
-- El banner se sube al bucket existente club-logos en <clubId>/banner.<ext>,
-- así que aquí solo agregamos la columna que guarda su URL pública.
alter table public.clubs
    add column if not exists banner_url text;

-- 2. TABLA: club_photos -------------------------------------------
create table if not exists public.club_photos (
    id          uuid        primary key default gen_random_uuid(),
    club_id     uuid        not null references public.clubs(id) on delete cascade,
    photo_url   text        not null,
    uploaded_by uuid        references public.profiles(id) on delete set null,
    created_at  timestamptz not null default now()
);

create index if not exists club_photos_club_created_idx
    on public.club_photos (club_id, created_at desc);

alter table public.club_photos enable row level security;

drop policy if exists "club_photos_select" on public.club_photos;
drop policy if exists "club_photos_insert" on public.club_photos;
drop policy if exists "club_photos_delete" on public.club_photos;

-- lectura pública (la galería del club se muestra a cualquiera)
create policy "club_photos_select"
    on public.club_photos for select
    using (true);

-- subir foto: solo admins del club, y registrando quién la subió
create policy "club_photos_insert"
    on public.club_photos for insert
    with check (
        uploaded_by = auth.uid()
        and exists (
            select 1 from public.club_members m
            where m.club_id = club_id
              and m.user_id = auth.uid()
              and m.rol = 'admin'
        )
    );

-- borrar foto: solo admins del club
create policy "club_photos_delete"
    on public.club_photos for delete
    using (
        exists (
            select 1 from public.club_members m
            where m.club_id = club_id
              and m.user_id = auth.uid()
              and m.rol = 'admin'
        )
    );

-- 3. BUCKET: club-gallery (espejo de club-logos) ------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('club-gallery', 'club-gallery', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do nothing;

drop policy if exists "club_gallery_public_read" on storage.objects;
create policy "club_gallery_public_read"
    on storage.objects for select
    using (bucket_id = 'club-gallery');

-- subida/borrado: solo admins del club (primer segmento del path = club_id)
drop policy if exists "club_gallery_admin_upload" on storage.objects;
create policy "club_gallery_admin_upload"
    on storage.objects for insert
    with check (
        bucket_id = 'club-gallery'
        and exists (
            select 1 from public.club_members m
            where m.club_id::text = (storage.foldername(name))[1]
              and m.user_id = auth.uid()
              and m.rol = 'admin'
        )
    );

drop policy if exists "club_gallery_admin_delete" on storage.objects;
create policy "club_gallery_admin_delete"
    on storage.objects for delete
    using (
        bucket_id = 'club-gallery'
        and exists (
            select 1 from public.club_members m
            where m.club_id::text = (storage.foldername(name))[1]
              and m.user_id = auth.uid()
              and m.rol = 'admin'
        )
    );
