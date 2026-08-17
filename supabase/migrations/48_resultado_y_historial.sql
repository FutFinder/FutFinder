-- =============================================================
-- FutFinder — migración 48: resultado del encuentro e historial
-- real (Tarea 6.1 del plan de desafíos entre clubes).
--
-- QUÉ HACE: terminado el partido (`club_challenges.estado =
-- 'esperando_resultado'`), un administrador de cualquiera de los dos
-- clubes propone el marcador y marca quién llegó de verdad; el club
-- CONTRARIO lo confirma o lo rechaza. Confirmarlo cierra el desafío
-- (`finalizado`) y publica el partido (`matches.estado = 'finalizado'`);
-- rechazarlo lo deja en `resultado_en_disputa` sin tocar ninguna
-- estadística, y el proponente puede intentar de nuevo.
--
-- LAS CINCO GARANTÍAS, Y DÓNDE VIVEN:
--
--   1. PROPONE UNO DE LOS DOS CLUBES, NUNCA EL QUE ADMINISTRA LOS DOS.
--      Mismo conflicto de doble pertenencia que cierran 43d/46/47: si
--      administrara ambos, después se confirmaría a sí mismo por la
--      otra puerta.
--   2. CONFIRMA EL CLUB CONTRARIO, NUNCA EL PROPONENTE. Tres
--      condiciones en `confirmar_resultado`, igual que en
--      `responder_cambio_partido` (46): no ser quien propuso, ser
--      administrador del club contrario, y no pertenecer EN NINGÚN ROL
--      al club proponente (regla estricta de la 43d).
--   3. UN RESULTADO ACTIVO POR DESAFÍO, NO UNO POR SIEMPRE. El índice
--      único parcial `club_match_results_activo_uidx` excluye a
--      propósito los rechazados: la propuesta rechazada queda en la
--      tabla como historial, y una propuesta nueva puede reemplazarla
--      sin chocar con ella. Sin esa exclusión no habría forma de volver
--      a proponer después de un rechazo.
--   4. LA ASISTENCIA SE MARCA UNA SOLA VEZ. `proponer_resultado` sólo
--      toca a quien sigue `'inscrito'`; si el resultado se rechaza y se
--      vuelve a proponer, la asistencia ya marcada no se vuelve a
--      pisar. Reutiliza el vocabulario existente de `attendees.estado`
--      (`confirmado_gps` / `no_asistio`) en vez de inventar uno nuevo.
--   5. `club_record()` Y `historial_publico_club()` SÓLO CUENTAN
--      `estado = 'confirmado'`. Un resultado propuesto o rechazado no
--      mueve el récord de nadie. `historial_publico_club()` ya
--      declaraba esta forma desde la 44d con tres columnas en
--      `null::…` y un comentario `TODO(48)`; esta migración sólo
--      rellena esos tres huecos, no cambia el contrato.
--
-- CONCURRENCIA: mismo orden de bloqueo que el resto del ciclo — la fila
-- grande primero (`matches`), después `club_challenges`, y al final la
-- fila propia de esta migración (`club_match_results`) — para que dos
-- administradores actuando a la vez no puedan trabarse entre sí.
--
-- QUÉ NO HACE: no resuelve un desafío que se quedó en
-- `resultado_en_disputa` para siempre si nadie vuelve a proponer; ese
-- es un problema de moderación, no de esta migración, y no distinto del
-- P1 ya registrado en `docs/memoria/operacion/pendientes.md` sobre las
-- revisiones de sanción.
-- =============================================================

-- ── 1. LA TABLA ──────────────────────────────────────────────────
create table if not exists public.club_match_results (
    id                 uuid primary key default gen_random_uuid(),
    -- `on delete cascade`: a diferencia de `club_sanctions`, un
    -- resultado NO tiene sentido sin su desafío ni su partido — no es
    -- historial del club, es el historial de ESE encuentro.
    challenge_id       uuid not null references public.club_challenges(id) on delete cascade,
    match_id           uuid not null references public.matches(id) on delete cascade,
    club_local_id      uuid not null references public.clubs(id) on delete cascade,
    club_visitante_id  uuid not null references public.clubs(id) on delete cascade,
    goles_local        integer not null,
    goles_visitante    integer not null,
    club_proponente_id uuid not null references public.clubs(id) on delete cascade,
    propuesto_por      uuid references auth.users(id) on delete set null,
    confirmado_por     uuid references auth.users(id) on delete set null,
    confirmado_at      timestamptz,
    estado             text not null default 'propuesto',
    created_at         timestamptz not null default now()
);

alter table public.club_match_results
    drop constraint if exists club_match_results_estado_check;
alter table public.club_match_results
    add constraint club_match_results_estado_check
    check (estado in ('propuesto', 'confirmado', 'rechazado'));

alter table public.club_match_results
    drop constraint if exists club_match_results_goles_check;
alter table public.club_match_results
    add constraint club_match_results_goles_check
    check (goles_local between 0 and 99 and goles_visitante between 0 and 99);

alter table public.club_match_results
    drop constraint if exists club_match_results_clubes_check;
alter table public.club_match_results
    add constraint club_match_results_clubes_check
    check (club_local_id <> club_visitante_id
           and club_proponente_id in (club_local_id, club_visitante_id));

-- ÉSTA es la garantía de un resultado activo por desafío, no un `if`
-- dentro de la función. Ver garantía 3 en la cabecera.
drop index if exists club_match_results_activo_uidx;
create unique index club_match_results_activo_uidx
    on public.club_match_results (challenge_id)
    where estado <> 'rechazado';

create index if not exists idx_club_match_results_match
    on public.club_match_results (match_id);

comment on table public.club_match_results is
    'Resultado propuesto/confirmado/rechazado de un partido de clubes (migración 48). club_record() e historial_publico_club() sólo cuentan las filas en estado confirmado.';
comment on column public.club_match_results.club_proponente_id is
    'Qué club propuso este marcador. confirmar_resultado() exige que responda el OTRO club de la pareja, nunca éste.';

-- ── 2. QUIÉN LA VE ───────────────────────────────────────────────
-- Los integrantes de los dos clubes, con o sin rol — misma regla que
-- `club_match_changes` (46) y `club_sanctions` (47): el partido existe
-- para los integrantes, no sólo para los administradores. SIN
-- políticas de escritura: la tabla la escriben únicamente las RPC
-- `security definer` de esta migración.
alter table public.club_match_results enable row level security;

drop policy if exists club_match_results_read on public.club_match_results;
create policy club_match_results_read on public.club_match_results
    for select
    using (
        exists (
            select 1 from public.club_members cm
             where cm.user_id = auth.uid()
               and cm.club_id in (club_match_results.club_local_id, club_match_results.club_visitante_id)
        )
    );

grant select on public.club_match_results to authenticated;
revoke insert, update, delete on public.club_match_results from public, anon, authenticated;
revoke select on public.club_match_results from anon;

-- ── 3. DOS AVISOS NUEVOS, MÁS UNO ────────────────────────────────
-- `club_resultado_propuesto` va al club contrario, que tiene que
-- responder; `club_resultado_confirmado` y `club_resultado_disputado`
-- van al proponente, que está esperando la respuesta. A los INSCRITOS
-- no les avisa ninguno: el resultado no cambia nada de lo que a ellos
-- les importa (hora, cancha, cupo).
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
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
        'club_match_published', 'club_match_reserva_omitida',
        'club_match_change', 'club_match_change_responded',
        'club_match_cancelled', 'club_sancionado', 'club_revision_resuelta',
        'club_resultado_propuesto', 'club_resultado_confirmado', 'club_resultado_disputado'
    ));

-- `club_challenge_events_tipo_check` ya reserva desde la 47c los tres
-- tipos que usa esta migración (`resultado_propuesto`,
-- `resultado_confirmado`, `resultado_disputado`): no hace falta
-- reescribirlo.

-- ── 4. PROPONER EL RESULTADO ─────────────────────────────────────
create or replace function public.proponer_resultado(
    p_challenge_id    uuid,
    p_goles_local     integer,
    p_goles_visitante integer,
    p_asistencia      jsonb default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me     uuid := auth.uid();
    v_row    public.club_challenges;
    v_match  public.matches;
    v_clubes uuid[];
    v_club   uuid;
    v_rival  uuid;
    v_ya     public.club_match_results;
    v_res    public.club_match_results;
    v_nombre text;
    v_user   text;
    v_titulo text;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    -- Validaciones que no revelan nada de nadie: pueden ir antes de
    -- tocar ninguna fila.
    if p_goles_local is null or p_goles_visitante is null then
        return json_build_object('ok', false,
            'reason', 'Ingresa el marcador de los dos equipos');
    end if;
    if p_goles_local < 0 or p_goles_visitante < 0
       or p_goles_local > 99 or p_goles_visitante > 99 then
        return json_build_object('ok', false,
            'reason', 'El marcador tiene que ser un número entre 0 y 99');
    end if;
    if p_asistencia is not null and jsonb_typeof(p_asistencia) is distinct from 'array' then
        return json_build_object('ok', false,
            'reason', 'La asistencia tiene que ser una lista de jugadores que sí llegaron');
    end if;

    select * into v_row from public.club_challenges where id = p_challenge_id;
    if not found then
        return json_build_object('ok', false, 'reason', 'Este desafío ya no existe');
    end if;
    if v_row.match_id is null then
        return json_build_object('ok', false,
            'reason', 'Este desafío todavía no tiene un partido publicado');
    end if;

    -- Fila grande primero, la chica después: mismo orden que el resto
    -- del ciclo, para que dos administradores no se traben entre sí.
    select * into v_match from public.matches where id = v_row.match_id for update;
    if not found then
        return json_build_object('ok', false, 'reason', 'El partido de este desafío ya no existe');
    end if;
    select * into v_row from public.club_challenges where id = p_challenge_id for update;

    -- ── autorización, antes de cualquier salida temprana ────────
    -- La 43b aprendió esto a golpes: mirar `club_members` es lo primero
    -- que hace esta función después de bloquear, no lo último.
    select array_agg(cm.club_id) into v_clubes
      from public.club_members cm
     where cm.user_id = v_me
       and cm.rol = 'admin'
       and cm.club_id in (v_row.club_retador_id, v_row.club_retado_id);

    if v_clubes is null then
        return json_build_object('ok', false,
            'reason', 'Solo un administrador de alguno de los dos clubes puede proponer el resultado');
    end if;

    -- Quien administra los DOS clubes no propone: después sería quien
    -- confirma su propia propuesta por la otra puerta. Mismo conflicto
    -- de doble pertenencia que cierran 43d/46/47.
    if array_length(v_clubes, 1) > 1 then
        return json_build_object('ok', false,
            'reason', 'Administras los dos clubes de este encuentro: no puedes proponer el resultado en nombre de uno solo');
    end if;

    v_club  := v_clubes[1];
    v_rival := case when v_club = v_row.club_retador_id
                    then v_row.club_retado_id
                    else v_row.club_retador_id end;

    -- ── estado ──────────────────────────────────────────────────
    if v_match.estado = 'cancelado' then
        return json_build_object('ok', false,
            'reason', 'Este encuentro fue cancelado: no se puede registrar un resultado');
    end if;
    if v_row.estado not in ('esperando_resultado', 'resultado_en_disputa') then
        return json_build_object('ok', false,
            'reason', 'Este desafío no está esperando un resultado');
    end if;

    -- Un resultado activo por desafío (garantía 3 de la cabecera). Se
    -- comprueba acá para dar un motivo legible; el índice único parcial
    -- es la garantía real ante dos propuestas a la vez.
    select * into v_ya from public.club_match_results
     where challenge_id = p_challenge_id and estado <> 'rechazado';

    if found then
        if v_ya.estado = 'confirmado' then
            return json_build_object('ok', true, 'already', true,
                'resultId', v_ya.id, 'estado', v_ya.estado);
        end if;
        return json_build_object('ok', false,
            'reason', 'Ya hay un resultado propuesto esperando confirmación del otro club');
    end if;

    select nombre into v_nombre from public.clubs where id = v_club;
    -- El `username` sale de `profiles` DENTRO de la función, nunca del
    -- cliente. La auditoría de verdad es `propuesto_por`.
    select username into v_user from public.profiles where id = v_me;
    v_titulo := coalesce(v_match.titulo, 'el partido');

    insert into public.club_match_results (
        challenge_id, match_id, club_local_id, club_visitante_id,
        goles_local, goles_visitante, club_proponente_id, propuesto_por
    )
    values (
        v_row.id, v_match.id, v_match.club_local_id, v_match.club_visitante_id,
        p_goles_local, p_goles_visitante, v_club, v_me
    )
    returning * into v_res;

    -- La asistencia real (garantía 4): sólo toca a quien sigue
    -- 'inscrito', así que una segunda propuesta tras un rechazo no
    -- vuelve a pisarla.
    if p_asistencia is not null then
        update public.attendees
           set estado = case
                            when id_jugador::text in (
                                select jsonb_array_elements_text(p_asistencia)
                            ) then 'confirmado_gps'
                            else 'no_asistio'
                        end,
               confirmado_at = case
                            when id_jugador::text in (
                                select jsonb_array_elements_text(p_asistencia)
                            ) then now()
                            else confirmado_at
                        end
         where id_partido = v_match.id
           and estado = 'inscrito';
    end if;

    insert into public.club_challenge_events (challenge_id, tipo, actor_id, club_id, payload)
    values (v_row.id, 'resultado_propuesto', v_me, v_club,
        jsonb_build_object(
            'result_id',              v_res.id,
            'match_id',               v_match.id,
            'club_proponente_id',     v_club,
            'club_proponente_nombre', coalesce(v_nombre, 'Un club'),
            'actor_id',               v_me,
            'actor_username',         v_user,
            'goles_local',            p_goles_local,
            'goles_visitante',        p_goles_visitante));

    perform public.desafio_avisar(
        v_row,
        'club_resultado_propuesto',
        'Hay un resultado por confirmar',
        coalesce(v_nombre, 'El club rival') || ' propuso ' || p_goles_local || '-' || p_goles_visitante
            || ' en «' || v_titulo || '». Confírmalo o recházalo.',
        array[v_rival],
        v_me,
        jsonb_build_object('matchId', v_match.id, 'resultId', v_res.id,
                           'golesLocal', p_goles_local, 'golesVisitante', p_goles_visitante),
        true);

    return json_build_object('ok', true, 'resultId', v_res.id, 'estado', v_res.estado,
        'golesLocal', p_goles_local, 'golesVisitante', p_goles_visitante);
end;
$$;

revoke execute on function public.proponer_resultado(uuid, integer, integer, jsonb) from public, anon;
grant execute on function public.proponer_resultado(uuid, integer, integer, jsonb) to authenticated;

comment on function public.proponer_resultado(uuid, integer, integer, jsonb) is
    'Un administrador de cualquiera de los dos clubes propone el marcador final y marca la asistencia real de los inscritos (migración 48). Queda en club_match_results.estado = propuesto hasta que confirmar_resultado() lo cierre.';

-- ── 5. CONFIRMAR O RECHAZAR EL RESULTADO ─────────────────────────
create or replace function public.confirmar_resultado(
    p_result_id uuid,
    p_aceptar   boolean
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me      uuid := auth.uid();
    v_res     public.club_match_results;
    v_match   public.matches;
    v_row     public.club_challenges;
    v_club    uuid;
    v_en_prop boolean;
    v_nombre  text;
    v_user    text;
    v_titulo  text;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    select * into v_res from public.club_match_results where id = p_result_id;
    if not found then
        return json_build_object('ok', false, 'reason', 'Este resultado ya no existe');
    end if;

    -- Fila grande primero (el partido), después el desafío, y al final
    -- la propia fila del resultado. Mismo orden que el resto del ciclo.
    select * into v_match from public.matches where id = v_res.match_id for update;
    if not found then
        return json_build_object('ok', false, 'reason', 'El partido de este resultado ya no existe');
    end if;
    select * into v_row from public.club_challenges where id = v_res.challenge_id for update;
    if not found then
        return json_build_object('ok', false, 'reason', 'Este desafío ya no existe');
    end if;
    select * into v_res from public.club_match_results where id = p_result_id for update;

    -- ── autorización, antes de cualquier salida temprana ────────
    if v_res.propuesto_por = v_me then
        return json_build_object('ok', false,
            'reason', 'No puedes confirmar tu propio resultado: lo confirma el club contrario');
    end if;

    select cm.club_id into v_club
      from public.club_members cm
     where cm.user_id = v_me
       and cm.rol = 'admin'
       and cm.club_id in (v_row.club_retador_id, v_row.club_retado_id)
       and cm.club_id <> v_res.club_proponente_id
     limit 1;

    if v_club is null then
        return json_build_object('ok', false,
            'reason', 'Solo un administrador del club contrario puede confirmar este resultado');
    end if;

    -- No pertenecer al club proponente EN NINGÚN ROL: la regla estricta
    -- de la 43d, para que quien está en los dos clubes no se confirme a
    -- sí mismo por la puerta de al lado.
    select exists (
        select 1 from public.club_members cm
         where cm.user_id = v_me and cm.club_id = v_res.club_proponente_id
    ) into v_en_prop;

    if v_en_prop then
        return json_build_object('ok', false,
            'reason', 'No puedes confirmar un resultado propuesto por un club al que perteneces');
    end if;

    -- ── estado de la propuesta ───────────────────────────────────
    if v_res.estado = 'confirmado' then
        return json_build_object('ok', true, 'already', true,
            'aceptado', true, 'resultId', v_res.id, 'estado', v_res.estado);
    end if;
    if v_res.estado <> 'propuesto' then
        return json_build_object('ok', false,
            'reason', 'Este resultado ya fue rechazado: pide que propongan uno nuevo');
    end if;

    select nombre into v_nombre from public.clubs where id = v_club;
    select username into v_user from public.profiles where id = v_me;
    v_titulo := coalesce(v_match.titulo, 'el partido');

    -- ── rechazar: sin tocar estadísticas ─────────────────────────
    if not coalesce(p_aceptar, false) then
        update public.club_match_results
           set estado = 'rechazado'
         where id = v_res.id and estado = 'propuesto'
        returning * into v_res;
        if not found then
            return json_build_object('ok', false, 'reason', 'Este resultado ya fue respondido');
        end if;

        update public.club_challenges
           set estado = 'resultado_en_disputa'
         where id = v_row.id and estado in ('esperando_resultado', 'resultado_en_disputa')
        returning * into v_row;

        insert into public.club_challenge_events (challenge_id, tipo, actor_id, club_id, payload)
        values (v_row.id, 'resultado_disputado', v_me, v_club,
            jsonb_build_object(
                'result_id',            v_res.id,
                'match_id',             v_match.id,
                'club_responde_id',     v_club,
                'club_responde_nombre', coalesce(v_nombre, 'Un club'),
                'actor_id',             v_me,
                'actor_username',       v_user,
                'goles_local',          v_res.goles_local,
                'goles_visitante',      v_res.goles_visitante));

        perform public.desafio_avisar(
            v_row,
            'club_resultado_disputado',
            'Rechazaron el resultado',
            coalesce(v_nombre, 'El club rival') || ' rechazó el marcador propuesto para «'
                || v_titulo || '». Propongan uno nuevo.',
            array[v_res.club_proponente_id],
            v_me,
            jsonb_build_object('matchId', v_match.id, 'resultId', v_res.id),
            true);

        return json_build_object('ok', true, 'aceptado', false,
            'resultId', v_res.id, 'estado', v_res.estado);
    end if;

    -- ── aceptar ───────────────────────────────────────────────────
    update public.club_match_results
       set estado = 'confirmado', confirmado_por = v_me, confirmado_at = now()
     where id = v_res.id and estado = 'propuesto'
    returning * into v_res;
    if not found then
        return json_build_object('ok', false, 'reason', 'Este resultado ya fue respondido');
    end if;

    update public.matches
       set estado = 'finalizado'
     where id = v_match.id and estado <> 'cancelado'
    returning * into v_match;

    update public.club_challenges
       set estado = 'finalizado'
     where id = v_row.id and estado in ('esperando_resultado', 'resultado_en_disputa')
    returning * into v_row;

    insert into public.club_challenge_events (challenge_id, tipo, actor_id, club_id, payload)
    values (v_row.id, 'resultado_confirmado', v_me, v_club,
        jsonb_build_object(
            'result_id',            v_res.id,
            'match_id',             v_match.id,
            'club_confirma_id',     v_club,
            'club_confirma_nombre', coalesce(v_nombre, 'Un club'),
            'actor_id',             v_me,
            'actor_username',       v_user,
            'goles_local',          v_res.goles_local,
            'goles_visitante',      v_res.goles_visitante));

    perform public.desafio_avisar(
        v_row,
        'club_resultado_confirmado',
        'Confirmaron el resultado',
        coalesce(v_nombre, 'El club rival') || ' confirmó ' || v_res.goles_local || '-' || v_res.goles_visitante
            || ' en «' || v_titulo || '». Quedó en el historial.',
        array[v_res.club_proponente_id],
        v_me,
        jsonb_build_object('matchId', v_match.id, 'resultId', v_res.id),
        true);

    return json_build_object('ok', true, 'aceptado', true,
        'resultId', v_res.id, 'estado', v_res.estado);
end;
$$;

revoke execute on function public.confirmar_resultado(uuid, boolean) from public, anon;
grant execute on function public.confirmar_resultado(uuid, boolean) to authenticated;

comment on function public.confirmar_resultado(uuid, boolean) is
    'El club contrario al proponente confirma o rechaza el resultado (migración 48). Aceptar cierra el desafío en finalizado y pone matches.estado = finalizado; rechazar lo deja en resultado_en_disputa sin tocar club_record().';

-- ── 6. EL RÉCORD V/E/D ───────────────────────────────────────────
create or replace function public.club_record(p_club_id uuid)
returns table (v integer, e integer, d integer)
language sql
stable
security definer
set search_path = public
as $$
    select
        count(*) filter (
            where (r.club_local_id = p_club_id and r.goles_local > r.goles_visitante)
               or (r.club_visitante_id = p_club_id and r.goles_visitante > r.goles_local)
        )::integer,
        count(*) filter (where r.goles_local = r.goles_visitante)::integer,
        count(*) filter (
            where (r.club_local_id = p_club_id and r.goles_local < r.goles_visitante)
               or (r.club_visitante_id = p_club_id and r.goles_visitante < r.goles_local)
        )::integer
      from public.club_match_results r
     where r.estado = 'confirmado'
       and p_club_id in (r.club_local_id, r.club_visitante_id);
$$;

revoke execute on function public.club_record(uuid) from public;
grant execute on function public.club_record(uuid) to anon, authenticated;

comment on function public.club_record(uuid) is
    'V/E/D de un club contando sólo club_match_results.estado = confirmado (migración 48). Un resultado propuesto o rechazado no cuenta. Siempre devuelve una fila, con ceros si el club no tiene resultados confirmados.';

-- ── 7. EL HISTORIAL PÚBLICO YA NO DEVUELVE MARCADOR NULO ─────────
-- Reemplaza el cuerpo que dejó la 44d con tres `null::…` y comentarios
-- `TODO(48)`. La forma de la tabla no cambia: sólo se rellenan los tres
-- huecos que ya estaban reservados.
create or replace function public.historial_publico_club(
    p_club_id uuid,
    p_limit   integer default 20
)
returns table (
    match_id           uuid,
    fecha              date,
    club_local_id      uuid,
    club_local_nombre  text,
    club_visitante_id  uuid,
    club_visitante_nombre text,
    goles_local        integer,
    goles_visitante    integer,
    resultado          text
)
language sql
stable
security definer
set search_path = public
as $$
    select
        m.id,
        -- El DÍA, nunca la hora exacta: la hora es dato operativo.
        (m.hora at time zone 'America/Santiago')::date,
        m.club_local_id,
        cl.nombre,
        m.club_visitante_id,
        cv.nombre,
        r.goles_local,
        r.goles_visitante,
        case
            when r.goles_local is null then null
            when r.goles_local = r.goles_visitante then 'E'
            when p_club_id = m.club_local_id and r.goles_local > r.goles_visitante then 'V'
            when p_club_id = m.club_visitante_id and r.goles_visitante > r.goles_local then 'V'
            else 'D'
        end
      from public.matches m
      join public.clubs cl on cl.id = m.club_local_id
      join public.clubs cv on cv.id = m.club_visitante_id
      left join public.club_match_results r
        on r.match_id = m.id and r.estado = 'confirmado'
     where m.challenge_proposal_id is not null
       and m.estado = 'finalizado'
       and p_club_id in (m.club_local_id, m.club_visitante_id)
     order by m.hora desc
     limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

revoke execute on function public.historial_publico_club(uuid, integer) from public;
grant execute on function public.historial_publico_club(uuid, integer) to anon, authenticated;

comment on function public.historial_publico_club(uuid, integer) is
    'Historial PÚBLICO de un club: sólo partidos finalizados, y sólo clubes, día, marcador y resultado (migración 48 rellena el marcador que la 44d dejaba nulo). Nunca cancha, hora, cuota, cupos, nómina ni ubicación.';
