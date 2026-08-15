-- =============================================================
-- FutFinder — migración 47c: incomparecencia y revisión de sanciones.
--
-- QUÉ HACE: cierra el ciclo que abrió la 47. Un club que no se presenta
-- al partido puede ser informado por el rival DESPUÉS de la hora del
-- encuentro, y eso le deja una sanción PROVISIONAL de 14 días. Cualquier
-- club afectado por una cancelación o por una sanción puede pedir que se
-- revise, y quien resuelve —una persona con `service_role`, porque no
-- existe interfaz de moderación— la retira o la mantiene.
--
-- LAS SIETE GARANTÍAS, Y DÓNDE VIVEN:
--
--   1. LA VENTANA ES DE 24 HORAS, Y LA MIDE POSTGRESQL. Se puede
--      informar desde `matches.hora` y hasta 24 horas después, con el
--      `now()` del servidor. El borde de abajo impide «informar» que
--      alguien faltó a un partido que no ha empezado; el de arriba
--      impide la denuncia tardía, que es la que no se puede comprobar:
--      a los tres días nadie se acuerda de quién llegó a la cancha, y
--      quien revisa la sanción tampoco tiene con qué. Las horas salen
--      de `desafio_reglas()`, que es el espejo de
--      `clubChallengeRules.js`; escribir «24» acá sería la forma más
--      rápida de que un día el cliente y el servidor contaran distinto.
--   2. UN INFORME POR PARTIDO Y POR CLUB ACUSADO. El índice único es
--      `(match_id, club_reportado_id)`. Cada club puede informar una
--      vez, contra el otro: si los dos se acusan quedan dos informes y
--      dos sanciones provisionales, y las dos se revisan por separado.
--      El segundo informe del MISMO club contra el MISMO rival no abre
--      nada: devuelve «ya estaba».
--   3. QUIEN INFORMA ES EL CLUB RIVAL, siempre. El informe se levanta
--      contra el OTRO club del encuentro, nunca contra el propio: el
--      acusado sale de la fila del desafío, no de un argumento que
--      mande quien llama. Quien administra los dos clubes no puede
--      informar — mismo conflicto de doble pertenencia que ya cierran
--      la 43d, la 46 y la 47.
--   4. LA SANCIÓN NACE PROVISIONAL. `estado = 'provisional'`, que la 47
--      ya admitía en el CHECK y que `club_esta_sancionado()` ya cuenta
--      como bloqueante. Bloquea desde el primer momento —si esperara a
--      la revisión no serviría de nada— pero se llama provisional
--      porque todavía no la miró nadie.
--   5. EL DESAFÍO SE CONGELA MIENTRAS HAY UNA REVISIÓN PENDIENTE, y no
--      un minuto más. `solicitar_revision_sancion()` guarda el estado
--      anterior en `club_challenges.estado_previo_sancion` (columna que
--      la 41 dejó creada y vacía) y pasa el desafío a
--      `bloqueado_sancion`; `resolver_revision_sancion()` lo devuelve a
--      ese estado exacto en cuanto no queda ninguna revisión pendiente,
--      se haya retirado la sanción o no. Congelar al informar habría
--      dejado el encuentro atrapado para siempre cuando nadie pide la
--      revisión, que es el caso más frecuente.
--   6. RETIRAR NO BORRA. La fila de `club_sanctions` queda con
--      `estado = 'retirada'` y su motivo intacto. El historial de un
--      club no se reescribe: se anota.
--   7. LA RESOLUCIÓN NO ES DEL CLIENTE. `resolver_revision_sancion` se
--      revoca de `public`, `anon` y `authenticated`, y sólo la conserva
--      `service_role`. No hay comprobación de rol dentro del cuerpo: la
--      única puerta es el privilegio `EXECUTE`, que es el que prueba el
--      arnés. Un guardia interno que leyera el JWT daría una sensación
--      de seguridad que el privilegio ya da de verdad.
--
-- Y el expediente se copia AL PEDIR la revisión, no al resolverla:
-- `club_sanction_reviews.contexto` guarda el partido, la sanción, el
-- informe, los tiempos y los eventos del hilo tal como estaban en ese
-- instante. Si después alguien cancela, cambia o reabre algo, quien
-- revise sigue viendo lo que se le reclamó.
--
-- POR QUÉ UN ARCHIVO 47c Y NO UNA EDICIÓN DE LA 47. La 47 y la 47b están
-- aplicadas en producción desde el 2026-08-14. Editar una migración
-- aplicada deja el repositorio diciendo una cosa y la base otra, que es
-- justo lo que prohíbe `CLAUDE.md` y lo que evitaron la 43b/43c/43d y la
-- 44b–44e. `aplicar_sancion_club()` se re-versiona entera acá —copia
-- literal de la 47 más el bloque del congelado— porque
-- `create or replace` reemplaza el cuerpo completo.
--
-- LO QUE NO HACE. No cancela el partido de la incomparecencia: el
-- encuentro no se jugó, pero la fila queda como está para que la Fase 6
-- decida qué es un resultado cuando un club no llegó. Tampoco toca
-- `profiles.trust_score` — ni acá ni en ninguna función de esta
-- migración: la sanción es del club.
--
-- Es idempotente: se puede volver a correr sin efectos secundarios.
-- =============================================================

-- ── 0. EL PLAZO PARA INFORMAR, EN LAS REGLAS ────────────────────
-- Copia literal de `desafio_reglas()` de la migración 41 con UNA sola
-- adición: `incomparecencia_horas`. Se versiona entera porque
-- `create or replace` reemplaza el cuerpo completo; lo demás no cambia
-- ni una línea.
--
-- Acá y no dentro de la RPC por lo mismo que `sancion_dias`: esta
-- función es el espejo de `src/services/clubChallengeRules.js`, y un
-- número escrito dos veces es un número que algún día va a estar mal en
-- una de las dos.
create or replace function public.desafio_reglas()
returns jsonb
language sql
immutable
as $$
    select jsonb_build_object(
        'negociacion_horas', 72,
        'prorroga_horas', 24,
        'cambio_limite_horas', 2,
        'cancelacion_sancion_horas', 2,
        'incomparecencia_horas', 24,
        'sancion_dias', 14,
        'expiracion_pendiente_dias', 7,
        'cupos_por_club_min', 4,
        'cupos_por_club_max', 15,
        'mensaje_max', 300,
        'instrucciones_max', 500,
        'metodos_inscripcion', jsonb_build_array('orden_llegada', 'seleccion_admin'),
        'estados_activos', jsonb_build_array(
            'negociacion', 'esperando_aprobacion', 'publicado',
            'en_juego', 'esperando_resultado', 'resultado_en_disputa'
        ),
        'estados_cerrados', jsonb_build_array(
            'finalizado', 'rechazado', 'sin_acuerdo', 'cancelado', 'expirado'
        )
    );
$$;

-- ── 1. EL INFORME DE INCOMPARECENCIA ────────────────────────────
-- Una fila por partido Y POR CLUB ACUSADO. Si los dos clubes dicen que
-- el otro no llegó, quedan los dos informes y las dos sanciones
-- provisionales: no se elige al que informó primero. Que se contradigan
-- es información —y va entera al expediente— pero no es la aplicación la
-- que decide cuál de los dos miente.
create table if not exists public.club_match_noshow_reports (
    id                  uuid primary key default gen_random_uuid(),
    challenge_id        uuid not null references public.club_challenges(id) on delete cascade,
    -- `set null` como en `club_sanctions`: el informe sobrevive al
    -- partido, porque es parte del historial del club.
    match_id            uuid references public.matches(id) on delete set null,
    club_reportante_id  uuid not null references public.clubs(id) on delete cascade,
    club_reportado_id   uuid not null references public.clubs(id) on delete cascade,
    motivo              text not null,
    reportado_por       uuid references auth.users(id) on delete set null,
    sancion_id          uuid references public.club_sanctions(id) on delete set null,
    created_at          timestamptz not null default now(),
    constraint club_match_noshow_reports_clubes_distintos
        check (club_reportante_id <> club_reportado_id)
);

alter table public.club_match_noshow_reports
    drop constraint if exists club_match_noshow_reports_motivo_check;
alter table public.club_match_noshow_reports
    add constraint club_match_noshow_reports_motivo_check
    check (length(trim(motivo)) > 0 and length(motivo) <= 300);

-- `(match_id, club_reportado_id)`, que es literalmente «uno por partido y
-- por club acusado». Parcial porque `match_id` es `on delete set null`:
-- borrado el partido no hay nada que restringir, y un índice que tratara
-- todos esos nulos como iguales impediría archivar dos informes viejos.
create unique index if not exists club_match_noshow_reports_partido_club_uidx
    on public.club_match_noshow_reports (match_id, club_reportado_id)
    where match_id is not null;

comment on table public.club_match_noshow_reports is
    'Informes de incomparecencia (migración 47c). Uno por partido y por club acusado, sólo dentro de las 24 horas siguientes a la hora del partido, y cada uno deja una sanción provisional de 14 días sobre el club que no se presentó.';

-- ── 2. LA REVISIÓN ──────────────────────────────────────────────
-- «Solicitar revisión» tiene que estar disponible ante CUALQUIER
-- cancelación o sanción, y por eso `sancion_id` es opcional: una
-- cancelación con aviso suficiente no deja sanción, pero deja a un club
-- sin partido, y ése también tiene derecho a que alguien lo mire.
--
-- `contexto` es el expediente, y se copia al pedirla, no al resolverla.
create table if not exists public.club_sanction_reviews (
    id             uuid primary key default gen_random_uuid(),
    -- El club que PIDE la revisión: el afectado.
    club_id        uuid not null references public.clubs(id) on delete cascade,
    challenge_id   uuid not null references public.club_challenges(id) on delete cascade,
    match_id       uuid references public.matches(id) on delete set null,
    sancion_id     uuid references public.club_sanctions(id) on delete set null,
    tipo           text not null default 'sancion',
    motivo         text not null,
    contexto       jsonb not null default '{}'::jsonb,
    solicitada_por uuid references auth.users(id) on delete set null,
    estado         text not null default 'pendiente',
    decision       text,
    nota           text,
    resuelta_por   uuid references auth.users(id) on delete set null,
    resuelta_at    timestamptz,
    created_at     timestamptz not null default now()
);

alter table public.club_sanction_reviews
    drop constraint if exists club_sanction_reviews_motivo_check;
alter table public.club_sanction_reviews
    add constraint club_sanction_reviews_motivo_check
    check (length(trim(motivo)) > 0 and length(motivo) <= 1000);

alter table public.club_sanction_reviews
    drop constraint if exists club_sanction_reviews_tipo_check;
alter table public.club_sanction_reviews
    add constraint club_sanction_reviews_tipo_check
    check (tipo in ('sancion', 'cancelacion'));

alter table public.club_sanction_reviews
    drop constraint if exists club_sanction_reviews_estado_check;
alter table public.club_sanction_reviews
    add constraint club_sanction_reviews_estado_check
    check (estado in ('pendiente', 'resuelta'));

alter table public.club_sanction_reviews
    drop constraint if exists club_sanction_reviews_decision_check;
alter table public.club_sanction_reviews
    add constraint club_sanction_reviews_decision_check
    check (decision is null or decision in ('retirada', 'mantenida'));

-- Una revisión resuelta tiene decisión y hora; una pendiente, ninguna de
-- las dos. Sin este CHECK, una fila a medio resolver se lee igual que
-- una resuelta y nadie sabe cuál de los dos estados es el bueno.
alter table public.club_sanction_reviews
    drop constraint if exists club_sanction_reviews_resuelta_check;
alter table public.club_sanction_reviews
    add constraint club_sanction_reviews_resuelta_check
    check (
        (estado = 'pendiente' and decision is null and resuelta_at is null)
        or (estado = 'resuelta' and decision is not null and resuelta_at is not null)
    );

-- UNA revisión por sanción, para siempre. No es una cola de apelaciones:
-- si la resolución no convence, se discute fuera de la aplicación.
create unique index if not exists club_sanction_reviews_por_sancion_uidx
    on public.club_sanction_reviews (sancion_id)
    where sancion_id is not null;

-- Y una por club y encuentro cuando lo que se revisa es la cancelación,
-- que no tiene sanción a la que atarse.
create unique index if not exists club_sanction_reviews_por_cancelacion_uidx
    on public.club_sanction_reviews (challenge_id, club_id)
    where sancion_id is null;

-- El índice de quien resuelve: hoy la cola de trabajo se lee con un
-- `select ... where estado = 'pendiente'` desde el panel de Supabase.
create index if not exists idx_club_sanction_reviews_pendientes
    on public.club_sanction_reviews (created_at)
    where estado = 'pendiente';

comment on table public.club_sanction_reviews is
    'Revisiones pedidas por el club afectado ante una sanción o una cancelación (migración 47c). Sólo se resuelven con service_role: no existe interfaz de moderación. `contexto` es el expediente copiado al pedirla.';
comment on column public.club_sanction_reviews.contexto is
    'Copia del partido, la sanción, el informe, los tiempos y los eventos del hilo en el instante en que se pidió la revisión.';

-- ── 3. QUIÉN LEE QUÉ ────────────────────────────────────────────
-- El informe lo leen los DOS clubes del encuentro: al acusado hay que
-- decirle de qué se le acusa y con qué palabras, o no puede defenderse.
--
-- La revisión, en cambio, sólo la lee el club que la pidió. Es un
-- reclamo dirigido a quien modera, no un mensaje al rival; enseñárselo
-- al otro club convertiría la revisión en otra discusión. Que se pidió
-- sí es público en el hilo, porque el evento `revision_solicitada` no
-- lleva el motivo.
--
-- SIN POLÍTICAS DE ESCRITURA, igual que `club_sanctions`,
-- `club_challenge_proposals` y `club_match_changes`: estas tablas las
-- escriben únicamente las funciones `security definer` de esta
-- migración.
alter table public.club_match_noshow_reports enable row level security;

drop policy if exists club_match_noshow_reports_read on public.club_match_noshow_reports;
create policy club_match_noshow_reports_read on public.club_match_noshow_reports
    for select
    using (
        exists (
            select 1 from public.club_members cm
             where cm.user_id = auth.uid()
               and cm.club_id in (club_match_noshow_reports.club_reportante_id,
                                  club_match_noshow_reports.club_reportado_id)
        )
    );

grant select on public.club_match_noshow_reports to authenticated;
revoke insert, update, delete on public.club_match_noshow_reports from public, anon, authenticated;
revoke select on public.club_match_noshow_reports from anon;

alter table public.club_sanction_reviews enable row level security;

drop policy if exists club_sanction_reviews_read on public.club_sanction_reviews;
create policy club_sanction_reviews_read on public.club_sanction_reviews
    for select
    using (
        exists (
            select 1 from public.club_members cm
             where cm.user_id = auth.uid()
               and cm.club_id = club_sanction_reviews.club_id
        )
    );

grant select on public.club_sanction_reviews to authenticated;
revoke insert, update, delete on public.club_sanction_reviews from public, anon, authenticated;
revoke select on public.club_sanction_reviews from anon;

-- ── 4. VOCABULARIO NUEVO DEL HILO Y DE LOS AVISOS ───────────────
-- Tres eventos: el informe, la solicitud y la resolución. La sanción en
-- sí la sigue anotando `aplicar_sancion_club` con `sancion_aplicada`,
-- igual que en la 47.
alter table public.club_challenge_events drop constraint if exists club_challenge_events_tipo_check;
alter table public.club_challenge_events add constraint club_challenge_events_tipo_check
    check (tipo in (
        'aceptado', 'rechazado', 'cancelado', 'expirado',
        'prorroga_abierta', 'prorroga_respondida', 'sin_acuerdo',
        'propuesta_creada', 'propuesta_aprobada', 'propuesta_rechazada',
        'partido_publicado', 'partido_en_juego', 'esperando_resultado',
        'cambio_propuesto', 'cambio_respondido',
        'encuentro_cancelado', 'sancion_aplicada', 'sancion_retirada',
        'incomparecencia_reportada', 'revision_solicitada', 'revision_resuelta',
        'resultado_propuesto', 'resultado_confirmado', 'resultado_disputado'
    ));

-- Un solo aviso nuevo: cómo terminó la revisión, y va sólo al club que
-- la pidió. Que se informó una incomparecencia ya lo dice el aviso
-- `club_sancionado` que manda `aplicar_sancion_club`, con el motivo
-- dentro; dos avisos rojos por el mismo hecho serían ruido.
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
        'club_match_cancelled', 'club_sancionado', 'club_revision_resuelta'
    ));

-- ── 5. EL AVISO DICE QUE LA SANCIÓN ES PROVISIONAL ──────────────
-- Copia literal de `aplicar_sancion_club` de la migración 47 con UNA
-- sola adición: el texto del aviso cuando la sanción nace provisional.
-- Se versiona entera porque `create or replace` reemplaza el cuerpo
-- completo; lo demás no cambia ni una línea, y la prueba 47 lo comprueba.
--
-- «Tu club quedó sancionado» a secas, para una sanción que todavía no
-- miró nadie, es lo que hace que nadie pida la revisión. Ésta es la
-- única puerta por la que el club se entera de que puede pedirla.
--
-- ACÁ NO SE CONGELA NADA. El congelado del desafío vive en
-- `solicitar_revision_sancion()` y dura lo que dura la revisión: si se
-- hiciera al aplicar la sanción, un encuentro cuyo club nunca pide
-- revisión —el caso más frecuente— se quedaría en `bloqueado_sancion`
-- para siempre, sin nada ni nadie que pudiera sacarlo de ahí.
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
            case when v_row.estado = 'provisional'
                 then 'Tu club quedó sancionado mientras se revisa'
                 else 'Tu club quedó sancionado' end,
            coalesce(v_nombre, 'Tu club') || ' no podrá crear ni aceptar desafíos durante '
                || v_dias || ' días. Motivo: ' || v_row.motivo
                || '. Los partidos que ya tenía publicados siguen en pie.'
                || case when v_row.estado = 'provisional'
                        then ' Si crees que es un error, pide una revisión desde el chat del encuentro.'
                        else '' end,
            jsonb_build_object(
                'sancionId',   v_row.id,
                'clubId',      p_club_id,
                'challengeId', p_challenge_id,
                'matchId',     p_match_id,
                'dias',        v_dias,
                'estado',      v_row.estado,
                'finAt',       v_row.fin_at));
    end loop;

    return v_row;
end;
$$;

revoke execute on function public.aplicar_sancion_club(uuid, text, text, uuid, uuid, uuid, text)
    from public, anon, authenticated;

comment on function public.aplicar_sancion_club(uuid, text, text, uuid, uuid, uuid, text) is
    'Ayudante interno: crea la sanción del club, su evento en el hilo y el aviso a los administradores, que dice que la sanción es provisional cuando lo es (47c). No es una RPC del cliente, no congela ningún desafío y no toca el Trust Score de nadie.';

-- ── 6. INFORMAR LA INCOMPARECENCIA ──────────────────────────────
-- ORDEN DE BLOQUEO: primero la fila grande (el partido) y después la
-- chica (el desafío), el mismo que usan `responder_cambio_partido` y
-- `cancelar_encuentro_club`. Si una función lo hiciera al revés, dos
-- administradores actuando a la vez podrían trabarse.
--
-- ORDEN DE LAS COMPROBACIONES: autorización ANTES que cualquier salida
-- temprana, por la lección de la 43b — una salida temprana antes de
-- mirar `club_members` convierte una función `security definer` en una
-- filtración para cualquiera que acierte un identificador.
create or replace function public.reportar_incomparecencia(
    p_challenge_id uuid,
    p_motivo       text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me        uuid := auth.uid();
    v_row       public.club_challenges;
    v_match     public.matches;
    v_clubes    uuid[];
    v_club      uuid;
    v_rival     uuid;
    v_motivo    text;
    v_rep       public.club_match_noshow_reports;
    v_san       public.club_sanctions;
    v_nombre    text;
    v_rival_nom text;
    v_user      text;
    v_horas     integer := (public.desafio_reglas() ->> 'incomparecencia_horas')::int;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    -- El motivo es obligatorio por lo mismo que el de la cancelación: es
    -- lo que va a leer el club acusado y lo que tendrá delante quien
    -- revise la sanción. Una acusación sin palabras no se puede responder.
    v_motivo := nullif(btrim(coalesce(p_motivo, '')), '');
    if v_motivo is null then
        return json_build_object('ok', false,
            'reason', 'Escribe qué pasó: lo leerá el club acusado y quien revise la sanción');
    end if;
    if length(v_motivo) > 300 then
        return json_build_object('ok', false,
            'reason', 'El motivo no puede pasar de 300 caracteres');
    end if;

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

    -- ── autorización ────────────────────────────────────────────
    select array_agg(cm.club_id) into v_clubes
      from public.club_members cm
     where cm.user_id = v_me
       and cm.rol = 'admin'
       and cm.club_id in (v_row.club_retador_id, v_row.club_retado_id);

    if v_clubes is null then
        return json_build_object('ok', false,
            'reason', 'Solo un administrador de alguno de los dos clubes puede informar una incomparecencia');
    end if;
    if array_length(v_clubes, 1) > 1 then
        return json_build_object('ok', false,
            'reason', 'Administras los dos clubes de este encuentro: no puedes informar una incomparecencia contra uno de ellos');
    end if;

    v_club  := v_clubes[1];
    v_rival := case when v_club = v_row.club_retador_id
                    then v_row.club_retado_id
                    else v_row.club_retador_id end;

    -- ── reintento ───────────────────────────────────────────────
    -- Antes que los estados y que el plazo: el segundo toque del MISMO
    -- club contra el MISMO rival tiene que devolver «ya estaba» aunque
    -- entretanto se hayan pasado las 24 horas o el desafío se haya
    -- congelado. Si no, un reintento leería «el plazo venció» sobre un
    -- informe que sí se presentó a tiempo, y parecería que se perdió.
    --
    -- Por `club_reportado_id` y no sólo por el encuentro: el otro club
    -- puede tener su propio informe, y ése no es el reintento de éste.
    select * into v_rep from public.club_match_noshow_reports
     where challenge_id = v_row.id
       and club_reportado_id = v_rival;
    if found then
        return json_build_object('ok', true, 'already', true,
            'reportId', v_rep.id, 'sancionId', v_rep.sancion_id,
            'clubReportadoId', v_rep.club_reportado_id);
    end if;

    -- ── estado del encuentro ────────────────────────────────────
    if v_match.estado = 'cancelado' or v_row.estado = 'cancelado' then
        return json_build_object('ok', false,
            'reason', 'Este encuentro se canceló: nadie faltó a un partido que no se jugó');
    end if;
    if v_row.estado not in ('publicado', 'en_juego', 'esperando_resultado') then
        return json_build_object('ok', false,
            'reason', 'Este encuentro ya no admite un informe de incomparecencia');
    end if;

    -- ── la ventana de 24 horas, con el reloj del servidor ───────
    -- Abajo, estrictamente la hora de inicio y no un margen de cortesía:
    -- quien llega tarde llega, y eso se discute en la revisión, no acá.
    if now() < v_match.hora then
        return json_build_object('ok', false,
            'reason', 'Podrás informar la incomparecencia después de la hora del partido');
    end if;
    -- Arriba, 24 horas. Es el límite que hace comprobable la acusación:
    -- pasado ese día ya no queda quién se acuerde de si el rival llegó a
    -- la cancha, y quien revise la sanción tampoco tendría con qué. Sin
    -- este borde, un club puede bloquear a otro dos semanas por un
    -- partido de hace un mes.
    if now() > v_match.hora + make_interval(hours => v_horas) then
        return json_build_object('ok', false,
            'reason', 'El plazo para informar una incomparecencia venció: eran ' || v_horas
                      || ' horas desde la hora del partido');
    end if;

    select nombre into v_nombre     from public.clubs where id = v_club;
    select nombre into v_rival_nom  from public.clubs where id = v_rival;
    -- El `username` sale de `profiles` DENTRO de la función, nunca del
    -- cliente: un nombre de actor que manda quien actúa se lo puede
    -- escribir solo. La auditoría de verdad es `actor_id`.
    select username into v_user from public.profiles where id = v_me;

    begin
        insert into public.club_match_noshow_reports (
            challenge_id, match_id, club_reportante_id, club_reportado_id,
            motivo, reportado_por)
        values (v_row.id, v_match.id, v_club, v_rival, v_motivo, v_me)
        returning * into v_rep;
    exception when unique_violation then
        -- Dos administradores del mismo club informando a la vez: el
        -- índice único `(match_id, club_reportado_id)` es el que
        -- serializa de verdad, y el que impide que la carrera deje dos
        -- sanciones sobre el mismo club por el mismo partido.
        select * into v_rep from public.club_match_noshow_reports
         where match_id = v_match.id and club_reportado_id = v_rival;
        return json_build_object('ok', true, 'already', true,
            'reportId', v_rep.id, 'sancionId', v_rep.sancion_id,
            'clubReportadoId', v_rep.club_reportado_id);
    end;

    insert into public.club_challenge_events (challenge_id, tipo, actor_id, club_id, payload)
    values (v_row.id, 'incomparecencia_reportada', v_me, v_club,
        jsonb_build_object(
            'report_id',                v_rep.id,
            'match_id',                 v_match.id,
            'club_reportante_id',       v_club,
            'club_reportante_nombre',   coalesce(v_nombre, 'Un club'),
            'club_reportado_id',        v_rival,
            'club_reportado_nombre',    coalesce(v_rival_nom, 'El club rival'),
            'actor_id',                 v_me,
            'actor_username',           v_user,
            'motivo',                   v_motivo,
            'hora_partido',             v_match.hora));

    -- La sanción nace PROVISIONAL: bloquea desde ya, pero está a la
    -- espera de que alguien la mire. El congelado del desafío lo hace
    -- `aplicar_sancion_club`.
    select * into v_san
      from public.aplicar_sancion_club(
               v_rival,
               'No se presentó al encuentro: ' || v_motivo,
               'incomparecencia',
               v_row.id,
               v_match.id,
               v_me,
               'provisional') s;

    update public.club_match_noshow_reports
       set sancion_id = v_san.id
     where id = v_rep.id;

    return json_build_object(
        'ok',              true,
        'reportId',        v_rep.id,
        'sancionId',       v_san.id,
        'clubReportadoId', v_rival,
        'finAt',           v_san.fin_at);
end;
$$;

revoke execute on function public.reportar_incomparecencia(uuid, text) from public, anon;
grant execute on function public.reportar_incomparecencia(uuid, text) to authenticated;

comment on function public.reportar_incomparecencia(uuid, text) is
    'Informa que el club rival no se presentó al encuentro (migración 47c). Sólo dentro de las 24 horas siguientes a la hora del partido, sólo un administrador de uno de los dos clubes y siempre contra el OTRO, uno por partido y por club acusado, y deja una sanción provisional de 14 días sobre el club informado.';

-- ── 7. PEDIR LA REVISIÓN ────────────────────────────────────────
-- Disponible ante cualquier cancelación o sanción del encuentro. El
-- expediente se arma acá y se guarda entero en `contexto`.
create or replace function public.solicitar_revision_sancion(
    p_challenge_id uuid,
    p_motivo       text,
    p_sancion_id   uuid default null
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
    v_motivo  text;
    v_san     public.club_sanctions;
    v_rep     public.club_match_noshow_reports;
    v_rev     public.club_sanction_reviews;
    v_tipo    text;
    v_nombre  text;
    v_user    text;
    v_ctx     jsonb;
    v_eventos jsonb;
    v_cancel  timestamptz;
    v_inscri  integer;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    v_motivo := nullif(btrim(coalesce(p_motivo, '')), '');
    if v_motivo is null then
        return json_build_object('ok', false,
            'reason', 'Escribe por qué pides la revisión: es lo único que va a leer quien la resuelva');
    end if;
    if length(v_motivo) > 1000 then
        return json_build_object('ok', false,
            'reason', 'El motivo de la revisión no puede pasar de 1000 caracteres');
    end if;

    select * into v_row from public.club_challenges where id = p_challenge_id;
    if not found then
        return json_build_object('ok', false, 'reason', 'Este desafío ya no existe');
    end if;

    -- ── autorización, antes de cualquier salida temprana ────────
    select array_agg(cm.club_id) into v_clubes
      from public.club_members cm
     where cm.user_id = v_me
       and cm.rol = 'admin'
       and cm.club_id in (v_row.club_retador_id, v_row.club_retado_id);

    if v_clubes is null then
        return json_build_object('ok', false,
            'reason', 'Solo un administrador de alguno de los dos clubes puede pedir una revisión');
    end if;
    if array_length(v_clubes, 1) > 1 then
        return json_build_object('ok', false,
            'reason', 'Administras los dos clubes de este encuentro: no puedes pedir una revisión en nombre de uno solo');
    end if;
    v_club := v_clubes[1];

    -- ── qué medida se revisa ────────────────────────────────────
    if p_sancion_id is not null then
        select * into v_san from public.club_sanctions
         where id = p_sancion_id
           and club_id = v_club
           and (challenge_id = v_row.id or challenge_id is null);
        if not found then
            return json_build_object('ok', false,
                'reason', 'Esa sanción no es de tu club o no corresponde a este encuentro');
        end if;
    else
        select * into v_san from public.club_sanctions
         where club_id = v_club
           and challenge_id = v_row.id
           and estado in ('vigente', 'provisional')
         order by created_at desc
         limit 1;
    end if;

    v_tipo := case when v_san.id is not null then 'sancion' else 'cancelacion' end;

    select * into v_match from public.matches where id = v_row.match_id;
    select * into v_rep   from public.club_match_noshow_reports where challenge_id = v_row.id;

    -- Sin sanción, lo que se revisa es la cancelación: tiene que haber
    -- una. Pedir la revisión de un encuentro que sigue su curso normal no
    -- es una revisión, es una consulta.
    if v_tipo = 'cancelacion'
       and v_row.estado <> 'cancelado'
       and coalesce(v_match.estado, '') <> 'cancelado'
       and v_rep.id is null then
        return json_build_object('ok', false,
            'reason', 'Todavía no hay ninguna cancelación ni sanción que revisar en este encuentro');
    end if;

    -- ── una revisión por medida ─────────────────────────────────
    select * into v_rev from public.club_sanction_reviews
     where club_id = v_club
       and challenge_id = v_row.id
       and (
            (v_san.id is not null and sancion_id = v_san.id)
         or (v_san.id is null and sancion_id is null)
       );
    if found then
        if v_rev.estado = 'pendiente' then
            return json_build_object('ok', true, 'already', true,
                'reviewId', v_rev.id, 'tipo', v_rev.tipo, 'sancionId', v_rev.sancion_id);
        end if;
        return json_build_object('ok', false,
            'reason', 'Esta medida ya se revisó y la decisión está en el chat del encuentro');
    end if;

    -- ── el expediente ───────────────────────────────────────────
    -- Se copia AHORA, no al resolver: lo que se reclama es lo que había
    -- en este instante.
    select array_to_json(array_agg(e))::jsonb into v_eventos
      from (
        select tipo, created_at, club_id, actor_id, payload
          from public.club_challenge_events
         where challenge_id = v_row.id
           and tipo in ('encuentro_cancelado', 'sancion_aplicada', 'sancion_retirada',
                        'incomparecencia_reportada', 'revision_solicitada', 'revision_resuelta',
                        'cambio_propuesto', 'cambio_respondido',
                        'propuesta_aprobada', 'partido_publicado', 'partido_en_juego')
         order by created_at
         limit 50
      ) e;

    select max(created_at) into v_cancel from public.club_challenge_events
     where challenge_id = v_row.id and tipo = 'encuentro_cancelado';

    select count(*) into v_inscri from public.attendees
     where id_partido = v_row.match_id
       and estado in ('pendiente', 'inscrito', 'confirmado_gps');

    v_ctx := jsonb_build_object(
        'desafio', jsonb_build_object(
            'id',                    v_row.id,
            'estado',                v_row.estado,
            'estado_previo_sancion', v_row.estado_previo_sancion,
            'club_retador_id',       v_row.club_retador_id,
            'club_retado_id',        v_row.club_retado_id,
            'created_at',            v_row.created_at,
            'responded_at',          v_row.responded_at,
            'motivo_cierre',         v_row.motivo_cierre),
        'partido', case when v_match.id is null then null else jsonb_build_object(
            'id',                 v_match.id,
            'titulo',             v_match.titulo,
            'hora',               v_match.hora,
            'duracion_min',       v_match.duracion_min,
            'estado',             v_match.estado,
            'motivo_cancelacion', v_match.motivo_cancelacion,
            'cancha_nombre',      v_match.cancha_nombre,
            'comuna',             v_match.comuna,
            'inscritos',          v_inscri) end,
        'sancion', case when v_san.id is null then null else jsonb_build_object(
            'id',        v_san.id,
            'tipo',      v_san.tipo,
            'motivo',    v_san.motivo,
            'estado',    v_san.estado,
            'inicio_at', v_san.inicio_at,
            'fin_at',    v_san.fin_at) end,
        'incomparecencia', case when v_rep.id is null then null else jsonb_build_object(
            'id',                 v_rep.id,
            'club_reportante_id', v_rep.club_reportante_id,
            'club_reportado_id',  v_rep.club_reportado_id,
            'motivo',             v_rep.motivo,
            'created_at',         v_rep.created_at) end,
        'tiempos', jsonb_build_object(
            'capturado_at',            now(),
            'hora_partido',            v_match.hora,
            'cancelado_at',            v_cancel,
            -- Las dos cifras que decide todo el ciclo: con cuántas horas
            -- de aviso se canceló, y a cuántas horas del partido se pide
            -- la revisión.
            'horas_de_aviso',          case when v_cancel is null or v_match.hora is null then null
                                            else round(extract(epoch from (v_match.hora - v_cancel)) / 3600.0, 2) end,
            'horas_desde_el_partido',  case when v_match.hora is null then null
                                            else round(extract(epoch from (now() - v_match.hora)) / 3600.0, 2) end),
        'eventos', coalesce(v_eventos, '[]'::jsonb));

    select nombre into v_nombre from public.clubs where id = v_club;
    select username into v_user from public.profiles where id = v_me;

    begin
        insert into public.club_sanction_reviews (
            club_id, challenge_id, match_id, sancion_id, tipo,
            motivo, contexto, solicitada_por)
        values (v_club, v_row.id, v_row.match_id, v_san.id, v_tipo,
            v_motivo, v_ctx, v_me)
        returning * into v_rev;
    exception when unique_violation then
        select * into v_rev from public.club_sanction_reviews
         where (v_san.id is not null and sancion_id = v_san.id)
            or (v_san.id is null and challenge_id = v_row.id and club_id = v_club and sancion_id is null);
        return json_build_object('ok', true, 'already', true,
            'reviewId', v_rev.id, 'tipo', v_rev.tipo, 'sancionId', v_rev.sancion_id);
    end;

    -- ── el desafío se congela mientras dure la revisión ─────────
    -- `bloqueado_sancion` es un estado real y reversible (decisión C2
    -- del plan) y `estado_previo_sancion` es lo que permite deshacerlo
    -- sin adivinar. Se congela ACÁ, y no al aplicar la sanción, para que
    -- el congelado dure exactamente lo que dura la revisión: un
    -- encuentro cuyo club nunca la pide no tiene por qué quedar
    -- atrapado.
    --
    -- SÓLO SI EL DESAFÍO SIGUE ACTIVO. Uno ya cerrado —`cancelado`,
    -- `finalizado`, `expirado`— no se congela: la revisión de una
    -- cancelación entra por acá con el desafío en `cancelado` y lo deja
    -- como está. Y los OTROS encuentros del club no se tocan nunca:
    -- ésa es la decisión C3.
    --
    -- `coalesce` sobre `estado_previo_sancion`: si el otro club ya pidió
    -- su revisión y lo congeló, el estado bueno es el PRIMERO que se
    -- guardó, no `bloqueado_sancion`.
    if v_row.estado in (
        select jsonb_array_elements_text(public.desafio_reglas() -> 'estados_activos')
    ) then
        update public.club_challenges
           set estado_previo_sancion = coalesce(estado_previo_sancion, estado),
               estado                = 'bloqueado_sancion'
         where id = v_row.id
           and estado <> 'bloqueado_sancion';
    end if;

    -- El evento NO lleva el motivo. Que se pidió una revisión es público
    -- para los dos clubes; lo que se le dice a quien modera, no.
    insert into public.club_challenge_events (challenge_id, tipo, actor_id, club_id, payload)
    values (v_row.id, 'revision_solicitada', v_me, v_club,
        jsonb_build_object(
            'review_id',   v_rev.id,
            'club_id',     v_club,
            'club_nombre', coalesce(v_nombre, 'Un club'),
            'tipo',        v_tipo,
            'sancion_id',  v_san.id,
            'actor_id',    v_me,
            'actor_username', v_user));

    return json_build_object(
        'ok',        true,
        'reviewId',  v_rev.id,
        'tipo',      v_tipo,
        'sancionId', v_san.id,
        'clubId',    v_club);
end;
$$;

revoke execute on function public.solicitar_revision_sancion(uuid, text, uuid) from public, anon;
grant execute on function public.solicitar_revision_sancion(uuid, text, uuid) to authenticated;

comment on function public.solicitar_revision_sancion(uuid, text, uuid) is
    'El club afectado pide que se revise una sanción o una cancelación del encuentro (migración 47c). Guarda motivo y expediente —partido, sanción, informe, tiempos y eventos del hilo— tal como estaban al pedirla.';

-- ── 8. RESOLVER LA REVISIÓN ─────────────────────────────────────
-- SÓLO `service_role`. No existe interfaz de moderación y esta migración
-- no inventa un permiso para fabricarla: hoy la resolución se ejecuta
-- desde el panel de Supabase. Queda anotado en
-- `docs/memoria/operacion/pendientes.md`.
--
-- `retirar` no borra la sanción: la marca 'retirada' —estado que
-- `club_esta_sancionado()` ya no cuenta, comprobado en el caso 25 de la
-- prueba 47—. `mantener` confirma la provisional y la deja 'vigente'.
--
-- LAS DOS descongelan el desafío, en cuanto no quede ninguna revisión
-- pendiente sobre ese encuentro: lo que lo congela es la revisión en
-- curso, no la sanción.
create or replace function public.resolver_revision_sancion(
    p_review_id uuid,
    p_decision  text,
    p_nota      text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_rev      public.club_sanction_reviews;
    v_row      public.club_challenges;
    v_dec      text;
    v_nota     text;
    v_nombre   text;
    v_estado   text;
    v_admin    record;
    v_retirada boolean := false;
begin
    v_dec := lower(btrim(coalesce(p_decision, '')));
    if v_dec not in ('retirar', 'mantener') then
        return json_build_object('ok', false,
            'reason', 'La decisión tiene que ser «retirar» o «mantener»');
    end if;

    v_nota := nullif(btrim(coalesce(p_nota, '')), '');
    if length(coalesce(v_nota, '')) > 1000 then
        return json_build_object('ok', false, 'reason', 'La nota no puede pasar de 1000 caracteres');
    end if;

    select * into v_rev from public.club_sanction_reviews where id = p_review_id for update;
    if not found then
        return json_build_object('ok', false, 'reason', 'Esa revisión no existe');
    end if;
    if v_rev.estado = 'resuelta' then
        return json_build_object('ok', true, 'already', true,
            'reviewId', v_rev.id, 'decision', v_rev.decision);
    end if;

    if v_dec = 'retirar' and v_rev.sancion_id is null then
        return json_build_object('ok', false,
            'reason', 'Esta revisión es de una cancelación y no tiene ninguna sanción que retirar');
    end if;

    select * into v_row from public.club_challenges where id = v_rev.challenge_id for update;

    if v_dec = 'retirar' then
        update public.club_sanctions
           set estado = 'retirada'
         where id = v_rev.sancion_id
           and estado in ('vigente', 'provisional');
        v_retirada := true;
    else
        -- Mantener confirma la provisional. Una que ya era 'vigente' o
        -- que se cumplió no se toca.
        update public.club_sanctions
           set estado = 'vigente'
         where id = v_rev.sancion_id
           and estado = 'provisional';
    end if;

    -- ── el desafío se descongela ────────────────────────────────
    -- En las DOS decisiones, porque lo que congela es la revisión en
    -- curso y no la sanción: mantenerla deja al club sin poder abrir
    -- desafíos NUEVOS durante 14 días, que es el castigo, pero no tiene
    -- por qué dejar este encuentro atrapado para siempre.
    --
    -- Y sólo cuando no queda ninguna otra pendiente: si los dos clubes
    -- se acusaron y pidieron revisión, el encuentro sigue congelado
    -- hasta que se resuelvan las dos. `v_rev` ya está marcada como
    -- resuelta más abajo, así que acá se excluye a mano.
    if not exists (
        select 1 from public.club_sanction_reviews r
         where r.challenge_id = v_rev.challenge_id
           and r.estado = 'pendiente'
           and r.id <> v_rev.id
    ) then
        -- Vuelve EXACTAMENTE a donde estaba. Si no hay estado guardado no
        -- se inventa ninguno: se deja como está y la respuesta lo dice
        -- con `estadoRestaurado` en null.
        --
        -- El `exception` no es decorativo: `club_challenges_unique_activo`
        -- es único sobre el par de clubes para los estados activos, así
        -- que devolver este desafío a `publicado` chocaría si esos dos
        -- clubes hubieran abierto otro encuentro entretanto. Hoy no puede
        -- pasar —un club sancionado no crea ni acepta desafíos—, pero si
        -- pasara, lo que NO puede es tumbar la resolución de la revisión,
        -- que es lo que de verdad se pidió.
        begin
            update public.club_challenges
               set estado                = estado_previo_sancion,
                   estado_previo_sancion = null
             where id = v_rev.challenge_id
               and estado = 'bloqueado_sancion'
               and estado_previo_sancion is not null
            returning estado into v_estado;
        exception when unique_violation then
            v_estado := null;
        end;
    end if;

    update public.club_sanction_reviews
       set estado       = 'resuelta',
           decision     = case when v_dec = 'retirar' then 'retirada' else 'mantenida' end,
           nota         = v_nota,
           resuelta_por = auth.uid(),
           resuelta_at  = now()
     where id = v_rev.id
       and estado = 'pendiente'
    returning * into v_rev;
    if not found then
        return json_build_object('ok', true, 'already', true, 'reviewId', p_review_id);
    end if;

    select nombre into v_nombre from public.clubs where id = v_rev.club_id;

    insert into public.club_challenge_events (challenge_id, tipo, actor_id, club_id, payload)
    values (v_rev.challenge_id, 'revision_resuelta', auth.uid(), v_rev.club_id,
        jsonb_build_object(
            'review_id',         v_rev.id,
            'club_id',           v_rev.club_id,
            'club_nombre',       coalesce(v_nombre, 'Un club'),
            'tipo',              v_rev.tipo,
            'sancion_id',        v_rev.sancion_id,
            'decision',          v_rev.decision,
            'nota',              v_nota,
            'estado_restaurado', v_estado));

    -- Sólo al club que la pidió: es la respuesta a su reclamo.
    for v_admin in
        select cm.user_id from public.club_members cm
         where cm.club_id = v_rev.club_id and cm.rol = 'admin'
    loop
        insert into public.notifications (user_id, type, title, body, data)
        values (
            v_admin.user_id,
            'club_revision_resuelta',
            case when v_retirada then 'Se retiró la sanción de tu club'
                 else 'La revisión mantuvo la medida' end,
            case when v_retirada
                 then 'Revisamos lo que nos contaste y la sanción quedó sin efecto. Tu club vuelve a poder crear y aceptar desafíos.'
                 else 'Revisamos lo que nos contaste y la medida se mantiene.' end
            || coalesce(' ' || v_nota, ''),
            jsonb_build_object(
                'reviewId',    v_rev.id,
                'sancionId',   v_rev.sancion_id,
                'clubId',      v_rev.club_id,
                'challengeId', v_rev.challenge_id,
                'decision',    v_rev.decision,
                'threadKey',   'challenge:' || v_rev.challenge_id::text));
    end loop;

    return json_build_object(
        'ok',               true,
        'reviewId',         v_rev.id,
        'decision',         v_rev.decision,
        'sancionId',        v_rev.sancion_id,
        'clubId',           v_rev.club_id,
        'estadoRestaurado', v_estado);
end;
$$;

-- La única puerta. `from public` y no sólo `from anon`: `revoke ... from
-- anon` NO quita el EXECUTE que PostgreSQL concede a PUBLIC por defecto,
-- que es la lección de la 42b y de la 47b. `service_role` conserva el
-- suyo por las concesiones por defecto de Supabase, y se le vuelve a dar
-- explícitamente para que no dependa de ellas.
revoke execute on function public.resolver_revision_sancion(uuid, text, text)
    from public, anon, authenticated;
grant execute on function public.resolver_revision_sancion(uuid, text, text) to service_role;

comment on function public.resolver_revision_sancion(uuid, text, text) is
    'Resuelve una revisión: retira la sanción o la mantiene, y en los dos casos devuelve el desafío a su estado previo cuando no queda ninguna revisión pendiente sobre ese encuentro (migración 47c). SÓLO service_role: no existe interfaz de moderación y hoy se ejecuta desde el panel de Supabase.';
