-- =============================================================
-- 138. TELÉFONO OBLIGATORIO, TODAVÍA SIN VERIFICACIÓN POR SMS
--
-- `truescore_fase1` pide «un número de teléfono verificado y único» por
-- cuenta. La verificación necesita un proveedor de SMS que aún no está, así
-- que la exigencia se parte en dos flags:
--
--   · `telefono_obligatorio`: para inscribirse o publicar hay que tener un
--     celular registrado, único entre todas las cuentas.
--   · `telefono_verificacion_sms` (nuevo, apagado): además tiene que estar
--     verificado. Se activa cuando el SMS funcione.
--
-- El número vive en `perfil_telefonos`, no en `auth.users.phone`: escribir
-- ahí dispara el envío del SMS, que hoy falla. Nadie lo lee directo; la app
-- ve sólo su propio número enmascarado (`mi_telefono`).
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

insert into public.feature_flags (nombre, descripcion) values
  ('telefono_verificacion_sms', 'Exige que el teléfono esté verificado por SMS. Activar cuando el proveedor esté configurado.')
on conflict (nombre) do nothing;

create table if not exists public.perfil_telefonos (
  user_id       uuid primary key references public.profiles(id) on delete cascade,
  telefono      text not null unique check (telefono ~ '^\+569[0-9]{8}$'),
  verificado_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.perfil_telefonos enable row level security;
revoke all on public.perfil_telefonos from public, anon, authenticated;

-- ¿Cumple la exigencia de teléfono? Sin la verificación por SMS basta con
-- tenerlo registrado; con ella, tiene que estar verificado (en Auth o acá).
create or replace function public.telefono_cumple(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.telefono_verificado(p_user)
      or exists (select 1 from public.perfil_telefonos t
                  where t.user_id = p_user
                    and (not public.flag_activo('telefono_verificacion_sms') or t.verificado_at is not null));
$$;
revoke all on function public.telefono_cumple(uuid) from public, anon, authenticated;

-- Registra (o cambia) mi celular. Formato chileno, único entre cuentas.
create or replace function public.registrar_telefono(p_telefono text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_dig text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
  v_tel text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'No autenticado'); end if;
  if v_dig like '56%' then v_dig := substr(v_dig, 3); end if;
  if v_dig !~ '^9[0-9]{8}$' then
    return jsonb_build_object('ok', false, 'reason', 'Escribe un celular chileno: 9 seguido de 8 dígitos.');
  end if;
  v_tel := '+56' || v_dig;
  if exists (select 1 from public.perfil_telefonos where telefono = v_tel and user_id <> v_uid)
     or exists (select 1 from auth.users where phone = substr(v_tel, 2) and id <> v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'Ese número ya está asociado a otra cuenta.');
  end if;
  begin
    insert into public.perfil_telefonos (user_id, telefono) values (v_uid, v_tel)
    on conflict (user_id) do update
      set telefono = excluded.telefono,
          -- Cambiar de número pierde la verificación del anterior.
          verificado_at = case when public.perfil_telefonos.telefono = excluded.telefono
                               then public.perfil_telefonos.verificado_at end,
          updated_at = now();
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'Ese número ya está asociado a otra cuenta.');
  end;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.registrar_telefono(text) from public, anon;
grant execute on function public.registrar_telefono(text) to authenticated;

-- Mi teléfono, enmascarado, y qué exige la app hoy.
create or replace function public.mi_telefono() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'registrado', t.telefono is not null,
    'mascara', case when t.telefono is null then null
                    else '+56 9 •••• ' || right(t.telefono, 4) end,
    'verificado', t.verificado_at is not null or public.telefono_verificado(auth.uid()),
    'cumple', public.telefono_cumple(auth.uid()),
    'obligatorio', public.flag_activo('telefono_obligatorio'),
    'verificacion_sms', public.flag_activo('telefono_verificacion_sms'))
  from (select 1) x
  left join public.perfil_telefonos t on t.user_id = auth.uid();
$$;
revoke all on function public.mi_telefono() from public, anon;
grant execute on function public.mi_telefono() to authenticated;

-- Publicar: la misma regla.
create or replace function public.tg_matches_exige_telefono() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.challenge_proposal_id is null and public.flag_activo('telefono_obligatorio') and not public.telefono_cumple(new.id_organizador) then
    raise exception 'TELEFONO_NO_VERIFICADO';
  end if;
  return new;
end $$;

-- Inscribirse: cuerpo de la 134 con `telefono_cumple`.
create or replace function public.tg_enforce_join_rules() returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_min int; v_org uuid; v_hora timestamptz; v_dur int;
  v_trust int; v_estado text; v_until timestamptz; v_clash int;
  v_es_de_clubes boolean;
  v_edad_min int; v_edad_max int; v_edad int;
  v_libres int; v_turnos_de_otros int;
begin
  if new.estado not in ('inscrito','pendiente') then return new; end if;
  perform pg_advisory_xact_lock(107, hashtext(new.id_jugador::text));
  select min_trust_score, id_organizador, hora, duracion_min, challenge_proposal_id is not null, edad_min, edad_max, cupos_disponibles
    into v_min, v_org, v_hora, v_dur, v_es_de_clubes, v_edad_min, v_edad_max, v_libres
  from public.matches where id = new.id_partido;
  if v_org = new.id_jugador and not coalesce(v_es_de_clubes, false) then return new; end if;
  if exists (select 1 from public.match_expulsiones where match_id = new.id_partido and jugador_id = new.id_jugador) then
    raise exception 'EXPULSADO';
  end if;
  if not coalesce(v_es_de_clubes, false) and public.flag_activo('telefono_obligatorio') and not public.telefono_cumple(new.id_jugador) then
    raise exception 'TELEFONO_NO_VERIFICADO';
  end if;
  select trust_score, estado, suspended_until, edad into v_trust, v_estado, v_until, v_edad from public.profiles where id = new.id_jugador;
  if v_estado = 'suspendido' and (v_until is null or v_until > now()) then raise exception 'SUSPENDIDO'; end if;
  if coalesce(v_trust,0) < coalesce(v_min,0) then raise exception 'TRUST_BAJO:%:%', coalesce(v_trust,0), coalesce(v_min,0); end if;
  if public.edad_fuera_de_rango(v_edad, v_edad_min, v_edad_max) then raise exception 'EDAD_FUERA_DE_RANGO'; end if;
  if new.estado = 'inscrito' and not coalesce(v_es_de_clubes, false) then
    select count(*) into v_turnos_de_otros from public.match_waitlist w
     where w.id_partido = new.id_partido and w.confirmar_antes_de > now() and w.id_jugador <> new.id_jugador;
    if coalesce(v_libres, 0) <= v_turnos_de_otros then raise exception 'CUPO_RESERVADO'; end if;
  end if;
  select 1 into v_clash from public.attendees a join public.matches m on m.id = a.id_partido
  where a.id_jugador = new.id_jugador and a.estado in ('inscrito','confirmado_gps') and m.id <> new.id_partido
    and m.estado = any (public.estados_que_ocupan_horario())
    and v_hora < m.hora + make_interval(mins => coalesce(m.duracion_min,90))
    and m.hora < v_hora + make_interval(mins => coalesce(v_dur,90))
  limit 1;
  if found then raise exception 'CHOQUE_HORARIO'; end if;
  return new;
end;
$$;
