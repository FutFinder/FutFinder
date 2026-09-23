-- 133. Aprobar a un jugador también mira su agenda.
--
-- EL LOCK DE LA 109 NUNCA CUBRIÓ LA APROBACIÓN. Su encabezado dice que el
-- trigger compartido cubre «ingreso, aprobación y las RPC que insertan», pero
-- `trg_enforce_join_rules` es `BEFORE INSERT` y aprobar no inserta:
-- `approve_join` y `confirmar_nomina_club` pasan la fila existente de
-- `pendiente` a `inscrito` con un UPDATE. Así que al aprobar no se tomaba el
-- lock por jugador ni se revisaba `CHOQUE_HORARIO`.
--
-- Y NO HACÍA FALTA UNA CARRERA. Reproducido contra producción el 2026-09-23,
-- en un bloque revertido: el organizador aprueba al mismo jugador en dos
-- partidos a la misma hora, UNO DESPUÉS DEL OTRO, y las dos llamadas devuelven
-- `{"ok": true}`; el jugador queda inscrito en ambos. Lo encontró el caso 2
-- de `partidos_horario_concurrente_test.cjs`, la primera vez que se corrió.
--
-- EL ARREGLO ES QUE LA APROBACIÓN PASE POR LA MISMA PUERTA. Un segundo
-- disparo de `tg_enforce_join_rules()`, sólo para la transición
-- `pendiente → inscrito`: toma el lock del jugador y aplica las mismas reglas
-- que al entrar (suspensión, Trust Score, edad, turno de la lista de espera y
-- choque de horario), sin copiarlas. El `WHEN` es estrecho a propósito: las
-- demás transiciones —la marca GPS, la asistencia que corrige el organizador
-- después del partido— no son una inscripción nueva, y revisarle la
-- suspensión a un jugador suspendido justamente por faltar rompería la
-- corrección de su marca.
--
-- Las dos RPC traducen el rechazo del trigger a `ok:false` con un motivo
-- legible, como hacen con el resto de sus reglas: las pantallas muestran
-- `reason`, y una excepción cruda llegaría como `CHOQUE_HORARIO`. El código
-- original viaja en `code`. Cualquier otra excepción se relanza tal cual.
--
-- El orden de locks no cambia: las dos RPC bloquean primero la fila del
-- partido y después, ya en el trigger, al jugador — el mismo orden que
-- `join_match`.
--
-- Regresión: supabase/tests/133_aprobar_mira_la_agenda_test.sql y el caso 2
-- de supabase/tests/partidos_horario_concurrente_test.cjs.

create or replace function public.motivo_aprobacion_rechazada(p_error text)
returns text
language sql
immutable
set search_path = public
as $$
    select case
        when coalesce(p_error, '') like 'CHOQUE_HORARIO%'
            then 'Ese jugador ya tiene otro partido a esa hora'
        when coalesce(p_error, '') like 'SUSPENDIDO%'
            then 'Ese jugador tiene la cuenta suspendida temporalmente'
        when coalesce(p_error, '') like 'TRUST_BAJO%'
            then 'Ese jugador no alcanza el Trust Score que pide el partido'
        when coalesce(p_error, '') like 'EDAD_FUERA_DE_RANGO%'
            then 'Ese jugador está fuera del rango de edad del partido'
        when coalesce(p_error, '') like 'CUPO_RESERVADO%'
            then 'Ese cupo está guardado para alguien de la lista de espera'
    end;
$$;

revoke all on function public.motivo_aprobacion_rechazada(text) from public, anon, authenticated;

drop trigger if exists trg_enforce_join_rules_al_aprobar on public.attendees;
create trigger trg_enforce_join_rules_al_aprobar
    before update of estado on public.attendees
    for each row
    when (old.estado = 'pendiente' and new.estado = 'inscrito')
    execute function public.tg_enforce_join_rules();

create or replace function public.approve_join(p_match_id uuid, p_player_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_user  uuid := auth.uid();
  v_match record;
  v_att   record;
  v_edad  integer;
  v_aprobada uuid;
  v_motivo text;
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
  -- no se aprueba nada y no se le avisa que entró. El UPDATE dispara
  -- `trg_enforce_join_rules_al_aprobar` (migración 133), que espera por el
  -- jugador y rechaza si ya quedó inscrito en otro partido a la misma hora.
  begin
    update public.attendees
       set estado = 'inscrito'
     where id = v_att.id and estado = 'pendiente'
    returning id into v_aprobada;
  exception when raise_exception then
    v_motivo := public.motivo_aprobacion_rechazada(sqlerrm);
    if v_motivo is null then raise; end if;
    return jsonb_build_object('ok', false, 'reason', v_motivo,
                              'code', split_part(sqlerrm, ':', 1));
  end;
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
$function$;

create or replace function public.confirmar_nomina_club(p_match_id uuid, p_player_id uuid, p_aprobar boolean)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
    v_me       uuid := auth.uid();
    v_match    public.matches;
    v_att      public.attendees;
    v_soy_admin boolean;
    v_ocupados integer;
    v_motivo   text;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    select * into v_match from public.matches where id = p_match_id for update;
    if not found then
        return json_build_object('ok', false, 'reason', 'Partido no existe');
    end if;
    if v_match.challenge_proposal_id is null then
        return json_build_object('ok', false, 'reason', 'Este no es un partido entre clubes');
    end if;

    if v_me = p_player_id then
        return json_build_object('ok', false,
            'reason', 'No puedes confirmarte a ti mismo: te confirma otro administrador de tu club');
    end if;

    select * into v_att from public.attendees
     where id_partido = p_match_id and id_jugador = p_player_id and estado = 'pendiente';
    if not found then
        return json_build_object('ok', false, 'reason', 'Ese jugador no tiene una postulación pendiente');
    end if;

    -- Admin DEL CLUB DEL JUGADOR. Que sea admin del otro club no sirve.
    select exists (
        select 1 from public.club_members cm
         where cm.user_id = v_me and cm.rol = 'admin' and cm.club_id = v_att.club_id
    ) into v_soy_admin;

    if not v_soy_admin then
        return json_build_object('ok', false,
            'reason', 'Solo un administrador del club del jugador puede confirmarlo');
    end if;

    if not p_aprobar then
        delete from public.attendees where id = v_att.id;
        insert into public.notifications (user_id, type, title, body, data)
        values (p_player_id, 'join_rejected', 'No quedaste en la nómina',
                coalesce(v_match.titulo, 'Partido de clubes'),
                jsonb_build_object('matchId', p_match_id));
        return json_build_object('ok', true, 'aprobado', false);
    end if;

    -- El límite se comprueba AQUÍ, con la fila bloqueada: entre postular
    -- y confirmar pueden haber entrado otros.
    v_ocupados := public.cupos_ocupados_club(p_match_id, v_att.club_id);
    if v_ocupados >= v_match.cupos_por_club then
        return json_build_object('ok', false,
            'reason', format('Tu club ya llenó sus %s cupos', v_match.cupos_por_club));
    end if;

    -- Confirmar también es una inscripción nueva: el UPDATE pasa por
    -- `trg_enforce_join_rules_al_aprobar` (migración 133).
    begin
        update public.attendees
           set estado = 'inscrito', origen = 'postulacion_aprobada'
         where id = v_att.id;
    exception when raise_exception then
        v_motivo := public.motivo_aprobacion_rechazada(sqlerrm);
        if v_motivo is null then raise; end if;
        return json_build_object('ok', false, 'reason', v_motivo,
                                 'code', split_part(sqlerrm, ':', 1));
    end;

    update public.matches
       set cupos_disponibles = greatest(cupos_disponibles - 1, 0),
           estado = case when cupos_disponibles - 1 <= 0 then 'lleno' else estado end
     where id = p_match_id;

    insert into public.notifications (user_id, type, title, body, data)
    values (p_player_id, 'join_approved', 'Estás en la nómina ✓',
            coalesce(v_match.titulo, 'Partido de clubes'),
            jsonb_build_object('matchId', p_match_id));

    return json_build_object('ok', true, 'aprobado', true);
end;
$function$;
