-- =============================================================
-- FutFinder migration 119: permisos del club
-- =============================================================
-- HASTA HOY, TODO GATE DEL CLUB ES BINARIO: `rol = 'admin'`, repetido a
-- mano en unas quince políticas RLS y funciones distintas. `capitan`
-- existe como valor de `club_members.rol` desde la migración 90, pero
-- sólo una de esas quince líneas lo mira (`club_lineups`, migración 92);
-- las demás lo tratan exactamente igual que `jugador`. Esta migración
-- agrega un sistema de verdad: el admin decide, POR ROL (capitán y
-- jugador — admin siempre tiene todo, nunca se limita), qué puede hacer
-- cada uno en nueve áreas, y puede abrir excepciones por integrante.
--
-- QUÉ NO ENTRA, Y POR QUÉ. El mockup de referencia («FutFinder
-- Permisos») trae 11 permisos; acá sólo van nueve:
--   · «Confirmar asistencia de otros» NO es una acción propia — viaja
--     como el parámetro `p_asistencia` DENTRO de `proponer_resultado()`
--     (ver migración 48), así que no hay una puerta separada que abrir
--     sin inventar una. Queda cubierta por el permiso `results`.
--   · «Ver estadísticas privadas» no tiene NINGÚN dato ni pantalla real
--     detrás — «reputación interna» y «asistencia histórica» no existen
--     en el esquema. Agregar el permiso sería fabricar un candado para
--     una puerta que no está construida.
--
-- LA TABLA GUARDA EL ESTADO ACTUAL, NO SE CALCULA CADA VEZ. Un permiso
-- por (club, rol) — nueve filas por rol, dieciocho por club— más las
-- excepciones puntuales por integrante. `tiene_permiso_de_club()` es el
-- único lugar que las combina: admin (siempre todo) → excepción propia,
-- si existe → lo que tenga su rol → `false` si no hay nada. Cada política
-- y función reescrita más abajo llama a esa única función en vez de
-- repetir `rol = 'admin'` una vez más.
--
-- LOS CLUBES QUE YA EXISTEN NO CAMBIAN DE COMPORTAMIENTO HOY. La fila
-- sembrada para cada club (nuevo o existente) es la MISMA regla que ya
-- corre en producción: capitán sólo tiene `lineup` (lo único que ya
-- distinguía capitán de jugador), todo lo demás apagado para los dos
-- roles. Los permisos «sugeridos» del mockup —capitán con casi todo
-- encendido, jugador con `invite` encendido— NO se aplican solos: sólo
-- se llega a ellos si un administrador entra a «Permisos de club» y
-- toca «Restaurar». Aplicar el sugerido de una sola vez, sin que nadie
-- lo pidiera, sería cambiarle el comportamiento a un club sin que su
-- administrador hiciera nada.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── 1. Las tablas ────────────────────────────────────────────
create table if not exists public.club_role_permissions (
    club_id    uuid not null references public.clubs(id) on delete cascade,
    rol        text not null check (rol in ('capitan', 'jugador')),
    permiso    text not null check (permiso in (
        'pubChallenge', 'answerChallenge', 'chatClubs',
        'invite', 'removeMembers', 'editNicks',
        'lineup', 'results',
        'editClub'
    )),
    activo     boolean not null default false,
    updated_at timestamptz not null default now(),
    primary key (club_id, rol, permiso)
);

create table if not exists public.club_member_permission_overrides (
    club_id    uuid not null references public.clubs(id) on delete cascade,
    user_id    uuid not null references auth.users(id) on delete cascade,
    permiso    text not null check (permiso in (
        'pubChallenge', 'answerChallenge', 'chatClubs',
        'invite', 'removeMembers', 'editNicks',
        'lineup', 'results',
        'editClub'
    )),
    activo     boolean not null,
    updated_at timestamptz not null default now(),
    primary key (club_id, user_id, permiso)
);

alter table public.club_role_permissions enable row level security;
alter table public.club_member_permission_overrides enable row level security;

-- Lectura abierta a cualquier miembro del club: un jugador puede ver qué
-- puede hacer su propio rol, igual que ya puede ver quién administra su
-- club (`club_members_read` es `using (true)`). Toda escritura pasa por
-- las RPC de la sección 3 — ninguna política de insert/update/delete se
-- agrega a propósito, así que un `update` directo desde el cliente
-- siempre falla.
drop policy if exists club_role_permissions_read on public.club_role_permissions;
create policy club_role_permissions_read on public.club_role_permissions
    for select
    using (
        exists (
            select 1 from public.club_members m
            where m.club_id = club_role_permissions.club_id
              and m.user_id = auth.uid()
        )
    );

-- Las excepciones sí son más privadas: sólo las ve un administrador del
-- club (que las gestiona) o el propio integrante afectado (para saber
-- por qué puede hacer algo que su rol no le daría).
drop policy if exists club_member_permission_overrides_read on public.club_member_permission_overrides;
create policy club_member_permission_overrides_read on public.club_member_permission_overrides
    for select
    using (
        auth.uid() = user_id
        or exists (
            select 1 from public.club_members m
            where m.club_id = club_member_permission_overrides.club_id
              and m.user_id = auth.uid()
              and m.rol = 'admin'
        )
    );

revoke insert, update, delete on public.club_role_permissions from anon, authenticated;
revoke insert, update, delete on public.club_member_permission_overrides from anon, authenticated;

comment on table public.club_role_permissions is
    'Qué puede hacer cada rol (capitan/jugador) en cada club. admin no tiene fila: siempre tiene los nueve permisos, nunca se guarda ni se limita.';
comment on table public.club_member_permission_overrides is
    'Excepciones puntuales por integrante. La presencia de una fila es la excepción; su ausencia significa "usa lo de su rol".';

-- ── 2. La única función que decide ──────────────────────────
create or replace function public.tiene_permiso_de_club(
    p_club_id uuid,
    p_user_id uuid,
    p_permiso text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(
        (
            select true
              from public.club_members m
             where m.club_id = p_club_id
               and m.user_id = p_user_id
               and m.rol = 'admin'
        ),
        (
            select o.activo
              from public.club_member_permission_overrides o
             where o.club_id = p_club_id
               and o.user_id = p_user_id
               and o.permiso = p_permiso
        ),
        (
            select r.activo
              from public.club_members m
              join public.club_role_permissions r
                on r.club_id = m.club_id
               and r.rol = m.rol
               and r.permiso = p_permiso
             where m.club_id = p_club_id
               and m.user_id = p_user_id
        ),
        false
    );
$$;

revoke execute on function public.tiene_permiso_de_club(uuid, uuid, text) from anon;
grant execute on function public.tiene_permiso_de_club(uuid, uuid, text) to authenticated;

comment on function public.tiene_permiso_de_club is
    'admin: siempre true. Si no, la excepción propia si existe. Si no, lo que tenga su rol. Si nada de eso, false — nunca se inventa un sí.';

-- ── 3. Sembrado: la regla de HOY, no la sugerida ────────────
-- Nueve filas por rol × dos roles = las dieciocho que hacen falta para
-- que `tiene_permiso_de_club()` nunca tenga que adivinar. `on conflict
-- do nothing`: re-ejecutar esta migración no pisa un permiso que un
-- administrador ya haya cambiado a mano.
create or replace function public._sembrar_permisos_actuales(p_club_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
    insert into public.club_role_permissions (club_id, rol, permiso, activo)
    select p_club_id, rol, permiso, (rol = 'capitan' and permiso = 'lineup')
      from unnest(array['capitan', 'jugador']) as rol
      cross join unnest(array[
          'pubChallenge', 'answerChallenge', 'chatClubs',
          'invite', 'removeMembers', 'editNicks',
          'lineup', 'results', 'editClub'
      ]) as permiso
    on conflict (club_id, rol, permiso) do nothing;
$$;

-- Backfill: todos los clubes que ya existen, con la regla que ya corre
-- para ellos hoy — capitán sólo con `lineup`, nada más para nadie.
do $$
declare
    v_club record;
begin
    for v_club in select id from public.clubs loop
        perform public._sembrar_permisos_actuales(v_club.id);
    end loop;
end $$;

-- De acá en adelante, todo club nuevo nace con la misma regla.
create or replace function public._club_sembrar_permisos_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public._sembrar_permisos_actuales(new.id);
    return new;
end;
$$;

drop trigger if exists club_sembrar_permisos on public.clubs;
create trigger club_sembrar_permisos
    after insert on public.clubs
    for each row execute function public._club_sembrar_permisos_trigger();

-- ── 4. Las RPC que el admin usa desde «Permisos de club» ────
-- Guarda TODOS los permisos de un rol de una vez — la pantalla manda el
-- grupo completo después de tocar un switch, no una llamada por toggle.
create or replace function public.club_guardar_permisos_rol(
    p_club_id  uuid,
    p_rol      text,
    p_permisos jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
    v_permiso text;
begin
    if v_me is null then
        raise exception 'No autenticado' using errcode = '42501';
    end if;
    if p_rol not in ('capitan', 'jugador') then
        raise exception 'Rol no válido' using errcode = 'check_violation';
    end if;
    if not exists (
        select 1 from public.club_members m
        where m.club_id = p_club_id and m.user_id = v_me and m.rol = 'admin'
    ) then
        raise exception 'Sólo un administrador del club puede cambiar sus permisos'
            using errcode = '42501';
    end if;

    for v_permiso in select jsonb_object_keys(p_permisos) loop
        if v_permiso not in (
            'pubChallenge', 'answerChallenge', 'chatClubs',
            'invite', 'removeMembers', 'editNicks',
            'lineup', 'results', 'editClub'
        ) then
            raise exception 'Permiso desconocido: %', v_permiso
                using errcode = 'check_violation';
        end if;

        insert into public.club_role_permissions (club_id, rol, permiso, activo, updated_at)
        values (p_club_id, p_rol, v_permiso, (p_permisos ->> v_permiso)::boolean, now())
        on conflict (club_id, rol, permiso)
            do update set activo = excluded.activo, updated_at = now();
    end loop;
end;
$$;

-- Una excepción puntual: un switch del sheet de un integrante.
create or replace function public.club_guardar_permiso_integrante(
    p_club_id uuid,
    p_user_id uuid,
    p_permiso text,
    p_activo  boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
begin
    if v_me is null then
        raise exception 'No autenticado' using errcode = '42501';
    end if;
    if p_permiso not in (
        'pubChallenge', 'answerChallenge', 'chatClubs',
        'invite', 'removeMembers', 'editNicks',
        'lineup', 'results', 'editClub'
    ) then
        raise exception 'Permiso desconocido: %', p_permiso using errcode = 'check_violation';
    end if;
    if not exists (
        select 1 from public.club_members m
        where m.club_id = p_club_id and m.user_id = v_me and m.rol = 'admin'
    ) then
        raise exception 'Sólo un administrador del club puede cambiar excepciones'
            using errcode = '42501';
    end if;
    -- Al admin no se le abren ni cierran excepciones: siempre tiene todo.
    if exists (
        select 1 from public.club_members m
        where m.club_id = p_club_id and m.user_id = p_user_id and m.rol = 'admin'
    ) then
        raise exception 'El administrador no se limita: primero cámbiale el rol'
            using errcode = 'check_violation';
    end if;

    insert into public.club_member_permission_overrides (club_id, user_id, permiso, activo, updated_at)
    values (p_club_id, p_user_id, p_permiso, p_activo, now())
    on conflict (club_id, user_id, permiso)
        do update set activo = excluded.activo, updated_at = now();
end;
$$;

-- «Usar los del rol»: borra TODAS las excepciones de un integrante.
create or replace function public.club_quitar_excepciones_integrante(
    p_club_id uuid,
    p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
begin
    if v_me is null then
        raise exception 'No autenticado' using errcode = '42501';
    end if;
    if not exists (
        select 1 from public.club_members m
        where m.club_id = p_club_id and m.user_id = v_me and m.rol = 'admin'
    ) then
        raise exception 'Sólo un administrador del club puede cambiar excepciones'
            using errcode = '42501';
    end if;

    delete from public.club_member_permission_overrides
     where club_id = p_club_id and user_id = p_user_id;
end;
$$;

-- «Restaurar»: vuelve a los permisos SUGERIDOS (no a los de hoy) y
-- borra todas las excepciones del club entero. Es la única puerta por
-- la que un club llega a los valores más generosos del mockup — nunca
-- se aplican solos.
create or replace function public.club_restaurar_permisos_default(
    p_club_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
    v_sugerido jsonb := jsonb_build_object(
        'capitan', jsonb_build_object(
            'pubChallenge', true, 'answerChallenge', true, 'chatClubs', true,
            'invite', true, 'removeMembers', false, 'editNicks', true,
            'lineup', true, 'results', true, 'editClub', false
        ),
        'jugador', jsonb_build_object(
            'pubChallenge', false, 'answerChallenge', false, 'chatClubs', false,
            'invite', true, 'removeMembers', false, 'editNicks', false,
            'lineup', false, 'results', false, 'editClub', false
        )
    );
    v_rol text;
    v_permiso text;
begin
    if v_me is null then
        raise exception 'No autenticado' using errcode = '42501';
    end if;
    if not exists (
        select 1 from public.club_members m
        where m.club_id = p_club_id and m.user_id = v_me and m.rol = 'admin'
    ) then
        raise exception 'Sólo un administrador del club puede restaurar los permisos'
            using errcode = '42501';
    end if;

    for v_rol in select jsonb_object_keys(v_sugerido) loop
        for v_permiso in select jsonb_object_keys(v_sugerido -> v_rol) loop
            insert into public.club_role_permissions (club_id, rol, permiso, activo, updated_at)
            values (p_club_id, v_rol, v_permiso, (v_sugerido -> v_rol ->> v_permiso)::boolean, now())
            on conflict (club_id, rol, permiso)
                do update set activo = excluded.activo, updated_at = now();
        end loop;
    end loop;

    delete from public.club_member_permission_overrides where club_id = p_club_id;
end;
$$;

revoke execute on function public.club_guardar_permisos_rol(uuid, text, jsonb) from anon;
revoke execute on function public.club_guardar_permiso_integrante(uuid, uuid, text, boolean) from anon;
revoke execute on function public.club_quitar_excepciones_integrante(uuid, uuid) from anon;
revoke execute on function public.club_restaurar_permisos_default(uuid) from anon;
grant execute on function public.club_guardar_permisos_rol(uuid, text, jsonb) to authenticated;
grant execute on function public.club_guardar_permiso_integrante(uuid, uuid, text, boolean) to authenticated;
grant execute on function public.club_quitar_excepciones_integrante(uuid, uuid) to authenticated;
grant execute on function public.club_restaurar_permisos_default(uuid) to authenticated;

-- ── 5. Los nueve permisos aplicados de verdad ───────────────
-- Cada bloque reescribe ENTERA la política o función que hoy dice
-- `rol = 'admin'`, cambiando esa condición por `tiene_permiso_de_club()`
-- — todo lo demás queda textualmente igual que en su migración de
-- origen, citada en cada comentario.

-- editClub — clubs_update (migración 20).
drop policy if exists "clubs_update" on public.clubs;
create policy "clubs_update"
    on public.clubs for update
    using (
        public.tiene_permiso_de_club(clubs.id, auth.uid(), 'editClub')
    );

-- removeMembers — club_members_delete (migración 20): se conserva el
-- self-leave y que un admin de verdad pueda expulsar a cualquiera —
-- incluido otro admin, en un club premium con varios—, tal cual hacía
-- antes. LO NUEVO es la tercera rama, y necesita una condición que la
-- vieja política no necesitaba: quien tiene el permiso CONCEDIDO (no
-- porque sea admin) puede expulsar a un jugador o capitán, pero NUNCA a
-- un admin — si no, conceder este permiso a un jugador sería dejarlo
-- destituir a su propio administrador.
drop policy if exists "club_members_delete" on public.club_members;
create policy "club_members_delete"
    on public.club_members for delete
    using (
        auth.uid() = user_id
        or exists (
            select 1 from public.club_members yo
            where yo.club_id = club_members.club_id
              and yo.user_id = auth.uid()
              and yo.rol = 'admin'
        )
        or (
            club_members.rol <> 'admin'
            and public.tiene_permiso_de_club(club_members.club_id, auth.uid(), 'removeMembers')
        )
    );

-- invite — club_join_requests_insert (migración 20): sólo cambia la
-- rama `tipo = 'invitacion'`; `tipo = 'solicitud'` (el jugador pide
-- entrar) sigue exactamente igual.
drop policy if exists "club_join_requests_insert" on public.club_join_requests;
create policy "club_join_requests_insert"
    on public.club_join_requests for insert
    with check (
        (tipo = 'solicitud' and auth.uid() = user_id)
        or (
            tipo = 'invitacion'
            and auth.uid() <> user_id
            and public.tiene_permiso_de_club(club_join_requests.club_id, auth.uid(), 'invite')
        )
    );

-- editNicks — set_apodo_club() (migración 91): sólo cambia la condición
-- de rechazo; el resto de la función queda igual.
create or replace function public.set_apodo_club(p_member_id uuid, p_apodo text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_target public.club_members%rowtype;
    v_yo     public.club_members%rowtype;
    v_limpio text;
begin
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;

    select * into v_target from public.club_members where id = p_member_id;
    if v_target.id is null then
        raise exception 'Integrante no encontrado';
    end if;

    select * into v_yo from public.club_members
     where club_id = v_target.club_id and user_id = auth.uid();
    if v_yo.id is null then
        raise exception 'No perteneces a este club';
    end if;

    if v_yo.id <> v_target.id
       and not public.tiene_permiso_de_club(v_target.club_id, auth.uid(), 'editNicks') then
        raise exception 'Solo esa persona o alguien con permiso puede cambiar este apodo';
    end if;

    v_limpio := trim(coalesce(p_apodo, ''));

    if v_limpio = '' then
        delete from public.club_member_apodos where member_id = p_member_id;
        return json_build_object('ok', true, 'apodo', null);
    end if;

    if length(v_limpio) > 18 then
        raise exception 'El apodo no puede tener más de 18 caracteres';
    end if;

    insert into public.club_member_apodos (member_id, apodo, updated_at)
    values (p_member_id, v_limpio, now())
    on conflict (member_id) do update
        set apodo = excluded.apodo, updated_at = now();

    return json_build_object('ok', true, 'apodo', v_limpio);
end;
$$;

-- lineup — club_lineups_insert/_update (migración 92): reemplaza el
-- `rol in ('admin','capitan')` fijo por el permiso configurable, que
-- sigue partiendo con capitán=true/jugador=false (sección 3) — el mismo
-- comportamiento de hoy hasta que un administrador lo cambie.
drop policy if exists club_lineups_insert on public.club_lineups;
create policy club_lineups_insert on public.club_lineups
    for insert
    with check (
        updated_by = auth.uid()
        and public.tiene_permiso_de_club(club_lineups.club_id, auth.uid(), 'lineup')
    );

drop policy if exists club_lineups_update on public.club_lineups;
create policy club_lineups_update on public.club_lineups
    for update
    using (
        public.tiene_permiso_de_club(club_lineups.club_id, auth.uid(), 'lineup')
    )
    with check (
        updated_by = auth.uid()
        and public.tiene_permiso_de_club(club_lineups.club_id, auth.uid(), 'lineup')
    );

-- pubChallenge — crear un desafío, de las dos formas que existen hoy:
-- club_challenges_insert (desafío directo, migración 26) y
-- club_open_challenges_insert/_update (tablero abierto, migración 112).
-- Editar o retirar lo que uno mismo publicó en el tablero abierto viaja
-- con el mismo permiso: es la misma capacidad, "publicar", aplicada a
-- gestionar lo ya publicado.
drop policy if exists "club_challenges_insert" on public.club_challenges;
create policy "club_challenges_insert"
    on public.club_challenges for insert
    with check (
        creado_por = auth.uid()
        and public.tiene_permiso_de_club(club_retador_id, auth.uid(), 'pubChallenge')
    );

drop policy if exists club_open_challenges_insert on public.club_open_challenges;
create policy club_open_challenges_insert on public.club_open_challenges
    for insert
    with check (
        creado_por = auth.uid()
        and estado = 'abierto'
        and public.tiene_permiso_de_club(club_open_challenges.club_id, auth.uid(), 'pubChallenge')
    );

drop policy if exists club_open_challenges_update on public.club_open_challenges;
create policy club_open_challenges_update on public.club_open_challenges
    for update
    using (
        public.tiene_permiso_de_club(club_open_challenges.club_id, auth.uid(), 'pubChallenge')
    )
    with check (estado in ('abierto', 'cancelado'));

-- answerChallenge — responder (aceptar/rechazar) un desafío directo, y
-- lo mismo del lado del tablero abierto: responder a la publicación de
-- otro club, y que el club que publicó elija o rechace una respuesta.
--
-- club_challenges_update (migración 26) sirve para DOS cosas con la
-- misma política —responder el que fue retado, cancelar el que retó—
-- y la RLS no distingue cuál transición es. Antes las dos pedían
-- `rol = 'admin'` igual, así que acá las dos piden "puede responder O
-- puede publicar", sin partir la política en dos.
drop policy if exists "club_challenges_update" on public.club_challenges;
create policy "club_challenges_update"
    on public.club_challenges for update
    using (
        exists (
            select 1 from public.club_members m
            where m.user_id = auth.uid()
              and m.club_id in (club_retador_id, club_retado_id)
              and (
                  public.tiene_permiso_de_club(m.club_id, auth.uid(), 'answerChallenge')
                  or public.tiene_permiso_de_club(m.club_id, auth.uid(), 'pubChallenge')
              )
        )
    );

drop policy if exists club_open_challenge_responses_insert on public.club_open_challenge_responses;
create policy club_open_challenge_responses_insert on public.club_open_challenge_responses
    for insert
    with check (
        creado_por = auth.uid()
        and estado = 'pendiente'
        and public.tiene_permiso_de_club(club_open_challenge_responses.club_id, auth.uid(), 'answerChallenge')
        and exists (
            select 1 from public.club_open_challenges oc
            where oc.id = club_open_challenge_responses.open_challenge_id
              and oc.estado = 'abierto'
              and oc.club_id <> club_open_challenge_responses.club_id
        )
    );

drop policy if exists club_open_challenge_responses_update_mine on public.club_open_challenge_responses;
create policy club_open_challenge_responses_update_mine on public.club_open_challenge_responses
    for update
    using (
        public.tiene_permiso_de_club(club_open_challenge_responses.club_id, auth.uid(), 'answerChallenge')
    )
    with check (estado in ('pendiente', 'retirada'));

drop policy if exists club_open_challenge_responses_update_owner on public.club_open_challenge_responses;
create policy club_open_challenge_responses_update_owner on public.club_open_challenge_responses
    for update
    using (
        exists (
            select 1
              from public.club_open_challenges oc
             where oc.id = club_open_challenge_responses.open_challenge_id
               and public.tiene_permiso_de_club(oc.club_id, auth.uid(), 'answerChallenge')
        )
    )
    with check (estado in ('pendiente', 'rechazada'));

-- aceptar_desafio() (migración 47): sólo cambia la comprobación de quién
-- puede aceptar; el resto de la función —sanciones, cupos, chat,
-- avisos— queda textualmente igual.
create or replace function public.aceptar_desafio(p_challenge_id uuid)
returns public.club_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me         uuid := auth.uid();
    v_row        public.club_challenges;
    v_retador    text;
    v_retado     text;
    v_thread_key text;
    v_horas      int;
    v_admin      record;
begin
    if v_me is null then
        raise exception 'No autenticado' using errcode = '42501';
    end if;

    select * into v_row
      from public.club_challenges
     where id = p_challenge_id
     for update;

    if not found then
        raise exception 'Este desafío ya no existe' using errcode = 'no_data_found';
    end if;

    if v_row.estado = 'negociacion' then
        return v_row;
    end if;

    if v_row.estado <> 'pendiente' then
        raise exception 'Este desafío ya no está pendiente'
            using errcode = 'check_violation';
    end if;

    if not public.tiene_permiso_de_club(v_row.club_retado_id, v_me, 'answerChallenge') then
        raise exception 'No tienes permiso para aceptar desafíos de este club'
            using errcode = '42501';
    end if;

    if public.club_esta_sancionado(v_row.club_retado_id) then
        raise exception 'Tu club está sancionado y no puede aceptar desafíos'
            using errcode = 'check_violation';
    end if;
    if public.club_esta_sancionado(v_row.club_retador_id) then
        raise exception 'El club que te desafió está sancionado: el partido no se podría publicar'
            using errcode = 'check_violation';
    end if;

    v_horas := (public.desafio_reglas() ->> 'negociacion_horas')::int;

    begin
        update public.club_challenges
           set estado               = 'negociacion',
               responded_at         = now(),
               respondido_por       = v_me,
               negociacion_vence_at = now() + make_interval(hours => v_horas)
         where id = p_challenge_id
           and estado = 'pendiente'
        returning * into v_row;
    exception when unique_violation then
        raise exception 'Ya tienen un desafío en curso con este club'
            using errcode = 'unique_violation';
    end;

    v_thread_key := 'challenge:' || v_row.id::text;

    select nombre into v_retador from public.clubs where id = v_row.club_retador_id;
    select nombre into v_retado  from public.clubs where id = v_row.club_retado_id;

    insert into public.club_challenge_events (challenge_id, tipo, actor_id, club_id, payload)
    values (
        v_row.id,
        'aceptado',
        v_me,
        v_row.club_retado_id,
        jsonb_build_object(
            'vence_at', v_row.negociacion_vence_at,
            'horas', v_horas
        )
    );

    insert into public.messages (sender_id, challenge_id, content)
    values (
        v_me,
        v_row.id,
        '⚔️ Desafío aceptado. Tienen ' || v_horas
            || ' horas para acordar cancha, fecha y hora del partido.'
    );

    for v_admin in
        select m.user_id, m.club_id
          from public.club_members m
         where m.rol = 'admin'
           and m.club_id in (v_row.club_retador_id, v_row.club_retado_id)
           and m.user_id <> v_me
    loop
        insert into public.notifications (user_id, type, title, body, data)
        values (
            v_admin.user_id,
            'club_challenge_accepted',
            case when v_admin.club_id = v_row.club_retador_id
                 then '⚔️ ' || coalesce(v_retado, 'El club') || ' aceptó tu desafío'
                 else '⚔️ Desafío aceptado contra ' || coalesce(v_retador, 'otro club')
            end,
            'Se abrió el chat de negociación con los administradores de ambos clubes.',
            jsonb_build_object(
                'challengeId',   v_row.id,
                'clubRetadorId', v_row.club_retador_id,
                'clubRetadoId',  v_row.club_retado_id,
                'threadKey',     v_thread_key
            )
        );
    end loop;

    return v_row;
end;
$$;

revoke execute on function public.aceptar_desafio(uuid) from anon;
grant execute on function public.aceptar_desafio(uuid) to authenticated;

-- aceptar_respuesta_desafio_abierto() (migración 112): sólo cambia la
-- comprobación de quién puede elegir una respuesta.
create or replace function public.aceptar_respuesta_desafio_abierto(p_response_id uuid)
returns public.club_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me       uuid := auth.uid();
    v_resp     public.club_open_challenge_responses%rowtype;
    v_open     public.club_open_challenges%rowtype;
    v_challenge public.club_challenges;
begin
    if v_me is null then
        raise exception 'No autenticado' using errcode = '42501';
    end if;

    select * into v_resp
      from public.club_open_challenge_responses
     where id = p_response_id
     for update;
    if not found then
        raise exception 'Esta respuesta ya no existe' using errcode = 'no_data_found';
    end if;

    select * into v_open
      from public.club_open_challenges
     where id = v_resp.open_challenge_id
     for update;
    if not found then
        raise exception 'Esta publicación ya no existe' using errcode = 'no_data_found';
    end if;

    if v_resp.estado = 'aceptada' and v_open.resultante_challenge_id is not null then
        select * into v_challenge
          from public.club_challenges
         where id = v_open.resultante_challenge_id;
        return v_challenge;
    end if;

    if v_open.estado <> 'abierto' then
        raise exception 'Esta publicación ya no está abierta'
            using errcode = 'check_violation';
    end if;
    if v_resp.estado <> 'pendiente' then
        raise exception 'Esta respuesta ya no está pendiente'
            using errcode = 'check_violation';
    end if;

    if not public.tiene_permiso_de_club(v_open.club_id, v_me, 'answerChallenge') then
        raise exception 'No tienes permiso para elegir una respuesta de esta publicación'
            using errcode = '42501';
    end if;

    insert into public.club_challenges (
        club_retador_id, club_retado_id, creado_por,
        fecha_propuesta, zona, mensaje
    ) values (
        v_resp.club_id, v_open.club_id, v_resp.creado_por,
        v_open.fecha_propuesta, v_open.zona,
        coalesce(v_resp.mensaje, v_open.mensaje)
    )
    returning * into v_challenge;

    select * into v_challenge from public.aceptar_desafio(v_challenge.id);

    update public.club_open_challenges
       set estado = 'cerrado', resultante_challenge_id = v_challenge.id
     where id = v_open.id;

    update public.club_open_challenge_responses
       set estado = 'aceptada'
     where id = v_resp.id;

    update public.club_open_challenge_responses
       set estado = 'rechazada'
     where open_challenge_id = v_open.id
       and id <> v_resp.id
       and estado = 'pendiente';

    return v_challenge;
end;
$$;

revoke execute on function public.aceptar_respuesta_desafio_abierto(uuid) from anon;
grant execute on function public.aceptar_respuesta_desafio_abierto(uuid) to authenticated;

-- chatClubs — el chat de negociación de un desafío (migración 42, el
-- mecanismo vigente) y el DM legado por `estado = 'aceptado'`
-- (migración 36, para desafíos anteriores a la 41 que aún viven ahí).
create or replace function public.chat_puede_ver_desafio(
    p_challenge_id uuid,
    p_user uuid
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
    select exists (
        select 1
        from public.club_challenges c
        join public.club_members m
          on m.user_id = p_user
         and m.club_id in (c.club_retador_id, c.club_retado_id)
        where c.id = p_challenge_id
          and public.tiene_permiso_de_club(m.club_id, p_user, 'chatClubs')
    );
$$;

create or replace function public.chat_puede_escribir_desafio(
    p_challenge_id uuid,
    p_user uuid
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
    select exists (
        select 1
        from public.club_challenges c
        join public.club_members m
          on m.user_id = p_user
         and m.club_id in (c.club_retador_id, c.club_retado_id)
        where c.id = p_challenge_id
          and c.estado in (
              select jsonb_array_elements_text(public.desafio_reglas() -> 'estados_activos')
          )
          and public.tiene_permiso_de_club(m.club_id, p_user, 'chatClubs')
    );
$$;

grant execute on function public.chat_puede_ver_desafio(uuid, uuid) to authenticated;
grant execute on function public.chat_puede_escribir_desafio(uuid, uuid) to authenticated;

create or replace function public.chat_valid_club_challenge_dm(p_user1 uuid, p_user2 uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.club_challenges c
        join public.club_members m1
          on m1.user_id = p_user1
         and m1.club_id in (c.club_retador_id, c.club_retado_id)
        join public.club_members m2
          on m2.user_id = p_user2
         and m2.club_id in (c.club_retador_id, c.club_retado_id)
        where c.estado = 'aceptado'
          and m1.club_id <> m2.club_id
          and public.tiene_permiso_de_club(m1.club_id, p_user1, 'chatClubs')
          and public.tiene_permiso_de_club(m2.club_id, p_user2, 'chatClubs')
    );
$$;

-- results — proponer_resultado() y confirmar_resultado() (migración 48):
-- sólo cambia quién puede hacer cada cosa; el resto —validaciones,
-- bloqueos de fila, orden— queda igual.
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

    select * into v_match from public.matches where id = v_row.match_id for update;
    if not found then
        return json_build_object('ok', false, 'reason', 'El partido de este desafío ya no existe');
    end if;
    select * into v_row from public.club_challenges where id = p_challenge_id for update;

    select array_agg(cm.club_id) into v_clubes
      from public.club_members cm
     where cm.user_id = v_me
       and cm.club_id in (v_row.club_retador_id, v_row.club_retado_id)
       and public.tiene_permiso_de_club(cm.club_id, v_me, 'results');

    if v_clubes is null then
        return json_build_object('ok', false,
            'reason', 'No tienes permiso para proponer el resultado de este desafío');
    end if;

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

    select * into v_match from public.matches where id = v_res.match_id for update;
    if not found then
        return json_build_object('ok', false, 'reason', 'El partido de este resultado ya no existe');
    end if;
    select * into v_row from public.club_challenges where id = v_res.challenge_id for update;
    if not found then
        return json_build_object('ok', false, 'reason', 'Este desafío ya no existe');
    end if;
    select * into v_res from public.club_match_results where id = p_result_id for update;

    if v_res.propuesto_por = v_me then
        return json_build_object('ok', false,
            'reason', 'No puedes confirmar tu propio resultado: lo confirma el club contrario');
    end if;

    select cm.club_id into v_club
      from public.club_members cm
     where cm.user_id = v_me
       and cm.club_id in (v_row.club_retador_id, v_row.club_retado_id)
       and cm.club_id <> v_res.club_proponente_id
       and public.tiene_permiso_de_club(cm.club_id, v_me, 'results')
     limit 1;

    if v_club is null then
        return json_build_object('ok', false,
            'reason', 'No tienes permiso para confirmar el resultado de este desafío');
    end if;

    select exists (
        select 1 from public.club_members cm
         where cm.user_id = v_me and cm.club_id = v_res.club_proponente_id
    ) into v_en_prop;

    if v_en_prop then
        return json_build_object('ok', false,
            'reason', 'No puedes confirmar un resultado propuesto por un club al que perteneces');
    end if;

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

-- =============================================================
-- Fin de la migración 119.
-- =============================================================
