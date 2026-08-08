import Constants from 'expo-constants';

/**
 * Versión real de la app, tomada de la configuración de Expo
 * (`app.config.js` → `expo.version`), no un número escrito a mano que se
 * puede desincronizar del que de verdad se publica.
 *
 * `null` si por algún motivo Constants no trae la config (no debería pasar
 * en un build normal) — mejor mostrar nada que un número inventado.
 */
export const APP_VERSION = Constants.expoConfig?.version ?? null;
