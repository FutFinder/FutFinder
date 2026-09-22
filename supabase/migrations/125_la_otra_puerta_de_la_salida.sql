-- 125. La otra puerta de la salida: cambiarse de partido.
--
-- NO ES UN HALLAZGO NUEVO: son N01 y N02 otra vez, en la función de al lado.
-- La revisión del 21 de septiembre miró la salida por `leave_match_penalized`
-- —que es la que arregla la 122— y no el CAMBIO de partido, que hace
-- exactamente lo mismo con el partido de origen y estaba escrito aparte:
--
--   · `swap_match` no mira `matches.estado`. Cambiarse desde un partido que el
--     organizador ya canceló borraba la inscripción, escribía `estado =
--     'abierto'` —el partido revivía en el buscador, igual que en N01— y
--     cobraba los 3 puntos del arrepentido.
--
--   · Y lee la inscripción sin bloquearla, así que dos cambios simultáneos
--     desde el mismo partido cobraban dos veces y liberaban dos cupos por una
--     sola baja, igual que en N02. La segunda borra cero filas y no se entera.
--
--   · `cancel_match_and_join`, la variante del anfitrión, tampoco miraba el
--     estado: «cancelar y cambiarme» sobre un partido ya cancelado volvía a
--     cobrar los 25 puntos.
--
-- La migración 106 se llama «salirse cuesta lo mismo por las dos puertas».
-- Esto es lo mismo un nivel más abajo: si las dos puertas cobran igual, las
-- dos tienen que protegerse igual. Arreglar una sola deja el agujero abierto y
-- además deja dos funciones que hacen lo mismo de dos maneras distintas, que
-- es como se perdió la primera vez.
--
-- El patrón es el de la 122, sin inventar nada nuevo: bloquear el partido
-- ANTES de leer, validar su estado, y reclamar la inscripción con la misma
-- sentencia que la borra. Todo lo demás de la 108 —comprobar el destino antes
-- de soltar el cupo, la sanción sólo a quien de verdad dejó una plaza botada,
-- la aprobación manual— queda intacto.
--
-- Regresión: supabase/tests/125_la_otra_puerta_de_la_salida_test.sql

create or replace function public.swap_match(p_old uuid, p_new uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_old record; v_new record; v_estado text; v_prof record; v_username text;
  v_solto boolean := false;
begin
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'No autenticado'); end if;

  -- Se bloquea el partido de ORIGEN, que es el que esta función modifica. El
  -- destino no: la guarda de cupos (105) recalcula su disponibilidad desde la
  -- nómina dentro de la misma operación y rechaza la sobreventa con
  -- CUPOS_MENOR_QUE_CONFIRMADOS. Bloquear los dos abriría la puerta al abrazo
  -- mortal entre dos jugadores que se cambian en sentidos opuestos.
  select * into v_old from public.matches where id = p_old for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'Partido original no existe'); end if;
  if v_old.id_organizador = v_user then
    return jsonb_build_object('ok', false, 'reason', 'Eres el anfitrión: debes cancelar tu partido');
  end if;

  -- N01 por esta puerta. De un partido cancelado no se sale ni se cambia: al
  -- jugador ya lo dejaron sin partido, y no hay cupo que devolverle a nadie.
  -- Quien quiera entrar al otro partido puede hacerlo directamente, sin pagar
  -- por soltar algo que ya no existe.
  if v_old.estado = 'cancelado' then
    return jsonb_build_object('ok', false, 'reason',
      'Tu partido original fue cancelado: puedes inscribirte en el otro directamente, sin costo');
  end if;
  if v_old.estado = 'finalizado' then
    return jsonb_build_object('ok', false, 'reason', 'Tu partido original ya terminó');
  end if;

  -- La vigencia por reloj la sigue cubriendo este corte, que además es la
  -- regla del cambio: faltando menos de 2 horas no hay cambio que valga.
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

  -- N02 por esta puerta: la inscripción se reclama con la misma sentencia que
  -- la borra, así que sólo una de dos sesiones simultáneas suelta el cupo y
  -- sólo una paga.
  delete from public.attendees
   where id_partido = p_old
     and id_jugador = v_user
     and estado in ('inscrito','confirmado_gps','pendiente')
  returning estado into v_estado;

  if found and v_estado in ('inscrito','confirmado_gps') then
    v_solto := true;
    -- Reabrir lo que estaba LLENO, no escribir 'abierto' encima de cualquier
    -- estado (igual que en la 122).
    update public.matches
       set cupos_disponibles = cupos_disponibles + 1,
           estado = case when estado = 'lleno' then 'abierto' else estado end
     where id = p_old;
    -- efecto dominó: mensaje automático al chat del partido viejo
    insert into public.messages (sender_id, match_id, content)
    values (v_user, p_old, 'Un jugador se ha salido, ¡vuelve a haber un cupo disponible!');
  end if;

  -- Sanción leve por arrepentido (−3), solo a quien de verdad dejó un cupo
  -- botado. Antes la pagaba cualquiera que llamara a esta función, aunque no
  -- estuviera en el partido de origen (108).
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
-- cancela y se suma a otro.
create or replace function public.cancel_match_and_join(p_old uuid, p_new uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_old record; v_new record; v_prof record; r record; v_username text; v_when text;
  v_borrado uuid;
begin
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'No autenticado'); end if;

  select * into v_old from public.matches where id = p_old for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'Partido no existe'); end if;
  if v_old.id_organizador <> v_user then
    return jsonb_build_object('ok', false, 'reason', 'No eres el organizador de ese partido');
  end if;

  -- Cancelar lo ya cancelado volvía a cobrar los 25 puntos. `cancel_match`
  -- (34) ya respondía `already` en ese caso; esta puerta no.
  if v_old.estado = 'cancelado' then
    return jsonb_build_object('ok', false, 'reason',
      'Ese partido ya está cancelado: puedes inscribirte en el otro directamente');
  end if;
  if v_old.estado = 'finalizado' then
    return jsonb_build_object('ok', false, 'reason', 'Ese partido ya terminó');
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

  -- Avisar a los inscritos que su partido se canceló. Va ANTES del borrado
  -- porque el `cascade` se lleva a `attendees` por delante.
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

  -- Borrar el partido (cascade: attendees + mensajes). La sanción se cobra
  -- DESPUÉS y sólo si la fila era de verdad de esta llamada: con el bloqueo de
  -- arriba una segunda sesión ya no llega acá, y esto lo deja escrito.
  delete from public.matches where id = p_old returning id into v_borrado;
  if v_borrado is null then
    return jsonb_build_object('ok', false, 'reason', 'Ese partido ya no existe');
  end if;

  -- Penalización de anfitrión que cancela para irse a otro partido.
  update public.profiles set trust_score = greatest(trust_score - 25, 0) where id = v_user;

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
