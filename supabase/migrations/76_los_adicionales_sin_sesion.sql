-- =============================================================
-- FutFinder migration 76: los adicionales y los servicios, sin sesión
-- =============================================================
-- UN `select` SOBRE `complejo_cobros` O `complejo_servicios` HECHO SIN
-- SESIÓN NO DEVUELVE CERO FILAS: FALLA. Con
-- «permission denied for function es_admin_complejo».
--
-- Las dos policies tienen la misma forma:
--
--     using (
--         (activo and exists (... complejos publicados ...))
--         or public.es_admin_complejo(complejo_id)
--     )
--
-- y `es_admin_complejo` está concedida solo a `authenticated`. Postgres
-- no garantiza el orden de evaluación de un `or`, así que el rol `anon`
-- termina llamando una función que no puede ejecutar y la consulta
-- revienta antes de filtrar nada.
--
-- CÓMO APARECIÓ: probando el flujo del jugador contra un recinto
-- publicado, con el rol `anon`. Hoy no rompe nada visible porque la
-- pestaña de Reservas está detrás del guard de sesión y todo corre como
-- `authenticated`. Pero `buscar_complejos` y `get_disponibilidad_cancha`
-- SÍ están concedidas a `anon` a propósito —el descubrimiento tiene que
-- funcionar sin cuenta— así que la intención del diseño ya era que esto
-- se pudiera leer sin sesión, y estas dos tablas la contradecían.
--
-- LA CORRECCIÓN NO ES CONCEDERLE LA FUNCIÓN A `anon`. Eso funcionaría,
-- pero ampliaría el alcance de un helper `security definer` para
-- resolver un problema de forma. Se parte la policy en dos:
--
--   · una PÚBLICA, que solo mira si el complejo está publicado;
--   · una `to authenticated`, que es la única que llama a la función.
--
-- Varias policies permisivas de `select` se combinan con `or`, así que
-- el resultado para quien tiene sesión es idéntico al de antes; y `anon`
-- ni siquiera evalúa la segunda.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── Cobros adicionales (venía de la 68) ──────────────────────────
drop policy if exists "complejo_cobros_select" on public.complejo_cobros;
drop policy if exists "complejo_cobros_select_publico" on public.complejo_cobros;
drop policy if exists "complejo_cobros_select_admin" on public.complejo_cobros;

-- Sin sesión y con sesión: los ACTIVOS de un recinto publicado. Un cobro
-- apagado no se le ofrece a nadie, y uno de un recinto no publicado
-- tampoco existe para el jugador.
create policy "complejo_cobros_select_publico"
    on public.complejo_cobros for select
    using (
        activo
        and exists (
            select 1 from public.complejos c
             where c.id = complejo_cobros.complejo_id and c.publicado
        )
    );

-- Y quien administra el recinto ve TODOS, activos o no, publicado o no:
-- es la lista que edita.
create policy "complejo_cobros_select_admin"
    on public.complejo_cobros for select
    to authenticated
    using (public.es_admin_complejo(complejo_id));

-- ── Servicios (venía de la 75, recién) ───────────────────────────
drop policy if exists "complejo_servicios_select" on public.complejo_servicios;
drop policy if exists "complejo_servicios_select_publico" on public.complejo_servicios;
drop policy if exists "complejo_servicios_select_admin" on public.complejo_servicios;

create policy "complejo_servicios_select_publico"
    on public.complejo_servicios for select
    using (
        exists (
            select 1 from public.complejos c
             where c.id = complejo_servicios.complejo_id and c.publicado
        )
    );

create policy "complejo_servicios_select_admin"
    on public.complejo_servicios for select
    to authenticated
    using (public.es_admin_complejo(complejo_id));
