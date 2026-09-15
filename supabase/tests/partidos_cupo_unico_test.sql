-- Regresión del hallazgo 1: «falta 1 jugador» significa una plaza adicional
-- al organizador. Requiere las migraciones vigentes (104/105 o posteriores).
-- Ejecutar completo en SQL Editor. Crea únicamente datos ficticios y termina
-- en ROLLBACK. No cambia partidos ni cuentas existentes.
-- La concurrencia se verifica aparte con dos sesiones: esta transacción
-- comprueba el contrato de ingreso y aprobación, no una carrera entre conexiones.
begin;

create temp table cupo_fixture (
    organizador uuid, jugador uuid, otro uuid, inmediato uuid, manual uuid
) on commit drop;
create temp table cupo_resultados (caso text primary key) on commit drop;
grant select on cupo_fixture to authenticated;
grant select, insert on cupo_resultados to authenticated;

do $$
declare
    f record;
begin
    insert into cupo_fixture values (
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
    m record;
    n integer;
begin
    select * into strict f from cupo_fixture;
    perform set_config('request.jwt.claim.sub', f.jugador::text, true);
    select * into strict m from public.matches where id = f.inmediato;
    select count(*) into n from public.attendees
     where id_partido = f.inmediato and id_jugador = f.organizador and estado = 'inscrito';
    if m.cupos_disponibles <> 1 or n <> 1 then
        raise exception 'El organizador debe estar inscrito sin consumir el único cupo';
    end if;
    insert into cupo_resultados values ('1. El organizador no consume cupo');

    r := public.join_match(f.inmediato)::jsonb;
    if (r->>'ok')::boolean is distinct from true then
        raise exception 'El primer jugador debe poder entrar: %', r;
    end if;
    select * into strict m from public.matches where id = f.inmediato;
    select count(*) into n from public.attendees
     where id_partido = f.inmediato and estado = 'inscrito';
    if m.cupos_totales <> 1 or m.cupos_disponibles <> 0 or m.estado <> 'lleno' or n <> 2 then
        raise exception 'Se esperaba organizador + jugador, cero cupos y partido lleno';
    end if;
    insert into cupo_resultados values ('2. Un jugador adicional ocupa el cupo y llena el partido');

    perform set_config('request.jwt.claim.sub', f.otro::text, true);
    r := public.join_match(f.inmediato)::jsonb;
    if (r->>'ok')::boolean is distinct from false then
        raise exception 'El segundo jugador no debe entrar a un partido lleno: %', r;
    end if;
    select count(*) into n from public.attendees where id_partido = f.inmediato;
    if n <> 2 or exists (
        select 1 from public.matches where id = f.inmediato and cupos_disponibles <> 0
    ) then raise exception 'El rechazo alteró el plantel o los cupos'; end if;
    insert into cupo_resultados values ('3. El segundo jugador se rechaza sin alterar el cupo');

    perform set_config('request.jwt.claim.sub', f.jugador::text, true);
    r := public.request_join(f.manual)::jsonb;
    if (r->>'ok')::boolean is distinct from true then raise exception 'Falló la solicitud: %', r; end if;
    if not exists (
        select 1 from public.attendees where id_partido = f.manual
         and id_jugador = f.jugador and estado = 'pendiente'
    ) or not exists (
        select 1 from public.matches where id = f.manual and cupos_disponibles = 1
    ) then raise exception 'La solicitud debe quedar pendiente sin consumir cupo'; end if;
    insert into cupo_resultados values ('4. La solicitud pendiente no consume cupo');

    perform set_config('request.jwt.claim.sub', f.organizador::text, true);
    r := public.approve_join(f.manual, f.jugador)::jsonb;
    if (r->>'ok')::boolean is distinct from true then raise exception 'Falló la aprobación: %', r; end if;
    select * into strict m from public.matches where id = f.manual;
    select count(*) into n from public.attendees where id_partido = f.manual and estado = 'inscrito';
    if m.cupos_disponibles <> 0 or m.estado <> 'lleno' or n <> 2 then
        raise exception 'Aprobar debe dejar organizador + jugador y cero cupos';
    end if;
    insert into cupo_resultados values ('5. La aprobación ocupa el único cupo');
end;
$$;
reset role;
select caso from cupo_resultados order by caso;
rollback;
