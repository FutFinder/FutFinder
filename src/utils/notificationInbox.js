/**
 * Lógica pura de la bandeja de Avisos: qué vista mostrar, cómo aplicar un
 * cambio optimista con rollback si el servidor falla, y cómo evitar que una
 * misma acción (aceptar, rechazar, borrar, marcar todo…) se dispare dos
 * veces mientras la primera todavía está en vuelo.
 *
 * Deliberadamente sin React ni Supabase: la pantalla solo conecta esto con
 * `useState` y los servicios reales, para poder probar la lógica con
 * `node --test` sin levantar un renderer ni mockear la red.
 */

/**
 * Qué vista de la bandeja corresponde según el estado de carga.
 * `loading` manda siempre; si no está cargando, un error de listNotifications()
 * debe ganarle al estado vacío — nunca hay que mostrar «Todo al día» cuando en
 * realidad no pudimos ni preguntar si hay avisos.
 */
export function getInboxStatus({ loading, loadError }) {
  if (loading) return 'loading';
  if (loadError) return 'error';
  return 'ready';
}

/**
 * Guarda de una sola ejecución por id. `begin(id)` devuelve `false` si esa
 * misma acción ya está en curso — el llamador debe ignorar el segundo tap en
 * vez de repetir la operación. `end(id)` libera el id (siempre, haya salido
 * bien o mal la acción).
 */
export function createRequestGuard() {
  const busy = new Set();
  return {
    isBusy: (id) => busy.has(id),
    begin: (id) => {
      if (busy.has(id)) return false;
      busy.add(id);
      return true;
    },
    end: (id) => {
      busy.delete(id);
    },
  };
}

/**
 * Aplica `apply(items)` de inmediato (para que la UI reaccione al toque sin
 * esperar la red), ejecuta `action()` — que debe resolver `{ error }`, el
 * mismo contrato que ya usan los servicios — y si falla revierte `items` a
 * como estaba antes de tocar nada.
 *
 * Devuelve `{ error }` para que el llamador decida qué mostrar (banner,
 * etc.); el propio `items` ya quedó correcto (optimista u original) cuando
 * esta promesa resuelve.
 */
export async function runOptimistic({ items, apply, action, setItems }) {
  setItems(apply(items));
  const { error } = await action();
  if (error) {
    setItems(items);
    return { error };
  }
  return { error: null };
}

// Transformaciones puras reutilizadas como `apply` de runOptimistic.
export const withRead = (items, id) =>
  items.map((p) => (p.id === id ? { ...p, read: true } : p));

export const withAllRead = (items) => items.map((p) => ({ ...p, read: true }));

export const withoutId = (items, id) => items.filter((p) => p.id !== id);

export const withActionsResolved = (items, id) =>
  items.map((p) => (p.id === id ? { ...p, read: true, _actionsResolved: true } : p));
