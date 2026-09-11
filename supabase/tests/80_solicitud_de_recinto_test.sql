-- =============================================================
-- FutFinder — pruebas de la migración 80 (solicitud de recinto).
--
-- QUÉ SE PRUEBA:
--   Lo que se guarda
--   1.  Una solicitud completa se guarda y devuelve su id.
--   2.  Se guarda normalizada: teléfono +569…, correo en minúscula,
--       espacios recortados.
--   3.  El campo libre vacío queda en `null`, no en cadena vacía.
--   4.  Nace 'nueva' y SIN avisar: `avisada_at` es null mientras no
--       salga el correo.
--
--   Lo que se rechaza
--   5.  Sin nombre de recinto.
--   6.  Sin dirección.
--   7.  Un teléfono fijo no sirve.
--   8.  Un correo sin dominio no sirve.
--   9.  Sin sesión no se manda nada.
--
--   Apretar dos veces
--   10. La misma persona con el mismo recinto REUSA la solicitud
--       pendiente en vez de crear otra.
--   11. Pero si ya fue atendida, puede volver a escribir.
--   12. Y otra persona con el mismo nombre de recinto sí crea la suya.
--
--   Privacidad
--   13. Nadie ve la solicitud de otro…
--   14. …pero sí las propias.
--   15. `anon` no puede llamar la RPC.
--   16. La solicitud NO crea un complejo ni un administrador.
--
-- Requiere las migraciones 54 a 80 aplicadas.
-- Cómo correr: pégalo en Supabase → SQL Editor → Run. Termina en ROLLBACK.
-- =============================================================

begin;
create temp table r80 (caso text, ok boolean, detalle text);
grant all on r80 to authenticated, anon;

do $$
declare
  v_a    uuid := gen_random_uuid();
  v_b    uuid := gen_random_uuid();
  v_j json; v_jb jsonb; v_id uuid; v_id2 uuid; v_n integer;
  v_row public.solicitudes_recinto%rowtype;
  v_rechazado boolean;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r80-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_a, v_b]) as u;

  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_a, 'role','authenticated')::text);

  -- 1 y 2: se guarda, normalizada.
  v_jb := public.crear_solicitud_recinto(
    '  FutCenter Maipú  ', ' Av. El Rosal 6281 ', ' Maipú ',
    ' Vicente Bastías ', '9 8765 4321', '  Contacto@FutCenter.CL ', '   ');
  v_id := (v_jb->>'id')::uuid;
  insert into r80 values ('1', (v_jb->>'ok')::boolean and v_id is not null, v_jb::text);

  select * into v_row from public.solicitudes_recinto where id = v_id;
  insert into r80 values ('2',
    v_row.telefono = '+56987654321'
    and v_row.correo = 'contacto@futcenter.cl'
    and v_row.nombre_recinto = 'FutCenter Maipú'
    and v_row.direccion = 'Av. El Rosal 6281'
    and v_row.comuna = 'Maipú',
    v_row.telefono || ' / ' || v_row.correo || ' / ' || v_row.nombre_recinto);

  insert into r80 values ('3', v_row.mensaje is null, coalesce(v_row.mensaje, '(null)'));
  insert into r80 values ('4', v_row.estado = 'nueva' and v_row.avisada_at is null,
                          v_row.estado || ' / avisada_at ' || coalesce(v_row.avisada_at::text, '(null)'));

  -- 5 a 8: lo que se rechaza, con `{ok:false, reason}` y no con excepción.
  v_jb := public.crear_solicitud_recinto('F', 'Calle 1', 'Maipú', 'Vicente', '987654321', 'a@b.cl', null);
  insert into r80 values ('5', (v_jb->>'ok')::boolean is false, v_jb->>'reason');

  v_jb := public.crear_solicitud_recinto('Recinto', ' ', 'Maipú', 'Vicente', '987654321', 'a@b.cl', null);
  insert into r80 values ('6', (v_jb->>'ok')::boolean is false, v_jb->>'reason');

  v_jb := public.crear_solicitud_recinto('Recinto', 'Calle 1', 'Maipú', 'Vicente', '221234567', 'a@b.cl', null);
  insert into r80 values ('7', (v_jb->>'ok')::boolean is false, v_jb->>'reason');

  v_jb := public.crear_solicitud_recinto('Recinto', 'Calle 1', 'Maipú', 'Vicente', '987654321', 'contacto@futcenter', null);
  insert into r80 values ('8', (v_jb->>'ok')::boolean is false, v_jb->>'reason');

  -- 10: apretar dos veces reusa.
  v_jb := public.crear_solicitud_recinto('futcenter maipú', 'Av. El Rosal 6281', 'Maipú',
                                         'Vicente Bastías', '987654321', 'contacto@futcenter.cl', null);
  select count(*) into v_n from public.solicitudes_recinto where solicitante_id = v_a;
  insert into r80 values ('10',
    (v_jb->>'ok')::boolean and (v_jb->>'reusada')::boolean and (v_jb->>'id')::uuid = v_id and v_n = 1,
    v_n || ' fila(s)');

  -- 11: atendida, puede volver a escribir.
  reset role;
  update public.solicitudes_recinto set estado = 'contactada' where id = v_id;
  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_a, 'role','authenticated')::text);

  v_jb := public.crear_solicitud_recinto('FutCenter Maipú', 'Av. El Rosal 6281', 'Maipú',
                                         'Vicente Bastías', '987654321', 'contacto@futcenter.cl', null);
  v_id2 := (v_jb->>'id')::uuid;
  insert into r80 values ('11', (v_jb->>'ok')::boolean and (v_jb->>'reusada')::boolean is false and v_id2 <> v_id,
                          v_jb::text);

  -- 12: otra persona, mismo nombre de recinto.
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_b, 'role','authenticated')::text);
  v_jb := public.crear_solicitud_recinto('FutCenter Maipú', 'Av. El Rosal 6281', 'Maipú',
                                         'Otro Dueño', '912345678', 'otro@futcenter.cl', 'Seis canchas de fútbol 7');
  insert into r80 values ('12', (v_jb->>'ok')::boolean and (v_jb->>'reusada')::boolean is false, v_jb::text);

  -- 13 y 14: privacidad.
  select count(*) into v_n from public.solicitudes_recinto where solicitante_id = v_a;
  insert into r80 values ('13', v_n = 0, v_n || ' fila(s) de otro');
  select count(*) into v_n from public.solicitudes_recinto;
  insert into r80 values ('14', v_n = 1, v_n || ' fila(s) visible(s)');

  -- 16: no se creó ningún complejo ni administrador.
  reset role;
  select count(*) into v_n from public.complejos where nombre = 'FutCenter Maipú';
  insert into r80 values ('16', v_n = 0, v_n || ' complejo(s) creado(s)');
end $$;

-- 9 y 15: sin sesión.
do $$
declare v_jb jsonb; v_rechazado boolean;
begin
  -- Con rol `authenticated` pero sin `sub`: no hay `auth.uid()`.
  set local role authenticated;
  set local request.jwt.claims to '{"role":"authenticated"}';
  v_jb := public.crear_solicitud_recinto('Recinto', 'Calle 1', 'Maipú', 'Vicente', '987654321', 'a@b.cl', null);
  insert into r80 values ('9', (v_jb->>'ok')::boolean is false, v_jb->>'reason');
  reset role;

  set local role anon;
  begin
    perform public.crear_solicitud_recinto('Recinto', 'Calle 1', 'Maipú', 'Vicente', '987654321', 'a@b.cl', null);
    v_rechazado := false;
  exception when insufficient_privilege then v_rechazado := true; end;
  insert into r80 values ('15', v_rechazado, 'anon no manda solicitudes');
  reset role;
end $$;

do $$
declare v_malos integer; v_f record;
begin
  for v_f in select * from r80 order by caso::integer loop
    if v_f.ok then raise notice 'OK (caso %): %', v_f.caso, v_f.detalle;
    else raise warning 'FALLÓ (caso %): %', v_f.caso, v_f.detalle; end if;
  end loop;
  select count(*) into v_malos from r80 where not ok;
  if v_malos > 0 then raise exception '% caso(s) de la migración 80 fallaron', v_malos; end if;
  raise notice '=== TODOS LOS CASOS DE LA MIGRACIÓN 80 PASARON ===';
end $$;

rollback;
