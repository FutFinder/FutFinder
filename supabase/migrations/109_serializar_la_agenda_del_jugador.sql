-- 109. Un jugador no puede inscribirse en dos partidos superpuestos a la vez.
--
-- Escrita en la sesión paralela y renumerada de 107 a 109 al integrarla: los
-- números 107 y 108 ya estaban aplicados. El `classid` 107 del lock se deja
-- como está a propósito: es una constante del espacio de locks, no el número
-- de esta migración, y cambiarla no aportaría nada.
-- Reproducido en Supabase: dos join_match simultáneos, para partidos distintos,
-- devolvieron éxito y dejaron al mismo jugador inscrito en ambos.
-- La 104 corrigió los estados que ocupan horario, pero cada RPC solo bloqueaba
-- SU partido. La agenda del jugador se leía antes de ver el otro COMMIT.
--
-- Serializamos por jugador dentro del trigger compartido, por lo que cubre
-- ingreso, aprobación y las RPC que insertan inscripciones por su cuenta.
-- El lock dura hasta COMMIT/ROLLBACK; jugadores distintos no se bloquean salvo
-- una colisión de hash. Después se conservan todas las reglas de la 105.
-- Regresión con conexiones reales: supabase/tests/partidos_horario_concurrente_test.cjs.

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

  -- Dos partidos tienen bloqueos de fila distintos, pero comparten agenda
  -- cuando intenta entrar el mismo jugador. Esperar ANTES de leer permite
  -- que la consulta de choques vea lo confirmado por la primera transacción.
  -- El namespace de dos enteros no colisiona con locks de bigint de reservas.
  -- Una colisión de hash entre UUID distintos solo los hace esperar.
  perform pg_advisory_xact_lock(107, hashtext(new.id_jugador::text));

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
