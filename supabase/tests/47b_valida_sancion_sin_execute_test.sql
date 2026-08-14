-- =============================================================
-- FutFinder — pruebas de la migración 47b: quitarle el EXECUTE a la
-- función de trigger de la sanción no la deja de dispararse.
--
-- QUÉ SE PRUEBA, Y POR QUÉ IMPORTA. Revocar el `EXECUTE` de una función
-- de trigger parece inofensivo, pero si PostgreSQL comprobara el
-- privilegio en cada disparo, esta revocación dejaría a los clubes
-- sancionados creando desafíos otra vez — y el fallo sería SILENCIOSO:
-- ninguna pantalla se rompe, sólo deja de aplicarse una regla. Por eso
-- el arnés no comprueba la revocación y se va: vuelve a intentar crear
-- un desafío con el club sancionado y exige que siga rechazándose.
--
-- LOS CUATRO CASOS:
--   1. Ningún rol del cliente puede ejecutar la función.
--   2. El trigger sigue instalado.
--   3. Con el club RETADOR sancionado, el insert se rechaza y el mensaje
--      habla de la sanción.
--   4. Con el club RETADO sancionado, también.
--   5. Sin sanción, el insert pasa: la revocación no rompió el camino
--      normal.
--
-- Requisito: migraciones 47 y 47b aplicadas.
--
-- NO TOCA NADA REAL. Los clubes y usuarios que usa los crea dentro de la
-- transacción y desaparecen con el `rollback`. No usa el partido de
-- prueba, no usa `chatgpt` ni `chatgpt2`, y no sanciona ningún club
-- existente.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor.
-- =============================================================

begin;

create temp table t47b (n integer, caso text, detalle text) on commit drop;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_c1    uuid := gen_random_uuid();   -- club que desafía
  v_c2    uuid := gen_random_uuid();   -- club desafiado
  v_err   text;
  v_count int;
begin
  -- ── gente y clubes de prueba, sólo dentro de la transacción ───
  insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,email_change,
    email_change_token_new,recovery_token)
  values ('00000000-0000-0000-0000-000000000000',v_admin,'authenticated','authenticated',
    'u47b-'||v_admin||'@futfinder.test','x',now(),now(),now(),'{}','{}','','','','');

  insert into public.clubs (id, nombre, slug, plan, created_by)
  values (v_c1, 'Club 47b Uno', 'club-47b-uno-'||left(v_c1::text,8), 'premium', v_admin),
         (v_c2, 'Club 47b Dos', 'club-47b-dos-'||left(v_c2::text,8), 'premium', v_admin);
  insert into public.club_members (club_id, user_id, rol)
  values (v_c1, v_admin, 'admin');

  -- ══ CASO 1: ningún rol del cliente la ejecuta ════════════════
  if has_function_privilege('public', 'public.club_challenges_valida_sancion()', 'EXECUTE')
     or has_function_privilege('anon', 'public.club_challenges_valida_sancion()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.club_challenges_valida_sancion()', 'EXECUTE') then
    raise exception 'FALLÓ (caso 1): la función de trigger sigue expuesta a algún rol del cliente';
  end if;
  insert into t47b values (1,'sin EXECUTE para el cliente',
    'public=NO, anon=NO, authenticated=NO sobre club_challenges_valida_sancion()');

  -- ══ CASO 2: el trigger sigue instalado ═══════════════════════
  select count(*) into v_count from pg_trigger
   where tgname = 'trg_club_challenges_valida_sancion'
     and tgrelid = 'public.club_challenges'::regclass
     and not tgisinternal;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 2): el trigger no está instalado (% coincidencias)', v_count;
  end if;
  insert into t47b values (2,'el trigger sigue puesto',
    'trg_club_challenges_valida_sancion sobre public.club_challenges');

  -- ══ CASO 3: el club RETADOR sancionado no puede desafiar ═════
  -- ÉSTA es la prueba de verdad: si PostgreSQL comprobara el EXECUTE al
  -- disparar el trigger en vez de al crearlo, acá el insert pasaría y la
  -- regla se habría perdido sin que nada se rompiera a la vista.
  insert into public.club_sanctions (club_id, motivo, fin_at, aplicada_por)
  values (v_c1, 'sanción de prueba 47b', now() + interval '14 days', v_admin);

  v_err := null;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L',
      json_build_object('sub',v_admin,'role','authenticated')::text);
    insert into public.club_challenges (club_retador_id, club_retado_id, creado_por, estado)
    values (v_c1, v_c2, v_admin, 'pendiente');
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_err := SQLERRM;
  end;
  if v_err is null then
    raise exception 'FALLÓ (caso 3): el club sancionado creó un desafío — la revocación desactivó el trigger';
  end if;
  if v_err not like '%sancionado%' then
    raise exception 'FALLÓ (caso 3): el insert falló por otra cosa, no por la sanción — «%»', v_err;
  end if;
  insert into t47b values (3,'retador sancionado: rechazado',
    format('el trigger sigue disparando sin EXECUTE — «%s»', v_err));

  -- ══ CASO 4: el club RETADO sancionado tampoco ════════════════
  update public.club_sanctions set club_id = v_c2 where club_id = v_c1;

  v_err := null;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L',
      json_build_object('sub',v_admin,'role','authenticated')::text);
    insert into public.club_challenges (club_retador_id, club_retado_id, creado_por, estado)
    values (v_c1, v_c2, v_admin, 'pendiente');
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_err := SQLERRM;
  end;
  if v_err is null then
    raise exception 'FALLÓ (caso 4): se pudo desafiar a un club sancionado';
  end if;
  if v_err not like '%sancionado%' then
    raise exception 'FALLÓ (caso 4): el insert falló por otra cosa — «%»', v_err;
  end if;
  insert into t47b values (4,'retado sancionado: rechazado',
    format('la segunda rama del trigger también sigue viva — «%s»', v_err));

  -- ══ CASO 5: sin sanción, el camino normal no se rompió ═══════
  -- Sin esto, un trigger que rechazara SIEMPRE pasaría los casos 3 y 4 y
  -- habría roto la creación de desafíos para toda la aplicación.
  delete from public.club_sanctions where club_id in (v_c1, v_c2);

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub',v_admin,'role','authenticated')::text);
  insert into public.club_challenges (club_retador_id, club_retado_id, creado_por, estado)
  values (v_c1, v_c2, v_admin, 'pendiente');
  execute 'reset role';

  select count(*) into v_count from public.club_challenges
   where club_retador_id = v_c1 and club_retado_id = v_c2;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 5): sin sanción el desafío no se creó (% filas)', v_count;
  end if;
  insert into t47b values (5,'sin sanción sí se crea',
    'la revocación no rompió la creación normal de desafíos');
end;
$$;

select n, caso, detalle from t47b order by n;

rollback;
