-- 198. Los índices que le faltaron a la 194.
--
-- El CI de arneses estaba rojo desde la 194 (2026-11-19, madrugada) y nadie
-- lo vio: el caso E2 del arnés 170 («toda llave foránea tiene índice») marca
-- tres llaves que la 194 creó sin índice. Sin él, borrar una cuenta o un
-- reporte recorre la tabla entera para poner en null lo que apunta ahí
-- (las tres son `on delete set null`).
--
-- Son tablas chicas hoy; el arnés existe para que no se acumule.
-- Idempotente.

create index if not exists user_reports_moderado_por_idx
    on public.user_reports (moderado_por);
create index if not exists moderacion_suspensiones_reporte_id_idx
    on public.moderacion_suspensiones (reporte_id);
create index if not exists moderacion_suspensiones_creada_por_idx
    on public.moderacion_suspensiones (creada_por);
