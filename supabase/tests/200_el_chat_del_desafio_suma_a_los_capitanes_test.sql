-- Arnés de la migración 200 (el chat del desafío suma a los capitanes).
-- Crea sólo datos ficticios y termina en ROLLBACK. Si la 200 no está
-- aplicada, correr en una sola transacción: begin; <migración>; <este cuerpo>.
--
-- La preparación (clubes, integrantes y un desafío en negociación) corre con
-- el rol de la conexión; las comprobaciones, como `authenticated`, por el
-- camino real: un `insert` en `messages` que la RLS acepta o rechaza.
--
--   K1  Un club nuevo nace con `chatClubs` encendido para el capitán y
--       apagado para el jugador.
--   K2  Ningún club quedó con el capitán sin `chatClubs` (el backfill).
--   K3  El capitán escribe en el hilo del desafío.
--   K4  El capitán ve el hilo (`chat_puede_ver_desafio`).
--   K5  Control negativo: el jugador no escribe en el hilo.
--   K6  El administrador le apaga el permiso a los capitanes de su club, y el
--       capitán deja de poder escribir: sigue siendo un permiso, no un rol fijo.
begin;

create temp table c200_fx (
    adm_a uuid, cap_a uuid, jug_a uuid, adm_b uuid,
    club_a uuid, club_b uuid, desafio uuid
) on commit drop;
grant select on c200_fx to authenticated;

create or replace function pg_temp.soy(p uuid) returns void language plpgsql as $$
begin
    perform set_config('request.jwt.claim.sub', p::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
end $$;
grant execute on function pg_temp.soy(uuid) to authenticated;

do $$
declare
    u uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
    v uuid; v_a uuid; v_b uuid; v_d uuid;
    mk text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
begin
    foreach v in array u loop
        insert into auth.users (
            instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
            created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
            confirmation_token, email_change, email_change_token_new, recovery_token
        ) values ('00000000-0000-0000-0000-000000000000', v, 'authenticated', 'authenticated',
            'c200-' || v || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '');
    end loop;

    insert into public.clubs (nombre, slug, region, comuna, created_by, modalidad)
    values ('Arnés 200 A ' || mk, 'arnes-200-a-' || mk, 'Región Metropolitana', 'Ñuñoa', u[1], 'futbol7')
    returning id into v_a;
    insert into public.clubs (nombre, slug, region, comuna, created_by, modalidad)
    values ('Arnés 200 B ' || mk, 'arnes-200-b-' || mk, 'Región Metropolitana', 'Maipú', u[4], 'futbol7')
    returning id into v_b;

    insert into public.club_members (club_id, user_id, rol) values
        (v_a, u[1], 'admin'), (v_a, u[2], 'capitan'), (v_a, u[3], 'jugador'), (v_b, u[4], 'admin')
    on conflict do nothing;

    insert into public.club_challenges (club_retador_id, club_retado_id, estado)
    values (v_a, v_b, 'negociacion')
    returning id into v_d;

    insert into c200_fx values (u[1], u[2], u[3], u[4], v_a, v_b, v_d);
end $$;

-- K1 y K2, con el rol de la conexión.
do $$
declare f record; v_cap boolean; v_jug boolean; v_apagados integer;
begin
    select * into strict f from c200_fx;
    select activo into strict v_cap from public.club_role_permissions
     where club_id = f.club_a and rol = 'capitan' and permiso = 'chatClubs';
    select activo into strict v_jug from public.club_role_permissions
     where club_id = f.club_a and rol = 'jugador' and permiso = 'chatClubs';
    if v_cap is distinct from true then raise exception 'FALLÓ K1: el capitán nació sin chatClubs'; end if;
    if v_jug is distinct from false then raise exception 'FALLÓ K1: el jugador nació con chatClubs'; end if;

    select count(*) into v_apagados from public.club_role_permissions
     where rol = 'capitan' and permiso = 'chatClubs' and not activo;
    if v_apagados > 0 then raise exception 'FALLÓ K2: % clubes con el capitán sin chatClubs', v_apagados; end if;
end $$;

set local role authenticated;
do $$
declare f record; v_ok boolean;
begin
    select * into strict f from c200_fx;

    -- K3
    perform pg_temp.soy(f.cap_a);
    insert into public.messages (sender_id, challenge_id, content)
    values (f.cap_a, f.desafio, 'Hola, soy el capitán');

    -- K4
    select public.chat_puede_ver_desafio(f.desafio, f.cap_a) into v_ok;
    if v_ok is distinct from true then raise exception 'FALLÓ K4: el capitán no ve el hilo'; end if;

    -- K5
    perform pg_temp.soy(f.jug_a);
    begin
        insert into public.messages (sender_id, challenge_id, content)
        values (f.jug_a, f.desafio, 'Hola, soy un jugador');
        raise exception 'FALLÓ K5: el jugador escribió en el hilo del desafío';
    exception when insufficient_privilege then
        null;
    end;

    -- K6
    perform pg_temp.soy(f.adm_a);
    perform public.club_guardar_permisos_rol(f.club_a, 'capitan', '{"chatClubs": false}'::jsonb);
    perform pg_temp.soy(f.cap_a);
    begin
        insert into public.messages (sender_id, challenge_id, content)
        values (f.cap_a, f.desafio, 'Ya no debería poder');
        raise exception 'FALLÓ K6: el capitán siguió escribiendo sin el permiso';
    exception when insufficient_privilege then
        null;
    end;
end $$;
reset role;

select 'OK 200: 6 casos' as resultado;
rollback;
