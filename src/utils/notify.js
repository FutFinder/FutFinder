import { Alert, Platform } from 'react-native';

/**
 * notify(title, message)
 * Muestra un mensaje al usuario que funciona tanto en web como en móvil.
 * - Web: usa window.alert (Alert.alert de react-native NO funciona en web)
 * - iOS/Android: usa Alert.alert nativo
 */
export function notify(title, message = '') {
  // Loggear siempre para depuración
  console.log('[FutFinder notify]', title, message);

  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert(message ? `${title}\n\n${message}` : title);
    }
    return;
  }
  Alert.alert(title, message);
}
