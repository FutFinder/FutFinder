-- =============================================================
-- 185. LAS ESCRITURAS DIRECTAS QUE SOBRABAN
--
-- Revisión de seguridad del 2026-10-02. Cuatro de los cinco agujeros se
-- REPRODUJERON contra producción, con cuentas de prueba y dentro de una
-- transacción abortada, antes de escribir esto. Todos tienen la misma
-- raíz: una política de UPDATE sin `with check` (o con uno que sólo mira
-- el estado) y `authenticated` con UPDATE sobre TODAS las columnas. La
-- política decide QUÉ FILA se toca; lo que se le escribe adentro lo deja
-- pasar entero. Es la misma lección de la 129 en `clubs`, repetida en
-- otras tablas.
--
-- 1. AMISTAD FORZADA (`friendships`). `friendships_update_addressee` deja
--    actualizar la fila al destinatario, y sin `with check` la fila nueva
--    sólo tiene que seguir teniéndolo a él de destinatario. Con una
--    solicitud pendiente cualquiera —por ejemplo, de una segunda cuenta
--    propia— se cambiaba `requester_id` por el de CUALQUIER persona y
--    `status` por 'accepted': amistad con alguien que nunca la pidió, aunque
--    tuviera «nadie puede enviarme solicitudes» o lo hubiera bloqueado. Con
--    eso se abre el DM (`chat_are_friends`) y todo lo que se ve «sólo entre
--    amigos». Ahora el cliente sólo escribe `status` y `responded_at`, que
--    es lo único que manda `services/friends.js`.
--
-- 2. FOTOS DE CUALQUIER CLUB (`club_photos`). Las políticas de insert y
--    delete comparaban `m.club_id = m.club_id` —la columna contra sí
--    misma, siempre verdadero—, así que bastaba administrar UN club
--    cualquiera, y cualquiera puede crear uno, para subir fotos a la
--    galería de otro club y borrarle todas las suyas. Es la misma
--    auto-referencia sin calificar que ya se corrigió en `club_members`
--    (18, 20 y 90). Ahora compara contra `club_photos.club_id`.
--
-- 3. ACEPTAR TU PROPIO DESAFÍO (`club_challenges`). `club_challenges_update`
--    deja actualizar a los administradores de los DOS clubes, sin
--    `with check` y sobre todas las columnas: el club que retaba se ponía
--    `estado = 'aceptado'` a sí mismo —con `respondido_por` del rival si
--    quería—, o cambiaba `club_retado_id`, `creado_por` o los cupos. Aceptar
--    va por la RPC `aceptar_desafio`; lo que el cliente escribe directo es
--    rechazar (el retado), cancelar (el retador) y enlazar el partido
--    publicado (`linkChallengeMatch`). Ahora sólo puede escribir esas cuatro
--    columnas, y un trigger exige quién hace cada cosa.
--
-- 4. PUBLICAR A NOMBRE DE OTRO CLUB (`club_open_challenges`). El
--    `with check` de `club_open_challenges_update` sólo mira el estado, así
--    que quien tenía `pubChallenge` en su club movía su publicación a
--    `club_id` de cualquier otro club: aparecía en el tablero como si la
--    hubiera publicado ese club, y las respuestas le llegaban a él. Ahora
--    el cliente sólo escribe las cinco columnas que manda
--    `services/clubOpenChallenges.js`.
--
-- 5. `profile-gallery` SIN LÍMITES (Storage). Era el único bucket sin tope
--    de tamaño ni tipos permitidos: cualquier cuenta subía a su carpeta un
--    archivo de cualquier tamaño y tipo —HTML, ejecutables— y quedaba
--    servido en público desde el dominio del proyecto. Queda igual que los
--    demás: 5 MB e imágenes. Lo que ya está subido son 10 imágenes JPEG y
--    PNG de menos de 5 MB, así que nada queda fuera.
--
-- Las RPC que mueven estas tablas son todas `security definer` con dueño
-- `postgres` (se comprobó en producción), así que corren como `postgres`:
-- ni el recorte de columnas ni el trigger nuevo las alcanzan. El trigger
-- sólo actúa cuando quien escribe es el cliente (`authenticated`).
--
-- Idempotente: seguro de re-ejecutar.
-- Pruebas: supabase/tests/185_las_escrituras_directas_que_sobraban_test.sql
-- =============================================================

-- ── 1. friendships ─────────────────────────────────────────────
revoke update on public.friendships from authenticated, anon;
grant update (status, responded_at) on public.friendships to authenticated;

-- ── 2. club_photos ─────────────────────────────────────────────
drop policy if exists club_photos_insert on public.club_photos;
create policy club_photos_insert on public.club_photos
  for insert with check (
    uploaded_by = auth.uid()
    and exists (
      select 1 from public.club_members m
       where m.club_id = club_photos.club_id
         and m.user_id = auth.uid()
         and m.rol = 'admin'
    )
  );

drop policy if exists club_photos_delete on public.club_photos;
create policy club_photos_delete on public.club_photos
  for delete using (
    exists (
      select 1 from public.club_members m
       where m.club_id = club_photos.club_id
         and m.user_id = auth.uid()
         and m.rol = 'admin'
    )
  );

-- Sin política de UPDATE nadie podía actualizar filas, pero el privilegio
-- estaba concedido: se retira para que no dependa de que nadie agregue una.
revoke update on public.club_photos from authenticated, anon;

-- ── 3. club_challenges ─────────────────────────────────────────
revoke update on public.club_challenges from authenticated, anon;
grant update (estado, responded_at, respondido_por, match_id)
  on public.club_challenges to authenticated;

create or replace function public.club_challenges_escritura_directa()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    -- Las RPC son `security definer` y corren como su dueño: sólo se
    -- vigila lo que escribe el cliente.
    if current_user not in ('authenticated', 'anon') then
        return new;
    end if;

    if new.estado is distinct from old.estado then
        if old.estado <> 'pendiente' then
            raise exception 'Este desafío ya no está pendiente'
                using errcode = '42501';
        end if;

        if new.estado = 'rechazado' then
            if not public.tiene_permiso_de_club(old.club_retado_id, auth.uid(), 'answerChallenge') then
                raise exception 'Sólo el club desafiado puede rechazar el desafío'
                    using errcode = '42501';
            end if;
        elsif new.estado = 'cancelado' then
            if not public.tiene_permiso_de_club(old.club_retador_id, auth.uid(), 'pubChallenge') then
                raise exception 'Sólo el club que desafió puede cancelar el desafío'
                    using errcode = '42501';
            end if;
        else
            -- Aceptar y todo lo demás va por su RPC.
            raise exception 'Ese cambio de estado no se hace desde aquí'
                using errcode = '42501';
        end if;
    end if;

    if new.respondido_por is distinct from old.respondido_por
       and new.respondido_por is distinct from auth.uid() then
        raise exception 'Sólo puedes responder a tu nombre'
            using errcode = '42501';
    end if;

    if new.match_id is distinct from old.match_id then
        if old.match_id is not null
           or new.match_id is null
           or not exists (
               select 1 from public.matches
                where id = new.match_id
                  and id_organizador = auth.uid()
           ) then
            raise exception 'Sólo puedes enlazar un partido que organizas tú'
                using errcode = '42501';
        end if;
    end if;

    return new;
end;
$$;

revoke execute on function public.club_challenges_escritura_directa() from public, anon, authenticated;

drop trigger if exists trg_club_challenges_escritura_directa on public.club_challenges;
create trigger trg_club_challenges_escritura_directa
    before update on public.club_challenges
    for each row execute function public.club_challenges_escritura_directa();

-- ── 4. club_open_challenges ────────────────────────────────────
revoke update on public.club_open_challenges from authenticated, anon;
grant update (modalidad, fecha_propuesta, zona, mensaje, estado)
  on public.club_open_challenges to authenticated;

-- ── 5. profile-gallery ─────────────────────────────────────────
update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
 where id = 'profile-gallery';
