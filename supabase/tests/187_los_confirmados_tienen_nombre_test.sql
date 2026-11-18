-- Arnés de la migración 187 (al publicar, cada confirmado dice quién es).
-- Crea sólo datos ficticios y termina en ROLLBACK. Si la 187 no está
-- aplicada, correr en una sola transacción: begin; <migración>; <este cuerpo>.
-- Publicar y gestionar se llaman como `authenticated`, cambiando de usuario
-- con el claim del JWT; `postgres` sólo prepara los datos.
begin;

create temp table c187_fx (org uuid, amigo uuid) on commit drop;
grant select on c187_fx to authenticated;

create or replace function pg_temp.soy(p uuid) returns void language plpgsql as $$
begin
    perform set_config('request.jwt.claim.sub', p::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
end $$;
grant execute on function pg_temp.soy(uuid) to authenticated;

create or replace function pg_temp.partido(p_titulo text, p_total int)
returns jsonb language sql as $$
    select jsonb_build_object(
        'titulo', p_titulo, 'region', 'Región Metropolitana de Santiago', 'comuna', 'Ñuñoa',
        'cancha_nombre', 'Cancha ficticia ' || gen_random_uuid(), 'latitud', -33.4569, 'longitud', -70.6107,
        'hora', now() + interval '20 days', 'duracion_min', 60, 'jugadores_total', p_total,
        'modalidad', 'futbol7', 'client_token', gen_random_uuid());
$$;
grant execute on function pg_temp.partido(text, int) to authenticated;

-- Publicar debe fallar con `p_codigo` y sin dejar el partido creado.
create or replace function pg_temp.rechaza(p_caso text, p_titulo text, p_total int, p_asientos jsonb, p_codigo text)
returns void language plpgsql as $$
declare n int;
begin
    begin
        perform public.publicar_partido_con_asientos(pg_temp.partido(p_titulo, p_total), p_asientos);
        raise exception 'FALLÓ %: se publicó «%»', p_caso, p_titulo;
    exception when raise_exception then
        if sqlerrm not like p_codigo || '%' then
            raise exception 'FALLÓ %: esperaba %, llegó «%»', p_caso, p_codigo, sqlerrm;
        end if;
    end;
    select count(*) into n from public.matches where titulo = p_titulo;
    if n <> 0 then raise exception 'FALLÓ %: el partido rechazado quedó creado', p_caso; end if;
end $$;
grant execute on function pg_temp.rechaza(text, text, int, jsonb, text) to authenticated;

do $$
declare f record;
begin
    insert into c187_fx values (gen_random_uuid(), gen_random_uuid()) returning * into f;
    insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
        confirmation_token, email_change, email_change_token_new, recovery_token
    ) select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
        'c187-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
      from unnest(array[f.org, f.amigo]) u;
    insert into public.friendships (requester_id, addressee_id, status) values (f.org, f.amigo, 'accepted');
    -- Los nombres son de lanzamiento: el arnés los necesita encendidos.
    update public.feature_flags set activo = true, termina_at = now() + interval '30 days'
     where nombre = 'asientos_por_nombre';
end $$;

-- ── Como usuario de la app ───────────────────────────────────────
set local role authenticated;
do $$
declare f record; r jsonb; m record; n int; v_res jsonb; v_asiento uuid;
begin
    select * into strict f from c187_fx;
    perform pg_temp.soy(f.org);

    -- 1. El caso de Vicente: 8 confirmados «Reservado», sin nombre ni cuenta.
    select jsonb_agg(jsonb_build_object('tipo', 'reservado')) into v_res from generate_series(1, 8);
    perform pg_temp.rechaza('1', 'Arnés 187: ocho reservados', 10, v_res, 'ASIENTO_SIN_IDENTIFICAR');

    -- 2. Basta UNO sin identificar entre nombres válidos.
    perform pg_temp.rechaza('2', 'Arnés 187: uno sin nombre', 10, jsonb_build_array(
        jsonb_build_object('tipo', 'nombre', 'nombre', 'Tomás'),
        jsonb_build_object('tipo', 'reservado')), 'ASIENTO_SIN_IDENTIFICAR');

    -- 3. Un tipo inventado o sin tipo tampoco pasa.
    perform pg_temp.rechaza('3', 'Arnés 187: sin tipo', 10,
        jsonb_build_array(jsonb_build_object('nombre', 'Tomás')), 'ASIENTO_SIN_IDENTIFICAR');

    -- 4. Nombres que no identifican a nadie.
    perform pg_temp.rechaza('4a', 'Arnés 187: genérico', 10,
        jsonb_build_array(jsonb_build_object('tipo', 'nombre', 'nombre', 'Jugador reservado')), 'ASIENTO_NOMBRE_GENERICO');
    perform pg_temp.rechaza('4b', 'Arnés 187: jugador 3', 10,
        jsonb_build_array(jsonb_build_object('tipo', 'nombre', 'nombre', '  JUGADOR-3 ')), 'ASIENTO_NOMBRE_GENERICO');
    perform pg_temp.rechaza('4c', 'Arnés 187: asiento reservado', 10,
        jsonb_build_array(jsonb_build_object('tipo', 'nombre', 'nombre', 'Asiento Reservado')), 'ASIENTO_NOMBRE_GENERICO');
    perform pg_temp.rechaza('4d', 'Arnés 187: una letra', 10,
        jsonb_build_array(jsonb_build_object('tipo', 'nombre', 'nombre', 'X')), 'ASIENTO_NOMBRE_GENERICO');
    perform pg_temp.rechaza('4e', 'Arnés 187: espacios', 10,
        jsonb_build_array(jsonb_build_object('tipo', 'nombre', 'nombre', '    ')), 'ASIENTO_NOMBRE_INVALIDO');

    -- 5. Con un amigo y nombres de verdad, publica: 4 confirmados de 10.
    r := public.publicar_partido_con_asientos(pg_temp.partido('Arnés 187: con nombres', 10), jsonb_build_array(
        jsonb_build_object('tipo', 'amigo', 'user_id', f.amigo),
        jsonb_build_object('tipo', 'nombre', 'nombre', 'Tomás'),
        jsonb_build_object('tipo', 'nombre', 'nombre', 'Álvaro')));
    select * into strict m from public.matches where id = (r->'match'->>'id')::uuid;
    if m.cupos_totales <> 9 or m.cupos_disponibles <> 6 then
        raise exception 'FALLÓ 5: esperaba 6 libres de 9, hay %/%', m.cupos_disponibles, m.cupos_totales;
    end if;
    select count(*) into n from public.match_asientos where id_partido = m.id and tipo = 'nombre';
    if n <> 2 then raise exception 'FALLÓ 5b: quedaron % nombres', n; end if;
    select count(*) into n from public.match_asientos where id_partido = m.id and tipo = 'reservado';
    if n <> 0 then raise exception 'FALLÓ 5c: nació con % reservados', n; end if;

    -- 6. Sin confirmados (vas solo) también publica.
    r := public.publicar_partido_con_asientos(pg_temp.partido('Arnés 187: solo', 10), '[]'::jsonb);
    if (r->'match'->>'id') is null then raise exception 'FALLÓ 6: no publicó un partido sin confirmados'; end if;

    -- 7. Cambiar un nombre a uno genérico en «Gestionar» tampoco pasa.
    select id into strict v_asiento from public.match_asientos where id_partido = m.id and nombre = 'Tomás';
    begin
        perform public.asiento_cambiar(v_asiento, 'nombre', 'Jugador');
        raise exception 'FALLÓ 7: se guardó «Jugador» como nombre';
    exception when raise_exception then
        if sqlerrm not like 'ASIENTO_NOMBRE_GENERICO%' then raise; end if;
    end;
    perform public.asiento_cambiar(v_asiento, 'nombre', 'Tomás Pérez');
    select count(*) into n from public.match_asientos where id = v_asiento and nombre = 'Tomás Pérez';
    if n <> 1 then raise exception 'FALLÓ 7b: no se pudo corregir a un nombre válido'; end if;

    -- 8. Ya publicado, reservar para el link sigue permitido (decisión de la 187).
    perform public.asiento_agregar(m.id, 'reservado', null, 2);
    select count(*) into n from public.match_asientos where id_partido = m.id and tipo = 'reservado';
    if n <> 2 then raise exception 'FALLÓ 8: «Gestionar» ya no puede reservar (%)', n; end if;
end $$;
reset role;

select 'OK 187: 8 casos' as resultado;
rollback;
