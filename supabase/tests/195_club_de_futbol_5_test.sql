-- Arnés de la migración 195 (club de Fútbol 5).
-- Crea sólo datos ficticios y termina en ROLLBACK. Si la 195 no está
-- aplicada, correr en una sola transacción: begin; <migración>; <este cuerpo>.
-- Crea y edita el club como `authenticated`, igual que `createClub` y
-- `updateClub` (insert y update directos, con la RLS de `clubs`).
--
--   C1  Crear un club de Fútbol 5.
--   C2  Editar un club de Fútbol 7 a Fútbol 5 (lo que pidió Vicente).
--   C3  'ambos' se sigue aceptando.
--   C4  Control negativo: una modalidad inventada se rechaza.
begin;

create temp table c195_fx (adm uuid) on commit drop;
grant select on c195_fx to authenticated;

create or replace function pg_temp.soy(p uuid) returns void language plpgsql as $$
begin
    perform set_config('request.jwt.claim.sub', p::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
end $$;
grant execute on function pg_temp.soy(uuid) to authenticated;

do $$
declare v uuid := gen_random_uuid();
begin
    insert into c195_fx values (v);
    insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
        confirmation_token, email_change, email_change_token_new, recovery_token
    ) values ('00000000-0000-0000-0000-000000000000', v, 'authenticated', 'authenticated',
        'c195-' || v || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '');
end $$;

set local role authenticated;
do $$
declare f record; v_club uuid; v_mod text; mk text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
begin
    select * into strict f from c195_fx;
    perform pg_temp.soy(f.adm);

    -- C1
    insert into public.clubs (nombre, slug, region, comuna, created_by, modalidad)
    values ('Arnés 195 ' || mk, 'arnes-195-' || mk, 'Región Metropolitana', 'Ñuñoa', f.adm, 'futbol5')
    returning id, modalidad into v_club, v_mod;
    if v_mod is distinct from 'futbol5' then raise exception 'FALLÓ C1: quedó %', v_mod; end if;

    -- El admin, como lo deja `createClub` (el disparador lo agrega si existe).
    insert into public.club_members (club_id, user_id, rol) values (v_club, f.adm, 'admin')
    on conflict do nothing;

    -- C2
    update public.clubs set modalidad = 'futbol7' where id = v_club;
    update public.clubs set modalidad = 'futbol5' where id = v_club returning modalidad into v_mod;
    if v_mod is distinct from 'futbol5' then raise exception 'FALLÓ C2: el admin no pudo pasarlo a Fútbol 5 (quedó %)', v_mod; end if;

    -- C3
    update public.clubs set modalidad = 'ambos' where id = v_club returning modalidad into v_mod;
    if v_mod is distinct from 'ambos' then raise exception 'FALLÓ C3: ambos ya no se acepta'; end if;

    -- C4
    begin
        update public.clubs set modalidad = 'futbol6' where id = v_club;
        raise exception 'FALLÓ C4: se guardó «futbol6»';
    exception when check_violation then
        if sqlerrm not like '%clubs_modalidad_check%' then raise; end if;
    end;
end $$;
reset role;

select 'OK 195: 4 casos' as resultado;
rollback;
