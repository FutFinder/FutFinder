import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Cuenta recordada en ESTE dispositivo, para el atajo "cuenta guardada" de
 * IniciarSesión (handoff `Bienvenida.dc.html`, pantalla 2C).
 *
 * Guarda solo email + username — nunca la contraseña. No es sesión (eso ya
 * lo persiste `supabase.js` con `persistSession: true`); es apenas una
 * comodidad para no reescribir el correo la próxima vez que alguien abre la
 * app en este teléfono. Si nadie inició sesión nunca en este dispositivo, no
 * hay nada guardado — la pantalla no debe mostrar un dato inventado en ese
 * caso, solo omitir el atajo.
 */
const KEY = 'futfinder.rememberedAccount';

export async function saveRememberedAccount({ email, username }) {
  if (!email) return;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ email, username: username || null }));
  } catch {
    // No es crítico: en el peor caso, la próxima vez no aparece el atajo.
  }
}

export async function getRememberedAccount() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.email ? parsed : null;
  } catch {
    return null;
  }
}
