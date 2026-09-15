-- =============================================================
-- FutFinder migration 99: reservar la cancha del desafío
-- =============================================================
-- EL PUENTE QUE FALTABA ENTRE CLUBES Y RESERVAS. Dos clubes acuerdan un
-- partido, eligen dónde jugarlo… y si ese recinto trabaja con FutFinder,
-- no había ninguna forma de reservar la cancha desde ahí. Había que
-- salirse, buscar el recinto a mano y armar una reserva suelta que no
-- sabía nada del desafío.
--
-- Y es justo el caso donde el pago entre 2 capitanes tiene más sentido:
-- cada club paga la mitad de su partido. La modalidad existe desde la 55
-- y sus pantallas desde hoy; lo único que faltaba era esta puerta.
--
-- ── `matches.reserva_id`: EL VÍNCULO, EN EL PARTIDO ──
-- Va en el partido y no en la reserva porque la pregunta que se hace la
-- pantalla es «¿este partido ya tiene cancha pagada?», y responderla al
-- revés obligaría a buscar en `reservas` por dos clubes y una fecha. El
-- índice único parcial impide dos reservas para el mismo partido: si se
-- cae, se cancela y se vuelve a reservar, no se acumulan.
--
-- ── UNA SOLA PUERTA, NO TRES LLAMADAS ──
-- Crear la reserva, invitar al capitán rival y enlazarla son tres pasos
-- que no pueden quedar a medias: una reserva de capitanes sin el segundo
-- capitán no se puede confirmar nunca, y un partido sin el vínculo
-- volvería a ofrecer «reservar» sobre una reserva que ya existe. Van
-- juntos en `reservar_cancha_del_partido`, y adentro se REUSAN
-- `crear_reserva` e `invitar_participante_reserva` en vez de repetir sus
-- reglas — el bloqueo del slot, el precio por franja, el contacto
-- obligatorio y el cupo de un solo capitán siguen viviendo en un solo
-- lugar.
--
-- ── QUIÉN ES «EL CAPITÁN DEL OTRO CLUB» ──
-- El que tiene rol `capitan` (migración 90 de Clubes). Si el club no
-- nombró capitán, cae al admin más antiguo: alguien tiene que poder
-- comprometer la mitad de la plata, y un club sin capitán designado
-- igual tiene quien lo dirija. Si no hay ni uno, se dice con todas sus
-- letras en vez de crear una reserva que nadie va a poder completar.
--
-- ── QUIÉN PUEDE RESERVAR ──
-- Solo admin o capitán del club LOCAL. Es el que hace de anfitrión, y
-- quien reserva queda como organizador de la reserva y paga su mitad.
--
-- NO SE TOCA LA HORA DEL PARTIDO. La reserva se hace con el bloque que
-- la persona elige en el flujo normal, que es el único que sabe qué está
-- libre. La pantalla muestra la hora del partido al lado para que el
-- desajuste se vea, pero forzarla acá sería inventar disponibilidad.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

alter table public.matches
    add column if not exists reserva_id uuid references public.reservas(id);

create unique index if not exists matches_reserva_uidx
    on public.matches(reserva_id) where reserva_id is not null;

create index if not exists idx_matches_con_reserva
    on public.matches(reserva_id) where reserva_id is not null;

-- ── Quién manda en un club, para comprometer plata ───────────────
-- No se concede a nadie: solo la usa la RPC de abajo. Saber quién es el
-- capitán de cualquier club no es secreto —la nómina se ve— pero no hace
-- falta una puerta nueva para eso.
create or replace function public.capitan_del_club(p_club_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
    select cm.user_id
      from public.club_members cm
     where cm.club_id = p_club_id
       and cm.rol in ('capitan', 'admin')
     order by (cm.rol = 'capitan') desc, cm.joined_at
     limit 1;
$$;

revoke all on function public.capitan_del_club(uuid) from public, anon, authenticated;

-- ── La puerta ────────────────────────────────────────────────────
create or replace function public.reservar_cancha_del_partido(
    p_match_id uuid,
    p_cancha_id uuid,
    p_fecha date,
    p_hora_inicio time,
    p_contacto_nombre text,
    p_contacto_telefono text,
    p_cobros uuid[] default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
    v_match public.matches;
    v_mi_rol text;
    v_capitan uuid;
    v_res json;
    v_reserva_id uuid;
    v_estado_previo text;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    select * into v_match from public.matches where id = p_match_id for update;
    if v_match is null then
        return json_build_object('ok', false, 'reason', 'Ese partido no existe');
    end if;
    if v_match.club_local_id is null or v_match.club_visitante_id is null then
        return json_build_object('ok', false, 'reason', 'Esto no es un partido entre clubes');
    end if;
    if v_match.estado <> 'abierto' then
        return json_build_object('ok', false, 'reason', 'Ese partido ya no está activo');
    end if;

    -- Reservar es del anfitrión: el club local.
    select cm.rol into v_mi_rol
      from public.club_members cm
     where cm.club_id = v_match.club_local_id and cm.user_id = v_me;
    if v_mi_rol is null or v_mi_rol not in ('admin', 'capitan') then
        return json_build_object('ok', false, 'reason',
            'Solo un admin o capitán del club local puede reservar la cancha');
    end if;

    -- Una reserva viva por partido. Si la anterior murió, se puede de nuevo.
    if v_match.reserva_id is not null then
        select estado into v_estado_previo from public.reservas where id = v_match.reserva_id;
        if v_estado_previo in ('armando', 'procesando', 'confirmada') then
            return json_build_object('ok', false, 'reason', 'Este partido ya tiene una cancha reservada',
                'reserva_id', v_match.reserva_id);
        end if;
    end if;

    v_capitan := public.capitan_del_club(v_match.club_visitante_id);
    if v_capitan is null then
        return json_build_object('ok', false, 'reason',
            'El otro club no tiene capitán ni administrador, así que nadie puede poner su mitad');
    end if;
    if v_capitan = v_me then
        return json_build_object('ok', false, 'reason',
            'Eres quien dirige los dos clubes: no puedes ser los dos capitanes de la misma reserva');
    end if;

    -- Se REUSA `crear_reserva`: el bloqueo del slot, el precio por franja,
    -- el contacto obligatorio y las horas pasadas siguen viviendo ahí.
    v_res := public.crear_reserva(
        p_cancha_id := p_cancha_id,
        p_fecha := p_fecha,
        p_hora_inicio := p_hora_inicio,
        p_modalidad := 'capitanes',
        p_medio_pago := 'balance',
        p_es_desafio_club := true,
        p_club_organizador_id := v_match.club_local_id,
        p_club_rival_id := v_match.club_visitante_id,
        p_contacto_nombre := p_contacto_nombre,
        p_contacto_telefono := p_contacto_telefono,
        p_cobros := p_cobros
    );
    if not (v_res->>'ok')::boolean then
        return v_res;
    end if;
    v_reserva_id := (v_res->>'reserva_id')::uuid;

    -- Y se reusa la invitación, con su cupo de un solo capitán.
    v_res := public.invitar_participante_reserva(v_reserva_id, v_capitan, 'capitan');
    if not (v_res->>'ok')::boolean then
        -- Sin segundo capitán la reserva no se puede confirmar nunca, así
        -- que no se deja a medias: revienta y Postgres deshace todo.
        raise exception 'No se pudo invitar al capitán rival: %', v_res->>'reason';
    end if;

    update public.matches set reserva_id = v_reserva_id where id = p_match_id;

    return json_build_object(
        'ok', true,
        'reserva_id', v_reserva_id,
        'capitan_rival', v_capitan,
        'capitan_rival_username', (select username from public.profiles where id = v_capitan)
    );
end;
$$;

revoke all on function public.reservar_cancha_del_partido(uuid, uuid, date, time, text, text, uuid[]) from public, anon;
grant execute on function public.reservar_cancha_del_partido(uuid, uuid, date, time, text, text, uuid[]) to authenticated;

-- ── Lo que la pantalla del partido necesita saber ────────────────
-- Devuelve si este partido puede reservar cancha, si ya la tiene, y a
-- quién le va a tocar la otra mitad. En una llamada: la pantalla no puede
-- leer `club_members` del club rival ni `reservas` ajenas por su cuenta.
create or replace function public.cancha_del_partido(p_match_id uuid)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
    v_match public.matches;
    v_mi_rol text;
    v_capitan uuid;
    v_estado text;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    select * into v_match from public.matches where id = p_match_id;
    if v_match is null or v_match.club_local_id is null then
        return json_build_object('ok', true, 'aplica', false);
    end if;

    select cm.rol into v_mi_rol
      from public.club_members cm
     where cm.club_id = v_match.club_local_id and cm.user_id = v_me;

    if v_match.reserva_id is not null then
        select estado into v_estado from public.reservas where id = v_match.reserva_id;
    end if;

    v_capitan := public.capitan_del_club(v_match.club_visitante_id);

    return json_build_object(
        'ok', true,
        'aplica', true,
        'puedo_reservar', coalesce(v_mi_rol in ('admin', 'capitan'), false)
            and v_match.estado = 'abierto'
            and coalesce(v_estado, 'ninguna') not in ('armando', 'procesando', 'confirmada'),
        'reserva_id', case when v_estado in ('armando','procesando','confirmada')
                           then v_match.reserva_id else null end,
        'reserva_estado', v_estado,
        'capitan_rival', v_capitan,
        'capitan_rival_username', (select username from public.profiles where id = v_capitan),
        'club_rival', (select nombre from public.clubs where id = v_match.club_visitante_id),
        'hora_partido', v_match.hora
    );
end;
$$;

revoke all on function public.cancha_del_partido(uuid) from public, anon;
grant execute on function public.cancha_del_partido(uuid) to authenticated;
