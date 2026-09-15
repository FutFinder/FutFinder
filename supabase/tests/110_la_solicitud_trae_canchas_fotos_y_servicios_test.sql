-- =============================================================
-- FutFinder — pruebas de la migración 110.
--
-- QUÉ SE PRUEBA:
--   Lo que se guarda
--   1.  Canchas, fotos y servicios llegan a la fila.
--   2.  Una solicitud SIN los campos nuevos se sigue guardando —una app
--       vieja no puede quedarse sin poder escribirnos.
--   3.  Los siete argumentos de siempre siguen llamando a esta función.
--
--   Lo que se rechaza
--   4.  Cero canchas y 61 canchas.
--   5.  Una ruta de foto que NO es de quien manda: la solicitud entera se
--       rechaza, no se guarda «el resto».
--   6.  Siete fotos.
--   7.  Un servicio fuera del catálogo de la 75.
--
--   El bucket
--   8.  Existe, es PRIVADO y solo acepta imágenes.
--   9.  Tiene las tres políticas por carpeta propia.
--
-- Requiere las migraciones 80 y 110 aplicadas.
-- Cómo correr: pégalo en Supabase → SQL Editor → Run. Termina en ROLLBACK.
-- =============================================================

begin;
create temp table r110 (caso text, ok boolean, detalle text);
grant all on r110 to authenticated;

do $$
declare
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_jb jsonb; v_id uuid;
  v_row public.solicitudes_recinto%rowtype;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r110-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_a, v_b]) as u;

  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_a, 'role','authenticated')::text);

  -- 1. Todo junto.
  v_jb := public.crear_solicitud_recinto(
    'FutCenter Maipú', 'Av. El Rosal 6281', 'Maipú', 'Vicente Bastías',
    '987654321', 'contacto@futcenter.cl', 'Seis canchas de fútbol 7',
    6,
    array[v_a::text || '/1758000000-ab12cd.jpg', v_a::text || '/1758000001-ef34gh.jpg'],
    array['estacionamiento', 'camarines', 'quincho']);
  v_id := (v_jb->>'id')::uuid;
  select * into v_row from public.solicitudes_recinto where id = v_id;
  insert into r110 values ('1 canchas, fotos y servicios quedan guardados',
    (v_jb->>'ok')::boolean
      and v_row.n_canchas = 6
      and array_length(v_row.fotos, 1) = 2
      and v_row.servicios @> array['estacionamiento','camarines','quincho'],
    coalesce(v_row.n_canchas::text, '(null)') || ' canchas, '
      || coalesce(array_length(v_row.fotos, 1), 0)::text || ' fotos, '
      || array_to_string(v_row.servicios, '+'));

  -- 2. Sin los campos nuevos: se guarda igual, vacía pero completa.
  v_jb := public.crear_solicitud_recinto(
    'Cancha Los Aromos', 'Los Aromos 100', 'Maipú', 'Vicente Bastías',
    '987654321', 'contacto@aromos.cl', null, null, null, null);
  select * into v_row from public.solicitudes_recinto where id = (v_jb->>'id')::uuid;
  insert into r110 values ('2 una solicitud sin los campos nuevos se guarda igual',
    (v_jb->>'ok')::boolean and v_row.n_canchas is null
      and v_row.fotos = '{}'::text[] and v_row.servicios = '{}'::text[],
    coalesce(v_row.n_canchas::text, '(null)'));

  -- 3. Los siete argumentos de siempre: la firma vieja ya no existe, así
  --    que esta llamada solo puede estar cayendo en la nueva.
  v_jb := public.crear_solicitud_recinto(
    'Estadio Norte', 'Norte 200', 'Renca', 'Vicente Bastías',
    '987654321', 'contacto@norte.cl', 'Hola');
  insert into r110 values ('3 los siete argumentos de siempre siguen sirviendo',
    (v_jb->>'ok')::boolean, v_jb::text);

  -- 4. Canchas absurdas.
  v_jb := public.crear_solicitud_recinto('Recinto A', 'Calle 1', 'Maipú', 'Vicente',
    '987654321', 'a@b.cl', null, 0, null, null);
  insert into r110 values ('4a cero canchas se rechaza', (v_jb->>'ok')::boolean is false, v_jb->>'reason');
  v_jb := public.crear_solicitud_recinto('Recinto B', 'Calle 1', 'Maipú', 'Vicente',
    '987654321', 'a@b.cl', null, 61, null, null);
  insert into r110 values ('4b sesenta y una canchas se rechaza', (v_jb->>'ok')::boolean is false, v_jb->>'reason');

  -- 5. La foto de otro. Lo que se comprueba es que NO quedó nada guardado:
  --    si se hubiera guardado «el resto», la fila existiría igual.
  v_jb := public.crear_solicitud_recinto('Recinto C', 'Calle 1', 'Maipú', 'Vicente',
    '987654321', 'a@b.cl', null, 2,
    array[v_a::text || '/mia.jpg', v_b::text || '/ajena.jpg'], null);
  insert into r110 values ('5 una ruta de foto ajena rechaza la solicitud entera',
    (v_jb->>'ok')::boolean is false
      and not exists (select 1 from public.solicitudes_recinto where nombre_recinto = 'Recinto C'),
    v_jb->>'reason');

  -- 6. Siete fotos.
  v_jb := public.crear_solicitud_recinto('Recinto D', 'Calle 1', 'Maipú', 'Vicente',
    '987654321', 'a@b.cl', null, 2,
    array(select v_a::text || '/f' || g || '.jpg' from generate_series(1, 7) g), null);
  insert into r110 values ('6 siete fotos se rechazan', (v_jb->>'ok')::boolean is false, v_jb->>'reason');

  -- 7. Un servicio inventado. El catálogo es el mismo de la 75 justamente
  --    para que lo que se marca acá se copie sin traducir allá.
  v_jb := public.crear_solicitud_recinto('Recinto E', 'Calle 1', 'Maipú', 'Vicente',
    '987654321', 'a@b.cl', null, 2, null, array['estacionamiento', 'helipuerto']);
  insert into r110 values ('7 un servicio fuera del catálogo se rechaza',
    (v_jb->>'ok')::boolean is false, v_jb->>'reason');
end $$;

reset role;
set local request.jwt.claims to '{}';

-- 8. El bucket: privado y solo imágenes.
insert into r110
select '8 el bucket existe, es privado y solo acepta imágenes',
       b.public is false
         and b.file_size_limit = 5242880
         and b.allowed_mime_types @> array['image/jpeg','image/png','image/webp'],
       'public=' || b.public::text || ' límite=' || coalesce(b.file_size_limit::text, '(sin)')
  from storage.buckets b where b.id = 'solicitud-fotos';

-- 9. Las tres políticas por carpeta propia.
insert into r110
select '9 el bucket tiene lectura, subida y borrado solo de lo propio',
       count(*) = 3, string_agg(policyname, ', ' order by policyname)
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and policyname in ('solicitud_fotos_propias_read',
                      'solicitud_fotos_propias_upload',
                      'solicitud_fotos_propias_delete');

select caso, case when ok then 'OK' else 'FALLA' end as res, detalle from r110 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r110;

rollback;
