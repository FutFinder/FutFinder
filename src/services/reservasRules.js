/**
 * Reglas centralizadas del vertical Reservas (handoff `Reservas.dc.html`).
 *
 * Puro: sin React, sin Supabase. Toda la UI de Reservas lee de aquí — ningún
 * componente vuelve a escribir el cargo de servicio, el redondeo de la cuota
 * ni los límites de jugadores por su cuenta.
 *
 * IMPORTANTE: el backend de este vertical todavía es simulado (decisión
 * explícita: no hay pasarela de pago real conectada ni tablas de Supabase
 * para complejos/canchas/reservas/balance todavía — ver
 * docs/memoria/operacion/pendientes.md cuando se documente). Estos valores
 * son los que usa el prototipo (`Component.renderVals()` en
 * `Reservas.dc.html`), no un reflejo de una función de Postgres como en
 * `matchRules.js` — cuando exista backend real, hay que verificar que estos
 * números sigan coincidiendo.
 */

/** Cargo de servicio FutFinder, fijo, sumado al precio base de la cancha. */
export const SERVICE_FEE_CLP = 1500;

/** Cuántos jugadores puede tener una convocatoria dividida entre todos. */
export const JUGADORES_LIMITS = { min: 2, max: 30 };

/** Carga mínima de Balance FutFinder. */
export const MIN_TOPUP_CLP = 1000;

/** Accesos rápidos al cargar saldo. */
export const TOPUP_QUICK_AMOUNTS_CLP = [1000, 5000, 10000, 20000];

/** Horas antes del inicio en que una reserva todavía se puede cancelar. */
export const CANCELLATION_WINDOW_HOURS = 12;

/** Formato de moneda chilena: "$" + separador de miles, sin decimales. */
export function formatCLP(amount) {
  return '$' + Math.round(amount).toLocaleString('es-CL');
}

/** Redondea al múltiplo de 50 más cercano — así se calcula toda cuota por jugador. */
export function roundToNearest50(amount) {
  return Math.round(amount / 50) * 50;
}

/** Total a pagar por la cancha: precio base + cargo de servicio fijo. */
export function computeTotal(basePriceClp) {
  return basePriceClp + SERVICE_FEE_CLP;
}

/**
 * Cantidad de jugadores válida para dividir el pago entre todos: no puede
 * ser menor a 2 (no hay con quién dividir) ni mayor a 30 (tope del
 * prototipo). `fallback` es el "habitual" de la cancha si no se pasa `n`.
 */
export function clampJugadores(n, fallback) {
  return Math.min(Math.max(n || fallback, JUGADORES_LIMITS.min), JUGADORES_LIMITS.max);
}

/** Cuota por jugador cuando se divide entre todos — siempre redondeada a $50. */
export function computeCuota(totalClp, jugadores) {
  return roundToNearest50(totalClp / jugadores);
}

/** Cuánto paga cada capitán cuando se divide 50/50 — sin redondeo a $50, es exactamente la mitad. */
export function computeMitad(totalClp) {
  return totalClp / 2;
}

/** `true` si el monto a cargar en Balance cumple la carga mínima. */
export function isValidTopupAmount(amountClp) {
  return amountClp >= MIN_TOPUP_CLP;
}
