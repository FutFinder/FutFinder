-- =============================================================
-- FutFinder — pruebas de la migración 174.
--
-- Cada caso mira `storage.objects` COMO el rol que importa (`anon`, o
-- `authenticated` con el `sub` de una persona concreta), nunca como
-- `postgres`: como `postgres` todo se ve.
--
-- Dos personas: u1 subió una captura; u2 no tiene nada que ver.
--
--   A1  El bucket ya no es público, y conserva su tope y sus tipos.
--   A2  Sobre ese bucket queda UNA política de lectura, sólo para
--       `authenticated` y atada a quien llama.
--   B1  Sin cuenta no se ve ninguna captura…
--   B2  …otra persona con cuenta tampoco ve la ajena (ni listando)…
--   B3  …y quien la subió sí ve la suya.
--   C1  Cada uno sigue subiendo a su carpeta…
--   C2  …no a la de otra persona (42501)…
--   C3  …y sin cuenta no se sube (42501).
--   C4  La política de borrado sigue siendo la de la carpeta propia.
--   D1  Un ticket con la RUTA en `screenshot_url` se guarda y su dueño lo
--       vuelve a leer…
--   D2  …uno viejo, con la URL pública completa, también…
--   D3  …y otra persona no lee ninguno de los dos.
--   E1  Los demás buckets no se tocaron.
--
-- LO QUE ESTE ARNÉS NO PUEDE VER: lo que contesta Storage por HTTP (la URL
-- pública, el enlace firmado, el borrado, que Storage no deja hacer por
-- SQL). Eso se probó contra el Storage local con dos cuentas; el resultado
-- está en el commit de la 174.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r174 (caso text, ok boolean, detalle text);
grant all on r174 to authenticated, anon;

-- Ejecuta una consulta que devuelve UN entero, como ese rol. `p_uid` nulo
-- con rol `anon` es «sin cuenta». Devuelve el número, o -1 con el sqlstate
-- en `err` si la consulta revienta. El rol se repone siempre.
create or replace function pg_temp.cuenta_como(p_rol text, p_uid uuid, p_sql text, out n int, out err text)
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null
         then json_build_object('role', p_rol)::text
         else json_build_object('sub', p_uid, 'role', p_rol)::text end, true);
  execute format('set local role %I', p_rol);
  begin
    execute p_sql into n;
    execute 'reset role';
  exception when others then
    execute 'reset role';
    n := -1; err := sqlstate;
  end;
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Intenta una sentencia COMO ese rol: 'ok:<filas>' o 'err:<sqlstate>'.
create or replace function pg_temp.intenta(p_rol text, p_uid uuid, p_sql text)
returns text language plpgsql as $$
declare v_n int; v_r text;
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null
         then json_build_object('role', p_rol)::text
         else json_build_object('sub', p_uid, 'role', p_rol)::text end, true);
  execute format('set local role %I', p_rol);
  begin
    execute p_sql;
    get diagnostics v_n = row_count;
    execute 'reset role';
    v_r := 'ok:' || v_n;
  exception when others then
    execute 'reset role';
    v_r := 'err:' || sqlstate;
  end;
  perform set_config('request.jwt.claims', '', true);
  return v_r;
end $$;

do $$
declare
  u1 uuid := gen_random_uuid();   -- subió la captura
  u2 uuid := gen_random_uuid();   -- otra persona
  v_ruta text; v_url text;
  c record; r text;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r174-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[u1, u2]) u;
  insert into public.profiles (id, username)
  select u, 'r174' || substr(replace(u::text, '-', ''), 1, 10) from unnest(array[u1, u2]) u
  on conflict (id) do nothing;

  v_ruta := u1::text || '/1700000000000.jpg';
  v_url  := 'https://ejemplo.supabase.co/storage/v1/object/public/support-screenshots/' || v_ruta || '?t=1700000000001';

  -- La captura de u1, puesta como dueño de la transacción: acá se prueba
  -- quién la LEE.
  insert into storage.objects (bucket_id, name, owner, owner_id)
  values ('support-screenshots', v_ruta, u1, u1::text);

  -- ── A. La forma del bucket y de sus políticas ─────────────────
  insert into r174
  select 'A1 el bucket no es publico y conserva tope y tipos',
         not b.public and b.file_size_limit = 8388608
           and b.allowed_mime_types @> array['image/jpeg']
           and not b.allowed_mime_types && array['text/html', 'image/svg+xml'],
         'public=' || b.public || ' limite=' || coalesce(b.file_size_limit::text, 'sin limite')
           || ' tipos=' || coalesce(array_to_string(b.allowed_mime_types, '|'), 'cualquiera')
    from storage.buckets b where b.id = 'support-screenshots';

  insert into r174
  select 'A2 una sola politica de lectura, de authenticated y atada a quien llama',
         count(*) = 1
           and bool_and(p.roles = '{authenticated}'::name[])
           and bool_and(p.qual like '%auth.uid()%' and p.qual like '%foldername%'),
         coalesce(string_agg(p.policyname || ' ' || p.roles::text, ' · '), 'ninguna')
    from pg_policies p
   where p.schemaname = 'storage' and p.tablename = 'objects' and p.cmd in ('SELECT', 'ALL')
     and coalesce(p.qual, '') like '%support-screenshots%';

  -- ── B. Quién lee ──────────────────────────────────────────────
  c := pg_temp.cuenta_como('anon', null, $q$select count(*) from storage.objects where bucket_id = 'support-screenshots'$q$);
  insert into r174 values ('B1 sin cuenta no se ve ninguna captura', c.n = 0, 'vio=' || c.n || coalesce(' err=' || c.err, ''));

  c := pg_temp.cuenta_como('authenticated', u2, format($q$select count(*) from storage.objects where bucket_id = 'support-screenshots' and name = %L$q$, v_ruta));
  insert into r174 values ('B2 otra persona no ve la captura ajena', c.n = 0, 'vio=' || c.n || coalesce(' err=' || c.err, ''));
  c := pg_temp.cuenta_como('authenticated', u2, format($q$select count(*) from storage.objects where bucket_id = 'support-screenshots' and name like %L$q$, u1::text || '/%'));
  insert into r174 values ('B2 ni listando la carpeta', c.n = 0, 'vio=' || c.n || coalesce(' err=' || c.err, ''));

  c := pg_temp.cuenta_como('authenticated', u1, format($q$select count(*) from storage.objects where bucket_id = 'support-screenshots' and name = %L$q$, v_ruta));
  insert into r174 values ('B3 quien la subio si ve la suya', c.n = 1, 'vio=' || c.n || coalesce(' err=' || c.err, ''));

  -- ── C. Subir y borrar quedan como estaban ─────────────────────
  r := pg_temp.intenta('authenticated', u2, format(
    $q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('support-screenshots', %L, %L, %L)$q$,
    u2::text || '/1700000000002.jpg', u2, u2::text));
  insert into r174 values ('C1 cada uno sube a su carpeta', r = 'ok:1', r);

  r := pg_temp.intenta('authenticated', u2, format(
    $q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('support-screenshots', %L, %L, %L)$q$,
    u1::text || '/intruso.jpg', u2, u2::text));
  insert into r174 values ('C2 no a la carpeta de otra persona (42501)', r = 'err:42501', r);

  r := pg_temp.intenta('anon', null, format(
    $q$insert into storage.objects (bucket_id, name) values ('support-screenshots', %L)$q$,
    u1::text || '/anonimo.jpg'));
  insert into r174 values ('C3 sin cuenta no se sube (42501)', r = 'err:42501', r);

  insert into r174
  select 'C4 la politica de borrado sigue siendo la de la carpeta propia',
         count(*) = 1 and bool_and(p.qual like '%auth.uid()%' and p.qual like '%foldername%'),
         coalesce(string_agg(p.policyname, ' · '), 'ninguna')
    from pg_policies p
   where p.schemaname = 'storage' and p.tablename = 'objects' and p.cmd = 'DELETE'
     and coalesce(p.qual, '') like '%support-screenshots%';

  -- ── D. El ticket: con ruta (app nueva) y con URL (app instalada) ──
  r := pg_temp.intenta('authenticated', u1, format(
    $q$insert into public.support_tickets (user_id, category, title, screenshot_url) values (%L, 'fallo_tecnico', 'r174 con ruta', %L)$q$, u1, v_ruta));
  c := pg_temp.cuenta_como('authenticated', u1, format($q$select count(*) from public.support_tickets where user_id = %L and screenshot_url = %L$q$, u1, v_ruta));
  insert into r174 values ('D1 el ticket con la ruta se guarda y su dueño lo lee', r = 'ok:1' and c.n = 1, r || ' leyo=' || c.n || coalesce(' err=' || c.err, ''));

  r := pg_temp.intenta('authenticated', u1, format(
    $q$insert into public.support_tickets (user_id, category, title, screenshot_url) values (%L, 'fallo_tecnico', 'r174 con url', %L)$q$, u1, v_url));
  c := pg_temp.cuenta_como('authenticated', u1, format($q$select count(*) from public.support_tickets where user_id = %L and screenshot_url = %L$q$, u1, v_url));
  insert into r174 values ('D2 el ticket viejo, con la URL publica, tambien', r = 'ok:1' and c.n = 1, r || ' leyo=' || c.n || coalesce(' err=' || c.err, ''));

  c := pg_temp.cuenta_como('authenticated', u2, format($q$select count(*) from public.support_tickets where user_id = %L$q$, u1));
  insert into r174 values ('D3 otra persona no lee ninguno de los dos', c.n = 0, 'vio=' || c.n || coalesce(' err=' || c.err, ''));

  -- ── E. Lo demás no se tocó ────────────────────────────────────
  insert into r174
  select 'E1 los demas buckets siguen como estaban',
         bool_and(case when b.id = 'solicitud-fotos' then not b.public else b.public end) and count(*) >= 6,
         string_agg(b.id || '=' || case when b.public then 'publico' else 'privado' end, ' · ' order by b.id)
    from storage.buckets b where b.id <> 'support-screenshots';
end $$;

select caso, ok, detalle from r174 order by caso;
do $$
declare v_mal int; v_total int;
begin
  select count(*) filter (where not ok), count(*) into v_mal, v_total from r174;
  if v_total < 14 then
    raise exception 'el arnes de la 174 no llego al final: % casos de 14', v_total;
  end if;
  if v_mal > 0 then
    raise exception '% caso(s) de la 174 fallaron (mira la tabla de arriba)', v_mal;
  end if;
end $$;

rollback;
