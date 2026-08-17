-- =============================================================
-- FutFinder — migración 50b: la frase del rechazo, sin romper el
-- arnés de la 48 (Tarea 6.3).
--
-- La 50 reescribió los dos textos de `confirmar_resultado()` que
-- contradecían la 48b, y al hacerlo cambió también el arranque del
-- motivo de error: «Este resultado **quedó** rechazado…» en vez de
-- «Este resultado **ya fue** rechazado…».
--
-- Ese arranque no era decorativo: `48_resultado_test.sql` lo comprueba
-- en su caso 10 con `reason ilike '%ya fue rechazado%'`, y con la 50
-- aplicada ese arnés —19/19 desde el 2026-08-17— habría pasado a fallar
-- por un cambio de redacción, no por un cambio de comportamiento. Un
-- arnés que se rompe sin que nada se haya roto enseña a ignorarlo.
--
-- QUÉ CAMBIA: una frase. Conserva «ya fue rechazado», que es lo que la
-- prueba de la 48 fija, y conserva lo que vino a arreglar la 50: ya no
-- dice «pide que propongan uno nuevo», porque desde la 48b nadie puede
-- proponer otro — sólo la moderación reabre una disputa.
--
-- Va aparte porque la 50 ya estaba aplicada: mismo criterio que 43b,
-- 44b, 44c, 47b y 48b. Nunca se edita una migración que ya corrió, ni
-- siquiera la de hace un rato.
--
-- QUÉ NO CAMBIA: las dos guardas de la 50 sobre
-- `save_match_attendance()` y `cancel_match()`, el aviso del rechazo, y
-- el resto de `confirmar_resultado()`.
-- =============================================================

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
            'reason', 'Este resultado ya fue rechazado y el encuentro quedó en disputa: sólo la moderación puede reabrirlo');
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
    'El club contrario al proponente confirma o rechaza el resultado (migración 48, textos corregidos en la 50 y 50b). Aceptar cierra el desafío en finalizado y pone matches.estado = finalizado; rechazar lo deja en resultado_en_disputa sin tocar club_record(), y ni el aviso ni el motivo de error invitan ya a proponer otro: sólo la moderación reabre una disputa (48b).';
