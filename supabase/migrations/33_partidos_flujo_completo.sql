-- =============================================================
-- FutFinder migration 33 · Módulo Partidos completo
--
-- Acompaña al rediseño de Partidos (handoff `Partidos.dc.html`).
-- Es idempotente: se puede volver a correr sin efectos secundarios.
--
-- 1. Columnas nuevas en `matches` (modalidad, rango de edad, avisos,
--    motivo de cancelación y token de idempotencia).
-- 2. Estado 'pendiente' en `attendees` (aprobación manual).
-- 3. Tabla `match_waitlist` (lista de espera) + RLS.
-- 4. RPCs nuevas: join_waitlist, leave_waitlist, save_match_attendance.
-- 5. Trigger que avisa al primero de la lista cuando se libera un cupo.
-- 6. Trigger que avisa a los confirmados si cambia fecha/hora/cancha/cuota.
-- 7. Guarda de integridad: los cupos totales no pueden bajar de los
--    jugadores ya confirmados.
-- 8. RPCs heredadas que la app ya llamaba pero que NO estaban versionadas
--    en este repo (request_join, approve_join, reject_join,
--    leave_match_penalized, cancel_match, swap_match,
--    cancel_match_and_join, get_schedule_conflict). Se crean SOLO si no
--    existen, para no pisar una versión que ya esté funcionando en la
--    base de datos real.
-- =============================================================

-- ---------------------------------------------------------------
-- 1. COLUMNAS NUEVAS EN matches
-- ---------------------------------------------------------------
alter table public.matches
    add column if not exists modalidad           text,
    add column if not exists edad_min            integer,
    add column if not exists edad_max            integer,
    add column if not exists recordatorio_1h     boolean not null default true,
    add column if not exists pedir_asistencia    boolean not null default true,
    add column if not exists motivo_cancelacion  text,
    add column if not exists client_token        uuid;

-- Mismo vocabulario que clubs.modalidad y profiles.modalidad (migraciones 29 y 30).
alter table public.matches drop constraint if exists matches_modalidad_check;
alter table public.matches
    add constraint matches_modalidad_check
    check (modalidad is null or modalidad in ('futbol7', 'futbol11'));

alter table public.matches drop constraint if exists matches_edad_check;
alter table public.matches
    add constraint matches_edad_check
    check (
        (edad_min is null or (edad_min >= 12 and edad_min <= 99))
        and (edad_max is null or (edad_max >= 12 and edad_max <= 99))
        and (edad_min is null or edad_max is null or edad_min < edad_max)
    );

-- Idempotencia de la publicación: dos toques en «Publicar» con el mismo
-- token crean un solo partido. El índice es parcial porque los partidos
-- anteriores a esta migración no tienen token.
create unique index if not exists matches_client_token_uidx
    on public.matches (client_token)
    where client_token is not null;

comment on column public.matches.modalidad is
    'futbol7 | futbol11. Null en partidos creados antes de la migración 33.';
comment on column public.matches.edad_min is
    'Edad mínima exigida. Null = sin restricción.';
comment on column public.matches.recordatorio_1h is
    'Si el organizador quiere que avisemos a los confirmados 1 h antes.';
comment on column public.matches.pedir_asistencia is
    'Si al terminar le pedimos al organizador marcar quién asistió.';
comment on column public.matches.motivo_cancelacion is
    'Motivo opcional que ven los jugadores cuando el partido se cancela.';
comment on column public.matches.client_token is
    'Token generado por el cliente para que publicar sea idempotente.';

-- ---------------------------------------------------------------
-- 2. ESTADO 'pendiente' EN attendees
-- ---------------------------------------------------------------
-- La app ya usaba 'pendiente' para la aprobación manual, pero el CHECK
-- versionado en schema.sql no lo incluía.
alter table public.attendees drop constraint if exists attendees_estado_check;
alter table public.attendees
    add constraint attendees_estado_check
    check (estado in ('pendiente','inscrito','confirmado_gps','no_asistio','cancelado'));

create index if not exists idx_attendees_pendientes
    on public.attendees (id_partido)
    where estado = 'pendiente';

-- ---------------------------------------------------------------
-- 3. LISTA DE ESPERA
-- ---------------------------------------------------------------
create table if not exists public.match_waitlist (
    id                  uuid primary key default uuid_generate_v4(),
    id_partido          uuid not null references public.matches(id) on delete cascade,
    id_jugador          uuid not null references public.profiles(id) on delete cascade,
    created_at          timestamptz not null default now(),
    -- Cuándo le avisamos que se liberó un cupo y hasta cuándo tiene para confirmar.
    avisado_at          timestamptz,
    confirmar_antes_de  timestamptz,
    unique (id_partido, id_jugador)
);

create index if not exists idx_waitlist_partido
    on public.match_waitlist (id_partido, created_at);
create index if not exists idx_waitlist_jugador
    on public.match_waitlist (id_jugador);

comment on table public.match_waitlist is
    'Cola de espera de un partido lleno, en orden de llegada (created_at). '
    'Salir de la lista nunca afecta el Trust Score.';

alter table public.match_waitlist enable row level security;

-- Cualquiera autenticado puede ver la cola del partido (es información del
-- partido, no dato privado: se muestra en el detalle y en la gestión).
drop policy if exists waitlist_select on public.match_waitlist;
create policy waitlist_select on public.match_waitlist
    for select using (auth.uid() is not null);

-- Cada jugador se anota y se saca a sí mismo. El organizador puede sacar a
-- alguien de su propia cola (por ejemplo, al promoverlo a confirmado).
drop policy if exists waitlist_insert_self on public.match_waitlist;
create policy waitlist_insert_self on public.match_waitlist
    for insert with check (auth.uid() = id_jugador);

drop policy if exists waitlist_delete_self_or_host on public.match_waitlist;
create policy waitlist_delete_self_or_host on public.match_waitlist
    for delete using (
        auth.uid() = id_jugador
        or exists (
            select 1 from public.matches m
            where m.id = match_waitlist.id_partido
              and m.id_organizador = auth.uid()
        )
    );

-- ---------------------------------------------------------------
-- 4. TIPOS DE NOTIFICACIÓN
-- ---------------------------------------------------------------
-- Se re-declara la lista completa (última versión en la migración 28) más
-- los tipos que necesita este módulo.
alter table public.notifications
    drop constraint if exists notifications_type_check;
alter table public.notifications
    add constraint notifications_type_check
    check (type = any (array[
        'match_join','friend_request','friend_accept','message_new',
        'match_reminder','match_rate','join_request','join_approved',
        'join_rejected','match_cancelled',
        'club_request','club_request_accepted','club_request_rejected',
        'club_member_joined','club_member_left','club_invite_accepted',
        'club_challenge','club_challenge_accepted','club_challenge_rejected',
        -- Módulo Partidos (migración 33)
        'match_updated','match_slot_free','waitlist_turn','match_left',
        'match_attendance'
    ]::text[]));

-- ---------------------------------------------------------------
-- 5. REGLAS CENTRALIZADAS EN POSTGRES
-- ---------------------------------------------------------------
-- Un solo lugar con los números que también usa `src/services/matchRules.js`.
create or replace function public.partido_reglas()
returns jsonb
language sql
immutable
as $$
    select jsonb_build_object(
        'ventana_sin_penalizacion_horas', 2,
        'penalizacion_salir_temprano', 3,
        'penalizacion_salir_tarde', 20,
        'penalizacion_cancelar_temprano', 15,
        'penalizacion_cancelar_tarde', 25,
        'minutos_confirmar_lista_espera', 30,
        'radio_gps_metros', 200,
        'horas_plazo_asistencia', 72,
        'max_cupos', 30
    );
$$;

comment on function public.partido_reglas() is
    'Reglas del módulo Partidos. Si cambian acá, hay que reflejarlas en '
    'src/services/matchRules.js (y viceversa).';

-- ---------------------------------------------------------------
-- 6. RPC: entrar a la lista de espera
-- ---------------------------------------------------------------
create or replace function public.join_waitlist(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid       uuid := auth.uid();
    v_match     record;
    v_pos       integer;
    v_trust     integer;
    v_edad      integer;
begin
    if v_uid is null then
        return jsonb_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    select * into v_match from public.matches where id = p_match_id;
    if not found then
        return jsonb_build_object('ok', false, 'reason', 'El partido no existe');
    end if;
    if v_match.estado <> 'abierto' and v_match.estado <> 'lleno' then
        return jsonb_build_object('ok', false, 'reason', 'Este partido ya no acepta jugadores');
    end if;
    if v_match.hora <= now() then
        return jsonb_build_object('ok', false, 'reason', 'Este partido ya comenzó');
    end if;
    if v_match.id_organizador = v_uid then
        return jsonb_build_object('ok', false, 'reason', 'Organizas este partido');
    end if;
    if exists (
        select 1 from public.attendees
        where id_partido = p_match_id and id_jugador = v_uid
          and estado <> 'cancelado'
    ) then
        return jsonb_build_object('ok', false, 'reason', 'Ya tienes cupo o una solicitud en este partido');
    end if;

    -- Mismos requisitos que para unirse: no tiene sentido dejar entrar a la
    -- cola a alguien que después no podría tomar el cupo.
    select trust_score, edad into v_trust, v_edad
    from public.profiles where id = v_uid;

    if coalesce(v_match.min_trust_score, 0) > 0
       and coalesce(v_trust, 0) < v_match.min_trust_score then
        return jsonb_build_object(
            'ok', false,
            'reason', format('Este partido pide Trust Score %s o más y tú tienes %s',
                             v_match.min_trust_score, coalesce(v_trust, 0))
        );
    end if;
    if v_edad is not null and (
        (v_match.edad_min is not null and v_edad < v_match.edad_min)
        or (v_match.edad_max is not null and v_edad > v_match.edad_max)
    ) then
        return jsonb_build_object('ok', false, 'reason', 'Tu edad está fuera del rango del partido');
    end if;

    insert into public.match_waitlist (id_partido, id_jugador)
    values (p_match_id, v_uid)
    on conflict (id_partido, id_jugador) do nothing;

    select count(*) into v_pos
    from public.match_waitlist w
    where w.id_partido = p_match_id
      and w.created_at <= (
          select created_at from public.match_waitlist
          where id_partido = p_match_id and id_jugador = v_uid
      );

    return jsonb_build_object('ok', true, 'posicion', v_pos);
end;
$$;

grant execute on function public.join_waitlist(uuid) to authenticated;

-- ---------------------------------------------------------------
-- 7. RPC: salir de la lista de espera (sin penalización)
-- ---------------------------------------------------------------
create or replace function public.leave_waitlist(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid uuid := auth.uid();
begin
    if v_uid is null then
        return jsonb_build_object('ok', false, 'reason', 'No autenticado');
    end if;
    delete from public.match_waitlist
    where id_partido = p_match_id and id_jugador = v_uid;
    -- Salir de la lista NO toca el Trust Score, a propósito.
    return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.leave_waitlist(uuid) to authenticated;

-- ---------------------------------------------------------------
-- 8. TRIGGER: cupo liberado → avisar al primero de la cola
-- ---------------------------------------------------------------
create or replace function public.notify_waitlist_slot_free()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_next      record;
    v_minutos   integer := (public.partido_reglas()->>'minutos_confirmar_lista_espera')::int;
begin
    -- Solo cuando pasamos de 0 cupos a tener al menos uno.
    if coalesce(old.cupos_disponibles, 0) > 0 or coalesce(new.cupos_disponibles, 0) <= 0 then
        return new;
    end if;
    if new.estado not in ('abierto', 'lleno') or new.hora <= now() then
        return new;
    end if;

    select * into v_next
    from public.match_waitlist
    where id_partido = new.id
      and avisado_at is null
    order by created_at
    limit 1;

    if not found then
        return new;
    end if;

    update public.match_waitlist
       set avisado_at = now(),
           confirmar_antes_de = now() + make_interval(mins => v_minutos)
     where id = v_next.id;

    insert into public.notifications (user_id, type, title, body, data)
    values (
        v_next.id_jugador,
        'waitlist_turn',
        'Se liberó un cupo',
        format('Quedó un cupo en «%s». Tienes %s min para confirmarlo.', new.titulo, v_minutos),
        jsonb_build_object('matchId', new.id, 'minutos', v_minutos)
    );

    return new;
end;
$$;

drop trigger if exists tg_notify_waitlist_slot_free on public.matches;
create trigger tg_notify_waitlist_slot_free
    after update of cupos_disponibles on public.matches
    for each row
    execute function public.notify_waitlist_slot_free();

-- Cuando alguien toma el cupo, sale de la cola automáticamente.
create or replace function public.waitlist_cleanup_on_join()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    delete from public.match_waitlist
    where id_partido = new.id_partido and id_jugador = new.id_jugador;
    return new;
end;
$$;

drop trigger if exists tg_waitlist_cleanup_on_join on public.attendees;
create trigger tg_waitlist_cleanup_on_join
    after insert on public.attendees
    for each row
    execute function public.waitlist_cleanup_on_join();

-- ---------------------------------------------------------------
-- 9. GUARDA: los cupos no pueden bajar de los confirmados
-- ---------------------------------------------------------------
create or replace function public.matches_guard_cupos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ocupadas integer;
begin
    -- `cupos_totales` son las plazas ofrecidas a OTROS jugadores: el
    -- organizador está en `attendees` pero no consume una. Si se lo contara,
    -- un partido de 1 cupo con solo el organizador quedaría bloqueado.
    select count(*) into v_ocupadas
    from public.attendees
    where id_partido = new.id
      and estado in ('inscrito', 'confirmado_gps', 'no_asistio')
      and id_jugador <> new.id_organizador;

    if new.cupos_totales < v_ocupadas then
        raise exception 'CUPOS_MENOR_QUE_CONFIRMADOS:%:%', new.cupos_totales, v_ocupadas;
    end if;
    if new.cupos_disponibles > new.cupos_totales then
        new.cupos_disponibles := new.cupos_totales;
    end if;
    return new;
end;
$$;

drop trigger if exists tg_matches_guard_cupos on public.matches;
create trigger tg_matches_guard_cupos
    before update of cupos_totales, cupos_disponibles on public.matches
    for each row
    execute function public.matches_guard_cupos();

-- ---------------------------------------------------------------
-- 10. TRIGGER: cambios importantes → avisar a confirmados
-- ---------------------------------------------------------------
create or replace function public.notify_match_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cambios text[] := array[]::text[];
    v_row     record;
    v_body    text;
begin
    if new.estado = 'cancelado' then
        return new; -- la cancelación tiene su propio aviso
    end if;

    if new.hora is distinct from old.hora then
        v_cambios := v_cambios || 'la fecha y hora';
    end if;
    if new.cancha_nombre is distinct from old.cancha_nombre then
        v_cambios := v_cambios || 'la cancha';
    end if;
    if new.comuna is distinct from old.comuna then
        v_cambios := v_cambios || 'la comuna';
    end if;
    if new.precio_cuota is distinct from old.precio_cuota then
        v_cambios := v_cambios || 'la cuota';
    end if;

    if array_length(v_cambios, 1) is null then
        return new;
    end if;

    v_body := format('El organizador cambió %s de «%s».',
                     array_to_string(v_cambios, ', '), new.titulo);

    for v_row in
        select id_jugador from public.attendees
        where id_partido = new.id
          and estado in ('pendiente', 'inscrito', 'confirmado_gps')
          and id_jugador <> new.id_organizador
    loop
        insert into public.notifications (user_id, type, title, body, data)
        values (v_row.id_jugador, 'match_updated', 'Cambió tu partido', v_body,
                jsonb_build_object('matchId', new.id));
    end loop;

    return new;
end;
$$;

drop trigger if exists tg_notify_match_updated on public.matches;
create trigger tg_notify_match_updated
    after update on public.matches
    for each row
    execute function public.notify_match_updated();

-- ---------------------------------------------------------------
-- 11. RPC: guardar asistencia
-- ---------------------------------------------------------------
-- p_marks = { "<uuid del jugador>": "presente" | "ausente" }
create or replace function public.save_match_attendance(p_match_id uuid, p_marks jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid       uuid := auth.uid();
    v_match     record;
    v_fin       timestamptz;
    v_plazo     integer := (public.partido_reglas()->>'horas_plazo_asistencia')::int;
    v_key       text;
    v_val       text;
    v_presentes integer := 0;
    v_ausentes  integer := 0;
    v_prev      text;
begin
    if v_uid is null then
        return jsonb_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    select * into v_match from public.matches where id = p_match_id;
    if not found then
        return jsonb_build_object('ok', false, 'reason', 'El partido no existe');
    end if;
    if v_match.id_organizador <> v_uid then
        return jsonb_build_object('ok', false, 'reason', 'Solo el organizador puede registrar la asistencia');
    end if;

    v_fin := v_match.hora + make_interval(mins => coalesce(v_match.duracion_min, 90));
    if now() < v_fin then
        return jsonb_build_object('ok', false, 'reason', 'El partido todavía no ha terminado');
    end if;
    if now() > v_fin + make_interval(hours => v_plazo) then
        return jsonb_build_object('ok', false, 'reason',
            format('El plazo para registrar la asistencia era de %s h después del partido', v_plazo));
    end if;

    for v_key, v_val in select * from jsonb_each_text(p_marks) loop
        -- Estado previo: solo movemos el Trust Score cuando el estado cambia,
        -- así volver a guardar no premia ni castiga dos veces.
        select estado into v_prev
        from public.attendees
        where id_partido = p_match_id and id_jugador = v_key::uuid;

        if v_prev is null or v_prev in ('pendiente', 'cancelado') then
            continue;
        end if;

        if v_val = 'presente' then
            update public.attendees
               set estado = 'confirmado_gps',
                   confirmado_at = coalesce(confirmado_at, now())
             where id_partido = p_match_id and id_jugador = v_key::uuid;

            if v_prev <> 'confirmado_gps' then
                update public.profiles
                   set trust_score = least(100, trust_score + 2),
                       asistencias_confirmadas = asistencias_confirmadas + 1
                 where id = v_key::uuid;
            end if;
            v_presentes := v_presentes + 1;

        elsif v_val = 'ausente' then
            update public.attendees
               set estado = 'no_asistio'
             where id_partido = p_match_id and id_jugador = v_key::uuid;

            if v_prev <> 'no_asistio' then
                update public.profiles
                   set trust_score = greatest(0, trust_score - 15)
                 where id = v_key::uuid;

                insert into public.notifications (user_id, type, title, body, data)
                values (v_key::uuid, 'match_attendance', 'Quedaste como ausente',
                        format('El organizador marcó que no asististe a «%s».', v_match.titulo),
                        jsonb_build_object('matchId', p_match_id));
            end if;
            v_ausentes := v_ausentes + 1;
        end if;
    end loop;

    -- El partido queda cerrado una vez que se registró la asistencia.
    update public.matches
       set estado = 'finalizado'
     where id = p_match_id and estado not in ('cancelado', 'finalizado');

    return jsonb_build_object('ok', true, 'presentes', v_presentes, 'ausentes', v_ausentes);
end;
$$;

grant execute on function public.save_match_attendance(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------
-- 12. RPCs HEREDADAS — se crean SOLO si faltan
-- ---------------------------------------------------------------
-- La app llamaba estas funciones desde `src/services/matches.js`, pero no
-- estaban versionadas en este repo (se aplicaron a mano en Supabase). Las
-- dejamos versionadas para que un entorno nuevo funcione, sin sobrescribir
-- la versión que ya exista en producción.
do $outer$
begin

-- 12a. get_schedule_conflict --------------------------------------
if to_regprocedure('public.get_schedule_conflict(uuid)') is null then
    execute $fn$
    create function public.get_schedule_conflict(p_match_id uuid)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public
    as $body$
    declare
        v_uid   uuid := auth.uid();
        v_new   record;
        v_other record;
    begin
        if v_uid is null then
            return jsonb_build_object('conflict', false);
        end if;
        select * into v_new from public.matches where id = p_match_id;
        if not found then
            return jsonb_build_object('conflict', false);
        end if;

        -- Choque = solapamiento real de ventanas [hora, hora+duración).
        select m.* into v_other
        from public.matches m
        join public.attendees a on a.id_partido = m.id and a.id_jugador = v_uid
        where m.id <> p_match_id
          and m.estado in ('abierto','lleno','en_curso')
          and a.estado in ('inscrito','confirmado_gps')
          and m.hora < v_new.hora + make_interval(mins => coalesce(v_new.duracion_min, 90))
          and v_new.hora < m.hora + make_interval(mins => coalesce(m.duracion_min, 90))
        order by m.hora
        limit 1;

        if not found then
            return jsonb_build_object('conflict', false);
        end if;

        return jsonb_build_object(
            'conflict', true,
            'matchId', v_other.id,
            'titulo', v_other.titulo,
            'hora', v_other.hora,
            'isOrganizer', v_other.id_organizador = v_uid,
            'canSwap', v_other.id_organizador <> v_uid
        );
    end;
    $body$;
    $fn$;
    execute 'grant execute on function public.get_schedule_conflict(uuid) to authenticated';
end if;

-- 12b. request_join ----------------------------------------------
if to_regprocedure('public.request_join(uuid)') is null then
    execute $fn$
    create function public.request_join(p_match_id uuid)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public
    as $body$
    declare
        v_uid   uuid := auth.uid();
        v_match record;
        v_trust integer;
        v_edad  integer;
    begin
        if v_uid is null then
            return jsonb_build_object('ok', false, 'reason', 'No autenticado');
        end if;
        select * into v_match from public.matches where id = p_match_id;
        if not found then
            return jsonb_build_object('ok', false, 'reason', 'El partido no existe');
        end if;
        if v_match.estado <> 'abierto' then
            return jsonb_build_object('ok', false, 'reason', 'Este partido ya no acepta solicitudes');
        end if;
        if v_match.hora <= now() then
            return jsonb_build_object('ok', false, 'reason', 'Este partido ya comenzó');
        end if;
        if v_match.cupos_disponibles <= 0 then
            return jsonb_build_object('ok', false, 'reason', 'No quedan cupos disponibles');
        end if;
        if v_match.id_organizador = v_uid then
            return jsonb_build_object('ok', false, 'reason', 'Organizas este partido');
        end if;
        if exists (
            select 1 from public.attendees
            where id_partido = p_match_id and id_jugador = v_uid and estado <> 'cancelado'
        ) then
            return jsonb_build_object('ok', false, 'reason', 'Ya tienes una solicitud o un cupo en este partido');
        end if;

        select trust_score, edad into v_trust, v_edad from public.profiles where id = v_uid;
        if coalesce(v_match.min_trust_score, 0) > 0
           and coalesce(v_trust, 0) < v_match.min_trust_score then
            return jsonb_build_object('ok', false, 'reason',
                format('Trust Score insuficiente: este partido pide %s y tú tienes %s',
                       v_match.min_trust_score, coalesce(v_trust, 0)));
        end if;
        if v_edad is not null and (
            (v_match.edad_min is not null and v_edad < v_match.edad_min)
            or (v_match.edad_max is not null and v_edad > v_match.edad_max)
        ) then
            return jsonb_build_object('ok', false, 'reason', 'Tu edad está fuera del rango del partido');
        end if;

        -- Una solicitud pendiente NO reserva cupo.
        insert into public.attendees (id_partido, id_jugador, estado)
        values (p_match_id, v_uid, 'pendiente');

        insert into public.notifications (user_id, type, title, body, data)
        values (v_match.id_organizador, 'join_request', 'Nueva solicitud de cupo',
                format('Alguien quiere unirse a «%s».', v_match.titulo),
                jsonb_build_object('matchId', p_match_id, 'playerId', v_uid));

        return jsonb_build_object('ok', true, 'pending', true);
    end;
    $body$;
    $fn$;
    execute 'grant execute on function public.request_join(uuid) to authenticated';
end if;

-- 12c. approve_join ----------------------------------------------
if to_regprocedure('public.approve_join(uuid,uuid)') is null then
    execute $fn$
    create function public.approve_join(p_match_id uuid, p_player_id uuid)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public
    as $body$
    declare
        v_uid   uuid := auth.uid();
        v_match record;
    begin
        -- Bloqueamos la fila del partido: dos aprobaciones simultáneas no
        -- pueden pasarse de los cupos disponibles.
        select * into v_match from public.matches where id = p_match_id for update;
        if not found then
            return jsonb_build_object('ok', false, 'reason', 'El partido no existe');
        end if;
        if v_match.id_organizador <> v_uid then
            return jsonb_build_object('ok', false, 'reason', 'Solo el organizador puede aceptar solicitudes');
        end if;
        if v_match.cupos_disponibles <= 0 then
            return jsonb_build_object('ok', false, 'reason', 'No quedan cupos disponibles');
        end if;
        if not exists (
            select 1 from public.attendees
            where id_partido = p_match_id and id_jugador = p_player_id and estado = 'pendiente'
        ) then
            return jsonb_build_object('ok', false, 'reason', 'Esa solicitud ya no está pendiente');
        end if;

        update public.attendees
           set estado = 'inscrito'
         where id_partido = p_match_id and id_jugador = p_player_id;

        update public.matches
           set cupos_disponibles = cupos_disponibles - 1,
               estado = case when cupos_disponibles - 1 <= 0 then 'lleno' else estado end
         where id = p_match_id;

        insert into public.notifications (user_id, type, title, body, data)
        values (p_player_id, 'join_approved', 'Te aceptaron en el partido',
                format('Tu cupo en «%s» está confirmado.', v_match.titulo),
                jsonb_build_object('matchId', p_match_id));

        return jsonb_build_object('ok', true);
    end;
    $body$;
    $fn$;
    execute 'grant execute on function public.approve_join(uuid,uuid) to authenticated';
end if;

-- 12d. reject_join -----------------------------------------------
if to_regprocedure('public.reject_join(uuid,uuid)') is null then
    execute $fn$
    create function public.reject_join(p_match_id uuid, p_player_id uuid)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public
    as $body$
    declare
        v_uid   uuid := auth.uid();
        v_match record;
    begin
        select * into v_match from public.matches where id = p_match_id;
        if not found then
            return jsonb_build_object('ok', false, 'reason', 'El partido no existe');
        end if;
        if v_match.id_organizador <> v_uid then
            return jsonb_build_object('ok', false, 'reason', 'Solo el organizador puede rechazar solicitudes');
        end if;

        delete from public.attendees
        where id_partido = p_match_id and id_jugador = p_player_id and estado = 'pendiente';

        insert into public.notifications (user_id, type, title, body, data)
        values (p_player_id, 'join_rejected', 'No quedaste en el partido',
                format('El organizador de «%s» no aceptó tu solicitud.', v_match.titulo),
                jsonb_build_object('matchId', p_match_id));

        return jsonb_build_object('ok', true);
    end;
    $body$;
    $fn$;
    execute 'grant execute on function public.reject_join(uuid,uuid) to authenticated';
end if;

-- 12e. leave_match_penalized -------------------------------------
if to_regprocedure('public.leave_match_penalized(uuid)') is null then
    execute $fn$
    create function public.leave_match_penalized(p_match_id uuid)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public
    as $body$
    declare
        v_uid     uuid := auth.uid();
        v_match   record;
        v_reglas  jsonb := public.partido_reglas();
        v_penalty integer;
        v_estado  text;
        v_row     record;
    begin
        if v_uid is null then
            return jsonb_build_object('ok', false, 'reason', 'No autenticado');
        end if;
        select * into v_match from public.matches where id = p_match_id for update;
        if not found then
            return jsonb_build_object('ok', false, 'reason', 'El partido no existe');
        end if;
        if v_match.id_organizador = v_uid then
            return jsonb_build_object('ok', false, 'reason',
                'Organizas este partido: para cerrarlo tienes que cancelarlo');
        end if;

        select estado into v_estado from public.attendees
        where id_partido = p_match_id and id_jugador = v_uid;
        if v_estado is null or v_estado in ('cancelado', 'pendiente') then
            return jsonb_build_object('ok', false, 'reason', 'No estás inscrito en este partido');
        end if;

        v_penalty := case
            when v_match.hora - now() > make_interval(
                    hours => (v_reglas->>'ventana_sin_penalizacion_horas')::int)
            then (v_reglas->>'penalizacion_salir_temprano')::int
            else (v_reglas->>'penalizacion_salir_tarde')::int
        end;

        delete from public.attendees
        where id_partido = p_match_id and id_jugador = v_uid;

        update public.matches
           set cupos_disponibles = least(cupos_totales, cupos_disponibles + 1),
               estado = case when estado = 'lleno' then 'abierto' else estado end
         where id = p_match_id;

        update public.profiles
           set trust_score = greatest(0, trust_score - v_penalty)
         where id = v_uid;

        -- Avisamos al grupo para que puedan invitar a alguien.
        for v_row in
            select id_jugador from public.attendees
            where id_partido = p_match_id and estado in ('inscrito', 'confirmado_gps')
        loop
            insert into public.notifications (user_id, type, title, body, data)
            values (v_row.id_jugador, 'match_slot_free', 'Se liberó un cupo',
                    format('Alguien salió de «%s». Quedó un cupo libre.', v_match.titulo),
                    jsonb_build_object('matchId', p_match_id));
        end loop;

        return jsonb_build_object('ok', true, 'penalty', v_penalty, 'freed', true);
    end;
    $body$;
    $fn$;
    execute 'grant execute on function public.leave_match_penalized(uuid) to authenticated';
end if;

-- 12f. cancel_match ----------------------------------------------
if to_regprocedure('public.cancel_match(uuid)') is null then
    execute $fn$
    create function public.cancel_match(p_match_id uuid)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public
    as $body$
    declare
        v_uid     uuid := auth.uid();
        v_match   record;
        v_reglas  jsonb := public.partido_reglas();
        v_penalty integer;
        v_row     record;
    begin
        select * into v_match from public.matches where id = p_match_id for update;
        if not found then
            return jsonb_build_object('ok', false, 'reason', 'El partido no existe');
        end if;
        if v_match.id_organizador <> v_uid then
            return jsonb_build_object('ok', false, 'reason', 'Solo el organizador puede cancelar el partido');
        end if;
        if v_match.estado = 'cancelado' then
            return jsonb_build_object('ok', true, 'penalty', 0, 'already', true);
        end if;

        v_penalty := case
            when v_match.hora - now() > make_interval(
                    hours => (v_reglas->>'ventana_sin_penalizacion_horas')::int)
            then (v_reglas->>'penalizacion_cancelar_temprano')::int
            else (v_reglas->>'penalizacion_cancelar_tarde')::int
        end;

        -- No se borra el registro: queda en el historial como cancelado.
        update public.matches set estado = 'cancelado' where id = p_match_id;

        update public.profiles
           set trust_score = greatest(0, trust_score - v_penalty)
         where id = v_uid;

        for v_row in
            select id_jugador from public.attendees
            where id_partido = p_match_id
              and estado in ('pendiente', 'inscrito', 'confirmado_gps')
              and id_jugador <> v_uid
        loop
            insert into public.notifications (user_id, type, title, body, data)
            values (v_row.id_jugador, 'match_cancelled', 'Se canceló el partido',
                    format('«%s» fue cancelado por el organizador.', v_match.titulo),
                    jsonb_build_object('matchId', p_match_id));
        end loop;

        for v_row in
            select id_jugador from public.match_waitlist where id_partido = p_match_id
        loop
            insert into public.notifications (user_id, type, title, body, data)
            values (v_row.id_jugador, 'match_cancelled', 'Se canceló el partido',
                    format('«%s» fue cancelado, así que la lista de espera se cerró.', v_match.titulo),
                    jsonb_build_object('matchId', p_match_id));
        end loop;

        delete from public.match_waitlist where id_partido = p_match_id;

        return jsonb_build_object('ok', true, 'penalty', v_penalty);
    end;
    $body$;
    $fn$;
    execute 'grant execute on function public.cancel_match(uuid) to authenticated';
end if;

-- 12g. swap_match ------------------------------------------------
if to_regprocedure('public.swap_match(uuid,uuid)') is null then
    execute $fn$
    create function public.swap_match(p_old uuid, p_new uuid)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public
    as $body$
    declare
        v_left jsonb;
        v_join jsonb;
        v_new  record;
    begin
        v_left := public.leave_match_penalized(p_old);
        if not coalesce((v_left->>'ok')::boolean, false) then
            return v_left;
        end if;

        select * into v_new from public.matches where id = p_new;
        if v_new.aprobacion = 'manual' then
            v_join := public.request_join(p_new);
            if coalesce((v_join->>'ok')::boolean, false) then
                return jsonb_build_object('ok', true, 'pending', true,
                                          'penalty', v_left->>'penalty');
            end if;
            return v_join;
        end if;

        v_join := public.join_match(p_new);
        if coalesce((v_join->>'ok')::boolean, false) then
            return jsonb_build_object('ok', true, 'pending', false,
                                      'penalty', v_left->>'penalty');
        end if;
        return v_join;
    end;
    $body$;
    $fn$;
    execute 'grant execute on function public.swap_match(uuid,uuid) to authenticated';
end if;

-- 12h. cancel_match_and_join -------------------------------------
if to_regprocedure('public.cancel_match_and_join(uuid,uuid)') is null then
    execute $fn$
    create function public.cancel_match_and_join(p_old uuid, p_new uuid)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public
    as $body$
    declare
        v_cancel jsonb;
        v_join   jsonb;
        v_new    record;
    begin
        v_cancel := public.cancel_match(p_old);
        if not coalesce((v_cancel->>'ok')::boolean, false) then
            return v_cancel;
        end if;

        select * into v_new from public.matches where id = p_new;
        if v_new.aprobacion = 'manual' then
            v_join := public.request_join(p_new);
            if coalesce((v_join->>'ok')::boolean, false) then
                return jsonb_build_object('ok', true, 'pending', true,
                                          'penalty', v_cancel->>'penalty');
            end if;
            return v_join;
        end if;

        v_join := public.join_match(p_new);
        if coalesce((v_join->>'ok')::boolean, false) then
            return jsonb_build_object('ok', true, 'pending', false,
                                      'penalty', v_cancel->>'penalty');
        end if;
        return v_join;
    end;
    $body$;
    $fn$;
    execute 'grant execute on function public.cancel_match_and_join(uuid,uuid) to authenticated';
end if;

end
$outer$;

-- ---------------------------------------------------------------
-- 13. RLS: el jugador puede retirar su propia solicitud pendiente
-- ---------------------------------------------------------------
drop policy if exists attendees_delete_own_pending on public.attendees;
create policy attendees_delete_own_pending on public.attendees
    for delete using (
        auth.uid() = id_jugador and estado = 'pendiente'
    );
