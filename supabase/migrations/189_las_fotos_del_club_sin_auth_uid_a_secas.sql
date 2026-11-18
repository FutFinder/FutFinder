-- 189. Las políticas de `club_photos` vuelven a `(select auth.uid())`.
--
-- La 185 (aplicada el 2026-11-18) recreó `club_photos_insert` y
-- `club_photos_delete` con `auth.uid()` a secas. La 170 las había dejado
-- con `(select auth.uid())`, que Postgres evalúa una vez por consulta y no
-- una vez por fila; su arnés (E1, «ninguna política llama auth.uid() a
-- secas») lo vigila y el CI de «Arneses SQL» quedó en rojo desde entonces.
-- Es sólo rendimiento: quién puede subir y borrar no cambia. El archivo de
-- la 185 ya trae la forma buena para las bases nuevas; esto corrige la que
-- ya la tiene aplicada.
--
-- Idempotente.

drop policy if exists club_photos_insert on public.club_photos;
create policy club_photos_insert on public.club_photos
  for insert with check (
    uploaded_by = (select auth.uid())
    and exists (
      select 1 from public.club_members m
       where m.club_id = club_photos.club_id
         and m.user_id = (select auth.uid())
         and m.rol = 'admin'
    )
  );

drop policy if exists club_photos_delete on public.club_photos;
create policy club_photos_delete on public.club_photos
  for delete using (
    exists (
      select 1 from public.club_members m
       where m.club_id = club_photos.club_id
         and m.user_id = (select auth.uid())
         and m.rol = 'admin'
    )
  );
