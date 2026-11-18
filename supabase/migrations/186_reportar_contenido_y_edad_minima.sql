-- =============================================================
-- 186. REPORTAR CONTENIDO Y EDAD MÍNIMA DE 14
--
-- 1. REPORTAR UN CLUB, UNA FOTO O UN PARTIDO. Hasta acá sólo se podía
--    reportar a una persona (perfil y chat). Apple (guía 1.2, contenido de
--    usuarios) pide poder reportar el contenido mismo: el nombre o el escudo
--    de un club, una foto de su galería, la descripción de un partido.
--    `reportar_contenido` deriva ELLA a quién corresponde —quien subió la
--    foto, el organizador del partido, el admin más antiguo del club— y lo
--    guarda en `user_reports` con `elemento = '<tipo>:<id>'`, que ya es lo que
--    lee la cola de moderación (`moderacion_cola`, 151). No hace falta otra
--    tabla ni otra pantalla de moderación. El tope de reportes por hora de la
--    166 sigue aplicando: el disparador de `user_reports` mira `auth.uid()`.
--
-- 2. EDAD MÍNIMA DE 14 (decisión del equipo, 2026-11-13). El registro
--    aceptaba desde los 12, y la política de privacidad prometía una
--    autorización de madre, padre o tutor bajo los 14 que la app nunca pidió.
--    Se sube el mínimo a 14 en la app y acá: al registrar la edad por primera
--    vez, el servidor rechaza menos de 14. Las cuentas de 12 o 13 que ya
--    existen no se tocan (la edad registrada no cambia, 177).
--
-- Pruebas: supabase/tests/186_reportar_contenido_y_edad_minima_test.sql
-- =============================================================

-- ── 1. Reportar contenido ─────────────────────────────────────────
create or replace function public.reportar_contenido(
  p_tipo text,
  p_id uuid,
  p_motivo text,
  p_descripcion text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_responsable uuid;
begin
  if v_uid is null then
    raise exception 'Inicia sesión para reportar.' using errcode = '42501';
  end if;

  if p_tipo = 'club' then
    select m.user_id into v_responsable
      from public.club_members m
     where m.club_id = p_id and m.rol = 'admin'
     order by m.joined_at, m.id
     limit 1;
  elsif p_tipo = 'foto_club' then
    select coalesce(f.uploaded_by,
                    (select m.user_id from public.club_members m
                      where m.club_id = f.club_id and m.rol = 'admin'
                      order by m.joined_at, m.id limit 1))
      into v_responsable
      from public.club_photos f
     where f.id = p_id;
  elsif p_tipo = 'partido' then
    select coalesce(mt.id_organizador,
                    (select m.user_id from public.club_members m
                      where m.club_id = mt.club_local_id and m.rol = 'admin'
                      order by m.joined_at, m.id limit 1))
      into v_responsable
      from public.matches mt
     where mt.id = p_id;
  else
    return json_build_object('ok', false, 'reason', 'No se puede reportar eso.');
  end if;

  if v_responsable is null then
    return json_build_object('ok', false, 'reason', 'No encontramos ese contenido. Puede que ya no exista.');
  end if;
  if v_responsable = v_uid then
    return json_build_object('ok', false, 'reason', 'No puedes reportar tu propio contenido.');
  end if;

  begin
    insert into public.user_reports (reporter_id, reported_id, motivo, descripcion, elemento)
    values (v_uid, v_responsable, p_motivo,
            nullif(trim(coalesce(p_descripcion, '')), ''),
            p_tipo || ':' || p_id::text);
  exception
    when unique_violation then
      return json_build_object('ok', false, 'reason',
        'Ya enviaste un reporte sobre esta cuenta y sigue en revisión.');
    when check_violation then
      return json_build_object('ok', false, 'reason',
        'Revisa el motivo y que la descripción no pase de 600 caracteres.');
  end;

  return json_build_object('ok', true);
end;
$$;

revoke all on function public.reportar_contenido(text, uuid, text, text) from public, anon;
grant execute on function public.reportar_contenido(text, uuid, text, text) to authenticated;

-- ── 2. Edad mínima de 14 (y lo de la 177, igual) ──────────────────
create or replace function public.perfil_edad_y_menores()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and current_user = 'authenticated'
     and old.edad is not null and new.edad is distinct from old.edad then
    raise exception 'Tu edad ya quedó registrada. Si está mal, escríbenos a futfindercl@gmail.com.'
      using errcode = '42501';
  end if;

  -- 186: la primera vez que se registra la edad, desde los 14.
  if current_user = 'authenticated' and new.edad is not null and new.edad < 14
     and (tg_op = 'INSERT' or old.edad is null) then
    raise exception 'FutFinder se puede usar desde los 14 años.'
      using errcode = '23514';
  end if;

  if new.edad is not null and new.edad < 18 then
    if tg_op = 'UPDATE' and current_user = 'authenticated'
       and new.privacy_visible_in_search and not coalesce(old.privacy_visible_in_search, false)
       and new.edad is not distinct from old.edad then
      raise exception 'Las cuentas de menores de 18 años no aparecen en las búsquedas.'
        using errcode = '42501';
    end if;
    new.privacy_visible_in_search := false;
  end if;
  return new;
end;
$$;
