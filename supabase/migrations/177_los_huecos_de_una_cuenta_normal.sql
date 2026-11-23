-- =============================================================
-- 177. LOS HUECOS QUE SE ABREN CON UNA CUENTA NORMAL
--
-- La auditoría de lanzamiento del 2026-11-13 encontró, contra producción,
-- cosas que cualquiera con una cuenta (o sólo con la clave publicable) podía
-- hacer saltándose la app. Ninguna necesita nada raro: basta PostgREST.
--
--   1. QUIEN FUE BLOQUEADO SE DESBLOQUEA SOLO. `friendships_update_addressee`
--      no tiene WITH CHECK ni hay disparador de transiciones: el destinatario
--      de una amistad bloqueada hace `status = 'accepted'` y vuelve a escribir
--      por mensaje directo. Y `messages_insert`/`messages_read` no miran
--      `is_blocked_pair`: un bloqueo tampoco cortaba el DM de un desafío.
--   2. EL ALTA DE PARTIDOS ACEPTA CUALQUIER COLUMNA. Con un `reserva_id`
--      ajeno y un `cancel_match` se cancelaba la reserva de otra persona (el
--      disparador de la 100 la suelta); con `club_local_id` de un club ajeno
--      se lo comprometía a un encuentro; y se podía nacer `finalizado`.
--   3. EL TABLERO DE DESAFÍOS ABIERTOS DEJA REESCRIBIR LA FILA ENTERA: una
--      respuesta podía cambiar su `club_id` por otro club, y una publicación
--      cerrada se podía reabrir.
--   4. QUIEN ENTRÓ POR INVITACIÓN VUELVE DESPUÉS DE QUE LO EXPULSAN:
--      `approved → pending → approved` en su propia invitación.
--   5. LOS BUCKETS PÚBLICOS SE LISTAN SIN CUENTA. Un bucket público sirve
--      cada archivo por su URL sin pasar por políticas; la política SELECT
--      `using (bucket_id = …)` sólo servía para LISTAR, y listar
--      `profile-gallery` entregaba el uuid de todas las cuentas, también las
--      ocultas. Ahora cada uno lista lo suyo (que es lo que necesitan
--      `remove` y `upsert`).
--   6. LA VERIFICACIÓN EN DOS PASOS ERA SÓLO DE LA APP. Con la contraseña
--      sola se obtiene una sesión `aal1`, que la app no deja pasar… pero
--      PostgREST sí. Ahora, a quien tiene un factor verificado, la API le
--      exige `aal2` en cada petición (pre-request de PostgREST), en el tiempo
--      real y en Storage. A quien no tiene factor no le cambia nada (hoy:
--      todas las cuentas).
--   7. MENORES DESCUBRIBLES POR DEFECTO, Y LA EDAD SE CAMBIA A GUSTO. Quien
--      tiene menos de 18 no aparece en búsquedas (Ley 21.719: privacidad por
--      defecto para menores), y la edad, una vez puesta, no la cambia el
--      cliente: era la forma de saltarse el rango de edad de un partido.
--   8. `complejo_calificaciones` se leía sin cuenta (quién reservó dónde).
--
-- Compatibilidad con las apps instaladas (no hay OTA): las columnas que se
-- dejan de conceder son SÓLO las que el cliente no manda. `createMatch`
-- manda `club_local_id`, `club_visitante_id` y `challenge_id` (en nulo casi
-- siempre): siguen concedidas y las valida un disparador.
--
-- Pruebas: supabase/tests/177_los_huecos_de_una_cuenta_normal_test.sql
-- =============================================================

-- ── 1. El bloqueo se respeta ─────────────────────────────────────

create or replace function public.friendships_transiciones()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Las RPC (bloquear, desbloquear) corren como su dueño: no pasan por acá.
  if current_user <> 'authenticated' then
    return new;
  end if;
  if new.status is distinct from old.status then
    if not (old.status = 'pending' and new.status in ('accepted', 'rejected')) then
      raise exception 'Ese cambio de la amistad sólo lo hace el servidor'
        using errcode = '42501';
    end if;
    if new.status = 'accepted' and public.is_blocked_pair(new.requester_id, new.addressee_id) then
      raise exception 'No puedes aceptar esta solicitud'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_friendships_transiciones on public.friendships;
create trigger trg_friendships_transiciones
  before update on public.friendships
  for each row execute function public.friendships_transiciones();

-- Mensajes directos (amistad o desafío): un par bloqueado no se escribe ni
-- se lee. `is_blocked_pair` contesta la verdad porque quien llama es uno de
-- los dos (171).
alter policy messages_insert on public.messages
  with check (
    ((select auth.uid()) = sender_id)
    and (
      ((receiver_id is not null) and (match_id is null) and (club_id is null)
        and not public.is_blocked_pair(sender_id, receiver_id)
        and (public.chat_are_friends(sender_id, receiver_id) or public.chat_valid_club_challenge_dm(sender_id, receiver_id)))
      or ((match_id is not null) and (receiver_id is null) and (club_id is null)
        and exists (select 1 from public.attendees a
                     where a.id_partido = messages.match_id and a.id_jugador = (select auth.uid())
                       and a.estado = any (array['inscrito', 'confirmado_gps'])))
      or ((club_id is not null) and (receiver_id is null) and (match_id is null)
        and exists (select 1 from public.club_members m
                     where m.club_id = messages.club_id and m.user_id = (select auth.uid())))
      or ((challenge_id is not null) and (receiver_id is null) and (match_id is null) and (club_id is null)
        and public.chat_puede_escribir_desafio(challenge_id, (select auth.uid())))
    )
  );

alter policy messages_read on public.messages
  using (
    ((receiver_id is not null) and (match_id is null) and (club_id is null)
      and (((select auth.uid()) = sender_id) or ((select auth.uid()) = receiver_id))
      and not public.is_blocked_pair(sender_id, receiver_id)
      and (public.chat_are_friends(sender_id, receiver_id) or public.chat_valid_club_challenge_dm(sender_id, receiver_id)))
    or ((match_id is not null)
      and exists (select 1 from public.attendees a
                   where a.id_partido = messages.match_id and a.id_jugador = (select auth.uid())
                     and a.estado = any (array['inscrito', 'confirmado_gps'])))
    or ((club_id is not null)
      and exists (select 1 from public.club_members m
                   where m.club_id = messages.club_id and m.user_id = (select auth.uid())))
    or ((challenge_id is not null) and public.chat_puede_ver_desafio(challenge_id, (select auth.uid())))
  );

-- El tiempo real por Broadcast (175) tampoco le entrega el DM a un par
-- bloqueado. Se parcha el cuerpo desplegado; si la 175 no está (base armada
-- desde un repositorio sin ella), no hay nada que parchar.
do $$
declare
  v_def text;
  v_nuevo text;
begin
  if to_regprocedure('public.chat_destinatarios(public.messages)') is null then
    return;
  end if;
  v_def := pg_get_functiondef('public.chat_destinatarios(public.messages)'::regprocedure);
  if v_def like '%is_blocked_pair%' then
    return;
  end if;
  v_nuevo := replace(v_def,
    'and (public.chat_are_friends(m.sender_id, m.receiver_id)',
    'and not public.is_blocked_pair(m.sender_id, m.receiver_id)
       and (public.chat_are_friends(m.sender_id, m.receiver_id)');
  if v_nuevo = v_def then
    raise exception '177: chat_destinatarios cambió y no se encontró dónde mirar el bloqueo';
  end if;
  execute v_nuevo;
end $$;

-- ── 2. El alta de partidos ───────────────────────────────────────
-- Exactamente lo que manda `createMatch` (src/services/matches.js). Fuera:
-- reserva_id, estado, las de asistencia, cancelación, recordatorios,
-- cupos_por_club, metodo_inscripcion, challenge_proposal_id, foto_url (se
-- pone con UPDATE después de subirla), id y created_at.
revoke insert on public.matches from authenticated;
grant insert (id_organizador, titulo, region, comuna, cancha_nombre, direccion,
              latitud, longitud, hora, cupos_totales, cupos_disponibles, precio_cuota,
              nivel, descripcion, duracion_min, aprobacion, min_trust_score, modalidad,
              edad_min, edad_max, recordatorio_1h, pedir_asistencia,
              club_local_id, club_visitante_id, challenge_id, client_token)
  on public.matches to authenticated;

-- ¿Puede quien llama publicar el partido de este desafío con estos clubes?
-- Aparte y `security definer` para leer membresías y desafíos sin depender
-- de la RLS de quien llama. El disparador NO es definer a propósito: dentro
-- de una función definer, `current_user` es su dueño y no quien llama, y la
-- guarda de `current_user = 'authenticated'` se saltaría siempre.
create or replace function public._puede_publicar_partido_de_desafio(
  p_challenge uuid, p_local uuid, p_visitante uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_challenge is not null
     and exists (select 1 from public.club_challenges c
                  where c.id = p_challenge
                    and c.club_retador_id = p_local
                    and c.club_retado_id = p_visitante)
     and exists (select 1 from public.club_members m
                  where m.user_id = auth.uid() and m.rol = 'admin'
                    and m.club_id in (p_local, p_visitante));
$$;

revoke all on function public._puede_publicar_partido_de_desafio(uuid, uuid, uuid) from public, anon;
grant execute on function public._puede_publicar_partido_de_desafio(uuid, uuid, uuid) to authenticated;

create or replace function public.matches_alta_desde_el_cliente()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if new.cupos_disponibles > new.cupos_totales then
    new.cupos_disponibles := new.cupos_totales;
  end if;

  -- El flujo antiguo de clubes publica el partido de un desafío aceptado:
  -- local = retador, visitante = retado, y lo publica un admin de uno de los
  -- dos. Cualquier otra combinación es suplantar a un club.
  if (new.club_local_id is not null or new.club_visitante_id is not null or new.challenge_id is not null)
     and not public._puede_publicar_partido_de_desafio(new.challenge_id, new.club_local_id, new.club_visitante_id) then
    raise exception 'Sólo un administrador de uno de los dos clubes publica el partido de su desafío'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.matches_alta_desde_el_cliente() from public, anon, authenticated;

drop trigger if exists aa_matches_alta_desde_el_cliente on public.matches;
create trigger aa_matches_alta_desde_el_cliente
  before insert on public.matches
  for each row execute function public.matches_alta_desde_el_cliente();

-- ── 3. El tablero de desafíos abiertos ───────────────────────────
revoke insert, update on public.club_open_challenges from authenticated;
grant insert (club_id, creado_por, modalidad, fecha_propuesta, zona, mensaje)
  on public.club_open_challenges to authenticated;
grant update (modalidad, fecha_propuesta, zona, mensaje, estado)
  on public.club_open_challenges to authenticated;

revoke insert, update on public.club_open_challenge_responses from authenticated;
grant insert (open_challenge_id, club_id, creado_por, mensaje)
  on public.club_open_challenge_responses to authenticated;
grant update (estado) on public.club_open_challenge_responses to authenticated;

create or replace function public.club_open_challenges_transiciones()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if old.estado <> 'abierto' then
    raise exception 'Esta publicación ya está cerrada' using errcode = '42501';
  end if;
  if new.estado is distinct from old.estado and new.estado <> 'cancelado' then
    raise exception 'Una publicación sólo se puede retirar' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_club_open_challenges_transiciones on public.club_open_challenges;
create trigger trg_club_open_challenges_transiciones
  before update on public.club_open_challenges
  for each row execute function public.club_open_challenges_transiciones();

-- No es definer (ver el comentario de `_puede_publicar_partido_de_desafio`).
-- Lee la publicación con la RLS de quien llama: si ya no la puede ver
-- (cerrada y de otro club), tampoco está abierta para él.
create or replace function public.club_open_challenge_responses_transiciones()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  -- Retirar / deshacer (el club que responde) y rechazar / deshacer (el que
  -- publicó). La aceptación la hace `aceptar_respuesta_desafio_abierto`.
  if not ((old.estado = 'pendiente' and new.estado in ('retirada', 'rechazada'))
          or (old.estado in ('retirada', 'rechazada') and new.estado = 'pendiente')) then
    raise exception 'Ese cambio de la respuesta sólo lo hace el servidor' using errcode = '42501';
  end if;
  if new.estado = 'pendiente' and not exists (
       select 1 from public.club_open_challenges oc
        where oc.id = new.open_challenge_id and oc.estado = 'abierto') then
    raise exception 'La publicación ya se cerró' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.club_open_challenge_responses_transiciones() from public, anon, authenticated;

drop trigger if exists trg_club_open_challenge_responses_transiciones on public.club_open_challenge_responses;
create trigger trg_club_open_challenge_responses_transiciones
  before update on public.club_open_challenge_responses
  for each row execute function public.club_open_challenge_responses_transiciones();

-- ── 4. Una invitación respondida no se vuelve a responder ─────────
create or replace function public.club_join_requests_transiciones()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if new.status is distinct from old.status
     and not (old.status = 'pending' and new.status in ('approved', 'rejected')) then
    raise exception 'Esa solicitud ya fue respondida' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Nombre con «a» al frente: corre ANTES de `trg_club_request_approved`, que
-- es el que crea la membresía al pasar a `approved`.
drop trigger if exists a_club_join_requests_transiciones on public.club_join_requests;
create trigger a_club_join_requests_transiciones
  before update of status on public.club_join_requests
  for each row execute function public.club_join_requests_transiciones();

-- ── 5. Los buckets públicos no se listan ─────────────────────────
-- Cada archivo se sigue sirviendo por su URL pública (eso no pasa por
-- políticas). Listar queda para quien puede borrar o reemplazar lo listado.
drop policy if exists avatars_public_read on storage.objects;
drop policy if exists profile_gallery_public_select on storage.objects;
drop policy if exists club_logos_public_read on storage.objects;
drop policy if exists club_gallery_public_read on storage.objects;
drop policy if exists complejo_fotos_public_read on storage.objects;
drop policy if exists match_covers_public_read on storage.objects;

drop policy if exists avatars_owner_select on storage.objects;
create policy avatars_owner_select on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists profile_gallery_owner_select on storage.objects;
create policy profile_gallery_owner_select on storage.objects for select to authenticated
  using (bucket_id = 'profile-gallery' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists club_logos_admin_select on storage.objects;
create policy club_logos_admin_select on storage.objects for select to authenticated
  using (bucket_id = 'club-logos' and exists (
    select 1 from public.club_members m
     where m.club_id::text = (storage.foldername(objects.name))[1]
       and m.user_id = (select auth.uid()) and m.rol = 'admin'));

drop policy if exists club_gallery_admin_select on storage.objects;
create policy club_gallery_admin_select on storage.objects for select to authenticated
  using (bucket_id = 'club-gallery' and exists (
    select 1 from public.club_members m
     where m.club_id::text = (storage.foldername(objects.name))[1]
       and m.user_id = (select auth.uid()) and m.rol = 'admin'));

drop policy if exists complejo_fotos_admin_select on storage.objects;
create policy complejo_fotos_admin_select on storage.objects for select to authenticated
  using (bucket_id = 'complejo-fotos'
         and public.es_admin_complejo(((storage.foldername(name))[1])::uuid));

drop policy if exists match_covers_organizer_select on storage.objects;
create policy match_covers_organizer_select on storage.objects for select to authenticated
  using (bucket_id = 'match-covers' and exists (
    select 1 from public.matches m
     where m.id::text = (storage.foldername(objects.name))[1]
       and m.id_organizador = (select auth.uid())));

-- ── 6. La verificación en dos pasos, en el servidor ──────────────
-- ¿Esta sesión cumple? Sí si no hay sesión de usuario (anon, cron, servicio),
-- si ya presentó el código (`aal2`), o si la cuenta no tiene ningún factor
-- verificado. Es lo mismo que la app exige en `AuthContext`.
create or replace function public.mfa_cumplida()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select auth.uid() is null
      or coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f
                      where f.user_id = auth.uid() and f.status = 'verified');
$$;

revoke all on function public.mfa_cumplida() from public;
grant execute on function public.mfa_cumplida() to anon, authenticated;

-- PostgREST la corre antes de CADA petición (tablas y RPC por igual), con
-- el rol y los claims de quien pide. Un solo lugar en vez de 143 funciones.
create or replace function public.exigir_mfa_por_peticion()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' and not public.mfa_cumplida() then
    raise exception 'Verifica tu identidad con el código de tu app de autenticación para continuar.'
      using errcode = '42501', detail = 'MFA_REQUERIDA';
  end if;
end;
$$;

revoke all on function public.exigir_mfa_por_peticion() from public;
grant execute on function public.exigir_mfa_por_peticion() to anon, authenticated;

alter role authenticator set pgrst.db_pre_request to 'public.exigir_mfa_por_peticion';
notify pgrst, 'reload config';

-- El tiempo real no pasa por PostgREST: lo cubren políticas RESTRICTIVAS en
-- las tablas publicadas y en el canal de Broadcast del chat (175).
do $$
declare
  t text;
begin
  foreach t in array array['messages', 'notifications', 'attendees'] loop
    execute format('drop policy if exists mfa_exigida on public.%I', t);
    execute format('create policy mfa_exigida on public.%I as restrictive for select to authenticated using ((select public.mfa_cumplida()))', t);
  end loop;
  if exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages'
              and policyname = 'chat_cada_uno_escucha_su_topic') then
    alter policy chat_cada_uno_escucha_su_topic on realtime.messages
      using (realtime.messages.extension = 'broadcast'
             and (select realtime.topic()) = 'chat:' || (select auth.uid())::text
             and (select public.mfa_cumplida()));
  end if;
end $$;

-- Storage tampoco pasa por PostgREST.
drop policy if exists mfa_exigida on storage.objects;
create policy mfa_exigida on storage.objects as restrictive for all to authenticated
  using ((select public.mfa_cumplida()))
  with check ((select public.mfa_cumplida()));

-- ── 7. Menores y edad ────────────────────────────────────────────
create or replace function public.perfil_edad_y_menores()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and current_user = 'authenticated'
     and old.edad is not null and new.edad is distinct from old.edad then
    raise exception 'Tu edad ya quedó registrada. Si está mal, escríbenos a futfindercl@gmail.com.'
      using errcode = '42501';
  end if;

  if new.edad is not null and new.edad < 18 then
    if tg_op = 'UPDATE' and current_user = 'authenticated'
       and new.privacy_visible_in_search and not coalesce(old.privacy_visible_in_search, false)
       and new.edad is not distinct from old.edad then
      raise exception 'Las cuentas de menores de 18 años no aparecen en las búsquedas.'
        using errcode = '42501';
    end if;
    new.privacy_visible_in_search := false;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_perfil_edad_y_menores on public.profiles;
create trigger trg_perfil_edad_y_menores
  before insert or update of edad, privacy_visible_in_search on public.profiles
  for each row execute function public.perfil_edad_y_menores();

update public.profiles
   set privacy_visible_in_search = false
 where edad < 18 and privacy_visible_in_search;

-- ── 8. Las calificaciones de recintos, sólo con cuenta ───────────
alter policy complejo_calificaciones_select on public.complejo_calificaciones to authenticated;
