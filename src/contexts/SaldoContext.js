import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

import { getMiBalance } from '../services/reservas';

/**
 * El saldo, compartido entre todas las pestañas que muestran el monedero.
 *
 * UN SOLO PROVEEDOR, NO UNO POR BOTÓN. `WalletButton` vive en Inicio,
 * Partidos y Reservas; si cada instancia pidiera su propio saldo, cambiar
 * de pestaña dispararía una consulta nueva cada vez, para el mismo número.
 * Envuelve las pestañas enteras, igual que `ClubsHomeProvider` — ver el
 * comentario de `MainTabs`.
 *
 * `saldo` empieza en `null` y SE QUEDA en `null` si la consulta falla: es
 * «no se sabe todavía», nunca «no hay plata». `WalletButton` no dibuja nada
 * junto al ícono mientras sea `null`, así que un saldo que aún no llegó
 * nunca se lee como «$0» en la barra superior — el problema que esta misma
 * pantalla evitaba antes no mostrando ningún monto.
 */
const SaldoContext = createContext(null);

export function SaldoProvider({ children }) {
  const [saldo, setSaldo] = useState(null);
  const cargando = useRef(false);

  const refresh = useCallback(async () => {
    if (cargando.current) return;
    cargando.current = true;
    // limite=1: acá sólo hace falta el total, no el historial de movimientos.
    const { data } = await getMiBalance(1);
    if (data) setSaldo(data.saldo);
    cargando.current = false;
  }, []);

  return <SaldoContext.Provider value={{ saldo, refresh }}>{children}</SaldoContext.Provider>;
}

/** Fuera del proveedor, el saldo es `null` para siempre — nunca revienta. */
export function useSaldo() {
  return useContext(SaldoContext) || { saldo: null, refresh: () => {} };
}
