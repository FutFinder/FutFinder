-- Arnés de la migración 196 (la cola de moderación nombra lo reportado).
-- Crea sólo datos ficticios y termina en ROLLBACK. Si la 196 no está
-- aplicada, correr en una sola transacción: begin; <migración>; <este cuerpo>.
-- Lee la cola como `authenticated` con una cuenta del padrón, igual que la app.
--
--   N1  Un reporte de club trae el nombre del club.
--   N2  Uno de foto de club trae el nombre de su club.
--   N3  Uno de partido trae el título y la hora.
--   N4  Lo que ya no existe llega con nombre null, y la cola no se rompe.
--   N5  Un reporte de la persona (sin elemento) llega con nombre null.
--   N6  Quien no modera sigue sin poder leer la cola.
begin;

create temp table c196_fx (mod uuid, otro uuid, club uuid, foto uuid, partido uuid) on commit drop;
grant select on c196_fx to authenticated;

create or replace function pg_temp.soy(p uuid) returns void language plpgsql as $$
begin
    perform set_config('request.jwt.claim.sub', p::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', 'aal1')::text, true);
end $$;
grant execute on function pg_temp.soy(uuid) to authenticated;

do $$
declare f c196_fx; v_rep uuid := gen_random_uuid(); v_adm uuid := gen_random_uuid();
        mk text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
begin
    update public.feature_flags set activo = false where nombre in ('telefono_obligatorio', 'mfa_obligatoria_staff');
    f.mod := gen_random_uuid(); f.otro := gen_random_uuid();
    insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
        confirmation_token, email_change, email_change_token_new, recovery_token
    ) select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
        'c196-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
      from unnest(array[f.mod, f.otro, v_rep, v_adm]) u;
    insert into public.profiles (id, username)
    select u, 'c196' || mk || i from unnest(array[f.mod, f.otro, v_rep, v_adm]) with ordinality t(u, i)
      on conflict (id) do update set username = excluded.username;
    insert into public.moderadores (user_id) values (f.mod);

    insert into public.clubs (nombre, slug, created_by) values ('Club c196 ' || mk, 'c196-' || mk, v_adm) returning id into f.club;
    insert into public.club_members (club_id, user_id, rol) values (f.club, v_adm, 'admin') on conflict do nothing;
    insert into public.club_photos (club_id, photo_url, uploaded_by) values (f.club, 'https://x/c196.jpg', v_adm) returning id into f.foto;
    insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud, hora, cupos_totales, cupos_disponibles)
    values (v_adm, 'Partido c196 ' || mk, 'Ñuñoa', 'Cancha', -33.45, -70.6, now() + interval '3 days', 10, 9) returning id into f.partido;

    insert into public.user_reports (reporter_id, reported_id, motivo, elemento, descripcion) values
        (v_rep, v_adm, 'spam', 'club:' || f.club, 'c196-club'),
        (v_rep, v_adm, 'spam', 'foto_club:' || f.foto, 'c196-foto'),
        (v_rep, v_adm, 'spam', 'partido:' || f.partido, 'c196-partido'),
        (v_rep, v_adm, 'spam', 'club:' || gen_random_uuid(), 'c196-borrado'),
        (v_rep, v_adm, 'spam', 'club:no-es-uuid', 'c196-roto'),
        (v_rep, v_adm, 'spam', null, 'c196-perfil');
    insert into c196_fx select f.*;
end $$;

set local role authenticated;
do $$
declare f record; cola jsonb; r jsonb; ok boolean;
begin
    select * into strict f from c196_fx;
    perform pg_temp.soy(f.mod);
    cola := public.moderacion_cola()->'reportes_sin_mirar';

    -- N1
    select x into r from jsonb_array_elements(cola) x where x->>'descripcion' = 'c196-club';
    if coalesce(r->>'elemento_nombre', '') not like 'Club c196 %' then raise exception 'FALLÓ N1: club sin nombre: %', r; end if;

    -- N2
    select x into r from jsonb_array_elements(cola) x where x->>'descripcion' = 'c196-foto';
    if coalesce(r->>'elemento_nombre', '') not like 'Club c196 %' then raise exception 'FALLÓ N2: foto sin el nombre de su club: %', r; end if;

    -- N3
    select x into r from jsonb_array_elements(cola) x where x->>'descripcion' = 'c196-partido';
    if coalesce(r->>'elemento_nombre', '') not like 'Partido c196 %' or r->>'elemento_hora' is null then
        raise exception 'FALLÓ N3: partido sin título u hora: %', r;
    end if;

    -- N4
    select x into r from jsonb_array_elements(cola) x where x->>'descripcion' = 'c196-borrado';
    if r is null or not (r ? 'elemento_nombre') or r->'elemento_nombre' <> 'null'::jsonb then
        raise exception 'FALLÓ N4: lo borrado no llegó con nombre null: %', r;
    end if;
    select x into r from jsonb_array_elements(cola) x where x->>'descripcion' = 'c196-roto';
    if r is null or r->'elemento_nombre' <> 'null'::jsonb then raise exception 'FALLÓ N4b: el elemento roto rompió la fila: %', r; end if;

    -- N5
    select x into r from jsonb_array_elements(cola) x where x->>'descripcion' = 'c196-perfil';
    if r is null or r->'elemento_nombre' <> 'null'::jsonb then raise exception 'FALLÓ N5: %', r; end if;

    -- N6
    perform pg_temp.soy(f.otro);
    ok := false;
    begin
        perform public.moderacion_cola();
    exception when insufficient_privilege then ok := true;
    end;
    if not ok then raise exception 'FALLÓ N6: alguien fuera del padrón leyó la cola'; end if;
end $$;
reset role;

select 'OK 196: 6 casos' as resultado;
rollback;
