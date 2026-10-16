-- =============================================================
-- 160. EL AVISO DE LA DISPUTA DICE LA VERDAD
--
-- LA SEGUNDA COSA QUE LA 119 REVIRTIÓ. La 159 restauró la regla; esto
-- restaura el texto que la acompañaba, y que la misma migración se llevó
-- por delante por el mismo motivo.
--
-- QUÉ PASA HOY. Cuando un club rechaza el marcador, el aviso dice:
--
--     «… rechazó el marcador propuesto para «X». Propongan uno nuevo.»
--
-- **Y proponer uno nuevo es exactamente lo que el servidor rechaza** desde
-- la 48b (restaurada por la 159): en `resultado_en_disputa` no propone
-- ninguno de los dos clubes. El aviso manda a la gente a chocar contra una
-- puerta cerrada, y encima le echa la culpa a la app.
--
-- LA 50 YA LO HABÍA ARREGLADO. Su cabecera lo dice: «"Propongan uno
-- nuevo." — es una instrucción que el servidor rechaza». Cambió el texto
-- por el que explica lo que de verdad pasa. La **119** reescribió
-- `confirmar_resultado` para añadirle los permisos de club y la
-- reconstruyó desde una copia anterior a la 50, devolviendo el texto
-- viejo — igual que hizo con la guarda de la 48b.
--
-- POR QUÉ NADIE SE ENTERÓ: el caso 6 del arnés de la 50 lo comprueba
-- literalmente y lleva rojo desde entonces.
--
-- SE PARCHEA EL CUERPO DESPLEGADO con un ancla que falla si no aparece
-- exactamente una vez. Transcribir la función entera es cómo se produjo
-- este fallo las dos veces.
--
-- Idempotente: seguro de re-ejecutar.
-- Pruebas: supabase/tests/160_el_aviso_de_la_disputa_dice_la_verdad_test.sql
--          y el caso 6 de supabase/tests/50_una_sola_puerta_test.sql
-- =============================================================

do $$
declare
  v_src text;
  v_out text;
  v_ancla constant text := '|| v_titulo || ''». Propongan uno nuevo.'',';
begin
  v_src := pg_get_functiondef('public.confirmar_resultado(uuid,boolean)'::regprocedure);

  if position('queda en disputa' in v_src) > 0 then
    raise notice '160: el aviso ya explica la disputa; no se toca';
    return;
  end if;

  if (length(v_src) - length(replace(v_src, v_ancla, ''))) / length(v_ancla) <> 1 then
    raise exception '160: el ancla no aparece exactamente una vez en confirmar_resultado';
  end if;

  v_out := replace(v_src, v_ancla,
    '|| v_titulo || ''». El encuentro queda en disputa: las estadísticas no cambian ''' || E'\n'
    || '                || ''hasta que la moderación lo revise.'',');
  execute v_out;
end $$;
