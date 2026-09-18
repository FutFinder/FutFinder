-- =============================================================
-- FutFinder — pruebas de las migraciones 117 y 118.
--
-- Van juntas porque son una sola cosa: de dónde saca su credencial el
-- push. La 117 la movió del catálogo a Vault; la 118 cambió la service
-- key por la publicable. C5 vigila lo segundo.
--
-- La prueba que importa es R1 y hace el camino entero: inserta una
-- notificación de verdad y comprueba que quedó encolada UNA petición a
-- `send-push`, con su cabecera y con el cuerpo que esa función espera. Se
-- ejecuta dentro de begin/rollback, así que `pg_net` nunca llega a
-- mandarla: su worker sólo ve filas confirmadas.
--
--   Lo que ya no se puede
--   C1. No queda ningún disparador colgando de `supabase_functions`: el
--       Database Webhook se fue.
--   C2. EL CATÁLOGO YA NO TIENE EL TOKEN. Ningún `tgargs` de ninguna tabla
--       contiene un `Bearer` ni un JWT. Es el punto entero de la migración.
--   C3. El secreto vive en Vault, y ni `anon` ni `authenticated` tienen
--       siquiera USAGE sobre el esquema `vault`.
--   C4. La función no la ejecutan anon, PUBLIC ni `authenticated`.
--   C5. EL TOKEN GUARDADO NO ES LA LLAVE MAESTRA. Su claim `role` es
--       `anon`, no `service_role`. Importa porque el token sigue pasando
--       por `net.http_request_queue`, que PUBLIC puede leer y no se puede
--       revocar: si alguien vuelve a poner ahí la service key, lo que se
--       filtraría sería la base entera. Esta prueba lo dice.
--
--   Lo que sigue igual
--   R1. Insertar una notificación encola exactamente una petición a
--       `send-push`, con `Authorization` y con `type`/`table`/`record`.
--   R2. SIN EL SECRETO, EL INSERT NO SE ROMPE. Es el modo de fallo que
--       importa: un push que falla no puede impedir que la notificación se
--       guarde, porque el usuario perdería también el aviso dentro de la
--       app. Se prueba escondiendo el secreto y volviendo a insertar.
--   R3. El disparador quedó igual que el webhook: AFTER INSERT, por fila.
--   R4. La función es `security definer`, que es lo que le permite leer
--       Vault aunque quien inserte no tenga acceso a `vault`.
--
-- Se ejecuta entero dentro de begin/rollback: no deja nada.
-- =============================================================

begin;
create temp table r117 (caso text, ok boolean, detalle text);

do $$
declare
  v_u uuid := gen_random_uuid();
  v_n int;
  v_id uuid;
  v_cuerpo jsonb;
  v_cabeceras jsonb;
begin
  -- ── C1 ───────────────────────────────────────────────────────
  select count(*) into v_n
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'supabase_functions' and not t.tgisinternal;
  insert into r117 values ('C1 no queda ningun Database Webhook', v_n = 0, v_n || ' disparador(es)');

  -- ── C2: el catálogo, limpio ──────────────────────────────────
  -- Se mira TODO `pg_trigger`, no sólo el de notificaciones: si mañana
  -- alguien vuelve a crear un webhook desde el panel, esto lo caza.
  select count(*) into v_n
    from pg_trigger t
   where not t.tgisinternal and t.tgargs is not null
     and (encode(t.tgargs,'escape') ilike '%bearer%' or encode(t.tgargs,'escape') like '%eyJ%');
  insert into r117 values ('C2 ningun disparador guarda un token en el catalogo',
    v_n = 0, v_n || ' disparador(es) con token');

  -- ── C3: el secreto, donde debe ───────────────────────────────
  select count(*) into v_n from vault.secrets where name = 'send_push_authorization';
  insert into r117 values ('C3 el secreto esta en Vault y vault esta cerrado a anon',
    v_n = 1
      and not has_schema_privilege('anon','vault','USAGE')
      and not has_schema_privilege('authenticated','vault','USAGE'),
    v_n || ' secreto(s); anon usage=' || has_schema_privilege('anon','vault','USAGE')::text);

  -- ── C5: el token guardado no es la llave maestra ─────────────
  -- Se decodifica SÓLO el claim `role` del JWT; el valor no se imprime ni
  -- se compara contra nada escrito acá.
  insert into r117 values ('C5 el token de Vault es la clave publicable, NO la service key',
    (select (convert_from(decode(rpad(translate(split_part(s.decrypted_secret,'.',2),'-_','+/'),
        (length(split_part(s.decrypted_secret,'.',2))+3)/4*4,'='),'base64'),'UTF8')::jsonb) ->> 'role'
       from vault.decrypted_secrets s where s.name = 'send_push_authorization') = 'anon',
    'rol=' || coalesce((select (convert_from(decode(rpad(translate(split_part(s.decrypted_secret,'.',2),'-_','+/'),
        (length(split_part(s.decrypted_secret,'.',2))+3)/4*4,'='),'base64'),'UTF8')::jsonb) ->> 'role'
       from vault.decrypted_secrets s where s.name = 'send_push_authorization'), '(sin secreto)'));

  -- ── C4 ───────────────────────────────────────────────────────
  insert into r117 values ('C4 la funcion solo la dispara el disparador',
    not has_function_privilege('anon','public.notificar_push()','EXECUTE')
      and not has_function_privilege('authenticated','public.notificar_push()','EXECUTE'),
    'anon=' || has_function_privilege('anon','public.notificar_push()','EXECUTE')::text ||
    ' authenticated=' || has_function_privilege('authenticated','public.notificar_push()','EXECUTE')::text);

  -- ── R3 y R4 ──────────────────────────────────────────────────
  select count(*) into v_n
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
   where t.tgname = 'notifications_send_push'
     and t.tgrelid = 'public.notifications'::regclass
     and t.tgenabled <> 'D'
     and (t.tgtype::int & 1) = 1      -- por fila
     and (t.tgtype::int & 2) = 0      -- after, no before
     and (t.tgtype::int & 4) = 4      -- en insert
     and n.nspname = 'public' and p.proname = 'notificar_push';
  insert into r117 values ('R3 el disparador quedo igual: AFTER INSERT, por fila', v_n = 1, v_n || ' coincidencia(s)');

  insert into r117 values ('R4 la funcion es security definer (por eso puede leer Vault)',
    (select p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='notificar_push'), 'necesario para leer vault');

  -- ── R1: el camino entero ─────────────────────────────────────
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', v_u, 'authenticated', 'authenticated',
          'r117-' || v_u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '');

  insert into public.notifications (user_id, type, title, body)
  values (v_u, 'friend_request', 'R117', 'prueba del arnes') returning id into v_id;

  -- Se cuenta SÓLO la petición de esta notificación: en producción el cron
  -- puede estar encolando otras al mismo tiempo, y un conteo global haría
  -- que esta prueba fallara de vez en cuando sin motivo.
  select count(*) into v_n from net.http_request_queue q
   where (convert_from(q.body,'UTF8')::jsonb -> 'record' ->> 'id')::uuid = v_id;
  insert into r117 values ('R1a el insert encola exactamente una peticion a send-push',
    v_n = 1, v_n || ' peticion(es)');

  select convert_from(q.body,'UTF8')::jsonb, q.headers into v_cuerpo, v_cabeceras
    from net.http_request_queue q
   where (convert_from(q.body,'UTF8')::jsonb -> 'record' ->> 'id')::uuid = v_id
   limit 1;

  insert into r117 values ('R1b el cuerpo es el que send-push espera',
    v_cuerpo ->> 'type' = 'INSERT' and v_cuerpo ->> 'table' = 'notifications'
      and (v_cuerpo -> 'record' ->> 'id')::uuid = v_id,
    'type=' || coalesce(v_cuerpo ->> 'type','-') || ' table=' || coalesce(v_cuerpo ->> 'table','-'));

  -- Sólo se comprueba que la cabecera existe y tiene forma de Bearer.
  -- El valor no se imprime ni se compara contra nada escrito acá.
  insert into r117 values ('R1c va con Authorization, y es un Bearer',
    (v_cabeceras ->> 'Authorization') like 'Bearer %'
      and length(v_cabeceras ->> 'Authorization') > 100,
    'cabeceras: ' || (select string_agg(k, ', ' order by k) from jsonb_object_keys(v_cabeceras) k));

  -- ── R2: sin secreto, el insert aguanta ───────────────────────
  -- `postgres` no puede escribir `vault.secrets` directamente —comprobado,
  -- da 42501— pero sí ejecutar `vault.update_secret`. Lo deshace el rollback.
  perform vault.update_secret(
    (select id from vault.secrets where name = 'send_push_authorization'),
    null, 'send_push_authorization_escondido', null);
  if exists (select 1 from vault.decrypted_secrets where name = 'send_push_authorization') then
    insert into r117 values ('R2 preparacion: el secreto quedo escondido', false, 'sigue visible, la prueba no vale');
  end if;

  begin
    insert into public.notifications (user_id, type, title, body)
    values (v_u, 'friend_request', 'R117 sin secreto', 'no deberia romper') returning id into v_id;
    insert into r117 values ('R2 sin el secreto la notificacion IGUAL se guarda',
      exists (select 1 from public.notifications where id = v_id), 'el insert no se rompio');
  exception when others then
    insert into r117 values ('R2 sin el secreto la notificacion IGUAL se guarda',
      false, 'el insert reventó: ' || sqlerrm);
  end;

  select count(*) into v_n from net.http_request_queue q
   where (convert_from(q.body,'UTF8')::jsonb -> 'record' ->> 'id')::uuid = v_id;
  insert into r117 values ('R2b y sin secreto no encola nada', v_n = 0, v_n || ' peticion(es) para esa notificacion');
end $$;

select caso, case when ok then 'OK' else 'FALLA' end as res, detalle from r117 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r117;

rollback;
