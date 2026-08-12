-- =============================================================
-- FutFinder — migración 43c: la propuesta oficial exige ubicación
--
-- POR QUÉ EXISTE. `matches.latitud` y `matches.longitud` son NOT NULL,
-- pero `crear_propuesta_oficial()` (migración 43) acepta la propuesta
-- sin coordenadas y `ClubProposalScreen` no las capturaba. El
-- resultado era una propuesta que nacía IMPOSIBLE de aprobar: al
-- publicar el partido, la inserción reventaba contra el NOT NULL. Se
-- descubrió al escribir la migración 44, que es la que publica.
--
-- Va aparte porque la 43 ya está aplicada y `CLAUDE.md` prohíbe editar
-- una migración aplicada.
--
-- LO QUE SE VALIDA, Y POR QUÉ ASÍ:
--
--   * `jsonb_typeof(...) = 'number'` antes de convertir. Un
--     `(p_payload ->> 'latitud')::double precision` sobre el texto
--     "abc" sale con un error de conversión de PostgreSQL en inglés,
--     no con un motivo que se pueda mostrar en pantalla.
--   * Rango real de la Tierra, el mismo CHECK que ya tiene `matches`.
--     No basta con «no es nula»: el cliente enviaba 0 y 0 cuando no
--     había ubicación, porque `Number(null)` es 0 en JavaScript. Eso
--     pasaba una comprobación de nulidad y publicaba el partido en
--     medio del Atlántico. El cliente ya está corregido; el servidor no
--     depende de ello.
--
-- LO QUE NO CAMBIA: el resto de la función es idéntico a la 43. La
-- política de lectura de `club_challenge_proposals` tampoco se toca —
-- la dirección exacta la siguen viendo únicamente los integrantes de
-- los dos clubes, que es justo para lo que está.
-- =============================================================

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

    select * into v_row
      from public.club_challenges
     where id = p_challenge_id
     for update;

    if not found then
        raise exception 'Este desafío ya no existe' using errcode = 'no_data_found';
    end if;

    select m.club_id into v_club
      from public.club_members m
     where m.user_id = v_me
       and m.rol = 'admin'
       and m.club_id in (v_row.club_retador_id, v_row.club_retado_id)
     limit 1;

    if v_club is null then
        raise exception 'Solo un administrador de alguno de los dos clubes puede proponer'
            using errcode = '42501';
    end if;

    -- Reintento con el mismo token: se devuelve lo que ya existe. Va
    -- DESPUÉS de autorizar y atado al desafío pedido; ése fue el arreglo
    -- de la 43b y aquí se conserva igual.
    if p_client_token is not null then
        select * into v_prop
          from public.club_challenge_proposals
         where client_token = p_client_token
           and challenge_id = v_row.id;
        if found then
            return v_prop;
        end if;
    end if;

    if v_row.estado <> 'negociacion' then
        raise exception 'Este desafío no está en negociación' using errcode = 'check_violation';
    end if;
    if v_row.prorroga_abierta_at is not null and v_row.prorroga_vence_at <= now() then
        raise exception 'La prórroga ya venció' using errcode = 'check_violation';
    end if;

    -- ── validación del contenido ────────────────────────────────
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

    -- ── NUEVO EN LA 43c: la ubicación en el mapa ────────────────
    -- `is distinct from` y no `<>`: cuando la clave NO viene en el
    -- payload, `p_payload -> 'latitud'` es NULL de SQL y
    -- `jsonb_typeof(NULL)` también, así que `NULL <> 'number'` vale
    -- NULL y el `if` no dispara. Es decir, con `<>` la comprobación
    -- dejaba pasar justamente el caso que más importa: el de la clave
    -- ausente. Lo cazó el caso 1 de la prueba 43c.
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
        select jsonb_array_elements_text(v_reglas -> 'metodos_inscripcion')
    ) then
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

    -- ── alta ────────────────────────────────────────────────────
    begin
        insert into public.club_challenge_proposals (
            challenge_id, club_proponente_id, creada_por,
            fecha, duracion_min, direccion, cancha_nombre, comuna, region,
            latitud, longitud, modalidad, cupos_por_club, metodo_inscripcion,
            cuota_por_persona, instrucciones, client_token
        )
        values (
            v_row.id, v_club, v_me,
            v_fecha, v_dur,
            trim(p_payload ->> 'direccion'),
            trim(p_payload ->> 'cancha_nombre'),
            trim(p_payload ->> 'comuna'),
            trim(p_payload ->> 'region'),
            v_lat, v_lng,
            p_payload ->> 'modalidad',
            v_cupos,
            p_payload ->> 'metodo_inscripcion',
            v_cuota,
            nullif(trim(coalesce(p_payload ->> 'instrucciones', '')), ''),
            p_client_token
        )
        returning * into v_prop;
    exception when unique_violation then
        raise exception 'Ya hay una propuesta oficial esperando respuesta'
            using errcode = 'unique_violation';
    end;

    -- Proponer durante la prórroga la cierra: mandar una propuesta
    -- oficial es la señal más clara de que el partido sí se va a
    -- disputar. Igual que en la 43.
    update public.club_challenges
       set estado               = 'esperando_aprobacion',
           prorroga_abierta_at  = null,
           prorroga_vence_at    = null,
           negociacion_vence_at = case
               when prorroga_abierta_at is not null
                   then now() + make_interval(hours => (v_reglas ->> 'negociacion_horas')::int)
               else negociacion_vence_at
           end
     where id = v_row.id
       and estado = 'negociacion'
    returning * into v_row;

    if not found then
        raise exception 'Este desafío no está en negociación' using errcode = 'check_violation';
    end if;

    delete from public.club_challenge_extension_replies
     where challenge_id = v_row.id;

    select nombre into v_nombre from public.clubs where id = v_club;

    insert into public.club_challenge_events (challenge_id, tipo, actor_id, club_id, payload)
    values (
        v_row.id,
        'propuesta_creada',
        v_me,
        v_club,
        jsonb_build_object(
            'proposal_id', v_prop.id,
            'fecha', v_prop.fecha,
            'cancha_nombre', v_prop.cancha_nombre,
            'comuna', v_prop.comuna,
            'cupos_por_club', v_prop.cupos_por_club
        )
    );

    perform public.desafio_avisar(
        v_row,
        'club_challenge_proposal',
        '📋 Propuesta oficial de ' || coalesce(v_nombre, 'el club rival'),
        'Revisa cancha, fecha, cupos y cuota. El partido se publica cuando el club contrario la apruebe.',
        array[v_row.club_retador_id, v_row.club_retado_id],
        v_me,
        jsonb_build_object('proposalId', v_prop.id)
    );

    return v_prop;
end;
$$;

revoke execute on function public.crear_propuesta_oficial(uuid, jsonb, uuid) from public, anon;
grant execute on function public.crear_propuesta_oficial(uuid, jsonb, uuid) to authenticated;
