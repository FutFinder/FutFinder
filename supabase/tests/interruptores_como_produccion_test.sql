-- =============================================================
-- FutFinder — los interruptores de esta base son los de producción.
--
-- POR QUÉ EXISTE. Las siete huellas de esquema pueden cuadrar al dedillo y
-- la base comportarse como otra aplicación: `feature_flags` son DATOS. Las
-- migraciones crean las cuatro fases de TrueScore **apagadas** —se
-- encendieron a mano el 2026-09-24, una por una— así que una base recién
-- construida se comporta como el FutFinder anterior: la salida de un
-- partido cuesta 3 fijos en vez de salir de la tabla por horas de aviso, y
-- una cuenta nace en 100 en vez de 75.
--
-- LO QUE ESO COSTÓ. El 2026-10-16 la suite daba **125/125 con los
-- interruptores apagados y 119/125 con los de producción**. Seis arneses
-- afirmaban la regla vieja y pasaban porque la base les daba la razón.
-- `scripts/construir-base.mjs` los enciende desde entonces; esto es lo que
-- avisa si alguien construye una base sin él, o si mañana se agrega una
-- fase nueva que nadie encendió.
--
-- SI ESTO FALLA no está roto el producto: está mal configurada la base
-- contra la que se corre la suite. Enciéndelas y vuelve a correr:
--
--   select public.truescore_activar_fase1();  -- …y fase2, fase3, fase4
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

do $$
declare
  v_apagadas text;
begin
  select string_agg(nombre, ', ' order by nombre) into v_apagadas
    from public.feature_flags
   where nombre like 'truescore_fase%' and not activo;

  if v_apagadas is not null then
    raise exception
      'Esta base NO está como producción: % apagada(s). La suite medirá la regla anterior a TrueScore.',
      v_apagadas;
  end if;

  -- Y las de teléfono al revés: producción las tiene APAGADAS porque no hay
  -- proveedor de SMS. Encendidas, media suite se caería pidiendo un
  -- teléfono verificado que nadie puede obtener.
  select string_agg(nombre, ', ' order by nombre) into v_apagadas
    from public.feature_flags
   where nombre like 'telefono%' and activo;

  if v_apagadas is not null then
    raise exception
      'Esta base NO está como producción: % encendida(s), y no hay proveedor de SMS.',
      v_apagadas;
  end if;

  raise notice '=== LOS INTERRUPTORES SON LOS DE PRODUCCIÓN ===';
end $$;

rollback;
