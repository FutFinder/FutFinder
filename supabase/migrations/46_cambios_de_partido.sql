-- =============================================================
-- FutFinder — migración 46: cambios negociados del partido de clubes.
--
-- QUÉ HACE: publicado el partido, ninguno de los dos clubes lo edita
-- por su cuenta. Pide un cambio, y el club contrario lo acepta o lo
-- rechaza. Hasta que alguien acepta, el partido no se mueve.
--
-- POR QUÉ UNA TABLA Y NO UN `update`. La alternativa era dejar que un
-- administrador editara el partido y avisara después. Eso convierte un
-- acuerdo entre dos clubes en una decisión unilateral del que llegue
-- primero, y deja al rival organizando a su gente para una hora que ya
-- no existe. La solicitud vive aparte precisamente para que el valor
-- vigente siga siendo el acordado mientras se negocia.
--
-- LAS CUATRO GARANTÍAS, Y DÓNDE VIVEN:
--
--   1. EL PLAZO LO CALCULA POSTGRESQL. `v_match.hora - interval '2
--      hours' <= now()`, con el `now()` del servidor. El reloj del
--      teléfono no puede regalar ni quitar margen. Y se mira DOS veces:
--      al pedir el cambio y al responderlo, porque entre una cosa y la
--      otra pasa tiempo real.
--   2. RESPONDE EL CLUB CONTRARIO. Tres condiciones, no una: ser
--      administrador de un club del partido distinto al proponente, NO
--      pertenecer al club proponente en ningún rol (la regla estricta
--      que la 43d puso en `rechazar_propuesta`), y no ser quien pidió
--      el cambio. La tercera parece implicada por las otras dos, pero
--      es la que se lee en el enunciado y la que da el mensaje exacto.
--   3. UNA SOLICITUD PENDIENTE POR PARTIDO. Índice único parcial, no
--      una comprobación en código: dos administradores pidiendo cambios
--      a la vez no pueden abrir dos negociaciones sobre el mismo
--      partido.
--   4. RECHAZAR NO TOCA NADA. El `update` de `matches` vive sólo en la
--      rama de aceptación.
--
-- CONCURRENCIA. Tres piezas, todas de la base y ninguna de código:
-- `select ... for update` sobre la fila del partido serializa cualquier
-- par de llamadas sobre el mismo partido; el índice único parcial
-- `club_match_changes_pendiente_uidx` impide que existan dos
-- solicitudes pendientes aunque dos administradores pulsen a la vez; y
-- el `update ... where estado = 'pendiente'` es el que decide quién
-- responde cuando dos lo intentan —el segundo no mueve ninguna fila y
-- sale sin aplicar nada—. LIMITACIÓN CONOCIDA: el arnés
-- `46_cambios_de_partido_test.sql` corre en UNA sesión, así que prueba
-- el invariante y no la carrera real; una prueba de carrera de verdad
-- necesita dos sesiones SQL simultáneas, como la que se hizo en U3.
--
-- DEUDA APARTE, NO DE ESTA MIGRACIÓN: el par de coordenadas (0, 0) se
-- acepta acá por rango, igual que en la 43c y la 44, aunque en esta app
-- nunca es una cancha sino la marca de que no se eligió ninguna. El
-- cliente sí lo rechaza. Cerrarlo en el servidor toca las tres
-- funciones a la vez y está anotado en
-- `docs/memoria/operacion/pendientes.md`.
--
-- LA UBICACIÓN SIGUE PARTIDA EN DOS (44b/44d). Si el cambio acordado
-- es de cancha, la calle y el punto exacto van a `club_match_locations`
-- y `matches` recibe únicamente el punto aproximado, con `direccion` en
-- NULL. Aceptar un cambio no puede ser la puerta por la que la
-- dirección exacta vuelve a la tabla de lectura amplia.
--
-- QUÉ SE NEGOCIA: la hora, la cancha y la cuota. Los cupos por club y
-- el método de inscripción NO, y no es un olvido: bajar los cupos con
-- gente ya inscrita obliga a decidir a quién se deja fuera, y cambiar
-- el método a mitad de camino convierte inscritos en postulantes.
-- Cuando esas dos cosas hagan falta, necesitan sus propias reglas.
--
-- COMPATIBILIDAD: un partido normal (`challenge_proposal_id is null`)
-- no entra por acá; las dos RPC lo rechazan explícitamente. La única
-- función existente que se toca es `notify_match_updated`, y sólo para
-- que el aviso a los inscritos diga la verdad en un partido de clubes
-- (ver sección 6).
-- =============================================================

-- ── 1. LA SOLICITUD DE CAMBIO ───────────────────────────────────
-- `campos` guarda lo PROPUESTO y `valores_anteriores` lo que estaba
-- vigente al pedirlo. Los dos, y no sólo el primero: el evento del chat
-- tiene que poder decir «de 17:00 a 18:00» meses después, cuando el
-- partido ya cambió otras tres veces.
create table if not exists public.club_match_changes (
    id                 uuid primary key default gen_random_uuid(),
    match_id           uuid not null references public.matches(id) on delete cascade,
    challenge_id       uuid not null references public.club_challenges(id) on delete cascade,
    club_proponente_id uuid not null references public.clubs(id) on delete cascade,
    propuesto_por      uuid references auth.users(id) on delete set null,
    campos             jsonb not null,
    valores_anteriores jsonb not null default '{}'::jsonb,
    estado             text  not null default 'pendiente',
    -- Motivo del rechazo, OPCIONAL. Obligarlo sólo consigue que la gente
    -- escriba «no» para poder pulsar el botón, y un motivo falso es peor
    -- que ninguno: el club que pidió el cambio se queda igual de a
    -- oscuras pero creyendo que le explicaron algo.
    motivo             text,
    respondida_por     uuid references auth.users(id) on delete set null,
    respondida_at      timestamptz,
    client_token       uuid,
    created_at         timestamptz not null default now()
);

alter table public.club_match_changes
    drop constraint if exists club_match_changes_estado_check;
alter table public.club_match_changes
    add constraint club_match_changes_estado_check
    check (estado in ('pendiente', 'aceptado', 'rechazado', 'caducado'));

alter table public.club_match_changes
    drop constraint if exists club_match_changes_campos_check;
alter table public.club_match_changes
    add constraint club_match_changes_campos_check
    check (jsonb_typeof(campos) = 'object' and campos <> '{}'::jsonb);

-- El motivo se guarda ya recortado o en NULL: un motivo de espacios en
-- blanco se leería en el chat como un rechazo «con explicación» vacía.
alter table public.club_match_changes
    drop constraint if exists club_match_changes_motivo_check;
alter table public.club_match_changes
    add constraint club_match_changes_motivo_check
    check (motivo is null or (length(motivo) between 1 and 300));

-- ÉSTA es la garantía de que no hay dos negociaciones abiertas sobre el
-- mismo partido, no un `if` dentro de la función.
drop index if exists club_match_changes_pendiente_uidx;
create unique index club_match_changes_pendiente_uidx
    on public.club_match_changes (match_id)
    where estado = 'pendiente';

-- Doble pulsación: el mismo token devuelve la solicitud que ya existe.
drop index if exists club_match_changes_token_uidx;
create unique index club_match_changes_token_uidx
    on public.club_match_changes (match_id, client_token)
    where client_token is not null;

create index if not exists idx_club_match_changes_match
    on public.club_match_changes (match_id, created_at desc);

comment on table public.club_match_changes is
    'Solicitudes de cambio de un partido de clubes. Mientras el estado es «pendiente» el partido conserva sus valores: sólo `responder_cambio_partido(id, true)` los aplica.';
comment on column public.club_match_changes.valores_anteriores is
    'Los valores vigentes en el momento de pedir el cambio. Se guardan para que el evento del chat siga siendo legible cuando el partido ya haya cambiado otras veces.';

-- ── 2. QUIÉN LA VE ──────────────────────────────────────────────
-- Los integrantes de los dos clubes, con o sin rol: la regla de la 44d
-- es que el partido existe para los integrantes, no sólo para los
-- administradores. Responder sigue siendo cosa de administradores, pero
-- eso lo decide la RPC, no la lectura.
--
-- SIN POLÍTICAS DE ESCRITURA, igual que `club_challenge_proposals` y
-- `club_match_locations`: la tabla la escriben únicamente las RPC
-- `security definer`.
alter table public.club_match_changes enable row level security;

drop policy if exists club_match_changes_read on public.club_match_changes;
create policy club_match_changes_read on public.club_match_changes
    for select
    using (
        exists (
            select 1
              from public.matches m
              join public.club_members cm
                on cm.user_id = auth.uid()
               and (cm.club_id = m.club_local_id or cm.club_id = m.club_visitante_id)
             where m.id = club_match_changes.match_id
        )
    );

grant select on public.club_match_changes to authenticated;
revoke insert, update, delete on public.club_match_changes from public, anon, authenticated;
revoke select on public.club_match_changes from anon;

-- ── 3. DOS AVISOS NUEVOS ────────────────────────────────────────
-- `club_match_change` va a los administradores que tienen que
-- responder; `club_match_change_responded`, a los que pidieron el
-- cambio. A los INSCRITOS no les avisa ninguno de los dos: cuando el
-- cambio se aplica, el que les avisa es `match_updated`, el mismo aviso
-- que reciben en cualquier partido cuando cambia la hora o la cancha.
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
        'club_match_published', 'club_match_reserva_omitida',
        'club_match_change', 'club_match_change_responded'
    ));

-- ── 4. QUÉ SE PUEDE CAMBIAR, Y A QUÉ ────────────────────────────
-- Escrito aparte porque se usa DOS veces: al pedir el cambio y otra vez
-- al aceptarlo. Entre esos dos momentos el partido pudo moverse —otro
-- cambio aceptado, el paso del tiempo—, así que revalidar contra la
-- fila vigente no es paranoia: es la única forma de que aceptar no
-- aplique algo que ya no tiene sentido.
--
-- Devuelve `{ok:true, campos, antes, cambios}` o `{ok:false, reason}`.
-- `cambios` es la lista que lee el chat: campo, valor anterior y valor
-- propuesto.
--
-- `jsonb_typeof(x) is distinct from 'tipo'` y no `<> 'tipo'`: cuando la
-- clave no existe, `jsonb_typeof` vale NULL y el `if` no dispararía,
-- que es exactamente el fallo que las pruebas de la 44 encontraron.
create or replace function public.cambio_partido_revisa_campos(
    p_match  public.matches,
    p_campos jsonb
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
    v_clave  text;
    v_antes  jsonb := '{}'::jsonb;
    v_lista  jsonb := '[]'::jsonb;
    v_hora   timestamptz;
    v_num    numeric;
    v_cancha jsonb;
    v_lat    numeric;
    v_lon    numeric;
    v_exacta public.club_match_locations;
begin
    if p_campos is null or jsonb_typeof(p_campos) is distinct from 'object' then
        return jsonb_build_object('ok', false,
            'reason', 'No llegó ningún cambio que revisar');
    end if;
    if p_campos = '{}'::jsonb then
        return jsonb_build_object('ok', false,
            'reason', 'Elige al menos un dato que quieras cambiar');
    end if;

    for v_clave in select jsonb_object_keys(p_campos) loop
        if v_clave not in ('hora', 'cancha', 'cuota') then
            return jsonb_build_object('ok', false, 'reason',
                format('«%s» no se negocia acá: sólo la hora, la cancha y la cuota', v_clave));
        end if;
    end loop;

    -- ── la hora ─────────────────────────────────────────────────
    if p_campos ? 'hora' then
        if jsonb_typeof(p_campos -> 'hora') is distinct from 'string' then
            return jsonb_build_object('ok', false,
                'reason', 'La hora propuesta no llegó como fecha');
        end if;
        begin
            v_hora := (p_campos ->> 'hora')::timestamptz;
        exception when others then
            return jsonb_build_object('ok', false,
                'reason', 'La hora propuesta no es una fecha válida');
        end;
        -- El mismo margen que para pedir el cambio: mover el partido a
        -- dentro de una hora deja a la gente sin margen para reaccionar,
        -- y da igual que se acuerde con tres días de antelación.
        if v_hora <= now() + interval '2 hours' then
            return jsonb_build_object('ok', false,
                'reason', 'La hora propuesta tiene que estar al menos 2 horas más adelante');
        end if;
        if v_hora = p_match.hora then
            return jsonb_build_object('ok', false,
                'reason', 'La hora propuesta es la que el partido ya tiene');
        end if;
        v_antes := v_antes || jsonb_build_object('hora', p_match.hora);
        v_lista := v_lista || jsonb_build_array(jsonb_build_object(
            'campo', 'hora', 'antes', p_match.hora, 'despues', v_hora));
    end if;

    -- ── la cuota ────────────────────────────────────────────────
    if p_campos ? 'cuota' then
        if jsonb_typeof(p_campos -> 'cuota') is distinct from 'number' then
            return jsonb_build_object('ok', false,
                'reason', 'La cuota propuesta tiene que ser un número');
        end if;
        v_num := (p_campos ->> 'cuota')::numeric;
        if v_num <> trunc(v_num) or v_num < 0 or v_num > 1000000 then
            return jsonb_build_object('ok', false,
                'reason', 'La cuota propuesta tiene que ser un monto entero entre 0 y 1.000.000');
        end if;
        if v_num::integer = p_match.precio_cuota then
            return jsonb_build_object('ok', false,
                'reason', 'La cuota propuesta es la que el partido ya tiene');
        end if;
        v_antes := v_antes || jsonb_build_object('cuota', p_match.precio_cuota);
        v_lista := v_lista || jsonb_build_array(jsonb_build_object(
            'campo', 'cuota', 'antes', p_match.precio_cuota, 'despues', v_num::integer));
    end if;

    -- ── la cancha ───────────────────────────────────────────────
    -- Se piden los seis datos completos y no un parche: `matches`
    -- exige comuna y coordenadas NOT NULL, y `club_match_locations`
    -- exige calle y punto exacto. Media cancha no se puede aplicar.
    if p_campos ? 'cancha' then
        v_cancha := p_campos -> 'cancha';
        if jsonb_typeof(v_cancha) is distinct from 'object' then
            return jsonb_build_object('ok', false,
                'reason', 'La cancha propuesta no llegó completa');
        end if;

        foreach v_clave in array array['cancha_nombre', 'direccion', 'comuna', 'region'] loop
            if jsonb_typeof(v_cancha -> v_clave) is distinct from 'string'
               or length(trim(coalesce(v_cancha ->> v_clave, ''))) = 0 then
                return jsonb_build_object('ok', false, 'reason',
                    'La cancha propuesta necesita nombre, dirección, comuna y región');
            end if;
        end loop;

        -- El rango, no sólo la nulidad: el cliente llegó a mandar 0 y 0
        -- cuando no había ubicación, y `Number(null)` es 0 en
        -- JavaScript. Es el mismo agujero que cerró la 43c.
        if jsonb_typeof(v_cancha -> 'latitud') is distinct from 'number'
           or jsonb_typeof(v_cancha -> 'longitud') is distinct from 'number' then
            return jsonb_build_object('ok', false,
                'reason', 'La cancha propuesta necesita estar ubicada en el mapa');
        end if;
        v_lat := (v_cancha ->> 'latitud')::numeric;
        v_lon := (v_cancha ->> 'longitud')::numeric;
        if v_lat < -90 or v_lat > 90 or v_lon < -180 or v_lon > 180 then
            return jsonb_build_object('ok', false,
                'reason', 'La ubicación de la cancha propuesta no es un punto válido del mapa');
        end if;

        select * into v_exacta from public.club_match_locations where match_id = p_match.id;

        v_antes := v_antes || jsonb_build_object('cancha', jsonb_build_object(
            'cancha_nombre', p_match.cancha_nombre,
            'direccion',     v_exacta.direccion,
            'comuna',        p_match.comuna,
            'region',        p_match.region,
            'latitud',       v_exacta.latitud,
            'longitud',      v_exacta.longitud));

        -- En el evento del chat va el NOMBRE de la cancha y la comuna,
        -- nunca la calle: el evento se lee en el hilo y no tiene por qué
        -- repetir un dato que ya vive protegido en `club_match_locations`.
        v_lista := v_lista || jsonb_build_array(jsonb_build_object(
            'campo',          'cancha',
            'antes',          p_match.cancha_nombre,
            'despues',        v_cancha ->> 'cancha_nombre',
            'antes_comuna',   p_match.comuna,
            'despues_comuna', v_cancha ->> 'comuna'));
    end if;

    if v_lista = '[]'::jsonb then
        return jsonb_build_object('ok', false,
            'reason', 'Elige al menos un dato que quieras cambiar');
    end if;

    return jsonb_build_object('ok', true,
        'campos', p_campos, 'antes', v_antes, 'cambios', v_lista);
end;
$$;

revoke execute on function public.cambio_partido_revisa_campos(public.matches, jsonb)
    from public, anon, authenticated;

comment on function public.cambio_partido_revisa_campos(public.matches, jsonb) is
    'Ayudante interno: valida los campos negociables de un cambio contra el partido vigente y arma el antes/después que lee el chat. No es una RPC del cliente.';

-- ── 5. PEDIR EL CAMBIO ──────────────────────────────────────────
-- NO TOCA EL PARTIDO. Ni una columna. Lo único que hace es dejar la
-- solicitud, el evento del chat y el aviso al club que debe responder.
create or replace function public.proponer_cambio_partido(
    p_match_id     uuid,
    p_campos       jsonb,
    p_client_token uuid default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me     uuid := auth.uid();
    v_match  public.matches;
    v_row    public.club_challenges;
    v_clubes uuid[];
    v_club   uuid;
    v_rival  uuid;
    v_rev    jsonb;
    v_ya     public.club_match_changes;
    v_ch     public.club_match_changes;
    v_nombre text;
    v_user   text;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    -- El bloqueo primero, igual que en `join_club_match`: el plazo, el
    -- conteo de pendientes y la escritura ocurren con la fila tomada.
    select * into v_match from public.matches where id = p_match_id for update;
    if not found then
        return json_build_object('ok', false, 'reason', 'Partido no existe');
    end if;
    if v_match.challenge_proposal_id is null then
        return json_build_object('ok', false,
            'reason', 'Este no es un partido entre clubes');
    end if;
    if v_match.estado not in ('abierto', 'lleno') then
        return json_build_object('ok', false,
            'reason', 'Este partido ya no admite cambios');
    end if;

    -- ── el plazo, con el reloj del servidor ─────────────────────
    if v_match.hora - interval '2 hours' <= now() then
        return json_build_object('ok', false,
            'reason', 'Faltan menos de 2 horas para el partido: ya no se pueden pedir cambios');
    end if;

    -- ── autorización ────────────────────────────────────────────
    select array_agg(cm.club_id) into v_clubes
      from public.club_members cm
     where cm.user_id = v_me
       and cm.rol = 'admin'
       and cm.club_id in (v_match.club_local_id, v_match.club_visitante_id);

    if v_clubes is null then
        return json_build_object('ok', false,
            'reason', 'Solo un administrador de alguno de los dos clubes puede pedir cambios');
    end if;

    -- Quien administra LOS DOS clubes no puede pedir un cambio: no hay
    -- forma de decir en nombre de quién lo pide, y quien lo respondiera
    -- estaría respondiéndose a sí mismo. Es el mismo conflicto de doble
    -- pertenencia que cerró la 43d, un paso antes.
    if array_length(v_clubes, 1) > 1 then
        return json_build_object('ok', false,
            'reason', 'Administras los dos clubes de este partido: no puedes pedir un cambio en nombre de uno y responderlo en nombre del otro');
    end if;

    v_club  := v_clubes[1];
    v_rival := case when v_club = v_match.club_local_id
                    then v_match.club_visitante_id
                    else v_match.club_local_id end;

    -- ── idempotencia, DESPUÉS de autorizar ──────────────────────
    -- La 43b aprendió esto a golpes: una salida temprana por
    -- `client_token` antes de mirar `club_members` convierte una función
    -- `security definer` en una filtración para cualquiera que acierte
    -- un token.
    if p_client_token is not null then
        select * into v_ya from public.club_match_changes
         where match_id = p_match_id and client_token = p_client_token;
        if found then
            return json_build_object('ok', true, 'already', true,
                'changeId', v_ya.id, 'estado', v_ya.estado);
        end if;
    end if;

    if exists (select 1 from public.club_match_changes
                where match_id = p_match_id and estado = 'pendiente') then
        return json_build_object('ok', false,
            'reason', 'Ya hay una solicitud de cambio esperando respuesta');
    end if;

    v_rev := public.cambio_partido_revisa_campos(v_match, p_campos);
    if not (v_rev ->> 'ok')::boolean then
        return json_build_object('ok', false, 'reason', v_rev ->> 'reason');
    end if;

    select * into v_row from public.club_challenges where id = v_match.challenge_id;
    if not found then
        return json_build_object('ok', false,
            'reason', 'Este partido no tiene un desafío asociado');
    end if;

    insert into public.club_match_changes (
        match_id, challenge_id, club_proponente_id, propuesto_por,
        campos, valores_anteriores, client_token
    )
    values (
        p_match_id, v_row.id, v_club, v_me,
        v_rev -> 'campos', v_rev -> 'antes', p_client_token
    )
    returning * into v_ch;

    select nombre into v_nombre from public.clubs where id = v_club;

    -- El `username` sale de `profiles` DENTRO de la función, nunca del
    -- cliente: un nombre de actor que manda quien actúa se lo puede
    -- escribir solo. La auditoría de verdad es `actor_id`, que es una
    -- columna de la tabla y no un dato del payload.
    select username into v_user from public.profiles where id = v_me;

    -- El evento guarda DATOS, no una frase: el cliente arma el texto
    -- («Deportivo (@vicente) propone cambiar la hora de 17:00 a 18:00»)
    -- desde `cambios`. Así la redacción se corrige sin migrar filas.
    insert into public.club_challenge_events (challenge_id, tipo, actor_id, club_id, payload)
    values (v_row.id, 'cambio_propuesto', v_me, v_club,
        jsonb_build_object(
            'change_id',              v_ch.id,
            'match_id',               p_match_id,
            'club_proponente_id',     v_club,
            'club_proponente_nombre', coalesce(v_nombre, 'Un club'),
            'actor_id',               v_me,
            'actor_username',         v_user,
            'cambios',                v_rev -> 'cambios'));

    perform public.desafio_avisar(
        v_row,
        'club_match_change',
        'Piden cambiar el partido',
        coalesce(v_nombre, 'El club rival') || ' propone cambios en «'
            || coalesce(v_match.titulo, 'el partido') || '». Revísalos y responde.',
        array[v_rival],
        v_me,
        jsonb_build_object('matchId', p_match_id, 'changeId', v_ch.id),
        true);

    return json_build_object('ok', true,
        'changeId', v_ch.id, 'estado', v_ch.estado, 'cambios', v_rev -> 'cambios');
end;
$$;

revoke execute on function public.proponer_cambio_partido(uuid, jsonb, uuid) from public, anon;
grant execute on function public.proponer_cambio_partido(uuid, jsonb, uuid) to authenticated;

-- ── 6. EL AVISO A LOS INSCRITOS DICE LA VERDAD ──────────────────
-- `notify_match_updated` ya avisa a los inscritos cuando cambia la
-- hora, la cancha, la comuna o la cuota, y sigue siendo el aviso que
-- se usa acá: aceptar un cambio termina en un `update` de `matches`, y
-- el trigger se dispara solo. Se le añaden dos cosas, y sólo para los
-- partidos de clubes:
--
--   · El texto. «El organizador cambió la hora» es falso cuando el
--     cambio lo acordaron dos clubes; el organizador es sólo el
--     administrador que un día aprobó la propuesta.
--   · El destinatario. En un partido normal se excluye al organizador
--     porque es quien hizo el cambio. En uno de clubes no tiene por qué
--     serlo —puede aceptar el rival— y excluirlo le esconde un cambio
--     que le afecta.
--
-- En los partidos normales no cambia absolutamente nada.
create or replace function public.notify_match_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cambios text[] := array[]::text[];
    v_row     record;
    v_body    text;
    v_club    boolean := new.challenge_proposal_id is not null;
begin
    if new.estado = 'cancelado' then
        return new; -- la cancelación tiene su propio aviso
    end if;

    -- `array_append` y no `||`: con un literal sin tipo, `||` resuelve
    -- `anyarray || anyarray` e intenta leer el texto como arreglo (44c).
    if new.hora is distinct from old.hora then
        v_cambios := array_append(v_cambios, 'la fecha y hora');
    end if;
    if new.cancha_nombre is distinct from old.cancha_nombre then
        v_cambios := array_append(v_cambios, 'la cancha');
    end if;
    if new.comuna is distinct from old.comuna then
        v_cambios := array_append(v_cambios, 'la comuna');
    end if;
    if new.precio_cuota is distinct from old.precio_cuota then
        v_cambios := array_append(v_cambios, 'la cuota');
    end if;

    if array_length(v_cambios, 1) is null then
        return new;
    end if;

    if v_club then
        v_body := format('Los dos clubes acordaron cambiar %s de «%s».',
                         array_to_string(v_cambios, ', '), new.titulo);
    else
        v_body := format('El organizador cambió %s de «%s».',
                         array_to_string(v_cambios, ', '), new.titulo);
    end if;

    for v_row in
        select id_jugador from public.attendees
        where id_partido = new.id
          and estado in ('pendiente', 'inscrito', 'confirmado_gps')
          and (v_club or id_jugador <> new.id_organizador)
    loop
        insert into public.notifications (user_id, type, title, body, data)
        values (v_row.id_jugador, 'match_updated', 'Cambió tu partido', v_body,
                jsonb_build_object('matchId', new.id));
    end loop;

    return new;
end;
$$;

-- ── 7. RESPONDER EL CAMBIO ──────────────────────────────────────
-- Acepta o rechaza un administrador del club CONTRARIO. Rechazar deja
-- el partido exactamente como estaba; aceptar lo aplica y deja que el
-- trigger de arriba avise a los inscritos.
-- Una versión anterior de esta migración llevaba dos argumentos. Se
-- elimina antes de crear la de tres: con el valor por defecto, las dos
-- convivirían y `responder_cambio_partido(id, true)` quedaría ambigua.
drop function if exists public.responder_cambio_partido(uuid, boolean);

create or replace function public.responder_cambio_partido(
    p_change_id uuid,
    p_aceptar   boolean,
    p_motivo    text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me      uuid := auth.uid();
    v_ch      public.club_match_changes;
    v_match   public.matches;
    v_row     public.club_challenges;
    v_club    uuid;
    v_en_prop boolean;
    v_rev     jsonb;
    v_campos  jsonb;
    v_cancha  jsonb;
    v_nombre  text;
    v_user    text;
    v_titulo  text;
    v_motivo  text;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    select * into v_ch from public.club_match_changes where id = p_change_id;
    if not found then
        return json_build_object('ok', false, 'reason', 'Esa solicitud de cambio ya no existe');
    end if;

    -- Mismo orden de bloqueo que en todo el ciclo: primero la fila
    -- grande (el partido), después la chica. Si una función lo hiciera
    -- al revés, dos administradores actuando a la vez podrían trabarse.
    select * into v_match from public.matches where id = v_ch.match_id for update;
    if not found then
        return json_build_object('ok', false, 'reason', 'Partido no existe');
    end if;
    select * into v_ch from public.club_match_changes where id = p_change_id for update;

    -- ── autorización, antes de cualquier salida temprana ────────
    if v_ch.propuesto_por = v_me then
        return json_build_object('ok', false,
            'reason', 'No puedes responder tu propia solicitud: la responde el club contrario');
    end if;

    select cm.club_id into v_club
      from public.club_members cm
     where cm.user_id = v_me
       and cm.rol = 'admin'
       and cm.club_id in (v_match.club_local_id, v_match.club_visitante_id)
       and cm.club_id <> v_ch.club_proponente_id
     limit 1;

    if v_club is null then
        return json_build_object('ok', false,
            'reason', 'Solo un administrador del club contrario puede responder este cambio');
    end if;

    -- No pertenecer al club proponente EN NINGÚN ROL. Sin esto, quien
    -- está en los dos clubes se aprueba a sí mismo por la puerta de al
    -- lado (regla estricta de la 43d).
    select exists (
        select 1 from public.club_members cm
         where cm.user_id = v_me and cm.club_id = v_ch.club_proponente_id
    ) into v_en_prop;

    if v_en_prop then
        return json_build_object('ok', false,
            'reason', 'No puedes responder un cambio pedido por un club al que perteneces');
    end if;

    -- ── estado de la solicitud ──────────────────────────────────
    if v_ch.estado = 'caducado' then
        return json_build_object('ok', false,
            'reason', 'Esta solicitud caducó: el partido está a menos de 2 horas');
    end if;
    if v_ch.estado <> 'pendiente' then
        return json_build_object('ok', true, 'already', true, 'estado', v_ch.estado);
    end if;

    -- ── el plazo, otra vez ──────────────────────────────────────
    -- Se pidió con tiempo, pero el partido se fue acercando. A esta
    -- altura la gente ya salió de su casa: la solicitud caduca en vez de
    -- quedarse pendiente para siempre.
    if v_match.hora - interval '2 hours' <= now() then
        update public.club_match_changes
           set estado = 'caducado', respondida_at = now()
         where id = v_ch.id and estado = 'pendiente';
        return json_build_object('ok', false, 'caducado', true,
            'reason', 'Faltan menos de 2 horas para el partido: esta solicitud ya no puede aplicarse');
    end if;

    select * into v_row from public.club_challenges where id = v_ch.challenge_id;
    if not found then
        return json_build_object('ok', false, 'reason', 'Este partido no tiene un desafío asociado');
    end if;

    select nombre into v_nombre from public.clubs where id = v_club;
    select username into v_user from public.profiles where id = v_me;
    v_titulo := coalesce(v_match.titulo, 'el partido');

    -- Motivo recortado, y NULL cuando viene vacío o en blanco: un rechazo
    -- «con motivo» que en realidad son tres espacios se leería en el chat
    -- como una explicación que nadie dio.
    v_motivo := nullif(btrim(coalesce(p_motivo, '')), '');
    if v_motivo is not null then
        v_motivo := left(v_motivo, 300);
    end if;

    -- ── rechazar: no se toca el partido ─────────────────────────
    if not coalesce(p_aceptar, false) then
        update public.club_match_changes
           set estado = 'rechazado', respondida_por = v_me, respondida_at = now(),
               motivo = v_motivo
         where id = v_ch.id and estado = 'pendiente'
        returning * into v_ch;
        if not found then
            return json_build_object('ok', false, 'reason', 'Esta solicitud ya fue respondida');
        end if;

        insert into public.club_challenge_events (challenge_id, tipo, actor_id, club_id, payload)
        values (v_row.id, 'cambio_respondido', v_me, v_club,
            jsonb_build_object(
                'change_id',            v_ch.id,
                'match_id',             v_match.id,
                'aceptado',             false,
                'club_responde_id',     v_club,
                'club_responde_nombre', coalesce(v_nombre, 'Un club'),
                'actor_id',             v_me,
                'actor_username',       v_user,
                'motivo',               v_motivo,
                'cambios',              '[]'::jsonb));

        perform public.desafio_avisar(
            v_row,
            'club_match_change_responded',
            'Rechazaron el cambio',
            coalesce(v_nombre, 'El club rival') || ' rechazó el cambio que pidieron para «'
                || v_titulo || '». El partido sigue igual.'
                || coalesce(' Motivo: ' || v_motivo, ''),
            array[v_ch.club_proponente_id],
            v_me,
            jsonb_build_object('matchId', v_match.id, 'changeId', v_ch.id,
                               'aceptado', false, 'motivo', v_motivo),
            true);

        return json_build_object('ok', true, 'aceptado', false,
                                 'changeId', v_ch.id, 'motivo', v_motivo);
    end if;

    -- ── aceptar ─────────────────────────────────────────────────
    -- Se revalida contra el partido VIGENTE. Entre pedir y aceptar pudo
    -- pasar cualquier cosa, y una solicitud que ya no se puede aplicar
    -- caduca en vez de aplicarse a medias.
    v_rev := public.cambio_partido_revisa_campos(v_match, v_ch.campos);
    if not (v_rev ->> 'ok')::boolean then
        update public.club_match_changes
           set estado = 'caducado', respondida_at = now()
         where id = v_ch.id and estado = 'pendiente';
        return json_build_object('ok', false, 'caducado', true, 'reason', v_rev ->> 'reason');
    end if;

    -- Este `update` es el que serializa: dos administradores del club
    -- contrario aceptando a la vez compiten por él y sólo uno mueve la
    -- fila. Va ANTES de tocar el partido, para que el perdedor no
    -- aplique nada.
    update public.club_match_changes
       set estado = 'aceptado', respondida_por = v_me, respondida_at = now()
     where id = v_ch.id and estado = 'pendiente'
    returning * into v_ch;
    if not found then
        return json_build_object('ok', false, 'reason', 'Esta solicitud ya fue respondida');
    end if;

    v_campos := v_ch.campos;
    if v_campos ? 'cancha' then
        v_cancha := v_campos -> 'cancha';
    end if;

    -- UN SOLO `update`, aunque cambien tres cosas: `notify_match_updated`
    -- es AFTER UPDATE y así manda un aviso que las enumera, en vez de
    -- tres avisos seguidos por el mismo acuerdo.
    --
    -- `direccion` vuelve a NULL y el punto se guarda aproximado: la
    -- calle exacta no entra a `matches` ni siquiera por acá (44b/44d).
    update public.matches
       set hora = case when v_campos ? 'hora'
                       then (v_campos ->> 'hora')::timestamptz else hora end,
           precio_cuota = case when v_campos ? 'cuota'
                       then (v_campos ->> 'cuota')::integer else precio_cuota end,
           cancha_nombre = case when v_cancha is not null
                       then v_cancha ->> 'cancha_nombre' else cancha_nombre end,
           comuna = case when v_cancha is not null
                       then v_cancha ->> 'comuna' else comuna end,
           region = case when v_cancha is not null
                       then v_cancha ->> 'region' else region end,
           latitud = case when v_cancha is not null
                       then public.aproximar_grado((v_cancha ->> 'latitud')::numeric)
                       else latitud end,
           longitud = case when v_cancha is not null
                       then public.aproximar_grado((v_cancha ->> 'longitud')::numeric)
                       else longitud end,
           direccion = case when v_cancha is not null then null else direccion end,
           ubicacion_aproximada = case when v_cancha is not null
                       then true else ubicacion_aproximada end
     where id = v_match.id
    returning * into v_match;

    if v_cancha is not null then
        insert into public.club_match_locations (match_id, direccion, latitud, longitud)
        values (v_match.id,
                v_cancha ->> 'direccion',
                (v_cancha ->> 'latitud')::numeric(10,7),
                (v_cancha ->> 'longitud')::numeric(10,7))
        on conflict (match_id) do update
           set direccion = excluded.direccion,
               latitud   = excluded.latitud,
               longitud  = excluded.longitud;
    end if;

    insert into public.club_challenge_events (challenge_id, tipo, actor_id, club_id, payload)
    values (v_row.id, 'cambio_respondido', v_me, v_club,
        jsonb_build_object(
            'change_id',            v_ch.id,
            'match_id',             v_match.id,
            'aceptado',             true,
            'club_responde_id',     v_club,
            'club_responde_nombre', coalesce(v_nombre, 'Un club'),
            'actor_id',             v_me,
            'actor_username',       v_user,
            'cambios',              v_rev -> 'cambios'));

    perform public.desafio_avisar(
        v_row,
        'club_match_change_responded',
        'Aceptaron el cambio ✓',
        coalesce(v_nombre, 'El club rival') || ' aceptó el cambio en «' || v_titulo
            || '». El partido ya quedó actualizado.',
        array[v_ch.club_proponente_id],
        v_me,
        jsonb_build_object('matchId', v_match.id, 'changeId', v_ch.id, 'aceptado', true),
        true);

    return json_build_object('ok', true, 'aceptado', true,
        'changeId', v_ch.id, 'cambios', v_rev -> 'cambios');
end;
$$;

revoke execute on function public.responder_cambio_partido(uuid, boolean, text) from public, anon;
grant execute on function public.responder_cambio_partido(uuid, boolean, text) to authenticated;
