-- =============================================================
-- FutFinder migration 91: el apodo dentro del club
-- =============================================================
-- UN APODO POR CLUB, NO POR PERSONA. «El Muro» tiene sentido en un club
-- y no en otro, así que vive atado a la fila de `club_members`, nunca a
-- `profiles`: el mismo jugador en dos clubes puede tener dos apodos, o
-- ninguno.
--
-- POR QUÉ ES UNA TABLA APARTE Y NO UNA COLUMNA EN `club_members`.
-- `club_members_read` (migración 11) es `using (true)`: la membresía es
-- pública a propósito («los perfiles y reputación de los integrantes son
-- visibles»), y agregar una columna ahí la haría pública también. El
-- apodo es explícitamente lo contrario — «Solo lo ven los integrantes
-- del club» — así que necesita su PROPIA política de lectura, restringida
-- a compañeros de club. Mismo motivo y misma forma que
-- `club_match_locations` (migración 44b): una tabla aparte, con su propia
-- RLS, en vez de forzar una excepción por columna en una tabla que ya es
-- de lectura abierta.
--
-- TODO ESCRITURA PASA POR `set_apodo_club()`, no por INSERT/UPDATE/DELETE
-- directos: decidir "¿soy yo o soy administrador de este club?" y el
-- "vaciar el apodo borra la fila, no dejarlo en blanco" son las dos
-- reglas que no se pueden repartir entre RLS y el cliente sin que
-- terminen diciendo cosas distintas.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

create table if not exists public.club_member_apodos (
    member_id  uuid primary key references public.club_members(id) on delete cascade,
    apodo      text not null check (length(trim(apodo)) between 1 and 18),
    updated_at timestamptz not null default now()
);

alter table public.club_member_apodos enable row level security;

-- ÚNICA política, y es de lectura: la escritura vive sólo en
-- `set_apodo_club()`, que corre `security definer` y no pasa por RLS.
drop policy if exists club_member_apodos_read on public.club_member_apodos;
create policy club_member_apodos_read on public.club_member_apodos
    for select
    using (
        exists (
            select 1
              from public.club_members cm_target
              join public.club_members cm_yo
                on cm_yo.club_id = cm_target.club_id
             where cm_target.id = club_member_apodos.member_id
               and cm_yo.user_id = auth.uid()
        )
    );

revoke insert, update, delete on public.club_member_apodos from anon, authenticated;

-- ── La única puerta de escritura ──────────────────────────────
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

    if v_yo.id <> v_target.id and v_yo.rol <> 'admin' then
        raise exception 'Solo esa persona o un administrador del club puede cambiar este apodo';
    end if;

    v_limpio := trim(coalesce(p_apodo, ''));

    -- Vacío = quitar el apodo. No se guarda una fila con apodo en blanco:
    -- "sin apodo" es "no hay fila", no "hay una fila que dice nada".
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

revoke all on function public.set_apodo_club(uuid, text) from public, anon;
grant execute on function public.set_apodo_club(uuid, text) to authenticated;
