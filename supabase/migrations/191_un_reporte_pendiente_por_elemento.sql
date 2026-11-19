-- 191. Un reporte pendiente por elemento, no por persona.
--
-- Pedido de Vicente (2026-11-18). Desde la 31, `user_reports_unique_pending`
-- admitía UN reporte pendiente por par reportante→reportado. Desde la 186 se
-- reportan también clubes, fotos de club y partidos, y cada uno se anota
-- contra quien lo publicó: reportar un club y después un partido del mismo
-- admin rechazaba el segundo («ya enviaste un reporte sobre esta cuenta»).
--
-- Ahora la unicidad es por (reportante, reportado, elemento):
--   · un reporte de CUENTA (elemento nulo) sigue siendo uno pendiente por
--     persona, como siempre;
--   · un club, una foto o un partido se pueden reportar cada uno una vez
--     mientras su reporte siga pendiente, aunque sean de la misma persona.
-- El spam lo sigue frenando el tope por hora de la 166 sobre `user_reports`.
--
-- `reportar_contenido` sólo cambia el texto del repetido: ya no es «esta
-- cuenta» sino «esto».
--
-- Idempotente.

drop index if exists public.user_reports_unique_pending;
create unique index if not exists user_reports_unique_pending
    on public.user_reports (reporter_id, reported_id, (coalesce(elemento, '')))
    where estado = 'pendiente';

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
        'Ya reportaste esto y sigue en revisión.');
    when check_violation then
      return json_build_object('ok', false, 'reason',
        'Revisa el motivo y que la descripción no pase de 600 caracteres.');
  end;

  return json_build_object('ok', true);
end;
$$;

revoke all on function public.reportar_contenido(text, uuid, text, text) from public, anon;
grant execute on function public.reportar_contenido(text, uuid, text, text) to authenticated;
