-- =============================================================
-- FutFinder — pruebas de la migración 154
--
-- LO QUE ESTE ARNÉS HACE Y EL DE LA 153 NO HIZO: **cambia de rol**.
-- `search_canchas` era `security invoker`, así que corría con los
-- privilegios de quien llama; el arnés de la 153 corrió como `postgres`,
-- que se los salta todos, y dio 8/8 sobre una función que para un
-- usuario real reventaba con `42501 permission denied for table
-- cancha_usos`. Un arnés que no cambia de rol no puede decir nada sobre
-- lo que ve un usuario.
--
-- Qué cubre:
--   1. CONTROL: como `authenticated`, `cancha_usos` sigue siendo
--      ilegible directamente. Si este caso fallara, el arreglo habría
--      sido publicar la tabla —que es justo lo que no se quiere—, y el
--      caso 2 pasaría por la razón equivocada.
--   2. Como `authenticated`, `search_canchas` CONTESTA en vez de
--      reventar. Es el fallo que la 154 arregla.
--   3. Y contesta lo correcto: la cancha que pasa el umbral sale, la que
--      no lo pasa no sale. El arreglo no podía ser «que no falle»
--      devolviendo todo.
--   4. `anon` no la puede ejecutar. Con `security definer` esto importa
--      más que antes: la política de `canchas` es sólo para
--      `authenticated`, así que ejecutarla como `anon` sería leer el
--      directorio saltándose esa política.
--   5. La función quedó `security definer`. Si alguien la reescribe sin
--      ese atributo, vuelve el 42501 y este caso lo dice por su nombre.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run. Todo corre dentro de una transacción que termina en
-- ROLLBACK, así que no queda nada guardado.
-- =============================================================

begin;

create temp table resultado(caso text) on commit drop;
grant all on resultado to authenticated;

-- ── Caso 5: el atributo, antes de cambiar de rol ─────────────────
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='search_canchas' and p.prosecdef) then
    raise exception 'CASO 5 FALLA: search_canchas no es security definer; vuelve el 42501';
  end if;
  insert into resultado values ('CASO 5 OK — search_canchas es security definer');
end $$;

-- ── Caso 4: anon no la ejecuta ───────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.search_canchas(text, integer)', 'execute') then
    raise exception 'CASO 4 FALLA: anon puede ejecutar search_canchas y leería el directorio '
      'saltándose canchas_select_any, que es sólo para authenticated';
  end if;
  insert into resultado values ('CASO 4 OK — anon no ejecuta search_canchas');
end $$;

-- ── Ahora sí: con la lente de un usuario real ────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare v_n integer; v_pudo boolean;
begin
  -- ── Caso 1: control — cancha_usos sigue sin ser legible ───────
  begin
    select count(*) into v_n from public.cancha_usos;
    v_pudo := true;
  exception when insufficient_privilege then v_pudo := false; end;
  if v_pudo then
    raise exception 'CASO 1 FALLA: authenticated lee cancha_usos. El arreglo no podía ser '
      'publicar quién juega dónde.';
  end if;
  insert into resultado values ('CASO 1 OK — control: cancha_usos sigue ilegible para authenticated');

  -- ── Caso 2: y aun así la función contesta ─────────────────────
  begin
    select count(*) into v_n from public.search_canchas('maiclub', 10);
    v_pudo := true;
  exception when others then v_pudo := false; end;
  if not v_pudo then
    raise exception 'CASO 2 FALLA: search_canchas revienta para authenticated (el fallo de la 153)';
  end if;
  insert into resultado values ('CASO 2 OK — search_canchas contesta como authenticated');

  -- ── Caso 3: y contesta lo correcto ────────────────────────────
  -- `maiclub` tiene 4 organizadores y pasa; `tangus` y `Canchas de
  -- Bonilla` tienen 1 y no. Si el arreglo hubiera sido «que no falle»
  -- devolviendo todo, este caso lo caza.
  select count(*) into v_n from public.search_canchas('maiclub', 10);
  if v_n <> 1 then
    raise exception 'CASO 3 FALLA: la cancha sobre el umbral no se sugiere (devolvió %)', v_n;
  end if;
  select count(*) into v_n from public.search_canchas('tangus', 10);
  if v_n <> 0 then
    raise exception 'CASO 3 FALLA: una cancha bajo el umbral se sugiere (devolvió %)', v_n;
  end if;
  insert into resultado values ('CASO 3 OK — sobre el umbral sale, bajo el umbral no');

  insert into resultado values ('=== 154: 5/5, el arnes llego a la ultima linea ===');
end $$;

reset role;
select * from resultado;

rollback;
