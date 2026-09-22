-- 122. Una salida se cobra una sola vez, y una asistencia se premia una sola vez.
--
-- Los cuatro P1 de la revisión del 21 de septiembre de 2026 (N01–N04). Son el
-- mismo defecto visto por cuatro lados: las tres RPC LEEN el estado, deciden, y
-- recién después escriben. Entre la lectura y la escritura cabe otra sesión —o
-- el propio partido cambiado de estado— y el efecto se aplica dos veces, o se
-- aplica sobre un partido que ya no existe como tal.
--
--  N01  SALIR DE UN PARTIDO CANCELADO LO REABRÍA Y CASTIGABA AL JUGADOR.
--       `leave_match_penalized` nunca miraba `estado`. Salirse de un partido
--       que el organizador ya había cancelado devolvía éxito, escribía
--       `estado = 'abierto'` —resucitando el partido para todo el buscador— y
--       le restaba 3 puntos a quien no había hecho nada. Medido: 80 → 77.
--
--  N02  DOS SALIDAS SIMULTÁNEAS COBRABAN DOS VECES LA MISMA SANCIÓN.
--       La inscripción se leía sin bloquearla. La segunda sesión veía la fila
--       todavía viva, borraba cero filas… y aun así liberaba cupo, avisaba al
--       chat y descontaba. Medido con dos conexiones: 80 → 74 por UNA salida.
--
--  N03  DOS CONFIRMACIONES GPS SIMULTÁNEAS DUPLICABAN ASISTENCIA Y PUNTO.
--       El «ya estaba confirmado» se comprobaba sin bloqueo y el UPDATE
--       posterior no exigía que el estado siguiera siendo 'inscrito'.
--
--  N04  GUARDAR LA ASISTENCIA A LA VEZ DUPLICABA EL PREMIO Y EL CONTADOR.
--       La 107 arregló el camino secuencial (corregir una marca no cuesta
--       puntos) leyendo lo ya aplicado en `trust_score_history`. Pero dos
--       guardados concurrentes leen ESE MISMO historial previo y los dos
--       calculan la misma diferencia. Medido: 80 → 84 y dos asistencias.
--
-- LA FORMA DEL ARREGLO, que es una sola para las cuatro:
--
--   · UN ORDEN DE BLOQUEOS, SIEMPRE EL MISMO: primero la fila del partido
--     (`select ... for update`), después la de la inscripción. Las tres
--     funciones lo respetan, así que no hay forma de que se enreden entre
--     ellas. `confirm_attendance_gps` es la excepción a propósito: bloquea
--     sólo su inscripción, porque serializar por partido dejaría a veintidós
--     jugadores haciendo fila para marcar GPS al mismo tiempo, y su
--     inscripción es lo único que toca.
--
--   · LA RECLAMACIÓN ES LA ESCRITURA, no una lectura previa. La salida borra
--     con `delete ... returning` y sólo aplica efectos si de verdad borró la
--     fila; el GPS confirma con un `update ... where estado = 'inscrito'
--     returning` y sólo premia la transición efectiva. El reintento, la doble
--     pestaña y la sesión desactualizada caen todos en el mismo camino: «esto
--     ya estaba hecho», sin cobrar ni premiar de nuevo.
--
--   · EL ESTADO DEL PARTIDO SE VALIDA ANTES DE TOCAR NADA, y reabrir es
--     reabrir lo que estaba LLENO, no escribir 'abierto' encima de lo que
--     hubiera.
--
-- Regresión: supabase/tests/122_una_salida_y_una_asistencia_se_cobran_una_sola_vez_test.sql
-- (secuencial, corre por el MCP) y supabase/tests/partidos_salida_concurrente_test.cjs
-- (dos conexiones reales, que es lo único que reproduce N02–N04).

-- ---------------------------------------------------------------------------
-- N01 y N02. La salida.
-- ---------------------------------------------------------------------------
create or replace function public.leave_match_penalized(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_match record; v_estado text; v_pen int := 0; v_freed boolean := false;
begin
  if v_user is null then return jsonb_build_object('ok',false,'reason','No autenticado'); end if;

  -- El partido se bloquea ANTES de leer nada. Este es el primer eslabón del
  -- orden de bloqueos que comparten esta función y `save_match_attendance`:
  -- partido primero, inscripción después.
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then return jsonb_build_object('ok',false,'reason','Partido no existe'); end if;

  -- Simétrico al rechazo que ya hace `join_match`: si la inscripción es
  -- por club, la baja también. Va ANTES de la comprobación del anfitrión
  -- porque en un partido de clubes el anfitrión es el admin que aprobó, y
  -- «debes cancelar el partido» sería un consejo equivocado.
  if v_match.challenge_proposal_id is not null then
    return jsonb_build_object('ok', false,
      'reason', 'Este es un partido entre clubes: las bajas se gestionan por club');
  end if;

  if v_match.id_organizador = v_user then
    return jsonb_build_object('ok',false,'reason','Eres el anfitrión: debes cancelar el partido');
  end if;

  -- N01. De un partido cancelado no se sale: al jugador ya lo dejaron sin
  -- partido. Se rechaza SIN alterar nada —ni el estado del partido, ni el
  -- cupo, ni el puntaje— y la inscripción se queda donde está, porque es lo
  -- que el historial del jugador lee para mostrarle el partido caído.
  if v_match.estado = 'cancelado' then
    return jsonb_build_object('ok', false,
      'reason', 'Este partido fue cancelado por el organizador: no tienes que salirte');
  end if;

  -- Y de uno que ya terminó tampoco. `finalizado` lo escribe la asistencia,
  -- así que un partido que nadie cerró sigue diciendo 'abierto' un mes
  -- después: la vigencia se mide por el reloj, no sólo por el estado. Sin
  -- esto, «salirse» de un partido de la semana pasada costaba 20 puntos y lo
  -- devolvía al buscador.
  if v_match.estado = 'finalizado'
     or v_match.hora + make_interval(mins => coalesce(v_match.duracion_min, 90)) <= now() then
    return jsonb_build_object('ok', false, 'reason', 'Este partido ya terminó');
  end if;

  -- N02. La inscripción se reclama con la MISMA sentencia que la borra. Dos
  -- sesiones ya no pueden verla viva a la vez: la segunda borra cero filas y
  -- se va por acá, sin liberar cupo, sin avisar al chat y sin descontar.
  delete from public.attendees
   where id_partido = p_match_id
     and id_jugador = v_user
     and estado in ('inscrito','confirmado_gps','pendiente')
  returning estado into v_estado;

  if not found then return jsonb_build_object('ok',false,'reason','No estás en este partido'); end if;

  if v_estado in ('inscrito','confirmado_gps') then
    v_freed := true;
    v_pen := case when v_match.hora > now() + interval '2 hours' then 3 else 20 end;

    -- Se reabre lo que estaba LLENO. Antes se escribía 'abierto' encima de
    -- cualquier estado. La guarda de cupos (105) recalcula la disponibilidad
    -- con la nómina vigente, así que el `+ 1` es sólo la intención: la cuenta
    -- la hace ella.
    update public.matches
       set cupos_disponibles = cupos_disponibles + 1,
           estado = case when estado = 'lleno' then 'abierto' else estado end
     where id = p_match_id;

    insert into public.messages (sender_id, match_id, content)
    values (v_user, p_match_id, 'Un jugador se ha salido, ¡vuelve a haber un cupo disponible!');
    update public.profiles set trust_score = greatest(trust_score - v_pen, 0) where id = v_user;
  end if;

  return jsonb_build_object('ok', true, 'penalty', v_pen, 'freed', v_freed);
end $$;

revoke all on function public.leave_match_penalized(uuid) from public, anon;
grant execute on function public.leave_match_penalized(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- N03. La confirmación por GPS.
--
-- Igual que en la 107 salvo por el bloqueo y por la transición condicional: el
-- resto del cuerpo —ventana, distancia, ubicación del partido de clubes, el
-- punto de Trust Score y su fila en el historial— queda como estaba.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_attendance_gps(
    p_match_id uuid,
    p_user_lat numeric,
    p_user_lng numeric
)
returns json
language plpgsql
security definer
set search_path = public
as $$
DECLARE
    v_match        record;
    v_attendance   record;
    v_distance     numeric;
    v_lat          numeric;
    v_lng          numeric;
    v_within_window boolean;
    v_window_end   timestamptz;
    v_confirmada   uuid;
    v_user_id      uuid := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN
        RETURN json_build_object('ok', false, 'reason', 'No autenticado');
    END IF;

    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
    IF v_match IS NULL THEN
        RETURN json_build_object('ok', false, 'reason', 'Partido no existe');
    END IF;

    -- Se bloquea la inscripción propia, y sólo ella: el partido no, porque
    -- veintidós jugadores confirmando a la vez no tienen por qué hacer fila.
    -- La segunda pestaña espera acá y vuelve a leer DESPUÉS del COMMIT de la
    -- primera, así que ve 'confirmado_gps' y se va por el camino de abajo.
    SELECT * INTO v_attendance
    FROM public.attendees
    WHERE id_partido = p_match_id AND id_jugador = v_user_id
    FOR UPDATE;

    IF v_attendance IS NULL THEN
        RETURN json_build_object('ok', false, 'reason', 'No estás inscrito en este partido');
    END IF;

    IF v_attendance.estado = 'confirmado_gps' THEN
        RETURN json_build_object('ok', true, 'reason', 'Ya estaba confirmado', 'already', true);
    END IF;

    IF v_match.estado = 'cancelado' THEN
        RETURN json_build_object('ok', false, 'reason', 'Este partido fue cancelado');
    END IF;

    IF v_attendance.estado <> 'inscrito' THEN
        RETURN json_build_object('ok', false, 'reason',
            CASE v_attendance.estado
                WHEN 'pendiente' THEN 'Tu solicitud todavía está esperando la aprobación del organizador'
                ELSE 'Ya no tienes cupo en este partido'
            END);
    END IF;

    IF v_match.challenge_proposal_id IS NOT NULL THEN
        SELECT l.latitud, l.longitud INTO v_lat, v_lng
          FROM public.club_match_locations l
         WHERE l.match_id = p_match_id;
    ELSE
        v_lat := v_match.latitud;
        v_lng := v_match.longitud;
    END IF;

    IF v_lat IS NULL OR v_lng IS NULL THEN
        RETURN json_build_object(
            'ok', false,
            'reason', 'Este partido no tiene ubicación guardada, así que no podemos confirmar por GPS'
        );
    END IF;

    v_distance := public.haversine_meters(v_lat, v_lng, p_user_lat, p_user_lng);

    v_window_end := v_match.hora
        + (COALESCE(v_match.duracion_min, 90) || ' minutes')::interval
        + interval '30 minutes';
    v_within_window := now() BETWEEN (v_match.hora - interval '30 minutes') AND v_window_end;

    IF v_distance IS NULL OR v_distance > 200 THEN
        RETURN json_build_object('ok', false,
            'reason', 'Estás demasiado lejos de la cancha', 'distance', v_distance);
    END IF;

    IF NOT v_within_window THEN
        RETURN json_build_object('ok', false,
            'reason', 'Fuera de la ventana de confirmación (30 min antes / hasta 30 min después de terminar)',
            'distance', v_distance);
    END IF;

    -- La transición es la que manda: si la fila ya no está en 'inscrito', no
    -- se premia. El bloqueo de arriba ya lo impide; esto es la red que no
    -- depende de que nadie borre ese `FOR UPDATE` mañana.
    UPDATE public.attendees
       SET estado = 'confirmado_gps', confirmado_at = now(), distancia_metros = v_distance
     WHERE id = v_attendance.id AND estado = 'inscrito'
    RETURNING id INTO v_confirmada;

    IF v_confirmada IS NULL THEN
        RETURN json_build_object('ok', true, 'reason', 'Ya estaba confirmado', 'already', true);
    END IF;

    UPDATE public.profiles
    SET trust_score = LEAST(trust_score + 1, 100),
        asistencias_confirmadas = asistencias_confirmadas + 1
    WHERE id = v_user_id;

    INSERT INTO public.trust_score_history (user_id, change_amount, reason, match_id)
    VALUES (v_user_id, 1, 'Asistencia confirmada por GPS', p_match_id);

    RETURN json_build_object('ok', true, 'distance', v_distance,
        'reason', 'Asistencia confirmada por GPS');
END;
$$;
revoke all on function public.confirm_attendance_gps(uuid, numeric, numeric) from public, anon;
grant execute on function public.confirm_attendance_gps(uuid, numeric, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- N04. El registro de asistencia del organizador.
--
-- Mismo cuerpo de la 107 —que es el que decide por la marca FINAL y no por
-- cada clic— con dos bloqueos: el partido al principio y la inscripción de
-- cada jugador antes de leer su estado y su historial. Con el partido
-- bloqueado, dos guardados simultáneos dejan de ser simultáneos: el segundo
-- vuelve a leer lo que el primero ya aplicó, calcula diferencia cero y no
-- mueve nada. Que es justo lo que hace la 107 cuando se guarda dos veces
-- seguidas.
-- ---------------------------------------------------------------------------
create or replace function public.save_match_attendance(p_match_id uuid, p_marks jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid       uuid := auth.uid();
    v_match     record;
    v_fin       timestamptz;
    v_plazo     integer := (public.partido_reglas()->>'horas_plazo_asistencia')::int;
    v_key       text;
    v_val       text;
    v_presentes integer := 0;
    v_ausentes  integer := 0;
    v_prev      text;
    v_jug       uuid;
    v_aplicado  integer;
    v_objetivo  integer;
    v_antes     integer;
    v_despues   integer;
    v_motivo    text;
begin
    if v_uid is null then
        return jsonb_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    -- Primer eslabón del orden de bloqueos, el mismo que usa la salida.
    select * into v_match from public.matches where id = p_match_id for update;
    if not found then
        return jsonb_build_object('ok', false, 'reason', 'El partido no existe');
    end if;
    if v_match.id_organizador <> v_uid then
        return jsonb_build_object('ok', false, 'reason', 'Solo el organizador puede registrar la asistencia');
    end if;

    -- ── GUARDA 50: un partido entre clubes no pasa por acá ──────
    -- La asistencia y el cierre de un encuentro entre clubes los hace
    -- `proponer_resultado()` con el marcador, y el club CONTRARIO los
    -- confirma. Ver cabecera de la migración 50.
    if v_match.challenge_proposal_id is not null then
        return jsonb_build_object('ok', false, 'reason',
            'La asistencia de un partido entre clubes se registra junto al resultado, y la confirma el club contrario');
    end if;

    -- Un partido que no se jugó no tiene asistencia que registrar, y menos
    -- ausencias que penalizar.
    if v_match.estado = 'cancelado' then
        return jsonb_build_object('ok', false, 'reason',
            'Este partido está cancelado: no se registra asistencia');
    end if;

    v_fin := v_match.hora + make_interval(mins => coalesce(v_match.duracion_min, 90));
    if now() < v_fin then
        return jsonb_build_object('ok', false, 'reason', 'El partido todavía no ha terminado');
    end if;
    if now() > v_fin + make_interval(hours => v_plazo) then
        return jsonb_build_object('ok', false, 'reason',
            format('El plazo para registrar la asistencia era de %s h después del partido', v_plazo));
    end if;

    for v_key, v_val in select * from jsonb_each_text(p_marks) loop
        if v_val not in ('presente', 'ausente') then
            continue;
        end if;
        v_jug := v_key::uuid;

        -- Segundo eslabón: la inscripción, bloqueada antes de leer su estado.
        -- Sin esto, otra sesión puede estar confirmando el GPS de este mismo
        -- jugador mientras acá se calcula la diferencia con el estado viejo.
        select estado into v_prev
        from public.attendees
        where id_partido = p_match_id and id_jugador = v_jug
        for update;

        if v_prev is null or v_prev in ('pendiente', 'cancelado') then
            continue;
        end if;

        -- Lo que ESTA función ya movió por este partido y este jugador. El
        -- punto que da el GPS no se toca: lo ganó el jugador por estar en la
        -- cancha, no lo otorgó el organizador.
        select coalesce(sum(change_amount), 0) into v_aplicado
          from public.trust_score_history
         where user_id = v_jug
           and match_id = p_match_id
           and reason in ('Asistencia registrada por el organizador',
                          'Ausencia registrada por el organizador');

        if v_val = 'presente' then
            v_objetivo := 2;
            v_motivo := 'Asistencia registrada por el organizador';

            update public.attendees
               set estado = 'confirmado_gps',
                   confirmado_at = coalesce(confirmado_at, now())
             where id_partido = p_match_id and id_jugador = v_jug;

            -- El contador cuenta asistencias, no clics: sube solo al entrar
            -- al estado, y la marca contraria lo devuelve.
            if v_prev <> 'confirmado_gps' then
                update public.profiles
                   set asistencias_confirmadas = asistencias_confirmadas + 1
                 where id = v_jug;
            end if;
            v_presentes := v_presentes + 1;
        else
            v_objetivo := -15;
            v_motivo := 'Ausencia registrada por el organizador';

            update public.attendees
               set estado = 'no_asistio'
             where id_partido = p_match_id and id_jugador = v_jug;

            if v_prev = 'confirmado_gps' then
                update public.profiles
                   set asistencias_confirmadas = greatest(0, asistencias_confirmadas - 1)
                 where id = v_jug;
            end if;

            if v_prev <> 'no_asistio' then
                insert into public.notifications (user_id, type, title, body, data)
                values (v_jug, 'match_attendance', 'Quedaste como ausente',
                        format('El organizador marcó que no asististe a «%s».', v_match.titulo),
                        jsonb_build_object('matchId', p_match_id));
            end if;
            v_ausentes := v_ausentes + 1;
        end if;

        -- Se mueve la DIFERENCIA hasta donde corresponde estar, no un
        -- movimiento nuevo por cada vez que se guarda.
        if v_objetivo <> v_aplicado then
            select trust_score into v_antes from public.profiles where id = v_jug;
            update public.profiles
               set trust_score = least(100, greatest(0, trust_score + (v_objetivo - v_aplicado)))
             where id = v_jug
            returning trust_score into v_despues;

            -- Se guarda lo que de verdad se movió, ya con el tope aplicado.
            if v_despues <> v_antes then
                insert into public.trust_score_history (user_id, change_amount, reason, match_id)
                values (v_jug, v_despues - v_antes, v_motivo, p_match_id);
            end if;
        end if;
    end loop;

    update public.matches
       set estado = 'finalizado'
     where id = p_match_id and estado not in ('cancelado', 'finalizado');

    return jsonb_build_object('ok', true, 'presentes', v_presentes, 'ausentes', v_ausentes);
end;
$$;
revoke all on function public.save_match_attendance(uuid, jsonb) from public, anon;
grant execute on function public.save_match_attendance(uuid, jsonb) to authenticated;
