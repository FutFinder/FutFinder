-- 127. Cancelar para cambiarse CANCELA el partido; no lo borra.
--
-- `cancel_match_and_join` —«soy el anfitrión, cancelo lo mío y me voy a este
-- otro»— terminaba con un `delete from public.matches`. La 34 había decidido
-- justo lo contrario para la cancelación normal («La diferencia con la versión
-- anterior: cambia el estado, no borra la fila»), y esta puerta se quedó atrás.
--
-- QUÉ SE PERDÍA CON EL BORRADO. El `on delete cascade` se llevaba por delante
-- a los inscritos y el chat del partido:
--
--   · Los jugadores recibían «se canceló tu partido» con un `matchId` que ya
--     no existía: al tocar el aviso no hay nada que abrir.
--   · El partido desaparecía del historial de todos. Para el jugador nunca
--     ocurrió, y no queda registro de que a él lo dejaron sin jugar.
--   · Se perdía la conversación entera, que la 34 conserva en sólo lectura.
--   · Y el trigger `tg_partido_cancelado_suelta_la_cancha` (100) está sobre
--     `after update of estado`: un DELETE nunca lo dispara. Un partido con
--     cancha reservada se borraba dejando la cancha arrendada y pagada para
--     algo que ya no existe. Hoy ningún partido tiene reserva tomada, así que
--     no hay nada que reparar hacia atrás; de acá en adelante el cambio de
--     estado la suelta sola. (Esto último se deduce de la definición del
--     trigger, no está medido en el arnés: montar una reserva de verdad es el
--     escenario de `100_si_se_cae_el_partido_se_suelta_la_cancha_test.sql`.)
--
-- Ahora hace lo mismo que `cancel_match`: marca `estado = 'cancelado'`, avisa
-- a los inscritos, avisa a la lista de espera y la cierra. La reclamación es
-- el propio `update … where estado <> 'cancelado' returning`, así que la
-- sanción de 25 se cobra sólo si esta llamada fue la que canceló.
--
-- LA SANCIÓN SIGUE SIENDO 25 Y NO 15. No es un descuido de la 34: cancelar un
-- partido para irse a jugar otro es lo que se castiga más caro, y por eso la
-- función exige además más de 2 horas de anticipación. Queda escrito para que
-- la próxima lectura no lo «corrija».
--
-- Y SE CIERRA LA MISMA PUERTA QUE LA 50 DEJÓ ABIERTA EN ESTAS DOS FUNCIONES.
-- La 50 hizo que `save_match_attendance()` y `cancel_match()` rechazaran los
-- partidos entre clubes, y la 111 hizo lo mismo con `leave_match_penalized`.
-- `swap_match` y `cancel_match_and_join` nunca miraron `challenge_proposal_id`.
-- Comprobado contra producción el 2026-09-21, con una propuesta real y un
-- inscrito por club:
--
--   · `swap_match` sacaba al jugador del partido entre clubes (`ok=true`, su
--     fila borrada), saltándose «las bajas se gestionan por club».
--   · `cancel_match_and_join` BORRABA el encuentro entero (`ok=true`, cero
--     filas), sin sanción al club, sin avisar al club rival y dejando
--     `club_challenges.match_id` en NULL por el `on delete set null`.
--
-- Un encuentro entre clubes se cancela desde el hilo del desafío
-- (`cancelar_encuentro_club`, migración 47), que es la única puerta que deja
-- el motivo, cierra el desafío y sanciona al CLUB en vez de a la persona.
--
-- Regresión: supabase/tests/127_cancelar_para_cambiarse_no_borra_el_partido_test.sql

-- ---------------------------------------------------------------------------
-- 1. La baja de un partido entre clubes no pasa por acá (espejo de la 111).
-- ---------------------------------------------------------------------------
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
  -- mortal entre dos jugadores que se cambian en sentidos opuestos (125).
  select * into v_old from public.matches where id = p_old for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'Partido original no existe'); end if;

  -- Mismo rechazo que `leave_match_penalized` (111), y por el mismo motivo:
  -- irse de un encuentro entre clubes es una baja por club. Va ANTES de mirar
  -- al anfitrión porque ahí el anfitrión es el admin que aprobó la propuesta.
  if v_old.challenge_proposal_id is not null then
    return jsonb_build_object('ok', false,
      'reason', 'Este es un partido entre clubes: las bajas se gestionan por club');
  end if;

  if v_old.id_organizador = v_user then
    return jsonb_build_object('ok', false, 'reason', 'Eres el anfitrión: debes cancelar tu partido');
  end if;

  -- N01 por esta puerta. De un partido cancelado no se sale ni se cambia: al
  -- jugador ya lo dejaron sin partido, y no hay cupo que devolverle a nadie.
  if v_old.estado = 'cancelado' then
    return jsonb_build_object('ok', false, 'reason',
      'Tu partido original fue cancelado: puedes inscribirte en el otro directamente, sin costo');
  end if;
  if v_old.estado = 'finalizado' then
    return jsonb_build_object('ok', false, 'reason', 'Tu partido original ya terminó');
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

  -- La inscripción se reclama con la misma sentencia que la borra (125).
  delete from public.attendees
   where id_partido = p_old
     and id_jugador = v_user
     and estado in ('inscrito','confirmado_gps','pendiente')
  returning estado into v_estado;

  if found and v_estado in ('inscrito','confirmado_gps') then
    v_solto := true;
    update public.matches
       set cupos_disponibles = cupos_disponibles + 1,
           estado = case when estado = 'lleno' then 'abierto' else estado end
     where id = p_old;
    insert into public.messages (sender_id, match_id, content)
    values (v_user, p_old, 'Un jugador se ha salido, ¡vuelve a haber un cupo disponible!');
  end if;

  -- Sanción leve por arrepentido (−3), solo a quien de verdad dejó un cupo
  -- botado (108).
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

-- ---------------------------------------------------------------------------
-- 2. El anfitrión que se cambia CANCELA su partido, no lo borra.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_match_and_join(p_old uuid, p_new uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_old record; v_new record; v_prof record; r record; v_username text; v_when text;
  v_cancelado uuid;
begin
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'No autenticado'); end if;

  select * into v_old from public.matches where id = p_old for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'Partido no existe'); end if;

  -- GUARDA 50, que faltaba en esta puerta: un encuentro entre clubes se
  -- cancela desde el hilo del desafío, con motivo, sanción al club y aviso a
  -- los dos. Acá se borraba entero y sin nada de eso.
  if v_old.challenge_proposal_id is not null then
    return jsonb_build_object('ok', false, 'reason',
      'Un encuentro entre clubes se cancela desde el hilo del desafío, no desde el partido');
  end if;

  if v_old.id_organizador <> v_user then
    return jsonb_build_object('ok', false, 'reason', 'No eres el organizador de ese partido');
  end if;

  -- Cancelar lo ya cancelado volvía a cobrar los 25 puntos (125).
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

  -- El partido se CANCELA, como en la 34: la fila se queda, con sus inscritos
  -- y su chat en sólo lectura, y el aviso que reciben apunta a un partido que
  -- de verdad se puede abrir. El `where estado <> 'cancelado' returning` es la
  -- reclamación: si no canceló esta llamada, no cobra esta llamada.
  update public.matches
     set estado = 'cancelado'
   where id = p_old and estado <> 'cancelado'
  returning id into v_cancelado;
  if v_cancelado is null then
    return jsonb_build_object('ok', false, 'reason', 'Ese partido ya está cancelado');
  end if;

  -- Penalización de anfitrión que cancela para irse a otro partido. Son 25 y
  -- no los 15 de `cancel_match` a propósito: ver la cabecera.
  update public.profiles set trust_score = greatest(trust_score - 25, 0) where id = v_user;

  -- Avisar a los inscritos que su partido se canceló.
  v_when := to_char(v_old.hora at time zone 'America/Santiago', 'HH24:MI');
  for r in
    select distinct id_jugador from public.attendees
    where id_partido = p_old
      and estado in ('pendiente', 'inscrito', 'confirmado_gps')
      and id_jugador <> v_user and id_jugador is not null
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

  -- Y a la lista de espera, que además se cierra. Antes desaparecía con el
  -- `cascade` sin que nadie de la cola se enterara de nada.
  for r in
    select id_jugador from public.match_waitlist where id_partido = p_old
  loop
    perform public.create_notification(
      r.id_jugador, 'match_cancelled',
      '❌ Partido cancelado',
      format('«%s» fue cancelado, así que la lista de espera se cerró.',
             coalesce(v_old.titulo, 'El partido')),
      jsonb_build_object('matchId', p_old)
    );
  end loop;
  delete from public.match_waitlist where id_partido = p_old;

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
