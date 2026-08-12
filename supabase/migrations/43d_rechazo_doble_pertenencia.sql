-- =============================================================
-- FutFinder — migración 43d: nadie responde en nombre del rival
--
-- POR QUÉ EXISTE. `rechazar_propuesta()` (migración 43) exige ser
-- administrador de un club del desafío distinto al proponente:
--
--     and m.club_id <> v_prop.club_proponente_id
--
-- Eso NO cierra el caso de quien está en los dos clubes. Si administro
-- el club rival y además pertenezco al club que propuso, la consulta
-- encuentra igual el club contrario y me deja responder por él: me
-- estoy contestando a mí mismo. El trigger
-- `club_challenges_valida_rival` impide CREAR un desafío entre clubes
-- que comparten administrador, pero las membresías cambian después de
-- creado el desafío, así que la comprobación tiene que rehacerse en el
-- momento de responder.
--
-- Se detectó al escribir `aprobar_propuesta()` en la migración 44, que
-- nace ya con la regla estricta. Ésta es la misma regla, aplicada a la
-- otra mitad de la respuesta: aprobar y rechazar son las dos salidas de
-- la misma decisión y no pueden pedir permisos distintos.
--
-- REGLA ESTRICTA, IDÉNTICA A LA DE `aprobar_propuesta`:
--   A) ser administrador de un club del desafío distinto al proponente, y
--   B) NO pertenecer al club proponente en ningún rol.
-- La (B) es la que cierra el hueco. Se comprueba la pertenencia, no el
-- rol: si estoy en el club que propuso, ese club es mío, y no importa
-- con qué etiqueta.
--
-- Va aparte porque la 43 ya está aplicada y `CLAUDE.md` prohíbe editar
-- una migración aplicada. Lo único que cambia respecto de la 43 es el
-- bloque de autorización.
-- =============================================================

create or replace function public.rechazar_propuesta(
    p_proposal_id uuid,
    p_motivo      text default null
)
returns public.club_challenge_proposals
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me       uuid := auth.uid();
    v_prop     public.club_challenge_proposals;
    v_row      public.club_challenges;
    v_club     uuid;
    v_en_prop  boolean;
    v_nombre   text;
begin
    if v_me is null then
        raise exception 'No autenticado' using errcode = '42501';
    end if;

    select * into v_prop
      from public.club_challenge_proposals
     where id = p_proposal_id;

    if not found then
        raise exception 'Esta propuesta ya no existe' using errcode = 'no_data_found';
    end if;

    -- Siempre se bloquea primero el desafío y después la propuesta, en
    -- el mismo orden que `crear_propuesta_oficial` y `aprobar_propuesta`.
    select * into v_row
      from public.club_challenges
     where id = v_prop.challenge_id
     for update;

    select * into v_prop
      from public.club_challenge_proposals
     where id = p_proposal_id
     for update;

    -- ── autorización estricta ───────────────────────────────────
    -- Condición A: administrador de un club del desafío que no sea el
    -- proponente.
    select m.club_id into v_club
      from public.club_members m
     where m.user_id = v_me
       and m.rol = 'admin'
       and m.club_id in (v_row.club_retador_id, v_row.club_retado_id)
       and m.club_id <> v_prop.club_proponente_id
     limit 1;

    if v_club is null then
        raise exception 'Solo un administrador del club contrario puede responder la propuesta'
            using errcode = '42501';
    end if;

    -- Condición B (NUEVA EN LA 43d): no pertenecer al club proponente.
    select exists (
        select 1 from public.club_members m
         where m.user_id = v_me
           and m.club_id = v_prop.club_proponente_id
    ) into v_en_prop;

    if v_en_prop then
        raise exception 'No puedes responder una propuesta de un club al que perteneces'
            using errcode = '42501';
    end if;

    -- ── reintento ───────────────────────────────────────────────
    -- Después de autorizar, por la misma razón que la 43b: una salida
    -- temprana en una función `security definer` responde a quien no
    -- debería ni saber que la propuesta existe.
    if v_prop.estado = 'rechazada' then
        return v_prop;
    end if;
    if v_prop.estado <> 'pendiente' then
        raise exception 'Esta propuesta ya fue respondida' using errcode = 'check_violation';
    end if;

    update public.club_challenge_proposals
       set estado         = 'rechazada',
           motivo_rechazo = nullif(trim(coalesce(p_motivo, '')), ''),
           respondida_por = v_me,
           respondida_at  = now()
     where id = v_prop.id
       and estado = 'pendiente'
    returning * into v_prop;

    if not found then
        raise exception 'Esta propuesta ya fue respondida' using errcode = 'check_violation';
    end if;

    -- Sin `returning into`: un update que no mueve ninguna fila dejaría
    -- `v_row` en NULL y los avisos de más abajo se irían al vacío.
    update public.club_challenges
       set estado = 'negociacion'
     where id = v_row.id
       and estado = 'esperando_aprobacion';

    select nombre into v_nombre from public.clubs where id = v_club;

    insert into public.club_challenge_events (challenge_id, tipo, actor_id, club_id, payload)
    values (
        v_prop.challenge_id,
        'propuesta_rechazada',
        v_me,
        v_club,
        jsonb_build_object('proposal_id', v_prop.id, 'motivo', v_prop.motivo_rechazo)
    );

    perform public.desafio_avisar(
        v_row,
        'club_challenge_proposal_rejected',
        '↩️ ' || coalesce(v_nombre, 'El club rival') || ' pidió cambios',
        coalesce(v_prop.motivo_rechazo, 'Vuelvan a la negociación para acordar otra propuesta.'),
        array[v_prop.club_proponente_id],
        v_me,
        jsonb_build_object('proposalId', v_prop.id)
    );

    return v_prop;
end;
$$;

revoke execute on function public.rechazar_propuesta(uuid, text) from public, anon;
grant execute on function public.rechazar_propuesta(uuid, text) to authenticated;
