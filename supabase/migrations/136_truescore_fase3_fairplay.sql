-- =============================================================
-- 136. TRUESCORE — FASE 3: FAIR PLAY
--
-- `docs/truescore-spec.md` §3 y sus decisiones (sección 8). Detrás de
-- `truescore_fase3`, que nace apagado, y encima de la fase 1 (usa sus
-- marcas de asistencia).
--
-- Fair play es un puntaje APARTE del TrueScore: 0 a 100, parte en 100
-- (`profiles.fairplay_score`), con su propio registro inmutable
-- (`fairplay_eventos`) y recalculable desde cero.
--
--   · Se reporta a un compañero hasta 48 h después del fin del partido,
--     una vez por persona y partido, con motivo: juego brusco, conducta
--     antideportiva o agresión física.
--   · Un reporte es VÁLIDO si quien reporta jugó ese partido y tenía
--     TrueScore de 75 o más al reportar. La validez se cuenta al cerrar el
--     plazo, porque el organizador puede marcar la asistencia después.
--   · Al cerrar el plazo (job): sin reportes válidos, +1; con 3 o más, −15;
--     con 1 o 2, nada.
--   · Agresión física: la reporta un compañero y la confirma el
--     organizador dentro del plazo. −40 una vez por partido y la cuenta
--     queda marcada para revisión (`fairplay_revisiones`), que por ahora se
--     resuelve desde el editor SQL con `fairplay_resolver_revision()`.
--   · «Jugó» = su inscripción terminó en `confirmado_gps` (GPS o marca del
--     organizador). El organizador jugó si confirmó la asistencia.
--   · Los encuentros entre clubes quedan fuera, igual que en TrueScore.
--
-- Se activa con `select public.truescore_activar_fase3();`.
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

insert into public.truescore_config (clave, valor, descripcion) values
  ('fairplay_inicial', '100', 'Fair play con que parte cada cuenta.'),
  ('fairplay_minimo', '0', 'Piso del fair play.'),
  ('fairplay_maximo', '100', 'Tope del fair play.'),
  ('fairplay_partido_limpio', '1', 'Fair play por jugar un partido sin reportes válidos.'),
  ('fairplay_reportes_umbral', '3', 'Reportes válidos del mismo partido desde los que se resta.'),
  ('fairplay_reportes_puntos', '15', 'Fair play que se resta con 3 o más reportes válidos.'),
  ('fairplay_agresion_puntos', '40', 'Fair play que se resta por agresión física confirmada.'),
  ('fairplay_reporte_min_truescore', '75', 'TrueScore mínimo de quien reporta para que el reporte valga.'),
  ('fairplay_plazo_horas', '48', 'Horas desde el fin del partido para reportar y para confirmar una agresión.')
on conflict (clave) do nothing;

insert into public.feature_flags (nombre, descripcion) values
  ('truescore_fase3', 'TrueScore: fair play.')
on conflict (nombre) do nothing;

alter table public.profiles
  add column if not exists fairplay_score integer not null default 100,
  add column if not exists fairplay_revision boolean not null default false;

do $$ begin
  alter table public.profiles add constraint profiles_fairplay_score_check check (fairplay_score between 0 and 100);
exception when duplicate_object then null; end $$;

alter table public.matches add column if not exists fairplay_cerrado_at timestamptz;

-- ── Registro de eventos de fair play ──

create table if not exists public.fairplay_eventos (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  match_id         uuid,
  tipo             text not null check (tipo in ('partido_limpio', 'reportes', 'agresion')),
  puntos_nominales integer not null,
  puntos_aplicados integer not null,
  puntaje_antes    integer not null,
  puntaje_despues  integer not null,
  motivo           text not null,
  detalle          jsonb not null default '{}'::jsonb,
  clave            text not null unique,
  created_at       timestamptz not null default now()
);
create index if not exists fairplay_eventos_user_idx on public.fairplay_eventos (user_id, id);
alter table public.fairplay_eventos enable row level security;
revoke all on public.fairplay_eventos from public, anon, authenticated;
grant select on public.fairplay_eventos to authenticated;
drop policy if exists fairplay_eventos_select_propio on public.fairplay_eventos;
create policy fairplay_eventos_select_propio on public.fairplay_eventos for select to authenticated using (user_id = auth.uid());

-- La misma guarda que el registro de TrueScore: nada se edita ni se borra,
-- salvo en cascada al borrar la cuenta.
drop trigger if exists trg_fairplay_eventos_inmutable on public.fairplay_eventos;
create trigger trg_fairplay_eventos_inmutable before update or delete on public.fairplay_eventos
  for each row execute function public.tg_truescore_eventos_inmutable();

create or replace function public.fairplay_calcular(p_tipo text, p_puntaje integer)
returns table (nominal integer, puntaje integer)
language plpgsql stable security definer set search_path = public as $$
declare v_nom int;
begin
  v_nom := case p_tipo
    when 'partido_limpio' then (public.truescore_cfg('fairplay_partido_limpio'))::int
    when 'reportes' then -(public.truescore_cfg('fairplay_reportes_puntos'))::int
    when 'agresion' then -(public.truescore_cfg('fairplay_agresion_puntos'))::int
  end;
  if v_nom is null then raise exception 'FAIRPLAY_TIPO_DESCONOCIDO:%', p_tipo; end if;
  return query select v_nom,
    least((public.truescore_cfg('fairplay_maximo'))::int, greatest((public.truescore_cfg('fairplay_minimo'))::int, p_puntaje + v_nom));
end $$;
revoke all on function public.fairplay_calcular(text, integer) from public, anon, authenticated;

create or replace function public.fairplay_registrar(p_user uuid, p_match uuid, p_tipo text, p_clave text, p_motivo text, p_detalle jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_antes int; c record; v_id bigint;
begin
  select fairplay_score into v_antes from public.profiles where id = p_user for update;
  if not found then return jsonb_build_object('ok', false); end if;
  if exists (select 1 from public.fairplay_eventos where clave = p_clave) then
    return jsonb_build_object('ok', true, 'duplicado', true, 'puntaje', v_antes);
  end if;
  select * into c from public.fairplay_calcular(p_tipo, v_antes);
  insert into public.fairplay_eventos (user_id, match_id, tipo, puntos_nominales, puntos_aplicados, puntaje_antes, puntaje_despues, motivo, detalle, clave)
  values (p_user, p_match, p_tipo, c.nominal, c.puntaje - v_antes, v_antes, c.puntaje, p_motivo, coalesce(p_detalle, '{}'::jsonb), p_clave)
  on conflict (clave) do nothing
  returning id into v_id;
  if v_id is null then return jsonb_build_object('ok', true, 'duplicado', true, 'puntaje', v_antes); end if;
  update public.profiles set fairplay_score = c.puntaje where id = p_user;
  return jsonb_build_object('ok', true, 'duplicado', false, 'nominal', c.nominal, 'puntaje', c.puntaje);
end $$;
revoke all on function public.fairplay_registrar(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;

create or replace function public.fairplay_recalcular(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare e record; c record; v int := (public.truescore_cfg('fairplay_inicial'))::int; v_n int := 0; v_cache int;
begin
  for e in select tipo from public.fairplay_eventos where user_id = p_user order by id loop
    select * into c from public.fairplay_calcular(e.tipo, v);
    v := c.puntaje;
    v_n := v_n + 1;
  end loop;
  select fairplay_score into v_cache from public.profiles where id = p_user;
  return jsonb_build_object('eventos', v_n, 'puntaje', v, 'cache', v_cache, 'coincide', v = v_cache);
end $$;
revoke all on function public.fairplay_recalcular(uuid) from public, anon, authenticated;

create or replace function public.truescore_activar_fase3() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.flag_activo('truescore_fase1') then
    return jsonb_build_object('ok', false, 'reason', 'Primero hay que activar la fase 1');
  end if;
  update public.feature_flags set activo = true, activado_at = coalesce(activado_at, now()) where nombre = 'truescore_fase3';
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.truescore_activar_fase3() from public, anon, authenticated;

-- ── Reportes ──

create table if not exists public.fairplay_reportes (
  id                     bigint generated always as identity primary key,
  match_id               uuid not null references public.matches(id) on delete cascade,
  reporter_id            uuid not null references public.profiles(id) on delete cascade,
  reported_id            uuid not null references public.profiles(id) on delete cascade,
  motivo                 text not null check (motivo in ('juego_brusco', 'antideportivo', 'agresion_fisica')),
  comentario             text check (comentario is null or char_length(comentario) <= 300),
  -- El TrueScore de quien reporta EN ESE MOMENTO: la regla lo pide al reportar.
  reporter_truescore     integer not null,
  agresion_confirmada_at timestamptz,
  created_at             timestamptz not null default now(),
  unique (match_id, reporter_id, reported_id),
  check (reporter_id <> reported_id)
);
alter table public.fairplay_reportes enable row level security;
revoke all on public.fairplay_reportes from public, anon, authenticated;

create table if not exists public.fairplay_revisiones (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  match_id    uuid references public.matches(id) on delete set null,
  reporte_id  bigint references public.fairplay_reportes(id) on delete set null,
  estado      text not null default 'pendiente' check (estado in ('pendiente', 'resuelta')),
  nota        text,
  created_at  timestamptz not null default now(),
  resuelta_at timestamptz
);
alter table public.fairplay_revisiones enable row level security;
revoke all on public.fairplay_revisiones from public, anon, authenticated;

-- ¿Jugó este partido? Su inscripción terminó confirmada (GPS o marca del
-- organizador); el organizador, si confirmó la asistencia.
create or replace function public.fairplay_jugo(p_match_id uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.attendees a
                  where a.id_partido = p_match_id and a.id_jugador = p_user and a.estado = 'confirmado_gps')
      or exists (select 1 from public.matches m
                  where m.id = p_match_id and m.id_organizador = p_user and m.asistencia_confirmada_at is not null);
$$;
revoke all on function public.fairplay_jugo(uuid, uuid) from public, anon, authenticated;

create or replace function public.fairplay_reporte_valido(p_reporte_id bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select r.reporter_truescore >= (public.truescore_cfg('fairplay_reporte_min_truescore'))::int
     and public.fairplay_jugo(r.match_id, r.reporter_id)
    from public.fairplay_reportes r where r.id = p_reporte_id;
$$;
revoke all on function public.fairplay_reporte_valido(bigint) from public, anon, authenticated;

create or replace function public.fairplay_reportar(p_match_id uuid, p_reportado uuid, p_motivo text, p_comentario text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_match record; v_fin timestamptz; v_ts int; v_id bigint;
  v_plazo interval := make_interval(hours => (public.truescore_cfg('fairplay_plazo_horas'))::int);
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'No autenticado'); end if;
  if not (public.flag_activo('truescore_fase1') and public.flag_activo('truescore_fase3')) then
    return jsonb_build_object('ok', false, 'reason', 'Los reportes de fair play todavía no están disponibles');
  end if;
  if p_motivo not in ('juego_brusco', 'antideportivo', 'agresion_fisica') then
    return jsonb_build_object('ok', false, 'reason', 'Motivo no válido');
  end if;
  if p_reportado = v_uid then return jsonb_build_object('ok', false, 'reason', 'No puedes reportarte a ti mismo'); end if;
  select * into v_match from public.matches where id = p_match_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'El partido no existe'); end if;
  if v_match.challenge_proposal_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'Los encuentros entre clubes no tienen reportes de fair play');
  end if;
  if v_match.estado = 'cancelado' then return jsonb_build_object('ok', false, 'reason', 'Este partido no se jugó'); end if;
  v_fin := v_match.hora + make_interval(mins => coalesce(v_match.duracion_min, 90));
  if now() < v_fin then return jsonb_build_object('ok', false, 'reason', 'Podrás reportar cuando termine el partido'); end if;
  if now() > v_fin + v_plazo then
    return jsonb_build_object('ok', false, 'reason',
      format('Pasaron las %s h para reportar este partido', public.truescore_cfg('fairplay_plazo_horas')));
  end if;
  if not exists (select 1 from public.attendees where id_partido = p_match_id and id_jugador = v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'Solo pueden reportar quienes estaban en el partido');
  end if;
  if not exists (select 1 from public.attendees where id_partido = p_match_id and id_jugador = p_reportado) then
    return jsonb_build_object('ok', false, 'reason', 'Esa persona no estaba en el partido');
  end if;
  select trust_score into v_ts from public.profiles where id = v_uid;
  insert into public.fairplay_reportes (match_id, reporter_id, reported_id, motivo, comentario, reporter_truescore)
  values (p_match_id, v_uid, p_reportado, p_motivo, nullif(btrim(coalesce(p_comentario, '')), ''), coalesce(v_ts, 0))
  on conflict (match_id, reporter_id, reported_id) do nothing
  returning id into v_id;
  if v_id is null then return jsonb_build_object('ok', false, 'reason', 'Ya reportaste a esta persona en este partido'); end if;
  if p_motivo = 'agresion_fisica' and v_match.id_organizador <> v_uid then
    insert into public.notifications (user_id, type, title, body, data)
    values (v_match.id_organizador, 'match_attendance', 'Reportaron una agresión física',
            format('Un jugador reportó una agresión física en «%s». Revísalo en Gestionar partido: si la viste, confírmala.', v_match.titulo),
            jsonb_build_object('matchId', p_match_id));
  end if;
  return jsonb_build_object('ok', true, 'reporte_id', v_id);
end $$;
revoke all on function public.fairplay_reportar(uuid, uuid, text, text) from public, anon;
grant execute on function public.fairplay_reportar(uuid, uuid, text, text) to authenticated;

-- A quiénes reporté en este partido (no se muestra quién te reportó a ti).
create or replace function public.fairplay_mis_reportes(p_match_id uuid)
returns table (reported_id uuid, motivo text)
language sql stable security definer set search_path = public as $$
  select r.reported_id, r.motivo from public.fairplay_reportes r
   where r.match_id = p_match_id and r.reporter_id = auth.uid();
$$;
revoke all on function public.fairplay_mis_reportes(uuid) from public, anon;
grant execute on function public.fairplay_mis_reportes(uuid) to authenticated;

-- Para el organizador: los jugadores con agresión física reportada.
create or replace function public.fairplay_agresiones_del_partido(p_match_id uuid)
returns table (reported_id uuid, usuario text, reportes integer, confirmada boolean, reporte_id bigint)
language sql stable security definer set search_path = public as $$
  select r.reported_id, p.username, count(*)::int, bool_or(r.agresion_confirmada_at is not null), min(r.id)
    from public.fairplay_reportes r
    join public.profiles p on p.id = r.reported_id
    join public.matches m on m.id = r.match_id
   where r.match_id = p_match_id and r.motivo = 'agresion_fisica' and m.id_organizador = auth.uid()
   group by r.reported_id, p.username
   order by p.username;
$$;
revoke all on function public.fairplay_agresiones_del_partido(uuid) from public, anon;
grant execute on function public.fairplay_agresiones_del_partido(uuid) to authenticated;

create or replace function public.fairplay_confirmar_agresion(p_reporte_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_rep record; v_match record; v_fin timestamptz; v_fp jsonb;
  v_plazo interval := make_interval(hours => (public.truescore_cfg('fairplay_plazo_horas'))::int);
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'No autenticado'); end if;
  if not public.flag_activo('truescore_fase3') then
    return jsonb_build_object('ok', false, 'reason', 'Los reportes de fair play todavía no están disponibles');
  end if;
  select * into v_rep from public.fairplay_reportes where id = p_reporte_id for update;
  if not found or v_rep.motivo <> 'agresion_fisica' then
    return jsonb_build_object('ok', false, 'reason', 'No hay una agresión reportada con ese número');
  end if;
  select * into v_match from public.matches where id = v_rep.match_id;
  if v_match.id_organizador <> v_uid then
    return jsonb_build_object('ok', false, 'reason', 'Solo el organizador confirma una agresión');
  end if;
  v_fin := v_match.hora + make_interval(mins => coalesce(v_match.duracion_min, 90));
  if now() > v_fin + v_plazo then
    return jsonb_build_object('ok', false, 'reason', 'Terminó el plazo para confirmar esta agresión');
  end if;
  update public.fairplay_reportes set agresion_confirmada_at = coalesce(agresion_confirmada_at, now())
   where match_id = v_rep.match_id and reported_id = v_rep.reported_id and motivo = 'agresion_fisica';
  v_fp := public.fairplay_registrar(v_rep.reported_id, v_rep.match_id, 'agresion',
    'agresion:' || v_rep.match_id || ':' || v_rep.reported_id,
    format('Agresión física confirmada por el organizador en «%s»', v_match.titulo),
    jsonb_build_object('reporte_id', v_rep.id));
  if (v_fp->>'duplicado')::boolean then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  update public.profiles set fairplay_revision = true where id = v_rep.reported_id;
  insert into public.fairplay_revisiones (user_id, match_id, reporte_id) values (v_rep.reported_id, v_rep.match_id, v_rep.id);
  insert into public.notifications (user_id, type, title, body, data)
  values (v_rep.reported_id, 'match_attendance', 'Se confirmó una agresión física',
          format('El organizador de «%s» confirmó una agresión física. Tu fair play bajó %s puntos y tu cuenta quedó en revisión.',
                 v_match.titulo, public.truescore_cfg('fairplay_agresion_puntos')),
          jsonb_build_object('matchId', v_rep.match_id));
  return jsonb_build_object('ok', true, 'fairplay', (v_fp->>'puntaje')::int);
end $$;
revoke all on function public.fairplay_confirmar_agresion(bigint) from public, anon;
grant execute on function public.fairplay_confirmar_agresion(bigint) to authenticated;

-- Cierra el plazo de reportes de los partidos terminados hace 48 h o más.
create or replace function public.fairplay_cerrar_partidos() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_desde timestamptz; m record; r record; v_validos int; v_n int := 0; v_fp jsonb;
  v_plazo interval := make_interval(hours => (public.truescore_cfg('fairplay_plazo_horas'))::int);
  v_umbral int := (public.truescore_cfg('fairplay_reportes_umbral'))::int;
begin
  if not (public.flag_activo('truescore_fase1') and public.flag_activo('truescore_fase3')) then return 0; end if;
  select activado_at into v_desde from public.feature_flags where nombre = 'truescore_fase3';
  for m in select * from public.matches
     where challenge_proposal_id is null and estado <> 'cancelado' and fairplay_cerrado_at is null
       and hora + make_interval(mins => coalesce(duracion_min, 90)) + v_plazo <= now()
       and hora + make_interval(mins => coalesce(duracion_min, 90)) > v_desde - v_plazo
     order by id for update skip locked
  loop
    -- Quienes jugaron: inscripciones confirmadas y el organizador si confirmó.
    for r in
      select a.id_jugador from public.attendees a
       where a.id_partido = m.id and public.fairplay_jugo(m.id, a.id_jugador)
       order by a.id_jugador
    loop
      select count(*) into v_validos from public.fairplay_reportes fr
       where fr.match_id = m.id and fr.reported_id = r.id_jugador and public.fairplay_reporte_valido(fr.id);
      if v_validos = 0 then
        perform public.fairplay_registrar(r.id_jugador, m.id, 'partido_limpio', 'fairplay:' || m.id || ':' || r.id_jugador,
          format('Jugaste «%s» sin reportes', m.titulo));
      elsif v_validos >= v_umbral then
        v_fp := public.fairplay_registrar(r.id_jugador, m.id, 'reportes', 'fairplay:' || m.id || ':' || r.id_jugador,
          format('%s compañeros reportaron tu juego en «%s»', v_validos, m.titulo), jsonb_build_object('reportes_validos', v_validos));
        if not coalesce((v_fp->>'duplicado')::boolean, true) then
          insert into public.notifications (user_id, type, title, body, data)
          values (r.id_jugador, 'match_attendance', 'Tu fair play bajó',
                  format('Varios compañeros reportaron tu juego en «%s». Tu fair play bajó %s puntos.', m.titulo, public.truescore_cfg('fairplay_reportes_puntos')),
                  jsonb_build_object('matchId', m.id));
        end if;
      end if;
    end loop;
    update public.matches set fairplay_cerrado_at = now() where id = m.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.fairplay_cerrar_partidos() from public, anon, authenticated;
do $$ begin perform cron.unschedule('futfinder-fairplay'); exception when others then null; end $$;
select cron.schedule('futfinder-fairplay', '*/15 * * * *', 'select public.fairplay_cerrar_partidos()');

-- Sólo desde el editor SQL: cierra una revisión y, si no le quedan otras
-- pendientes, quita la marca de la cuenta.
create or replace function public.fairplay_resolver_revision(p_revision_id bigint, p_nota text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  update public.fairplay_revisiones set estado = 'resuelta', resuelta_at = now(), nota = p_nota
   where id = p_revision_id and estado = 'pendiente'
  returning user_id into v_user;
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'No hay una revisión pendiente con ese número'); end if;
  if not exists (select 1 from public.fairplay_revisiones where user_id = v_user and estado = 'pendiente') then
    update public.profiles set fairplay_revision = false where id = v_user;
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.fairplay_resolver_revision(bigint, text) from public, anon, authenticated;

-- La guarda de `matches` de la 134 protege también la columna nueva.
create or replace function public.tg_matches_truescore_protegido() returns trigger language plpgsql set search_path = public as $$
begin
  if current_user <> 'authenticated' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if public.flag_activo('truescore_fase1') and old.challenge_proposal_id is null
       and exists (select 1 from public.attendees a where a.id_partido = old.id and a.id_jugador <> old.id_organizador and a.estado in ('inscrito', 'confirmado_gps')) then
      raise exception 'CANCELAR_CON_RPC';
    end if;
    return old;
  end if;
  if new.tipo_cancelacion is distinct from old.tipo_cancelacion
     or new.asistencia_confirmada_at is distinct from old.asistencia_confirmada_at
     or new.asistencia_vencida_at is distinct from old.asistencia_vencida_at
     or new.fairplay_cerrado_at is distinct from old.fairplay_cerrado_at then
    raise exception 'COLUMNA_PROTEGIDA';
  end if;
  if public.flag_activo('truescore_fase1') and new.estado = 'cancelado' and old.estado is distinct from 'cancelado' then
    raise exception 'CANCELAR_CON_RPC';
  end if;
  return new;
end $$;

create or replace function public.truescore_ajustes() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'fase1', public.flag_activo('truescore_fase1'),
    'fase2', public.flag_activo('truescore_fase2'),
    'fase3', public.flag_activo('truescore_fase3'),
    'telefono_obligatorio', public.flag_activo('telefono_obligatorio'),
    'niveles', public.truescore_cfg('niveles'),
    'tarde_minutos', public.truescore_cfg('tarde_minutos'),
    'confirmacion_plazo_horas', public.truescore_cfg('confirmacion_plazo_horas'),
    'puntaje_inicial', public.truescore_cfg('puntaje_inicial'),
    'reclamo_plazo_horas', public.truescore_cfg('reclamo_plazo_horas'),
    'reclamo_confirmaciones', public.truescore_cfg('reclamo_confirmaciones'),
    'fairplay_plazo_horas', public.truescore_cfg('fairplay_plazo_horas'));
$$;
