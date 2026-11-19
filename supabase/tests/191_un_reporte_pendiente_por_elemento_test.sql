-- Arnés de la migración 191 (un reporte pendiente por elemento).
-- Crea sólo datos ficticios y termina en ROLLBACK. Si la 191 no está
-- aplicada, correr en una sola transacción: begin; <migración>; <este cuerpo>.
-- Reporta como `authenticated`, igual que la app.
--
--   R1  Un club y un partido del MISMO admin se reportan los dos.
--   R2  El mismo club otra vez, mientras sigue pendiente: no, y lo dice claro.
--   R3  Con reportes de contenido pendientes, la CUENTA se puede reportar.
--   R4  Pero la cuenta, una sola vez mientras siga pendiente.
begin;

create temp table c191_fx (rep uuid, adm uuid, club uuid, partido uuid) on commit drop;
grant select on c191_fx to authenticated;

create or replace function pg_temp.soy(p uuid) returns void language plpgsql as $$
begin
    perform set_config('request.jwt.claim.sub', p::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
end $$;
grant execute on function pg_temp.soy(uuid) to authenticated;

do $$
declare f c191_fx; mk text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
begin
    update public.feature_flags set activo = false where nombre = 'telefono_obligatorio';
    f.rep := gen_random_uuid(); f.adm := gen_random_uuid();
    insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
        confirmation_token, email_change, email_change_token_new, recovery_token
    ) select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
        'c191-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
      from unnest(array[f.rep, f.adm]) u;
    insert into public.profiles (id, username)
    select u, 'c191' || mk || i from unnest(array[f.rep, f.adm]) with ordinality t(u, i)
      on conflict (id) do update set username = excluded.username;
    insert into public.clubs (nombre, slug, created_by) values ('Club c191 ' || mk, 'c191-' || mk, f.adm) returning id into f.club;
    insert into public.club_members (club_id, user_id, rol) values (f.club, f.adm, 'admin') on conflict do nothing;
    insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud, hora, cupos_totales, cupos_disponibles)
    values (f.adm, 'Partido c191', 'Ñuñoa', 'Cancha', -33.45, -70.6, now() + interval '3 days', 10, 9) returning id into f.partido;
    insert into c191_fx select f.*;
end $$;

set local role authenticated;
do $$
declare f record; r json; ok boolean; n int;
begin
    select * into strict f from c191_fx;
    perform pg_temp.soy(f.rep);

    -- R1
    r := public.reportar_contenido('club', f.club, 'contenido_ofensivo');
    if (r->>'ok')::boolean is not true then raise exception 'FALLÓ R1a: el club no se reportó: %', r; end if;
    r := public.reportar_contenido('partido', f.partido, 'informacion_falsa');
    if (r->>'ok')::boolean is not true then raise exception 'FALLÓ R1b: el partido del mismo admin no se reportó: %', r; end if;

    -- R2
    r := public.reportar_contenido('club', f.club, 'spam');
    if (r->>'ok')::boolean is not false or r->>'reason' not like 'Ya reportaste esto%' then
        raise exception 'FALLÓ R2: el club repetido dio %', r;
    end if;

    -- R3: la cuenta, como `reportUser` (insert directo, sin elemento).
    insert into public.user_reports (reporter_id, reported_id, motivo) values (f.rep, f.adm, 'spam');

    -- R4
    ok := false;
    begin
        insert into public.user_reports (reporter_id, reported_id, motivo) values (f.rep, f.adm, 'otro');
    exception when unique_violation then ok := true;
    end;
    if not ok then raise exception 'FALLÓ R4: la cuenta se reportó dos veces pendientes'; end if;

    select count(*) into n from public.user_reports where reporter_id = f.rep and estado = 'pendiente';
    if n <> 3 then raise exception 'FALLÓ: esperaba 3 reportes pendientes, hay %', n; end if;
end $$;
reset role;

select 'OK 191: 4 casos' as resultado;
rollback;
