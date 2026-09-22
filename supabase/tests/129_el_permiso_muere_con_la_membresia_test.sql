-- =============================================================
-- FutFinder — pruebas de la migración 129 (C01, C02 y C03).
--
--   A1  Un expulsado ya no puede editar el club con su permiso individual…
--   A2  …y esa excepción se borró al terminar la membresía.
--   A3  Pero un miembro CON excepción activa sigue pudiendo: el arreglo no
--       apaga la delegación, que es de lo que vive la migración 119.
--   A4  Y el administrador sigue editando.
--   B1  El invitado no puede mover su invitación a otro club.
--   B2  Pero sí puede aceptarla, y entra al club que lo invitó.
--   C1  Ni el administrador puede cambiar `plan` ni `verificado`…
--   C2  …y sigue pudiendo editar nombre y descripción.
--   C3  Un club tampoco puede NACER premium ni verificado.
--
-- Los tres hallazgos se reprodujeron antes contra producción con las
-- definiciones vivas: el expulsado editó la descripción, la invitación del
-- club A creó membresía en el club B, y un `editClub` puso plan=premium y
-- verificado=true.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r129 (caso text, ok boolean, detalle text);
grant all on r129 to authenticated;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_x uuid := gen_random_uuid();
  v_socio uuid := gen_random_uuid();
  v_admin_b uuid := gen_random_uuid();
  v_a uuid; v_b uuid; v_inv uuid;
  v_n int; v_txt text; v_plan text; v_ver boolean; v_ok boolean;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r129-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_admin, v_x, v_socio, v_admin_b]) u;

  insert into public.clubs (nombre, slug, created_by, descripcion)
  values ('r129 club A', 'r129-a-' || substr(v_admin::text, 1, 8), v_admin, 'original')
  returning id into v_a;
  insert into public.clubs (nombre, slug, created_by, descripcion)
  values ('r129 club B', 'r129-b-' || substr(v_admin_b::text, 1, 8), v_admin_b, 'original')
  returning id into v_b;

  insert into public.club_members (club_id, user_id, rol) values (v_a, v_admin, 'admin');
  insert into public.club_members (club_id, user_id, rol) values (v_b, v_admin_b, 'admin');
  insert into public.club_members (club_id, user_id, rol) values (v_a, v_x, 'jugador');
  insert into public.club_members (club_id, user_id, rol) values (v_a, v_socio, 'jugador');

  -- Los dos jugadores tienen el permiso individual de editar el club.
  insert into public.club_member_permission_overrides (club_id, user_id, permiso, activo)
  values (v_a, v_x, 'editClub', true), (v_a, v_socio, 'editClub', true);

  -- A X lo expulsan.
  delete from public.club_members where club_id = v_a and user_id = v_x;

  -- ── A2: la excepción se fue con la membresía ──────────────────
  select count(*) into v_n from public.club_member_permission_overrides
   where club_id = v_a and user_id = v_x;
  insert into r129 values ('A2 la excepcion se borra al terminar la membresia', v_n = 0, v_n::text);
  select count(*) into v_n from public.club_member_permission_overrides
   where club_id = v_a and user_id = v_socio;
  insert into r129 values ('A2 y no se lleva por delante la del que sigue', v_n = 1, v_n::text);

  -- ── A1: el expulsado ya no edita ──────────────────────────────
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_x, 'role', 'authenticated')::text, true);
  update public.clubs set descripcion = 'editado por un expulsado' where id = v_a;
  get diagnostics v_n = row_count;
  reset role;
  select descripcion into v_txt from public.clubs where id = v_a;
  insert into r129 values ('A1 un expulsado ya no puede editar el club',
    v_n = 0 and v_txt = 'original', 'filas=' || v_n || ' descripcion=' || v_txt);

  -- Y el ayudante lo dice directamente, que es lo que leen las demás políticas.
  insert into r129 values ('A1 el ayudante niega el permiso sin membresia',
    public.tiene_permiso_de_club(v_a, v_x, 'editClub') = false,
    public.tiene_permiso_de_club(v_a, v_x, 'editClub')::text);

  -- ── A3: la delegación sigue viva para quien sí es del club ────
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_socio, 'role', 'authenticated')::text, true);
  update public.clubs set descripcion = 'editado por el delegado' where id = v_a;
  get diagnostics v_n = row_count;
  reset role;
  insert into r129 values ('A3 un miembro con excepcion activa si edita', v_n = 1, 'filas=' || v_n);

  -- ── A4: el administrador, también ─────────────────────────────
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  update public.clubs set descripcion = 'editado por el admin' where id = v_a;
  get diagnostics v_n = row_count;

  -- ── C1: pero no el plan ni la verificación ───────────────────
  v_ok := true;
  begin
    update public.clubs set plan = 'premium' where id = v_a;
  exception when insufficient_privilege then
    v_ok := false;
  end;
  reset role;
  insert into r129 values ('A4 el administrador sigue editando', v_n = 1, 'filas=' || v_n);
  insert into r129 values ('C1 el administrador NO puede cambiar el plan', v_ok = false,
    case when v_ok then 'la actualizacion pasó' else 'permission denied' end);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_ok := true;
  begin
    update public.clubs set verificado = true where id = v_a;
  exception when insufficient_privilege then
    v_ok := false;
  end;
  reset role;
  insert into r129 values ('C1 ni la marca de verificado', v_ok = false,
    case when v_ok then 'la actualizacion pasó' else 'permission denied' end);

  select plan, verificado, descripcion into v_plan, v_ver, v_txt from public.clubs where id = v_a;
  insert into r129 values ('C2 y el club quedó editado pero sin tocar plan ni verificado',
    v_plan = 'estandar' and v_ver = false and v_txt = 'editado por el admin',
    v_plan || ' / ' || v_ver || ' / ' || v_txt);

  -- ── C3: tampoco puede NACER premium ───────────────────────────
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_b, 'role', 'authenticated')::text, true);
  v_ok := true;
  begin
    insert into public.clubs (nombre, slug, created_by, plan, verificado)
    values ('r129 nace premium', 'r129-premium-' || substr(v_admin_b::text,1,8), v_admin_b, 'premium', true);
  exception when insufficient_privilege then
    v_ok := false;
  end;
  reset role;
  insert into r129 values ('C3 un club no puede nacer premium ni verificado', v_ok = false,
    case when v_ok then 'la insercion pasó' else 'permission denied' end);

  -- ── B: la invitación ──────────────────────────────────────────
  insert into public.club_join_requests (club_id, user_id, tipo, status)
  values (v_a, v_x, 'invitacion', 'pending') returning id into v_inv;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_x, 'role', 'authenticated')::text, true);
  v_ok := true;
  begin
    update public.club_join_requests set club_id = v_b, status = 'approved' where id = v_inv;
  exception when insufficient_privilege then
    v_ok := false;
  end;
  reset role;
  insert into r129 values ('B1 el invitado no puede mover su invitacion a otro club',
    v_ok = false, case when v_ok then 'la actualizacion pasó' else 'permission denied' end);
  select count(*) into v_n from public.club_members where club_id = v_b and user_id = v_x;
  insert into r129 values ('B1 y no entró al club B', v_n = 0, v_n::text);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_x, 'role', 'authenticated')::text, true);
  update public.club_join_requests set status = 'approved', responded_at = now() where id = v_inv;
  get diagnostics v_n = row_count;
  reset role;
  insert into r129 values ('B2 pero si puede aceptar la invitacion', v_n = 1, 'filas=' || v_n);
  select count(*) into v_n from public.club_members where club_id = v_a and user_id = v_x;
  insert into r129 values ('B2 y entra al club que lo invitó', v_n = 1, v_n::text);
end $$;

reset role;

do $$
declare v_malos int; v_detalle text;
begin
  select count(*) into v_malos from r129 where not ok;
  if v_malos > 0 then
    select string_agg(caso || ' -> ' || coalesce(detalle, ''), E'\n') into v_detalle
      from r129 where not ok;
    raise exception 'FALLARON % casos de la 129: %', v_malos, v_detalle;
  end if;
end $$;

select caso, case when ok then 'OK' else 'FALLA' end as res, detalle from r129 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r129;

rollback;
