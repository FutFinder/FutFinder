-- =============================================================
-- FutFinder migration 08: fotos de perfil + portada de partidos
-- =============================================================
-- Pega esto en Supabase → SQL Editor → New query → Run.
-- =============================================================

-- 1. matches.foto_url (portada del partido)
alter table public.matches
    add column if not exists foto_url text;

-- 2. Crear los buckets en Storage. Si ya existen no se duplican.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
    ('avatars', 'avatars', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif']),
    ('match-covers', 'match-covers', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do nothing;

-- 3. Políticas RLS sobre storage.objects ----------------------

-- avatars: cualquiera ve, solo el dueño escribe en su carpeta
drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read"
    on storage.objects for select
    using (bucket_id = 'avatars');

drop policy if exists "avatars_owner_upload" on storage.objects;
create policy "avatars_owner_upload"
    on storage.objects for insert
    with check (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

drop policy if exists "avatars_owner_update" on storage.objects;
create policy "avatars_owner_update"
    on storage.objects for update
    using (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

drop policy if exists "avatars_owner_delete" on storage.objects;
create policy "avatars_owner_delete"
    on storage.objects for delete
    using (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

-- match-covers: cualquiera ve, solo el organizador escribe
drop policy if exists "match_covers_public_read" on storage.objects;
create policy "match_covers_public_read"
    on storage.objects for select
    using (bucket_id = 'match-covers');

drop policy if exists "match_covers_organizer_upload" on storage.objects;
create policy "match_covers_organizer_upload"
    on storage.objects for insert
    with check (
        bucket_id = 'match-covers'
        and exists (
            select 1 from public.matches m
            where m.id::text = (storage.foldername(name))[1]
              and m.id_organizador = auth.uid()
        )
    );

drop policy if exists "match_covers_organizer_update" on storage.objects;
create policy "match_covers_organizer_update"
    on storage.objects for update
    using (
        bucket_id = 'match-covers'
        and exists (
            select 1 from public.matches m
            where m.id::text = (storage.foldername(name))[1]
              and m.id_organizador = auth.uid()
        )
    );

drop policy if exists "match_covers_organizer_delete" on storage.objects;
create policy "match_covers_organizer_delete"
    on storage.objects for delete
    using (
        bucket_id = 'match-covers'
        and exists (
            select 1 from public.matches m
            where m.id::text = (storage.foldername(name))[1]
              and m.id_organizador = auth.uid()
        )
    );
