-- =============================================================
-- FutFinder — migración 44e: a `attendees` y a la lista de espera
-- solo se escribe por RPC
--
-- CIERRA EL P1 DE PENDIENTES. Las políticas de escritura de
-- `attendees` dejaban a cualquier `authenticated` insertarse,
-- modificarse o borrarse por PostgREST, saltándose `join_match` y sus
-- comprobaciones de cupo, de Trust Score y de choque de horario. La 44d
-- cerró esa puerta SOLO para los partidos de clubes; ésta la cierra
-- también para los normales, que es lo que quedaba abierto.
--
-- SE PUEDE CERRAR DEL TODO porque el cliente ya usa RPC para todo…
-- salvo en un sitio: `cancelMyJoinRequest` (`services/matches.js`)
-- borraba su propia solicitud pendiente con un `delete` directo. Ése es
-- el único motivo por el que estas políticas seguían existiendo, y por
-- eso aquí nace `cancel_join_request()` para sustituirlo.
--
-- `waitlist_delete_self_or_host` se va también: la mitad «self» ya la
-- cubre `leave_waitlist()`, y la mitad «host» no tiene ningún llamador
-- en la aplicación. Era la política residual que quedaba de la 44d.
--
-- DOS ARREGLOS MÁS, QUE SON LA MISMA CLASE DE FALLO:
--
--   1. `approve_join` leía `cupos_disponibles` SIN `for update`. Dos
--      aprobaciones simultáneas veían el mismo valor y ambas pasaban:
--      sobreventa. `leave_match` sí bloquea la fila; ésta no lo hacía.
--
--   2. `approve_join` y `reject_join` no distinguían un partido de
--      clubes. El trigger de la 44d es `before insert`, y estas dos
--      hacen `update`/`delete` sobre una fila que ya existe, así que
--      en cuanto U3 cree solicitudes pendientes EL ADMINISTRADOR DEL
--      CLUB RIVAL podría aprobar a los jugadores del otro club: es el
--      `id_organizador` del partido. En un partido de clubes se
--      confirma con `confirmar_nomina_club()`.
--
-- LOS PARTIDOS NORMALES NO CAMBIAN DE COMPORTAMIENTO: siguen entrando
-- por `join_match`, `request_join`, `approve_join`, `leave_match` y la
-- lista de espera. Lo único que desaparece es la vía directa.
-- =============================================================

-- ── 1. SE ACABAN LAS ESCRITURAS DIRECTAS ────────────────────────
drop policy if exists attendees_insert_self       on public.attendees;
drop policy if exists attendees_update_self       on public.attendees;
drop policy if exists attendees_delete_self       on public.attendees;
drop policy if exists attendees_delete_own_pending on public.attendees;

drop policy if exists waitlist_insert_self        on public.match_waitlist;
drop policy if exists waitlist_delete_self_or_host on public.match_waitlist;

-- Quedan sólo las de lectura (`attendees_read_si_veo_el_partido` y
-- `waitlist_select`, ambas de la 44d). Sin políticas de escritura, RLS
-- rechaza todo lo que no venga de una función `security definer`, que
-- corre como el dueño y no pasa por ellas.
--
-- Cinturón sobre el tirante: Supabase concede por defecto todos los
-- privilegios de tabla a `anon` y `authenticated`. La RLS ya bastaría,
-- pero quitar el privilegio deja la intención escrita y reduce la
-- superficie de PostgREST.
revoke insert, update, delete on public.attendees      from anon, authenticated;
revoke insert, update, delete on public.match_waitlist from anon, authenticated;

-- ── 2. RETIRAR MI PROPIA SOLICITUD ──────────────────────────────
-- Sustituye al `delete` directo que hacía el cliente. No toca cupos: una
-- solicitud pendiente nunca reservó uno.
create or replace function public.cancel_join_request(p_match_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_borradas integer;
begin
    if v_user_id is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    delete from public.attendees
     where id_partido = p_match_id
       and id_jugador = v_user_id
       and estado = 'pendiente';

    get diagnostics v_borradas = row_count;

    -- Volver a pulsar no es un error: el resultado es el mismo.
    if v_borradas = 0 then
        return json_build_object('ok', true, 'sinSolicitud', true);
    end if;
    return json_build_object('ok', true);
end;
$$;

revoke execute on function public.cancel_join_request(uuid) from public, anon;
grant execute on function public.cancel_join_request(uuid) to authenticated;

-- ── 3. APROBAR SIN SOBREVENDER, Y NUNCA EN UN PARTIDO DE CLUBES ─
create or replace function public.approve_join(p_match_id uuid, p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_match record;
  v_att   record;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'No autenticado');
  end if;

  -- `for update`: sin esto, dos aprobaciones simultáneas leían el mismo
  -- `cupos_disponibles` y ambas pasaban.
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'Partido no encontrado');
  end if;

  -- En un partido de clubes el `id_organizador` es el administrador del
  -- club RIVAL: dejarle aprobar aquí sería dejarle elegir la nómina del
  -- otro club. La nómina por club se confirma con confirmar_nomina_club.
  if v_match.challenge_proposal_id is not null then
    return jsonb_build_object('ok', false,
      'reason', 'En un partido entre clubes la nómina la confirma un administrador de cada club');
  end if;

  if v_match.id_organizador <> v_user then
    return jsonb_build_object('ok', false, 'reason', 'Solo el organizador puede aprobar');
  end if;

  select * into v_att from public.attendees
   where id_partido = p_match_id and id_jugador = p_player_id and estado = 'pendiente';
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'No hay solicitud pendiente de ese jugador');
  end if;
  if v_match.cupos_disponibles <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'No quedan cupos');
  end if;

  update public.attendees set estado = 'inscrito' where id = v_att.id;
  update public.matches
     set cupos_disponibles = cupos_disponibles - 1,
         estado = case when cupos_disponibles - 1 = 0 then 'lleno' else estado end
   where id = p_match_id;

  perform public.create_notification(
    p_player_id, 'join_approved', 'Tu solicitud fue aceptada ✓',
    'Ya estás dentro de ' || coalesce(v_match.titulo, 'el partido'),
    jsonb_build_object('matchId', p_match_id)
  );

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.reject_join(p_match_id uuid, p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_match record;
  v_att   record;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'No autenticado');
  end if;

  select * into v_match from public.matches where id = p_match_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'Partido no encontrado');
  end if;

  if v_match.challenge_proposal_id is not null then
    return jsonb_build_object('ok', false,
      'reason', 'En un partido entre clubes la nómina la confirma un administrador de cada club');
  end if;

  if v_match.id_organizador <> v_user then
    return jsonb_build_object('ok', false, 'reason', 'Solo el organizador puede rechazar');
  end if;

  select * into v_att from public.attendees
   where id_partido = p_match_id and id_jugador = p_player_id and estado = 'pendiente';
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'No hay solicitud pendiente');
  end if;

  delete from public.attendees where id = v_att.id;

  perform public.create_notification(
    p_player_id, 'join_rejected', 'Tu solicitud no fue aceptada',
    'El organizador de ' || coalesce(v_match.titulo, 'el partido')
      || ' no aprobó tu solicitud esta vez',
    jsonb_build_object('matchId', p_match_id)
  );

  return jsonb_build_object('ok', true);
end;
$$;
