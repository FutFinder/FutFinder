-- =============================================================
-- FutFinder migration 43b: autorizar ANTES de resolver el token
-- =============================================================
-- Va aparte porque la 43 ya está aplicada, y editar una migración
-- aplicada es justo lo que prohíbe CLAUDE.md. Mismo caso que la 42b.
--
-- QUÉ ESTABA MAL. `crear_propuesta_oficial()` resolvía el reintento
-- idempotente en lo primero que hacía:
--
--     if p_client_token is not null then
--         select * into v_prop from club_challenge_proposals
--          where client_token = p_client_token;
--         if found then return v_prop; end if;   -- ← sin autorizar
--     end if;
--
-- Como la función es `security definer`, ese `return` temprano
-- entregaba la propuesta —dirección exacta, cuota, instrucciones— a
-- cualquier usuario autenticado que acertara un token, sin pasar por
-- `club_members` ni por la RLS de la tabla. La búsqueda tampoco ataba el
-- token al desafío pedido, así que un token válido servía para leer la
-- propuesta de un desafío ajeno.
--
-- Explotarlo exige adivinar un uuid, que no es realista. Pero la
-- diferencia entre «difícil de explotar» y «no se puede» es
-- precisamente esta comprobación, y el token lo genera el cliente: no
-- hay ninguna garantía sobre su entropía. La autorización nunca puede
-- depender de que un dato del cliente sea difícil de adivinar.
--
-- QUÉ CAMBIA. Dos cosas y nada más; el resto de la función es idéntico:
--   1. El reintento se resuelve DESPUÉS de derivar el club del usuario
--      desde `club_members`. Quien no administra ninguno de los dos
--      clubes recibe el mismo 42501 que recibiría sin token.
--   2. La búsqueda por token exige además `challenge_id = p_challenge_id`,
--      así que un token solo vale dentro del desafío para el que se
--      emitió.
--
-- La idempotencia no se pierde: el administrador que reintenta tras un
-- timeout de red sigue recibiendo la propuesta que ya había creado, en
-- vez de crear una segunda.
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

    -- AUTORIZACIÓN PRIMERO. Todo lo que sigue —incluido el reintento
    -- idempotente— solo ocurre para un administrador vigente de alguno
    -- de los dos clubes.
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

    -- Reintento con el mismo token, atado a ESTE desafío.
    if p_client_token is not null then
        select * into v_prop
          from public.club_challenge_proposals
         where client_token = p_client_token
           and challenge_id = p_challenge_id;
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
            (p_payload ->> 'latitud')::double precision,
            (p_payload ->> 'longitud')::double precision,
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
