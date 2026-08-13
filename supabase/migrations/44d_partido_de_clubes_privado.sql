-- =============================================================
-- FutFinder — migración 44d: el partido entre clubes es privado
-- hasta que termina
--
-- CAMBIO DE REGLA, NO CORRECCIÓN DE UN ERROR. Hasta la 44b el partido
-- de clubes era público y lo único reservado era su ubicación exacta.
-- La regla nueva es más estricta: mientras no esté finalizado, el
-- partido sólo existe para los integrantes de los dos clubes. Un
-- externo no debe poder ni saber que existe. Cuando termina, y sólo
-- entonces, se hace público un resumen mínimo.
--
-- POR QUÉ NO SE ARREGLA EN LA INTERFAZ. `matches_read_all` era
-- `using (true)`: cualquiera —incluido `anon`— se traía la fila entera
-- por PostgREST con sólo el id, y de ahí salían cancha, fecha, hora,
-- cuota, cupos y la ubicación aproximada. Esconderlo en la app no
-- cambiaba nada de eso.
--
-- EL PREDICADO, ESCRITO UNA VEZ:
--
--     challenge_proposal_id is null       → partido normal, público
--     o soy integrante de alguno de los dos clubes
--
-- Se apoya en `challenge_proposal_id` y no en `club_local_id`: los
-- partidos de clubes del flujo antiguo (migración 27) siempre fueron
-- públicos y no se les cambia el trato ahora. Y dice INTEGRANTE, no
-- administrador: un jugador del club tiene que ver el partido de su
-- club para poder ir. El chat de negociación sigue siendo sólo de
-- administradores y esta migración no lo toca.
--
-- LAS DEMÁS TABLAS SE CUELGAN DE ÉSA. `attendees` y `match_waitlist`
-- exigen que el partido sea visible, con un `exists` sobre `matches`
-- que YA está filtrado por su propia RLS. Si el partido no se ve, sus
-- inscritos y su cola tampoco, y la regla vive en un solo sitio.
--
-- LAS ESCRITURAS SE CIERRAN DEL TODO para los partidos de clubes: ni
-- externos ni integrantes pueden meterse a mano en `attendees`. La
-- inscripción llega en U3 y será una RPC. Esto cierra la mitad del P1
-- de pendientes que afecta a los partidos de clubes; la otra mitad —en
-- los partidos normales cualquiera puede saltarse `join_match` con un
-- insert directo— sigue abierta y sigue siendo bloqueo de U3.
--
-- LAS RPC QUE INSCRIBEN SON `security definer` Y NO PASAN POR RLS.
-- Taparlas una por una habría significado reescribir cinco funciones
-- largas y no versionadas, con el riesgo de perder algo por el camino.
-- En su lugar se usa un TRIGGER sobre `attendees` y otro sobre
-- `match_waitlist`: se dispara venga la fila de donde venga —RPC,
-- PostgREST o SQL directo— y no hay que acordarse de ninguna función.
-- Sólo `join_match` lleva además una guarda explícita, porque es el
-- camino normal y ahí conviene un motivo legible en vez de una
-- excepción.
--
-- DESPUÉS DE FINALIZAR: `historial_publico_club()` expone SÓLO clubes,
-- fecha (el día, no la hora), marcador y V/E/D. Nunca la fila entera.
-- =============================================================

-- ── 1. EL PARTIDO ───────────────────────────────────────────────
drop policy if exists matches_read_all on public.matches;

create policy matches_read_publico_o_de_mi_club on public.matches
    for select
    using (
        challenge_proposal_id is null
        or exists (
            select 1
              from public.club_members cm
             where cm.user_id = auth.uid()
               and cm.club_id in (matches.club_local_id, matches.club_visitante_id)
        )
    );

comment on policy matches_read_publico_o_de_mi_club on public.matches is
    'Los partidos normales son públicos. Los nacidos de un desafío sólo los ven los integrantes de los dos clubes, en cualquier estado. Lo público de un partido terminado sale por historial_publico_club().';

-- ── 2. LOS INSCRITOS ────────────────────────────────────────────
-- El `exists` no repite el predicado: consulta `matches`, que ya está
-- filtrada por la política de arriba.
drop policy if exists attendees_read_all on public.attendees;

create policy attendees_read_si_veo_el_partido on public.attendees
    for select
    using (exists (select 1 from public.matches m where m.id = attendees.id_partido));

-- En un partido de clubes NADIE se inscribe a mano: ni un externo ni un
-- integrante. La única vía será la RPC de U3.
drop policy if exists attendees_insert_self on public.attendees;
create policy attendees_insert_self on public.attendees
    for insert
    with check (
        auth.uid() = id_jugador
        and exists (select 1 from public.matches m
                     where m.id = attendees.id_partido and m.challenge_proposal_id is null)
    );

drop policy if exists attendees_update_self on public.attendees;
create policy attendees_update_self on public.attendees
    for update
    using (
        auth.uid() = id_jugador
        and exists (select 1 from public.matches m
                     where m.id = attendees.id_partido and m.challenge_proposal_id is null)
    );

drop policy if exists attendees_delete_self on public.attendees;
create policy attendees_delete_self on public.attendees
    for delete
    using (
        auth.uid() = id_jugador
        and exists (select 1 from public.matches m
                     where m.id = attendees.id_partido and m.challenge_proposal_id is null)
    );

drop policy if exists attendees_delete_own_pending on public.attendees;
create policy attendees_delete_own_pending on public.attendees
    for delete
    using (
        auth.uid() = id_jugador
        and estado = 'pendiente'
        and exists (select 1 from public.matches m
                     where m.id = attendees.id_partido and m.challenge_proposal_id is null)
    );

-- ── 3. LA LISTA DE ESPERA ───────────────────────────────────────
-- Era `auth.uid() is not null`: cualquier autenticado veía la cola de
-- cualquier partido, y por ahí deducía su existencia.
drop policy if exists waitlist_select on public.match_waitlist;
create policy waitlist_select on public.match_waitlist
    for select
    using (
        auth.uid() is not null
        and exists (select 1 from public.matches m where m.id = match_waitlist.id_partido)
    );

drop policy if exists waitlist_insert_self on public.match_waitlist;
create policy waitlist_insert_self on public.match_waitlist
    for insert
    with check (
        auth.uid() = id_jugador
        and exists (select 1 from public.matches m
                     where m.id = match_waitlist.id_partido and m.challenge_proposal_id is null)
    );

-- ── 4. LA RED QUE ATRAPA A LAS RPC ──────────────────────────────
-- Un trigger `before insert` se dispara venga la fila de donde venga:
-- `join_match`, `request_join`, `join_waitlist`, `swap_match`,
-- `cancel_match_and_join`, `approve_join`, un insert directo o
-- cualquier función futura que nadie recuerde tapar.
--
-- LA PUERTA PARA U3: se deja pasar la fila que trae `club_id`. Ninguna
-- de las RPC actuales lo pone —no sabían que existía— y la RLS impide
-- ponerlo desde fuera, así que hoy esto bloquea todo. Cuando llegue
-- `join_club_match()`, que sí reparte por club y sí lo pone, pasará sin
-- tener que acordarse de tocar este trigger.
create or replace function public.attendees_solo_rpc_de_clubes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.club_id is not null then
        return new; -- viene de la RPC de inscripción por club (U3)
    end if;
    if exists (
        select 1 from public.matches m
         where m.id = new.id_partido and m.challenge_proposal_id is not null
    ) then
        raise exception 'Este es un partido entre clubes: la inscripción es por club'
            using errcode = '42501';
    end if;
    return new;
end;
$$;

drop trigger if exists trg_attendees_solo_rpc_de_clubes on public.attendees;
create trigger trg_attendees_solo_rpc_de_clubes
    before insert on public.attendees
    for each row execute function public.attendees_solo_rpc_de_clubes();

create or replace function public.waitlist_no_en_partido_de_clubes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if exists (
        select 1 from public.matches m
         where m.id = new.id_partido and m.challenge_proposal_id is not null
    ) then
        raise exception 'Un partido entre clubes no tiene lista de espera abierta'
            using errcode = '42501';
    end if;
    return new;
end;
$$;

drop trigger if exists trg_waitlist_no_en_partido_de_clubes on public.match_waitlist;
create trigger trg_waitlist_no_en_partido_de_clubes
    before insert on public.match_waitlist
    for each row execute function public.waitlist_no_en_partido_de_clubes();

-- ── 5. EL CAMINO NORMAL, CON UN MOTIVO LEGIBLE ──────────────────
-- El trigger ya lo impide, pero desde `join_match` el usuario merece
-- una frase y no una excepción de PostgreSQL.
create or replace function public.join_match(p_match_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_match record;
    v_inserted_id uuid;
begin
    if v_user_id is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    -- Partido entre clubes: la inscripción va por club y llega en U3.
    if exists (select 1 from public.matches m
                where m.id = p_match_id and m.challenge_proposal_id is not null) then
        return json_build_object('ok', false,
            'reason', 'Este es un partido entre clubes: la inscripción es por club');
    end if;

    select * into v_match from public.matches where id = p_match_id for update;
    if v_match is null then
        return json_build_object('ok', false, 'reason', 'Partido no existe');
    end if;
    if v_match.cupos_disponibles <= 0 then
        return json_build_object('ok', false, 'reason', 'Partido lleno');
    end if;
    if v_match.estado <> 'abierto' then
        return json_build_object('ok', false, 'reason', 'Partido no está abierto');
    end if;

    insert into public.attendees(id_partido, id_jugador)
    values (p_match_id, v_user_id)
    on conflict (id_partido, id_jugador) do nothing
    returning id into v_inserted_id;

    if v_inserted_id is null then
        return json_build_object('ok', true, 'already', true,
                                 'reason', 'Ya estabas inscrito en este partido');
    end if;

    update public.matches
    set cupos_disponibles = cupos_disponibles - 1,
        estado = case when cupos_disponibles - 1 = 0 then 'lleno' else estado end
    where id = p_match_id;

    return json_build_object('ok', true);
end;
$$;

-- Estaba ejecutable por `anon` desde siempre (el `EXECUTE` que
-- PostgreSQL concede a PUBLIC). Se aprovecha para cerrarlo: la función
-- exige `auth.uid()` de todos modos.
revoke execute on function public.join_match(uuid) from public, anon;
grant execute on function public.join_match(uuid) to authenticated;

-- ── 6. LO ÚNICO PÚBLICO DE UN PARTIDO TERMINADO ─────────────────
-- Clubes, día, marcador y V/E/D. Nada más: ni cancha, ni hora, ni
-- cuota, ni cupos, ni nómina, ni ubicación. Es una proyección, no una
-- ventana a la fila: la función elige las columnas y no hay forma de
-- pedir otras.
--
-- `security definer` porque tiene que atravesar la RLS de `matches`
-- —para un externo esos partidos no existen— y devolver sólo el
-- resumen. Por eso mismo filtra `estado = 'finalizado'` de forma
-- explícita: un partido cancelado, sin acuerdo o no disputado NO sale
-- por aquí.
--
-- HOY DEVUELVE MARCADOR NULO. `club_match_results` llega en la
-- migración 48; hasta entonces ningún partido de clubes alcanza
-- `finalizado`, así que esto devuelve cero filas. La forma ya es la
-- definitiva para que la 48 sólo tenga que rellenar el marcador.
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
        null::integer,   -- TODO(48): club_match_results.goles_local
        null::integer,   -- TODO(48): club_match_results.goles_visitante
        null::text       -- TODO(48): 'V' / 'E' / 'D' respecto de p_club_id
      from public.matches m
      join public.clubs cl on cl.id = m.club_local_id
      join public.clubs cv on cv.id = m.club_visitante_id
     where m.challenge_proposal_id is not null
       and m.estado = 'finalizado'
       and p_club_id in (m.club_local_id, m.club_visitante_id)
     order by m.hora desc
     limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

revoke execute on function public.historial_publico_club(uuid, integer) from public;
grant execute on function public.historial_publico_club(uuid, integer) to anon, authenticated;

comment on function public.historial_publico_club(uuid, integer) is
    'Historial PÚBLICO de un club: sólo partidos finalizados, y sólo clubes, día, marcador y resultado. Nunca cancha, hora, cuota, cupos, nómina ni ubicación.';
