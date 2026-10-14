-- Fixture de `scripts/carrera-dos-sesiones.sh`.
--
-- Deja en la base LOCAL dos clubes con administradores distintos, un desafío
-- aceptado y un partido publicado, y apunta sus identificadores en
-- `public.carrera_fixture` para que las dos sesiones del arnés los
-- encuentren. No se corre contra producción: siembra filas de verdad.
--
-- Lo lanza el propio arnés si el fixture no está.

do $$
declare
  v_a uuid := 'aaaa0000-0000-4000-8000-000000000001';
  v_b uuid := 'bbbb0000-0000-4000-8000-000000000002';
  v_ca uuid; v_cb uuid; v_ch uuid; v_prop record; v_m uuid;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
    'carrera-'||u.id||'@futfinder.test','x',now(),now(),now(),'{}','{}','','','',''
  from (values (v_a), (v_b)) as u(id)
  on conflict (id) do nothing;
  insert into public.profiles (id, username) values (v_a,'carreraa'), (v_b,'carrerab')
    on conflict (id) do nothing;

  insert into public.clubs (nombre, slug, created_by) values ('Carrera A','carrera-a',v_a)
    returning id into v_ca;
  insert into public.clubs (nombre, slug, created_by) values ('Carrera B','carrera-b',v_b)
    returning id into v_cb;
  insert into public.club_members (club_id,user_id,rol) values (v_ca,v_a,'admin'), (v_cb,v_b,'admin');

  insert into public.club_challenges (club_retador_id, club_retado_id, creado_por, estado)
  values (v_ca, v_cb, v_a, 'pendiente') returning id into v_ch;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',v_b::text,'role','authenticated')::text, true);
  perform public.aceptar_desafio(v_ch);
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',v_a::text,'role','authenticated')::text, true);
  v_prop := public.crear_propuesta_oficial(v_ch, jsonb_build_object(
    'fecha', (now() + interval '6 days')::text, 'duracion_min', 90,
    'direccion','Calle','cancha_nombre','Cancha carrera','comuna','Ñuñoa','region','Metropolitana',
    'latitud',-33.4569,'longitud',-70.6483,'modalidad','futbol7','cupos_por_club',7,
    'metodo_inscripcion','orden_llegada','cuota_por_persona',0), gen_random_uuid());
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',v_b::text,'role','authenticated')::text, true);
  perform public.aprobar_propuesta(v_prop.id, false);
  reset role;

  select id into v_m from public.matches where challenge_proposal_id = v_prop.id;
  create table if not exists public.carrera_fixture(clave text primary key, valor uuid);
  delete from public.carrera_fixture;
  insert into public.carrera_fixture values
    ('match', v_m), ('challenge', v_ch), ('club_a', v_ca), ('club_b', v_cb),
    ('user_a', v_a), ('user_b', v_b);
  raise notice 'partido %', v_m;
end $$;
select clave, valor from public.carrera_fixture order by clave;
