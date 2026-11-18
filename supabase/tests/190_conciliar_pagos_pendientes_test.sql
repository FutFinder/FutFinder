-- =============================================================
-- FutFinder — pruebas de la migración 190 (conciliar pagos pendientes).
--
-- Lo que decide qué hacer con cada pago está en la Edge Function y se
-- prueba con Deno (`_shared/conciliarPagos.test.ts`). Acá va lo que vive en
-- la base: la bitácora cerrada, la llamada encolada y el cron.
--
--   T1. `conciliaciones` tiene RLS y ni anon ni authenticated la leen ni
--       la escriben (se prueba con el rol, no sólo con el catálogo).
--   F1. `llamar_conciliar_pagos()` no la ejecutan anon ni authenticated.
--   F2. Es security definer (por eso lee Vault).
--   R1. SIN SECRETO NO LANZA y no encola nada.
--   R2. Con secreto y URL en Vault encola UNA petición a esa URL, con la
--       cabecera `x-conciliar-secreto`.
--   K1. El cron existe, cada 10 minutos, y llama a esa función.
--
-- Se ejecuta entero dentro de begin/rollback: no deja nada (`pg_net` sólo
-- manda filas confirmadas, así que la petición de R2 nunca sale).
-- =============================================================

begin;
create temp table r190 (caso text, ok boolean, detalle text);
grant all on r190 to anon, authenticated;

-- ── T1: con el rol de verdad ─────────────────────────────────────
do $$
declare v_rol text;
begin
  foreach v_rol in array array['anon', 'authenticated'] loop
    execute format('set local role %I', v_rol);
    begin
      perform 1 from public.conciliaciones;
      insert into r190 values ('T1 ' || v_rol || ' no lee conciliaciones', false, 'leyó');
    exception when insufficient_privilege then
      insert into r190 values ('T1 ' || v_rol || ' no lee conciliaciones', true, 'permiso denegado');
    end;
    begin
      insert into public.conciliaciones (ambiente) values ('sandbox');
      insert into r190 values ('T1 ' || v_rol || ' no escribe conciliaciones', false, 'escribió');
    exception when insufficient_privilege then
      insert into r190 values ('T1 ' || v_rol || ' no escribe conciliaciones', true, 'permiso denegado');
    end;
    reset role;
  end loop;
end $$;

do $$
declare
  v_n int;
  v_url text;
  v_cab jsonb;
begin
  insert into r190 values ('T1 conciliaciones tiene RLS',
    (select relrowsecurity from pg_class where oid = 'public.conciliaciones'::regclass), '');

  -- ── F1 y F2 ────────────────────────────────────────────────────
  insert into r190 values ('F1 anon y authenticated no ejecutan llamar_conciliar_pagos',
    not has_function_privilege('anon', 'public.llamar_conciliar_pagos()', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.llamar_conciliar_pagos()', 'EXECUTE'), '');
  insert into r190 values ('F2 es security definer',
    (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'llamar_conciliar_pagos'), '');

  -- ── R1: sin secreto ────────────────────────────────────────────
  -- Si el secreto existiera (producción encendida), se esconde; lo deshace el rollback.
  if exists (select 1 from vault.secrets where name = 'conciliar_pagos_secreto') then
    perform vault.update_secret((select id from vault.secrets where name = 'conciliar_pagos_secreto'),
      null, 'conciliar_pagos_secreto_escondido', null);
  end if;
  if exists (select 1 from vault.secrets where name = 'conciliar_pagos_url') then
    perform vault.update_secret((select id from vault.secrets where name = 'conciliar_pagos_url'),
      null, 'conciliar_pagos_url_escondida', null);
  end if;
  perform vault.create_secret('http://arnes-190.invalid/conciliar', 'conciliar_pagos_url', 'arnés 190');

  begin
    perform public.llamar_conciliar_pagos();
    select count(*) into v_n from net.http_request_queue where url = 'http://arnes-190.invalid/conciliar';
    insert into r190 values ('R1 sin secreto no lanza y no encola', v_n = 0, v_n || ' peticion(es)');
  exception when others then
    insert into r190 values ('R1 sin secreto no lanza y no encola', false, 'lanzó: ' || sqlerrm);
  end;

  -- ── R2: con secreto ────────────────────────────────────────────
  perform vault.create_secret(repeat('s', 40), 'conciliar_pagos_secreto', 'arnés 190');
  perform public.llamar_conciliar_pagos();
  select count(*) into v_n from net.http_request_queue where url = 'http://arnes-190.invalid/conciliar';
  select q.headers into v_cab from net.http_request_queue q where q.url = 'http://arnes-190.invalid/conciliar' limit 1;
  insert into r190 values ('R2a con secreto encola una peticion a la URL de Vault', v_n = 1, v_n || ' peticion(es)');
  -- Sólo se compara contra el valor sembrado por el arnés, no contra uno real.
  insert into r190 values ('R2b lleva la cabecera x-conciliar-secreto',
    (v_cab ->> 'x-conciliar-secreto') = repeat('s', 40),
    'cabeceras: ' || coalesce((select string_agg(k, ', ' order by k) from jsonb_object_keys(v_cab) k), '-'));

  -- ── K1: el cron ────────────────────────────────────────────────
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select count(*) into v_n from cron.job
     where jobname = 'futfinder-conciliar-pagos' and schedule = '*/10 * * * *'
       and command ilike '%llamar_conciliar_pagos%';
    insert into r190 values ('K1 el cron existe cada 10 minutos', v_n = 1, v_n || ' job(s)');
  else
    insert into r190 values ('K1 el cron existe cada 10 minutos', true, 'sin pg_cron en esta base');
  end if;
end $$;

select caso, case when ok then 'OK' else 'FALLA' end as res, detalle from r190 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r190;

rollback;
