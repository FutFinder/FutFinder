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
-- Al aplicarla (2026-11-18) la 165 ya había hecho casi todo esto: UPDATE
-- sólo sobre estas cuatro columnas y el disparador
-- `club_challenges_transiciones_directas`, que vigila quién rechaza, quién
-- cancela y quién firma. Esta migración traía un segundo disparador casi
-- igual; en vez de tener dos, se extiende el de la 165 con lo único que le
-- faltaba: el partido que se enlaza tiene que existir y organizarlo quien
-- enlaza (la app lo enlaza justo después de publicarlo, en
-- `PublishMatchScreen`, así que siempre es suyo).
revoke update on public.club_challenges from authenticated, anon;
grant update (estado, responded_at, respondido_por, match_id)
  on public.club_challenges to authenticated;

create or replace function public.club_challenges_transiciones_directas()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if new.estado is distinct from old.estado then
    if old.estado = 'pendiente' and new.estado = 'rechazado' then
      -- Rechaza el club retado, con el permiso de responder.
      if not public.tiene_permiso_de_club(old.club_retado_id, auth.uid(), 'answerChallenge') then
        raise exception 'Sólo el club desafiado puede rechazar el desafío'
          using errcode = 'insufficient_privilege';
      end if;
    elsif old.estado = 'pendiente' and new.estado = 'cancelado' then
      -- Cancela el club retador, con el permiso de publicar.
      if not public.tiene_permiso_de_club(old.club_retador_id, auth.uid(), 'pubChallenge') then
        raise exception 'Sólo el club que lanzó el desafío puede cancelarlo'
          using errcode = 'insufficient_privilege';
      end if;
    else
      raise exception 'Ese cambio de estado del desafío sólo lo hace el servidor'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if new.respondido_por is distinct from old.respondido_por
     and new.respondido_por is distinct from auth.uid() then
    raise exception 'La respuesta del desafío sólo puede firmarla quien responde'
      using errcode = 'insufficient_privilege';
  end if;

  -- El partido se vincula una vez: ni se cambia ni se suelta.
  if new.match_id is distinct from old.match_id and old.match_id is not null then
    raise exception 'El partido de este desafío ya está vinculado'
      using errcode = 'insufficient_privilege';
  end if;

  -- Y sólo con un partido que organiza quien lo vincula (185).
  if new.match_id is distinct from old.match_id
     and not exists (
       select 1 from public.matches
        where id = new.match_id
          and id_organizador = auth.uid()
     ) then
    raise exception 'Sólo puedes enlazar un partido que organizas tú'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

revoke all on function public.club_challenges_transiciones_directas() from public, anon, authenticated;

-- El segundo disparador que traía la versión anterior de este archivo: si
-- alguna base local lo alcanzó a crear, se quita.
drop trigger if exists trg_club_challenges_escritura_directa on public.club_challenges;
drop function if exists public.club_challenges_escritura_directa();

-- ── 4. club_open_challenges ────────────────────────────────────
revoke update on public.club_open_challenges from authenticated, anon;
grant update (modalidad, fecha_propuesta, zona, mensaje, estado)
  on public.club_open_challenges to authenticated;

-- ── 5. profile-gallery ─────────────────────────────────────────
update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
 where id = 'profile-gallery';
