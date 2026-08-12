-- =============================================================
-- FutFinder — migración 44: aprobación del rival y publicación
-- atómica del partido de clubes.
--
-- QUÉ HACE: aprobar la propuesta oficial es el único momento en que
-- nace un partido de clubes. `aprobar_propuesta()` verifica, publica y
-- avisa dentro de UNA transacción; si algo falla, no queda ni el
-- partido ni el cambio de estado ni el aviso.
--
-- LAS TRES GARANTÍAS, Y DÓNDE VIVEN:
--
--   1. UN SOLO PARTIDO. `matches.challenge_proposal_id` es UNIQUE. No
--      es una comprobación dentro de la función —que dos sesiones
--      simultáneas podrían pasar las dos— sino un índice: la segunda
--      inserción la rechaza PostgreSQL.
--   2. IDEMPOTENCIA. `update ... where estado = 'pendiente'` sobre la
--      propuesta. Si no mueve ninguna fila, la propuesta ya estaba
--      aprobada y se devuelve el partido que ya existe, sin error y sin
--      efectos nuevos. Doble pulsación = un partido, un evento, un
--      aviso.
--   3. NADIE APRUEBA EN NOMBRE DEL RIVAL. Dos condiciones, no una: hay
--      que ser administrador de un club del desafío DISTINTO al
--      proponente, y además NO pertenecer al club proponente en ningún
--      rol. La segunda es la que cierra el caso de quien administra los
--      dos clubes: sin ella, la consulta encontraría igual el club
--      contrario y lo dejaría aprobarse a sí mismo.
--
-- SOBRE `revoke`: `revoke ... from anon` NO quita el EXECUTE que
-- PostgreSQL concede a PUBLIC por defecto. Se revoca de `public`, que
-- es lo que cerró la migración 42b después de que el advisor de
-- Supabase lo marcara.
--
-- COMPATIBILIDAD: un partido que no viene de un desafío tiene
-- `challenge_proposal_id` en NULL y no cambia en nada. La única
-- función existente que se toca es el trigger
-- `add_organizer_as_attendee`, y sólo para que NO se dispare en los
-- partidos de clubes (ver sección 5).
-- =============================================================

-- ── 1. COLUMNAS DEL PARTIDO DE CLUBES ───────────────────────────
-- `cupos_por_club` es el número por equipo; `cupos_totales` sigue
-- siendo el total (el doble) y conserva exactamente el significado que
-- ya tenía para el resto de la app.
alter table public.matches
    add column if not exists cupos_por_club integer;
alter table public.matches
    add column if not exists metodo_inscripcion text;

-- La unicidad ES la garantía de que no hay partido duplicado.
alter table public.matches
    add column if not exists challenge_proposal_id uuid
        references public.club_challenge_proposals(id) on delete set null;

drop index if exists matches_challenge_proposal_uidx;
create unique index matches_challenge_proposal_uidx
    on public.matches (challenge_proposal_id)
    where challenge_proposal_id is not null;

alter table public.matches
    drop constraint if exists matches_cupos_por_club_check;
alter table public.matches
    add constraint matches_cupos_por_club_check
    check (cupos_por_club is null or (cupos_por_club >= 4 and cupos_por_club <= 15));

alter table public.matches
    drop constraint if exists matches_metodo_inscripcion_check;
alter table public.matches
    add constraint matches_metodo_inscripcion_check
    check (metodo_inscripcion is null
           or metodo_inscripcion in ('orden_llegada', 'seleccion_admin'));

-- ── 2. EL CLUB DE CADA INSCRITO ─────────────────────────────────
-- Sin esta columna no hay forma de contar cupos POR CLUB: `attendees`
-- sólo sabe de jugadores. Queda NULL en los partidos normales, donde
-- no significa nada.
alter table public.attendees
    add column if not exists club_id uuid references public.clubs(id) on delete set null;

-- El índice es el que usa el conteo por club dentro de la transacción
-- de inscripción (migración 45).
create index if not exists idx_attendees_partido_club
    on public.attendees (id_partido, club_id, estado);

-- ── 3. TIPO DE AVISO NUEVO ──────────────────────────────────────
-- `club_match_published` es el aviso que reciben TODOS los integrantes
-- de los dos clubes cuando el partido queda publicado.
alter table public.notifications
    drop constraint if exists notifications_type_check;
alter table public.notifications
    add constraint notifications_type_check
    check (type in (
        'match_join', 'friend_request', 'friend_accept', 'message_new',
        'match_reminder', 'match_rate', 'join_request', 'join_approved',
        'join_rejected', 'match_cancelled', 'match_updated', 'match_slot_free',
        'waitlist_turn', 'match_left', 'match_attendance',
        'club_request', 'club_request_accepted', 'club_request_rejected',
        'club_member_joined', 'club_member_left', 'club_invite_accepted',
        'club_challenge', 'club_challenge_accepted', 'club_challenge_rejected',
        'chat_mention_all',
        'club_challenge_extension', 'club_challenge_closed',
        'club_challenge_proposal', 'club_challenge_proposal_rejected',
        'club_match_published'
    ));

-- ── 4. SANCIONES: MARCADOR PROVISIONAL, NO IMPLEMENTACIÓN ───────
--
--   ⚠️  ESTA FUNCIÓN NO COMPRUEBA NADA. Devuelve `false` siempre.
--
-- LAS SANCIONES DE CLUB NO EXISTEN TODAVÍA. No hay tabla
-- `club_sanctions`, no hay forma de sancionar a un club y por lo tanto
-- no hay nada que consultar. Esto es un marcador de posición para que
-- `aprobar_propuesta()` tenga hoy la llamada en el lugar correcto y la
-- migración 47 sólo tenga que reemplazar el cuerpo, en vez de ir a
-- buscar todos los sitios donde debería haberse preguntado.
--
-- Mientras esto devuelva `false`, un club sancionado PUEDE publicar
-- partidos, porque no se le puede sancionar. No confundir la presencia
-- de esta llamada con una regla que ya funcione: la regla llega en la
-- 47, junto con la tabla.
--
-- No se concede a ninguno de los tres roles del cliente (`public`,
-- `anon`, `authenticated`): sólo se llama desde dentro de funciones
-- `security definer`. Así ninguna pantalla puede empezar a apoyarse en
-- un stub que siempre dice que no. `service_role` conserva su EXECUTE
-- por la configuración por defecto de Supabase; es la llave de
-- servidor, nunca viaja al cliente.
create or replace function public.club_esta_sancionado(p_club_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
    -- TODO(migración 47): consultar `club_sanctions` vigentes del club.
    select false;
$$;

revoke execute on function public.club_esta_sancionado(uuid) from public, anon, authenticated;

comment on function public.club_esta_sancionado(uuid) is
    'PROVISIONAL (migración 44): devuelve false siempre. Las sanciones de club se implementan en la migración 47.';

-- ── 5. EL ORGANIZADOR NO SE AUTOINSCRIBE EN UN PARTIDO DE CLUBES ─
-- `add_organizer_as_attendee` mete al organizador como 'inscrito' en
-- cuanto nace el partido. En un partido de clubes el organizador es el
-- administrador que aprobó, y eso haría tres cosas malas de una vez:
-- lo inscribiría sin que lo haya pedido, le gastaría un cupo a su club
-- y dejaría una fila de `attendees` con `club_id` NULL, que es
-- justamente lo que el conteo por club no sabe contar.
--
-- En los partidos normales el comportamiento no cambia en absoluto.
create or replace function public.add_organizer_as_attendee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    -- Partido de clubes: se entra por `join_club_match`, nunca solo.
    if new.challenge_proposal_id is not null then
        return new;
    end if;

    insert into public.attendees (id_partido, id_jugador, estado)
    values (new.id, new.id_organizador, 'inscrito')
    on conflict (id_partido, id_jugador) do nothing;
    return new;
end;
$$;

-- ── 6. APROBAR LA PROPUESTA Y PUBLICAR EL PARTIDO ───────────────
-- Devuelve el partido publicado. Volver a llamarla con la propuesta ya
-- aprobada devuelve ESE MISMO partido: es un reintento, no un error.
create or replace function public.aprobar_propuesta(p_proposal_id uuid)
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me        uuid := auth.uid();
    v_prop      public.club_challenge_proposals;
    v_row       public.club_challenges;
    v_match     public.matches;
    v_club      uuid;
    v_en_prop   boolean;
    v_local     text;
    v_visita    text;
    v_aprob     text;
begin
    if v_me is null then
        raise exception 'No autenticado' using errcode = '42501';
    end if;

    select * into v_prop
      from public.club_challenge_proposals
     where id = p_proposal_id;

    if not found then
        raise exception 'Esta propuesta ya no existe' using errcode = 'no_data_found';
    end if;

    -- Mismo orden de bloqueo que `crear_propuesta_oficial` y
    -- `rechazar_propuesta`: primero el desafío, después la propuesta.
    -- Si una de las tres lo hiciera al revés, dos administradores
    -- actuando a la vez podrían trabarse mutuamente.
    select * into v_row
      from public.club_challenges
     where id = v_prop.challenge_id
     for update;

    if not found then
        raise exception 'Este desafío ya no existe' using errcode = 'no_data_found';
    end if;

    select * into v_prop
      from public.club_challenge_proposals
     where id = p_proposal_id
     for update;

    -- ── autorización ────────────────────────────────────────────
    -- Condición A: administrador de un club del desafío que NO sea el
    -- proponente.
    select m.club_id into v_club
      from public.club_members m
     where m.user_id = v_me
       and m.rol = 'admin'
       and m.club_id in (v_row.club_retador_id, v_row.club_retado_id)
       and m.club_id <> v_prop.club_proponente_id
     limit 1;

    if v_club is null then
        raise exception 'Solo un administrador del club contrario puede aprobar la propuesta'
            using errcode = '42501';
    end if;

    -- Condición B: no pertenecer al club proponente EN NINGÚN ROL.
    -- Quien está en los dos clubes no puede darse a sí mismo el visto
    -- bueno del rival. El trigger `club_challenges_valida_rival` ya
    -- impide crear el desafío cuando los clubes comparten
    -- administrador, pero las membresías cambian después de creado el
    -- desafío y esto se comprueba en el momento de aprobar.
    select exists (
        select 1 from public.club_members m
         where m.user_id = v_me
           and m.club_id = v_prop.club_proponente_id
    ) into v_en_prop;

    if v_en_prop then
        raise exception 'No puedes aprobar una propuesta de un club al que perteneces'
            using errcode = '42501';
    end if;

    -- ── idempotencia ────────────────────────────────────────────
    -- Se comprueba DESPUÉS de autorizar, por la misma razón que la
    -- migración 43b movió el `client_token`: una salida temprana antes
    -- de mirar `club_members` convierte una función `security definer`
    -- en una filtración para cualquiera que tenga el id.
    if v_prop.estado = 'aprobada' then
        select * into v_match
          from public.matches
         where challenge_proposal_id = v_prop.id;
        if found then
            return v_match;
        end if;
        raise exception 'Esta propuesta figura aprobada pero su partido no existe'
            using errcode = 'internal_error';
    end if;

    if v_prop.estado <> 'pendiente' then
        raise exception 'Esta propuesta ya fue respondida' using errcode = 'check_violation';
    end if;

    if v_row.estado <> 'esperando_aprobacion' then
        raise exception 'Este desafío no está esperando aprobación' using errcode = 'check_violation';
    end if;

    -- ── condiciones para publicar ───────────────────────────────
    if public.club_esta_sancionado(v_row.club_retador_id)
       or public.club_esta_sancionado(v_row.club_retado_id) then
        raise exception 'Uno de los dos clubes está sancionado y no puede publicar partidos'
            using errcode = 'check_violation';
    end if;

    -- El partido nace con la hora de la propuesta, y `matches` tiene un
    -- trigger que rechaza las horas pasadas. Se comprueba acá para dar
    -- el motivo en español en vez de dejar salir el error del trigger.
    if v_prop.fecha <= now() then
        raise exception 'La fecha de la propuesta ya pasó. Pidan cambios y propongan otra'
            using errcode = 'check_violation';
    end if;

    -- `matches.latitud`/`longitud` son NOT NULL y con CHECK de rango.
    -- Desde la 43c ninguna propuesta nueva puede nacer sin coordenadas
    -- válidas, pero esta comprobación no sobra: la 43c es posterior a la
    -- 43, así que puede haber propuestas anteriores sin ubicación, y una
    -- función que publica no debe confiar en que otra validó antes. Se
    -- comprueba el rango además de la nulidad porque el cliente llegó a
    -- enviar 0 y 0 cuando no había ubicación.
    if v_prop.latitud is null or v_prop.longitud is null then
        raise exception 'La propuesta no tiene la cancha ubicada en el mapa. Pidan cambios y vuelvan a proponerla'
            using errcode = 'check_violation';
    end if;
    if v_prop.latitud < -90 or v_prop.latitud > 90
       or v_prop.longitud < -180 or v_prop.longitud > 180 then
        raise exception 'La ubicación de la propuesta no es un punto válido del mapa. Pidan cambios y vuelvan a proponerla'
            using errcode = 'check_violation';
    end if;

    -- ── cierre de la propuesta ──────────────────────────────────
    -- Este `update` es el que serializa: dos aprobaciones simultáneas
    -- compiten por él y sólo una mueve la fila.
    update public.club_challenge_proposals
       set estado         = 'aprobada',
           respondida_por = v_me,
           respondida_at  = now()
     where id = v_prop.id
       and estado = 'pendiente'
    returning * into v_prop;

    if not found then
        raise exception 'Esta propuesta ya fue respondida' using errcode = 'check_violation';
    end if;

    -- Las demás propuestas del desafío que siguieran abiertas quedan
    -- caducadas. El índice parcial impide que haya más de una, así que
    -- esto normalmente no toca nada; está para que un arreglo manual en
    -- la base no deje una propuesta viva sobre un desafío publicado.
    update public.club_challenge_proposals
       set estado = 'caducada'
     where challenge_id = v_row.id
       and id <> v_prop.id
       and estado = 'pendiente';

    -- ── el partido ──────────────────────────────────────────────
    -- El retador es el local: la propuesta no distingue local de
    -- visitante, y los papeles del desafío son la única fuente que hay.
    select nombre into v_local  from public.clubs where id = v_row.club_retador_id;
    select nombre into v_visita from public.clubs where id = v_row.club_retado_id;

    v_aprob := case v_prop.metodo_inscripcion
                   when 'seleccion_admin' then 'manual'
                   else 'inmediata'
               end;

    insert into public.matches (
        id_organizador, titulo, region, comuna, cancha_nombre, direccion,
        latitud, longitud, hora, duracion_min,
        cupos_totales, cupos_disponibles, cupos_por_club,
        precio_cuota, modalidad, descripcion,
        aprobacion, metodo_inscripcion,
        club_local_id, club_visitante_id, challenge_id, challenge_proposal_id
    )
    values (
        v_me,
        coalesce(v_local, 'Club local') || ' vs ' || coalesce(v_visita, 'Club visitante'),
        v_prop.region, v_prop.comuna, v_prop.cancha_nombre, v_prop.direccion,
        v_prop.latitud::numeric(10,7), v_prop.longitud::numeric(10,7),
        v_prop.fecha, v_prop.duracion_min,
        v_prop.cupos_por_club * 2, v_prop.cupos_por_club * 2, v_prop.cupos_por_club,
        v_prop.cuota_por_persona, v_prop.modalidad, v_prop.instrucciones,
        v_aprob, v_prop.metodo_inscripcion,
        v_row.club_retador_id, v_row.club_retado_id, v_row.id, v_prop.id
    )
    returning * into v_match;

    -- ── el desafío pasa a publicado ─────────────────────────────
    update public.club_challenges
       set estado   = 'publicado',
           match_id = v_match.id
     where id = v_row.id
       and estado = 'esperando_aprobacion'
    returning * into v_row;

    if not found then
        raise exception 'Este desafío no está esperando aprobación' using errcode = 'check_violation';
    end if;

    insert into public.club_challenge_events (challenge_id, tipo, actor_id, club_id, payload)
    values (
        v_row.id,
        'partido_publicado',
        v_me,
        v_club,
        jsonb_build_object(
            'proposal_id',    v_prop.id,
            'match_id',       v_match.id,
            'fecha',          v_match.hora,
            'cancha_nombre',  v_match.cancha_nombre,
            'comuna',         v_match.comuna,
            'cupos_por_club', v_match.cupos_por_club
        )
    );

    -- ── aviso a TODOS los integrantes de los dos clubes ─────────
    -- `desafio_avisar()` no sirve acá: filtra por `rol = 'admin'`, y el
    -- partido publicado es justamente lo que tienen que saber los
    -- jugadores para inscribirse. Va con `matchId` para que el aviso
    -- lleve al partido y con `threadKey` para los administradores.
    insert into public.notifications (user_id, type, title, body, data)
    select distinct m.user_id,
           'club_match_published',
           '⚽ ' || coalesce(v_local, 'Club local') || ' vs ' || coalesce(v_visita, 'Club visitante'),
           'El partido ya está publicado. Quedan ' || v_match.cupos_por_club
               || ' cupos por club: entra a inscribirte.',
           jsonb_build_object(
               'challengeId',   v_row.id,
               'clubRetadorId', v_row.club_retador_id,
               'clubRetadoId',  v_row.club_retado_id,
               'matchId',       v_match.id,
               'proposalId',    v_prop.id,
               'threadKey',     'challenge:' || v_row.id::text
           )
      from public.club_members m
     where m.club_id in (v_row.club_retador_id, v_row.club_retado_id);

    return v_match;
end;
$$;

revoke execute on function public.aprobar_propuesta(uuid) from public, anon;
grant execute on function public.aprobar_propuesta(uuid) to authenticated;
