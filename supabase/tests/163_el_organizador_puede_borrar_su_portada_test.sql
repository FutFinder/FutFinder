-- =============================================================
-- FutFinder — pruebas de la migración 163.
--
-- QUÉ SE PRUEBA:
--   C1. La política existe, y `match-covers` queda con sus cuatro puertas
--       —leer, subir, reemplazar y borrar— como todos los demás buckets.
--   C2. El organizador borra la portada de SU partido.
--   C3. Un ajeno no borra la portada de un partido que no organiza.
--   C4. Y el ajeno tampoco se lleva por delante otros buckets: una foto
--       de `avatars` que no es suya sigue ahí.
--   C5. CONTROL: sin la política, ni el organizador puede — que es
--       exactamente lo que pasaba en producción antes de esta migración.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r163 (caso text, ok boolean, detalle text);
grant all on r163 to authenticated;

do $$
declare
  v_org   uuid := gen_random_uuid();
  v_ajeno uuid := gen_random_uuid();
  v_match uuid;
  v_n int;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r163-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_org, v_ajeno]) u;

  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles)
  values (v_org, 'r163 con portada', 'Santiago', 'Cancha', -33.45, -70.66,
      now() + interval '2 days', 10, 10)
  returning id into v_match;

  -- ── C1: la política está ───────────────────────────────────────
  select count(*) into v_n from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'storage' and c.relname = 'objects'
     and p.polname = 'match_covers_organizer_delete';
  insert into r163 values ('C1 la política existe', v_n = 1, v_n::text);

  -- Y las CUATRO puertas del bucket, no «28 políticas en total»: contar el
  -- total ata el arnés a que nadie agregue un bucket más. Lo que importa
  -- es que `match-covers` deje de ser el único asimétrico.
  select count(distinct p.polcmd) into v_n from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'storage' and c.relname = 'objects'
     and p.polname like 'match\_covers\_%'
     and p.polcmd in ('r','a','w','d');
  insert into r163 values ('C1 y el bucket tiene sus cuatro puertas', v_n = 4, v_n::text);

  -- LA PUERTA DEL STORAGE, la misma que abre su API. `storage.objects`
  -- trae un disparador —`storage.protect_delete`— que rechaza cualquier
  -- borrado directo por SQL «use la Storage API», salvo que esté puesto
  -- `storage.allow_delete_query`. Eso es justamente lo que pone la API
  -- antes de borrar, así que ponerlo acá es ponerse en el lugar de la API;
  -- lo que decide después quién puede y quién no sigue siendo la RLS, que
  -- es lo que este arnés mide. Sin esto, los cuatro casos de borrado
  -- morirían todos igual y no probarían nada.
  set local storage.allow_delete_query = 'true';

  -- Las dos portadas y un avatar ajeno. Se insertan como el rol del editor
  -- a propósito: lo que se prueba es el BORRADO, no la subida.
  insert into storage.objects (bucket_id, name, owner)
  values ('match-covers', v_match::text || '/cover.png', v_org);
  insert into storage.objects (bucket_id, name, owner)
  values ('avatars', v_org::text || '/avatar.png', v_org);

  -- ── C2: el organizador borra la suya ───────────────────────────
  set local role authenticated;
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_org, 'role', 'authenticated')::text);
  delete from storage.objects
   where bucket_id = 'match-covers' and name = v_match::text || '/cover.png';
  get diagnostics v_n = row_count;
  execute 'reset role';
  insert into r163 values ('C2 el organizador borra su portada', v_n = 1, v_n::text);

  -- ── C3: el ajeno no ────────────────────────────────────────────
  insert into storage.objects (bucket_id, name, owner)
  values ('match-covers', v_match::text || '/cover.png', v_org);

  set local role authenticated;
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);
  delete from storage.objects
   where bucket_id = 'match-covers' and name = v_match::text || '/cover.png';
  get diagnostics v_n = row_count;
  insert into r163 values ('C3 un ajeno no borra la portada de otro', v_n = 0, v_n::text);

  -- ── C4: ni se lleva nada de otro bucket ────────────────────────
  delete from storage.objects
   where bucket_id = 'avatars' and name = v_org::text || '/avatar.png';
  get diagnostics v_n = row_count;
  execute 'reset role';
  insert into r163 values ('C4 ni el avatar ajeno', v_n = 0, v_n::text);

  select count(*) into v_n from storage.objects
   where bucket_id = 'avatars' and name = v_org::text || '/avatar.png';
  insert into r163 values ('C4 y el avatar sigue ahí', v_n = 1, v_n::text);

  -- ── C5: el control ─────────────────────────────────────────────
  -- Sin la política, ni el organizador puede. Es lo que producción hacía
  -- antes de la 163; se quita acá dentro y la transacción lo revierte.
  drop policy "match_covers_organizer_delete" on storage.objects;

  set local role authenticated;
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_org, 'role', 'authenticated')::text);
  delete from storage.objects
   where bucket_id = 'match-covers' and name = v_match::text || '/cover.png';
  get diagnostics v_n = row_count;
  execute 'reset role';
  insert into r163 values ('C5 CONTROL: sin la política ni el organizador podía', v_n = 0, v_n::text);
end $$;

reset role;

select caso, case when ok then 'PASA' else 'FALLA' end as resultado, detalle
  from r163 order by caso;

do $$
declare v_malos integer; v_f record;
begin
  for v_f in select * from r163 where not ok order by caso loop
    raise warning 'FALLÓ (%): %', v_f.caso, v_f.detalle;
  end loop;
  select count(*) into v_malos from r163 where not ok;
  if v_malos > 0 then raise exception '% caso(s) de la migración 163 fallaron', v_malos; end if;
  raise notice '=== TODOS LOS CASOS DE LA MIGRACIÓN 163 PASARON ===';
end $$;

rollback;
