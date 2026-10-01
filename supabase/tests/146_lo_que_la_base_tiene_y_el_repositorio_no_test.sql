-- =============================================================
-- FutFinder — pruebas de la migración 146
--
-- Esta migración es distinta a las demás: no cambia comportamiento, lo
-- DESCRIBE. Así que lo que hay que probar también es distinto.
--
-- Qué cubre:
--   1. LA PROPIEDAD PRINCIPAL: aplicarla sobre una base que ya tiene
--      estos objetos no cambia NADA. Se toma una huella md5 de todo el
--      catálogo de `public` —cada columna con su tipo y su default, cada
--      restricción, índice, política, disparador, cuerpo de función y
--      cron— antes y después, y tienen que ser idénticas. Es la única
--      forma de afirmar «es un no-op» sin creérselo.
--   2. Los 26 objetos que la migración describe EXISTEN en la base. Si
--      alguno faltara, el inventario estaría mal y la migración
--      describiría algo que nadie puede contrastar.
--   3. Los ocho disparadores apuntan a la función que corresponde. Es el
--      caso que la nota de pendientes no tenía: la función puede estar
--      versionada y el `create trigger` no, y entonces en una base nueva
--      la regla existe y nadie la llama.
--
-- LO QUE ESTE ARNÉS **NO** PRUEBA, y hay que decirlo: que una base vacía
-- se levante entera desde `supabase/` y funcione. Eso sólo lo demuestra
-- construirla, y necesita un PostgreSQL local que la Mac donde se
-- escribió esto no tiene. Mientras eso no se haga, el P1 de
-- `pendientes.md` sigue abierto aunque esta migración esté aplicada.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run. Termina en ROLLBACK y no deja nada.
-- =============================================================

begin;

create or replace function pg_temp.huella_catalogo() returns text language sql as $h$
  select md5(string_agg(x, '|' order by x)) from (
    select 'col:' || c.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod)
           || coalesce(':' || pg_get_expr(d.adbin, d.adrelid), '') || ':' || a.attnotnull::text as x
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
     where n.nspname = 'public'
    union all
    select 'con:' || con.conname || ':' || pg_get_constraintdef(con.oid)
      from pg_constraint con join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
    union all
    select 'idx:' || indexname || ':' || indexdef from pg_indexes where schemaname = 'public'
    union all
    select 'pol:' || tablename || ':' || policyname || ':' || cmd || ':'
           || coalesce(qual, '') || ':' || coalesce(with_check, '')
      from pg_policies where schemaname = 'public'
    union all
    select 'trg:' || t.tgname || ':' || pg_get_triggerdef(t.oid)
      from pg_trigger t join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not t.tgisinternal
    union all
    select 'fn:' || p.proname || ':' || md5(pg_get_functiondef(p.oid))
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
    union all
    select 'cron:' || jobname || ':' || schedule || ':' || command from cron.job
  ) t(x);
$h$;

do $$
declare
  v_antes text;
  v_n int;
  v_falta text;
begin
  v_antes := pg_temp.huella_catalogo();

  -- ── Caso 2: los 26 objetos existen ────────────────────────────
  select string_agg(nombre, ', ') into v_falta from (
    select t.nombre from unnest(array['canchas','notifications','push_tokens','ratings']) t(nombre)
     where to_regclass('public.' || t.nombre) is null
  ) f;
  if v_falta is not null then raise exception 'CASO 2 FALLA: no existen las tablas %', v_falta; end if;

  select string_agg(f.firma, ', ') into v_falta from (
    select t.firma from unnest(array[
      'public.norm_text(text)',
      'public.search_canchas(text,integer)',
      'public.recalc_user_ratings(uuid)',
      'public.tg_ratings_recalc()',
      'public.create_notification(uuid,text,text,text,jsonb)',
      'public.tg_match_future_only()',
      'public.tg_notify_friend_request()',
      'public.tg_notify_friend_accept()']) t(firma)
     where to_regprocedure(t.firma) is null
  ) f;
  if v_falta is not null then raise exception 'CASO 2 FALLA: no existen las funciones %', v_falta; end if;

  select count(*) into v_n from information_schema.columns
   where table_schema='public' and table_name='profiles' and column_name in ('estado','suspended_until');
  if v_n <> 2 then raise exception 'CASO 2 FALLA: faltan columnas de profiles (%)', v_n; end if;

  select count(*) into v_n from cron.job
   where jobname in ('futfinder-match-reminders','futfinder-rating-reminders','futfinder-reactivate');
  if v_n <> 3 then raise exception 'CASO 2 FALLA: faltan cron (%)', v_n; end if;

  -- ── Caso 3: cada disparador llama a SU función ────────────────
  -- Seis de estas funciones ya estaban versionadas; lo que faltaba era
  -- el `create trigger`. Sin esto, en una base nueva la regla existe y
  -- nadie la llama: todo compila y nada se aplica.
  select count(*) into v_n from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where not t.tgisinternal and (t.tgname, p.proname) in (
     ('trg_match_future_only','tg_match_future_only'),
     ('trg_register_cancha','tg_register_cancha'),
     ('trg_enforce_join_rules','tg_enforce_join_rules'),
     ('trg_notify_match_join','tg_notify_match_join'),
     ('trg_notify_friend_request','tg_notify_friend_request'),
     ('trg_notify_friend_accept','tg_notify_friend_accept'),
     ('trg_ratings_recalc','tg_ratings_recalc'),
     ('trg_auto_suspend','tg_auto_suspend'));
  if v_n <> 8 then
    raise exception 'CASO 3 FALLA: sólo % de los 8 disparadores apunta a su función', v_n;
  end if;

  -- ── Caso 1: la huella no se movió ─────────────────────────────
  -- Correr este archivo DESPUÉS de aplicar la migración tiene que dejar
  -- el catálogo igual que antes de abrir la transacción.
  if v_antes is distinct from pg_temp.huella_catalogo() then
    raise exception 'CASO 1 FALLA: el catálogo cambió durante la prueba';
  end if;

  raise notice 'MIGRACIÓN 146: 3/3 casos OK (huella %)', left(v_antes, 12);
end $$;

rollback;
