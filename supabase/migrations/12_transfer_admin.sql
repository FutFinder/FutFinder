-- =============================================================
-- FutFinder migration 12: ceder administración del club
-- =============================================================
-- Pega esto entero en Supabase → SQL Editor → New query → Run.
--
-- RPC transfer_club_admin(p_member_id):
--   El admin que llama pasa a 'jugador' y el miembro indicado pasa
--   a 'admin', en una sola transacción. Necesario en plan Estándar
--   (1 admin): no se puede promover primero (límite del trigger) ni
--   degradarse primero (la RLS exige seguir siendo admin).
-- =============================================================

create or replace function public.transfer_club_admin(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_target public.club_members%rowtype;
    v_me public.club_members%rowtype;
begin
    select * into v_target from public.club_members where id = p_member_id;
    if not found then
        raise exception 'Miembro no encontrado';
    end if;

    select * into v_me from public.club_members
    where club_id = v_target.club_id and user_id = auth.uid();
    if not found or v_me.rol <> 'admin' then
        raise exception 'Solo un administrador del club puede ceder la administración';
    end if;
    if v_target.id = v_me.id then
        raise exception 'Ya eres administrador';
    end if;
    if v_target.rol = 'admin' then
        raise exception 'Ese miembro ya es administrador';
    end if;

    -- primero bajo yo: así el trigger de límites deja subir al otro
    update public.club_members set rol = 'jugador' where id = v_me.id;
    update public.club_members set rol = 'admin' where id = v_target.id;
end;
$$;

grant execute on function public.transfer_club_admin(uuid) to authenticated;
