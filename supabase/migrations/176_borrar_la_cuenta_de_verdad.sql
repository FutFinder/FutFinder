-- =============================================================
-- 176. BORRAR LA CUENTA, DE VERDAD
--
-- `delete_my_account()` no se tocaba desde la migración 21, y la base creció
-- 150 migraciones alrededor. Medido contra producción el 2026-11-13:
--
--   1. FALLABA para cualquiera que hubiera reservado, pagado, calificado un
--      recinto, publicado una cancha nueva o bloqueado una hora: diez llaves
--      foráneas sin `ON DELETE` (reservas, reserva_participantes, pagos,
--      autorizaciones_cobro, complejo_calificaciones, complejos, canchas,
--      cancha_bloqueos, moderadores). El borrado se revertía entero con un
--      23503 y la persona veía el mensaje de Postgres, en inglés.
--   2. Cuando NO fallaba, se llevaba datos de OTRAS personas: `clubs.created_by`
--      está en cascada, así que borrar a quien fundó un club borraba el club
--      entero —integrantes, desafíos, historial—; `matches.id_organizador`
--      borraba los partidos ya jugados con la asistencia y las calificaciones
--      de los demás; y lo mismo `club_challenges.creado_por`, los desafíos
--      abiertos, sus respuestas y las formaciones.
--   3. Si la persona era la única admin de un club con integrantes, el
--      disparador `el_club_no_se_queda_sin_admin` (111) abortaba todo.
--   4. Al salir de un partido por cascada, el cupo no se devolvía (no hay
--      disparador de DELETE en `attendees`), y las reservas que organizaba
--      quedaban vivas a su nombre.
--
-- Apple (5.1.1 v), Google Play y el derecho de supresión de la Ley 21.719
-- exigen que borrar la cuenta funcione desde la app.
--
-- LO QUE HACE AHORA, en una sola transacción:
--   · Lo personal se BORRA (perfil, teléfono, ubicación, mensajes, amistades,
--     avisos, tokens, fotos de perfil, reportes, calificaciones emitidas…:
--     todo lo que ya estaba en cascada).
--   · Lo contable se ANONIMIZA, no se borra: pagos, movimientos de saldo,
--     autorizaciones de cobro y reservas pasadas quedan con el usuario en
--     nulo. Son registros de plata de terceros (el recinto, quienes pagaron
--     su parte) y hay obligación de conservarlos.
--   · Lo compartido SOBREVIVE sin autor: clubes, partidos jugados, desafíos,
--     formaciones, canchas y bloqueos quedan con el autor en nulo.
--   · Lo que está por venir se cierra con aviso: sus partidos abiertos se
--     cancelan (con el aviso de siempre a los inscritos), sus reservas
--     futuras se cancelan (con devolución a quienes pagaron), y sale de los
--     partidos y reservas ajenos devolviendo el cupo.
--   · Si era la única admin de un club con integrantes, la administración
--     pasa a quien lleva más tiempo (capitanes primero), con aviso.
--
-- LO QUE NO DEJA BORRAR, con un mensaje que dice qué hacer:
--   · Saldo a favor: se perdería. Hay que pedir la devolución primero.
--   · Reservas futuras pagadas por la propia persona: cancelarlas desde
--     «Mis reservas» le devuelve su parte; borrarse la perdería.
--   · Ser la única admin de un recinto: es un negocio con reservas de
--     terceros; el traspaso lo hace el equipo.
--
-- LO QUE ESTO NO PUEDE HACER: borrar los archivos de Storage. Supabase no
-- deja borrar `storage.objects` por SQL (`storage.protect_delete`). Por eso
-- la cuenta queda anotada en `cuentas_por_limpiar` y la Edge Function
-- `eliminar-cuenta` —que es la que llama la app desde esta versión— borra
-- las carpetas de la persona en avatars, profile-gallery, solicitud-fotos y
-- support-screenshots apenas termina esto. Las apps ya instaladas siguen
-- llamando la RPC directo: su borrado de datos ya funciona con esta
-- migración, y sus archivos quedan en la cola hasta la próxima pasada de
-- la función.
--
-- La firma no cambia (`returns void`, errores con RAISE): las apps instaladas
-- muestran `error.message`, que desde ahora es un texto propio en español.
-- =============================================================

-- ── 1. Las llaves foráneas: cada una decide qué pasa con lo de otros ──
-- Las columnas de autor pasan a aceptar nulo y la llave a `on delete set
-- null`. Las acciones referenciales corren como dueño de la tabla, así que
-- las guardas de `current_user = 'authenticated'` (102/111/129/165) no las
-- frenan, y ninguno de los disparadores de UPDATE de estas tablas mira estas
-- columnas (comprobado: `notify_match_updated` sólo avisa por hora, cancha,
-- comuna, dirección y cuota).
do $$
declare
  r record;
begin
  for r in
    select * from (values
      -- tabla,                          columna,          llave,                                             apunta a
      ('reservas',                      'organizador_id', 'reservas_organizador_id_fkey',                    'public.profiles(id)'),
      ('reserva_participantes',         'user_id',        'reserva_participantes_user_id_fkey',              'public.profiles(id)'),
      ('autorizaciones_cobro',          'user_id',        'autorizaciones_cobro_user_id_fkey',               'public.profiles(id)'),
      ('pagos',                         'user_id',        'pagos_user_id_fkey',                              'public.profiles(id)'),
      ('pagos',                         'reversado_por',  'pagos_reversado_por_fkey',                        'public.profiles(id)'),
      ('balance_movimientos',           'user_id',        'balance_movimientos_user_id_fkey',                'public.profiles(id)'),
      ('complejos',                     'created_by',     'complejos_created_by_fkey',                       'public.profiles(id)'),
      ('canchas',                       'created_by',     'canchas_created_by_fkey',                         'auth.users(id)'),
      ('cancha_bloqueos',               'creado_por',     'cancha_bloqueos_creado_por_fkey',                 'public.profiles(id)'),
      ('moderadores',                   'nombrado_por',   'moderadores_nombrado_por_fkey',                   'auth.users(id)'),
      ('clubs',                         'created_by',     'clubs_created_by_fkey',                           'public.profiles(id)'),
      ('matches',                       'id_organizador', 'matches_id_organizador_fkey',                     'public.profiles(id)'),
      ('club_challenges',               'creado_por',     'club_challenges_creado_por_fkey',                 'public.profiles(id)'),
      ('club_open_challenges',          'creado_por',     'club_open_challenges_creado_por_fkey',            'auth.users(id)'),
      ('club_open_challenge_responses', 'creado_por',     'club_open_challenge_responses_creado_por_fkey',   'auth.users(id)'),
      ('club_lineups',                  'updated_by',     'club_lineups_updated_by_fkey',                    'auth.users(id)')
    ) as t(tabla, columna, llave, destino)
  loop
    execute format('alter table public.%I alter column %I drop not null', r.tabla, r.columna);
    execute format('alter table public.%I drop constraint if exists %I', r.tabla, r.llave);
    execute format('alter table public.%I add constraint %I foreign key (%I) references %s on delete set null',
                   r.tabla, r.llave, r.columna, r.destino);
  end loop;
end $$;

-- ── 1b. Un organizador nulo no abre ninguna puerta ─────────────────
-- Con el organizador en nulo, `if v_match.id_organizador <> v_uid then
-- <rechazar>` da NULL, PL/pgSQL lo toma como falso y la guarda se salta:
-- cualquiera podría cancelar, expulsar o tomar asistencia de un partido
-- huérfano, o tocar una reserva sin dueño. Y en las consultas,
-- `a.id_jugador <> m.id_organizador` deja fuera a TODOS los inscritos.
-- Medido en producción: 21 funciones comparan así. No se transcriben (es la
-- forma más fácil de revertir lo que otra migración decidió, ver 159): se
-- toma el cuerpo DESPLEGADO y se cambia sólo `<>` por `is distinct from`
-- donde un lado es el organizador. Si en alguna no aparece el patrón, la
-- migración falla en vez de seguir creyendo que la arregló.
do $$
declare
  v_nombres constant text[] := array[
    'approve_join', 'reject_join', 'cancel_match', 'cancel_match_and_join',
    'expulsar_jugador', 'fairplay_confirmar_agresion', 'fairplay_reportar',
    'save_match_attendance', 'cancelar_reserva', 'cuota_de_reserva',
    'detalle_reserva', 'invitar_participante_reserva', 'quitar_participante_reserva',
    'recalcular_cuota_reserva', 'recordar_pago_reserva', 'autorizar_cobro_reserva',
    'notify_match_updated', 'tg_matches_truescore_protegido',
    'truescore_cerrar_sin_confirmar', 'truescore_guardar_asistencia',
    'truescore_registrar_cancelacion'];
  v_nombre text;
  f record;
  v_def text;
  v_nuevo text;
  v_tocadas int;
begin
  foreach v_nombre in array v_nombres loop
    v_tocadas := 0;
    for f in
      select p.oid from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname = v_nombre
    loop
      v_def := pg_get_functiondef(f.oid);
      v_nuevo := regexp_replace(v_def,
        '(\m[a-z_]+\.(?:id_organizador|organizador_id)\M)\s*<>\s*', '\1 is distinct from ', 'g');
      v_nuevo := regexp_replace(v_nuevo,
        '\s*<>\s*(\m[a-z_]+\.(?:id_organizador|organizador_id)\M)', ' is distinct from \1', 'g');
      if v_nuevo <> v_def then
        execute v_nuevo;
        v_tocadas := v_tocadas + 1;
      end if;
    end loop;
    if v_tocadas = 0 then
      raise exception '176: % no compara al organizador con <> (¿la redefinió otra migración?)', v_nombre;
    end if;
  end loop;
end $$;

-- `complejo_calificaciones`: la reseña es de la persona; se borra con ella
-- (y `recalc_complejo_rating` recalcula el promedio del recinto).
alter table public.complejo_calificaciones
  drop constraint if exists complejo_calificaciones_user_id_fkey;
alter table public.complejo_calificaciones
  add constraint complejo_calificaciones_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;

-- ── 2. La cola de archivos por borrar ─────────────────────────────
-- Sólo el uuid (ya no identifica a nadie: la cuenta no existe) y cuándo.
create table if not exists public.cuentas_por_limpiar (
  user_id             uuid primary key,
  borrada_at          timestamptz not null default now(),
  archivos_limpios_at timestamptz
);
alter table public.cuentas_por_limpiar enable row level security;
revoke all on public.cuentas_por_limpiar from public, anon, authenticated;
comment on table public.cuentas_por_limpiar is
  'Cuentas borradas cuyos archivos de Storage faltan por borrar (migración 176). La llena delete_my_account(); la vacía la Edge Function eliminar-cuenta con service_role. Sin políticas: ningún cliente la lee.';

-- ── 3. La función ─────────────────────────────────────────────────
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid       uuid := auth.uid();
  v_saldo     bigint;
  v_r         record;
  v_heredero  uuid;
  v_correo    constant text := 'futfindercl@gmail.com';
begin
  if v_uid is null then
    raise exception 'Inicia sesión para borrar tu cuenta.';
  end if;

  -- Dos borrados a la vez de la misma cuenta (doble toque) no se pisan.
  perform pg_advisory_xact_lock(hashtext('delete_my_account:' || v_uid::text));
  if not exists (select 1 from auth.users where id = v_uid) then
    return;
  end if;

  -- ── Lo que no deja borrar ──
  select coalesce(sum(monto), 0) into v_saldo
    from public.balance_movimientos where user_id = v_uid;
  if v_saldo > 0 then
    raise exception 'Tienes $% de saldo a favor. Escríbenos a % para devolvértelo antes de borrar tu cuenta.',
      replace(to_char(v_saldo, 'FM999,999,999'), ',', '.'), v_correo;
  end if;

  if exists (
    select 1
      from public.reservas r
     where r.estado in ('armando', 'procesando', 'confirmada')
       and public.inicio_de_reserva(r.fecha, r.hora_inicio) > now()
       and (exists (select 1 from public.balance_movimientos b
                     where b.reserva_id = r.id and b.user_id = v_uid and b.tipo = 'cobro_reserva')
            or exists (select 1 from public.pagos p
                        where p.reserva_id = r.id and p.user_id = v_uid and p.estado = 'pagado'))
  ) then
    raise exception 'Tienes reservas por jugar que ya pagaste. Cancélalas desde «Mis reservas» para que te devolvamos tu parte, o espera a jugarlas, y después borra tu cuenta.';
  end if;

  for v_r in
    select c.nombre
      from public.complejo_admins a
      join public.complejos c on c.id = a.complejo_id
     where a.user_id = v_uid
       and not exists (select 1 from public.complejo_admins o
                        where o.complejo_id = a.complejo_id and o.user_id <> v_uid)
     limit 1
  loop
    raise exception 'Administras el recinto «%» y nadie más lo hace. Escríbenos a % para traspasarlo antes de borrar tu cuenta.',
      v_r.nombre, v_correo;
  end loop;

  -- ── Lo que está por venir se cierra con aviso ──

  -- Sus partidos abiertos (no los de clubes: ésos son de los dos clubes y
  -- siguen, sin organizador). `cancel_match` avisa a inscritos y a la lista
  -- de espera, y libera la cancha si había reserva.
  for v_r in
    select id from public.matches
     where id_organizador = v_uid
       and challenge_proposal_id is null
       and estado in ('abierto', 'lleno')
       and hora > now()
  loop
    update public.matches set motivo_cancelacion = 'El organizador eliminó su cuenta.' where id = v_r.id;
    perform public.cancel_match(v_r.id, 'otro');
  end loop;

  -- Sale de los partidos ajenos que vienen, devolviendo el cupo (la cascada
  -- borraría la fila sin devolverlo). Un rechazo no frena el borrado.
  for v_r in
    select m.id, m.challenge_proposal_id is not null as de_club
      from public.attendees a
      join public.matches m on m.id = a.id_partido
     where a.id_jugador = v_uid
       and m.id_organizador is distinct from v_uid
       and m.estado in ('abierto', 'lleno')
       and m.hora > now()
  loop
    begin
      if v_r.de_club then
        perform public.leave_club_match(v_r.id);
      else
        perform public.leave_match(v_r.id);
      end if;
    exception when others then
      null;
    end;
  end loop;

  -- Sus reservas futuras: se cancelan, con devolución a quienes pagaron.
  for v_r in
    select id from public.reservas
     where organizador_id = v_uid
       and estado in ('armando', 'procesando', 'confirmada')
       and public.inicio_de_reserva(fecha, hora_inicio) > now()
  loop
    perform public.cancelar_reserva_interna(v_r.id,
      'La persona que organizaba la reserva eliminó su cuenta, así que la reserva se canceló. Si pagaste tu parte, te la devolvemos.');
  end loop;

  -- Sale de las reservas ajenas que se están armando (igual que
  -- `quitar_participante_reserva`: la autorización se invalida, no se borra).
  update public.autorizaciones_cobro ac
     set vigente = false
    from public.reservas r
   where ac.reserva_id = r.id and ac.user_id = v_uid and ac.vigente
     and r.estado = 'armando';
  delete from public.reserva_participantes rp
   using public.reservas r
   where rp.reserva_id = r.id and rp.user_id = v_uid
     and r.estado = 'armando' and r.organizador_id is distinct from v_uid;

  -- ── Ningún club se queda sin admin ──
  for v_r in
    select m.club_id, c.nombre
      from public.club_members m
      join public.clubs c on c.id = m.club_id
     where m.user_id = v_uid and m.rol = 'admin'
       and not exists (select 1 from public.club_members o
                        where o.club_id = m.club_id and o.user_id <> v_uid and o.rol = 'admin')
       and exists (select 1 from public.club_members o
                    where o.club_id = m.club_id and o.user_id <> v_uid)
  loop
    select o.user_id into v_heredero
      from public.club_members o
     where o.club_id = v_r.club_id and o.user_id <> v_uid
     order by (o.rol = 'capitan') desc, o.joined_at, o.id
     limit 1;
    update public.club_members set rol = 'admin'
     where club_id = v_r.club_id and user_id = v_heredero;
    insert into public.notifications (user_id, type, title, body, data)
    values (v_heredero, 'club_member_left', format('Ahora administras «%s»', v_r.nombre),
            format('Quien administraba «%s» eliminó su cuenta y te dejamos a cargo del club.', v_r.nombre),
            jsonb_build_object('clubId', v_r.club_id));
  end loop;

  -- ── Y la cuenta ──
  insert into public.cuentas_por_limpiar (user_id) values (v_uid)
  on conflict (user_id) do nothing;

  -- El resto lo resuelven las llaves: cascada para lo personal, nulo para lo
  -- contable y lo compartido (sección 1).
  delete from auth.users where id = v_uid;
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

comment on function public.delete_my_account() is
  'Borra la cuenta de quien llama: lo personal se borra, lo contable se anonimiza, lo compartido queda sin autor y lo futuro se cancela con aviso. Ver la cabecera de la migración 176.';
