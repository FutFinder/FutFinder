-- =============================================================
-- FutFinder — migración 45: inscripción y cupos por club
--
-- LA CUENTA QUE MANDA ES POR CLUB. `cupos_totales` sigue existiendo
-- para `estado = 'lleno'` y para `matches_guard_cupos`, pero NO decide
-- quién entra: decide
--
--     ocupados(club) = attendees where id_partido = ? and club_id = ?
--                      and estado in ('inscrito','confirmado_gps')
--
-- Los cupos nunca se comparten: que el club A esté lleno no le quita
-- nada al club B.
--
-- UN `pendiente` NO CONSUME CUPO. En selección por administrador se
-- postulan muchos y el administrador elige; si postular reservara,
-- tres postulaciones llenarían un club de tres.
--
-- CONCURRENCIA: toda RPC que cambie la ocupación empieza con
-- `select ... from matches where id = ? for update`. Las inscripciones,
-- bajas y confirmaciones de ese partido se serializan detrás de esa
-- fila, y el conteo por club se hace DESPUÉS de tomar el bloqueo y
-- dentro de la misma transacción: no hay ventana entre contar y
-- escribir. Detrás quedan dos redes: el índice único
-- `(id_partido, id_jugador)` y el trigger de la 44d.
--
-- LA PUERTA YA ESTABA ABIERTA: `trg_attendees_solo_rpc_de_clubes` deja
-- pasar la fila que trae `club_id`. Estas RPC lo ponen; nadie más puede.
--
-- RESERVA VOLUNTARIA DE LOS ADMINISTRADORES. Al proponer y al aprobar
-- se pregunta «¿quieres incluirte como jugador?», con «No» por defecto.
-- La intención del proponente se guarda en la propuesta y NO consume
-- cupo; el cupo se consume sólo al publicarse el partido, y cada
-- administrador consume uno de SU club. Es la única excepción a que
-- nadie se aprueba a sí mismo, y sólo existe en ese instante: publicado
-- el partido, `confirmar_nomina_club` no deja que nadie se confirme.
-- =============================================================

-- ── 1. DE DÓNDE VINO CADA INSCRIPCIÓN ───────────────────────────
-- Auditable en la propia fila, sin cruzar tablas ni leer eventos.
alter table public.attendees
    add column if not exists origen text;

-- Las filas anteriores a esta migración se marcan `legado` y no se
-- inventa de dónde vinieron: se crearon cuando la columna no existía y
-- reconstruirlo a posteriori sería adivinar.
update public.attendees set origen = 'legado' where origen is null;

alter table public.attendees drop constraint if exists attendees_origen_check;
alter table public.attendees add constraint attendees_origen_check
    check (origen in (
        'orden_llegada',        -- se inscribió y entró directo
        'postulacion',          -- postuló, esperando que su club lo confirme
        'postulacion_aprobada', -- un admin de SU club lo confirmó
        'reserva_proponente',   -- reservó su cupo al PROPONER el partido
        'reserva_aprobador',    -- reservó su cupo al APROBARLO
        'organizador',          -- organiza el partido (partidos normales)
        'legado'                -- anterior a esta migración
    ));

-- ── 1b. NADIE SE QUEDA SIN `origen` ─────────────────────────────
-- Poner la columna NOT NULL destapó que TODAS las vías heredadas
-- insertan sin ella: `add_organizer_as_attendee`, `join_match`,
-- `request_join`, `swap_match` y `cancel_match_and_join`. Sin esto,
-- crear un partido normal fallaba.
--
-- Se resuelve con un trigger y no recreando esas cinco funciones: son
-- largas, no están versionadas, y tocarlas para añadir una columna es
-- justo donde se pierde algo por el camino. El trigger deduce el origen
-- de lo que ya sabe la fila, y NO pisa lo que la RPC haya puesto — las
-- de clubes lo ponen explícito y ganan siempre.
create or replace function public.attendees_completa_origen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.origen is not null then
        return new;   -- lo puso la RPC: manda ella
    end if;
    if exists (select 1 from public.matches m
                where m.id = new.id_partido and m.id_organizador = new.id_jugador) then
        new.origen := 'organizador';
    elsif new.estado = 'pendiente' then
        new.origen := 'postulacion';
    else
        new.origen := 'orden_llegada';
    end if;
    return new;
end;
$$;

-- PostgreSQL dispara triggers equivalentes por nombre. El prefijo `aa_`
-- garantiza que éste va antes que los `tg_*`/`trg_*` ya desplegados, para que
-- cualquier red posterior reciba una fila con procedencia controlada.
drop trigger if exists trg_attendees_completa_origen on public.attendees;
drop trigger if exists aa_attendees_completa_origen on public.attendees;
create trigger aa_attendees_completa_origen
    before insert on public.attendees
    for each row execute function public.attendees_completa_origen();

alter table public.attendees alter column origen set not null;

comment on column public.attendees.origen is
    'Cómo llegó esta inscripción. NOT NULL y con CHECK: no acepta texto arbitrario. Las dos reserva_* registran que el propio administrador la autorizó de forma explícita al proponer o al aprobar. El cliente NO puede escribirlo: desde la migración 44e `attendees` no tiene ninguna política de escritura y sólo entran las RPC security definer.';

-- `suscribirseANomina()` escucha INSERT/UPDATE de esta tabla. La publicación
-- se versiona acá (hasta ahora sólo `messages` estaba añadida desde el repo) y
-- se agrega de forma idempotente por si otro entorno ya la habilitó a mano.
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
         where pubname = 'supabase_realtime'
           and schemaname = 'public'
           and tablename = 'attendees'
    ) then
        alter publication supabase_realtime add table public.attendees;
    end if;
end;
$$;

-- ── 2. LA INTENCIÓN DEL PROPONENTE ──────────────────────────────
alter table public.club_challenge_proposals
    add column if not exists proponente_juega boolean not null default false;

comment on column public.club_challenge_proposals.proponente_juega is
    'true si quien propuso pidió reservarse un cupo. NO consume cupo mientras la propuesta esté pendiente: se materializa al publicarse el partido. Por defecto false.';

-- ── 2b. UN AVISO NUEVO: LA RESERVA QUE NO SE PUDO APLICAR ───────
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
    check (type in (
        'match_join', 'friend_request', 'friend_accept', 'message_new',
        'match_reminder', 'match_rate', 'join_request', 'join_approved',
        'join_rejected', 'match_cancelled', 'match_updated', 'match_slot_free',
        'waitlist_turn', 'match_left', 'match_attendance',
        'club_request', 'club_request_accepted', 'club_request_rejected',
        'club_member_joined', 'club_member_left', 'club_invite_accepted',
        'club_challenge', 'club_challenge_accepted', 'club_challenge_rejected',
        'chat_mention_all',
        'club_challenge_extension', 'club_challenge_closed',
        'club_challenge_proposal', 'club_challenge_proposal_rejected',
        'club_match_published', 'club_match_reserva_omitida'
    ));

-- ── 3. EL AVISO DE INSCRIPCIÓN NO APLICA A LOS CLUBES ───────────
-- `tg_notify_match_join` avisa al `id_organizador`, que en un partido de
-- clubes es el administrador del club RIVAL: recibiría un aviso por cada
-- jugador de los dos equipos, incluidos los dos administradores que
-- acaban de autorizarse a sí mismos. Los avisos de la nómina por club
-- los mandan las RPC de abajo, a quien corresponde.
create or replace function public.tg_notify_match_join()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organizador uuid; v_titulo text; v_username text; v_es_de_clubes boolean;
begin
  if new.estado = 'pendiente' then
    return new;  -- solicitud manual → la maneja request_join
  end if;

  select id_organizador, titulo, challenge_proposal_id is not null
    into v_organizador, v_titulo, v_es_de_clubes
  from public.matches where id = new.id_partido;

  if v_es_de_clubes then
    return new;  -- la nómina por club avisa por su cuenta
  end if;

  if v_organizador is null or v_organizador = new.id_jugador then
    return new;
  end if;

  select username into v_username from public.profiles where id = new.id_jugador;

  perform public.create_notification(
    v_organizador, 'match_join',
    coalesce(v_username, 'Alguien') || ' se unió a tu partido',
    coalesce(v_titulo, 'Partido'),
    jsonb_build_object('matchId', new.id_partido, 'playerId', new.id_jugador)
  );
  return new;
end;
$$;

-- ── 4. AYUDANTES DE CONTEO ──────────────────────────────────────
-- Escritos una vez para que las tres RPC cuenten exactamente igual.
create or replace function public.cupos_ocupados_club(p_match_id uuid, p_club_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
    -- 'pendiente' NO cuenta: postular no reserva.
    select count(*)::integer
      from public.attendees a
     where a.id_partido = p_match_id
       and a.club_id = p_club_id
       and a.estado in ('inscrito', 'confirmado_gps');
$$;

-- Es un helper interno. Las RPC SECURITY DEFINER lo pueden invocar sin
-- exponer el conteo de un partido privado como endpoint independiente.
revoke execute on function public.cupos_ocupados_club(uuid, uuid)
    from public, anon, authenticated;

/**
 * El club del usuario dentro de este partido, o null si no es de ninguno.
 * Se deriva de `club_members` en vivo, nunca de nada que mande el cliente.
 */
create or replace function public.mi_club_en_partido(p_match_id uuid, p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
    select cm.club_id
      from public.matches m
      join public.club_members cm
        on cm.user_id = p_user_id
       and cm.club_id in (m.club_local_id, m.club_visitante_id)
     where m.id = p_match_id
     limit 1;
$$;

-- Igual que el conteo: aceptar `p_user_id` lo hace útil dentro de las RPC,
-- pero sería una fuga de pertenencia si cualquier cliente pudiera llamarlo.
revoke execute on function public.mi_club_en_partido(uuid, uuid)
    from public, anon, authenticated;

-- ── 5. INSCRIBIRSE ──────────────────────────────────────────────
create or replace function public.join_club_match(p_match_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me      uuid := auth.uid();
    v_match   public.matches;
    v_club    uuid;
    v_ya      public.attendees;
    v_ocupados integer;
    v_estado  text;
    v_origen  text;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    -- El bloqueo va primero: todo lo que sigue —contar y escribir—
    -- ocurre con la fila del partido tomada.
    select * into v_match from public.matches where id = p_match_id for update;
    if not found then
        return json_build_object('ok', false, 'reason', 'Partido no existe');
    end if;
    if v_match.challenge_proposal_id is null then
        return json_build_object('ok', false,
            'reason', 'Este no es un partido entre clubes');
    end if;
    if v_match.estado <> 'abierto' and v_match.estado <> 'lleno' then
        return json_build_object('ok', false, 'reason', 'Este partido ya no acepta jugadores');
    end if;
    if v_match.hora <= now() then
        return json_build_object('ok', false, 'reason', 'Este partido ya comenzó');
    end if;

    v_club := public.mi_club_en_partido(p_match_id, v_me);
    if v_club is null then
        return json_build_object('ok', false,
            'reason', 'Solo pueden inscribirse los integrantes de los dos clubes');
    end if;

    -- Reintento: si ya hay fila, se devuelve tal cual. Volver a pulsar
    -- no crea una segunda ni cambia de estado.
    select * into v_ya from public.attendees
     where id_partido = p_match_id and id_jugador = v_me;
    if found then
        return json_build_object('ok', true, 'already', true, 'estado', v_ya.estado);
    end if;

    if v_match.metodo_inscripcion = 'seleccion_admin' then
        -- Postular no reserva cupo: el límite se aplica al confirmar.
        v_estado := 'pendiente';
        v_origen := 'postulacion';
    else
        v_ocupados := public.cupos_ocupados_club(p_match_id, v_club);
        if v_ocupados >= v_match.cupos_por_club then
            return json_build_object('ok', false,
                'reason', format('Tu club ya llenó sus %s cupos', v_match.cupos_por_club));
        end if;
        v_estado := 'inscrito';
        v_origen := 'orden_llegada';
    end if;

    insert into public.attendees (id_partido, id_jugador, estado, club_id, origen)
    values (p_match_id, v_me, v_estado, v_club, v_origen);

    if v_estado = 'inscrito' then
        update public.matches
           set cupos_disponibles = greatest(cupos_disponibles - 1, 0),
               estado = case when cupos_disponibles - 1 <= 0 then 'lleno' else estado end
         where id = p_match_id;
    else
        -- Aviso a los administradores del club DEL POSTULANTE: son los
        -- que deciden, y el club rival no tiene nada que hacer aquí.
        insert into public.notifications (user_id, type, title, body, data)
        select cm.user_id, 'join_request',
               'Nueva postulación para el partido de clubes',
               coalesce(v_match.titulo, 'Partido de clubes'),
               jsonb_build_object('matchId', p_match_id, 'playerId', v_me)
          from public.club_members cm
         where cm.club_id = v_club and cm.rol = 'admin' and cm.user_id <> v_me;
    end if;

    return json_build_object('ok', true, 'estado', v_estado, 'clubId', v_club);
end;
$$;

revoke execute on function public.join_club_match(uuid) from public, anon;
grant execute on function public.join_club_match(uuid) to authenticated;

-- ── 6. SALIRSE ──────────────────────────────────────────────────
create or replace function public.leave_club_match(p_match_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me    uuid := auth.uid();
    v_match public.matches;
    v_att   public.attendees;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    select * into v_match from public.matches where id = p_match_id for update;
    if not found then
        return json_build_object('ok', false, 'reason', 'Partido no existe');
    end if;
    if v_match.challenge_proposal_id is null then
        return json_build_object('ok', false,
            'reason', 'Este no es un partido entre clubes');
    end if;

    select * into v_att from public.attendees
     where id_partido = p_match_id and id_jugador = v_me;
    if not found then
        return json_build_object('ok', true, 'noEstabas', true);
    end if;

    delete from public.attendees where id = v_att.id;

    -- Sólo libera cupo lo que lo consumía. Una postulación pendiente no
    -- tenía ninguno.
    if v_att.estado in ('inscrito', 'confirmado_gps') then
        update public.matches
           set cupos_disponibles = least(cupos_disponibles + 1, cupos_totales),
               estado = case when estado = 'lleno' then 'abierto' else estado end
         where id = p_match_id;
    end if;

    return json_build_object('ok', true, 'liberoCupo',
        v_att.estado in ('inscrito', 'confirmado_gps'));
end;
$$;

revoke execute on function public.leave_club_match(uuid) from public, anon;
grant execute on function public.leave_club_match(uuid) to authenticated;

-- ── 7. CONFIRMAR O RECHAZAR LA NÓMINA ───────────────────────────
-- Un administrador del club DEL JUGADOR, nunca del otro. Y nunca a sí
-- mismo: la única autoinscripción permitida es la reserva explícita al
-- proponer o al aprobar, y ésa ocurre antes de que el partido exista.
create or replace function public.confirmar_nomina_club(
    p_match_id  uuid,
    p_player_id uuid,
    p_aprobar   boolean
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me       uuid := auth.uid();
    v_match    public.matches;
    v_att      public.attendees;
    v_soy_admin boolean;
    v_ocupados integer;
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

    update public.attendees
       set estado = 'inscrito', origen = 'postulacion_aprobada'
     where id = v_att.id;

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
$$;

revoke execute on function public.confirmar_nomina_club(uuid, uuid, boolean) from public, anon;
grant execute on function public.confirmar_nomina_club(uuid, uuid, boolean) to authenticated;

-- ── 8. LA PROPUESTA GUARDA LA INTENCIÓN DEL PROPONENTE ──────────
-- Igual que la 43c salvo por `proponente_juega`, que sale del payload y
-- por defecto es false: «No» es lo que pasa si nadie dice nada.
create or replace function public.crear_propuesta_oficial(
    p_challenge_id uuid,
    p_payload      jsonb,
    p_client_token uuid default null
)
returns public.club_challenge_proposals
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me      uuid := auth.uid();
    v_row     public.club_challenges;
    v_prop    public.club_challenge_proposals;
    v_club    uuid;
    v_reglas  jsonb := public.desafio_reglas();
    v_min     integer := (v_reglas ->> 'cupos_por_club_min')::int;
    v_max     integer := (v_reglas ->> 'cupos_por_club_max')::int;
    v_instr   integer := (v_reglas ->> 'instrucciones_max')::int;
    v_fecha   timestamptz;
    v_dur     integer;
    v_cupos   integer;
    v_cuota   integer;
    v_nombre  text;
    v_lat     double precision;
    v_lng     double precision;
begin
    if v_me is null then
        raise exception 'No autenticado' using errcode = '42501';
    end if;

    select * into v_row from public.club_challenges where id = p_challenge_id for update;
    if not found then
        raise exception 'Este desafío ya no existe' using errcode = 'no_data_found';
    end if;

    select m.club_id into v_club
      from public.club_members m
     where m.user_id = v_me and m.rol = 'admin'
       and m.club_id in (v_row.club_retador_id, v_row.club_retado_id)
     limit 1;
    if v_club is null then
        raise exception 'Solo un administrador de alguno de los dos clubes puede proponer'
            using errcode = '42501';
    end if;

    if p_client_token is not null then
        select * into v_prop from public.club_challenge_proposals
         where client_token = p_client_token and challenge_id = v_row.id;
        if found then return v_prop; end if;
    end if;

    if v_row.estado <> 'negociacion' then
        raise exception 'Este desafío no está en negociación' using errcode = 'check_violation';
    end if;
    if v_row.prorroga_abierta_at is not null and v_row.prorroga_vence_at <= now() then
        raise exception 'La prórroga ya venció' using errcode = 'check_violation';
    end if;

    v_fecha := (p_payload ->> 'fecha')::timestamptz;
    if v_fecha is null or v_fecha <= now() then
        raise exception 'La fecha del partido tiene que ser futura' using errcode = 'check_violation';
    end if;
    v_dur := (p_payload ->> 'duracion_min')::int;
    if v_dur is null or v_dur not in (60, 90, 120) then
        raise exception 'Duración no válida' using errcode = 'check_violation';
    end if;
    if coalesce(trim(p_payload ->> 'direccion'), '') = ''
       or coalesce(trim(p_payload ->> 'cancha_nombre'), '') = ''
       or coalesce(trim(p_payload ->> 'comuna'), '') = ''
       or coalesce(trim(p_payload ->> 'region'), '') = '' then
        raise exception 'Faltan datos del lugar del partido' using errcode = 'check_violation';
    end if;
    if jsonb_typeof(p_payload -> 'latitud') is distinct from 'number'
       or jsonb_typeof(p_payload -> 'longitud') is distinct from 'number' then
        raise exception 'Falta la ubicación de la cancha en el mapa. Elígela en el buscador de lugares'
            using errcode = 'check_violation';
    end if;
    v_lat := (p_payload ->> 'latitud')::double precision;
    v_lng := (p_payload ->> 'longitud')::double precision;
    if v_lat < -90 or v_lat > 90 or v_lng < -180 or v_lng > 180 then
        raise exception 'La ubicación de la cancha no es un punto válido del mapa'
            using errcode = 'check_violation';
    end if;
    if coalesce(p_payload ->> 'modalidad', '') not in ('futbol7', 'futbol11') then
        raise exception 'Modalidad no válida' using errcode = 'check_violation';
    end if;
    v_cupos := (p_payload ->> 'cupos_por_club')::int;
    if v_cupos is null or v_cupos < v_min or v_cupos > v_max then
        raise exception 'Los cupos por club van de % a %', v_min, v_max using errcode = 'check_violation';
    end if;
    if coalesce(p_payload ->> 'metodo_inscripcion', '') not in (
        select jsonb_array_elements_text(v_reglas -> 'metodos_inscripcion')) then
        raise exception 'Método de inscripción no válido' using errcode = 'check_violation';
    end if;
    v_cuota := coalesce((p_payload ->> 'cuota_por_persona')::int, 0);
    if v_cuota < 0 then
        raise exception 'La cuota no puede ser negativa' using errcode = 'check_violation';
    end if;
    if length(coalesce(p_payload ->> 'instrucciones', '')) > v_instr then
        raise exception 'Las instrucciones no pueden pasar de % caracteres', v_instr
            using errcode = 'check_violation';
    end if;

    begin
        insert into public.club_challenge_proposals (
            challenge_id, club_proponente_id, creada_por,
            fecha, duracion_min, direccion, cancha_nombre, comuna, region,
            latitud, longitud, modalidad, cupos_por_club, metodo_inscripcion,
            cuota_por_persona, instrucciones, client_token, proponente_juega
        )
        values (
            v_row.id, v_club, v_me, v_fecha, v_dur,
            trim(p_payload ->> 'direccion'), trim(p_payload ->> 'cancha_nombre'),
            trim(p_payload ->> 'comuna'), trim(p_payload ->> 'region'),
            v_lat, v_lng, p_payload ->> 'modalidad', v_cupos,
            p_payload ->> 'metodo_inscripcion', v_cuota,
            nullif(trim(coalesce(p_payload ->> 'instrucciones', '')), ''),
            p_client_token,
            -- «No» por defecto: si la clave no viene, no se reserva nada.
            coalesce((p_payload ->> 'proponente_juega')::boolean, false)
        )
        returning * into v_prop;
    exception when unique_violation then
        raise exception 'Ya hay una propuesta oficial esperando respuesta'
            using errcode = 'unique_violation';
    end;

    update public.club_challenges
       set estado = 'esperando_aprobacion',
           prorroga_abierta_at = null, prorroga_vence_at = null,
           negociacion_vence_at = case
               when prorroga_abierta_at is not null
                   then now() + make_interval(hours => (v_reglas ->> 'negociacion_horas')::int)
               else negociacion_vence_at end
     where id = v_row.id and estado = 'negociacion'
    returning * into v_row;
    if not found then
        raise exception 'Este desafío no está en negociación' using errcode = 'check_violation';
    end if;

    delete from public.club_challenge_extension_replies where challenge_id = v_row.id;
    select nombre into v_nombre from public.clubs where id = v_club;

    insert into public.club_challenge_events (challenge_id, tipo, actor_id, club_id, payload)
    values (v_row.id, 'propuesta_creada', v_me, v_club,
        jsonb_build_object('proposal_id', v_prop.id, 'fecha', v_prop.fecha,
            'cancha_nombre', v_prop.cancha_nombre, 'comuna', v_prop.comuna,
            'cupos_por_club', v_prop.cupos_por_club,
            'proponente_juega', v_prop.proponente_juega));

    perform public.desafio_avisar(v_row, 'club_challenge_proposal',
        '📋 Propuesta oficial de ' || coalesce(v_nombre, 'el club rival'),
        'Revisa cancha, fecha, cupos y cuota. El partido se publica cuando el club contrario la apruebe.',
        array[v_row.club_retador_id, v_row.club_retado_id], v_me,
        jsonb_build_object('proposalId', v_prop.id));

    return v_prop;
end;
$$;

revoke execute on function public.crear_propuesta_oficial(uuid, jsonb, uuid) from public, anon;
grant execute on function public.crear_propuesta_oficial(uuid, jsonb, uuid) to authenticated;

-- ── 8b. QUÉ SE PERDONA AL RESERVAR, Y QUÉ NO ───────────────────
-- La lista es corta y explícita a propósito: son los tres impedimentos
-- que `tg_enforce_join_rules` levanta sobre LA PERSONA. Todo lo demás
-- —una violación de unicidad, un permiso, una restricción— es un fallo
-- de verdad y tiene que abortar la publicación entera.
create or replace function public.es_impedimento_personal(p_error text)
returns boolean
language sql
immutable
as $$
    select coalesce(p_error, '') like 'CHOQUE_HORARIO%'
        or coalesce(p_error, '') like 'SUSPENDIDO%'
        or coalesce(p_error, '') like 'TRUST_BAJO%';
$$;

/** El impedimento, dicho para que lo lea una persona. */
create or replace function public.motivo_reserva_omitida(p_error text)
returns text
language sql
immutable
as $$
    select case
        when coalesce(p_error,'') like 'CHOQUE_HORARIO%'
            then 'ya tienes otro partido en ese horario'
        when coalesce(p_error,'') like 'SUSPENDIDO%'
            then 'tu cuenta está suspendida temporalmente'
        when coalesce(p_error,'') like 'TRUST_BAJO%'
            then 'tu Trust Score no alcanza para este partido'
        else 'no pudimos incluirte'
    end;
$$;

revoke execute on function public.es_impedimento_personal(text) from public, anon, authenticated;
revoke execute on function public.motivo_reserva_omitida(text) from public, anon, authenticated;

-- ── 8c. LA EXENCIÓN DEL ORGANIZADOR ES DE LOS PARTIDOS NORMALES ──
-- `tg_enforce_join_rules` valida choque de horario, suspensión y Trust
-- Score en cada insert de `attendees`, y perdona al organizador:
--
--     if v_org = new.id_jugador then return new; end if;
--
-- Tiene todo el sentido en un partido normal —el organizador siempre
-- está en su propio partido, y no puede chocar consigo mismo—. Pero en
-- un partido de clubes `id_organizador` es EL ADMINISTRADOR QUE
-- APRUEBA: la fila la crea `aprobar_propuesta` a su nombre porque
-- `matches.id_organizador` es NOT NULL, no porque él organice nada.
--
-- El efecto era que la reserva del aprobador se saltaba las tres
-- comprobaciones y entraba siempre, mientras la del proponente sí
-- pasaba por ellas. Dos administradores, el mismo botón, distinta
-- regla. Peor: el aprobador quedaba inscrito en dos partidos a la misma
-- hora, que es justo lo que `CHOQUE_HORARIO` existe para impedir, y el
-- manejador de excepción y el aviso `club_match_reserva_omitida` del
-- aprobador eran código inalcanzable.
--
-- En un partido de clubes NADIE está exento: se entra por pertenecer a
-- uno de los dos clubes, y eso vale igual para quien aprueba.
--
-- No rompe nada más: `add_organizer_as_attendee` ya salta los partidos
-- de clubes desde la 44, así que la exención no la usaba ninguna otra
-- vía. Se versiona la función entera porque no lo estaba (es de las
-- aplicadas por consola), igual que hizo la 44e con `approve_join`.
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
begin
  if new.estado not in ('inscrito','pendiente') then return new; end if;

  select min_trust_score, id_organizador, hora, duracion_min,
         challenge_proposal_id is not null
    into v_min, v_org, v_hora, v_dur, v_es_de_clubes
  from public.matches where id = new.id_partido;

  -- ÚNICO CAMBIO respecto de la versión anterior.
  if v_org = new.id_jugador and not coalesce(v_es_de_clubes, false) then
    return new;
  end if;

  select trust_score, estado, suspended_until into v_trust, v_estado, v_until
  from public.profiles where id = new.id_jugador;

  if v_estado = 'suspendido' and (v_until is null or v_until > now()) then
    raise exception 'SUSPENDIDO';
  end if;
  if coalesce(v_trust,0) < coalesce(v_min,0) then
    raise exception 'TRUST_BAJO:%:%', coalesce(v_trust,0), coalesce(v_min,0);
  end if;

  select 1 into v_clash
  from public.attendees a
  join public.matches m on m.id = a.id_partido
  where a.id_jugador = new.id_jugador
    and a.estado in ('inscrito','confirmado_gps')
    and m.id <> new.id_partido
    and m.estado = 'abierto'
    and v_hora < m.hora + make_interval(mins => coalesce(m.duracion_min,90))
    and m.hora < v_hora + make_interval(mins => coalesce(v_dur,90))
  limit 1;
  if found then raise exception 'CHOQUE_HORARIO'; end if;

  return new;
end;
$$;

-- ── 9. APROBAR, PUBLICAR E INSCRIBIR A QUIEN LO PIDIÓ ────────────
-- Hay que BORRAR la versión de un argumento: si se dejan las dos, una
-- llamada con un solo parámetro seguiría resolviendo a la vieja —es una
-- coincidencia exacta— y el administrador nunca quedaría inscrito.
drop function if exists public.aprobar_propuesta(uuid);

create or replace function public.aprobar_propuesta(
    p_proposal_id uuid,
    p_me_inscribo boolean default false   -- «No» por defecto
)
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me       uuid := auth.uid();
    v_prop     public.club_challenge_proposals;
    v_row      public.club_challenges;
    v_match    public.matches;
    v_club     uuid;
    v_en_prop  boolean;
    v_local    text;
    v_visita   text;
    v_aprob    text;
    v_inscritos integer := 0;
    v_prop_sigue boolean;
    v_prop_inscrito boolean := false;
    v_aprob_inscrito boolean := false;
    v_prop_motivo text;
    v_aprob_motivo text;
begin
    if v_me is null then
        raise exception 'No autenticado' using errcode = '42501';
    end if;

    select * into v_prop from public.club_challenge_proposals where id = p_proposal_id;
    if not found then
        raise exception 'Esta propuesta ya no existe' using errcode = 'no_data_found';
    end if;

    select * into v_row from public.club_challenges where id = v_prop.challenge_id for update;
    if not found then
        raise exception 'Este desafío ya no existe' using errcode = 'no_data_found';
    end if;

    select * into v_prop from public.club_challenge_proposals where id = p_proposal_id for update;

    select m.club_id into v_club
      from public.club_members m
     where m.user_id = v_me and m.rol = 'admin'
       and m.club_id in (v_row.club_retador_id, v_row.club_retado_id)
       and m.club_id <> v_prop.club_proponente_id
     limit 1;
    if v_club is null then
        raise exception 'Solo un administrador del club contrario puede aprobar la propuesta'
            using errcode = '42501';
    end if;

    select exists (select 1 from public.club_members m
        where m.user_id = v_me and m.club_id = v_prop.club_proponente_id) into v_en_prop;
    if v_en_prop then
        raise exception 'No puedes aprobar una propuesta de un club al que perteneces'
            using errcode = '42501';
    end if;

    if v_prop.estado = 'aprobada' then
        select * into v_match from public.matches where challenge_proposal_id = v_prop.id;
        if found then return v_match; end if;
        raise exception 'Esta propuesta figura aprobada pero su partido no existe'
            using errcode = 'internal_error';
    end if;
    if v_prop.estado <> 'pendiente' then
        raise exception 'Esta propuesta ya fue respondida' using errcode = 'check_violation';
    end if;
    if v_row.estado <> 'esperando_aprobacion' then
        raise exception 'Este desafío no está esperando aprobación' using errcode = 'check_violation';
    end if;
    if public.club_esta_sancionado(v_row.club_retador_id)
       or public.club_esta_sancionado(v_row.club_retado_id) then
        raise exception 'Uno de los dos clubes está sancionado y no puede publicar partidos'
            using errcode = 'check_violation';
    end if;
    if v_prop.fecha <= now() then
        raise exception 'La fecha de la propuesta ya pasó. Pidan cambios y propongan otra'
            using errcode = 'check_violation';
    end if;
    if v_prop.latitud is null or v_prop.longitud is null then
        raise exception 'La propuesta no tiene la cancha ubicada en el mapa. Pidan cambios y vuelvan a proponerla'
            using errcode = 'check_violation';
    end if;
    if v_prop.latitud < -90 or v_prop.latitud > 90
       or v_prop.longitud < -180 or v_prop.longitud > 180 then
        raise exception 'La ubicación de la propuesta no es un punto válido del mapa. Pidan cambios y vuelvan a proponerla'
            using errcode = 'check_violation';
    end if;

    update public.club_challenge_proposals
       set estado = 'aprobada', respondida_por = v_me, respondida_at = now()
     where id = v_prop.id and estado = 'pendiente'
    returning * into v_prop;
    if not found then
        raise exception 'Esta propuesta ya fue respondida' using errcode = 'check_violation';
    end if;

    update public.club_challenge_proposals set estado = 'caducada'
     where challenge_id = v_row.id and id <> v_prop.id and estado = 'pendiente';

    select nombre into v_local  from public.clubs where id = v_row.club_retador_id;
    select nombre into v_visita from public.clubs where id = v_row.club_retado_id;
    v_aprob := case v_prop.metodo_inscripcion
                   when 'seleccion_admin' then 'manual' else 'inmediata' end;

    insert into public.matches (
        id_organizador, titulo, region, comuna, cancha_nombre,
        latitud, longitud, ubicacion_aproximada, hora, duracion_min,
        cupos_totales, cupos_disponibles, cupos_por_club,
        precio_cuota, modalidad, descripcion, aprobacion, metodo_inscripcion,
        club_local_id, club_visitante_id, challenge_id, challenge_proposal_id
    )
    values (
        v_me, coalesce(v_local, 'Club local') || ' vs ' || coalesce(v_visita, 'Club visitante'),
        v_prop.region, v_prop.comuna, v_prop.cancha_nombre,
        public.aproximar_grado(v_prop.latitud::numeric(10,7)),
        public.aproximar_grado(v_prop.longitud::numeric(10,7)), true,
        v_prop.fecha, v_prop.duracion_min,
        v_prop.cupos_por_club * 2, v_prop.cupos_por_club * 2, v_prop.cupos_por_club,
        v_prop.cuota_por_persona, v_prop.modalidad, v_prop.instrucciones,
        v_aprob, v_prop.metodo_inscripcion,
        v_row.club_retador_id, v_row.club_retado_id, v_row.id, v_prop.id
    )
    returning * into v_match;

    insert into public.club_match_locations (match_id, direccion, latitud, longitud)
    values (v_match.id, v_prop.direccion,
            v_prop.latitud::numeric(10,7), v_prop.longitud::numeric(10,7));

    -- ── LAS DOS RESERVAS VOLUNTARIAS ────────────────────────────
    -- Cada administrador consume UN cupo de SU club. Todo dentro de esta
    -- misma transacción: o se publica el partido con sus inscripciones,
    -- o no se publica nada.

    -- El proponente, si lo pidió Y SIGUE en su club. Pudo haberse salido
    -- entre proponer y que le aprobaran, y entonces no le corresponde.
    -- `tg_enforce_join_rules` valida en cada insert de `attendees` tres
    -- cosas que son DE LA PERSONA: choque de horario, suspensión y
    -- Trust Score. Si una de ésas tumbara la transacción, un
    -- administrador con otro partido a la misma hora impediría publicar
    -- el encuentro entero. El partido manda: se omite SU reserva, se
    -- publica igual y queda anotado por qué.
    --
    -- CUALQUIER OTRO ERROR SE RELANZA. Un fallo de integridad o de
    -- permisos no es un impedimento personal, y taparlo aquí lo
    -- convertiría en un partido publicado a medias que nadie notaría.
    -- `public.es_impedimento_personal()` es la única lista de lo que se
    -- perdona.
    if v_prop.proponente_juega and v_prop.creada_por is not null then
        select exists (select 1 from public.club_members cm
            where cm.user_id = v_prop.creada_por
              and cm.club_id = v_prop.club_proponente_id) into v_prop_sigue;

        if v_prop_sigue then
            begin
                insert into public.attendees (id_partido, id_jugador, estado, club_id, origen)
                values (v_match.id, v_prop.creada_por, 'inscrito',
                        v_prop.club_proponente_id, 'reserva_proponente');
                v_inscritos := v_inscritos + 1;
                v_prop_inscrito := true;
            exception when others then
                if not public.es_impedimento_personal(sqlerrm) then
                    raise;   -- integridad o permisos: aborta todo
                end if;
                v_prop_motivo := public.motivo_reserva_omitida(sqlerrm);
            end;
        else
            v_prop_motivo := 'ya no pertenece al club que propuso';
        end if;
    end if;

    -- Quien aprueba, si lo pidió. Su pertenencia al club ya quedó
    -- comprobada arriba: `v_club` sale de `club_members` en vivo.
    if coalesce(p_me_inscribo, false) then
        begin
            insert into public.attendees (id_partido, id_jugador, estado, club_id, origen)
            values (v_match.id, v_me, 'inscrito', v_club, 'reserva_aprobador');
            v_inscritos := v_inscritos + 1;
            v_aprob_inscrito := true;
        exception when others then
            if not public.es_impedimento_personal(sqlerrm) then
                raise;   -- integridad o permisos: aborta todo
            end if;
            v_aprob_motivo := public.motivo_reserva_omitida(sqlerrm);
        end;
    end if;

    if v_inscritos > 0 then
        update public.matches
           set cupos_disponibles = greatest(cupos_disponibles - v_inscritos, 0)
         where id = v_match.id
        returning * into v_match;
    end if;

    update public.club_challenges
       set estado = 'publicado', match_id = v_match.id
     where id = v_row.id and estado = 'esperando_aprobacion'
    returning * into v_row;
    if not found then
        raise exception 'Este desafío no está esperando aprobación' using errcode = 'check_violation';
    end if;

    insert into public.club_challenge_events (challenge_id, tipo, actor_id, club_id, payload)
    values (v_row.id, 'partido_publicado', v_me, v_club,
        jsonb_build_object('proposal_id', v_prop.id, 'match_id', v_match.id,
            'fecha', v_match.hora, 'cancha_nombre', v_match.cancha_nombre,
            'comuna', v_match.comuna, 'cupos_por_club', v_match.cupos_por_club,
            -- Auditable: quién se autorizó a sí mismo, si se aplicó y,
            -- si no, por qué.
            'proponente_juega', v_prop.proponente_juega,
            'proponente_inscrito', v_prop_inscrito,
            'proponente_motivo', v_prop_motivo,
            'aprobador_juega', coalesce(p_me_inscribo, false),
            'aprobador_inscrito', v_aprob_inscrito,
            'aprobador_motivo', v_aprob_motivo));

    -- Aviso a quien pidió cupo y no lo obtuvo. Sólo a esa persona, y
    -- sólo cuando de verdad se omitió: nada de ruido para quien dijo
    -- «No» o para quien sí quedó dentro.
    if v_prop.proponente_juega and not v_prop_inscrito and v_prop.creada_por is not null then
        insert into public.notifications (user_id, type, title, body, data)
        values (v_prop.creada_por, 'club_match_reserva_omitida',
                'El partido fue publicado, pero no pudimos incluirte',
                'No pudimos incluirte porque ' || coalesce(v_prop_motivo, 'no pudimos incluirte')
                    || '. Puedes inscribirte cuando se resuelva.',
                jsonb_build_object('matchId', v_match.id, 'challengeId', v_row.id,
                                   'motivo', v_prop_motivo));
    end if;
    if coalesce(p_me_inscribo, false) and not v_aprob_inscrito then
        insert into public.notifications (user_id, type, title, body, data)
        values (v_me, 'club_match_reserva_omitida',
                'El partido fue publicado, pero no pudimos incluirte',
                'No pudimos incluirte porque ' || coalesce(v_aprob_motivo, 'no pudimos incluirte')
                    || '. Puedes inscribirte cuando se resuelva.',
                jsonb_build_object('matchId', v_match.id, 'challengeId', v_row.id,
                                   'motivo', v_aprob_motivo));
    end if;

    insert into public.notifications (user_id, type, title, body, data)
    select distinct m.user_id, 'club_match_published',
        '⚽ ' || coalesce(v_local, 'Club local') || ' vs ' || coalesce(v_visita, 'Club visitante'),
        'El partido ya está publicado. Quedan ' || v_match.cupos_por_club
            || ' cupos por club: entra a inscribirte.',
        jsonb_build_object('challengeId', v_row.id,
            'clubRetadorId', v_row.club_retador_id, 'clubRetadoId', v_row.club_retado_id,
            'matchId', v_match.id, 'proposalId', v_prop.id,
            'threadKey', 'challenge:' || v_row.id::text)
      from public.club_members m
     where m.club_id in (v_row.club_retador_id, v_row.club_retado_id);

    return v_match;
end;
$$;

revoke execute on function public.aprobar_propuesta(uuid, boolean) from public, anon;
grant execute on function public.aprobar_propuesta(uuid, boolean) to authenticated;
