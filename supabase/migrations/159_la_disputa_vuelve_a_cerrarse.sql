-- =============================================================
-- 159. LA DISPUTA VUELVE A CERRARSE
--
-- RESTAURA LA MIGRACIÓN 48b, QUE LA 119 REVIRTIÓ SIN QUERER.
--
-- La **48b** existía para una regla concreta: con el desafío en
-- `resultado_en_disputa`, **ningún club propone un resultado nuevo por su
-- cuenta**. Su texto lo dice con todas sus letras —«`resultado_en_disputa`
-- ya NO admite una propuesta nueva. Sólo la moderación reabre una
-- disputa»— y cambió la guarda de
--
--     if v_row.estado not in ('esperando_resultado', 'resultado_en_disputa')
-- a
--     if v_row.estado <> 'esperando_resultado'
--
-- La **119** («permisos del club») reescribió `proponer_resultado` entera
-- para añadirle la comprobación de permisos, y la reconstruyó desde una
-- copia **anterior a la 48b**. La guarda laxa volvió, y con ella la
-- conducta que la 48b había cerrado. No hubo aviso de nada: la función
-- compila igual y hace algo distinto.
--
-- POR QUÉ NADIE SE ENTERÓ EN CINCO MESES: el caso 11 del arnés de la 48 lo
-- comprueba exactamente —«en disputa nadie debería poder proponer de
-- nuevo»— y lleva rojo desde entonces. Los arneses se corren cuando se
-- escriben y nadie vuelve. Salió al correrlos todos juntos el 2026-10-15.
--
-- QUÉ TAN GRAVE ES, SIN INFLARLO: hoy hay **cero** desafíos en
-- `resultado_en_disputa`, así que no hay ni un dato afectado. Lo que
-- estaba abierto era la puerta: un club podía empujar su marcador otra vez
-- en lugar de esperar a que alguien resolviera la disputa, que es
-- justamente lo que la pieza de moderación de la 151
-- (`moderacion_reabrir_resultado`) vino a hacer bien.
--
-- SE PARCHEA EL CUERPO DESPLEGADO, no se reescribe: la función mide 12 KB
-- y transcribirla entera para cambiar una línea es la mejor forma de
-- introducir otro error como éste. El ancla falla si no aparece
-- exactamente una vez.
--
-- Idempotente: seguro de re-ejecutar.
-- Pruebas: supabase/tests/159_la_disputa_vuelve_a_cerrarse_test.sql
--          y el caso 11 de supabase/tests/48_resultado_test.sql
-- =============================================================

do $$
declare
  v_src text;
  v_out text;
  v_ancla constant text :=
    'if v_row.estado not in (''esperando_resultado'', ''resultado_en_disputa'') then';
begin
  v_src := pg_get_functiondef('public.proponer_resultado(uuid,integer,integer,jsonb)'::regprocedure);

  if position('v_row.estado <> ''esperando_resultado''' in v_src) > 0 then
    raise notice '159: proponer_resultado ya exige esperando_resultado; no se toca';
    return;
  end if;

  if (length(v_src) - length(replace(v_src, v_ancla, ''))) / length(v_ancla) <> 1 then
    raise exception '159: el ancla no aparece exactamente una vez en proponer_resultado';
  end if;

  v_out := replace(v_src, v_ancla,
    '-- Corrección 48b, restaurada por la 159: `resultado_en_disputa` ya NO' || E'\n'
    || '    -- admite una propuesta nueva. Sólo la moderación reabre una disputa,' || E'\n'
    || '    -- con `moderacion_reabrir_resultado()` (migración 151).' || E'\n'
    || '    if v_row.estado <> ''esperando_resultado'' then');
  execute v_out;
end $$;
