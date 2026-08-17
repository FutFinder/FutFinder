-- =============================================================
-- FutFinder — migración 48b: un club no reabre su propia disputa.
--
-- La 48 dejaba `proponer_resultado()` aceptar tanto `esperando_resultado`
-- como `resultado_en_disputa`, para permitir reproponer después de un
-- rechazo. Pero `src/services/clubChallengeRules.js` —la única fuente de
-- verdad de las transiciones, ya escrita antes de esta migración— dice
-- exactamente lo contrario en su tabla `TRANSICIONES`:
--
--     resultado_en_disputa: ['esperando_resultado'],
--     // Sólo la moderación puede reabrir una disputa; nunca se cierra sola.
--
-- Y `getChallengeCta()` lo confirma del lado de la pantalla: el estado
-- `resultado_en_disputa` siempre devuelve un CTA deshabilitado («Resultado en
-- disputa» / «Las estadísticas no cambian hasta que se resuelva»), sin
-- ninguna acción que ofrecer. Dejar que el SERVIDOR aceptara una propuesta
-- nueva en ese estado habría sido una puerta trasera: nadie la vería en la
-- interfaz, pero una llamada directa a la RPC sí podría reabrir una disputa
-- que la regla dice que sólo resuelve la moderación.
--
-- Va aparte porque la 48 ya estaba aplicada — mismo criterio que 43b, 44b,
-- 44c y 47b: nunca se edita una migración que ya corrió.
--
-- QUÉ CAMBIA: una sola comprobación, dentro de `proponer_resultado()`. Antes
-- aceptaba `estado in ('esperando_resultado', 'resultado_en_disputa')`;
-- ahora exige `estado = 'esperando_resultado'`. El resto de la función —
-- autorización, validación del marcador, asistencia, evento, aviso— no
-- cambia una línea.
--
-- QUÉ NO CAMBIA: el índice único parcial `club_match_results_activo_uidx`
-- (excluye los rechazados) sigue siendo correcto y necesario. Cuando exista
-- la moderación que reabra una disputa —fuera del alcance de este plan, como
-- ya documenta el P1 de `docs/memoria/operacion/pendientes.md` sobre las
-- revisiones de sanción— el desafío vuelve a `esperando_resultado` y una
-- propuesta nueva tiene que poder insertarse sin chocar con la rechazada.
-- `confirmar_resultado()` tampoco cambia: nunca miró el estado del desafío,
-- sólo el de la propia fila del resultado.
-- =============================================================

create or replace function public.proponer_resultado(
    p_challenge_id    uuid,
    p_goles_local     integer,
    p_goles_visitante integer,
    p_asistencia      jsonb default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me     uuid := auth.uid();
    v_row    public.club_challenges;
    v_match  public.matches;
    v_clubes uuid[];
    v_club   uuid;
    v_rival  uuid;
    v_ya     public.club_match_results;
    v_res    public.club_match_results;
    v_nombre text;
    v_user   text;
    v_titulo text;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    -- Validaciones que no revelan nada de nadie: pueden ir antes de
    -- tocar ninguna fila.
    if p_goles_local is null or p_goles_visitante is null then
        return json_build_object('ok', false,
            'reason', 'Ingresa el marcador de los dos equipos');
    end if;
    if p_goles_local < 0 or p_goles_visitante < 0
       or p_goles_local > 99 or p_goles_visitante > 99 then
        return json_build_object('ok', false,
            'reason', 'El marcador tiene que ser un número entre 0 y 99');
    end if;
    if p_asistencia is not null and jsonb_typeof(p_asistencia) is distinct from 'array' then
        return json_build_object('ok', false,
            'reason', 'La asistencia tiene que ser una lista de jugadores que sí llegaron');
    end if;

    select * into v_row from public.club_challenges where id = p_challenge_id;
    if not found then
        return json_build_object('ok', false, 'reason', 'Este desafío ya no existe');
    end if;
    if v_row.match_id is null then
        return json_build_object('ok', false,
            'reason', 'Este desafío todavía no tiene un partido publicado');
    end if;

    -- Fila grande primero, la chica después: mismo orden que el resto
    -- del ciclo, para que dos administradores no se traben entre sí.
    select * into v_match from public.matches where id = v_row.match_id for update;
    if not found then
        return json_build_object('ok', false, 'reason', 'El partido de este desafío ya no existe');
    end if;
    select * into v_row from public.club_challenges where id = p_challenge_id for update;

    -- ── autorización, antes de cualquier salida temprana ────────
    -- La 43b aprendió esto a golpes: mirar `club_members` es lo primero
    -- que hace esta función después de bloquear, no lo último.
    select array_agg(cm.club_id) into v_clubes
      from public.club_members cm
     where cm.user_id = v_me
       and cm.rol = 'admin'
       and cm.club_id in (v_row.club_retador_id, v_row.club_retado_id);

    if v_clubes is null then
        return json_build_object('ok', false,
            'reason', 'Solo un administrador de alguno de los dos clubes puede proponer el resultado');
    end if;

    -- Quien administra los DOS clubes no propone: después sería quien
    -- confirma su propia propuesta por la otra puerta. Mismo conflicto
    -- de doble pertenencia que cierran 43d/46/47.
    if array_length(v_clubes, 1) > 1 then
        return json_build_object('ok', false,
            'reason', 'Administras los dos clubes de este encuentro: no puedes proponer el resultado en nombre de uno solo');
    end if;

    v_club  := v_clubes[1];
    v_rival := case when v_club = v_row.club_retador_id
                    then v_row.club_retado_id
                    else v_row.club_retador_id end;

    -- ── estado ──────────────────────────────────────────────────
    if v_match.estado = 'cancelado' then
        return json_build_object('ok', false,
            'reason', 'Este encuentro fue cancelado: no se puede registrar un resultado');
    end if;
    -- Corrección 48b: `resultado_en_disputa` ya NO admite una propuesta
    -- nueva. Sólo la moderación reabre una disputa (ver cabecera).
    if v_row.estado <> 'esperando_resultado' then
        return json_build_object('ok', false,
            'reason', 'Este desafío no está esperando un resultado');
    end if;

    -- Un resultado activo por desafío (garantía 3 de la migración 48). Se
    -- comprueba acá para dar un motivo legible; el índice único parcial
    -- es la garantía real ante dos propuestas a la vez.
    select * into v_ya from public.club_match_results
     where challenge_id = p_challenge_id and estado <> 'rechazado';

    if found then
        if v_ya.estado = 'confirmado' then
            return json_build_object('ok', true, 'already', true,
                'resultId', v_ya.id, 'estado', v_ya.estado);
        end if;
        return json_build_object('ok', false,
            'reason', 'Ya hay un resultado propuesto esperando confirmación del otro club');
    end if;

    select nombre into v_nombre from public.clubs where id = v_club;
    -- El `username` sale de `profiles` DENTRO de la función, nunca del
    -- cliente. La auditoría de verdad es `propuesto_por`.
    select username into v_user from public.profiles where id = v_me;
    v_titulo := coalesce(v_match.titulo, 'el partido');

    insert into public.club_match_results (
        challenge_id, match_id, club_local_id, club_visitante_id,
        goles_local, goles_visitante, club_proponente_id, propuesto_por
    )
    values (
        v_row.id, v_match.id, v_match.club_local_id, v_match.club_visitante_id,
        p_goles_local, p_goles_visitante, v_club, v_me
    )
    returning * into v_res;

    -- La asistencia real: sólo toca a quien sigue 'inscrito'.
    if p_asistencia is not null then
        update public.attendees
           set estado = case
                            when id_jugador::text in (
                                select jsonb_array_elements_text(p_asistencia)
                            ) then 'confirmado_gps'
                            else 'no_asistio'
                        end,
               confirmado_at = case
                            when id_jugador::text in (
                                select jsonb_array_elements_text(p_asistencia)
                            ) then now()
                            else confirmado_at
                        end
         where id_partido = v_match.id
           and estado = 'inscrito';
    end if;

    insert into public.club_challenge_events (challenge_id, tipo, actor_id, club_id, payload)
    values (v_row.id, 'resultado_propuesto', v_me, v_club,
        jsonb_build_object(
            'result_id',              v_res.id,
            'match_id',               v_match.id,
            'club_proponente_id',     v_club,
            'club_proponente_nombre', coalesce(v_nombre, 'Un club'),
            'actor_id',               v_me,
            'actor_username',         v_user,
            'goles_local',            p_goles_local,
            'goles_visitante',        p_goles_visitante));

    perform public.desafio_avisar(
        v_row,
        'club_resultado_propuesto',
        'Hay un resultado por confirmar',
        coalesce(v_nombre, 'El club rival') || ' propuso ' || p_goles_local || '-' || p_goles_visitante
            || ' en «' || v_titulo || '». Confírmalo o recházalo.',
        array[v_rival],
        v_me,
        jsonb_build_object('matchId', v_match.id, 'resultId', v_res.id,
                           'golesLocal', p_goles_local, 'golesVisitante', p_goles_visitante),
        true);

    return json_build_object('ok', true, 'resultId', v_res.id, 'estado', v_res.estado,
        'golesLocal', p_goles_local, 'golesVisitante', p_goles_visitante);
end;
$$;

revoke execute on function public.proponer_resultado(uuid, integer, integer, jsonb) from public, anon;
grant execute on function public.proponer_resultado(uuid, integer, integer, jsonb) to authenticated;

comment on function public.proponer_resultado(uuid, integer, integer, jsonb) is
    'Un administrador de cualquiera de los dos clubes propone el marcador final y marca la asistencia real de los inscritos (migración 48, corregida en 48b). Sólo con el desafío en esperando_resultado: una disputa (resultado_en_disputa) sólo la reabre la moderación, nunca una propuesta nueva del club.';
