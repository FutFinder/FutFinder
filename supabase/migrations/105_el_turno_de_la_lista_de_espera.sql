-- 105. El turno de la lista de espera vale de verdad, y ampliar cupos reabre.
--
-- Auditoría del 15 de septiembre de 2026, hallazgos 10 y 12.
--
--  #10 Ampliar un partido lleno lo dejaba con cupos y estado `lleno`: el
--      siguiente que entraba recibía «Partido no está abierto».
--  #12 La app promete «tienes 30 min para confirmar» y no había nada detrás:
--      cualquiera podía tomar el cupo avisado, el turno no vencía nunca, si
--      el primero se iba no se avisaba al siguiente y al liberarse dos cupos
--      se avisaba a uno solo.
--
-- El contrato queda así: cuando se libera un cupo se avisa a tantos de la
-- cola como cupos haya; mientras su turno esté vigente ese cupo es suyo y
-- nadie más puede tomarlo; si se les pasa el plazo pierden el lugar en la
-- cola —con aviso— y le toca al siguiente.

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (
    type = any (array[
        'match_join', 'friend_request', 'friend_accept', 'message_new',
        'match_reminder', 'match_rate', 'join_request', 'join_approved',
        'join_rejected', 'match_cancelled', 'match_updated', 'match_slot_free',
        'waitlist_turn', 'match_left', 'match_attendance', 'club_request',
        'club_request_accepted', 'club_request_rejected', 'club_member_joined',
        'club_member_left', 'club_invite_accepted', 'club_challenge',
        'club_challenge_accepted', 'club_challenge_rejected', 'chat_mention_all',
        'club_challenge_extension', 'club_challenge_closed',
        'club_challenge_proposal', 'club_challenge_proposal_rejected',
        'club_match_published', 'club_match_reserva_omitida', 'club_match_change',
        'club_match_change_responded', 'club_match_cancelled', 'club_sancionado',
        'club_revision_resuelta', 'club_resultado_propuesto',
        'club_resultado_confirmado', 'club_resultado_disputado',
        'reserva_confirmada', 'reserva_cancelada', 'reserva_invitacion_capitan',
        'reserva_invitacion_jugador', 'reserva_invitacion_rechazada',
        'reserva_cuota_recalculada', 'reserva_saldo_insuficiente',
        'reserva_cancelacion_solicitada', 'balance_cargado',
        'complejo_admin_agregado',
        'reserva_recordatorio_pago', 'reserva_participante_quitado',
        'reserva_cancelacion_rechazada',
        'waitlist_turno_vencido'
    ])
);

-- ---------------------------------------------------------------------------
-- #10. El estado también se deduce: si quedan cupos, el partido está abierto.
-- ---------------------------------------------------------------------------
create or replace function public.matches_guard_cupos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ocupadas integer;
    v_es_de_clubes boolean := new.challenge_proposal_id is not null;
begin
    select count(*) into v_ocupadas
    from public.attendees
    where id_partido = new.id
      and estado in ('inscrito', 'confirmado_gps', 'no_asistio')
      and (v_es_de_clubes or id_jugador is distinct from new.id_organizador);

    if new.cupos_totales < v_ocupadas then
        raise exception 'CUPOS_MENOR_QUE_CONFIRMADOS:%:%', new.cupos_totales, v_ocupadas;
    end if;

    if v_es_de_clubes then
        if new.cupos_disponibles > new.cupos_totales then
            new.cupos_disponibles := new.cupos_totales;
        end if;
    else
        new.cupos_disponibles := greatest(new.cupos_totales - v_ocupadas, 0);
        -- `abierto` y `lleno` describen la misma realidad desde dos lados: se
        -- deducen juntos. Ampliar un partido lleno lo reabre, y el último
        -- cupo tomado lo llena, sin que nadie tenga que acordarse.
        if new.estado in ('abierto', 'lleno') then
            new.estado := case when new.cupos_disponibles > 0 then 'abierto' else 'lleno' end;
        end if;
    end if;

    return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- #12. Un solo sitio que reparte, vence y avanza los turnos.
-- ---------------------------------------------------------------------------
create or replace function public.avanzar_lista_de_espera(p_match_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_match     record;
    v_minutos   integer := coalesce((public.partido_reglas()->>'minutos_confirmar_lista_espera')::int, 30);
    v_vencido   record;
    v_siguiente record;
    v_vigentes  integer;
    v_faltan    integer;
    v_avisados  integer := 0;
begin
    select * into v_match from public.matches where id = p_match_id for update;
    if not found then return 0; end if;

    -- 1. Al que se le pasó el plazo pierde el lugar: se le avisó y no lo tomó.
    --    Se le cuenta, para que no descubra por su cuenta que ya no está.
    for v_vencido in
        select * from public.match_waitlist
         where id_partido = p_match_id
           and confirmar_antes_de is not null
           and confirmar_antes_de <= now()
    loop
        delete from public.match_waitlist where id = v_vencido.id;
        insert into public.notifications (user_id, type, title, body, data)
        values (
            v_vencido.id_jugador,
            'waitlist_turno_vencido',
            'Se te pasó el turno',
            format('Pasaron los %s min para tomar el cupo en «%s» y le tocó al siguiente de la cola. Puedes volver a entrar cuando quieras.',
                   v_minutos, coalesce(v_match.titulo, 'el partido')),
            jsonb_build_object('matchId', p_match_id)
        );
    end loop;

    if v_match.estado not in ('abierto', 'lleno') or v_match.hora <= now() then
        return 0;
    end if;

    -- 2. Se avisa a tantos como cupos libres queden sin dueño. Liberar dos
    --    cupos avisaba a uno solo y el segundo se quedaba esperando.
    select count(*) into v_vigentes
      from public.match_waitlist
     where id_partido = p_match_id and confirmar_antes_de > now();
    v_faltan := greatest(coalesce(v_match.cupos_disponibles, 0), 0) - v_vigentes;

    while v_faltan > 0 loop
        select * into v_siguiente
          from public.match_waitlist
         where id_partido = p_match_id and avisado_at is null
         order by created_at
         limit 1;
        exit when not found;

        update public.match_waitlist
           set avisado_at = now(),
               confirmar_antes_de = now() + make_interval(mins => v_minutos)
         where id = v_siguiente.id;

        insert into public.notifications (user_id, type, title, body, data)
        values (
            v_siguiente.id_jugador,
            'waitlist_turn',
            'Se liberó un cupo',
            format('Quedó un cupo en «%s». Tienes %s min para confirmarlo.',
                   coalesce(v_match.titulo, 'el partido'), v_minutos),
            jsonb_build_object('matchId', p_match_id, 'minutos', v_minutos)
        );

        v_avisados := v_avisados + 1;
        v_faltan := v_faltan - 1;
    end loop;

    return v_avisados;
end;
$$;
revoke all on function public.avanzar_lista_de_espera(uuid) from public, anon, authenticated;

-- El trigger deja de repartir por su cuenta: delega y deja de mirar solo el
-- salto de cero a uno.
create or replace function public.notify_waitlist_slot_free()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if coalesce(new.cupos_disponibles, 0) <= coalesce(old.cupos_disponibles, 0) then
        return new;
    end if;
    perform public.avanzar_lista_de_espera(new.id);
    return new;
end;
$$;

-- Salir de la cola con el turno en la mano tiene que despertar al siguiente.
create or replace function public.leave_waitlist(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid uuid := auth.uid();
    v_tenia_turno boolean := false;
begin
    if v_uid is null then
        return jsonb_build_object('ok', false, 'reason', 'No autenticado');
    end if;
    select exists (
        select 1 from public.match_waitlist
         where id_partido = p_match_id and id_jugador = v_uid
           and confirmar_antes_de > now()
    ) into v_tenia_turno;

    delete from public.match_waitlist
    where id_partido = p_match_id and id_jugador = v_uid;
    -- Salir de la lista NO toca el Trust Score, a propósito.

    if v_tenia_turno then
        perform public.avanzar_lista_de_espera(p_match_id);
    end if;
    return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.leave_waitlist(uuid) from public, anon;
grant execute on function public.leave_waitlist(uuid) to authenticated;

-- El barrido: los plazos vencen solos, no cuando alguien abre la pantalla.
create or replace function public.barrer_lista_de_espera()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    r record;
    v_avisados integer := 0;
begin
    for r in
        select distinct w.id_partido
          from public.match_waitlist w
          join public.matches m on m.id = w.id_partido
         where m.estado in ('abierto', 'lleno')
           and m.hora > now()
           and w.confirmar_antes_de is not null
           and w.confirmar_antes_de <= now()
    loop
        v_avisados := v_avisados + public.avanzar_lista_de_espera(r.id_partido);
    end loop;
    return v_avisados;
end;
$$;
revoke all on function public.barrer_lista_de_espera() from public, anon, authenticated;

select cron.schedule('futfinder-lista-de-espera', '*/5 * * * *',
                     'select public.barrer_lista_de_espera();');

-- ---------------------------------------------------------------------------
-- #12. El cupo avisado es del que espera: nadie más lo toma por delante.
-- ---------------------------------------------------------------------------
create or replace function public.join_match(p_match_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_match record;
    v_edad integer;
    v_turnos_de_otros integer;
    v_inserted_id uuid;
begin
    if v_user_id is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    if exists (select 1 from public.matches m
                where m.id = p_match_id and m.challenge_proposal_id is not null) then
        return json_build_object('ok', false,
            'reason', 'Este es un partido entre clubes: la inscripción es por club');
    end if;

    select * into v_match from public.matches where id = p_match_id for update;
    if v_match is null then
        return json_build_object('ok', false, 'reason', 'Partido no existe');
    end if;
    if v_match.cupos_disponibles <= 0 then
        return json_build_object('ok', false, 'reason', 'Partido lleno');
    end if;
    if v_match.estado <> 'abierto' then
        return json_build_object('ok', false, 'reason', 'Partido no está abierto');
    end if;

    if v_match.aprobacion = 'manual' then
        return json_build_object('ok', false,
            'reason', 'Este partido lo revisa el organizador: manda una solicitud en vez de tomar el cupo');
    end if;

    select count(*) into v_turnos_de_otros
      from public.match_waitlist w
     where w.id_partido = p_match_id
       and w.confirmar_antes_de > now()
       and w.id_jugador <> v_user_id;
    if v_match.cupos_disponibles <= v_turnos_de_otros then
        return json_build_object('ok', false,
            'reason', 'El cupo que se liberó está reservado unos minutos para quien venía esperando en la lista');
    end if;

    select edad into v_edad from public.profiles where id = v_user_id;
    if public.edad_fuera_de_rango(v_edad, v_match.edad_min, v_match.edad_max) then
        return json_build_object('ok', false,
            'reason', format('Este partido es para jugadores %s y tu perfil dice %s',
                             public.rango_de_edad_legible(v_match.edad_min, v_match.edad_max),
                             v_edad));
    end if;

    insert into public.attendees(id_partido, id_jugador)
    values (p_match_id, v_user_id)
    on conflict (id_partido, id_jugador) do nothing
    returning id into v_inserted_id;

    if v_inserted_id is null then
        return json_build_object('ok', true, 'already', true,
                                 'reason', 'Ya estabas inscrito en este partido');
    end if;

    update public.matches
    set cupos_disponibles = cupos_disponibles - 1,
        estado = case when cupos_disponibles - 1 = 0 then 'lleno' else estado end
    where id = p_match_id;

    return json_build_object('ok', true);
end;
$$;
revoke all on function public.join_match(uuid) from public, anon;
grant execute on function public.join_match(uuid) to authenticated;

-- Red de seguridad: `swap_match` y `cancel_match_and_join` insertan por su
-- cuenta, así que la reserva también se exige en el trigger de elegibilidad.
create or replace function public.tg_enforce_join_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_min int; v_org uuid; v_hora timestamptz; v_dur int;
  v_trust int; v_estado text; v_until timestamptz; v_clash int;
  v_es_de_clubes boolean;
  v_edad_min int; v_edad_max int; v_edad int;
  v_libres int; v_turnos_de_otros int;
begin
  if new.estado not in ('inscrito','pendiente') then return new; end if;

  select min_trust_score, id_organizador, hora, duracion_min,
         challenge_proposal_id is not null, edad_min, edad_max, cupos_disponibles
    into v_min, v_org, v_hora, v_dur, v_es_de_clubes, v_edad_min, v_edad_max, v_libres
  from public.matches where id = new.id_partido;

  if v_org = new.id_jugador and not coalesce(v_es_de_clubes, false) then
    return new;
  end if;

  select trust_score, estado, suspended_until, edad
    into v_trust, v_estado, v_until, v_edad
  from public.profiles where id = new.id_jugador;

  if v_estado = 'suspendido' and (v_until is null or v_until > now()) then
    raise exception 'SUSPENDIDO';
  end if;
  if coalesce(v_trust,0) < coalesce(v_min,0) then
    raise exception 'TRUST_BAJO:%:%', coalesce(v_trust,0), coalesce(v_min,0);
  end if;
  if public.edad_fuera_de_rango(v_edad, v_edad_min, v_edad_max) then
    raise exception 'EDAD_FUERA_DE_RANGO';
  end if;

  -- Una solicitud pendiente no ocupa cupo, así que no le quita el turno a nadie.
  if new.estado = 'inscrito' and not coalesce(v_es_de_clubes, false) then
    select count(*) into v_turnos_de_otros
      from public.match_waitlist w
     where w.id_partido = new.id_partido
       and w.confirmar_antes_de > now()
       and w.id_jugador <> new.id_jugador;
    if coalesce(v_libres, 0) <= v_turnos_de_otros then
      raise exception 'CUPO_RESERVADO';
    end if;
  end if;

  select 1 into v_clash
  from public.attendees a
  join public.matches m on m.id = a.id_partido
  where a.id_jugador = new.id_jugador
    and a.estado in ('inscrito','confirmado_gps')
    and m.id <> new.id_partido
    and m.estado = any (public.estados_que_ocupan_horario())
    and v_hora < m.hora + make_interval(mins => coalesce(m.duracion_min,90))
    and m.hora < v_hora + make_interval(mins => coalesce(v_dur,90))
  limit 1;
  if found then raise exception 'CHOQUE_HORARIO'; end if;

  return new;
end;
$$;

-- El disparador pasa a mirar cualquier UPDATE del partido. `after update of
-- cupos_disponibles` se decide por las columnas del SET, no por lo que cambió:
-- al ampliar los cupos es la guarda quien recalcula `cupos_disponibles`, así
-- que el aviso nunca salía. (Aplicado como 105b.)
drop trigger if exists tg_notify_waitlist_slot_free on public.matches;
create trigger tg_notify_waitlist_slot_free
    after update on public.matches
    for each row
    execute function public.notify_waitlist_slot_free();
