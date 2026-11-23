-- Arnés de la migración 188 (la invitación a un club avisa al invitado).
-- Crea sólo datos ficticios y termina en ROLLBACK. Si la 188 no está
-- aplicada, correr en una sola transacción: begin; <migración>; <este cuerpo>.
-- Invitar y responder se hacen como `authenticated`, igual que
-- `inviteToClub` y `respondToRequest`; `postgres` sólo prepara los datos.
--
--   I1  Invitar crea un aviso `club_invite` para el invitado, con club,
--       invitación y quién invitó.
--   I2  Aceptar desde ese aviso (UPDATE de la invitación) lo hace miembro.
--   I3  Si el invitado bloqueó a quien invita, no hay aviso.
--   I4  Si quien invita bloqueó al invitado, tampoco.
--   S1  Las solicitudes siguen avisando a los admins con `club_request`.
begin;

create temp table c188_fx (admin uuid, inv uuid, bloq uuid, bloqueado uuid, sol uuid, club uuid) on commit drop;
grant select on c188_fx to authenticated;

create or replace function pg_temp.soy(p uuid) returns void language plpgsql as $$
begin
    perform set_config('request.jwt.claim.sub', p::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
end $$;
grant execute on function pg_temp.soy(uuid) to authenticated;

do $$
declare f c188_fx; mk text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
begin
    f.admin := gen_random_uuid(); f.inv := gen_random_uuid(); f.bloq := gen_random_uuid();
    f.bloqueado := gen_random_uuid(); f.sol := gen_random_uuid();
    insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
        confirmation_token, email_change, email_change_token_new, recovery_token
    ) select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
        'c188-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
      from unnest(array[f.admin, f.inv, f.bloq, f.bloqueado, f.sol]) u;
    insert into public.profiles (id, username)
    select u, 'c188' || mk || i from unnest(array[f.admin, f.inv, f.bloq, f.bloqueado, f.sol]) with ordinality t(u, i)
      on conflict (id) do update set username = excluded.username;
    insert into public.clubs (nombre, slug, created_by) values ('Club c188 ' || mk, 'c188-' || mk, f.admin) returning id into f.club;
    insert into public.club_members (club_id, user_id, rol) values (f.club, f.admin, 'admin')
      on conflict do nothing;
    insert into public.blocked_users (blocker_id, blocked_id) values (f.bloq, f.admin), (f.admin, f.bloqueado);
    insert into c188_fx select f.*;
end $$;

set local role authenticated;
do $$
declare f record; v_req uuid; n record; c int;
begin
    select * into strict f from c188_fx;

    -- I1
    perform pg_temp.soy(f.admin);
    insert into public.club_join_requests (club_id, user_id, tipo) values (f.club, f.inv, 'invitacion') returning id into v_req;
    perform pg_temp.soy(f.inv);
    select * into n from public.notifications where user_id = f.inv and type = 'club_invite';
    if n is null then raise exception 'FALLÓ I1: el invitado no recibió aviso'; end if;
    if n.data->>'clubId' <> f.club::text or n.data->>'requestId' <> v_req::text or n.data->>'fromUserId' <> f.admin::text then
        raise exception 'FALLÓ I1b: el aviso trae datos equivocados: %', n.data;
    end if;
    if n.title not like '%te invitó a Club c188%' then raise exception 'FALLÓ I1c: título «%»', n.title; end if;

    -- I2: aceptar desde el aviso, como `respondToRequest`.
    update public.club_join_requests set status = 'approved', responded_at = now()
     where id = (n.data->>'requestId')::uuid and status = 'pending';
    select count(*) into c from public.club_members where club_id = f.club and user_id = f.inv;
    if c <> 1 then raise exception 'FALLÓ I2: aceptar desde el aviso no lo hizo miembro'; end if;

    -- I3 y I4
    perform pg_temp.soy(f.admin);
    insert into public.club_join_requests (club_id, user_id, tipo) values (f.club, f.bloq, 'invitacion');
    insert into public.club_join_requests (club_id, user_id, tipo) values (f.club, f.bloqueado, 'invitacion');
end $$;
reset role;

do $$
declare f record; c int;
begin
    select * into strict f from c188_fx;
    select count(*) into c from public.notifications where user_id = f.bloq and type = 'club_invite';
    if c <> 0 then raise exception 'FALLÓ I3: avisó a quien bloqueó al que invita'; end if;
    select count(*) into c from public.notifications where user_id = f.bloqueado and type = 'club_invite';
    if c <> 0 then raise exception 'FALLÓ I4: avisó a quien el que invita bloqueó'; end if;
end $$;

-- S1
set local role authenticated;
do $$
declare f record;
begin
    select * into strict f from c188_fx;
    perform pg_temp.soy(f.sol);
    insert into public.club_join_requests (club_id, user_id, tipo) values (f.club, f.sol, 'solicitud');
end $$;
reset role;
do $$
declare f record; c int;
begin
    select * into strict f from c188_fx;
    select count(*) into c from public.notifications where user_id = f.admin and type = 'club_request' and data->>'fromUserId' = f.sol::text;
    if c <> 1 then raise exception 'FALLÓ S1: la solicitud dejó de avisar al admin (%)', c; end if;
end $$;

select 'OK 188: 5 casos' as resultado;
rollback;
