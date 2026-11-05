-- =============================================================
-- FutFinder — pruebas de la migración 169 (C04 y C05 del servidor).
--
--   C04. Leer un DM no cerraba su aviso `message_new`: `mark_chat_read`
--        tocaba `chat_reads` y `messages`, no `notifications`. El mensaje
--        siguiente encontraba el aviso viejo sin leer y lo ACTUALIZABA, así
--        que no había INSERT y por lo tanto ni push ni popup.
--   C05. Silenciar un hilo no frenaba nada del lado del servidor: el
--        disparador del DM y el de `/todos` avisaban igual.
--
--   L1. Leer el DM (con la sesión de quien lo recibió) cierra su aviso.
--   L2. El mensaje siguiente crea un aviso NUEVO (INSERT), no actualiza el viejo.
--   L3. Leer un hilo no cierra los avisos de otro hilo.
--   L4. Leer cierra también el `/todos` del hilo de club.
--   L5. Nadie cierra los avisos de otra persona llamando `mark_chat_read`.
--   S1. Un DM a quien silenció ese hilo no crea aviso.
--   S2. Un DM a quien NO lo silenció sí (control).
--   S3. `/todos` no avisa a quien silenció el chat del club…
--   S4. …y sí a quien no lo silenció.
--   S5. `/todos` marcado `/importante` atraviesa el silencio, y el aviso
--       lleva `important: true` (lo mira el popup del cliente).
--   P1. `push_status` acepta `skipped_muted` (lo usa `send-push`).
--   P2. El cliente no puede escribir `push_status`: 42501.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r169 (caso text, ok boolean, detalle text);
grant all on r169 to authenticated;

do $$
declare
  v_ana uuid := gen_random_uuid();   -- recibe DMs y lee
  v_beto uuid := gen_random_uuid();  -- le escribe a Ana
  v_caro uuid := gen_random_uuid();  -- otro que le escribe a Ana
  v_dani uuid := gen_random_uuid();  -- miembro del club que silenció
  v_club uuid; v_notif uuid; v_n int; v_codigo text;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r169-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_ana, v_beto, v_caro, v_dani]) u;

  -- Los mensajes se insertan como `postgres`: lo que se prueba son los
  -- disparadores, que corren igual. Lo que depende de la sesión —leer— se
  -- hace con la sesión de cada uno.
  insert into public.messages (sender_id, receiver_id, content) values (v_beto, v_ana, 'hola Ana');
  insert into public.messages (sender_id, receiver_id, content) values (v_caro, v_ana, 'hola de Caro');

  -- ── L1: Ana lee el DM de Beto ──
  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ana, 'role', 'authenticated')::text);
  perform public.mark_chat_read('dm:' || v_beto);
  reset role;
  set local request.jwt.claims to '{}';

  select id into v_notif from public.notifications
   where user_id = v_ana and type = 'message_new' and data->>'fromUserId' = v_beto::text;
  insert into r169 values ('L1 leer el DM cierra su aviso',
    (select read from public.notifications where id = v_notif),
    coalesce((select read::text from public.notifications where id = v_notif), 'sin aviso'));

  -- ── L3: el de Caro sigue abierto ──
  insert into r169 values ('L3 leer un hilo no cierra los de otro',
    exists (select 1 from public.notifications where user_id = v_ana and type = 'message_new'
             and data->>'fromUserId' = v_caro::text and not read), '');

  -- ── L2: Beto vuelve a escribir: aviso NUEVO ──
  insert into public.messages (sender_id, receiver_id, content) values (v_beto, v_ana, 'otra cosa');
  select count(*) into v_n from public.notifications
   where user_id = v_ana and type = 'message_new' and data->>'fromUserId' = v_beto::text;
  insert into r169 values ('L2 el mensaje siguiente crea un aviso nuevo (INSERT, con push)',
    v_n = 2 and exists (select 1 from public.notifications where user_id = v_ana
      and type = 'message_new' and data->>'fromUserId' = v_beto::text and not read and id <> v_notif),
    v_n || ' avisos de Beto');

  -- ── L5: Caro no puede cerrarle a Ana el aviso de Beto ──
  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_caro, 'role', 'authenticated')::text);
  perform public.mark_chat_read('dm:' || v_beto);
  reset role;
  set local request.jwt.claims to '{}';
  insert into r169 values ('L5 nadie cierra los avisos de otra persona',
    exists (select 1 from public.notifications where user_id = v_ana and type = 'message_new'
             and data->>'fromUserId' = v_beto::text and not read), '');

  -- ── S1/S2: Ana silencia el DM de Caro ──
  insert into public.chat_mutes (user_id, thread_key) values (v_ana, 'dm:' || v_caro);
  update public.notifications set read = true where user_id = v_ana; -- parte limpia
  insert into public.messages (sender_id, receiver_id, content) values (v_caro, v_ana, 'silenciado');
  insert into public.messages (sender_id, receiver_id, content) values (v_beto, v_ana, 'no silenciado');
  insert into r169 values ('S1 un DM silenciado no crea aviso',
    not exists (select 1 from public.notifications where user_id = v_ana and not read
                 and data->>'fromUserId' = v_caro::text), '');
  insert into r169 values ('S2 un DM no silenciado sí',
    exists (select 1 from public.notifications where user_id = v_ana and not read
             and data->>'fromUserId' = v_beto::text), '');

  -- ── S3/S4/S5/L4: /todos en el club ──
  insert into public.clubs (nombre, slug, created_by)
  values ('Club 169 ' || left(v_beto::text, 8), 'club-169-' || left(v_beto::text, 8), v_beto)
  returning id into v_club;
  insert into public.club_members (club_id, user_id, rol) values
    (v_club, v_beto, 'admin'), (v_club, v_ana, 'jugador'), (v_club, v_dani, 'jugador')
  on conflict do nothing;
  insert into public.chat_mutes (user_id, thread_key) values (v_dani, 'club:' || v_club);

  insert into public.messages (sender_id, club_id, content, mention_all)
  values (v_beto, v_club, '/todos el sábado a las 10', true);
  insert into r169 values ('S3 /todos no avisa a quien silenció el club',
    not exists (select 1 from public.notifications where user_id = v_dani and type = 'chat_mention_all'), '');
  insert into r169 values ('S4 /todos sí avisa a quien no lo silenció',
    exists (select 1 from public.notifications where user_id = v_ana and type = 'chat_mention_all'
             and data->>'threadKey' = 'club:' || v_club and not read), '');

  insert into public.messages (sender_id, club_id, content, mention_all, is_important)
  values (v_beto, v_club, '/todos /importante se suspende', true, true);
  insert into r169 values ('S5 /importante atraviesa el silencio y lo dice en el aviso',
    exists (select 1 from public.notifications where user_id = v_dani and type = 'chat_mention_all'
             and (data->>'important')::boolean), '');

  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ana, 'role', 'authenticated')::text);
  perform public.mark_chat_read('club:' || v_club);
  reset role;
  set local request.jwt.claims to '{}';
  insert into r169 values ('L4 leer el chat del club cierra su /todos',
    not exists (select 1 from public.notifications where user_id = v_ana and type = 'chat_mention_all'
                 and data->>'threadKey' = 'club:' || v_club and not read), '');

  -- ── P1: el estado nuevo de send-push ──
  begin
    update public.notifications set push_status = 'skipped_muted'
     where id = (select id from public.notifications where user_id = v_ana limit 1);
    v_codigo := 'ok';
  exception when others then v_codigo := sqlstate;
  end;
  insert into r169 values ('P1 push_status acepta skipped_muted', v_codigo = 'ok', v_codigo);

  -- ── P2: y el cliente no lo puede escribir ──
  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ana, 'role', 'authenticated')::text);
  begin
    update public.notifications set push_status = 'skipped_muted' where user_id = v_ana;
    v_codigo := 'sin error';
  exception when others then v_codigo := sqlstate;
  end;
  reset role;
  set local request.jwt.claims to '{}';
  insert into r169 values ('P2 el cliente no escribe push_status: 42501', v_codigo = '42501', v_codigo);
end $$;

select caso, ok, detalle from r169 order by caso;
do $$
declare v_mal int;
begin
  select count(*) into v_mal from r169 where not ok;
  if v_mal > 0 then
    raise exception '% caso(s) de la 169 fallaron (mira la tabla de arriba)', v_mal;
  end if;
end $$;

rollback;
