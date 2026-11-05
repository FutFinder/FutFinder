import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // No tirar error en producción, sólo aviso. Las pantallas mostrarán placeholders.
  console.warn(
    '⚠️  Faltan EXPO_PUBLIC_SUPABASE_URL o EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Crea un archivo .env (ver .env.example).'
  );
}

/**
 * Cliente único de Supabase.
 * - En web usa localStorage por defecto (no necesitamos pasar storage)
 * - En nativo usa AsyncStorage para persistir la sesión
 */
export const supabase = createClient(
  SUPABASE_URL || 'http://placeholder.supabase.co',
  SUPABASE_ANON_KEY || 'placeholder-key',
  {
    auth: {
      storage: Platform.OS === 'web' ? undefined : AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: Platform.OS === 'web',
    },
  }
);

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/**
 * Un cliente aparte, sin sesión guardada, para comprobar una contraseña.
 *
 * `signInWithPassword` REEMPLAZA la sesión del cliente. Con la verificación
 * en dos pasos eso es un problema: volver a entrar «sólo para confirmar la
 * contraseña» devuelve una sesión `aal1` y deja a la persona fuera de su
 * propia cuenta. Un cliente efímero comprueba la contraseña sin tocar la
 * sesión de verdad.
 */
export function crearClienteEfimero() {
  return createClient(
    SUPABASE_URL || 'http://placeholder.supabase.co',
    SUPABASE_ANON_KEY || 'placeholder-key',
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: 'futfinder-comprobar-password',
      },
    }
  );
}
