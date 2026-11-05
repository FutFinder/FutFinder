-- =============================================================
-- FutFinder — pruebas de la migración 167 (verificación en dos pasos del
-- personal).
--
-- «aal1» y «aal2» son lo que trae el JWT (`aal`): aal1 = entró con la
-- contraseña, aal2 = además presentó el código de su app de autenticación.
-- El arnés los simula con `request.jwt.claims`, que es de donde los lee
-- `auth.jwt()`.
--
--   A  BANDERA APAGADA (el estado en que sale a producción): nada cambia.
--   A1 Un moderador con aal1 sigue siendo moderador.
--   A2 Un administrador de recinto con aal1 sigue viéndolo y pudiendo.
--   A3 Las RPC de dueño siguen corriendo con aal1.
--
--   B  BANDERA ENCENDIDA, sesión aal1: el personal pierde sus poderes.
--   B1 es_moderador() da false.
--   B2 es_admin_complejo / es_admin_cancha / puede_en_complejo dan false.
--   B3 admin_mis_complejos() devuelve cero filas.
--   B4 Las cinco RPC de dueño se rechazan con MFA_REQUERIDA y 42501.
--   B5 mi_requisito_mfa() dice que es personal, que se le exige y que no cumple.
--
--   C  BANDERA ENCENDIDA, sesión aal2: todo vuelve.
--   C1 moderador, admin, panel y RPC de dueño, igual que sin bandera.
--   C2 mi_requisito_mfa() dice que cumple.
--
--   D  A QUIEN NO ES PERSONAL no se le cambia nada, con la bandera como sea.
--   D1 Un jugador común no se vuelve moderador ni pierde nada.
--   D2 Sin sesión (cron, servicio) no se exige nada.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r167 (caso text, ok boolean, detalle text);
grant all on r167 to authenticated;

-- Pone la sesión: usuario y nivel de autenticación, como authenticated.
create or replace function pg_temp.sesion(p_uid uuid, p_aal text)
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal)::text, true);
  execute 'set local role authenticated';
end $$;

do $$
declare
  u_mod uuid := gen_random_uuid();
  u_dueno uuid := gen_random_uuid();
  u_jug uuid := gen_random_uuid();
  v_comp uuid; v_cancha uuid;
  v_b boolean; v_n int; v_txt text; v_det text; v_state text; v_j jsonb;
  v_rpc text[] := array[
    'select public.admin_publicar_complejo(%L, true)',
    'select public.admin_solicitar_revision_complejo(%L)',
    'select public.admin_quitar_admin(%L, gen_random_uuid())',
    'select public.admin_agregar_admin(%L, gen_random_uuid(), ''administrador'')',
    'select public.admin_permisos_admin(%L, gen_random_uuid(), true, true, true)'];
  v_s text;
  v_ok_rpc int;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r167-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[u_mod, u_dueno, u_jug]) u;

  insert into public.moderadores (user_id) values (u_mod);
  insert into public.complejos (nombre, comuna, latitud, longitud) values ('r167 recinto', 'Ñuñoa', -33.45, -70.6) returning id into v_comp;
  insert into public.complejo_admins (complejo_id, user_id, rol) values (v_comp, u_dueno, 'dueño');
  insert into public.canchas_reservables (complejo_id, nombre, tipo, precio_hora)
  values (v_comp, 'r167 cancha', 'futbol_7', 10000) returning id into v_cancha;

  -- ── A. Bandera apagada ────────────────────────────────────────
  update public.feature_flags set activo = false where nombre = 'mfa_obligatoria_staff';

  perform pg_temp.sesion(u_mod, 'aal1');
  v_b := public.es_moderador();
  insert into r167 values ('A1 con la bandera apagada un moderador aal1 sigue moderando', v_b, v_b::text);

  perform pg_temp.sesion(u_dueno, 'aal1');
  select count(*) into v_n from public.admin_mis_complejos();
  insert into r167 values ('A2 y un administrador aal1 ve su recinto',
    v_n = 1 and public.es_admin_complejo(v_comp) and public.es_admin_cancha(v_cancha)
      and public.puede_en_complejo(v_comp, 'canchas'), 'recintos=' || v_n);

  v_ok_rpc := 0;
  foreach v_s in array v_rpc loop
    begin
      execute format(v_s, v_comp);
      v_ok_rpc := v_ok_rpc + 1;
    exception when others then
      get stacked diagnostics v_det = pg_exception_detail;
      -- Con la bandera apagada, cualquier error que no sea MFA es de la regla
      -- normal de la RPC (no existe ese admin, falta la ficha para publicar…).
      if v_det = 'MFA_REQUERIDA' then v_ok_rpc := -100; end if;
    end;
  end loop;
  insert into r167 values ('A3 las cinco RPC de dueño no piden codigo con la bandera apagada', v_ok_rpc > -100, 'ok_rpc=' || v_ok_rpc);

  -- ── B. Bandera encendida, aal1 ────────────────────────────────
  execute 'reset role';
  update public.feature_flags set activo = true where nombre = 'mfa_obligatoria_staff';

  perform pg_temp.sesion(u_mod, 'aal1');
  v_b := public.es_moderador();
  insert into r167 values ('B1 con la bandera encendida un moderador aal1 deja de serlo', v_b = false, v_b::text);

  perform pg_temp.sesion(u_dueno, 'aal1');
  insert into r167 values ('B2 y el administrador aal1 ya no administra',
    not public.es_admin_complejo(v_comp) and not public.es_admin_cancha(v_cancha)
      and not public.puede_en_complejo(v_comp, 'canchas'), '');
  select count(*) into v_n from public.admin_mis_complejos();
  insert into r167 values ('B3 ni ve su recinto en el panel', v_n = 0, 'recintos=' || v_n);

  v_ok_rpc := 0;
  foreach v_s in array v_rpc loop
    begin
      execute format(v_s, v_comp);
    exception when others then
      get stacked diagnostics v_det = pg_exception_detail, v_state = returned_sqlstate;
      if v_det = 'MFA_REQUERIDA' and v_state = '42501' then v_ok_rpc := v_ok_rpc + 1; end if;
    end;
  end loop;
  insert into r167 values ('B4 las cinco RPC de dueño se rechazan con MFA_REQUERIDA', v_ok_rpc = 5, 'rechazadas=' || v_ok_rpc);

  v_j := public.mi_requisito_mfa();
  insert into r167 values ('B5 mi_requisito_mfa: es personal, se le exige y no cumple',
    (v_j->>'es_staff')::boolean and (v_j->>'requerida')::boolean and not (v_j->>'cumple')::boolean and v_j->>'nivel' = 'aal1', v_j::text);

  -- ── C. Bandera encendida, aal2 ────────────────────────────────
  perform pg_temp.sesion(u_mod, 'aal2');
  v_b := public.es_moderador();
  insert into r167 values ('C1 con aal2 el moderador vuelve a moderar', v_b, v_b::text);

  perform pg_temp.sesion(u_dueno, 'aal2');
  select count(*) into v_n from public.admin_mis_complejos();
  insert into r167 values ('C1 y el administrador, a administrar',
    v_n = 1 and public.es_admin_complejo(v_comp) and public.es_admin_cancha(v_cancha)
      and public.puede_en_complejo(v_comp, 'canchas'), 'recintos=' || v_n);

  v_ok_rpc := 0;
  foreach v_s in array v_rpc loop
    begin
      execute format(v_s, v_comp);
    exception when others then
      get stacked diagnostics v_det = pg_exception_detail;
      if v_det = 'MFA_REQUERIDA' then v_ok_rpc := -100; end if;
    end;
  end loop;
  insert into r167 values ('C1 las RPC de dueño ya no piden codigo', v_ok_rpc > -100, 'ok_rpc=' || v_ok_rpc);

  v_j := public.mi_requisito_mfa();
  insert into r167 values ('C2 mi_requisito_mfa dice que cumple', (v_j->>'cumple')::boolean and v_j->>'nivel' = 'aal2', v_j::text);

  -- ── D. Quien no es personal / sin sesión ──────────────────────
  perform pg_temp.sesion(u_jug, 'aal1');
  v_j := public.mi_requisito_mfa();
  insert into r167 values ('D1 un jugador comun no es personal, no se le exige y cumple',
    not (v_j->>'es_staff')::boolean and not (v_j->>'requerida')::boolean and (v_j->>'cumple')::boolean
    and not public.es_moderador(), v_j::text);

  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  insert into r167 values ('D2 sin sesion no se exige nada', public.mfa_ok_para_staff() and public.puede_en_complejo(v_comp, 'canchas'), '');

  insert into r167 values ('E1 las piezas internas no son del cliente',
    not has_function_privilege('authenticated', 'public.mfa_ok_para_staff()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public._exigir_mfa_staff()', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.mi_requisito_mfa()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.mi_requisito_mfa()', 'EXECUTE'), '');
  select activo into v_b from public.feature_flags where nombre = 'mfa_obligatoria_staff';
  insert into r167 values ('E2 la bandera existe', v_b is not null, coalesce(v_b::text, '∅'));
end $$;

select caso, ok, detalle from r167 order by caso;
do $$
declare v_mal int;
begin
  select count(*) into v_mal from r167 where not ok;
  if v_mal > 0 then
    raise exception '% caso(s) de la 167 fallaron (mira la tabla de arriba)', v_mal;
  end if;
end $$;

rollback;
