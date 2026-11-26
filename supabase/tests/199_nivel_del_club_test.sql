-- Arnés de la migración 199 (nivel del club).
-- Crea sólo datos ficticios y termina en ROLLBACK. Si la 199 no está
-- aplicada, correr en una sola transacción: begin; <migración>; <este cuerpo>.
-- Crea y edita el club como `authenticated`, igual que `createClub` y
-- `updateClub` (insert y update directos, con la RLS de `clubs`).
--
--   N1  Crear un club sin nivel: queda NULL, no 'recreativo'.
--   N2  Crear un club con nivel: el privilegio de INSERT alcanza a la columna.
--   N3  El administrador cambia el nivel a cada uno de los cinco valores.
--   N4  El administrador vuelve a «sin nivel» (NULL).
--   N5  Control negativo: un nivel inventado se rechaza por el CHECK.
--   N6  Control negativo: alguien que no es del club no cambia el nivel.
begin;

create temp table c199_fx (adm uuid, otro uuid) on commit drop;
grant select on c199_fx to authenticated;

create or replace function pg_temp.soy(p uuid) returns void language plpgsql as $$
begin
    perform set_config('request.jwt.claim.sub', p::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
end $$;
grant execute on function pg_temp.soy(uuid) to authenticated;

do $$
declare a uuid := gen_random_uuid(); o uuid := gen_random_uuid(); v uuid;
begin
    insert into c199_fx values (a, o);
    foreach v in array array[a, o] loop
        insert into auth.users (
            instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
            created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
            confirmation_token, email_change, email_change_token_new, recovery_token
        ) values ('00000000-0000-0000-0000-000000000000', v, 'authenticated', 'authenticated',
            'c199-' || v || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '');
    end loop;
end $$;

create temp table c199_club (id uuid, id2 uuid) on commit drop;
grant select, insert on c199_club to authenticated;

set local role authenticated;
do $$
declare f record; v_club uuid; v_club2 uuid; v_nivel text; n text;
        mk text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
begin
    select * into strict f from c199_fx;
    perform pg_temp.soy(f.adm);

    -- N1
    insert into public.clubs (nombre, slug, region, comuna, created_by, modalidad)
    values ('Arnés 199 ' || mk, 'arnes-199-' || mk, 'Región Metropolitana', 'Ñuñoa', f.adm, 'futbol7')
    returning id, nivel into v_club, v_nivel;
    if v_nivel is not null then raise exception 'FALLÓ N1: nació con nivel %', v_nivel; end if;

    insert into public.club_members (club_id, user_id, rol) values (v_club, f.adm, 'admin')
    on conflict do nothing;

    -- N2
    insert into public.clubs (nombre, slug, region, comuna, created_by, modalidad, nivel)
    values ('Arnés 199 b ' || mk, 'arnes-199-b-' || mk, 'Región Metropolitana', 'Ñuñoa', f.adm, 'futbol5', 'amateur')
    returning id, nivel into v_club2, v_nivel;
    if v_nivel is distinct from 'amateur' then raise exception 'FALLÓ N2: quedó %', v_nivel; end if;

    insert into c199_club values (v_club, v_club2);

    -- N3
    foreach n in array array['recreativo', 'amateur', 'intermedio', 'competitivo', 'elite'] loop
        update public.clubs set nivel = n where id = v_club returning nivel into v_nivel;
        if v_nivel is distinct from n then raise exception 'FALLÓ N3: el admin no pudo poner % (quedó %)', n, v_nivel; end if;
    end loop;

    -- N4
    update public.clubs set nivel = null where id = v_club returning nivel into v_nivel;
    if v_nivel is not null then raise exception 'FALLÓ N4: no se pudo volver a sin nivel'; end if;

    -- N5
    begin
        update public.clubs set nivel = 'profesional' where id = v_club;
        raise exception 'FALLÓ N5: se guardó «profesional»';
    exception when check_violation then
        if sqlerrm not like '%clubs_nivel_check%' then raise; end if;
    end;
end $$;

do $$
declare f record; c record; v_nivel text;
begin
    select * into strict f from c199_fx;
    select * into strict c from c199_club;
    perform pg_temp.soy(f.otro);

    -- N6: la RLS deja la actualización sin filas.
    update public.clubs set nivel = 'elite' where id = c.id;
    perform pg_temp.soy(f.adm);
    select nivel into v_nivel from public.clubs where id = c.id;
    if v_nivel is not null then raise exception 'FALLÓ N6: alguien ajeno puso el nivel %', v_nivel; end if;
end $$;
reset role;

select 'OK 199: 6 casos' as resultado;
rollback;
