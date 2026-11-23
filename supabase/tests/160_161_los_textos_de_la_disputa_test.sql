-- =============================================================
-- FutFinder — pruebas de las migraciones 160 y 161
--
-- Van juntas porque son la misma historia: las dos frases que la gente SÍ
-- lee cuando un marcador se rechaza, y que la migración 119 devolvió a su
-- versión anterior a la 50 al reescribir `confirmar_resultado` para
-- añadirle los permisos de club.
--
-- POR QUÉ IMPORTAN MÁS DE LO QUE PARECE. Las dos invitaban a «proponer
-- uno nuevo», que es **exactamente lo que el servidor rechaza** en
-- `resultado_en_disputa` (regla de la 48b, restaurada por la 159). Un
-- aviso que pide una acción imposible manda a dos administradores a
-- pelearse con un botón que no existe, y les hace creer que la app está
-- rota.
--
-- Qué cubre:
--   1. El aviso del rechazo no dice «Propongan uno nuevo» y sí explica
--      la disputa (migración 160).
--   2. El motivo de error al confirmar algo ya rechazado, lo mismo
--      (migración 161).
--   3. CONTROL — los dos textos nuevos nombran a la moderación, que es la
--      puerta que SÍ existe (`moderacion_reabrir_resultado`, de la 151).
--      Sin este caso, bastaría con haber borrado la frase vieja para que
--      los dos anteriores pasaran sin decir nada útil.
--
-- Se mira el cuerpo de la función y no se monta un encuentro entero: lo
-- que cambió es el texto, y la conducta que lo rodea ya la cubren el
-- arnés de la 159 y los casos 6 y 7 del de la 50.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run. Termina en ROLLBACK, así que no queda nada guardado.
-- =============================================================

begin;

create temp table r160(caso text) on commit drop;

do $$
declare v_src text;
begin
  v_src := pg_get_functiondef('public.confirmar_resultado(uuid,boolean)'::regprocedure);

  -- ── Caso 1: el aviso (160) ────────────────────────────────────
  if position('Propongan uno nuevo' in v_src) > 0 then
    raise exception 'CASO 1 FALLA: el aviso del rechazo volvió a decir «Propongan uno nuevo»';
  end if;
  if position('queda en disputa' in v_src) = 0 then
    raise exception 'CASO 1 FALLA: el aviso ya no explica que el encuentro queda en disputa';
  end if;
  insert into r160 values ('CASO 1 OK — el aviso explica la disputa y no pide lo imposible');

  -- ── Caso 2: el motivo de error (161) ──────────────────────────
  if position('pide que propongan uno nuevo' in v_src) > 0 then
    raise exception 'CASO 2 FALLA: el motivo de error volvió a invitar a proponer otro';
  end if;
  insert into r160 values ('CASO 2 OK — el motivo de error tampoco lo pide');

  -- ── Caso 3: control, las dos nombran la salida que existe ──────
  if position('moderación' in v_src) = 0 then
    raise exception 'CASO 3 FALLA: ningún texto nombra a la moderación, que es la única puerta '
      'que reabre una disputa. Borrar la frase vieja no basta: hay que decir qué sí se puede.';
  end if;
  insert into r160 values ('CASO 3 OK — control: los textos nombran a la moderación');

  insert into r160 values ('=== 160+161: 3/3, el arnes llego a la ultima linea ===');
end $$;

select * from r160;

rollback;
