-- Arnés de la migración 183 (Fútbol 5).
-- Crea sólo datos ficticios y termina en ROLLBACK. Si la 183 no está
-- aplicada, correr en una sola transacción: begin; <migración>; <este cuerpo>.
-- Publicar se llama como `authenticated` (la RPC es `security invoker`, así
-- que corre con los GRANT por columnas y la RLS de un usuario de verdad).
begin;

create temp table f5_fx (org uuid) on commit drop;
grant select on f5_fx to authenticated;

create or replace function pg_temp.soy(p uuid) returns void language plpgsql as $$
begin
    perform set_config('request.jwt.claim.sub', p::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
end $$;
grant execute on function pg_temp.soy(uuid) to authenticated;

create or replace function pg_temp.partido(p_titulo text, p_modalidad text, p_total int)
returns jsonb language sql as $$
    select jsonb_build_object(
        'titulo', p_titulo, 'region', 'Región Metropolitana de Santiago', 'comuna', 'Ñuñoa',
        'cancha_nombre', 'Cancha ficticia ' || gen_random_uuid(), 'latitud', -33.4569, 'longitud', -70.6107,
        'hora', now() + interval '20 days', 'duracion_min', 60, 'jugadores_total', p_total,
        'modalidad', p_modalidad, 'client_token', gen_random_uuid());
$$;
grant execute on function pg_temp.partido(text, text, int) to authenticated;

do $$
declare v uuid := gen_random_uuid();
begin
    insert into f5_fx values (v);
    insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
        confirmation_token, email_change, email_change_token_new, recovery_token
    ) values ('00000000-0000-0000-0000-000000000000', v, 'authenticated', 'authenticated',
        'futbol5-' || v || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '');
end $$;

-- ── Como usuario de la app ───────────────────────────────────────
set local role authenticated;
do $$
declare f record; r jsonb; m record; n int; v_res jsonb; v_mod text;
begin
    select * into strict f from f5_fx;
    perform pg_temp.soy(f.org);

    -- 1. Un partido de Fútbol 5 con los valores con que abre el formulario
    --    para esa modalidad: 10 jugadores, falta 1 (8 reservados + el creador).
    select jsonb_agg(jsonb_build_object('tipo', 'reservado')) into v_res from generate_series(1, 8);
    r := public.publicar_partido_con_asientos(pg_temp.partido('Arnés 183: fútbol 5', 'futbol5', 10), v_res);
    select * into strict m from public.matches where id = (r->'match'->>'id')::uuid;
    if m.modalidad is distinct from 'futbol5' then raise exception 'FALLÓ 1: la modalidad quedó en %', m.modalidad; end if;
    if m.cupos_totales <> 9 or m.cupos_disponibles <> 1 then
        raise exception 'FALLÓ 1b: esperaba 1 libre de 9 plazas, hay %/%', m.cupos_disponibles, m.cupos_totales;
    end if;

    -- 2. El buscador filtra por modalidad con `eq`: el usuario lo ve.
    select count(*) into n from public.matches where modalidad = 'futbol5' and id = m.id;
    if n <> 1 then raise exception 'FALLÓ 2: el usuario no ve su partido de Fútbol 5 al filtrar'; end if;

    -- 3. Los valores con que abre el formulario: 14 jugadores, falta 1, Fútbol 7.
    select jsonb_agg(jsonb_build_object('tipo', 'reservado')) into v_res from generate_series(1, 12);
    r := public.publicar_partido_con_asientos(pg_temp.partido('Arnés 183: catorce', 'futbol7', 14), v_res);
    select * into strict m from public.matches where id = (r->'match'->>'id')::uuid;
    if m.cupos_totales <> 13 or m.cupos_disponibles <> 1 or m.modalidad <> 'futbol7' then
        raise exception 'FALLÓ 3: esperaba 13/14 en fútbol 7, hay %/% en %', m.cupos_disponibles, m.cupos_totales, m.modalidad;
    end if;

    -- 4. Control negativo: el CHECK sigue cerrando lo que no es una modalidad.
    begin
        perform public.publicar_partido_con_asientos(pg_temp.partido('Arnés 183: inventada', 'futbol6', 10), '[]'::jsonb);
        raise exception 'FALLÓ 4: se publicó un partido de «futbol6»';
    exception when check_violation then
        if sqlerrm not like '%matches_modalidad_check%' then raise; end if;
    end;
    select count(*) into n from public.matches where titulo = 'Arnés 183: inventada';
    if n <> 0 then raise exception 'FALLÓ 4b: el partido rechazado quedó creado'; end if;

    -- 5. Editar un partido propio a Fútbol 5 (EditMatchScreen hace un UPDATE).
    update public.matches set modalidad = 'futbol5' where id = m.id;
    select modalidad into strict v_mod from public.matches where id = m.id;
    if v_mod is distinct from 'futbol5' then raise exception 'FALLÓ 5: no se pudo editar a Fútbol 5 (%)', v_mod; end if;
end $$;
reset role;

-- 6. El resto del vocabulario no se abrió: los clubes siguen en 7 / 11.
do $$
begin
    if not exists (
        select 1 from pg_constraint
         where conname = 'clubs_modalidad_check'
           and pg_get_constraintdef(oid) not like '%futbol5%'
    ) then raise exception 'FALLÓ 6: clubs.modalidad cambió o no existe'; end if;
end $$;

select 'OK 183: 6 casos' as resultado;
rollback;
