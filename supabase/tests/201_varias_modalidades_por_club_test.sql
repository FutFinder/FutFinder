-- Arnés de la migración 201 (varias modalidades por club).
-- Crea sólo datos ficticios y termina en ROLLBACK. Si la 201 no está
-- aplicada, correr en una sola transacción: begin; <migración>; <este cuerpo>.
-- Crea y edita el club como `authenticated`, igual que `createClub` y
-- `updateClub` (insert y update directos, con la RLS de `clubs`).
--
--   M1  Crear un club con Fútbol 5 y 7 ('futbol5_7').
--   M2  El administrador pasa por cada combinación válida.
--   M3  'ambos' (7 y 11, el valor histórico) sigue siendo válido.
--   M4  Control negativo: una combinación fuera de orden se rechaza.
--   M5  Control negativo: un valor inventado se rechaza.
begin;

create temp table c201_fx (adm uuid) on commit drop;
grant select on c201_fx to authenticated;

create or replace function pg_temp.soy(p uuid) returns void language plpgsql as $$
begin
    perform set_config('request.jwt.claim.sub', p::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
end $$;
grant execute on function pg_temp.soy(uuid) to authenticated;

do $$
declare a uuid := gen_random_uuid();
begin
    insert into c201_fx values (a);
    insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
        confirmation_token, email_change, email_change_token_new, recovery_token
    ) values ('00000000-0000-0000-0000-000000000000', a, 'authenticated', 'authenticated',
        'c201-' || a || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '');
end $$;

set local role authenticated;
do $$
declare f record; v_club uuid; v_mod text; m text;
        mk text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
begin
    select * into strict f from c201_fx;
    perform pg_temp.soy(f.adm);

    -- M1
    insert into public.clubs (nombre, slug, region, comuna, created_by, modalidad)
    values ('Arnés 201 ' || mk, 'arnes-201-' || mk, 'Región Metropolitana', 'Ñuñoa', f.adm, 'futbol5_7')
    returning id, modalidad into v_club, v_mod;
    if v_mod is distinct from 'futbol5_7' then raise exception 'FALLÓ M1: quedó %', v_mod; end if;

    insert into public.club_members (club_id, user_id, rol) values (v_club, f.adm, 'admin')
    on conflict do nothing;

    -- M2 y M3
    foreach m in array array['futbol5', 'futbol7', 'futbol11', 'futbol5_11', 'ambos', 'futbol5_7_11'] loop
        update public.clubs set modalidad = m where id = v_club returning modalidad into v_mod;
        if v_mod is distinct from m then raise exception 'FALLÓ M2: no se pudo poner % (quedó %)', m, v_mod; end if;
    end loop;

    -- M4
    begin
        update public.clubs set modalidad = 'futbol7_5' where id = v_club;
        raise exception 'FALLÓ M4: se guardó «futbol7_5»';
    exception when check_violation then
        if sqlerrm not like '%clubs_modalidad_check%' then raise; end if;
    end;

    -- M5
    begin
        update public.clubs set modalidad = 'futbol8' where id = v_club;
        raise exception 'FALLÓ M5: se guardó «futbol8»';
    exception when check_violation then
        if sqlerrm not like '%clubs_modalidad_check%' then raise; end if;
    end;
end $$;
reset role;

select 'OK 201: 5 casos' as resultado;
rollback;
