-- =============================================================
-- FutFinder — migración 44b: ubicación exacta protegida y
-- ubicación aproximada pública para poder descubrir el partido
--
-- EL PROBLEMA, EN DOS CAMINOS DISTINTOS.
--
--   1. `matches` tiene `matches_read_all` con `using (true)`. Mientras
--      la ubicación vivía en `club_challenge_proposals` la protegía su
--      RLS, pero `aprobar_propuesta` la copiaba a `matches` al
--      publicar: desde ese instante `direccion`, `latitud` y `longitud`
--      quedaban legibles por cualquiera —incluido `anon`— vía
--      PostgREST.
--
--   2. Peor: `tg_register_cancha` se dispara AFTER INSERT sobre
--      `matches` y copia cancha, dirección y coordenadas a la tabla
--      pública `canchas`, que es de lectura libre y se consulta con
--      `search_canchas()`, ejecutable por `anon`. La dirección del
--      partido de clubes ya estaba, además, en un buscador público.
--
-- LA DECISIÓN: separar exacto de aproximado, no esconder el partido.
--
--   * La ubicación EXACTA (calle y punto) sale de `matches` y pasa a
--     `club_match_locations`, con RLS para los integrantes de los dos
--     clubes.
--   * `matches.latitud`/`longitud` conservan una ubicación APROXIMADA,
--     pública, marcada con `ubicacion_aproximada = true`. Sirve para
--     descubrir el partido —listas, mapa, filtros por zona y por
--     distancia— sin decir dónde es exactamente.
--   * `matches.direccion` queda en NULL: la calle no se aproxima, se
--     omite.
--
-- POR QUÉ LA APROXIMACIÓN VA EN LAS MISMAS COLUMNAS. Todo el
-- descubrimiento lee `matches.latitud`/`longitud` directo:
-- `listMatchesInBounds` (consulta por cuadrante), `applyFilters`
-- (distancia y radio), los marcadores del mapa y el radio de Inicio.
-- Poniendo ahí la aproximación, esas cuatro rutas siguen funcionando
-- sin tocarlas y SIN UNA CONSULTA POR TARJETA, que era el requisito.
-- Una columna aparte habría obligado a cambiar las cuatro y a
-- arrastrar el riesgo de que alguna se quedara leyendo la vieja.
--
-- PRECISIÓN: se redondea a 0,01°, o sea una celda de rejilla de
--   · latitud:  0,01° ≈ 1,11 km
--   · longitud: 0,01° ≈ 0,93 km en Santiago (−33,45°)
-- El punto real está en algún lugar de esa celda, así que la distancia
-- que ve alguien de fuera puede errar hasta ~0,73 km (media diagonal).
-- Para decidir «me queda cerca» sobra; para llegar a la puerta, no
-- sirve, que es justamente la intención.
--
-- SOBRE RECONSTRUIR EL PUNTO EXACTO: se guarda el nodo de la rejilla,
-- no un desplazamiento aleatorio. Un desplazamiento aleatorio guardado
-- una sola vez sería equivalente, pero puede caer en otra comuna y
-- romper el filtro por zona. Con la rejilla, quien mira sabe la celda
-- —~1 km²— y nada más; y como el valor es determinista, no se puede
-- promediar entre lecturas para afinarlo.
--
-- ALCANCE: `challenge_proposal_id is not null`, exactamente los
-- partidos que crea `aprobar_propuesta`. Los partidos de clubes del
-- flujo antiguo (migración 27) no pasaron por una propuesta protegida y
-- su dirección siempre fue pública; cambiarles el trato ahora sería
-- alterar partidos existentes sin que nadie lo pidiera.
--
-- LOS PARTIDOS NORMALES NO CAMBIAN: dirección y coordenadas exactas en
-- `matches`, `ubicacion_aproximada = false`, y siguen registrando su
-- cancha en `canchas`.
-- =============================================================

-- ── 1. LA TABLA PROTEGIDA ───────────────────────────────────────
create table if not exists public.club_match_locations (
    match_id   uuid primary key references public.matches(id) on delete cascade,
    direccion  text not null,
    latitud    numeric(10,7) not null check (latitud between -90 and 90),
    longitud   numeric(10,7) not null check (longitud between -180 and 180),
    created_at timestamptz not null default now()
);

alter table public.club_match_locations enable row level security;

-- ÚNICA política, y es de lectura: la escriben sólo las funciones
-- `security definer`, que corren como el dueño y no pasan por RLS. Sin
-- políticas de insert/update/delete, nadie puede crear una fila ni
-- moverle las coordenadas a un partido ajeno.
drop policy if exists club_match_locations_read on public.club_match_locations;
create policy club_match_locations_read on public.club_match_locations
    for select
    using (
        exists (
            select 1
              from public.matches m
              join public.club_members cm
                on cm.user_id = auth.uid()
               and cm.club_id in (m.club_local_id, m.club_visitante_id)
             where m.id = club_match_locations.match_id
        )
    );

revoke insert, update, delete on public.club_match_locations from anon, authenticated;

comment on table public.club_match_locations is
    'Ubicación EXACTA de los partidos nacidos de un desafío entre clubes. Sólo la leen los integrantes de los dos clubes; la escriben únicamente las RPC security definer. La aproximada, pública, vive en matches.';

-- ── 2. LA MARCA DE «ESTO ES APROXIMADO» ─────────────────────────
-- Sin ella la interfaz no puede distinguir un punto exacto de uno
-- redondeado, y mostraría «a 2,3 km de ti» con una precisión que no
-- tiene.
alter table public.matches
    add column if not exists ubicacion_aproximada boolean not null default false;

comment on column public.matches.ubicacion_aproximada is
    'true = latitud/longitud son una aproximación pública (rejilla de 0,01°), no el punto exacto. La interfaz debe decirlo.';

-- ── 3. LA REGLA DE APROXIMACIÓN, EN UN SOLO SITIO ───────────────
-- Escrita una vez para que la migración de datos y `aprobar_propuesta`
-- no puedan divergir. `immutable`: mismo grado dentro, mismo nodo
-- fuera, siempre.
create or replace function public.aproximar_grado(p_grado numeric)
returns numeric
language sql
immutable
as $$
    -- 0,01° ≈ 1,11 km de latitud y ≈ 0,93 km de longitud en Santiago.
    select round(p_grado, 2);
$$;

comment on function public.aproximar_grado(numeric) is
    'Redondea una coordenada a la rejilla pública de 0,01° (~1 km). Se usa para la ubicación aproximada de los partidos de clubes.';

-- ── 4. MIGRAR LO QUE YA ESTÁ PUBLICADO ──────────────────────────
-- Primero se copia la exacta a la tabla protegida y sólo después se
-- reemplaza por la aproximada en `matches`.
insert into public.club_match_locations (match_id, direccion, latitud, longitud)
select m.id, m.direccion, m.latitud, m.longitud
  from public.matches m
 where m.challenge_proposal_id is not null
   and m.direccion is not null
   and m.latitud is not null
   and m.longitud is not null
on conflict (match_id) do nothing;

-- Red de seguridad: si algún partido de clubes no tuviera ubicación que
-- copiar, la migración se detiene antes de tocar nada.
do $$
declare
    v_faltan integer;
begin
    select count(*) into v_faltan
      from public.matches m
     where m.challenge_proposal_id is not null
       and not exists (select 1 from public.club_match_locations l where l.match_id = m.id);
    if v_faltan > 0 then
        raise exception
            'Hay % partido(s) de clubes sin ubicación que copiar: revisar antes de continuar', v_faltan;
    end if;
end;
$$;

-- La calle se omite; el punto se redondea. `latitud`/`longitud` siguen
-- siendo NOT NULL —no hace falta soltar la restricción— porque el
-- partido conserva una ubicación, sólo que aproximada.
update public.matches m
   set direccion            = null,
       latitud              = public.aproximar_grado(l.latitud),
       longitud             = public.aproximar_grado(l.longitud),
       ubicacion_aproximada = true
  from public.club_match_locations l
 where l.match_id = m.id
   and m.challenge_proposal_id is not null;

-- ── 5. LIMPIAR LO QUE YA SE FILTRÓ A `canchas` ──────────────────
-- `tg_register_cancha` ya copió la dirección exacta de los partidos de
-- clubes publicados a la tabla pública. Se borran SÓLO las filas que no
-- usa ningún partido normal: una cancha compartida con un partido
-- normal es información legítimamente pública y no se toca.
delete from public.canchas c
 where exists (
        select 1 from public.matches m
         where m.challenge_proposal_id is not null
           and m.cancha_nombre = c.nombre
           and m.comuna = c.comuna
       )
   and not exists (
        select 1 from public.matches m
         where m.challenge_proposal_id is null
           and m.cancha_nombre = c.nombre
           and m.comuna = c.comuna
       );

-- ── 6. LA CANCHA DE UN PARTIDO DE CLUBES NO SE REGISTRA ─────────
-- Ni la exacta ni la aproximada: meter un punto redondeado en el
-- buscador público de canchas ensuciaría el buscador con una ubicación
-- que no es la de ninguna cancha real.
create or replace function public.tg_register_cancha()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.challenge_proposal_id is not null then return new; end if;

  if new.cancha_nombre is null or trim(new.cancha_nombre) = '' then return new; end if;
  if new.latitud is null or new.longitud is null then return new; end if;

  insert into public.canchas (nombre, direccion, comuna, region, latitud, longitud, created_by)
  values (new.cancha_nombre, new.direccion, new.comuna, new.region,
          new.latitud, new.longitud, new.id_organizador)
  on conflict (nombre_norm, comuna) do update
    set usos_count = canchas.usos_count + 1,
        updated_at = now(),
        latitud   = coalesce(canchas.latitud,   excluded.latitud),
        longitud  = coalesce(canchas.longitud,  excluded.longitud),
        direccion = coalesce(canchas.direccion, excluded.direccion),
        region    = coalesce(canchas.region,    excluded.region);
  return new;
end;
$$;

-- ── 7. EL GPS USA LA UBICACIÓN EXACTA, Y SÓLO ESA ───────────────
-- En un partido de clubes NO puede caer en `matches.latitud`: ahí hay
-- un punto redondeado a ~1 km, y confirmar asistencia contra él dejaría
-- marcarse presente desde una cuadra de distancia. O se resuelve la
-- protegida, o no se confirma.
--
-- No filtra nada: sigue devolviendo sólo la distancia a la posición que
-- el propio usuario declara, nunca las coordenadas de la cancha, y
-- exige estar inscrito.
create or replace function public.confirm_attendance_gps(
    p_match_id uuid, p_user_lat numeric, p_user_lng numeric
)
returns json
language plpgsql
security definer
set search_path = public
as $$
DECLARE
    v_match        record;
    v_attendance   record;
    v_distance     numeric;
    v_lat          numeric;
    v_lng          numeric;
    v_within_window boolean;
    v_window_end   timestamptz;
    v_user_id      uuid := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN
        RETURN json_build_object('ok', false, 'reason', 'No autenticado');
    END IF;

    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
    IF v_match IS NULL THEN
        RETURN json_build_object('ok', false, 'reason', 'Partido no existe');
    END IF;

    SELECT * INTO v_attendance
    FROM public.attendees
    WHERE id_partido = p_match_id AND id_jugador = v_user_id;

    IF v_attendance IS NULL THEN
        RETURN json_build_object('ok', false, 'reason', 'No estás inscrito en este partido');
    END IF;

    IF v_attendance.estado = 'confirmado_gps' THEN
        RETURN json_build_object('ok', true, 'reason', 'Ya estaba confirmado', 'already', true);
    END IF;

    IF v_match.challenge_proposal_id IS NOT NULL THEN
        -- Partido de clubes: EXCLUSIVAMENTE la ubicación protegida.
        SELECT l.latitud, l.longitud INTO v_lat, v_lng
          FROM public.club_match_locations l
         WHERE l.match_id = p_match_id;
    ELSE
        v_lat := v_match.latitud;
        v_lng := v_match.longitud;
    END IF;

    -- Falla cerrada: sin ubicación exacta no hay nada que comprobar, y
    -- dejar pasar sería peor que negar.
    IF v_lat IS NULL OR v_lng IS NULL THEN
        RETURN json_build_object(
            'ok', false,
            'reason', 'Este partido no tiene ubicación guardada, así que no podemos confirmar por GPS'
        );
    END IF;

    v_distance := public.haversine_meters(v_lat, v_lng, p_user_lat, p_user_lng);

    v_window_end := v_match.hora
        + (COALESCE(v_match.duracion_min, 90) || ' minutes')::interval
        + interval '30 minutes';
    v_within_window := now() BETWEEN (v_match.hora - interval '30 minutes')
                                 AND v_window_end;

    IF v_distance IS NULL OR v_distance > 200 THEN
        RETURN json_build_object(
            'ok', false,
            'reason', 'Estás demasiado lejos de la cancha',
            'distance', v_distance
        );
    END IF;

    IF NOT v_within_window THEN
        RETURN json_build_object(
            'ok', false,
            'reason', 'Fuera de la ventana de confirmación (30 min antes / hasta 30 min después de terminar)',
            'distance', v_distance
        );
    END IF;

    UPDATE public.attendees
    SET estado = 'confirmado_gps',
        confirmado_at = now(),
        distancia_metros = v_distance
    WHERE id = v_attendance.id;

    UPDATE public.profiles
    SET trust_score             = LEAST(trust_score + 1, 100),
        asistencias_confirmadas = asistencias_confirmadas + 1
    WHERE id = v_user_id;

    INSERT INTO public.trust_score_history (user_id, change_amount, reason)
    VALUES (v_user_id, 1, 'Asistencia confirmada por GPS');

    RETURN json_build_object(
        'ok', true,
        'distance', v_distance,
        'reason', 'Asistencia confirmada por GPS'
    );
END;
$$;

-- ── 8. APROBAR PUBLICA LA APROXIMADA Y GUARDA LA EXACTA ─────────
-- Idéntica a la de la 44 salvo en la ubicación: el `matches` nace con
-- el punto redondeado y la marca puesta, y la exacta va a la tabla
-- protegida en la misma transacción. Si la inserción protegida fallara,
-- tampoco habría partido.
create or replace function public.aprobar_propuesta(p_proposal_id uuid)
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me        uuid := auth.uid();
    v_prop      public.club_challenge_proposals;
    v_row       public.club_challenges;
    v_match     public.matches;
    v_club      uuid;
    v_en_prop   boolean;
    v_local     text;
    v_visita    text;
    v_aprob     text;
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
     where m.user_id = v_me
       and m.rol = 'admin'
       and m.club_id in (v_row.club_retador_id, v_row.club_retado_id)
       and m.club_id <> v_prop.club_proponente_id
     limit 1;

    if v_club is null then
        raise exception 'Solo un administrador del club contrario puede aprobar la propuesta'
            using errcode = '42501';
    end if;

    select exists (
        select 1 from public.club_members m
         where m.user_id = v_me and m.club_id = v_prop.club_proponente_id
    ) into v_en_prop;

    if v_en_prop then
        raise exception 'No puedes aprobar una propuesta de un club al que perteneces'
            using errcode = '42501';
    end if;

    if v_prop.estado = 'aprobada' then
        select * into v_match from public.matches where challenge_proposal_id = v_prop.id;
        if found then
            return v_match;
        end if;
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
                   when 'seleccion_admin' then 'manual'
                   else 'inmediata'
               end;

    -- Sin calle y con el punto redondeado: es lo que puede ver
    -- cualquiera. La cancha, la comuna y la región siguen públicas
    -- porque son lo que hace falta para saber de qué partido se trata.
    insert into public.matches (
        id_organizador, titulo, region, comuna, cancha_nombre,
        latitud, longitud, ubicacion_aproximada,
        hora, duracion_min,
        cupos_totales, cupos_disponibles, cupos_por_club,
        precio_cuota, modalidad, descripcion,
        aprobacion, metodo_inscripcion,
        club_local_id, club_visitante_id, challenge_id, challenge_proposal_id
    )
    values (
        v_me,
        coalesce(v_local, 'Club local') || ' vs ' || coalesce(v_visita, 'Club visitante'),
        v_prop.region, v_prop.comuna, v_prop.cancha_nombre,
        public.aproximar_grado(v_prop.latitud::numeric(10,7)),
        public.aproximar_grado(v_prop.longitud::numeric(10,7)),
        true,
        v_prop.fecha, v_prop.duracion_min,
        v_prop.cupos_por_club * 2, v_prop.cupos_por_club * 2, v_prop.cupos_por_club,
        v_prop.cuota_por_persona, v_prop.modalidad, v_prop.instrucciones,
        v_aprob, v_prop.metodo_inscripcion,
        v_row.club_retador_id, v_row.club_retado_id, v_row.id, v_prop.id
    )
    returning * into v_match;

    -- La exacta, en la tabla protegida y en la misma transacción.
    insert into public.club_match_locations (match_id, direccion, latitud, longitud)
    values (
        v_match.id,
        v_prop.direccion,
        v_prop.latitud::numeric(10,7),
        v_prop.longitud::numeric(10,7)
    );

    update public.club_challenges
       set estado = 'publicado', match_id = v_match.id
     where id = v_row.id and estado = 'esperando_aprobacion'
    returning * into v_row;

    if not found then
        raise exception 'Este desafío no está esperando aprobación' using errcode = 'check_violation';
    end if;

    insert into public.club_challenge_events (challenge_id, tipo, actor_id, club_id, payload)
    values (
        v_row.id, 'partido_publicado', v_me, v_club,
        jsonb_build_object(
            'proposal_id',    v_prop.id,
            'match_id',       v_match.id,
            'fecha',          v_match.hora,
            'cancha_nombre',  v_match.cancha_nombre,
            'comuna',         v_match.comuna,
            'cupos_por_club', v_match.cupos_por_club
        )
    );

    insert into public.notifications (user_id, type, title, body, data)
    select distinct m.user_id,
           'club_match_published',
           '⚽ ' || coalesce(v_local, 'Club local') || ' vs ' || coalesce(v_visita, 'Club visitante'),
           'El partido ya está publicado. Quedan ' || v_match.cupos_por_club
               || ' cupos por club: entra a inscribirte.',
           jsonb_build_object(
               'challengeId',   v_row.id,
               'clubRetadorId', v_row.club_retador_id,
               'clubRetadoId',  v_row.club_retado_id,
               'matchId',       v_match.id,
               'proposalId',    v_prop.id,
               'threadKey',     'challenge:' || v_row.id::text
           )
      from public.club_members m
     where m.club_id in (v_row.club_retador_id, v_row.club_retado_id);

    return v_match;
end;
$$;

revoke execute on function public.aprobar_propuesta(uuid) from public, anon;
grant execute on function public.aprobar_propuesta(uuid) to authenticated;
