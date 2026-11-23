-- =============================================================
-- FutFinder — pruebas de la migración 158
--
-- Qué cubre:
--   1. `reactivate_suspended()` no la ejecuta ni `authenticated` ni `anon`.
--   2. CONTROL — `service_role` sí la conserva. Es quien corre el cron;
--      revocársela sería romper lo que funciona para cerrar una puerta por
--      la que casi no se entra, y un cero en el caso 1 no distinguiría las
--      dos cosas.
--   3. Con la lente de un usuario real: llamarla da 42501.
--   4. Y la app sigue funcionando: `authenticated` conserva las funciones
--      que sí son suyas (se mira `mis_ajustes`, de la 148).
--
-- EL CONTROL DE ANTES no se puede reproducir contra producción, donde la
-- función nunca estuvo abierta. Se midió sobre la base recién construida:
-- 169 funciones ejecutables por `authenticated` frente a las 168 de
-- producción, y la que sobraba era ésta.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run. Termina en ROLLBACK, así que no queda nada guardado.
-- =============================================================

begin;

create temp table r(caso text) on commit drop;
grant all on r to authenticated;

do $$
begin
  if has_function_privilege('authenticated', 'public.reactivate_suspended()', 'execute')
     or has_function_privilege('anon', 'public.reactivate_suspended()', 'execute') then
    raise exception 'CASO 1 FALLA: el cliente puede ejecutar reactivate_suspended()';
  end if;
  insert into r values ('CASO 1 OK — ni authenticated ni anon la ejecutan');

  if not has_function_privilege('service_role', 'public.reactivate_suspended()', 'execute') then
    raise exception 'CASO 2 FALLA: service_role la perdió, y es quien corre el cron';
  end if;
  insert into r values ('CASO 2 OK — control: service_role la conserva');
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare v_pudo boolean; v_err text;
begin
  begin
    perform public.reactivate_suspended();
    v_pudo := true;
  exception when insufficient_privilege then v_pudo := false; v_err := sqlstate;
            when others then v_pudo := false; v_err := sqlstate; end;
  if v_pudo then raise exception 'CASO 3 FALLA: un usuario real la ejecutó'; end if;
  insert into r values ('CASO 3 OK — un usuario real recibe '||v_err);

  -- Y no se llevó por delante lo que sí es del cliente.
  if not has_function_privilege('authenticated', 'public.mis_ajustes()', 'execute') then
    raise exception 'CASO 4 FALLA: authenticated perdió mis_ajustes(); esto revocó de más';
  end if;
  insert into r values ('CASO 4 OK — las funciones que sí son del cliente siguen');

  insert into r values ('=== 158: 4/4, el arnes llego a la ultima linea ===');
end $$;

reset role;
select * from r;

rollback;
