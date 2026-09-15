-- 108. El cambio de partido, como corre de verdad.
--
-- POR QUÉ EXISTE ESTA MIGRACIÓN. `swap_match` y `cancel_match_and_join` corren
-- en producción con un cuerpo que NO está en ninguna migración: el repositorio
-- solo tenía la versión de la 33, y además protegida con
-- `if to_regprocedure(...) is null`, así que una base nueva se habría quedado
-- con esa. Y esa versión tiene un defecto grave: llama primero a
-- `leave_match_penalized(p_old)` —que borra la inscripción y cobra la
-- sanción— y recién después intenta entrar al destino. Si el destino no
-- acepta, devuelve el error y el jugador queda fuera de los dos partidos,
-- pagando por un cambio que nunca ocurrió.
--
-- El cuerpo desplegado ya hace lo correcto: comprueba el destino ANTES de
-- soltar el cupo. Se comprobó contra producción que cambiarse a un partido
-- lleno deja al jugador en el suyo y no le cobra nada. Acá queda versionado,
-- para que el repositorio pueda reconstruir lo que de verdad corre.
--
-- Y SE CORRIGE UNA COSA. La sanción de 3 puntos por arrepentirse se aplicaba
-- SIEMPRE, incluso a quien nunca estuvo en el partido de origen: llamar a esta
-- función con un partido cualquiera costaba 3 puntos. Ahora se cobra solo a
-- quien de verdad soltó un cupo, que es lo que la sanción castiga.

create or replace function public.swap_match(p_old uuid, p_new uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_old record; v_new record; v_att record; v_prof record; v_username text;
  v_solto boolean := false;
begin
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'No autenticado'); end if;

  select * into v_old from public.matches where id = p_old;
  if not found then return jsonb_build_object('ok', false, 'reason', 'Partido original no existe'); end if;
  if v_old.id_organizador = v_user then
    return jsonb_build_object('ok', false, 'reason', 'Eres el anfitrión: debes cancelar tu partido');
  end if;
  if v_old.hora <= now() + interval '2 hours' then
    return jsonb_build_object('ok', false, 'reason', 'Faltan menos de 2 horas para tu partido original');
  end if;

  -- El destino se comprueba ANTES de soltar nada: si no acepta, el jugador se
  -- queda donde estaba y no paga por un cambio que no ocurrió.
  select * into v_new from public.matches where id = p_new;
  if not found then return jsonb_build_object('ok', false, 'reason', 'Partido no encontrado'); end if;
  if v_new.estado <> 'abierto' then return jsonb_build_object('ok', false, 'reason', 'El partido no está abierto'); end if;
  if v_new.cupos_disponibles <= 0 then return jsonb_build_object('ok', false, 'reason', 'No quedan cupos'); end if;

  select trust_score, estado, suspended_until into v_prof from public.profiles where id = v_user;
  if v_prof.estado = 'suspendido' and (v_prof.suspended_until is null or v_prof.suspended_until > now()) then
    return jsonb_build_object('ok', false, 'reason', 'Tu cuenta está suspendida temporalmente');
  end if;
  if coalesce(v_prof.trust_score,0) < coalesce(v_new.min_trust_score,0) then
    return jsonb_build_object('ok', false, 'reason',
      'Trust Score insuficiente: necesitas ' || v_new.min_trust_score || ' y tienes ' || coalesce(v_prof.trust_score,0));
  end if;

  select * into v_att from public.attendees
   where id_partido = p_old and id_jugador = v_user
     and estado in ('inscrito','confirmado_gps','pendiente');
  if found then
    delete from public.attendees where id = v_att.id;
    if v_att.estado in ('inscrito','confirmado_gps') then
      v_solto := true;
      update public.matches
         set cupos_disponibles = cupos_disponibles + 1, estado = 'abierto'
       where id = p_old;
      -- efecto dominó: mensaje automático al chat del partido viejo
      insert into public.messages (sender_id, match_id, content)
      values (v_user, p_old, 'Un jugador se ha salido, ¡vuelve a haber un cupo disponible!');
    end if;
  end if;

  -- Sanción leve por arrepentido (−3), solo a quien de verdad dejó un cupo
  -- botado. Antes la pagaba cualquiera que llamara a esta función, aunque no
  -- estuviera en el partido de origen.
  if v_solto then
    update public.profiles set trust_score = greatest(trust_score - 3, 0) where id = v_user;
  end if;

  if v_new.aprobacion = 'manual' then
    insert into public.attendees (id_partido, id_jugador, estado) values (p_new, v_user, 'pendiente');
    select username into v_username from public.profiles where id = v_user;
    perform public.create_notification(
      v_new.id_organizador, 'join_request',
      coalesce(v_username,'Alguien') || ' quiere unirse a tu partido',
      coalesce(v_new.titulo,'Partido'),
      jsonb_build_object('matchId', p_new, 'playerId', v_user)
    );
    return jsonb_build_object('ok', true, 'pending', true, 'penalty', case when v_solto then 3 else 0 end);
  else
    insert into public.attendees (id_partido, id_jugador, estado) values (p_new, v_user, 'inscrito');
    update public.matches set cupos_disponibles = cupos_disponibles - 1 where id = p_new;
    return jsonb_build_object('ok', true, 'pending', false, 'penalty', case when v_solto then 3 else 0 end);
  end if;
end;
$$;
revoke all on function public.swap_match(uuid, uuid) from public, anon;
grant execute on function public.swap_match(uuid, uuid) to authenticated;

-- El mismo caso, cuando quien se cambia es el ANFITRIÓN del partido viejo: lo
-- cancela y se suma a otro. Idéntico al cuerpo desplegado; se versiona por la
-- misma razón.
create or replace function public.cancel_match_and_join(p_old uuid, p_new uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_old record; v_new record; v_prof record; r record; v_username text; v_when text;
begin
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'No autenticado'); end if;

  select * into v_old from public.matches where id = p_old;
  if not found then return jsonb_build_object('ok', false, 'reason', 'Partido no existe'); end if;
  if v_old.id_organizador <> v_user then
    return jsonb_build_object('ok', false, 'reason', 'No eres el organizador de ese partido');
  end if;
  if v_old.hora <= now() + interval '2 hours' then
    return jsonb_build_object('ok', false, 'reason', 'Faltan menos de 2 horas; no puedes cancelar para cambiarte');
  end if;

  select * into v_new from public.matches where id = p_new;
  if not found then return jsonb_build_object('ok', false, 'reason', 'Partido destino no existe'); end if;
  if v_new.estado <> 'abierto' then return jsonb_build_object('ok', false, 'reason', 'El partido no está abierto'); end if;
  if v_new.cupos_disponibles <= 0 then return jsonb_build_object('ok', false, 'reason', 'No quedan cupos'); end if;

  select trust_score, estado, suspended_until into v_prof from public.profiles where id = v_user;
  if v_prof.estado = 'suspendido' and (v_prof.suspended_until is null or v_prof.suspended_until > now()) then
    return jsonb_build_object('ok', false, 'reason', 'Tu cuenta está suspendida temporalmente');
  end if;
  if coalesce(v_prof.trust_score,0) < coalesce(v_new.min_trust_score,0) then
    return jsonb_build_object('ok', false, 'reason',
      'Trust Score insuficiente: necesitas ' || v_new.min_trust_score || ' y tienes ' || coalesce(v_prof.trust_score,0));
  end if;

  -- Penalización de anfitrión que cancela para irse a otro partido.
  update public.profiles set trust_score = greatest(trust_score - 25, 0) where id = v_user;

  -- Avisar a los inscritos que su partido se canceló.
  v_when := to_char(v_old.hora at time zone 'America/Santiago', 'HH24:MI');
  for r in
    select distinct id_jugador from public.attendees
    where id_partido = p_old and id_jugador <> v_user and id_jugador is not null
  loop
    perform public.create_notification(
      r.id_jugador, 'match_cancelled',
      '❌ Partido cancelado',
      'El anfitrión canceló la pichanga de las ' || v_when || ' en ' ||
        coalesce(v_old.cancha_nombre, 'la cancha') ||
        '. Tu cupo fue liberado, ¡busca otro partido y no te quedes sin jugar!',
      jsonb_build_object('matchId', p_old)
    );
  end loop;

  -- Borrar el partido (cascade: attendees + mensajes).
  delete from public.matches where id = p_old;

  if v_new.aprobacion = 'manual' then
    insert into public.attendees (id_partido, id_jugador, estado) values (p_new, v_user, 'pendiente');
    select username into v_username from public.profiles where id = v_user;
    perform public.create_notification(
      v_new.id_organizador, 'join_request',
      coalesce(v_username,'Alguien') || ' quiere unirse a tu partido',
      coalesce(v_new.titulo,'Partido'),
      jsonb_build_object('matchId', p_new, 'playerId', v_user)
    );
    return jsonb_build_object('ok', true, 'pending', true);
  else
    insert into public.attendees (id_partido, id_jugador, estado) values (p_new, v_user, 'inscrito');
    update public.matches set cupos_disponibles = cupos_disponibles - 1 where id = p_new;
    return jsonb_build_object('ok', true, 'pending', false);
  end if;
end;
$$;
revoke all on function public.cancel_match_and_join(uuid, uuid) from public, anon;
grant execute on function public.cancel_match_and_join(uuid, uuid) to authenticated;
