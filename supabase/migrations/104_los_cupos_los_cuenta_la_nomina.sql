-- 104. Los cupos los cuenta la nómina, y un partido lleno sigue ocupando la hora.
--
-- Tres hallazgos de la auditoría del 15 de septiembre de 2026 que son el mismo
-- problema visto desde tres lados: la disponibilidad se calculaba en sitios
-- distintos y ninguno miraba la nómina vigente.
--
--  #1  Un partido de un solo cupo no admitía a nadie: la guarda desplegada
--      contaba al organizador, que está en `attendees` pero no ocupa plaza.
--      La migración 33 ya traía la versión correcta; nunca llegó al servidor.
--  #6  `get_schedule_conflict` y el trigger sólo miraban partidos `abierto`,
--      así que al llenarse un partido dejaba de chocar con otro a la misma
--      hora y el jugador quedaba inscrito en los dos.
--  #9  Editar los cupos aceptaba la disponibilidad calculada por el cliente
--      con una nómina vieja, dejando plazas que no existían.

-- Un solo sitio donde se decide qué partidos ocupan la hora del jugador.
create or replace function public.estados_que_ocupan_horario()
returns text[]
language sql
immutable
set search_path = public
as $$
    select array['abierto', 'lleno', 'en_curso']::text[];
$$;
revoke all on function public.estados_que_ocupan_horario() from public, anon;

-- ---------------------------------------------------------------------------
-- #1 y #9. La guarda deja de creerle al cliente: recalcula la disponibilidad
-- con la nómina que hay en ese instante, dentro de la misma operación.
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
    -- `cupos_totales` son las plazas ofrecidas a OTROS jugadores: el
    -- organizador está en `attendees` pero no consume una. Si se lo contara,
    -- un partido de 1 cupo con sólo el organizador quedaría bloqueado.
    -- En un partido entre clubes el organizador es el administrador del club
    -- rival y sí puede ser uno más de la nómina: ahí se cuenta.
    select count(*) into v_ocupadas
    from public.attendees
    where id_partido = new.id
      and estado in ('inscrito', 'confirmado_gps', 'no_asistio')
      and (v_es_de_clubes or id_jugador is distinct from new.id_organizador);

    if new.cupos_totales < v_ocupadas then
        raise exception 'CUPOS_MENOR_QUE_CONFIRMADOS:%:%', new.cupos_totales, v_ocupadas;
    end if;

    if v_es_de_clubes then
        -- La inscripción por club lleva su propia cuenta (nómina por lado):
        -- aquí sólo se impide que se pase del total.
        if new.cupos_disponibles > new.cupos_totales then
            new.cupos_disponibles := new.cupos_totales;
        end if;
    else
        -- La disponibilidad no se recibe, se deduce. Una pantalla abierta hace
        -- diez minutos ya no puede ofrecer plazas que otro jugador tomó.
        new.cupos_disponibles := greatest(new.cupos_totales - v_ocupadas, 0);
    end if;

    return new;
end;
$$;

drop trigger if exists tg_matches_guard_cupos on public.matches;
create trigger tg_matches_guard_cupos
    before update of cupos_totales, cupos_disponibles on public.matches
    for each row
    execute function public.matches_guard_cupos();

-- ---------------------------------------------------------------------------
-- #6. Consulta y escritura usan el mismo conjunto de estados.
-- ---------------------------------------------------------------------------
create or replace function public.get_schedule_conflict(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_hora timestamptz; v_dur int; v_conf record;
begin
  if v_user is null then return jsonb_build_object('conflict', false); end if;
  select hora, duracion_min into v_hora, v_dur from public.matches where id = p_match_id;
  if v_hora is null then return jsonb_build_object('conflict', false); end if;

  select m.id, m.titulo, m.hora,
         (m.hora > now() + interval '2 hours') as can_swap,
         (m.id_organizador = v_user) as i_am_host
    into v_conf
  from public.attendees a
  join public.matches m on m.id = a.id_partido
  where a.id_jugador = v_user
    and a.estado in ('inscrito','confirmado_gps')
    and m.id <> p_match_id
    and m.estado = any (public.estados_que_ocupan_horario())
    and v_hora < m.hora + make_interval(mins => coalesce(m.duracion_min,90))
    and m.hora < v_hora + make_interval(mins => coalesce(v_dur,90))
  order by m.hora asc limit 1;

  if v_conf.id is null then return jsonb_build_object('conflict', false); end if;

  return jsonb_build_object(
    'conflict', true,
    'matchId', v_conf.id,
    'titulo', v_conf.titulo,
    'hora', v_conf.hora,
    'canSwap', v_conf.can_swap,
    'iAmHost', v_conf.i_am_host
  );
end;
$$;
revoke all on function public.get_schedule_conflict(uuid) from public, anon;
grant execute on function public.get_schedule_conflict(uuid) to authenticated;

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
begin
  if new.estado not in ('inscrito','pendiente') then return new; end if;

  select min_trust_score, id_organizador, hora, duracion_min,
         challenge_proposal_id is not null, edad_min, edad_max
    into v_min, v_org, v_hora, v_dur, v_es_de_clubes, v_edad_min, v_edad_max
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
