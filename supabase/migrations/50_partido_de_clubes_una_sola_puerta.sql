-- =============================================================
-- FutFinder — migración 50: el encuentro entre clubes tiene UNA
-- SOLA PUERTA, y los textos del rechazo dejan de contradecir la 48b
-- (Tarea 6.3, cierre de la Fase 6).
--
-- Tres correcciones de LECTURA HUMANA y de AUTORIZACIÓN. Ninguna
-- tabla nueva, ninguna política tocada, ningún dato migrado.
--
-- ── 1. DOS TEXTOS QUE CONTRADECÍAN LA 48b ────────────────────────
-- La 48b dejó `resultado_en_disputa` como un callejón sin salida para
-- los clubes: sólo la moderación reabre una disputa. Pero se corrigió
-- únicamente la GUARDA de `proponer_resultado()`, y `confirmar_resultado()`
-- siguió diciendo lo contrario en las dos frases que la gente sí lee:
--
--   · el aviso del rechazo: «… rechazó el marcador propuesto para «X».
--     Propongan uno nuevo.» — es una instrucción que el servidor rechaza
--     acto seguido con «Este desafío no está esperando un resultado».
--   · el motivo de error al confirmar algo ya rechazado: «pide que
--     propongan uno nuevo».
--
-- Un aviso que pide una acción imposible es peor que no avisar: manda a
-- dos administradores a pelearse con un botón que no existe. Ahora las
-- dos frases dicen lo que de verdad pasa —el encuentro queda en disputa
-- y las estadísticas no se mueven hasta que la moderación lo revise—,
-- que es exactamente lo que ya devolvía `getChallengeCta()` en la
-- pantalla. El resto de `confirmar_resultado()` no cambia una línea.
--
-- ── 2 y 3. LAS DOS PUERTAS TRASERAS DEL PARTIDO DE CLUBES ────────
-- `matches.id_organizador` de un encuentro entre clubes es el
-- administrador que aprobó la propuesta —la columna es NOT NULL y
-- alguien tiene que ir ahí—, y eso lo dejaba pasar por dos RPC
-- genéricas que nunca se pensaron para este flujo:
--
--   · `save_match_attendance()` (33) marcaba la asistencia con −15 de
--     Trust Score por ausente y ponía `matches.estado = 'finalizado'`
--     SIN mirar `club_match_results`. Es decir: un solo club podía dar
--     por jugado el encuentro y castigar a los jugadores del rival, sin
--     marcador y sin que el otro club confirmara nada. Es también el
--     origen del estado que la migración 49 tuvo que defender en el
--     historial («finalizado» sin resultado confirmado): la 49 tapó el
--     síntoma en la lectura, ésta cierra la causa en la escritura.
--   · `cancel_match()` (34) cancelaba el partido penalizando el Trust
--     Score del organizador y sin sancionar a ningún club, dejando
--     además el desafío apuntando a un partido cancelado. La 47 dice en
--     su cabecera que los partidos normales «conservan `cancel_match()`
--     intacta», dando por hecho que los de clubes irían por
--     `cancelar_encuentro_club()`; nunca se cerró la otra puerta.
--
-- LA INTERFAZ YA NO LAS OFRECÍA: `MatchDetailScreen` calcula
-- `isOrganizer` con `&& !usaNominaClub`, así que para un partido nacido
-- de una propuesta no dibuja el engranaje que lleva a «Gestionar». Pero
-- eso es una convención del cliente, no una regla del servidor — el
-- mismo razonamiento con el que la 44e cerró la escritura directa de
-- `attendees` y con el que la 48b cerró su propia puerta trasera:
-- «nadie la vería en la interfaz, pero una llamada directa a la RPC sí
-- podría».
--
-- QUÉ NO CAMBIA: los partidos normales (`challenge_proposal_id is
-- null`) siguen funcionando exactamente igual en las dos funciones —el
-- arnés lo comprueba—, y el flujo de clubes conserva sus dos puertas
-- propias: `proponer_resultado()`/`confirmar_resultado()` para la
-- asistencia y el cierre, y `cancelar_encuentro_club()` para la
-- cancelación con sanción de club.
--
-- Las tres funciones se copian de su versión APLICADA (contrastada con
-- `pg_get_functiondef` contra el proyecto el 2026-08-17) y se les agrega
-- sólo lo descrito acá: nunca se edita una migración que ya corrió.
-- =============================================================

-- ── 1. LOS TEXTOS DEL RECHAZO ────────────────────────────────────
create or replace function public.confirmar_resultado(
    p_result_id uuid,
    p_aceptar   boolean
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me      uuid := auth.uid();
    v_res     public.club_match_results;
    v_match   public.matches;
    v_row     public.club_challenges;
    v_club    uuid;
    v_en_prop boolean;
    v_nombre  text;
    v_user    text;
    v_titulo  text;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    select * into v_res from public.club_match_results where id = p_result_id;
    if not found then
        return json_build_object('ok', false, 'reason', 'Este resultado ya no existe');
    end if;

    -- Fila grande primero (el partido), después el desafío, y al final
    -- la propia fila del resultado. Mismo orden que el resto del ciclo.
    select * into v_match from public.matches where id = v_res.match_id for update;
    if not found then
        return json_build_object('ok', false, 'reason', 'El partido de este resultado ya no existe');
    end if;
    select * into v_row from public.club_challenges where id = v_res.challenge_id for update;
    if not found then
        return json_build_object('ok', false, 'reason', 'Este desafío ya no existe');
    end if;
    select * into v_res from public.club_match_results where id = p_result_id for update;

    -- ── autorización, antes de cualquier salida temprana ────────
    if v_res.propuesto_por = v_me then
        return json_build_object('ok', false,
            'reason', 'No puedes confirmar tu propio resultado: lo confirma el club contrario');
    end if;

    select cm.club_id into v_club
      from public.club_members cm
     where cm.user_id = v_me
       and cm.rol = 'admin'
       and cm.club_id in (v_row.club_retador_id, v_row.club_retado_id)
       and cm.club_id <> v_res.club_proponente_id
     limit 1;

    if v_club is null then
        return json_build_object('ok', false,
            'reason', 'Solo un administrador del club contrario puede confirmar este resultado');
    end if;

    -- No pertenecer al club proponente EN NINGÚN ROL: la regla estricta
    -- de la 43d, para que quien está en los dos clubes no se confirme a
    -- sí mismo por la puerta de al lado.
    select exists (
        select 1 from public.club_members cm
         where cm.user_id = v_me and cm.club_id = v_res.club_proponente_id
    ) into v_en_prop;

    if v_en_prop then
        return json_build_object('ok', false,
            'reason', 'No puedes confirmar un resultado propuesto por un club al que perteneces');
    end if;

    -- ── estado de la propuesta ───────────────────────────────────
    if v_res.estado = 'confirmado' then
        return json_build_object('ok', true, 'already', true,
            'aceptado', true, 'resultId', v_res.id, 'estado', v_res.estado);
    end if;
    if v_res.estado <> 'propuesto' then
        return json_build_object('ok', false,
            'reason', 'Este resultado quedó rechazado y el encuentro está en disputa: sólo la moderación puede reabrirlo');
    end if;

    select nombre into v_nombre from public.clubs where id = v_club;
    select username into v_user from public.profiles where id = v_me;
    v_titulo := coalesce(v_match.titulo, 'el partido');

    -- ── rechazar: sin tocar estadísticas ─────────────────────────
    if not coalesce(p_aceptar, false) then
        update public.club_match_results
           set estado = 'rechazado'
         where id = v_res.id and estado = 'propuesto'
        returning * into v_res;
        if not found then
            return json_build_object('ok', false, 'reason', 'Este resultado ya fue respondido');
        end if;

        update public.club_challenges
           set estado = 'resultado_en_disputa'
         where id = v_row.id and estado in ('esperando_resultado', 'resultado_en_disputa')
        returning * into v_row;

        insert into public.club_challenge_events (challenge_id, tipo, actor_id, club_id, payload)
        values (v_row.id, 'resultado_disputado', v_me, v_club,
            jsonb_build_object(
                'result_id',            v_res.id,
                'match_id',             v_match.id,
                'club_responde_id',     v_club,
                'club_responde_nombre', coalesce(v_nombre, 'Un club'),
                'actor_id',             v_me,
                'actor_username',       v_user,
                'goles_local',          v_res.goles_local,
                'goles_visitante',      v_res.goles_visitante));

        perform public.desafio_avisar(
            v_row,
            'club_resultado_disputado',
            'Rechazaron el resultado',
            coalesce(v_nombre, 'El club rival') || ' rechazó el marcador propuesto para «'
                || v_titulo || '». El encuentro queda en disputa: las estadísticas no cambian '
                || 'hasta que la moderación lo revise.',
            array[v_res.club_proponente_id],
            v_me,
            jsonb_build_object('matchId', v_match.id, 'resultId', v_res.id),
            true);

        return json_build_object('ok', true, 'aceptado', false,
            'resultId', v_res.id, 'estado', v_res.estado);
    end if;

    -- ── aceptar ───────────────────────────────────────────────────
    update public.club_match_results
       set estado = 'confirmado', confirmado_por = v_me, confirmado_at = now()
     where id = v_res.id and estado = 'propuesto'
    returning * into v_res;
    if not found then
        return json_build_object('ok', false, 'reason', 'Este resultado ya fue respondido');
    end if;

    update public.matches
       set estado = 'finalizado'
     where id = v_match.id and estado <> 'cancelado'
    returning * into v_match;

    update public.club_challenges
       set estado = 'finalizado'
     where id = v_row.id and estado in ('esperando_resultado', 'resultado_en_disputa')
    returning * into v_row;

    insert into public.club_challenge_events (challenge_id, tipo, actor_id, club_id, payload)
    values (v_row.id, 'resultado_confirmado', v_me, v_club,
        jsonb_build_object(
            'result_id',            v_res.id,
            'match_id',             v_match.id,
            'club_confirma_id',     v_club,
            'club_confirma_nombre', coalesce(v_nombre, 'Un club'),
            'actor_id',             v_me,
            'actor_username',       v_user,
            'goles_local',          v_res.goles_local,
            'goles_visitante',      v_res.goles_visitante));

    perform public.desafio_avisar(
        v_row,
        'club_resultado_confirmado',
        'Confirmaron el resultado',
        coalesce(v_nombre, 'El club rival') || ' confirmó ' || v_res.goles_local || '-' || v_res.goles_visitante
            || ' en «' || v_titulo || '». Quedó en el historial.',
        array[v_res.club_proponente_id],
        v_me,
        jsonb_build_object('matchId', v_match.id, 'resultId', v_res.id),
        true);

    return json_build_object('ok', true, 'aceptado', true,
        'resultId', v_res.id, 'estado', v_res.estado);
end;
$$;
revoke execute on function public.confirmar_resultado(uuid, boolean) from public, anon;
grant execute on function public.confirmar_resultado(uuid, boolean) to authenticated;

comment on function public.confirmar_resultado(uuid, boolean) is
    'El club contrario al proponente confirma o rechaza el resultado (migración 48, textos corregidos en la 50). Aceptar cierra el desafío en finalizado y pone matches.estado = finalizado; rechazar lo deja en resultado_en_disputa sin tocar club_record(), y ni el aviso ni el motivo de error invitan ya a proponer otro: sólo la moderación reabre una disputa (48b).';

-- ── 2. LA ASISTENCIA DE UN PARTIDO DE CLUBES NO PASA POR ACÁ ─────
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
begin
    if v_uid is null then
        return jsonb_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    select * into v_match from public.matches where id = p_match_id;
    if not found then
        return jsonb_build_object('ok', false, 'reason', 'El partido no existe');
    end if;
    if v_match.id_organizador <> v_uid then
        return jsonb_build_object('ok', false, 'reason', 'Solo el organizador puede registrar la asistencia');
    end if;

    -- ── GUARDA 50: un partido entre clubes no pasa por acá ──────
    -- La asistencia y el cierre de un encuentro entre clubes los hace
    -- `proponer_resultado()` con el marcador, y el club CONTRARIO los
    -- confirma. Esta función haría las dos cosas por su cuenta —marcar
    -- ausentes con −15 de Trust Score y poner `finalizado`— con la firma
    -- de un solo club. Ver cabecera de la migración 50.
    if v_match.challenge_proposal_id is not null then
        return jsonb_build_object('ok', false, 'reason',
            'La asistencia de un partido entre clubes se registra junto al resultado, y la confirma el club contrario');
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
        -- Estado previo: solo movemos el Trust Score cuando el estado cambia,
        -- así volver a guardar no premia ni castiga dos veces.
        select estado into v_prev
        from public.attendees
        where id_partido = p_match_id and id_jugador = v_key::uuid;

        if v_prev is null or v_prev in ('pendiente', 'cancelado') then
            continue;
        end if;

        if v_val = 'presente' then
            update public.attendees
               set estado = 'confirmado_gps',
                   confirmado_at = coalesce(confirmado_at, now())
             where id_partido = p_match_id and id_jugador = v_key::uuid;

            if v_prev <> 'confirmado_gps' then
                update public.profiles
                   set trust_score = least(100, trust_score + 2),
                       asistencias_confirmadas = asistencias_confirmadas + 1
                 where id = v_key::uuid;
            end if;
            v_presentes := v_presentes + 1;

        elsif v_val = 'ausente' then
            update public.attendees
               set estado = 'no_asistio'
             where id_partido = p_match_id and id_jugador = v_key::uuid;

            if v_prev <> 'no_asistio' then
                update public.profiles
                   set trust_score = greatest(0, trust_score - 15)
                 where id = v_key::uuid;

                insert into public.notifications (user_id, type, title, body, data)
                values (v_key::uuid, 'match_attendance', 'Quedaste como ausente',
                        format('El organizador marcó que no asististe a «%s».', v_match.titulo),
                        jsonb_build_object('matchId', p_match_id));
            end if;
            v_ausentes := v_ausentes + 1;
        end if;
    end loop;

    -- El partido queda cerrado una vez que se registró la asistencia.
    update public.matches
       set estado = 'finalizado'
     where id = p_match_id and estado not in ('cancelado', 'finalizado');

    return jsonb_build_object('ok', true, 'presentes', v_presentes, 'ausentes', v_ausentes);
end;
$$;
revoke execute on function public.save_match_attendance(uuid, jsonb) from public, anon;
grant execute on function public.save_match_attendance(uuid, jsonb) to authenticated;

comment on function public.save_match_attendance(uuid, jsonb) is
    'El organizador registra la asistencia final de un partido NORMAL y con eso lo cierra (migración 33). Desde la 50 rechaza los partidos nacidos de una propuesta entre clubes: ahí la asistencia viaja con proponer_resultado() y el cierre lo firma el club contrario en confirmar_resultado().';

-- ── 3. LA CANCELACIÓN DE UN PARTIDO DE CLUBES TAMPOCO ────────────
create or replace function public.cancel_match(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid     uuid := auth.uid();
    v_match   record;
    v_reglas  jsonb := public.partido_reglas();
    v_penalty integer;
    v_row     record;
begin
    if v_uid is null then
        return jsonb_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    select * into v_match from public.matches where id = p_match_id for update;
    if not found then
        return jsonb_build_object('ok', false, 'reason', 'El partido no existe');
    end if;
    if v_match.id_organizador <> v_uid then
        return jsonb_build_object('ok', false, 'reason', 'Solo el organizador puede cancelar el partido');
    end if;
    if v_match.estado = 'cancelado' then
        return jsonb_build_object('ok', true, 'penalty', 0, 'already', true);
    end if;

    -- ── GUARDA 50: un partido entre clubes no se cancela por acá ──
    -- `cancelar_encuentro_club()` (migración 47) es la única puerta: deja
    -- el motivo, cierra el desafío, sanciona al CLUB dentro de las 2 horas
    -- previas y no le quita Trust Score a ninguna persona. Esta función
    -- hace justo lo contrario —penaliza al organizador y no sanciona a
    -- nadie—, y dejaría el desafío apuntando a un partido cancelado.
    if v_match.challenge_proposal_id is not null then
        return jsonb_build_object('ok', false, 'reason',
            'Un encuentro entre clubes se cancela desde el hilo del desafío, no desde el partido');
    end if;

    v_penalty := case
        when v_match.hora - now() > make_interval(
                hours => (v_reglas->>'ventana_sin_penalizacion_horas')::int)
        then (v_reglas->>'penalizacion_cancelar_temprano')::int
        else (v_reglas->>'penalizacion_cancelar_tarde')::int
    end;

    -- La diferencia con la versión anterior: cambia el estado, no borra la fila.
    update public.matches
       set estado = 'cancelado'
     where id = p_match_id;

    update public.profiles
       set trust_score = greatest(0, trust_score - v_penalty)
     where id = v_uid;

    -- Avisamos a confirmados y a solicitudes pendientes.
    for v_row in
        select id_jugador from public.attendees
        where id_partido = p_match_id
          and estado in ('pendiente', 'inscrito', 'confirmado_gps')
          and id_jugador <> v_uid
    loop
        insert into public.notifications (user_id, type, title, body, data)
        values (v_row.id_jugador, 'match_cancelled', 'Se canceló el partido',
                case
                    when coalesce(v_match.motivo_cancelacion, '') = ''
                    then format('«%s» fue cancelado por el organizador.', v_match.titulo)
                    else format('«%s» fue cancelado. Motivo: %s',
                                v_match.titulo, v_match.motivo_cancelacion)
                end,
                jsonb_build_object('matchId', p_match_id));
    end loop;

    -- Y a la lista de espera, que además se cierra.
    for v_row in
        select id_jugador from public.match_waitlist where id_partido = p_match_id
    loop
        insert into public.notifications (user_id, type, title, body, data)
        values (v_row.id_jugador, 'match_cancelled', 'Se canceló el partido',
                format('«%s» fue cancelado, así que la lista de espera se cerró.', v_match.titulo),
                jsonb_build_object('matchId', p_match_id));
    end loop;

    delete from public.match_waitlist where id_partido = p_match_id;

    return jsonb_build_object('ok', true, 'penalty', v_penalty);
end;
$$;
revoke execute on function public.cancel_match(uuid) from public, anon;
grant execute on function public.cancel_match(uuid) to authenticated;

comment on function public.cancel_match(uuid) is
    'El organizador cancela un partido NORMAL conservándolo en el historial, con su penalización personal de Trust Score (migración 34). Desde la 50 rechaza los partidos nacidos de una propuesta entre clubes: ésos se cancelan con cancelar_encuentro_club() (47), que sanciona al CLUB y no le quita puntos a ninguna persona.';
