-- =============================================================
-- FutFinder migration 93: puestos personalizados de la alineación
-- =============================================================
-- LA 92 YA GUARDABA `personalizado`, pero nunca el detalle de qué se
-- arrastró: hacía falta un lugar para las coordenadas a mano. Esta
-- migración agrega esa columna en vez de rehacer la 92, porque la 92 ya
-- pudo haberse aplicado y no hay forma de saber si alguien ya la corrió.
--
-- `puestos_personalizados` es un jsonb `{ "<puesto>": { left, top, label } }`
-- — sólo los puestos que alguien arrastró a mano; el resto sigue viniendo
-- del cálculo de `layoutSlots(formacion)` en el cliente. Vacío por defecto:
-- una alineación armada con los puestos tal cual la formación no toca esta
-- columna para nada.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

alter table public.club_lineups
    add column if not exists puestos_personalizados jsonb not null default '{}'::jsonb;

comment on column public.club_lineups.puestos_personalizados is
    'Puestos reubicados a mano en la cancha: {puesto: {left, top, label}}. Vacío si la alineación usa la formación tal cual, sin arrastres. El label ya viene recalculado según la zona donde se soltó (ver zoneLabel en formacionClub.js), no es el de la formación original.';
