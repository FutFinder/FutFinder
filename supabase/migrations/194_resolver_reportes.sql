-- =============================================================
-- 194. RESOLVER REPORTES
--
-- Desde la 151 la moderación VE los reportes (`moderacion_cola`, «se
-- muestran, no se resuelven»), pero no podía hacer nada con ellos. Apple
-- (guía 1.2, contenido de usuarios) exige actuar sobre lo reportado —quitar
-- el contenido y sacar a quien lo publica— en un plazo razonable (24 h), y
-- Google Play lo mismo. Esta migración da las herramientas:
--
--   1. `moderacion_resolver_reporte(reporte, decisión, días, nota)`, sólo para
--      quien está en el padrón (`es_moderador()`):
--        · `descartar`        — no hay nada que hacer.
--        · `advertir`         — aviso a la persona, sin medida.
--        · `quitar_contenido` — borra lo reportado: la foto del club, el
--                               escudo y la descripción del club, la
--                               descripción y la portada del partido, o (si se
--                               reportó a la persona) su foto, portada y bio.
--        · `suspender`        — `p_dias` (1 a 365) sin poder publicar nada.
--      Los otros reportes pendientes sobre lo mismo se cierran con la misma
--      decisión, y la persona reportada recibe un aviso (salvo al descartar).
--   2. La suspensión de moderación (`moderacion_suspensiones`). La de
--      TrueScore (`profiles.estado = 'suspendido'`) sólo impide inscribirse
--      en partidos; ésta impide CREAR contenido: mensajes, partidos, clubes,
--      fotos, solicitudes de amistad, desafíos abiertos, calificaciones. Lo
--      hace un disparador BEFORE INSERT con un mensaje que dice hasta cuándo.
--      Reportar sigue permitido.
--   3. La cola trae lo necesario para decidir: la descripción, a quién se
--      reportó, cuántos reportes previos tiene y si ya está suspendida.
--
-- Pruebas: supabase/tests/194_resolver_reportes_test.sql
-- =============================================================

-- ── 0. Qué decidió quién ──────────────────────────────────────────
alter table public.user_reports
  add column if not exists moderado_por uuid references auth.users(id) on delete set null,
  add column if not exists decision text
    check (decision is null or decision in ('descartar', 'advertir', 'quitar_contenido', 'suspender')),
  add column if not exists nota_moderacion text
    check (nota_moderacion is null or length(nota_moderacion) <= 600);

-- ── 1. El aviso de moderación ─────────────────────────────────────
-- La lista entera de la 188 más `moderacion`. (En producción se aplicó
-- agregando el tipo a la restricción vigente; el resultado es el mismo.)
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = any (array[
    'match_join', 'friend_request', 'moderacion', 'friend_accept', 'message_new', 'match_reminder',
    'match_rate', 'join_request', 'join_approved', 'join_rejected', 'match_cancelled',
    'match_updated', 'match_slot_free', 'waitlist_turn', 'match_left', 'match_attendance',
    'club_request', 'club_request_accepted', 'club_request_rejected', 'club_member_joined',
    'club_member_left', 'club_invite_accepted', 'club_challenge', 'club_challenge_accepted',
    'club_challenge_rejected', 'chat_mention_all', 'club_challenge_extension',
    'club_challenge_closed', 'club_challenge_proposal', 'club_challenge_proposal_rejected',
    'club_match_published', 'club_match_reserva_omitida', 'club_match_change',
    'club_match_change_responded', 'club_match_cancelled', 'club_sancionado',
    'club_revision_resuelta', 'club_resultado_propuesto', 'club_resultado_confirmado',
    'club_resultado_disputado', 'reserva_confirmada', 'reserva_cancelada',
    'reserva_invitacion_capitan', 'reserva_invitacion_jugador', 'reserva_invitacion_rechazada',
    'reserva_cuota_recalculada', 'reserva_saldo_insuficiente', 'reserva_cancelacion_solicitada',
    'balance_cargado', 'complejo_admin_agregado', 'reserva_recordatorio_pago',
    'reserva_participante_quitado', 'reserva_cancelacion_rechazada', 'waitlist_turno_vencido',
    'club_invite']::text[]));

-- ── 2. La suspensión de moderación ────────────────────────────────
create table if not exists public.moderacion_suspensiones (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  hasta      timestamptz not null,
  reporte_id uuid references public.user_reports(id) on delete set null,
  creada_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.moderacion_suspensiones enable row level security;
revoke all on public.moderacion_suspensiones from public, anon, authenticated;

create or replace function public.tg_bloqueo_por_moderacion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hasta timestamptz;
begin
  -- Sólo lo que hace la persona desde la app. `auth.uid()` es quien llama
  -- aunque la función sea definer (sale del JWT, no de current_user).
  if auth.uid() is null or auth.role() is distinct from 'authenticated' then
    return new;
  end if;
  select hasta into v_hasta
    from public.moderacion_suspensiones
   where user_id = auth.uid() and hasta > now();
  if v_hasta is not null then
    raise exception 'Tu cuenta está suspendida hasta el % por una revisión de moderación. Si crees que es un error, escríbenos a futfindercl@gmail.com.',
      to_char(v_hasta at time zone 'America/Santiago', 'DD/MM/YYYY')
      using errcode = 'P0001', detail = 'SUSPENDIDA_POR_MODERACION';
  end if;
  return new;
end;
$$;

revoke all on function public.tg_bloqueo_por_moderacion() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'messages', 'matches', 'clubs', 'club_photos', 'profile_photos', 'friendships',
    'club_open_challenges', 'club_open_challenge_responses', 'ratings', 'complejo_calificaciones'] loop
    execute format('drop trigger if exists a_bloqueo_por_moderacion on public.%I', t);
    execute format('create trigger a_bloqueo_por_moderacion before insert on public.%I
                    for each row execute function public.tg_bloqueo_por_moderacion()', t);
  end loop;
end $$;

-- ── 3. Resolver un reporte ────────────────────────────────────────
create or replace function public.moderacion_resolver_reporte(
  p_reporte_id uuid,
  p_decision text,
  p_dias integer default null,
  p_nota text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rep public.user_reports;
  v_tipo text;
  v_id uuid;
  v_hasta timestamptz;
  v_titulo text;
  v_cuerpo text;
  v_cerrados integer;
begin
  if not public.es_moderador() then
    raise exception 'NO_MODERA' using errcode = '42501';
  end if;
  if p_decision not in ('descartar', 'advertir', 'quitar_contenido', 'suspender') then
    return json_build_object('ok', false, 'reason', 'Decisión no válida.');
  end if;
  if p_decision = 'suspender' and (p_dias is null or p_dias < 1 or p_dias > 365) then
    return json_build_object('ok', false, 'reason', 'La suspensión va de 1 a 365 días.');
  end if;

  select * into v_rep from public.user_reports where id = p_reporte_id for update;
  if v_rep.id is null then
    return json_build_object('ok', false, 'reason', 'Ese reporte no existe.');
  end if;
  if v_rep.reviewed_at is not null then
    return json_build_object('ok', false, 'reason', 'Ese reporte ya se resolvió.');
  end if;

  if v_rep.elemento is not null and position(':' in v_rep.elemento) > 0 then
    v_tipo := split_part(v_rep.elemento, ':', 1);
    begin
      v_id := split_part(v_rep.elemento, ':', 2)::uuid;
    exception when others then
      v_id := null;
    end;
  end if;

  if p_decision = 'quitar_contenido' then
    if v_tipo = 'foto_club' then
      delete from public.club_photos where id = v_id;
    elsif v_tipo = 'foto' then
      delete from public.profile_photos where id = v_id and user_id = v_rep.reported_id;
    elsif v_tipo = 'club' then
      update public.clubs set foto_url = null, banner_url = null, descripcion = null where id = v_id;
    elsif v_tipo = 'partido' then
      update public.matches set descripcion = null, foto_url = null where id = v_id;
    else
      -- Se reportó a la persona: lo que muestra su perfil.
      update public.profiles set foto_url = null, banner_url = null, bio = null
       where id = v_rep.reported_id;
    end if;
    v_titulo := 'Quitamos contenido tuyo';
    v_cuerpo := 'Revisamos un reporte y quitamos contenido que publicaste porque no cumple las reglas de convivencia de FutFinder.';
  elsif p_decision = 'suspender' then
    v_hasta := now() + make_interval(days => p_dias);
    insert into public.moderacion_suspensiones (user_id, hasta, reporte_id, creada_por)
    values (v_rep.reported_id, v_hasta, v_rep.id, auth.uid())
    on conflict (user_id) do update
      set hasta = greatest(public.moderacion_suspensiones.hasta, excluded.hasta),
          reporte_id = excluded.reporte_id, creada_por = excluded.creada_por, created_at = now();
    v_titulo := 'Tu cuenta quedó suspendida';
    v_cuerpo := format('Revisamos un reporte y suspendimos tu cuenta por %s días: hasta entonces no puedes publicar partidos, escribir mensajes ni subir fotos.', p_dias);
  elsif p_decision = 'advertir' then
    v_titulo := 'Un aviso de moderación';
    v_cuerpo := 'Recibimos un reporte sobre tu cuenta. Esta vez no tomamos medidas, pero recuerda las reglas de convivencia de FutFinder.';
  end if;

  -- Este reporte y los otros pendientes sobre lo mismo.
  update public.user_reports
     set estado = case when p_decision = 'descartar' then 'descartado' else 'revisado' end,
         reviewed_at = now(),
         moderado_por = auth.uid(),
         decision = p_decision,
         nota_moderacion = nullif(left(trim(coalesce(p_nota, '')), 600), '')
   where reviewed_at is null
     and reported_id = v_rep.reported_id
     and elemento is not distinct from v_rep.elemento;
  get diagnostics v_cerrados = row_count;

  if p_decision <> 'descartar' then
    insert into public.notifications (user_id, type, title, body, data)
    values (v_rep.reported_id, 'moderacion', v_titulo, v_cuerpo,
            jsonb_build_object('decision', p_decision, 'hasta', v_hasta));
  end if;

  return json_build_object('ok', true, 'decision', p_decision, 'reportes_cerrados', v_cerrados,
                           'suspendida_hasta', v_hasta);
end;
$$;

revoke all on function public.moderacion_resolver_reporte(uuid, text, integer, text) from public, anon;
grant execute on function public.moderacion_resolver_reporte(uuid, text, integer, text) to authenticated;

-- ── 4. La cola trae lo necesario para decidir ─────────────────────
do $$
declare
  v_def text;
  v_nuevo text;
begin
  v_def := pg_get_functiondef('public.moderacion_cola()'::regprocedure);
  if v_def like '%reportes_previos%' then
    return;
  end if;
  v_nuevo := replace(v_def,
    '''created_at'', u.created_at) order by u.created_at)',
    '''created_at'', u.created_at,
               ''descripcion'', u.descripcion,
               ''reportado_id'', u.reported_id,
               ''reportado'', (select p.username from public.profiles p where p.id = u.reported_id),
               ''reportes_previos'', (select count(*) from public.user_reports o
                                       where o.reported_id = u.reported_id and o.id <> u.id),
               ''suspendida_hasta'', (select s.hasta from public.moderacion_suspensiones s
                                       where s.user_id = u.reported_id and s.hasta > now())) order by u.created_at)');
  if v_nuevo = v_def then
    raise exception '194: moderacion_cola cambió; no encontré la lista de reportes';
  end if;
  v_nuevo := replace(v_nuevo,
    '-- Se muestran, no se resuelven: resolverlos exige decidir estados,
    -- medidas y apelación, y eso es diseño de producto.',
    '-- Se resuelven con moderacion_resolver_reporte (migración 194).');
  execute v_nuevo;
end $$;
