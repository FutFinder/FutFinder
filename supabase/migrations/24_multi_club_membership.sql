-- =========================================================
-- FutFinder migration 24: Hasta 3 clubes por jugador
-- =========================================================
-- Reemplaza el constraint "un jugador = un club" por un
-- trigger que permite hasta 3 membresías simultáneas.
-- =========================================================

-- 1. Eliminar el constraint que limita a 1 club por usuario
alter table public.club_members
    drop constraint if exists club_members_one_club_per_user;

-- 2. Garantizar unicidad (club_id, user_id) para evitar membresía duplicada
--    en el mismo club (un usuario no puede estar dos veces en el mismo club).
create unique index if not exists club_members_club_user_unique_idx
    on public.club_members (club_id, user_id);

-- 3. Trigger: máximo 3 clubes por usuario
create or replace function public.check_user_club_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_count integer;
begin
    select count(*) into v_count
    from public.club_members
    where user_id = new.user_id;
    -- BEFORE INSERT: la nueva fila aún no existe, count = filas previas

    if v_count >= 3 then
        raise exception 'Ya perteneces al máximo de 3 clubes permitidos';
    end if;

    return new;
end;
$$;

drop trigger if exists trg_check_user_club_limit on public.club_members;
create trigger trg_check_user_club_limit
    before insert on public.club_members
    for each row execute function public.check_user_club_limit();
