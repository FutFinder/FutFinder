import { useEffect, useState } from 'react';
import { getCurrentUser } from '../services/auth';
import { countUnread, subscribeToNotifications } from '../services/notifications';

/**
 * Cuántos avisos sin leer tiene el usuario actual — carga inicial +
 * Realtime. Antes vivía solo dentro de `CustomTabBar` (un único bell en la
 * barra inferior); ahora la campana aparece en el header de cada pestaña
 * (decisión del handoff de Reservas: "la campana pasa arriba a la derecha
 * en toda la app"), así que puede haber varias instancias montadas a la
 * vez. `subscribeToNotifications` ya comparte un solo canal Realtime por
 * usuario (`createSharedChannel`), así que cada instancia adicional solo
 * agrega un listener liviano, no una suscripción nueva.
 */
export default function useUnreadNotifications() {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let mounted = true;
    let unsubscribe = () => {};

    const reload = async () => {
      const n = await countUnread();
      if (mounted) setUnread(n || 0);
    };

    reload();
    (async () => {
      const u = await getCurrentUser();
      if (!u?.id || !mounted) return;
      unsubscribe = subscribeToNotifications(u.id, reload);
    })();

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return unread;
}
