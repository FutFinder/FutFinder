-- =============================================================
-- 164 · El recinto que pidió revisión deja de esperar a oscuras
--
-- LO QUE PASABA. `admin_solicitar_revision_complejo()` (migración 82) pone
-- `revision_pedida_at = now()` y nada más. No hay disparador, ni correo, ni
-- cola: la app le dice al dueño «te avisamos» y después NADIE SE ENTERA. En
-- producción, «los mojojo» pidió la revisión el 2026-09-14 y seguía
-- esperando 35 días después, con la app diciéndole que lo estábamos
-- mirando.
--
-- (La otra puerta, la de «quiero sumar mi recinto», sí avisa: pasa por la
-- Edge Function `solicitud-recinto`, que manda un correo. Esta segunda
-- puerta —la que usa quien YA tiene recinto cargado— nació sin aviso.)
--
-- LO QUE SE HACE. Una cuarta cola en `moderacion_cola()`, que es donde el
-- repositorio ya pone lo que el equipo tiene que mirar. Sin tabla nueva,
-- sin tipo de aviso nuevo y sin secretos: quien modera abre la pantalla de
-- moderación y el recinto está ahí, con cuántos días lleva esperando.
--
-- Y UNA PUERTA PARA APROBAR, porque aprobar no es ambiguo: hoy el equipo lo
-- hace con un `update complejos set aprobado_futfinder = true` a mano, y
-- `admin_publicar_complejo()` ya exige justo esa columna. Lo que SÍ es
-- ambiguo —rechazar: con qué motivo, si se puede volver a pedir, qué ve el
-- dueño— queda fuera a propósito, igual que los reportes de usuario quedaron
-- fuera en la 151. Publicar sigue siendo del dueño: aprobar no publica.
--
-- QUIÉN PUEDE. Las dos funciones vuelven a comprobar el padrón con
-- `es_moderador()`, igual que las tres de la 151. La pantalla esconde el
-- menú, pero la pantalla nunca es la autoridad.
-- =============================================================

-- ── 1. La cuarta cola ────────────────────────────────────────────
-- Mismo cuerpo de la 151 con un bloque más. La firma y el tipo de retorno
-- no cambian, así que `create or replace` alcanza y la app vieja sigue
-- leyendo las tres claves que ya conocía.
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
       where u.reviewed_at is null), '[]'::jsonb),

    -- Los recintos que pidieron revisión y todavía no están aprobados.
    -- Van con las canchas ACTIVAS CON HORARIO, que es lo que la 82 exige
    -- para poder pedir la revisión y lo primero que el equipo mira.
    'recintos_esperando', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', k.id, 'nombre', k.nombre,
               'comuna', k.comuna, 'region', k.region,
               'direccion', k.direccion,
               'canchas', (
                 select count(*) from public.canchas_reservables cr
                  where cr.complejo_id = k.id and cr.activa
                    and exists (select 1 from public.cancha_horario_reglas hr
                                 where hr.cancha_id = cr.id)),
               'pedida_at', k.revision_pedida_at) order by k.revision_pedida_at)
        from public.complejos k
       where k.revision_pedida_at is not null
         and not k.aprobado_futfinder), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.moderacion_cola() from public, anon;
grant execute on function public.moderacion_cola() to authenticated;

comment on function public.moderacion_cola() is
  'Las cuatro colas de moderacion en una llamada: revisiones de sancion pendientes, resultados en disputa, reportes sin mirar y recintos esperando revision. Solo para quien este en el padron (migraciones 151 y 164).';

-- ── 2. Aprobar un recinto, con nombre y apellido ─────────────────
-- Es el `update` que el equipo ya hacía a mano, con la puerta del padrón
-- puesta. No publica: publicar lo decide el dueño desde su panel, y
-- `admin_publicar_complejo()` sigue siendo la única que mueve `publicado`.
create or replace function public.moderacion_aprobar_recinto(p_complejo_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_nombre text;
    v_ya boolean;
begin
    if not public.es_moderador() then
        raise exception 'NO_MODERA' using errcode = '42501';
    end if;

    select nombre, aprobado_futfinder into v_nombre, v_ya
      from public.complejos where id = p_complejo_id;

    if v_nombre is null then
        return json_build_object('ok', false, 'reason', 'Ese recinto ya no existe');
    end if;

    -- Idempotente a propósito: dos moderadores mirando la misma cola, o un
    -- doble toque, no tienen por qué ser un error.
    if v_ya then
        return json_build_object('ok', true, 'ya_estaba', true, 'nombre', v_nombre);
    end if;

    update public.complejos
       set aprobado_futfinder = true, updated_at = now()
     where id = p_complejo_id;

    return json_build_object('ok', true, 'ya_estaba', false, 'nombre', v_nombre);
end;
$$;

revoke all on function public.moderacion_aprobar_recinto(uuid) from public, anon;
grant execute on function public.moderacion_aprobar_recinto(uuid) to authenticated;

comment on function public.moderacion_aprobar_recinto(uuid) is
  'Marca un recinto como aprobado por FutFinder. No publica: eso lo decide el dueno. Solo para quien este en el padron (migracion 164).';
