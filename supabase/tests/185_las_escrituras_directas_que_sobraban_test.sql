-- =============================================================
-- FutFinder — pruebas de la migración 185 (antes numerada 153, que ya era otra)
--
-- Cada ataque se reprodujo antes en producción; acá se comprueba que
-- quedó cerrado Y que el uso legítimo que hace la app sigue andando, que
-- es lo que un recorte de columnas suele romper sin avisar.
--
--   F1  El destinatario ya no puede cambiar `requester_id` (amistad forzada).
--   F2  Pero sí aceptar y rechazar, como hace `services/friends.js`.
--   P1  Un admin de OTRO club no sube fotos a una galería ajena…
--   P2  …ni borra las suyas.
--   P3  El admin del club sí sube y borra en la suya.
--   C1  El club retador no se acepta su propio desafío.
--   C2  El retador no puede rechazarlo por el rival…
--   C3  …ni cambiar el club desafiado.
--   C4  El retado sí lo rechaza, y el retador sí cancela otro.
--   C5  Enlazar el partido sólo con uno que organizas tú.
--   O1  Una publicación abierta no se muda a otro club.
--   O2  Pero sí se edita y se cancela, como hace `clubOpenChallenges.js`.
--   S1  `profile-gallery` tiene tope de 5 MB y sólo imágenes.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run. Termina en ROLLBACK y no deja nada.
-- =============================================================

begin;

do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  c uuid := gen_random_uuid(); v uuid := gen_random_uuid();
  mk text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  club_x uuid; club_y uuid; fid uuid; fid2 uuid; ch1 uuid; ch2 uuid; oc uuid;
  mid_a uuid; mid_b uuid; n int; ok boolean; err text;
begin
  -- ── Montaje (como postgres) ───────────────────────────────────
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, email_change,
    email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
    't153-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[a, b, c, v]) u;
  insert into public.profiles (id, username)
  select u, 't153' || mk || i from unnest(array[a, b, c, v]) with ordinality t(u, i)
    on conflict (id) do update set username = excluded.username;
  update public.profiles set privacy_friend_requests = 'nobody' where id = v;

  insert into public.clubs (nombre, slug, created_by) values ('T153 X ' || mk, 't153-x-' || mk, a) returning id into club_x;
  insert into public.clubs (nombre, slug, created_by) values ('T153 Y ' || mk, 't153-y-' || mk, b) returning id into club_y;
  insert into public.club_members (club_id, user_id, rol) values (club_x, a, 'admin'), (club_y, b, 'admin');
  insert into public.club_photos (club_id, photo_url, uploaded_by) values (club_y, 'https://t153/y.jpg', b);

  -- Dos solicitudes pendientes hacia `a`, de su cuenta cómplice `c`, y
  -- una de `b` hacia `c` para el uso legítimo.
  insert into public.friendships (requester_id, addressee_id, status) values (c, a, 'pending') returning id into fid;
  insert into public.friendships (requester_id, addressee_id, status) values (b, c, 'pending') returning id into fid2;

  -- Partidos: uno de `a` y uno de `b`, copiando las columnas obligatorias
  -- de cualquier partido existente para no depender del esquema exacto.
  -- (Si no hay ninguno en la base, C5 se salta.)
  create temp table t153_m on commit drop as select * from public.matches limit 1;
  if exists (select 1 from t153_m) then
    update t153_m set id = gen_random_uuid(), id_organizador = a, challenge_id = null,
      challenge_proposal_id = null, club_local_id = null, club_visitante_id = null, reserva_id = null;
    insert into public.matches select * from t153_m returning id into mid_a;
    update t153_m set id = gen_random_uuid(), id_organizador = b;
    insert into public.matches select * from t153_m returning id into mid_b;
  end if;

  -- ── F: amistades ──────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := true;
  begin
    update public.friendships set requester_id = v, status = 'accepted' where id = fid;
  exception when insufficient_privilege then ok := false; end;
  reset role;
  select count(*) into n from public.friendships where requester_id = v and addressee_id = a;
  if ok or n <> 0 then raise exception 'F1 FALLA: el destinatario sigue cambiando requester_id'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.friendships set status = 'accepted', responded_at = now() where id = fid2;
  get diagnostics n = row_count;
  reset role;
  if n <> 1 then raise exception 'F2 FALLA: aceptar una solicitud dejó de funcionar'; end if;

  -- ── P: fotos ──────────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := true;
  begin
    insert into public.club_photos (club_id, photo_url, uploaded_by) values (club_y, 'https://t153/evil.jpg', a);
  exception when insufficient_privilege then ok := false; end;
  if ok then reset role; raise exception 'P1 FALLA: un admin ajeno subió a la galería de otro club'; end if;
  delete from public.club_photos where club_id = club_y;
  get diagnostics n = row_count;
  reset role;
  if n <> 0 then raise exception 'P2 FALLA: un admin ajeno borró % fotos de otro club', n; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.club_photos (club_id, photo_url, uploaded_by) values (club_y, 'https://t153/y2.jpg', b);
  delete from public.club_photos where club_id = club_y;
  get diagnostics n = row_count;
  reset role;
  if n <> 2 then raise exception 'P3 FALLA: el admin del club no pudo gestionar su galería (% borradas)', n; end if;

  -- ── C: desafíos ───────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.club_challenges (club_retador_id, club_retado_id, creado_por) values (club_x, club_y, a) returning id into ch1;

  err := null;
  begin
    update public.club_challenges set estado = 'aceptado', respondido_por = a where id = ch1;
  exception when insufficient_privilege then err := sqlerrm; end;
  if err is null then reset role; raise exception 'C1 FALLA: el retador se aceptó su propio desafío'; end if;

  err := null;
  begin
    update public.club_challenges set estado = 'rechazado', respondido_por = a where id = ch1;
  exception when insufficient_privilege then err := sqlerrm; end;
  if err is null then reset role; raise exception 'C2 FALLA: el retador rechazó por el rival'; end if;

  ok := true;
  begin
    update public.club_challenges set club_retado_id = club_x where id = ch1;
  exception when insufficient_privilege then ok := false; end;
  if ok then reset role; raise exception 'C3 FALLA: se pudo cambiar el club desafiado'; end if;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.club_challenges set estado = 'rechazado', responded_at = now(), respondido_por = b
   where id = ch1 and estado = 'pendiente';
  get diagnostics n = row_count;
  reset role;
  if n <> 1 then raise exception 'C4 FALLA: el club desafiado no pudo rechazar'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.club_challenges (club_retador_id, club_retado_id, creado_por) values (club_x, club_y, a) returning id into ch2;
  update public.club_challenges set estado = 'cancelado', responded_at = now() where id = ch2 and estado = 'pendiente';
  get diagnostics n = row_count;
  if n <> 1 then reset role; raise exception 'C4 FALLA: el retador no pudo cancelar'; end if;

  if mid_a is not null then
    err := null;
    begin
      update public.club_challenges set match_id = mid_b where id = ch2;
    exception when insufficient_privilege then err := sqlerrm; end;
    if err is null then reset role; raise exception 'C5 FALLA: se enlazó un partido ajeno'; end if;
    update public.club_challenges set match_id = mid_a where id = ch2;
    get diagnostics n = row_count;
    if n <> 1 then reset role; raise exception 'C5 FALLA: no se pudo enlazar el partido propio'; end if;
  end if;
  reset role;

  -- ── O: publicaciones abiertas ─────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.club_open_challenges (club_id, creado_por, estado, modalidad, fecha_propuesta)
  values (club_x, a, 'abierto', 'futbol7', now() + interval '3 days') returning id into oc;
  ok := true;
  begin
    update public.club_open_challenges set club_id = club_y where id = oc;
  exception when insufficient_privilege then ok := false; end;
  if ok then reset role; raise exception 'O1 FALLA: la publicación se mudó a otro club'; end if;

  update public.club_open_challenges
     set modalidad = 'futbol11', fecha_propuesta = now() + interval '4 days', zona = 'Ñuñoa', mensaje = 'hola'
   where id = oc and estado = 'abierto';
  get diagnostics n = row_count;
  if n <> 1 then reset role; raise exception 'O2 FALLA: editar la publicación dejó de funcionar'; end if;
  update public.club_open_challenges set estado = 'cancelado' where id = oc and estado = 'abierto';
  get diagnostics n = row_count;
  reset role;
  if n <> 1 then raise exception 'O2 FALLA: cancelar la publicación dejó de funcionar'; end if;

  -- ── S: Storage ────────────────────────────────────────────────
  select count(*) into n from storage.buckets
   where id = 'profile-gallery' and file_size_limit = 5242880
     and allowed_mime_types @> array['image/jpeg', 'image/png']
     and not allowed_mime_types && array['text/html', 'application/octet-stream'];
  if n <> 1 then raise exception 'S1 FALLA: profile-gallery sigue sin límites'; end if;

  raise notice 'MIGRACIÓN 185: 13/13 casos OK%', case when mid_a is null then ' (C5 saltado: no hay partidos)' else '' end;
end $$;

rollback;
