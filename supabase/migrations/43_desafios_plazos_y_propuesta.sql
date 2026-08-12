-- =============================================================
-- FutFinder migration 43: plazos del ciclo y propuesta oficial
-- =============================================================
-- Pega esto entero en Supabase → SQL Editor → New query → Run.
-- Es idempotente: se puede volver a correr sin romper nada.
--
-- Qué había antes (migraciones 41 y 42): el desafío llega a
-- 'negociacion' con `negociacion_vence_at` puesto y un hilo grupal
-- abierto… y ahí se quedaba para siempre. Nadie hacía vencer ese plazo,
-- no existía la prórroga y no había dónde guardar la propuesta oficial.
--
-- Qué agrega esta migración:
--   1. Vocabulario nuevo en la bitácora y tipos de aviso nuevos.
--   2. `club_challenge_extension_replies`: una respuesta de prórroga por
--      club, con la unicidad haciendo el trabajo de la idempotencia.
--   3. `club_challenge_proposals`: la propuesta oficial, legible por
--      TODOS los integrantes de los dos clubes, no solo por los
--      administradores.
--   4. El motor de vencimientos: un núcleo privado que procesa UNA fila,
--      el barrido que lo aplica a todas (cron cada 5 minutos) y una RPC
--      delgada para que la pantalla no tenga que esperar al cron.
--   5. `responder_prorroga`, `crear_propuesta_oficial` y
--      `rechazar_propuesta`.
--
-- HORA DE SERVIDOR: ningún plazo se compara contra nada que mande el
-- cliente. Todo sale de `now()` de PostgreSQL.
--
-- POR QUÉ LOS VENCIMIENTOS NO ESCRIBEN MENSAJES: `messages.sender_id` es
-- NOT NULL y el sistema no es un usuario. Las transiciones automáticas
-- dejan solo un `club_challenge_events`, que el hilo ya intercala como
-- burbuja de sistema (migración 42, `ChallengeEventBubble`). Poner de
-- emisor a un administrador cualquiera sería mentir sobre quién habló.
--
-- SOBRE `revoke`: `revoke ... from anon` NO quita el EXECUTE que
-- PostgreSQL concede a PUBLIC por defecto — eso fue lo que obligó a
-- escribir la migración 42b. Acá todas las funciones revocan de
-- `public` explícitamente y recién después conceden a `authenticated`.
-- =============================================================

-- ── 1. VOCABULARIO NUEVO DE LA BITÁCORA ─────────────────────────
-- La 42 dejó declarado casi todo el ciclo, pero le faltaban los dos
-- eventos que produce el paso del tiempo sobre un partido ya publicado.
alter table public.club_challenge_events
    drop constraint if exists club_challenge_events_tipo_check;
alter table public.club_challenge_events
    add constraint club_challenge_events_tipo_check
    check (tipo in (
        'aceptado', 'rechazado', 'cancelado', 'expirado',
        'prorroga_abierta', 'prorroga_respondida', 'sin_acuerdo',
        'propuesta_creada', 'propuesta_aprobada', 'propuesta_rechazada',
        'partido_publicado', 'partido_en_juego', 'esperando_resultado',
        'cambio_propuesto', 'cambio_respondido',
        'encuentro_cancelado', 'sancion_aplicada', 'sancion_retirada',
        'resultado_propuesto', 'resultado_confirmado', 'resultado_disputado'
    ));

-- ── 2. TIPOS DE AVISO NUEVOS ────────────────────────────────────
-- Se reescribe la lista entera desde la versión de la migración 39 y se
-- le agregan cuatro tipos. Los cuatro son del módulo Clubes, así que en
-- `notificationPreferences.js` y en su espejo `pushLogic.ts` van a
-- `notif_clubs`. El aviso interno se inserta siempre; la preferencia
-- solo apaga el push externo.
alter table public.notifications
    drop constraint if exists notifications_type_check;

alter table public.notifications
    add constraint notifications_type_check
    check (type = any (array[
        'match_join','friend_request','friend_accept','message_new',
        'match_reminder','match_rate','join_request','join_approved',
        'join_rejected','match_cancelled',
        'match_updated','match_slot_free','waitlist_turn','match_left',
        'match_attendance',
        'club_request','club_request_accepted','club_request_rejected',
        'club_member_joined','club_member_left','club_invite_accepted',
        'club_challenge','club_challenge_accepted','club_challenge_rejected',
        'chat_mention_all',
        -- ciclo formal de desafíos (migración 43)
        'club_challenge_extension',          -- ¿este partido se disputará?
        'club_challenge_closed',             -- expirado o sin acuerdo
        'club_challenge_proposal',           -- propuesta oficial enviada
        'club_challenge_proposal_rejected'   -- el rival pidió cambios
    ]::text[]));

-- ── 3. RESPUESTAS DE PRÓRROGA ───────────────────────────────────
-- Una fila por club, no por administrador: «basta con que responda un
-- administrador de tu club». La restricción única es lo que hace
-- idempotente el doble toque y la carrera entre dos administradores del
-- mismo club — no hace falta ningún candado en la aplicación.
--
-- Las filas son de la prórroga EN CURSO, no del desafío entero: cuando
-- la negociación se reabre (dos «Sí», o una propuesta oficial durante
-- la prórroga) se borran. Si no, una segunda prórroga nacería con dos
-- «Sí» viejos y el desafío se reabriría solo para siempre, sin que
-- nadie pudiera volver a responder por el conflicto de unicidad. El
-- registro de quién respondió qué y cuándo queda en
-- `club_challenge_events`, que es el historial de verdad.
create table if not exists public.club_challenge_extension_replies (
    id           uuid primary key default gen_random_uuid(),
    challenge_id uuid not null references public.club_challenges(id) on delete cascade,
    club_id      uuid not null references public.clubs(id) on delete cascade,
    user_id      uuid references auth.users(id) on delete set null,
    respuesta    boolean not null,
    created_at   timestamptz not null default now(),
    unique (challenge_id, club_id)
);

alter table public.club_challenge_extension_replies enable row level security;

-- Las ven los mismos administradores que ven el hilo. Nadie escribe
-- directamente: la única vía es `responder_prorroga()`.
drop policy if exists club_challenge_extension_replies_read
    on public.club_challenge_extension_replies;
create policy club_challenge_extension_replies_read
    on public.club_challenge_extension_replies
    for select
    using (public.chat_puede_ver_desafio(challenge_id, auth.uid()));

-- ── 4. PROPUESTA OFICIAL ────────────────────────────────────────
-- Es la propuesta que, al aprobarla el club contrario, publica el
-- partido (eso llega en la migración 44). A diferencia de la propuesta
-- preliminar del desafío —fecha tentativa, zona aproximada—, acá va la
-- dirección exacta, la hora y la cuota: es lo que van a leer todos los
-- integrantes de los dos clubes para decidir si van.
create table if not exists public.club_challenge_proposals (
    id                  uuid primary key default gen_random_uuid(),
    challenge_id        uuid not null references public.club_challenges(id) on delete cascade,
    club_proponente_id  uuid not null references public.clubs(id) on delete cascade,
    creada_por          uuid references auth.users(id) on delete set null,

    fecha               timestamptz not null,
    duracion_min        integer not null,
    direccion           text not null,
    cancha_nombre       text not null,
    comuna              text not null,
    region              text not null,
    latitud             double precision,
    longitud            double precision,
    modalidad           text not null,
    cupos_por_club      integer not null,
    metodo_inscripcion  text not null,
    cuota_por_persona   integer not null default 0,
    instrucciones       text,

    estado              text not null default 'pendiente',
    motivo_rechazo      text,
    respondida_por      uuid references auth.users(id) on delete set null,
    respondida_at       timestamptz,
    client_token        uuid,
    created_at          timestamptz not null default now()
);

alter table public.club_challenge_proposals
    drop constraint if exists club_challenge_proposals_estado_check;
alter table public.club_challenge_proposals
    add constraint club_challenge_proposals_estado_check
    check (estado in ('pendiente', 'aprobada', 'rechazada', 'caducada'));

alter table public.club_challenge_proposals
    drop constraint if exists club_challenge_proposals_duracion_check;
alter table public.club_challenge_proposals
    add constraint club_challenge_proposals_duracion_check
    check (duracion_min in (60, 90, 120));

alter table public.club_challenge_proposals
    drop constraint if exists club_challenge_proposals_modalidad_check;
alter table public.club_challenge_proposals
    add constraint club_challenge_proposals_modalidad_check
    check (modalidad in ('futbol7', 'futbol11'));

-- El techo de 15 no es una preferencia: `matches.cupos_totales` tiene
-- check (<= 30) y el total de un partido de clubes es el doble de esto.
alter table public.club_challenge_proposals
    drop constraint if exists club_challenge_proposals_cupos_check;
alter table public.club_challenge_proposals
    add constraint club_challenge_proposals_cupos_check
    check (cupos_por_club between 4 and 15);

alter table public.club_challenge_proposals
    drop constraint if exists club_challenge_proposals_metodo_check;
alter table public.club_challenge_proposals
    add constraint club_challenge_proposals_metodo_check
    check (metodo_inscripcion in ('orden_llegada', 'seleccion_admin'));

alter table public.club_challenge_proposals
    drop constraint if exists club_challenge_proposals_cuota_check;
alter table public.club_challenge_proposals
    add constraint club_challenge_proposals_cuota_check
    check (cuota_por_persona >= 0);

-- UNA sola propuesta abierta por desafío. Es el índice, y no una
-- comprobación dentro de la RPC, lo que lo garantiza aunque dos
-- administradores de los dos clubes propongan en el mismo instante.
create unique index if not exists club_challenge_proposals_una_pendiente
    on public.club_challenge_proposals (challenge_id)
    where estado = 'pendiente';

-- Reintento idempotente: el mismo token no crea una segunda propuesta.
create unique index if not exists club_challenge_proposals_client_token_uidx
    on public.club_challenge_proposals (client_token)
    where client_token is not null;

create index if not exists idx_club_challenge_proposals_challenge
    on public.club_challenge_proposals (challenge_id, created_at desc);

alter table public.club_challenge_proposals enable row level security;

-- LECTURA PARA TODO EL CLUB, no solo para administradores: la dirección
-- exacta, la cuota y las instrucciones son justamente lo que los
-- jugadores necesitan para decidir si van. Mismo alcance que
-- `club_challenges_select`. Escribir sigue siendo exclusivo de las RPC.
drop policy if exists club_challenge_proposals_read on public.club_challenge_proposals;
create policy club_challenge_proposals_read on public.club_challenge_proposals
    for select
    using (
        exists (
            select 1
              from public.club_challenges c
              join public.club_members m
                on m.user_id = auth.uid()
               and m.club_id in (c.club_retador_id, c.club_retado_id)
             where c.id = club_challenge_proposals.challenge_id
        )
    );

-- ── 5. AVISOS DEL CICLO (interna) ───────────────────────────────
-- Insertar el mismo bloque de avisos a mano en cinco RPC distintas es
-- la forma más segura de que un día se desincronicen. `p_con_hilo` es
-- false cuando el desafío nunca llegó a tener hilo (un 'pendiente' que
-- expira): mandar un `threadKey` a un hilo que no existe llevaría al
-- usuario a una pantalla vacía.
create or replace function public.desafio_avisar(
    p_challenge public.club_challenges,
    p_type      text,
    p_title     text,
    p_body      text,
    p_clubs     uuid[],
    p_excepto   uuid    default null,
    p_extra     jsonb   default '{}'::jsonb,
    p_con_hilo  boolean default true
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_data jsonb;
    v_n    integer := 0;
begin
    v_data := jsonb_build_object(
        'challengeId',   p_challenge.id,
        'clubRetadorId', p_challenge.club_retador_id,
        'clubRetadoId',  p_challenge.club_retado_id
    ) || coalesce(p_extra, '{}'::jsonb);

    if p_con_hilo then
        v_data := v_data || jsonb_build_object('threadKey', 'challenge:' || p_challenge.id::text);
    end if;

    insert into public.notifications (user_id, type, title, body, data)
    select distinct m.user_id, p_type, p_title, p_body, v_data
      from public.club_members m
     where m.rol = 'admin'
       and m.club_id = any (p_clubs)
       and (p_excepto is null or m.user_id <> p_excepto);

    get diagnostics v_n = row_count;
    return v_n;
end;
$$;

revoke execute on function public.desafio_avisar(
    public.club_challenges, text, text, text, uuid[], uuid, jsonb, boolean
) from public, anon, authenticated;

-- ── 6. NÚCLEO DE VENCIMIENTOS: UNA FILA ─────────────────────────
-- Procesa el paso del tiempo sobre UN desafío y devuelve el estado
-- nuevo, o null si no había nada que hacer.
--
-- IDEMPOTENTE POR CONSTRUCCIÓN: la fila se bloquea con `for update` y
-- cada `update` lleva en el `where` el estado que esperaba encontrar.
-- Los eventos y los avisos se insertan SOLO si ese update movió una
-- fila, así que correr esto dos veces seguidas no produce un segundo
-- evento ni un segundo aviso.
--
-- No es una RPC de la app: se revoca de todos los roles. Se llega a
-- ella por el barrido del cron o por `refrescar_desafio()`.
create or replace function public.procesar_vencimiento_desafio(p_challenge_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_row      public.club_challenges;
    v_reglas   jsonb := public.desafio_reglas();
    v_dias     integer := (v_reglas ->> 'expiracion_pendiente_dias')::int;
    v_negoc    integer := (v_reglas ->> 'negociacion_horas')::int;
    v_prorroga integer := (v_reglas ->> 'prorroga_horas')::int;
    v_sies     integer;
    v_inicio   timestamptz;
    v_duracion integer;
begin
    select * into v_row
      from public.club_challenges
     where id = p_challenge_id
     for update;

    if not found then
        return null;
    end if;

    -- ── pendiente sin respuesta → expirado ──────────────────────
    if v_row.estado = 'pendiente' then
        if v_row.created_at > now() - make_interval(days => v_dias) then
            return null;
        end if;

        update public.club_challenges
           set estado        = 'expirado',
               motivo_cierre = 'Nadie respondió el desafío en ' || v_dias || ' días'
         where id = v_row.id
           and estado = 'pendiente'
        returning * into v_row;

        if not found then
            return null;
        end if;

        insert into public.club_challenge_events (challenge_id, tipo, payload)
        values (v_row.id, 'expirado', jsonb_build_object('dias', v_dias));

        -- Solo al club retador: el retado nunca respondió, y avisarle de
        -- algo que decidió ignorar es ruido.
        perform public.desafio_avisar(
            v_row,
            'club_challenge_closed',
            '⌛ Tu desafío expiró',
            'Pasaron ' || v_dias || ' días sin respuesta del club rival. Puedes volver a desafiarlo cuando quieras.',
            array[v_row.club_retador_id],
            null,
            '{}'::jsonb,
            false          -- no hay hilo: el desafío nunca se aceptó
        );

        return 'expirado';
    end if;

    -- ── negociación: prórroga y cierre ──────────────────────────
    if v_row.estado = 'negociacion' then

        -- (a) La prórroga venció. Con los dos «Sí» la negociación sigue;
        --     en cualquier otro caso el desafío se cierra sin acuerdo.
        if v_row.prorroga_abierta_at is not null
           and v_row.prorroga_vence_at is not null
           and v_row.prorroga_vence_at <= now() then

            select count(distinct club_id) into v_sies
              from public.club_challenge_extension_replies
             where challenge_id = v_row.id
               and respuesta;

            if v_sies >= 2 then
                update public.club_challenges
                   set prorroga_abierta_at  = null,
                       prorroga_vence_at    = null,
                       negociacion_vence_at = now() + make_interval(hours => v_negoc)
                 where id = v_row.id
                   and estado = 'negociacion'
                   and prorroga_abierta_at is not null
                returning * into v_row;

                if not found then
                    return null;
                end if;

                delete from public.club_challenge_extension_replies
                 where challenge_id = v_row.id;

                insert into public.club_challenge_events (challenge_id, tipo, payload)
                values (
                    v_row.id,
                    'prorroga_respondida',
                    jsonb_build_object(
                        'reabierta', true,
                        'vence_at', v_row.negociacion_vence_at
                    )
                );

                return 'negociacion';
            end if;

            update public.club_challenges
               set estado        = 'sin_acuerdo',
                   motivo_cierre = 'La prórroga venció sin que los dos clubes confirmaran el partido'
             where id = v_row.id
               and estado = 'negociacion'
               and prorroga_abierta_at is not null
            returning * into v_row;

            if not found then
                return null;
            end if;

            insert into public.club_challenge_events (challenge_id, tipo, payload)
            values (v_row.id, 'sin_acuerdo', jsonb_build_object('motivo', 'prorroga_vencida'));

            perform public.desafio_avisar(
                v_row,
                'club_challenge_closed',
                '🚫 Desafío cerrado sin acuerdo',
                'Venció la prórroga y no hubo propuesta oficial. La conversación queda como historial.',
                array[v_row.club_retador_id, v_row.club_retado_id]
            );

            return 'sin_acuerdo';
        end if;

        -- (b) Se acabaron las 72 h y todavía no hay prórroga: se abre
        --     una de 24 h y se le pregunta a los dos clubes.
        if v_row.prorroga_abierta_at is null
           and v_row.negociacion_vence_at is not null
           and v_row.negociacion_vence_at <= now() then

            update public.club_challenges
               set prorroga_abierta_at = now(),
                   prorroga_vence_at   = now() + make_interval(hours => v_prorroga)
             where id = v_row.id
               and estado = 'negociacion'
               and prorroga_abierta_at is null
            returning * into v_row;

            if not found then
                return null;
            end if;

            insert into public.club_challenge_events (challenge_id, tipo, payload)
            values (
                v_row.id,
                'prorroga_abierta',
                jsonb_build_object(
                    'horas', v_prorroga,
                    'vence_at', v_row.prorroga_vence_at
                )
            );

            perform public.desafio_avisar(
                v_row,
                'club_challenge_extension',
                '⏳ ¿Este partido se disputará?',
                'Se acabaron las ' || v_negoc || ' horas de negociación. Tienen ' || v_prorroga
                    || ' horas más: basta con que responda un administrador de cada club.',
                array[v_row.club_retador_id, v_row.club_retado_id]
            );

            return 'negociacion';
        end if;

        return null;
    end if;

    -- ── partido publicado: inicio y fin ─────────────────────────
    -- La hora sale de la propuesta aprobada; si el desafío viene del
    -- flujo antiguo (partido creado a mano y enlazado con `match_id`),
    -- sale del partido. Sin ninguna de las dos no hay nada que vencer.
    if v_row.estado in ('publicado', 'en_juego') then
        select p.fecha, p.duracion_min
          into v_inicio, v_duracion
          from public.club_challenge_proposals p
         where p.challenge_id = v_row.id
           and p.estado = 'aprobada'
         order by p.respondida_at desc nulls last
         limit 1;

        if v_inicio is null and v_row.match_id is not null then
            select m.hora, m.duracion_min
              into v_inicio, v_duracion
              from public.matches m
             where m.id = v_row.match_id;
        end if;

        if v_inicio is null then
            return null;
        end if;

        v_duracion := coalesce(v_duracion, 90);

        if v_row.estado = 'publicado' and v_inicio <= now() then
            update public.club_challenges
               set estado = 'en_juego'
             where id = v_row.id
               and estado = 'publicado'
            returning * into v_row;

            if not found then
                return null;
            end if;

            insert into public.club_challenge_events (challenge_id, tipo, payload)
            values (v_row.id, 'partido_en_juego', jsonb_build_object('inicio', v_inicio));

            return 'en_juego';
        end if;

        if v_row.estado = 'en_juego'
           and v_inicio + make_interval(mins => v_duracion) <= now() then

            update public.club_challenges
               set estado = 'esperando_resultado'
             where id = v_row.id
               and estado = 'en_juego'
            returning * into v_row;

            if not found then
                return null;
            end if;

            -- Sin aviso todavía: la pantalla para registrar el resultado
            -- llega en la Fase 6. Avisar «registren el resultado» sin
            -- que exista dónde hacerlo es mandar a la gente a una pared.
            insert into public.club_challenge_events (challenge_id, tipo, payload)
            values (
                v_row.id,
                'esperando_resultado',
                jsonb_build_object('inicio', v_inicio, 'duracion_min', v_duracion)
            );

            return 'esperando_resultado';
        end if;

        return null;
    end if;

    return null;
end;
$$;

revoke execute on function public.procesar_vencimiento_desafio(uuid)
    from public, anon, authenticated;

-- ── 7. BARRIDO COMPLETO (cron) ──────────────────────────────────
-- Recorre solo las filas que pueden tener algo vencido y procesa cada
-- una en su propio bloque: un desafío que falle no puede dejar sin
-- procesar a los demás. Mismo patrón de `check_push_receipts()`.
create or replace function public.procesar_vencimientos_desafios()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id     uuid;
    v_estado text;
    v_n      integer := 0;
    v_dias   integer := (public.desafio_reglas() ->> 'expiracion_pendiente_dias')::int;
begin
    for v_id in
        select id
          from public.club_challenges
         where (estado = 'pendiente'
                and created_at <= now() - make_interval(days => v_dias))
            or (estado = 'negociacion'
                and (
                     (prorroga_abierta_at is null and negociacion_vence_at <= now())
                  or (prorroga_abierta_at is not null and prorroga_vence_at <= now())
                ))
            or estado in ('publicado', 'en_juego')
         order by created_at
    loop
        begin
            v_estado := public.procesar_vencimiento_desafio(v_id);
            if v_estado is not null then
                v_n := v_n + 1;
            end if;
        exception when others then
            raise notice '[procesar_vencimientos_desafios] % : %', v_id, sqlerrm;
        end;
    end loop;

    return v_n;
end;
$$;

-- No es una RPC de la app: solo debe correr desde el cron (rol
-- postgres). Sin el revoke de PUBLIC, PostgREST la expone en
-- /rest/v1/rpc/ y cualquiera podría dispararla — exactamente el problema
-- que corrigió la migración 42b.
revoke execute on function public.procesar_vencimientos_desafios()
    from public, anon, authenticated;

select cron.schedule(
  'futfinder-desafios',
  '*/5 * * * *',
  $$select public.procesar_vencimientos_desafios();$$
);

-- ── 8. REFRESCO DE UNA FILA (RPC de pantalla) ───────────────────
-- El cron es la fuente fiable; esto solo quita latencia para que una
-- pantalla abierta no muestre un plazo vencido durante cinco minutos.
-- No concede nada: aplica el mismo paso del tiempo que se habría
-- aplicado solo. Por eso basta con ser integrante de alguno de los dos
-- clubes, sin exigir rol de administrador.
create or replace function public.refrescar_desafio(p_challenge_id uuid)
returns public.club_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me  uuid := auth.uid();
    v_row public.club_challenges;
begin
    if v_me is null then
        raise exception 'No autenticado' using errcode = '42501';
    end if;

    select * into v_row from public.club_challenges where id = p_challenge_id;
    if not found then
        raise exception 'Este desafío ya no existe' using errcode = 'no_data_found';
    end if;

    if not exists (
        select 1 from public.club_members m
        where m.user_id = v_me
          and m.club_id in (v_row.club_retador_id, v_row.club_retado_id)
    ) then
        raise exception 'Este desafío no es de tus clubes' using errcode = '42501';
    end if;

    perform public.procesar_vencimiento_desafio(p_challenge_id);

    select * into v_row from public.club_challenges where id = p_challenge_id;
    return v_row;
end;
$$;

revoke execute on function public.refrescar_desafio(uuid) from public, anon;
grant execute on function public.refrescar_desafio(uuid) to authenticated;

-- ── 9. RESPONDER LA PRÓRROGA ────────────────────────────────────
-- «Basta con que responda un administrador de tu club»: la primera
-- respuesta del club es la que vale, y el `on conflict do nothing` la
-- fija. El segundo administrador no la puede cambiar ni duplicar.
--
-- Un «No» cierra el desafío de inmediato. Dos «Sí» reabren la
-- negociación con un plazo nuevo — si no, el desafío quedaría vivo sin
-- ningún plazo corriendo y no se cerraría nunca.
create or replace function public.responder_prorroga(
    p_challenge_id uuid,
    p_respuesta    boolean
)
returns public.club_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me     uuid := auth.uid();
    v_row    public.club_challenges;
    v_club   uuid;
    v_n      integer;
    v_sies   integer;
    v_negoc  integer := (public.desafio_reglas() ->> 'negociacion_horas')::int;
    v_nombre text;
begin
    if v_me is null then
        raise exception 'No autenticado' using errcode = '42501';
    end if;
    if p_respuesta is null then
        raise exception 'Falta la respuesta' using errcode = 'check_violation';
    end if;

    select * into v_row
      from public.club_challenges
     where id = p_challenge_id
     for update;

    if not found then
        raise exception 'Este desafío ya no existe' using errcode = 'no_data_found';
    end if;

    -- El club sale de `club_members`, nunca del cliente.
    select m.club_id into v_club
      from public.club_members m
     where m.user_id = v_me
       and m.rol = 'admin'
       and m.club_id in (v_row.club_retador_id, v_row.club_retado_id)
     limit 1;

    if v_club is null then
        raise exception 'Solo un administrador de alguno de los dos clubes puede responder'
            using errcode = '42501';
    end if;

    if v_row.estado <> 'negociacion' then
        raise exception 'Este desafío ya no está en negociación'
            using errcode = 'check_violation';
    end if;
    if v_row.prorroga_abierta_at is null then
        raise exception 'No hay ninguna prórroga abierta en este desafío'
            using errcode = 'check_violation';
    end if;
    if v_row.prorroga_vence_at <= now() then
        raise exception 'La prórroga ya venció' using errcode = 'check_violation';
    end if;

    insert into public.club_challenge_extension_replies (challenge_id, club_id, user_id, respuesta)
    values (v_row.id, v_club, v_me, p_respuesta)
    on conflict (challenge_id, club_id) do nothing;

    get diagnostics v_n = row_count;

    -- Tu club ya había respondido: nada que repetir.
    if v_n = 0 then
        return v_row;
    end if;

    select nombre into v_nombre from public.clubs where id = v_club;

    insert into public.club_challenge_events (challenge_id, tipo, actor_id, club_id, payload)
    values (
        v_row.id,
        'prorroga_respondida',
        v_me,
        v_club,
        jsonb_build_object('respuesta', p_respuesta)
    );

    -- Un «No» cierra el desafío acá mismo.
    if not p_respuesta then
        update public.club_challenges
           set estado        = 'sin_acuerdo',
               motivo_cierre = coalesce(v_nombre, 'Un club') || ' confirmó que el partido no se disputará'
         where id = v_row.id
           and estado = 'negociacion'
        returning * into v_row;

        insert into public.club_challenge_events (challenge_id, tipo, actor_id, club_id, payload)
        values (v_row.id, 'sin_acuerdo', v_me, v_club, jsonb_build_object('motivo', 'respuesta_negativa'));

        perform public.desafio_avisar(
            v_row,
            'club_challenge_closed',
            '🚫 Desafío cerrado sin acuerdo',
            coalesce(v_nombre, 'Un club') || ' confirmó que el partido no se disputará. La conversación queda como historial.',
            array[v_row.club_retador_id, v_row.club_retado_id],
            v_me
        );

        return v_row;
    end if;

    -- Con los dos «Sí» se reabre la negociación con plazo nuevo.
    select count(distinct club_id) into v_sies
      from public.club_challenge_extension_replies
     where challenge_id = v_row.id
       and respuesta;

    if v_sies >= 2 then
        update public.club_challenges
           set prorroga_abierta_at  = null,
               prorroga_vence_at    = null,
               negociacion_vence_at = now() + make_interval(hours => v_negoc)
         where id = v_row.id
           and estado = 'negociacion'
        returning * into v_row;

        -- La prórroga que se acaba de responder queda cerrada: sus
        -- respuestas no pueden arrastrarse a la siguiente.
        delete from public.club_challenge_extension_replies
         where challenge_id = v_row.id;

        insert into public.club_challenge_events (challenge_id, tipo, payload)
        values (
            v_row.id,
            'prorroga_respondida',
            jsonb_build_object('reabierta', true, 'vence_at', v_row.negociacion_vence_at)
        );

        perform public.desafio_avisar(
            v_row,
            'club_challenge_extension',
            '⚔️ El partido sigue en pie',
            'Los dos clubes confirmaron. Tienen ' || v_negoc || ' horas más para cerrar la propuesta oficial.',
            array[v_row.club_retador_id, v_row.club_retado_id],
            v_me
        );
    end if;

    return v_row;
end;
$$;

revoke execute on function public.responder_prorroga(uuid, boolean) from public, anon;
grant execute on function public.responder_prorroga(uuid, boolean) to authenticated;

-- ── 10. CREAR LA PROPUESTA OFICIAL ──────────────────────────────
-- La puede crear un administrador de CUALQUIERA de los dos clubes; la
-- aprueba el otro. Todo lo que valida acá está espejado en
-- `validarPropuestaOficial()` de clubChallengeRules.js, pero la
-- autoridad es esta: el cliente valida para no gastar una llamada, no
-- para autorizar.
--
-- IDEMPOTENTE por `client_token`: reintentar tras un timeout de red
-- devuelve la propuesta que ya se creó, no una segunda.
create or replace function public.crear_propuesta_oficial(
    p_challenge_id uuid,
    p_payload      jsonb,
    p_client_token uuid default null
)
returns public.club_challenge_proposals
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me      uuid := auth.uid();
    v_row     public.club_challenges;
    v_prop    public.club_challenge_proposals;
    v_club    uuid;
    v_reglas  jsonb := public.desafio_reglas();
    v_min     integer := (v_reglas ->> 'cupos_por_club_min')::int;
    v_max     integer := (v_reglas ->> 'cupos_por_club_max')::int;
    v_instr   integer := (v_reglas ->> 'instrucciones_max')::int;
    v_fecha   timestamptz;
    v_dur     integer;
    v_cupos   integer;
    v_cuota   integer;
    v_nombre  text;
begin
    if v_me is null then
        raise exception 'No autenticado' using errcode = '42501';
    end if;

    -- Reintento con el mismo token: se devuelve lo que ya existe.
    if p_client_token is not null then
        select * into v_prop
          from public.club_challenge_proposals
         where client_token = p_client_token;
        if found then
            return v_prop;
        end if;
    end if;

    select * into v_row
      from public.club_challenges
     where id = p_challenge_id
     for update;

    if not found then
        raise exception 'Este desafío ya no existe' using errcode = 'no_data_found';
    end if;

    select m.club_id into v_club
      from public.club_members m
     where m.user_id = v_me
       and m.rol = 'admin'
       and m.club_id in (v_row.club_retador_id, v_row.club_retado_id)
     limit 1;

    if v_club is null then
        raise exception 'Solo un administrador de alguno de los dos clubes puede proponer'
            using errcode = '42501';
    end if;

    if v_row.estado <> 'negociacion' then
        raise exception 'Este desafío no está en negociación' using errcode = 'check_violation';
    end if;
    if v_row.prorroga_abierta_at is not null and v_row.prorroga_vence_at <= now() then
        raise exception 'La prórroga ya venció' using errcode = 'check_violation';
    end if;

    -- ── validación del contenido ────────────────────────────────
    v_fecha := (p_payload ->> 'fecha')::timestamptz;
    if v_fecha is null or v_fecha <= now() then
        raise exception 'La fecha del partido tiene que ser futura' using errcode = 'check_violation';
    end if;

    v_dur := (p_payload ->> 'duracion_min')::int;
    if v_dur is null or v_dur not in (60, 90, 120) then
        raise exception 'Duración no válida' using errcode = 'check_violation';
    end if;

    if coalesce(trim(p_payload ->> 'direccion'), '') = ''
       or coalesce(trim(p_payload ->> 'cancha_nombre'), '') = ''
       or coalesce(trim(p_payload ->> 'comuna'), '') = ''
       or coalesce(trim(p_payload ->> 'region'), '') = '' then
        raise exception 'Faltan datos del lugar del partido' using errcode = 'check_violation';
    end if;

    if coalesce(p_payload ->> 'modalidad', '') not in ('futbol7', 'futbol11') then
        raise exception 'Modalidad no válida' using errcode = 'check_violation';
    end if;

    v_cupos := (p_payload ->> 'cupos_por_club')::int;
    if v_cupos is null or v_cupos < v_min or v_cupos > v_max then
        raise exception 'Los cupos por club van de % a %', v_min, v_max using errcode = 'check_violation';
    end if;

    if coalesce(p_payload ->> 'metodo_inscripcion', '') not in (
        select jsonb_array_elements_text(v_reglas -> 'metodos_inscripcion')
    ) then
        raise exception 'Método de inscripción no válido' using errcode = 'check_violation';
    end if;

    v_cuota := coalesce((p_payload ->> 'cuota_por_persona')::int, 0);
    if v_cuota < 0 then
        raise exception 'La cuota no puede ser negativa' using errcode = 'check_violation';
    end if;

    if length(coalesce(p_payload ->> 'instrucciones', '')) > v_instr then
        raise exception 'Las instrucciones no pueden pasar de % caracteres', v_instr
            using errcode = 'check_violation';
    end if;

    -- ── alta ────────────────────────────────────────────────────
    begin
        insert into public.club_challenge_proposals (
            challenge_id, club_proponente_id, creada_por,
            fecha, duracion_min, direccion, cancha_nombre, comuna, region,
            latitud, longitud, modalidad, cupos_por_club, metodo_inscripcion,
            cuota_por_persona, instrucciones, client_token
        )
        values (
            v_row.id, v_club, v_me,
            v_fecha, v_dur,
            trim(p_payload ->> 'direccion'),
            trim(p_payload ->> 'cancha_nombre'),
            trim(p_payload ->> 'comuna'),
            trim(p_payload ->> 'region'),
            (p_payload ->> 'latitud')::double precision,
            (p_payload ->> 'longitud')::double precision,
            p_payload ->> 'modalidad',
            v_cupos,
            p_payload ->> 'metodo_inscripcion',
            v_cuota,
            nullif(trim(coalesce(p_payload ->> 'instrucciones', '')), ''),
            p_client_token
        )
        returning * into v_prop;
    exception when unique_violation then
        raise exception 'Ya hay una propuesta oficial esperando respuesta'
            using errcode = 'unique_violation';
    end;

    -- Proponer durante la prórroga la cierra. Mandar una propuesta
    -- oficial es la señal más clara posible de que el partido sí se va a
    -- disputar; dejar la prórroga corriendo significaría que un rechazo
    -- devuelve el desafío a un plazo ya vencido y el barrido lo cerraría
    -- sin acuerdo pese a que los dos clubes están negociando.
    update public.club_challenges
       set estado               = 'esperando_aprobacion',
           prorroga_abierta_at  = null,
           prorroga_vence_at    = null,
           negociacion_vence_at = case
               when prorroga_abierta_at is not null
                   then now() + make_interval(hours => (v_reglas ->> 'negociacion_horas')::int)
               else negociacion_vence_at
           end
     where id = v_row.id
       and estado = 'negociacion'
    returning * into v_row;

    if not found then
        raise exception 'Este desafío no está en negociación' using errcode = 'check_violation';
    end if;

    delete from public.club_challenge_extension_replies
     where challenge_id = v_row.id;

    select nombre into v_nombre from public.clubs where id = v_club;

    insert into public.club_challenge_events (challenge_id, tipo, actor_id, club_id, payload)
    values (
        v_row.id,
        'propuesta_creada',
        v_me,
        v_club,
        jsonb_build_object(
            'proposal_id', v_prop.id,
            'fecha', v_prop.fecha,
            'cancha_nombre', v_prop.cancha_nombre,
            'comuna', v_prop.comuna,
            'cupos_por_club', v_prop.cupos_por_club
        )
    );

    perform public.desafio_avisar(
        v_row,
        'club_challenge_proposal',
        '📋 Propuesta oficial de ' || coalesce(v_nombre, 'el club rival'),
        'Revisa cancha, fecha, cupos y cuota. El partido se publica cuando el club contrario la apruebe.',
        array[v_row.club_retador_id, v_row.club_retado_id],
        v_me,
        jsonb_build_object('proposalId', v_prop.id)
    );

    return v_prop;
end;
$$;

revoke execute on function public.crear_propuesta_oficial(uuid, jsonb, uuid) from public, anon;
grant execute on function public.crear_propuesta_oficial(uuid, jsonb, uuid) to authenticated;

-- ── 11. RECHAZAR LA PROPUESTA ───────────────────────────────────
-- Solo el club CONTRARIO al proponente. El desafío vuelve a
-- 'negociacion' y la propuesta se conserva con su motivo: el historial
-- de lo que se ofreció y por qué no se aceptó es parte de la
-- negociación.
--
-- El plazo NO se reinicia: las 72 h son para acordar, no para cada
-- intento. Si ya venció, el barrido abrirá la prórroga como
-- corresponde.
create or replace function public.rechazar_propuesta(
    p_proposal_id uuid,
    p_motivo      text default null
)
returns public.club_challenge_proposals
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me     uuid := auth.uid();
    v_prop   public.club_challenge_proposals;
    v_row    public.club_challenges;
    v_club   uuid;
    v_nombre text;
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

    -- Siempre se bloquea primero el desafío y después la propuesta:
    -- `crear_propuesta_oficial` hace lo mismo, así que las dos RPC no se
    -- pueden trabar entre sí.
    select * into v_row
      from public.club_challenges
     where id = v_prop.challenge_id
     for update;

    select * into v_prop
      from public.club_challenge_proposals
     where id = p_proposal_id
     for update;

    -- Reintento: ya estaba rechazada.
    if v_prop.estado = 'rechazada' then
        return v_prop;
    end if;
    if v_prop.estado <> 'pendiente' then
        raise exception 'Esta propuesta ya fue respondida' using errcode = 'check_violation';
    end if;

    -- El club contrario al proponente, derivado de `club_members`.
    select m.club_id into v_club
      from public.club_members m
     where m.user_id = v_me
       and m.rol = 'admin'
       and m.club_id in (v_row.club_retador_id, v_row.club_retado_id)
       and m.club_id <> v_prop.club_proponente_id
     limit 1;

    if v_club is null then
        raise exception 'Solo un administrador del club contrario puede responder la propuesta'
            using errcode = '42501';
    end if;

    update public.club_challenge_proposals
       set estado         = 'rechazada',
           motivo_rechazo = nullif(trim(coalesce(p_motivo, '')), ''),
           respondida_por = v_me,
           respondida_at  = now()
     where id = v_prop.id
       and estado = 'pendiente'
    returning * into v_prop;

    if not found then
        raise exception 'Esta propuesta ya fue respondida' using errcode = 'check_violation';
    end if;

    -- Sin `returning into`: un update que no mueve ninguna fila dejaría
    -- `v_row` en NULL y los avisos de más abajo se irían al vacío. Lo
    -- único que necesitan de la fila son los dos ids de club, que esta
    -- transición no cambia.
    update public.club_challenges
       set estado = 'negociacion'
     where id = v_row.id
       and estado = 'esperando_aprobacion';

    select nombre into v_nombre from public.clubs where id = v_club;

    insert into public.club_challenge_events (challenge_id, tipo, actor_id, club_id, payload)
    values (
        v_prop.challenge_id,
        'propuesta_rechazada',
        v_me,
        v_club,
        jsonb_build_object('proposal_id', v_prop.id, 'motivo', v_prop.motivo_rechazo)
    );

    perform public.desafio_avisar(
        v_row,
        'club_challenge_proposal_rejected',
        '↩️ ' || coalesce(v_nombre, 'El club rival') || ' pidió cambios',
        coalesce(v_prop.motivo_rechazo, 'Vuelvan a la negociación para acordar otra propuesta.'),
        array[v_prop.club_proponente_id],
        v_me,
        jsonb_build_object('proposalId', v_prop.id)
    );

    return v_prop;
end;
$$;

revoke execute on function public.rechazar_propuesta(uuid, text) from public, anon;
grant execute on function public.rechazar_propuesta(uuid, text) to authenticated;
