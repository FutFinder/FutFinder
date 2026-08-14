-- =============================================================
-- FutFinder — migración 47: cancelación del encuentro y sanción
-- del club.
--
-- QUÉ HACE: un administrador puede cancelar un encuentro ya
-- publicado sin pedirle permiso al rival, pero tiene que decir por qué,
-- y si lo hace con el partido encima su CLUB queda 14 días sin poder
-- abrir desafíos nuevos.
--
-- LAS CINCO GARANTÍAS, Y DÓNDE VIVEN:
--
--   1. EL MOTIVO ES OBLIGATORIO Y QUEDA ESCRITO. `club_sanctions.motivo`
--      es `not null` con `check (length(trim(motivo)) > 0)`, y la RPC
--      rechaza el motivo en blanco antes de tocar nada. No es una
--      formalidad: el motivo es lo que lee el club rival, lo que ven los
--      jugadores inscritos y lo que tendrá delante quien revise la
--      sanción en la Tarea 5.2.
--   2. EL CORTE DE LAS 2 HORAS LO CALCULA POSTGRESQL.
--      `v_match.hora - now() <= interval '2 hours'`, con el reloj del
--      servidor y con las horas que declara `desafio_reglas()`. El
--      teléfono no puede regalarse margen.
--   3. LA SANCIÓN ES DEL CLUB, NO DE LA PERSONA. En toda esta migración
--      no aparece `profiles.trust_score` ni una sola vez, y la prueba
--      47 lo comprueba midiendo el Trust Score de los inscritos antes y
--      después. Por eso NO se reutiliza `cancel_match()` tal cual: esa
--      función descuenta Trust Score al organizador (migración 34), que
--      en un partido de clubes es sólo el administrador que un día
--      aprobó la propuesta. Lo que sí se reutiliza es su lógica —cambiar
--      el estado en vez de borrar la fila, conservar el chat y los
--      `attendees`, avisar a los inscritos y cerrar la lista de espera—.
--   4. LA SANCIÓN BLOQUEA LO NUEVO, NO LO YA ACORDADO (decisión C3 del
--      plan). `club_esta_sancionado()` se consulta al crear un desafío,
--      al aceptarlo, al proponer oficialmente y al aprobar la propuesta.
--      Los partidos que el club ya tenía publicados NO se tocan: se
--      juegan. Cancelarlos castigaría al club rival y a los jugadores
--      inscritos, que no hicieron nada.
--   5. UNA CANCELACIÓN, UNA SANCIÓN. La RPC es idempotente por el
--      `update ... where estado = 'publicado' or 'en_juego'` sobre el
--      partido: la segunda llamada no mueve ninguna fila, sale con
--      `already` y no abre una segunda sanción.
--
-- QUIÉN CANCELA. Un administrador de cualquiera de los dos clubes, sin
-- aprobación del otro. Quien administra LOS DOS no puede: la sanción
-- recae sobre un club concreto y no hay forma de decidir cuál. Es el
-- mismo conflicto de doble pertenencia que ya cierran la 43d y la 46.
--
-- SOBRE `revoke`: `revoke ... from anon` NO quita el EXECUTE que
-- PostgreSQL concede a PUBLIC por defecto — eso fue lo que obligó a
-- escribir la 42b. Acá se revoca de `public` explícitamente y recién
-- después se concede a `authenticated`.
--
-- COMPATIBILIDAD: un partido que no viene de un desafío
-- (`challenge_proposal_id is null`) no entra por acá y conserva
-- `cancel_match()` intacta, con su penalización personal de siempre.
-- Las dos funciones existentes que se reescriben —`aceptar_desafio` y
-- `crear_propuesta_oficial`— se copian de las migraciones 42 y 45 y
-- sólo se les añade la consulta de sanción.
--
-- Es idempotente: se puede volver a correr sin efectos secundarios.
-- =============================================================

-- ── 1. LA SANCIÓN ───────────────────────────────────────────────
-- Una fila POR INFRACCIÓN, no una por club. Dos cancelaciones tardías
-- son dos sanciones, y eso importa para la Tarea 5.2: retirar una
-- revisión no puede desbloquear al club si la otra sigue en pie.
-- `club_esta_sancionado()` mira si existe ALGUNA vigente, así que
-- solaparlas se resuelve solo.
--
-- `estado` nace con el vocabulario completo del plan, igual que hizo la
-- 42 con los tipos de evento: 'provisional' es la sanción por
-- incomparecencia de la Tarea 5.2, que se aplica antes de revisarla, y
-- 'retirada' es lo que deja una revisión que da la razón al club. Una
-- sanción cumplida no cambia de estado: se le pasó `fin_at` y ya.
create table if not exists public.club_sanctions (
    id           uuid primary key default gen_random_uuid(),
    club_id      uuid not null references public.clubs(id) on delete cascade,
    -- De dónde vino. Los dos en `set null`: una sanción sobrevive al
    -- desafío y al partido que la originaron, porque es el historial del
    -- club y no un detalle de aquel encuentro.
    challenge_id uuid references public.club_challenges(id) on delete set null,
    match_id     uuid references public.matches(id) on delete set null,
    tipo         text not null default 'cancelacion_tardia',
    motivo       text not null,
    aplicada_por uuid references auth.users(id) on delete set null,
    inicio_at    timestamptz not null default now(),
    fin_at       timestamptz not null,
    estado       text not null default 'vigente',
    created_at   timestamptz not null default now()
);

-- El motivo en blanco es exactamente lo que esta tabla existe para
-- impedir: una sanción sin explicación no se puede revisar.
alter table public.club_sanctions
    drop constraint if exists club_sanctions_motivo_check;
alter table public.club_sanctions
    add constraint club_sanctions_motivo_check
    check (length(trim(motivo)) > 0 and length(motivo) <= 300);

alter table public.club_sanctions
    drop constraint if exists club_sanctions_estado_check;
alter table public.club_sanctions
    add constraint club_sanctions_estado_check
    check (estado in ('vigente', 'provisional', 'retirada'));

alter table public.club_sanctions
    drop constraint if exists club_sanctions_tipo_check;
alter table public.club_sanctions
    add constraint club_sanctions_tipo_check
    check (tipo in ('cancelacion_tardia', 'incomparecencia'));

-- Una sanción que termina antes de empezar no bloquearía nada y sería
-- indistinguible de un error de cálculo.
alter table public.club_sanctions
    drop constraint if exists club_sanctions_ventana_check;
alter table public.club_sanctions
    add constraint club_sanctions_ventana_check
    check (fin_at > inicio_at);

-- El índice que usa `club_esta_sancionado()`, que se llama en cada
-- creación, aceptación, propuesta y aprobación de desafío.
create index if not exists idx_club_sanctions_vigentes
    on public.club_sanctions (club_id, fin_at)
    where estado in ('vigente', 'provisional');

create index if not exists idx_club_sanctions_club
    on public.club_sanctions (club_id, created_at desc);

comment on table public.club_sanctions is
    'Sanciones de CLUB (migración 47). Duran 14 días y bloquean crear, aceptar, proponer y aprobar desafíos nuevos; NO tocan el Trust Score de ninguna persona ni cancelan los partidos que el club ya tenía publicados.';
comment on column public.club_sanctions.motivo is
    'Obligatorio. Es lo que leen el club rival, los jugadores inscritos y quien revise la sanción.';

-- ── 2. QUIÉN VE LA SANCIÓN ──────────────────────────────────────
-- Los integrantes del club sancionado, con o sin rol. No sólo los
-- administradores: el desafío bloqueado se le muestra a todo el club
-- como «Club sancionado», y un estado que no se puede explicar se lee
-- como una pantalla rota.
--
-- Las sanciones de OTROS clubes no se leen desde acá. Que un rival esté
-- sancionado se sabe al intentar desafiarlo, con el mensaje de la RPC, y
-- eso es todo lo que hace falta saber.
--
-- SIN POLÍTICAS DE ESCRITURA, igual que `club_challenge_proposals`,
-- `club_match_locations` y `club_match_changes`: la tabla la escriben
-- únicamente las funciones `security definer` de esta migración.
alter table public.club_sanctions enable row level security;

drop policy if exists club_sanctions_read on public.club_sanctions;
create policy club_sanctions_read on public.club_sanctions
    for select
    using (
        exists (
            select 1 from public.club_members cm
             where cm.user_id = auth.uid()
               and cm.club_id = club_sanctions.club_id
        )
    );

grant select on public.club_sanctions to authenticated;
revoke insert, update, delete on public.club_sanctions from public, anon, authenticated;
revoke select on public.club_sanctions from anon;

-- ── 3. EL MARCADOR DE LA 44 SE VUELVE REAL ──────────────────────
-- Hasta acá `club_esta_sancionado()` devolvía `false` siempre, a
-- propósito: no había tabla que consultar. Ahora consulta.
--
-- Se conserva la revocación de los tres roles del cliente (`public`,
-- `anon`, `authenticated`) que fijó la 44 y que comprueba el caso 11 de
-- `44_partido_clubes_test.sql`: sólo se llama desde dentro de funciones
-- `security definer`. La pantalla no pregunta por esta función — lee
-- `club_sanctions` con su RLS, que le muestra las de su propio club y
-- ninguna más.
create or replace function public.club_esta_sancionado(p_club_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
    select exists (
        select 1
          from public.club_sanctions s
         where s.club_id = p_club_id
           and s.estado in ('vigente', 'provisional')
           and s.inicio_at <= now()
           and s.fin_at    >  now()
    );
$$;

revoke execute on function public.club_esta_sancionado(uuid) from public, anon, authenticated;

comment on function public.club_esta_sancionado(uuid) is
    'true si el club tiene alguna sanción vigente o provisional en curso (migración 47). Interna: no se concede a ningún rol del cliente.';

-- ── 4. APLICAR LA SANCIÓN ───────────────────────────────────────
-- Interna. La llama `cancelar_encuentro_club()` y, en la Tarea 5.2, el
-- informe de incomparecencia. Deja tres cosas: la fila de
-- `club_sanctions`, el evento del hilo y el aviso a los administradores
-- del club sancionado.
--
-- LOS DÍAS SALEN DE `desafio_reglas()`, que es el espejo de
-- `clubChallengeRules.js`. Escribir «14» acá sería la forma más rápida
-- de que un día el cliente y el servidor contaran distinto.
--
-- NO TOCA `profiles.trust_score`. Ni acá ni en ninguna función de esta
-- migración: la sanción es del club.
create or replace function public.aplicar_sancion_club(
    p_club_id      uuid,
    p_motivo       text,
    p_tipo         text default 'cancelacion_tardia',
    p_challenge_id uuid default null,
    p_match_id     uuid default null,
    p_aplicada_por uuid default null,
    p_estado       text default 'vigente'
)
returns public.club_sanctions
language plpgsql
security definer
set search_path = public
as $$
declare
    v_dias   integer := (public.desafio_reglas() ->> 'sancion_dias')::int;
    v_motivo text;
    v_row    public.club_sanctions;
    v_ch     public.club_challenges;
    v_nombre text;
    v_admin  record;
begin
    v_motivo := nullif(btrim(coalesce(p_motivo, '')), '');
    if v_motivo is null then
        raise exception 'Una sanción no se puede aplicar sin motivo'
            using errcode = 'check_violation';
    end if;
    -- El motivo de la SANCIÓN lo arma quien la aplica y puede venir con un
    -- prefijo («Canceló el encuentro con menos de 2 horas de aviso: …»),
    -- así que acá sí se recorta al tope de la columna. No se pierde nada:
    -- el texto que escribió la persona está completo en
    -- `matches.motivo_cancelacion` y en el evento del hilo.
    v_motivo := left(v_motivo, 300);

    insert into public.club_sanctions (
        club_id, challenge_id, match_id, tipo, motivo,
        aplicada_por, inicio_at, fin_at, estado
    )
    values (
        p_club_id, p_challenge_id, p_match_id, p_tipo, v_motivo,
        p_aplicada_por, now(), now() + make_interval(days => v_dias), p_estado
    )
    returning * into v_row;

    select nombre into v_nombre from public.clubs where id = p_club_id;

    -- El evento guarda DATOS, no una frase: el cliente arma el texto desde
    -- `utils/cancelacionEncuentro.js`, que es puro y está probado. Así la
    -- redacción se corrige sin migrar filas.
    if p_challenge_id is not null then
        select * into v_ch from public.club_challenges where id = p_challenge_id;
        if found then
            insert into public.club_challenge_events (challenge_id, tipo, actor_id, club_id, payload)
            values (v_ch.id, 'sancion_aplicada', p_aplicada_por, p_club_id,
                jsonb_build_object(
                    'sancion_id',  v_row.id,
                    'club_id',     p_club_id,
                    'club_nombre', coalesce(v_nombre, 'Un club'),
                    'tipo',        v_row.tipo,
                    'motivo',      v_row.motivo,
                    'dias',        v_dias,
                    'inicio_at',   v_row.inicio_at,
                    'fin_at',      v_row.fin_at,
                    'estado',      v_row.estado));
        end if;
    end if;

    -- Al club sancionado se le avisa aparte y con su propio tipo: es el
    -- único que necesita leer hasta cuándo dura y qué puede seguir
    -- haciendo. `desafio_avisar` no sirve acá porque avisa a los
    -- administradores de los DOS clubes de un desafío.
    for v_admin in
        select cm.user_id from public.club_members cm
         where cm.club_id = p_club_id and cm.rol = 'admin'
    loop
        insert into public.notifications (user_id, type, title, body, data)
        values (
            v_admin.user_id,
            'club_sancionado',
            'Tu club quedó sancionado',
            coalesce(v_nombre, 'Tu club') || ' no podrá crear ni aceptar desafíos durante '
                || v_dias || ' días. Motivo: ' || v_row.motivo
                || '. Los partidos que ya tenía publicados siguen en pie.',
            jsonb_build_object(
                'sancionId',   v_row.id,
                'clubId',      p_club_id,
                'challengeId', p_challenge_id,
                'matchId',     p_match_id,
                'dias',        v_dias,
                'finAt',       v_row.fin_at));
    end loop;

    return v_row;
end;
$$;

revoke execute on function public.aplicar_sancion_club(uuid, text, text, uuid, uuid, uuid, text)
    from public, anon, authenticated;

comment on function public.aplicar_sancion_club(uuid, text, text, uuid, uuid, uuid, text) is
    'Ayudante interno: crea la sanción del club, su evento en el hilo y el aviso a los administradores. No es una RPC del cliente y no toca el Trust Score de nadie.';

-- ── 5. AVISOS NUEVOS ────────────────────────────────────────────
-- `club_match_cancelled` va a los administradores de los dos clubes;
-- `club_sancionado`, sólo a los del club sancionado. A los jugadores
-- INSCRITOS no les llega ninguno de los dos: reciben `match_cancelled`,
-- el mismo aviso que en cualquier partido cancelado, porque para ellos
-- lo que pasó es exactamente eso.
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
        'club_match_change', 'club_match_change_responded',
        'club_match_cancelled', 'club_sancionado'
    ));

-- ── 6. CANCELAR EL ENCUENTRO ────────────────────────────────────
-- Unilateral: no espera la aprobación del rival. El encuentro se acabó
-- en cuanto un administrador lo dice, porque negociar una cancelación
-- con el partido encima deja a la gente saliendo de su casa hacia una
-- cancha vacía.
--
-- ORDEN DE BLOQUEO: primero la fila grande (el partido) y después la
-- chica (el desafío), el mismo que usa `responder_cambio_partido`. Si
-- una función lo hiciera al revés, dos administradores actuando a la vez
-- podrían trabarse.
--
-- CONSERVA EL HISTORIAL, igual que la 34: el partido queda en
-- `estado = 'cancelado'` con su `motivo_cancelacion`, no se borra. El
-- chat, los `attendees` y la bitácora del desafío siguen ahí.
create or replace function public.cancelar_encuentro_club(
    p_challenge_id uuid,
    p_motivo       text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me      uuid := auth.uid();
    v_row     public.club_challenges;
    v_match   public.matches;
    v_clubes  uuid[];
    v_club    uuid;
    v_rival   uuid;
    v_motivo  text;
    v_horas   integer := (public.desafio_reglas() ->> 'cancelacion_sancion_horas')::int;
    v_sanciona boolean;
    -- Dos escalares y no una variable de fila: cuando la cancelación NO
    -- sanciona, la fila no existe, y devolver campos de una fila que
    -- nunca se asignó es exactamente el tipo de detalle que revienta en
    -- producción y no en la prueba.
    v_sancion_id  uuid;
    v_sancion_fin timestamptz;
    v_nombre  text;
    v_user    text;
    v_titulo  text;
    v_jug     record;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    -- ── el motivo, antes de tocar nada ──────────────────────────
    -- Se valida acá y no con el CHECK de la tabla porque el motivo tiene
    -- que rechazarse aunque la cancelación NO llegue a sancionar: es
    -- obligatorio siempre, no sólo cuando hay sanción que explicar.
    v_motivo := nullif(btrim(coalesce(p_motivo, '')), '');
    if v_motivo is null then
        return json_build_object('ok', false,
            'reason', 'Escribe el motivo de la cancelación: lo verán el club rival y los jugadores inscritos');
    end if;
    if length(v_motivo) > 300 then
        return json_build_object('ok', false,
            'reason', 'El motivo no puede pasar de 300 caracteres');
    end if;

    -- Lectura sin bloqueo, sólo para saber qué partido bloquear. El
    -- bloqueo de verdad viene enseguida y en el orden correcto.
    select * into v_row from public.club_challenges where id = p_challenge_id;
    if not found then
        return json_build_object('ok', false, 'reason', 'Este desafío ya no existe');
    end if;
    if v_row.match_id is null then
        return json_build_object('ok', false,
            'reason', 'Este desafío todavía no tiene un partido publicado');
    end if;

    select * into v_match from public.matches where id = v_row.match_id for update;
    if not found then
        return json_build_object('ok', false, 'reason', 'El partido de este desafío ya no existe');
    end if;
    select * into v_row from public.club_challenges where id = p_challenge_id for update;

    -- ── autorización, antes de cualquier salida temprana ────────
    -- La 43b aprendió esto a golpes: una salida temprana antes de mirar
    -- `club_members` convierte una función `security definer` en una
    -- filtración para cualquiera que acierte un identificador.
    select array_agg(cm.club_id) into v_clubes
      from public.club_members cm
     where cm.user_id = v_me
       and cm.rol = 'admin'
       and cm.club_id in (v_row.club_retador_id, v_row.club_retado_id);

    if v_clubes is null then
        return json_build_object('ok', false,
            'reason', 'Solo un administrador de alguno de los dos clubes puede cancelar el encuentro');
    end if;

    -- Quien administra los DOS clubes no cancela: la sanción recae sobre
    -- un club concreto y no hay forma de decidir cuál. Mismo conflicto de
    -- doble pertenencia que cierran la 43d y la 46.
    if array_length(v_clubes, 1) > 1 then
        return json_build_object('ok', false,
            'reason', 'Administras los dos clubes de este encuentro: no puedes cancelarlo en nombre de uno solo');
    end if;

    v_club  := v_clubes[1];
    v_rival := case when v_club = v_row.club_retador_id
                    then v_row.club_retado_id
                    else v_row.club_retador_id end;

    -- ── estado ──────────────────────────────────────────────────
    -- Reintento: ya estaba cancelado. Se devuelve sin repetir efectos,
    -- sin segundo aviso y —lo importante— sin una segunda sanción.
    if v_row.estado = 'cancelado' or v_match.estado = 'cancelado' then
        return json_build_object('ok', true, 'already', true,
            'matchId', v_match.id, 'sanciona', false);
    end if;
    if v_row.estado not in ('publicado', 'en_juego') then
        return json_build_object('ok', false,
            'reason', 'Este encuentro ya no se puede cancelar');
    end if;
    if v_match.estado not in ('abierto', 'lleno', 'en_curso') then
        return json_build_object('ok', false,
            'reason', 'Este encuentro ya no se puede cancelar');
    end if;

    -- ── el corte de las 2 horas, con el reloj del servidor ──────
    -- Un partido que ya empezó da una diferencia negativa, así que entra
    -- por esta misma rama: cancelar a mitad de encuentro sanciona.
    v_sanciona := (v_match.hora - now()) <= make_interval(hours => v_horas);

    select nombre into v_nombre from public.clubs where id = v_club;
    -- El `username` sale de `profiles` DENTRO de la función, nunca del
    -- cliente: un nombre de actor que manda quien actúa se lo puede
    -- escribir solo. La auditoría de verdad es `actor_id`.
    select username into v_user from public.profiles where id = v_me;
    v_titulo := coalesce(v_match.titulo, 'el partido');

    -- ── el partido: cambia de estado, NO se borra (lógica de la 34) ──
    -- El `where` con el estado esperado es lo que serializa dos
    -- cancelaciones simultáneas: la segunda no mueve ninguna fila.
    update public.matches
       set estado = 'cancelado',
           motivo_cancelacion = v_motivo
     where id = v_match.id
       and estado in ('abierto', 'lleno', 'en_curso')
    returning * into v_match;
    if not found then
        return json_build_object('ok', true, 'already', true,
            'matchId', v_row.match_id, 'sanciona', false);
    end if;

    update public.club_challenges
       set estado = 'cancelado',
           motivo_cierre = v_motivo
     where id = v_row.id
       and estado in ('publicado', 'en_juego')
    returning * into v_row;
    if not found then
        return json_build_object('ok', false,
            'reason', 'Este encuentro ya no se puede cancelar');
    end if;

    -- ── los jugadores inscritos ─────────────────────────────────
    -- Mismo aviso que en cualquier partido cancelado, y por la misma
    -- razón: para ellos lo que pasó es exactamente eso. Se excluye a
    -- quien cancela, que ya sabe lo que hizo.
    for v_jug in
        select id_jugador from public.attendees
         where id_partido = v_match.id
           and estado in ('pendiente', 'inscrito', 'confirmado_gps')
           and id_jugador <> v_me
    loop
        insert into public.notifications (user_id, type, title, body, data)
        values (v_jug.id_jugador, 'match_cancelled', 'Se canceló el partido',
                format('«%s» fue cancelado por %s. Motivo: %s',
                       v_titulo, coalesce(v_nombre, 'uno de los clubes'), v_motivo),
                jsonb_build_object('matchId', v_match.id));
    end loop;

    -- La lista de espera se cierra, igual que en `cancel_match`.
    for v_jug in
        select id_jugador from public.match_waitlist where id_partido = v_match.id
    loop
        insert into public.notifications (user_id, type, title, body, data)
        values (v_jug.id_jugador, 'match_cancelled', 'Se canceló el partido',
                format('«%s» fue cancelado, así que la lista de espera se cerró.', v_titulo),
                jsonb_build_object('matchId', v_match.id));
    end loop;

    delete from public.match_waitlist where id_partido = v_match.id;

    -- ── la bitácora del hilo ────────────────────────────────────
    insert into public.club_challenge_events (challenge_id, tipo, actor_id, club_id, payload)
    values (v_row.id, 'encuentro_cancelado', v_me, v_club,
        jsonb_build_object(
            'match_id',            v_match.id,
            'club_cancela_id',     v_club,
            'club_cancela_nombre', coalesce(v_nombre, 'Un club'),
            'actor_id',            v_me,
            'actor_username',      v_user,
            'motivo',              v_motivo,
            'sanciona',            v_sanciona,
            'hora_partido',        v_match.hora));

    -- ── los administradores de los dos clubes ───────────────────
    perform public.desafio_avisar(
        v_row,
        'club_match_cancelled',
        'Se canceló el encuentro',
        coalesce(v_nombre, 'Uno de los clubes') || ' canceló «' || v_titulo
            || '». Motivo: ' || v_motivo,
        array[v_row.club_retador_id, v_row.club_retado_id],
        v_me,
        jsonb_build_object('matchId', v_match.id, 'clubCancelaId', v_club,
                           'motivo', v_motivo, 'sanciona', v_sanciona),
        true);

    -- ── la sanción, si corresponde ──────────────────────────────
    if v_sanciona then
        select s.id, s.fin_at into v_sancion_id, v_sancion_fin
          from public.aplicar_sancion_club(
                   v_club,
                   'Canceló el encuentro con menos de ' || v_horas || ' horas de aviso: ' || v_motivo,
                   'cancelacion_tardia',
                   v_row.id,
                   v_match.id,
                   v_me) s;
    end if;

    return json_build_object(
        'ok',           true,
        'matchId',      v_match.id,
        'clubCancelaId', v_club,
        'clubRivalId',  v_rival,
        'motivo',       v_motivo,
        'sanciona',     v_sanciona,
        'sancionId',    v_sancion_id,
        'finAt',        v_sancion_fin);
end;
$$;

revoke execute on function public.cancelar_encuentro_club(uuid, text) from public, anon;
grant execute on function public.cancelar_encuentro_club(uuid, text) to authenticated;

comment on function public.cancelar_encuentro_club(uuid, text) is
    'Cancela unilateralmente el encuentro de un desafío (migración 47). Exige motivo, conserva el partido en el historial con estado cancelado, avisa a administradores e inscritos y sanciona al club 14 días si faltaban menos de 2 horas. No toca el Trust Score de nadie.';

-- ── 7. LA SANCIÓN BLOQUEA LOS DESAFÍOS NUEVOS ───────────────────
-- Cuatro puertas, y hay que cerrarlas las cuatro: crear el desafío,
-- aceptarlo, proponer oficialmente y aprobar la propuesta. `aprobar_
-- propuesta` ya preguntaba desde la 44 —contra el marcador que devolvía
-- `false`—, así que no se toca: al cambiar el cuerpo de
-- `club_esta_sancionado` empieza a bloquear sola.
--
-- CREAR es la única que NO pasa por una RPC: `createChallenge` hace un
-- `insert` directo desde el cliente. Por eso acá va un trigger, y
-- `security definer`: `club_esta_sancionado` está revocada de
-- `authenticated`, así que un trigger `security invoker` —como el de
-- rival propio de la 41— no podría llamarla.
create or replace function public.club_challenges_valida_sancion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_fin timestamptz;
begin
    if public.club_esta_sancionado(new.club_retador_id) then
        select max(fin_at) into v_fin from public.club_sanctions
         where club_id = new.club_retador_id
           and estado in ('vigente', 'provisional')
           and fin_at > now();
        -- `coalesce` sobre el texto ya formateado y no sobre la fecha: si
        -- `v_fin` viniera nulo, `to_char` devolvería NULL y el mensaje
        -- entero se convertiría en «sancionado hasta el » a secas.
        raise exception 'Tu club está sancionado hasta el % y no puede enviar desafíos',
            coalesce(to_char(v_fin at time zone 'America/Santiago', 'DD/MM/YYYY'), 'que termine la sanción')
            using errcode = 'check_violation';
    end if;

    -- El rival sancionado tampoco: no podría aceptar, así que el desafío
    -- nacería condenado a expirar en siete días. El mensaje no dice hasta
    -- cuándo dura la sanción ajena — con saber que no se puede, basta.
    if public.club_esta_sancionado(new.club_retado_id) then
        raise exception 'Ese club está sancionado y no puede recibir desafíos por ahora'
            using errcode = 'check_violation';
    end if;

    return new;
end;
$$;

drop trigger if exists trg_club_challenges_valida_sancion on public.club_challenges;
create trigger trg_club_challenges_valida_sancion
    before insert on public.club_challenges
    for each row execute function public.club_challenges_valida_sancion();

-- ── 8. ACEPTAR UN DESAFÍO CON EL CLUB SANCIONADO ────────────────
-- Copia literal de `aceptar_desafio` de la migración 42 con UNA sola
-- adición: la consulta de sanción, puesta después de la autorización y
-- antes del `update`. Se versiona entera porque `create or replace`
-- reemplaza el cuerpo completo; lo demás no cambia ni una línea.
create or replace function public.aceptar_desafio(p_challenge_id uuid)
returns public.club_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me         uuid := auth.uid();
    v_row        public.club_challenges;
    v_retador    text;
    v_retado     text;
    v_thread_key text;
    v_horas      int;
    v_admin      record;
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

    if v_row.estado = 'negociacion' then
        return v_row;
    end if;

    if v_row.estado <> 'pendiente' then
        raise exception 'Este desafío ya no está pendiente'
            using errcode = 'check_violation';
    end if;

    if not exists (
        select 1 from public.club_members m
        where m.user_id = v_me
          and m.club_id = v_row.club_retado_id
          and m.rol = 'admin'
    ) then
        raise exception 'Solo un administrador del club retado puede aceptar'
            using errcode = '42501';
    end if;

    -- ── LO NUEVO DE LA 47 ───────────────────────────────────────
    -- Los dos clubes, no sólo el que acepta: un desafío que arranca con
    -- el retador sancionado no podría llegar a partido.
    if public.club_esta_sancionado(v_row.club_retado_id) then
        raise exception 'Tu club está sancionado y no puede aceptar desafíos'
            using errcode = 'check_violation';
    end if;
    if public.club_esta_sancionado(v_row.club_retador_id) then
        raise exception 'El club que te desafió está sancionado: el partido no se podría publicar'
            using errcode = 'check_violation';
    end if;

    v_horas := (public.desafio_reglas() ->> 'negociacion_horas')::int;

    begin
        update public.club_challenges
           set estado               = 'negociacion',
               responded_at         = now(),
               respondido_por       = v_me,
               negociacion_vence_at = now() + make_interval(hours => v_horas)
         where id = p_challenge_id
           and estado = 'pendiente'
        returning * into v_row;
    exception when unique_violation then
        raise exception 'Ya tienen un desafío en curso con este club'
            using errcode = 'unique_violation';
    end;

    v_thread_key := 'challenge:' || v_row.id::text;

    select nombre into v_retador from public.clubs where id = v_row.club_retador_id;
    select nombre into v_retado  from public.clubs where id = v_row.club_retado_id;

    insert into public.club_challenge_events (challenge_id, tipo, actor_id, club_id, payload)
    values (
        v_row.id,
        'aceptado',
        v_me,
        v_row.club_retado_id,
        jsonb_build_object(
            'vence_at', v_row.negociacion_vence_at,
            'horas', v_horas
        )
    );

    insert into public.messages (sender_id, challenge_id, content)
    values (
        v_me,
        v_row.id,
        '⚔️ Desafío aceptado. Tienen ' || v_horas
            || ' horas para acordar cancha, fecha y hora del partido.'
    );

    for v_admin in
        select m.user_id, m.club_id
          from public.club_members m
         where m.rol = 'admin'
           and m.club_id in (v_row.club_retador_id, v_row.club_retado_id)
           and m.user_id <> v_me
    loop
        insert into public.notifications (user_id, type, title, body, data)
        values (
            v_admin.user_id,
            'club_challenge_accepted',
            case when v_admin.club_id = v_row.club_retador_id
                 then '⚔️ ' || coalesce(v_retado, 'El club') || ' aceptó tu desafío'
                 else '⚔️ Desafío aceptado contra ' || coalesce(v_retador, 'otro club')
            end,
            'Se abrió el chat de negociación con los administradores de ambos clubes.',
            jsonb_build_object(
                'challengeId',   v_row.id,
                'clubRetadorId', v_row.club_retador_id,
                'clubRetadoId',  v_row.club_retado_id,
                'threadKey',     v_thread_key
            )
        );
    end loop;

    return v_row;
end;
$$;

revoke execute on function public.aceptar_desafio(uuid) from anon;
grant execute on function public.aceptar_desafio(uuid) to authenticated;

-- ── 9. PROPONER CON EL CLUB SANCIONADO ──────────────────────────
-- Copia literal de `crear_propuesta_oficial` de la migración 45 con UNA
-- sola adición: la consulta de sanción, después de la autorización y del
-- reintento idempotente por `client_token`. Va después del token a
-- propósito: un reintento de una propuesta que ya existe tiene que
-- devolverla igual, aunque entretanto haya caído una sanción — si no, la
-- pantalla que reintenta leería un error donde ya había una propuesta.
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

    -- ── LO NUEVO DE LA 47 ───────────────────────────────────────
    if public.club_esta_sancionado(v_row.club_retador_id)
       or public.club_esta_sancionado(v_row.club_retado_id) then
        raise exception 'Uno de los dos clubes está sancionado y no puede acordar partidos nuevos'
            using errcode = 'check_violation';
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
