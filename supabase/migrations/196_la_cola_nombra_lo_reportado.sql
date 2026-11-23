-- 196. La cola de moderación nombra lo reportado.
--
-- Probado en producción el 2026-11-19: un reporte de club o de partido se
-- leía «Un club · @fulano» o «Un partido · @fulano». `user_reports.elemento`
-- guarda `tipo:uuid`, y la cola lo pasaba tal cual: quien modera no sabía qué
-- club ni qué partido estaba mirando sin ir a la base.
--
-- `moderacion_cola()` suma a cada reporte:
--   · `elemento_nombre`: el nombre del club, el del club de la foto o el
--     título del partido. null si lo reportado ya no existe (se borró
--     después) o si se reportó a la persona.
--   · `elemento_hora`: la hora del partido (sólo partidos), para distinguir
--     dos partidos con el mismo título.
--
-- El resto del cuerpo es el que está en producción (194), sin cambios. Es
-- `security definer` y sigue exigiendo `es_moderador()`: los nombres no
-- llegan a nadie más. Un `elemento` mal formado no rompe la cola: sólo se
-- convierte a uuid lo que tiene forma de uuid.
--
-- Idempotente.

create or replace function public.moderacion_cola()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
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

    -- Se resuelven con moderacion_resolver_reporte (migración 194).
    -- `elemento_nombre` y `elemento_hora`, migración 196.
    'reportes_sin_mirar', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', u.id, 'motivo', u.motivo, 'elemento', u.elemento,
               'elemento_nombre', case e.tipo
                   when 'club' then (select c.nombre from public.clubs c where c.id = e.id)
                   when 'foto_club' then (select c.nombre from public.club_photos f
                                            join public.clubs c on c.id = f.club_id
                                           where f.id = e.id)
                   when 'partido' then (select m.titulo from public.matches m where m.id = e.id)
                 end,
               'elemento_hora', case when e.tipo = 'partido'
                   then (select m.hora from public.matches m where m.id = e.id) end,
               'created_at', u.created_at,
               'descripcion', u.descripcion,
               'reportado_id', u.reported_id,
               'reportado', (select p.username from public.profiles p where p.id = u.reported_id),
               'reportes_previos', (select count(*) from public.user_reports o
                                       where o.reported_id = u.reported_id and o.id <> u.id),
               'suspendida_hasta', (select s.hasta from public.moderacion_suspensiones s
                                       where s.user_id = u.reported_id and s.hasta > now())) order by u.created_at)
        from public.user_reports u
        cross join lateral (
          select split_part(u.elemento, ':', 1) as tipo,
                 case when split_part(u.elemento, ':', 2)
                           ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                      then split_part(u.elemento, ':', 2)::uuid end as id
        ) e
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
$function$;

revoke all on function public.moderacion_cola() from public, anon;
grant execute on function public.moderacion_cola() to authenticated;
