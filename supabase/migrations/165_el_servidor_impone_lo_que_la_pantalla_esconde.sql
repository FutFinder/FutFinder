-- 165. El servidor impone lo que la pantalla sólo esconde.
--
-- Revisión «¿hay permisos que sólo se imponen en la interfaz?» (2026-11-05).
-- Se recorrieron todas las tablas de `public` (privilegios por columna,
-- políticas, disparadores) y todas las funciones `security definer` que
-- `authenticated` puede ejecutar. Todas las tablas tienen RLS y
-- las de reservas/recintos/moderación no tienen políticas de escritura (se
-- entra por RPC): ahí no había nada. Lo que SÍ había era un patrón repetido,
-- el de la 129: una política autoriza la FILA, pero `authenticated` tiene
-- UPDATE sobre TODAS las columnas, así que quien puede tocar la fila puede
-- tocar lo que la pantalla nunca le ofrece. Todo lo de abajo se reprodujo
-- con la API de tablas (clave pública + sesión) antes de cerrarse; el
-- arnés lo vuelve a reproducir contra la base sin esta migración.
--
--   A. club_photos — el administrador de CUALQUIER club escribía en la
--      galería de TODOS. Las políticas decían `m.club_id = m.club_id`: dentro
--      del subselect, `club_id` sin calificar se resolvía contra el propio `m`
--      y la condición era una tautología. Bastaba ser admin de algún club.
--
--   B. ratings — la política dice «actualizar el comentario propio» pero el
--      privilegio era sobre todas las columnas: quien calificó podía cambiar
--      `rated_id` (calificar a quien no jugó con él, saltándose la regla de
--      elegibilidad del INSERT) y los puntajes, y lo único que corre al
--      actualizar es el recálculo del TrueScore. Sólo `comentario`.
--
--   C. friendships — el INSERT no miraba `status`: una solicitud podía nacer
--      `accepted`, o sea una amistad sin el consentimiento de la otra
--      persona, que abre el chat directo (`chat_are_friends`). Y el
--      destinatario, al aceptar, podía reescribir `requester_id`: aceptar
--      una amistad «de» un tercero. Ahora el INSERT exige `pending` (la app
--      ya lo manda así: no rompe a nadie) y el UPDATE sólo toca `status` y
--      `responded_at`.
--
--   D. matches — el organizador tenía UPDATE sobre las 40+ columnas:
--      `reserva_id`, `club_local_id`, `club_visitante_id`, `challenge_id`,
--      `challenge_proposal_id`, `client_token`, `reminder_sent_at`…
--      `updateMatch` ya manda sólo una lista cerrada de 24 columnas; ahora
--      el privilegio es esa misma lista y ninguna más.
--
--   E. club_challenges — cualquier integrante con permiso de uno de los dos
--      clubes podía, por la API, ponerle `estado = 'aceptado'` a su propio
--      desafío (sin que el rival respondiera), cambiar quién es el rival o
--      reescribir el partido vinculado. Las respuestas reales pasan por RPC
--      `security definer` (esas no se tocan); lo que la app escribe directo
--      es sólo rechazar, cancelar y vincular el partido. Se deja exactamente
--      eso: privilegio por columna + un trigger que, SÓLO para el rol
--      `authenticated`, limita las transiciones a pendiente→rechazado (por
--      el club retado) y pendiente→cancelado (por el retador), y deja
--      vincular el partido una vez.
--
--   F. notifications — el dueño podía reescribir título, cuerpo y `data`
--      (el destino al tocar el aviso) y reiniciar `push_status`. La app sólo
--      marca `read`.
--
--   G. count_reports_against — la interfaz dice «el detalle es privado: sólo
--      el dueño de la cuenta lo ve» y lo esconde, pero la RPC le contaba a
--      cualquiera cuántos reportes pendientes tiene cualquier persona. Ahora
--      responde sólo a la propia persona y a quien modera; al resto, 0 (que
--      es lo que ya recibe una app vieja si la RPC falla, así que no se
--      rompe nada).
--
--   H. Tres funciones `security definer` que sólo usan otras funciones
--      `security definer` (el mismo caso de la 140): `_sembrar_permisos_
--      actuales`, `recalc_user_ratings` y `cuota_de_reserva`. Quien las
--      llama corre como `postgres`; ningún cliente las necesita.
--
-- NADA ACÁ ROMPE UNA APP YA INSTALADA, y eso se verificó contra el código:
-- cada escritura directa del cliente a estas tablas usa sólo las columnas
-- que se conservan (`updateMatch` con su lista cerrada, `acceptFriendRequest`
-- y `rejectFriendRequest`, `respondChallenge`, `cancelChallenge`,
-- `linkChallengeMatch`, `markNotificationRead`, el INSERT de amistad con
-- `status: 'pending'`). No hay `upsert` sobre ninguna de las seis tablas.
--
-- Idempotente: seguro de re-ejecutar.
-- Pruebas: supabase/tests/165_el_servidor_impone_lo_que_la_pantalla_esconde_test.sql

-- ── A. La galería de fotos del club ──────────────────────────────
drop policy if exists club_photos_insert on public.club_photos;
create policy club_photos_insert on public.club_photos
  for insert
  with check (
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
  for delete
  using (
    exists (
      select 1 from public.club_members m
       where m.club_id = club_photos.club_id
         and m.user_id = auth.uid()
         and m.rol = 'admin'
    )
  );

-- ── B. Calificaciones: sólo el comentario se edita ───────────────
revoke update on public.ratings from authenticated;
grant update (comentario) on public.ratings to authenticated;

-- ── C. Amistades ─────────────────────────────────────────────────
drop policy if exists friendships_insert on public.friendships;
create policy friendships_insert on public.friendships
  for insert
  with check (
    auth.uid() = requester_id
    and status = 'pending'
    and public.perfil_acepta_solicitudes(addressee_id)
    and not public.is_blocked_pair(requester_id, addressee_id)
  );

revoke update on public.friendships from authenticated;
grant update (status, responded_at) on public.friendships to authenticated;

-- ── D. Partidos: el privilegio es la lista que ya manda `updateMatch` ──
revoke update on public.matches from authenticated;
grant update (
  titulo, region, comuna, cancha_nombre, direccion,
  latitud, longitud, hora,
  cupos_totales, cupos_disponibles,
  precio_cuota, nivel, descripcion, estado, foto_url,
  duracion_min, aprobacion, min_trust_score,
  modalidad, edad_min, edad_max,
  recordatorio_1h, pedir_asistencia, motivo_cancelacion
) on public.matches to authenticated;

-- ── E. Desafíos: lo que la app escribe directo, y nada más ───────
revoke update on public.club_challenges from authenticated;
grant update (estado, responded_at, respondido_por, match_id)
  on public.club_challenges to authenticated;

-- Invoker y sin `security definer`, a propósito: `current_user` tiene que
-- ser quien llama. Las RPC (dueñas `postgres`) pasan de largo, igual que en
-- `tg_matches_truescore_protegido`.
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

  return new;
end;
$$;

revoke all on function public.club_challenges_transiciones_directas() from public, anon, authenticated;

drop trigger if exists trg_club_challenges_transiciones_directas on public.club_challenges;
create trigger trg_club_challenges_transiciones_directas
  before update on public.club_challenges
  for each row
  execute function public.club_challenges_transiciones_directas();

-- ── F. Notificaciones: el dueño sólo marca «leída» ───────────────
revoke update on public.notifications from authenticated;
grant update (read) on public.notifications to authenticated;

-- ── G. El conteo de reportes es de la propia persona y de moderación ──
create or replace function public.count_reports_against(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is not null
     and (auth.uid() = p_user_id or public.es_moderador())
    then (
      select count(*)::integer
        from public.user_reports
       where reported_id = p_user_id and estado = 'pendiente'
    )
    else 0
  end;
$$;

revoke all on function public.count_reports_against(uuid) from public, anon;
grant execute on function public.count_reports_against(uuid) to authenticated;

-- ── H. Funciones que sólo usan otras funciones ───────────────────
revoke all on function public._sembrar_permisos_actuales(uuid) from public, anon, authenticated;
revoke all on function public.recalc_user_ratings(uuid) from public, anon, authenticated;
revoke all on function public.cuota_de_reserva(uuid, uuid) from public, anon, authenticated;
