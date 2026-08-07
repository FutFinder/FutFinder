-- =============================================================
-- FutFinder migration 35: hace efectiva la preferencia
--   privacy_friend_requests al enviar solicitudes de amistad.
--
-- Antes de esta migración la columna profiles.privacy_friend_requests
-- (migración 21) sólo se guardaba desde Ajustes, pero nada la leía:
-- cualquiera podía insertar en `friendships` sin importar si el
-- destinatario tenía "Nadie" seleccionado.
--
-- La política de INSERT ahora exige, además de que el solicitante sea
-- quien dice ser, que el destinatario acepte solicitudes. Al vivir en
-- RLS (no en la app), esto también bloquea un insert hecho a mano
-- contra Supabase saltándose la UI/el service layer.
-- =============================================================
-- Pega esto en Supabase → SQL Editor → New query → Run.
-- =============================================================

drop policy if exists "friendships_insert" on public.friendships;
create policy "friendships_insert" on public.friendships for insert
    with check (
        auth.uid() = requester_id
        and exists (
            select 1 from public.profiles p
            where p.id = addressee_id
              and p.privacy_friend_requests <> 'nobody'
        )
    );
