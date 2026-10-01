-- =============================================================
-- 151. LA PIEZA DE MODERACIÓN, CON EL PADRÓN VACÍO
--
-- Hay tres huecos de moderación anotados como pendientes y los tres
-- esperan lo mismo: decidir QUIÉN modera. Esta migración construye el
-- mecanismo y **no toma esa decisión**: el padrón nace vacío, así que
-- mientras nadie esté en él no cambia absolutamente nada. Nombrar a
-- alguien es un `insert` desde el panel, y es la única parte que queda
-- en manos de una persona.
--
-- POR QUÉ UN PADRÓN Y NO UN PERMISO EXISTENTE. La nota de pendientes ya
-- lo decía: conceder la resolución a `authenticated` dejaría a cualquier
-- administrador retirándose sus propias sanciones, que es exactamente lo
-- que la revisión existe para impedir. Y el rol de club tampoco sirve:
-- quien modera no puede ser parte interesada. Por eso el padrón es una
-- tabla propia, sin privilegios de cliente: ni leerla ni escribirla se
-- puede desde la app.
--
-- QUÉ QUEDA LISTO
--   · `es_moderador()` — la pregunta, en un solo lugar.
--   · `moderacion_cola()` — las tres colas en una sola llamada. Hoy nadie
--     sabe que llegó una revisión; esto es lo que permitirá mirarlas.
--   · `moderacion_resolver_revision()` — envoltorio sobre
--     `resolver_revision_sancion()`, que ya existe y ya tiene decidida su
--     semántica desde la 47c. No se toca ni se le cambian los privilegios:
--     sigue siendo de `service_role`, y esto le agrega una puerta con
--     nombre y apellido.
--   · `moderacion_reabrir_resultado()` — la que faltaba. Un resultado en
--     disputa no tenía forma de volver, y el índice único parcial de
--     `club_match_results` ya estaba preparado para admitir una propuesta
--     nueva sin chocar con la rechazada.
--
-- QUÉ **NO** HACE, a propósito
--   · No construye pantallas. Eso viene después de que exista el rol.
--   · No modera reportes de usuario. La cola los muestra —hay dos sin
--     mirar ahora mismo— pero resolverlos exige decidir estados, medidas
--     y apelación, y eso es diseño de producto, no una función.
--   · No manda avisos al reabrir un resultado. Deja su evento en el hilo,
--     que los dos clubes ven al abrirlo. Un aviso nuevo necesitaría un
--     tipo nuevo en `notifications_type_check` y, sobre todo, un texto
--     que alguien tiene que escribir. La verificación que pide el
--     pendiente no lo incluye.
--
-- UN HALLAZGO DEL ARNÉS, PARA QUIEN CONSTRUYA LA PANTALLA: quien modera
-- **no ve el hilo del desafío que modera**. La política
-- `club_challenge_events_read` exige `chat_puede_ver_desafio(...)`, y
-- quien modera no pertenece a ninguno de los dos clubes — que es
-- justamente lo que lo hace imparcial. Se midió: ve 0 eventos. No es un
-- defecto de esta migración, es el precio de no ser parte; por eso
-- `club_sanction_reviews.contexto` ya guarda el expediente copiado al
-- pedir la revisión. La pantalla necesitará su propia puerta
-- `security definer` para mostrar el hilo, o conformarse con ese
-- contexto.
--
-- EL EVENTO NUEVO NO ROMPE LAS APPS INSTALADAS: `ChallengeEventBubble`
-- tiene un `default` para los tipos que no conoce —«Hubo una novedad en
-- el desafío»— así que una app vieja lo muestra sin romperse y una nueva
-- lo dice con todas sus letras.
--
-- Idempotente: seguro de re-ejecutar.
-- Pruebas: supabase/tests/151_la_pieza_de_moderacion_test.sql
-- =============================================================

-- ── 1. El padrón ─────────────────────────────────────────────────
create table if not exists public.moderadores (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  nombrado_por uuid references auth.users(id),
  nombrado_at  timestamptz not null default now(),
  nota         text
);

alter table public.moderadores enable row level security;
-- Sin políticas y sin privilegios: ni la app lee quién modera ni puede
-- nombrar a nadie. Se entra por el panel, con `service_role`.
revoke all on public.moderadores from public, anon, authenticated;

comment on table public.moderadores is
  'Quienes moderan. Nace vacia a proposito: mientras no haya filas, la pieza de moderacion no cambia nada. Nombrar a alguien es un insert desde el panel (migracion 151).';

-- ── 2. La pregunta ───────────────────────────────────────────────
create or replace function public.es_moderador()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and exists (select 1 from public.moderadores m where m.user_id = auth.uid());
$$;

revoke all on function public.es_moderador() from public, anon;
grant execute on function public.es_moderador() to authenticated;

comment on function public.es_moderador() is
  'true si quien llama esta en el padron de moderadores. Una sola fuente para las tres puertas de moderacion (migracion 151).';

-- ── 3. Las tres colas ────────────────────────────────────────────
create or replace function public.moderacion_cola()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.es_moderador() then
    raise exception 'NO_MODERA' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'revisiones_de_sancion', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'club_id', r.club_id, 'club', c.nombre,
               'challenge_id', r.challenge_id, 'tipo', r.tipo,
               'motivo', r.motivo, 'contexto', r.contexto,
               'created_at', r.created_at) order by r.created_at)
        from public.club_sanction_reviews r
        left join public.clubs c on c.id = r.club_id
       where r.estado = 'pendiente'), '[]'::jsonb),

    'resultados_en_disputa', coalesce((
      select jsonb_agg(jsonb_build_object(
               'challenge_id', d.id,
               'club_retador', cr.nombre, 'club_retado', cd.nombre,
               'match_id', d.match_id) order by d.created_at)
        from public.club_challenges d
        left join public.clubs cr on cr.id = d.club_retador_id
        left join public.clubs cd on cd.id = d.club_retado_id
       where d.estado = 'resultado_en_disputa'), '[]'::jsonb),

    -- Se muestran, no se resuelven: resolverlos exige decidir estados,
    -- medidas y apelación, y eso es diseño de producto.
    'reportes_sin_mirar', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', u.id, 'motivo', u.motivo, 'elemento', u.elemento,
               'created_at', u.created_at) order by u.created_at)
        from public.user_reports u
       where u.reviewed_at is null), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.moderacion_cola() from public, anon;
grant execute on function public.moderacion_cola() to authenticated;

comment on function public.moderacion_cola() is
  'Las tres colas de moderacion en una llamada: revisiones de sancion pendientes, resultados en disputa y reportes sin mirar. Solo para quien este en el padron (migracion 151).';

-- ── 4. Resolver una revisión, con nombre y apellido ──────────────
-- `resolver_revision_sancion()` no se toca y sigue siendo de
-- `service_role`: su semántica está decidida desde la 47c. Esto le pone
-- una puerta para el padrón, y deja el `resuelta_por` con el id real de
-- quien decidió —hoy, desde el panel, queda en null.
create or replace function public.moderacion_resolver_revision(
  p_review_id uuid, p_decision text, p_nota text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_moderador() then
    raise exception 'NO_MODERA' using errcode = '42501';
  end if;
  return public.resolver_revision_sancion(p_review_id, p_decision, p_nota);
end;
$$;

revoke all on function public.moderacion_resolver_revision(uuid, text, text) from public, anon;
grant execute on function public.moderacion_resolver_revision(uuid, text, text) to authenticated;

-- ── 5. Reabrir un resultado en disputa ───────────────────────────
alter table public.club_challenge_events drop constraint if exists club_challenge_events_tipo_check;
alter table public.club_challenge_events add constraint club_challenge_events_tipo_check
  check (tipo = any (array[
    'aceptado','rechazado','cancelado','expirado','prorroga_abierta','prorroga_respondida',
    'sin_acuerdo','propuesta_creada','propuesta_aprobada','propuesta_rechazada',
    'partido_publicado','partido_en_juego','esperando_resultado','cambio_propuesto',
    'cambio_respondido','encuentro_cancelado','sancion_aplicada','sancion_retirada',
    'incomparecencia_reportada','revision_solicitada','revision_resuelta',
    'resultado_propuesto','resultado_confirmado','resultado_disputado',
    'resultado_reabierto']));

create or replace function public.moderacion_reabrir_resultado(
  p_challenge_id uuid, p_nota text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row  public.club_challenges;
  v_nota text;
begin
  if not public.es_moderador() then
    raise exception 'NO_MODERA' using errcode = '42501';
  end if;

  v_nota := nullif(btrim(coalesce(p_nota, '')), '');
  if length(coalesce(v_nota, '')) > 1000 then
    return json_build_object('ok', false, 'reason', 'La nota no puede pasar de 1000 caracteres');
  end if;

  select * into v_row from public.club_challenges where id = p_challenge_id for update;
  if not found then
    return json_build_object('ok', false, 'reason', 'Ese desafío no existe');
  end if;
  if v_row.estado <> 'resultado_en_disputa' then
    return json_build_object('ok', false, 'reason',
      'Sólo se puede reabrir un resultado que esté en disputa', 'estado', v_row.estado);
  end if;

  update public.club_challenges
     set estado = 'esperando_resultado'
   where id = p_challenge_id
     and estado = 'resultado_en_disputa';
  if not found then
    return json_build_object('ok', true, 'already', true, 'challengeId', p_challenge_id);
  end if;

  -- El rechazado se queda como está: `club_match_results_activo_uidx`
  -- excluye los `rechazado`, así que la propuesta nueva entra sin chocar.
  insert into public.club_challenge_events (challenge_id, tipo, actor_id, club_id, payload)
  values (p_challenge_id, 'resultado_reabierto', auth.uid(), null,
          jsonb_build_object('nota', v_nota));

  return json_build_object('ok', true, 'challengeId', p_challenge_id,
                           'estado', 'esperando_resultado');
end;
$$;

revoke all on function public.moderacion_reabrir_resultado(uuid, text) from public, anon;
grant execute on function public.moderacion_reabrir_resultado(uuid, text) to authenticated;

comment on function public.moderacion_reabrir_resultado(uuid, text) is
  'Devuelve un desafio de resultado_en_disputa a esperando_resultado para que los clubes propongan de nuevo. Solo para el padron de moderadores (migracion 151).';
