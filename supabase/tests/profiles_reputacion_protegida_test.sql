-- Regresión del hallazgo 2: la reputación la escribe el servidor.
-- Ejecutar completo en SQL Editor después de las migraciones vigentes.
-- Crea cuentas y partidos ficticios; ROLLBACK deshace todos los cambios,
-- incluida la sanción aplicada para comprobar una RPC legítima.
begin;

create temp table perfil_fixture (
    organizador uuid, jugador uuid, otro uuid, inmediato uuid, manual uuid
) on commit drop;
create temp table perfil_resultados (caso text primary key) on commit drop;
grant select on perfil_fixture to authenticated;
grant select, insert on perfil_resultados to authenticated;

do $$
declare
    f record;
begin
    insert into perfil_fixture values (
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

    update public.profiles set trust_score = 80 where id = f.jugador;

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
    columna text;
    rechazado boolean;
    n integer;
    r jsonb;
begin
    select * into strict f from perfil_fixture;
    perform set_config('request.jwt.claim.sub', f.jugador::text, true);

    foreach columna in array array[
        'trust_score', 'partidos_jugados', 'asistencias_confirmadas', 'mvps',
        'rating_puntualidad_avg', 'rating_fairplay_avg', 'rating_nivel_avg',
        'rating_count', 'estado', 'suspended_until', 'id', 'created_at'
    ] loop
        rechazado := false;
        begin
            execute format('update public.profiles set %I = %I where id = $1', columna, columna)
                using f.jugador;
        exception when insufficient_privilege then rechazado := true;
        end;
        if not rechazado then raise exception 'ESCRITURA_SENSIBLE_PERMITIDA:%', columna; end if;
        insert into perfil_resultados values ('Protegido: ' || columna);
    end loop;

    -- Se ejecutan UPDATE reales: comprobar solo los grants no verifica RLS.
    foreach columna in array array[
        'username', 'foto_url', 'banner_url', 'bio', 'posicion_preferida',
        'flanco', 'edad', 'modalidad', 'nivel', 'region', 'comuna',
        'latitud', 'longitud', 'location_updated_at', 'privacy_friend_requests',
        'privacy_visible_in_search', 'notif_matches', 'notif_clubs', 'notif_chat',
        'notif_friends', 'pref_region', 'pref_comuna', 'search_radius_km',
        'onboarding_completed', 'updated_at'
    ] loop
        execute format('update public.profiles set %I = %I where id = $1', columna, columna)
            using f.jugador;
        get diagnostics n = row_count;
        if n <> 1 then raise exception 'Edición propia bloqueada: %', columna; end if;
    end loop;
    insert into perfil_resultados values ('Los 25 campos editables conservan escritura propia');

    update public.profiles set bio = 'No debe guardarse' where id = f.otro;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'RLS permite editar otro perfil'; end if;
    insert into perfil_resultados values ('RLS impide editar otro perfil');

    -- El cliente no puede tocar trust_score, pero la RPC debe poder sancionar.
    r := public.join_match(f.inmediato)::jsonb;
    if (r->>'ok')::boolean is distinct from true then raise exception 'Ingreso falló: %', r; end if;
    r := public.leave_match_penalized(f.inmediato)::jsonb;
    if (r->>'ok')::boolean is distinct from true then raise exception 'Salida falló: %', r; end if;
    select trust_score into strict n from public.profiles where id = f.jugador;
    if n <> 77 then raise exception 'La RPC no aplicó la sanción vigente de 3 puntos: %', n; end if;
    insert into perfil_resultados values ('La RPC legítima aplica la sanción de salida');

    if exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'profiles'
           and has_column_privilege('anon', 'public.profiles', column_name, 'UPDATE')
    ) then raise exception 'Anon conserva permiso UPDATE en profiles'; end if;
    insert into perfil_resultados values ('Anon no tiene permiso para editar perfiles');
end;
$$;
reset role;
select caso from perfil_resultados order by caso;
rollback;
