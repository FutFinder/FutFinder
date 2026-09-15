-- Regresión del hallazgo 4: join_match no puede saltarse la aprobación manual.
-- Ejecutar completo en SQL Editor con las migraciones vigentes.
-- Solo crea cuentas y partidos ficticios; ROLLBACK deshace todos los cambios.
begin;

create temp table aprobacion_fixture (
    organizador uuid, jugador uuid, otro uuid, inmediato uuid, manual uuid
) on commit drop;
create temp table aprobacion_resultados (caso text primary key) on commit drop;
grant select on aprobacion_fixture to authenticated;
grant select, insert on aprobacion_resultados to authenticated;

do $$
declare
    f record;
begin
    insert into aprobacion_fixture values (
        gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
        gen_random_uuid(), gen_random_uuid()
    ) returning * into f;

    insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
        confirmation_token, email_change, email_change_token_new, recovery_token
    ) select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
        'cupo-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
      from unnest(array[f.organizador, f.jugador, f.otro]) u;

    insert into public.matches (
        id, id_organizador, titulo, region, comuna, cancha_nombre,
        latitud, longitud, hora, duracion_min, cupos_totales, cupos_disponibles,
        precio_cuota, nivel, aprobacion, recordatorio_1h, pedir_asistencia
    ) values
        (f.inmediato, f.organizador, 'Prueba transaccional: un cupo',
         'Región Metropolitana de Santiago', 'Ñuñoa', 'Cancha ficticia ' || f.inmediato,
         -33.4569, -70.6107, now() + interval '30 days', 60, 1, 1, 0,
         'recreativo', 'inmediata', false, false),
        (f.manual, f.organizador, 'Prueba transaccional: aprobar un cupo',
         'Región Metropolitana de Santiago', 'Ñuñoa', 'Cancha ficticia ' || f.manual,
         -33.4569, -70.6107, now() + interval '31 days', 60, 1, 1, 0,
         'recreativo', 'manual', false, false);
end;
$$;


set local role authenticated;
do $$
declare
    f record;
    r jsonb;
    n integer;
begin
    select * into strict f from aprobacion_fixture;
    perform set_config('request.jwt.claim.sub', f.jugador::text, true);
    r := public.join_match(f.manual)::jsonb;
    if (r->>'ok')::boolean is distinct from false then
        raise exception 'INGRESO_MANUAL_SIN_APROBACION:%', r;
    end if;
    if exists (select 1 from public.attendees where id_partido = f.manual and id_jugador = f.jugador)
       or not exists (select 1 from public.matches where id = f.manual and cupos_disponibles = 1) then
        raise exception 'El ingreso rechazado alteró inscripción o cupos';
    end if;
    insert into aprobacion_resultados values ('1. Ingreso directo a manual rechazado sin efectos');

    r := public.request_join(f.manual)::jsonb;
    if (r->>'ok')::boolean is distinct from true then raise exception 'Solicitud falló: %', r; end if;
    if not exists (select 1 from public.attendees where id_partido = f.manual
                   and id_jugador = f.jugador and estado = 'pendiente')
       or not exists (select 1 from public.matches where id = f.manual and cupos_disponibles = 1) then
        raise exception 'La solicitud debe quedar pendiente sin consumir cupo';
    end if;
    insert into aprobacion_resultados values ('2. Solicitar deja pendiente sin consumir cupo');

    r := public.join_match(f.manual)::jsonb;
    if (r->>'ok')::boolean is distinct from false
       or not exists (select 1 from public.attendees where id_partido = f.manual
                      and id_jugador = f.jugador and estado = 'pendiente')
       or not exists (select 1 from public.matches where id = f.manual and cupos_disponibles = 1) then
        raise exception 'El ingreso directo promovió o alteró la solicitud pendiente';
    end if;
    insert into aprobacion_resultados values ('3. Solicitud pendiente no se convierte por ingreso directo');

    perform set_config('request.jwt.claim.sub', f.otro::text, true);
    r := public.approve_join(f.manual, f.jugador)::jsonb;
    if (r->>'ok')::boolean is distinct from false
       or not exists (select 1 from public.attendees where id_partido = f.manual
                      and id_jugador = f.jugador and estado = 'pendiente') then
        raise exception 'Un tercero pudo aprobar la solicitud';
    end if;
    insert into aprobacion_resultados values ('4. Un tercero no puede aprobar');

    perform set_config('request.jwt.claim.sub', f.organizador::text, true);
    r := public.approve_join(f.manual, f.jugador)::jsonb;
    if (r->>'ok')::boolean is distinct from true then raise exception 'Aprobación falló: %', r; end if;
    select count(*) into n from public.attendees where id_partido = f.manual and estado = 'inscrito';
    if n <> 2 or not exists (select 1 from public.matches where id = f.manual
                             and cupos_disponibles = 0 and estado = 'lleno') then
        raise exception 'Aprobar debe inscribir al jugador y descontar el cupo';
    end if;
    insert into aprobacion_resultados values ('5. El organizador aprueba y ocupa el cupo');

    perform set_config('request.jwt.claim.sub', f.otro::text, true);
    r := public.join_match(f.inmediato)::jsonb;
    if (r->>'ok')::boolean is distinct from true
       or not exists (select 1 from public.attendees where id_partido = f.inmediato
                      and id_jugador = f.otro and estado = 'inscrito') then
        raise exception 'El ingreso inmediato legítimo dejó de funcionar: %', r;
    end if;
    insert into aprobacion_resultados values ('6. El partido inmediato conserva ingreso directo');
end;
$$;
reset role;
select caso from aprobacion_resultados order by caso;
rollback;
