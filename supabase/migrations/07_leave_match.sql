-- =============================================================
-- FutFinder migration 07: RPC para que un jugador no-organizador
-- salga voluntariamente del partido (libera el cupo).
-- =============================================================
-- Pega esto en Supabase → SQL Editor → New query → Run.
-- =============================================================

create or replace function public.leave_match(p_match_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_match record;
    v_deleted integer;
begin
    if v_user_id is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    select * into v_match from public.matches
    where id = p_match_id
    for update;

    if v_match is null then
        return json_build_object('ok', false, 'reason', 'Partido no existe');
    end if;

    -- El organizador no puede simplemente "salir": debe eliminar el partido.
    if v_match.id_organizador = v_user_id then
        return json_build_object(
            'ok', false,
            'reason', 'Eres el organizador. Para salir debes eliminar el partido.'
        );
    end if;

    delete from public.attendees
    where id_partido = p_match_id
      and id_jugador = v_user_id;

    get diagnostics v_deleted = row_count;

    -- Si no estaba inscrito, no hacemos nada más
    if v_deleted = 0 then
        return json_build_object('ok', true, 'wasNotInscribed', true);
    end if;

    -- Liberar cupo y reabrir el estado si estaba lleno
    update public.matches
    set cupos_disponibles = least(cupos_disponibles + 1, cupos_totales),
        estado = case when estado = 'lleno' then 'abierto' else estado end
    where id = p_match_id;

    return json_build_object('ok', true);
end;
$$;
