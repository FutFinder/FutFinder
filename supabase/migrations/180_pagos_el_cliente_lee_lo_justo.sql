-- =============================================================
-- 180. DE UN PAGO, EL CLIENTE LEE LO JUSTO
--
-- EL HUECO. `pagos` tiene RLS con una sola política —cada uno ve los suyos—
-- pero los privilegios eran los de fábrica: `authenticated` con SELECT,
-- INSERT, UPDATE y DELETE sobre la tabla ENTERA y `anon` con SELECT. La RLS
-- frena las filas ajenas y, al no haber políticas de escritura, toda
-- escritura; lo que no frena son las COLUMNAS de la fila propia. Con su
-- sesión, cualquiera podía pedir por la API:
--   · `datos`: la respuesta cruda del proveedor (lo que Flow contesta en
--     `payment/getStatus`: correo del pagador, medio de pago, comisión,
--     fechas de abono), más la URL de pago y el ambiente;
--   · `referencia_externa`: el token de Flow del cobro;
--   · `reversa_nota` y `reversado_por`: la nota interna de quien devolvió y
--     su id de usuario.
-- Nada de eso lo usa la app: `src/services/pagos.js` pide `id, estado,
-- monto, orden_comercio, pagado_at`.
--
-- EL ARREGLO. El mismo patrón de la 165 y la 177: privilegios por columna.
--   · `anon`: nada.
--   · `authenticated`: sólo SELECT, y sólo de las columnas que describen el
--     pago hacia afuera. Ninguna escritura: todo cambio en `pagos` pasa por
--     funciones `security definer` (`iniciar_pago_reserva`, `confirmar_pago`,
--     `rechazar_pago`, `marcar_pago_reversado`…), que corren como su dueño y
--     no dependen de estos privilegios.
--   · `service_role` no cambia: las Edge Functions leen `datos` y el token.
--
-- La política `pagos_select` queda igual: sigue decidiendo las filas.
--
-- QUÉ SE ROMPE SI ALGUIEN PEDÍA DE MÁS. Un `select *` sobre `pagos` desde el
-- cliente pasa a fallar con 42501. La app no lo hace (lo fija
-- `src/services/__tests__/pagosColumnas.test.js`); un build viejo tampoco:
-- la consulta de `estadoDePago` no cambió desde que existe.
--
-- Idempotente.
-- =============================================================

revoke all on public.pagos from anon;
revoke all on public.pagos from authenticated;

grant select (
    id, user_id, reserva_id, monto, proveedor, orden_comercio, estado,
    created_at, actualizado_at, pagado_at, reversado_at
) on public.pagos to authenticated;
