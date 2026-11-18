-- =============================================================
-- LIMPIEZA ANTES DEL LANZAMIENTO
--
-- Deja la base de producción vacía de contenido de prueba y conserva la
-- configuración. NO es una migración: se corre UNA vez, a mano, el día
-- antes de abrir la app (ver README.md de esta carpeta).
--
-- Se BORRA todo el contenido: partidos, clubes, desafíos, mensajes,
-- amistades, avisos, reservas, recintos (complejos, canchas, solicitudes),
-- reportes, TrueScore, y las cuentas que no estén en la lista de abajo.
--
-- Se CONSERVA: el esquema, las funciones, las políticas, los disparadores,
-- los cron jobs, Vault, `feature_flags`, `truescore_config`, y de las
-- cuentas de la lista: su login, su perfil (con las estadísticas en cero),
-- teléfono, ubicación, aceptaciones legales, tokens de push, fotos de
-- perfil y su fila de moderador.
--
-- Los archivos de Storage NO se pueden borrar por SQL
-- (`storage.protect_delete`): eso lo hace `limpiar-storage.mjs`, DESPUÉS
-- de esto.
--
-- Va sin `begin`/`commit` a propósito: quien lo corre lo envuelve. Para el
-- ensayo, `begin; <este archivo> rollback;`. Para la vez de verdad,
-- `begin; <este archivo> commit;`. Cualquier guarda que falle aborta todo.
-- =============================================================

-- ── 0. EDITAR: las cuentas que se salvan, por correo ──────────────────
-- Dejar la lista vacía borra TODAS las cuentas, incluida la de moderación;
-- para eso hay que cambiar también `v_permitir_cero` a true en el paso 1.
create temp table _conservar_correos (email text primary key) on commit drop;
insert into _conservar_correos (email) values
  ('CAMBIAR@ejemplo.cl');

-- ── 1. Guardas: nada se borra si algo no calza ────────────────────────
create temp table _conservar (id uuid primary key) on commit drop;

do $$
declare
  v_permitir_cero constant boolean := false;
  v_faltan text;
  v_plata bigint;
  v_sin_clasificar text;
begin
  -- Un correo mal escrito no puede convertirse en «borrar esa cuenta».
  select string_agg(c.email, ', ') into v_faltan
    from _conservar_correos c
   where not exists (select 1 from auth.users u where lower(u.email) = lower(c.email));
  if v_faltan is not null then
    raise exception 'LIMPIEZA: estos correos no existen, no se borró nada: %', v_faltan;
  end if;

  insert into _conservar (id)
  select u.id from auth.users u join _conservar_correos c on lower(u.email) = lower(c.email);

  if not v_permitir_cero and not exists (select 1 from _conservar) then
    raise exception 'LIMPIEZA: la lista de cuentas a conservar está vacía; si de verdad es eso, v_permitir_cero = true';
  end if;

  -- Plata real: si alguna vez hubo un cobro, pago o saldo, esto no es una
  -- base de pruebas y los registros contables se conservan por ley.
  select (select count(*) from public.pagos)
       + (select count(*) from public.balance_movimientos)
       + (select count(*) from public.autorizaciones_cobro)
       + (select count(*) from public.reserva_cobros)
       + (select count(*) from public.reserva_comisiones)
    into v_plata;
  if v_plata > 0 then
    raise exception 'LIMPIEZA: hay % registros de plata (pagos, saldos, cobros); no se borra nada sin revisarlos a mano', v_plata;
  end if;

  -- Toda tabla de `public` tiene que estar clasificada abajo (paso 2 o 3).
  -- Una tabla nueva sin clasificar frena todo: puede ser configuración.
  select string_agg(c.relname, ', ' order by c.relname) into v_sin_clasificar
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
     and c.relname not in (
       -- se conservan (paso 3)
       'feature_flags', 'truescore_config',
       'profiles', 'perfil_telefonos', 'perfil_ubicaciones', 'aceptaciones_legales',
       'push_tokens', 'profile_photos', 'moderadores',
       -- se vacían (paso 2)
       'attendees', 'autorizaciones_cobro', 'autorizaciones_recinto', 'balance_movimientos',
       'blocked_users', 'cancha_bloqueos', 'cancha_horario_reglas', 'cancha_tarifas',
       'cancha_usos', 'canchas', 'canchas_reservables', 'chat_hides', 'chat_mutes',
       'chat_reads', 'club_challenge_events', 'club_challenge_extension_replies',
       'club_challenge_proposals', 'club_challenges', 'club_join_requests', 'club_lineups',
       'club_match_changes', 'club_match_locations', 'club_match_noshow_reports',
       'club_match_results', 'club_member_apodos', 'club_member_permission_overrides',
       'club_members', 'club_open_challenge_responses', 'club_open_challenges',
       'club_photos', 'club_role_permissions', 'club_sanction_reviews', 'club_sanctions',
       'clubs', 'complejo_admins', 'complejo_calificaciones', 'complejo_cobros',
       'complejo_fotos', 'complejo_servicios', 'complejos', 'conciliaciones', 'cuentas_por_limpiar',
       'fairplay_eventos', 'fairplay_reportes', 'fairplay_revisiones', 'friendships',
       'match_asientos', 'match_expulsiones', 'match_invitaciones', 'match_waitlist',
       'matches', 'messages', 'notifications', 'pagos', 'push_tickets', 'rate_limit_hits',
       'ratings', 'reserva_cobros', 'reserva_comisiones', 'reserva_contacto',
       'reserva_participantes', 'reservas', 'solicitudes_recinto', 'support_tickets',
       'truescore_eventos', 'truescore_reclamo_confirmaciones', 'truescore_reclamos',
       'trust_score_history', 'user_reports'
     );
  if v_sin_clasificar is not null then
    raise exception 'LIMPIEZA: tablas nuevas sin clasificar (¿contenido o configuración?): %', v_sin_clasificar;
  end if;
end $$;

-- ── 2. El contenido: TRUNCATE ─────────────────────────────────────────
-- TRUNCATE y no DELETE: no dispara los disparadores de fila, así que no
-- nacen avisos ni pushes por cada partido cancelado o club borrado, y las
-- guardas de borrado (`el_club_no_se_queda_sin_admin`, etc.) no se meten.
-- Sin CASCADE: si alguna tabla conservada apuntara a una de éstas, Postgres
-- aborta en vez de vaciarla en silencio.
truncate table
  public.attendees, public.autorizaciones_cobro, public.autorizaciones_recinto,
  public.balance_movimientos, public.blocked_users, public.cancha_bloqueos,
  public.cancha_horario_reglas, public.cancha_tarifas, public.cancha_usos,
  public.canchas, public.canchas_reservables, public.chat_hides, public.chat_mutes,
  public.chat_reads, public.club_challenge_events, public.club_challenge_extension_replies,
  public.club_challenge_proposals, public.club_challenges, public.club_join_requests,
  public.club_lineups, public.club_match_changes, public.club_match_locations,
  public.club_match_noshow_reports, public.club_match_results, public.club_member_apodos,
  public.club_member_permission_overrides, public.club_members,
  public.club_open_challenge_responses, public.club_open_challenges, public.club_photos,
  public.club_role_permissions, public.club_sanction_reviews, public.club_sanctions,
  public.clubs, public.complejo_admins, public.complejo_calificaciones,
  public.complejo_cobros, public.complejo_fotos, public.complejo_servicios,
  public.complejos, public.conciliaciones, public.cuentas_por_limpiar, public.fairplay_eventos,
  public.fairplay_reportes, public.fairplay_revisiones, public.friendships,
  public.match_asientos, public.match_expulsiones, public.match_invitaciones,
  public.match_waitlist, public.matches, public.messages, public.notifications,
  public.pagos, public.push_tickets, public.rate_limit_hits, public.ratings,
  public.reserva_cobros, public.reserva_comisiones, public.reserva_contacto,
  public.reserva_participantes, public.reservas, public.solicitudes_recinto,
  public.support_tickets, public.truescore_eventos,
  public.truescore_reclamo_confirmaciones, public.truescore_reclamos,
  public.trust_score_history, public.user_reports;

-- ── 3. Las cuentas ────────────────────────────────────────────────────
-- Borrar de auth.users arrastra en cascada perfil, teléfono, ubicación,
-- aceptaciones, tokens, fotos de perfil, sesiones e identidades.
delete from auth.users u where not exists (select 1 from _conservar c where c.id = u.id);

-- Las que se salvan empiezan de cero: sin historial, sus números tampoco.
update public.profiles set
  trust_score = default,
  partidos_jugados = default,
  asistencias_confirmadas = default,
  mvps = default,
  rating_puntualidad_avg = default,
  rating_fairplay_avg = default,
  rating_nivel_avg = default,
  rating_count = default,
  truescore_racha = default,
  fairplay_score = default,
  fairplay_revision = default,
  estado = default,
  suspended_until = null;

-- ── 4. Comprobación: si algo quedó, se revierte todo ──────────────────
do $$
declare
  v_quedan text;
  v_usuarios bigint;
  v_esperados bigint;
begin
  select string_agg(t, ', ') into v_quedan from (
    select 'matches' t where exists (select 1 from public.matches)
    union all select 'clubs' where exists (select 1 from public.clubs)
    union all select 'messages' where exists (select 1 from public.messages)
    union all select 'notifications' where exists (select 1 from public.notifications)
    union all select 'friendships' where exists (select 1 from public.friendships)
    union all select 'complejos' where exists (select 1 from public.complejos)
    union all select 'canchas' where exists (select 1 from public.canchas)
  ) x;
  if v_quedan is not null then
    raise exception 'LIMPIEZA: quedó contenido en: %', v_quedan;
  end if;

  select count(*) into v_usuarios from auth.users;
  select count(*) into v_esperados from _conservar;
  if v_usuarios <> v_esperados then
    raise exception 'LIMPIEZA: quedaron % cuentas y se esperaban %', v_usuarios, v_esperados;
  end if;
  if (select count(*) from public.profiles) <> v_esperados then
    raise exception 'LIMPIEZA: los perfiles no calzan con las cuentas conservadas';
  end if;
  if not exists (select 1 from public.feature_flags) or not exists (select 1 from public.truescore_config) then
    raise exception 'LIMPIEZA: se perdió configuración (feature_flags o truescore_config)';
  end if;
end $$;

-- Resumen de lo que queda (lo último que devuelve la corrida).
select
  (select count(*) from auth.users)              as cuentas,
  (select count(*) from public.profiles)         as perfiles,
  (select count(*) from public.moderadores)      as moderadores,
  (select count(*) from public.feature_flags)    as feature_flags,
  (select count(*) from public.truescore_config) as truescore_config,
  (select count(*) from public.matches)          as partidos,
  (select count(*) from public.clubs)            as clubes,
  (select count(*) from public.complejos)        as recintos;
