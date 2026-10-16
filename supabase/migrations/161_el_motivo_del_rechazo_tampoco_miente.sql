-- =============================================================
-- 161. EL MOTIVO DEL RECHAZO TAMPOCO MIENTE
--
-- LA TERCERA, Y ÚLTIMA, QUE LA 119 REVIRTIÓ. La 159 restauró la regla de
-- la 48b, la 160 el aviso del rechazo, y esto el motivo de error que iba
-- con él. Las tres se perdieron por lo mismo: la 119 reescribió dos
-- funciones grandes para añadirles los permisos de club, y las
-- reconstruyó desde copias anteriores a la 48b y la 50.
--
-- QUÉ DICE HOY al confirmar un resultado ya rechazado:
--
--     «Este resultado ya fue rechazado: pide que propongan uno nuevo»
--
-- Y proponer uno nuevo es lo que el servidor rechaza. La 50 lo había
-- cambiado por el que explica lo que de verdad hay que hacer.
--
-- SE COMPROBÓ QUE NO HAY UNA CUARTA. Se tomaron los textos que la 50
-- introdujo y se buscó cada uno en producción: de siete, faltaban dos.
-- Éste es uno; el otro —«Solo un administrador del club contrario puede
-- confirmar este resultado»— **no es una reversión**: la 119 lo
-- reemplazó a propósito al meter `tiene_permiso_de_club(…, 'results')`,
-- que era su trabajo. Conviene decirlo para que nadie lo «restaure»
-- después y deshaga los permisos.
--
-- Idempotente: seguro de re-ejecutar.
-- Pruebas: supabase/tests/161_el_motivo_del_rechazo_tampoco_miente_test.sql
--          y el caso 7 de supabase/tests/50_una_sola_puerta_test.sql
-- =============================================================

do $$
declare
  v_src text;
  v_out text;
  v_ancla constant text :=
    '''reason'', ''Este resultado ya fue rechazado: pide que propongan uno nuevo'');';
begin
  v_src := pg_get_functiondef('public.confirmar_resultado(uuid,boolean)'::regprocedure);

  if position('sólo la moderación puede reabrirlo' in v_src) > 0 then
    raise notice '161: el motivo ya habla de la moderación; no se toca';
    return;
  end if;

  if (length(v_src) - length(replace(v_src, v_ancla, ''))) / length(v_ancla) <> 1 then
    raise exception '161: el ancla no aparece exactamente una vez en confirmar_resultado';
  end if;

  v_out := replace(v_src, v_ancla,
    '''reason'', ''Este resultado quedó rechazado y el encuentro está en disputa: '''
    || E'\n            || ''sólo la moderación puede reabrirlo'');');
  execute v_out;
end $$;
