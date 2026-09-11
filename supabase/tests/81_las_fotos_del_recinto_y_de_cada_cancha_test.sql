-- =============================================================
-- FutFinder — pruebas de la migración 81 (fotos del recinto y de cada cancha).
--
-- QUÉ SE PRUEBA:
--   1. Se agrega una foto a la galería y queda con orden 0.
--   2. La segunda queda con orden 1: el orden no se repite.
--   3. El tope de ocho lo aplica el SERVIDOR, no la pantalla.
--   4. Y al rechazar la novena no agregó nada.
--   5. Quitar una devuelve la url, para poder borrar también el archivo.
--   6. Quitar la misma dos veces no es un error (el botón se toca dos veces).
--   7. Un ajeno no puede agregar fotos.
--   8. Un ajeno no puede quitar una foto que no es suya.
--   9. La foto de la cancha se guarda.
--  10. Mandar null la QUITA — acá null sí significa borrar, al revés que en
--      `admin_actualizar_complejo`.
--  11. Una cadena de espacios cuenta como vacío, no como foto.
--  12. Un ajeno no puede ponerle foto a una cancha que no administra.
--  13. `admin_canchas_complejo` devuelve la foto en la lista del panel.
--  14. Un recinto SIN publicar: su dueño ve la galería…
--  15. …y `anon` no la ve (ni revienta con «permission denied for function»,
--      que es el bug que la 76 tuvo que arreglar dos veces).
--
-- OJO: usa un complejo real porque necesita un admin de verdad.
-- Corre entero dentro de la transacción y termina en ROLLBACK.
--
-- Requiere las migraciones 54 a 81 aplicadas.
-- Cómo correr: pégalo en Supabase → SQL Editor → Run. Termina en ROLLBACK.
-- =============================================================

begin;

create temp table r80 (caso text, ok boolean, detalle text);
grant all on r80 to authenticated, anon;

do $$
declare
  v_dueno uuid;
  v_cpl   uuid;
  v_cancha uuid;
  v_ajeno uuid := gen_random_uuid();
  v_res json;
  v_id uuid;
  v_n integer;
  v_txt text;
  v_rechazado boolean;
  v_publicado boolean;
begin
  select a.complejo_id, a.user_id into v_cpl, v_dueno
    from public.complejo_admins a where a.rol = 'dueño' limit 1;
  if v_cpl is null then
    raise exception 'La prueba necesita al menos un complejo con dueño cargado';
  end if;

  select k.id into v_cancha from public.canchas_reservables k
   where k.complejo_id = v_cpl limit 1;
  if v_cancha is null then
    raise exception 'La prueba necesita al menos una cancha en ese complejo';
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', v_ajeno, 'authenticated', 'authenticated',
         'r80-' || v_ajeno || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '';

  -- Se parte de una galería vacía para que los órdenes sean predecibles.
  delete from public.complejo_fotos where complejo_id = v_cpl;

  set local role authenticated;
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_dueno, 'role', 'authenticated')::text);

  -- ── Galería ──────────────────────────────────────────────────
  v_res := public.admin_agregar_foto_complejo(v_cpl, 'https://x/1.jpg');
  insert into r80 values ('1',
    (v_res->>'ok')::boolean and (v_res->>'orden')::int = 0, v_res::text);

  v_res := public.admin_agregar_foto_complejo(v_cpl, 'https://x/2.jpg');
  insert into r80 values ('2', (v_res->>'orden')::int = 1, v_res::text);

  -- Hasta ocho.
  for v_n in 3..8 loop
    perform public.admin_agregar_foto_complejo(v_cpl, 'https://x/' || v_n || '.jpg');
  end loop;

  v_res := public.admin_agregar_foto_complejo(v_cpl, 'https://x/9.jpg');
  insert into r80 values ('3', not (v_res->>'ok')::boolean, v_res->>'reason');

  select count(*) into v_n from public.complejo_fotos where complejo_id = v_cpl;
  insert into r80 values ('4', v_n = 8, v_n || ' fotos');

  select id into v_id from public.complejo_fotos
   where complejo_id = v_cpl and orden = 0;
  v_res := public.admin_quitar_foto_galeria(v_id);
  insert into r80 values ('5',
    (v_res->>'ok')::boolean and v_res->>'url' = 'https://x/1.jpg', v_res::text);

  v_res := public.admin_quitar_foto_galeria(v_id);
  insert into r80 values ('6',
    (v_res->>'ok')::boolean and (v_res->>'ya_estaba')::boolean, v_res::text);

  -- ── La cancha ────────────────────────────────────────────────
  perform public.admin_actualizar_foto_cancha(v_cancha, 'https://x/cancha.jpg');
  select foto_url into v_txt from public.canchas_reservables where id = v_cancha;
  insert into r80 values ('9', v_txt = 'https://x/cancha.jpg', coalesce(v_txt, 'null'));

  perform public.admin_actualizar_foto_cancha(v_cancha, null);
  select foto_url into v_txt from public.canchas_reservables where id = v_cancha;
  insert into r80 values ('10', v_txt is null, coalesce(v_txt, 'null'));

  perform public.admin_actualizar_foto_cancha(v_cancha, '   ');
  select foto_url into v_txt from public.canchas_reservables where id = v_cancha;
  insert into r80 values ('11', v_txt is null, coalesce(v_txt, 'null'));

  perform public.admin_actualizar_foto_cancha(v_cancha, 'https://x/cancha.jpg');
  select c.foto_url into v_txt
    from public.admin_canchas_complejo(v_cpl) c where c.id = v_cancha;
  insert into r80 values ('13', v_txt = 'https://x/cancha.jpg', coalesce(v_txt, 'null'));

  -- ── Un recinto sin publicar: su dueño igual ve la galería ────
  select publicado into v_publicado from public.complejos where id = v_cpl;
  update public.complejos set publicado = false where id = v_cpl;
  select count(*) into v_n from public.complejo_fotos where complejo_id = v_cpl;
  insert into r80 values ('14', v_n = 7, v_n || ' fotos visibles para el dueño');

  -- El id se toma AHORA, siendo el dueño. Pedido después, con el ajeno, la
  -- RLS devuelve null y el caso 8 pasaría por la puerta equivocada: la
  -- función diría «no existe» en vez de «no es tuya», y la prueba estaría
  -- comprobando otra cosa.
  select id into v_id from public.complejo_fotos where complejo_id = v_cpl limit 1;

  -- ── Y el ajeno no puede nada ─────────────────────────────────
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);

  begin
    perform public.admin_agregar_foto_complejo(v_cpl, 'https://x/intruso.jpg');
    v_rechazado := false;
  exception when others then v_rechazado := true; end;
  insert into r80 values ('7', v_rechazado, 'agregar siendo ajeno');

  begin
    perform public.admin_quitar_foto_galeria(v_id);
    v_rechazado := false;
  exception when others then v_rechazado := true; end;
  insert into r80 values ('8', v_rechazado, 'quitar siendo ajeno');

  begin
    perform public.admin_actualizar_foto_cancha(v_cancha, 'https://x/intruso.jpg');
    v_rechazado := false;
  exception when others then v_rechazado := true; end;
  insert into r80 values ('12', v_rechazado, 'foto de cancha siendo ajeno');

  -- ── Sin sesión: ni una foto, y sin reventar ──────────────────
  -- El recinto sigue despublicado. Lo que se comprueba no es solo que
  -- devuelva cero: es que la consulta NO falle, que es lo que pasaba
  -- cuando la rama de admin iba en un `or` con la pública.
  set local role anon;
  execute format('set local request.jwt.claims to %L', json_build_object('role', 'anon')::text);
  begin
    select count(*) into v_n from public.complejo_fotos where complejo_id = v_cpl;
    insert into r80 values ('15', v_n = 0, v_n || ' fotos para anon');
  exception when others then
    insert into r80 values ('15', false, 'REVENTÓ: ' || sqlerrm);
  end;
  -- `v_publicado` no se restaura a mano: el ROLLBACK del final deshace
  -- todo, incluido el despublicado de los casos 14 y 15.
  perform v_publicado;
end $$;

reset role;

select caso, case when ok then 'PASA' else 'FALLA' end as resultado, detalle
  from r80 order by caso::int;

do $$
declare v_malos integer; v_f record;
begin
  for v_f in select * from r80 order by caso::int loop
    if v_f.ok then raise notice 'OK (caso %): %', v_f.caso, v_f.detalle;
    else raise warning 'FALLÓ (caso %): %', v_f.caso, v_f.detalle; end if;
  end loop;
  select count(*) into v_malos from r80 where not ok;
  if v_malos > 0 then raise exception '% caso(s) de la migración 81 fallaron', v_malos; end if;
  raise notice '=== TODOS LOS CASOS DE LA MIGRACIÓN 81 PASARON ===';
end $$;

rollback;
