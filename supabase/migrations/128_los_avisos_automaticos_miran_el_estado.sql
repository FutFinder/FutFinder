-- 128. Los avisos automáticos miran el estado del partido, y el rechazo no
-- borra a quien ya está dentro.
--
-- Barrido de las 25 funciones que escriben `matches`, `attendees` o
-- `match_waitlist`, buscando la familia de las migraciones 122 a 127: leer y
-- decidir antes de escribir, y no mirar el estado del partido. Las que mueven
-- reputación ya quedaron todas bajo bloqueo. Quedaban éstas.
--
-- ── 1. EL RECORDATORIO DE 1 HORA NO LE LLEGA A LOS PARTIDOS LLENOS ────────
-- `send_match_reminders` filtra `estado = 'abierto'`. Un partido que se llenó
-- pasa a `lleno`, así que **los partidos que de verdad se van a jugar son
-- justo los que no reciben el aviso**. Es el mismo defecto que la 104 corrigió
-- en `get_schedule_conflict` y en el trigger de agenda: mirar un solo estado
-- donde el vocabulario son tres. Por eso acá se usa
-- `estados_que_ocupan_horario()`, que es el sitio único donde vive esa lista.
-- Corre cada 5 minutos por `cron` (jobid 1), así que esto está pasando ahora.
--
-- Y el aviso se le manda sólo a quien tiene cupo (`inscrito`/`confirmado_gps`).
-- Antes lo recibía cualquier fila de `attendees`: «tu partido empieza en 1
-- hora» a alguien con una solicitud que el organizador nunca aprobó.
--
-- ── 2. EL RECORDATORIO DE CALIFICAR SE MANDA EN PARTIDOS CANCELADOS ───────
-- `send_rating_reminders` no mira el estado. Cancelar no borra las marcas de
-- GPS, así que a quien alcanzó a marcar antes de la cancelación le llegaba
-- «¿cómo estuvo el partido? califica a tus compañeros» por un partido que no
-- se jugó. Es N10 otra vez, por la puerta del cron: la 124 cerró la política
-- de `ratings` y la interfaz, y el aviso seguía invitando a un callejón sin
-- salida.
--
-- ── 3. `reject_join` PODÍA BORRAR A UN JUGADOR YA APROBADO ────────────────
-- Leía la solicitud `pendiente` y después borraba POR ID, sin volver a exigir
-- que siguiera pendiente y sin bloquear el partido. Si el organizador aprueba
-- y rechaza a la vez —dos pestañas, dos dispositivos—, `approve_join` deja la
-- fila en `inscrito` y el `delete` se la lleva igual: el jugador entra y
-- desaparece, y el cupo que `approve_join` descontó queda mal contado hasta
-- que otra operación toque las columnas de cupos y la guarda de la 105
-- recalcule. Ahora toma el bloqueo del partido —el mismo orden que el resto—
-- y el `delete` exige `estado = 'pendiente'`.
--
-- ── 4. `approve_join` APROBABA UNA SOLICITUD YA RETIRADA ──────────────────
-- El mismo `update … where id = …` sin condición: si el jugador retira su
-- solicitud en ese instante (`cancel_join_request`), el update no movía nada
-- pero igual se mandaba «tu solicitud fue aceptada ✓». El cupo se arreglaba
-- solo por la guarda; el aviso mentía.
--
-- ── 5. `leave_club_match` SOBRE UN PARTIDO CANCELADO ──────────────────────
-- No miraba el estado: salirse de un encuentro ya cancelado sumaba un cupo a
-- un partido que no se juega. En los partidos de clubes la guarda de la 105 NO
-- recalcula la disponibilidad —cada club lleva su cuenta—, así que ese +1 se
-- quedaba. Mismo criterio que la 122: de un partido cancelado no se sale.
--
-- QUÉ NO SE TOCA. `cancel_join_request`, `join_match`, `join_club_match`,
-- `approve_join` en lo demás, `avanzar_lista_de_espera`, `confirmar_nomina_club`
-- y `leave_waitlist` se revisaron una por una y están bien: o reclaman con la
-- misma sentencia que escriben, o todo su trabajo ocurre bajo el bloqueo del
-- partido. `request_join` puede chocar con su propio índice único si alguien
-- pulsa dos veces en el mismo instante; devuelve un error feo en vez de «ya
-- enviaste una solicitud», y se corrige acá porque es una línea.
--
-- Ninguna de estas funciones estaba versionada con su cuerpo: se leyeron de
-- `pg_proc` y se versionan enteras, como hizo la 124 con la política de
-- `ratings`.
--
-- QUÉ QUEDÓ MEDIDO Y QUÉ NO. El arnés corre los dos cron de verdad y
-- reprodujo contra producción, con las funciones vivas, tres de estas fallas:
-- el partido lleno sin recordatorio (cero avisos), el aviso de calificar en un
-- partido cancelado (uno) y la salida de un encuentro cancelado sumando un
-- cupo (10 → 11). Los dos endurecimientos de `reject_join` y `approve_join`
-- NO se pueden reproducir con una sola conexión —la ventana está entre el
-- `select` y el `update`—, así que ahí el arnés fija la no regresión y el
-- arreglo se apoya en el mismo orden de bloqueos que el resto.
--
-- Regresión: supabase/tests/128_los_avisos_automaticos_miran_el_estado_test.sql

-- ---------------------------------------------------------------------------
-- 1. El recordatorio de 1 hora
-- ---------------------------------------------------------------------------
create or replace function public.send_match_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  a record;
  v_when_str text;
begin
  for m in
    select id, titulo, hora, comuna, cancha_nombre
    from public.matches
    where estado = any (public.estados_que_ocupan_horario())
      and reminder_sent_at is null
      and hora between now() + interval '55 minutes'
                   and now() + interval '65 minutes'
  loop
    v_when_str := to_char(m.hora at time zone 'America/Santiago', 'HH24:MI');

    for a in
      select distinct id_jugador
      from public.attendees
      where id_partido = m.id
        and estado in ('inscrito', 'confirmado_gps')
        and id_jugador is not null
    loop
      perform public.create_notification(
        a.id_jugador,
        'match_reminder',
        'Tu partido empieza en 1 hora',
        coalesce(m.titulo, 'Partido')
          || ' · ' || coalesce(m.cancha_nombre, 'Cancha')
          || ' · ' || v_when_str,
        jsonb_build_object(
          'matchId', m.id,
          'when',    m.hora
        )
      );
    end loop;

    update public.matches
       set reminder_sent_at = now()
     where id = m.id;
  end loop;
end;
$$;
revoke all on function public.send_match_reminders() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. El recordatorio de calificar
-- ---------------------------------------------------------------------------
create or replace function public.send_rating_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  a record;
begin
  -- Partidos cuyo kickoff fue hace entre 90 y 105 min, aún sin recordar.
  -- Un partido cancelado no se califica (124): invitarlo es mandar a la gente
  -- a una pantalla que le va a decir que no.
  for m in
    select id, titulo, cancha_nombre
    from public.matches
    where rating_reminder_sent_at is null
      and estado <> 'cancelado'
      and hora between now() - interval '105 minutes'
                   and now() - interval '90 minutes'
  loop
    for a in
      select distinct id_jugador
      from public.attendees
      where id_partido = m.id
        and estado = 'confirmado_gps'
        and id_jugador is not null
    loop
      perform public.create_notification(
        a.id_jugador,
        'match_rate',
        '¿Cómo estuvo el partido?',
        'Califica a tus compañeros de '
          || coalesce(m.cancha_nombre, m.titulo, 'tu partido'),
        jsonb_build_object('matchId', m.id)
      );
    end loop;

    update public.matches
       set rating_reminder_sent_at = now()
     where id = m.id;
  end loop;
end;
$$;
revoke all on function public.send_rating_reminders() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Rechazar una solicitud
-- ---------------------------------------------------------------------------
create or replace function public.reject_join(p_match_id uuid, p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_match record;
  v_borrada uuid;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'No autenticado');
  end if;

  -- Mismo orden de bloqueos que el resto: primero el partido. Sin esto,
  -- rechazar podía cruzarse con aprobar al mismo jugador.
  select * into v_match from public.matches where id = p_match_id for update;
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

  -- La reclamación es el propio borrado, y exige que siga PENDIENTE: un
  -- jugador ya aceptado no sale por acá, sale del plantel.
  delete from public.attendees
   where id_partido = p_match_id
     and id_jugador = p_player_id
     and estado = 'pendiente'
  returning id into v_borrada;

  if v_borrada is null then
    return jsonb_build_object('ok', false, 'reason', 'No hay solicitud pendiente');
  end if;

  perform public.create_notification(
    p_player_id, 'join_rejected', 'Tu solicitud no fue aceptada',
    'El organizador de ' || coalesce(v_match.titulo, 'el partido')
      || ' no aprobó tu solicitud esta vez',
    jsonb_build_object('matchId', p_match_id)
  );

  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.reject_join(uuid, uuid) from public, anon;
grant execute on function public.reject_join(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Aprobar una solicitud
-- ---------------------------------------------------------------------------
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
  v_edad  integer;
  v_aprobada uuid;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'No autenticado');
  end if;

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'Partido no encontrado');
  end if;

  if v_match.challenge_proposal_id is not null then
    return jsonb_build_object('ok', false,
      'reason', 'En un partido entre clubes la nómina la confirma un administrador de cada club');
  end if;

  if v_match.id_organizador <> v_user then
    return jsonb_build_object('ok', false, 'reason', 'Solo el organizador puede aprobar');
  end if;

  if v_match.estado = 'cancelado' then
    return jsonb_build_object('ok', false, 'reason', 'Cancelaste este partido: ya no puedes aceptar jugadores');
  end if;
  if v_match.estado not in ('abierto','lleno') then
    return jsonb_build_object('ok', false, 'reason', 'El partido ya no admite jugadores');
  end if;
  if v_match.hora <= now() then
    return jsonb_build_object('ok', false, 'reason', 'El partido ya empezó: ya no puedes aceptar jugadores');
  end if;

  select * into v_att from public.attendees
   where id_partido = p_match_id and id_jugador = p_player_id and estado = 'pendiente';
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'No hay solicitud pendiente de ese jugador');
  end if;
  if v_match.cupos_disponibles <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'No quedan cupos');
  end if;

  select edad into v_edad from public.profiles where id = p_player_id;
  if public.edad_fuera_de_rango(v_edad, v_match.edad_min, v_match.edad_max) then
    return jsonb_build_object('ok', false,
      'reason', format('Ese jugador tiene %s años y tu partido es %s',
                       v_edad, public.rango_de_edad_legible(v_match.edad_min, v_match.edad_max)));
  end if;

  -- La transición manda: si el jugador retiró su solicitud en este instante,
  -- no se aprueba nada y no se le avisa que entró.
  update public.attendees
     set estado = 'inscrito'
   where id = v_att.id and estado = 'pendiente'
  returning id into v_aprobada;
  if v_aprobada is null then
    return jsonb_build_object('ok', false, 'reason', 'No hay solicitud pendiente de ese jugador');
  end if;

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
revoke all on function public.approve_join(uuid, uuid) from public, anon;
grant execute on function public.approve_join(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Salirse de un partido entre clubes
-- ---------------------------------------------------------------------------
create or replace function public.leave_club_match(p_match_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me    uuid := auth.uid();
    v_match public.matches;
    v_att   public.attendees;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    select * into v_match from public.matches where id = p_match_id for update;
    if not found then
        return json_build_object('ok', false, 'reason', 'Partido no existe');
    end if;
    if v_match.challenge_proposal_id is null then
        return json_build_object('ok', false,
            'reason', 'Este no es un partido entre clubes');
    end if;

    -- De un encuentro cancelado o terminado no se sale: no hay cupo que
    -- devolverle a nadie, y en los partidos de clubes la guarda de cupos no
    -- recalcula, así que ese +1 se quedaría escrito para siempre.
    if v_match.estado = 'cancelado' then
        return json_build_object('ok', false,
            'reason', 'Este encuentro fue cancelado: no tienes que salirte');
    end if;
    if v_match.estado = 'finalizado' then
        return json_build_object('ok', false, 'reason', 'Este encuentro ya terminó');
    end if;

    -- Todo esto ocurre con el partido bloqueado, y los demás escritores de
    -- esta nómina (`join_club_match`, `confirmar_nomina_club`) toman el mismo
    -- bloqueo: dos salidas a la vez no pueden liberar dos cupos.
    select * into v_att from public.attendees
     where id_partido = p_match_id and id_jugador = v_me;
    if not found then
        return json_build_object('ok', true, 'noEstabas', true);
    end if;

    delete from public.attendees where id = v_att.id;

    -- Sólo libera cupo lo que lo consumía. Una postulación pendiente no
    -- tenía ninguno.
    if v_att.estado in ('inscrito', 'confirmado_gps') then
        update public.matches
           set cupos_disponibles = least(cupos_disponibles + 1, cupos_totales),
               estado = case when estado = 'lleno' then 'abierto' else estado end
         where id = p_match_id;
    end if;

    return json_build_object('ok', true, 'liberoCupo',
        v_att.estado in ('inscrito', 'confirmado_gps'));
end;
$$;
revoke all on function public.leave_club_match(uuid) from public, anon;
grant execute on function public.leave_club_match(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Pedir entrar a un partido de aprobación manual
-- ---------------------------------------------------------------------------
create or replace function public.request_join(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_match record; v_existing record; v_username text; v_prof record;
begin
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'No autenticado'); end if;
  select * into v_match from public.matches where id = p_match_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'Partido no encontrado'); end if;
  if v_match.estado <> 'abierto' then return jsonb_build_object('ok', false, 'reason', 'El partido no está abierto'); end if;
  if v_match.id_organizador = v_user then return jsonb_build_object('ok', false, 'reason', 'Eres el organizador'); end if;
  if v_match.cupos_disponibles <= 0 then return jsonb_build_object('ok', false, 'reason', 'No quedan cupos'); end if;

  select trust_score, estado, suspended_until, edad into v_prof from public.profiles where id = v_user;
  if v_prof.estado = 'suspendido' and (v_prof.suspended_until is null or v_prof.suspended_until > now()) then
    return jsonb_build_object('ok', false, 'reason', 'Tu cuenta está suspendida temporalmente');
  end if;
  if coalesce(v_prof.trust_score,0) < coalesce(v_match.min_trust_score,0) then
    return jsonb_build_object('ok', false, 'reason',
      'Trust Score insuficiente: necesitas ' || v_match.min_trust_score || ' y tienes ' || coalesce(v_prof.trust_score,0));
  end if;
  if public.edad_fuera_de_rango(v_prof.edad, v_match.edad_min, v_match.edad_max) then
    return jsonb_build_object('ok', false, 'reason',
      format('Este partido es para jugadores %s y tu perfil dice %s',
             public.rango_de_edad_legible(v_match.edad_min, v_match.edad_max), v_prof.edad));
  end if;

  select * into v_existing from public.attendees where id_partido = p_match_id and id_jugador = v_user;
  if found then
    if v_existing.estado = 'pendiente' then return jsonb_build_object('ok', false, 'reason', 'Ya enviaste una solicitud');
    elsif v_existing.estado in ('inscrito','confirmado_gps') then return jsonb_build_object('ok', false, 'reason', 'Ya estás en el partido');
    else update public.attendees set estado = 'pendiente' where id = v_existing.id; end if;
  else
    -- Dos pulsaciones en el mismo instante chocaban con el índice único y
    -- devolvían el error crudo de PostgreSQL. La segunda es la misma
    -- solicitud, no un fallo.
    insert into public.attendees (id_partido, id_jugador, estado)
    values (p_match_id, v_user, 'pendiente')
    on conflict (id_partido, id_jugador) do nothing;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'Ya enviaste una solicitud');
    end if;
  end if;

  select username into v_username from public.profiles where id = v_user;
  perform public.create_notification(
    v_match.id_organizador, 'join_request',
    coalesce(v_username, 'Alguien') || ' quiere unirse a tu partido',
    coalesce(v_match.titulo, 'Partido') || case when v_match.cancha_nombre is not null then ' · ' || v_match.cancha_nombre else '' end,
    jsonb_build_object('matchId', p_match_id, 'playerId', v_user)
  );
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.request_join(uuid) from public, anon;
grant execute on function public.request_join(uuid) to authenticated;
