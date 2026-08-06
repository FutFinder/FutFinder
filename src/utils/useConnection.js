import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

/**
 * Estado de conexión del chat: 'online' | 'reconnecting' | 'offline'.
 *
 * El proyecto no trae `@react-native-community/netinfo` y no vale la pena
 * sumar una dependencia solo para esto, así que la señal se arma con lo que
 * ya hay:
 *
 *   - En web, `navigator.onLine` más los eventos online/offline.
 *   - En nativo, el estado del canal Realtime de Supabase, que es justamente
 *     lo que importa para el chat: si el websocket se cayó, los mensajes
 *     nuevos no van a llegar aunque el teléfono tenga datos.
 *
 * `reportChannelStatus` se le pasa a `subscribeToMessages({ onStatus })`.
 */
export default function useConnection() {
  const [browserOnline, setBrowserOnline] = useState(() => {
    if (Platform.OS !== 'web') return true;
    return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  });
  const [channelDown, setChannelDown] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
    const up = () => setBrowserOnline(true);
    const down = () => setBrowserOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  const reportChannelStatus = useCallback((status) => {
    if (status === 'SUBSCRIBED') setChannelDown(false);
    else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setChannelDown(true);
  }, []);

  const connection = !browserOnline ? 'offline' : channelDown ? 'reconnecting' : 'online';

  return { connection, isOffline: connection === 'offline', reportChannelStatus };
}
