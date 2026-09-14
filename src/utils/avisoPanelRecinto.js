import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Si ya se mostró el aviso de bienvenida del panel de UN recinto.
 *
 * Por recinto y no por cuenta: alguien con dos complejos creó el segundo
 * mucho después y necesita la misma orientación, aunque para el primero ya
 * sepa de memoria qué sigue.
 *
 * Vive en el teléfono y no en la base a propósito. Es una comodidad de
 * interfaz, no un dato del negocio: si alguien cambia de teléfono y lo ve una
 * vez más, no pasa nada; guardarlo en el servidor obligaría a una tabla y una
 * RPC para algo que no le importa a nadie más.
 */
const PREFIJO = 'futfinder.panelRecintoBienvenida.';

export async function bienvenidaVista(complejoId) {
  if (!complejoId) return true;
  try {
    return (await AsyncStorage.getItem(PREFIJO + complejoId)) === '1';
  } catch {
    // Si el almacenamiento falla, se muestra: es mejor repetir un aviso que
    // dejar a alguien sin saber por dónde empezar.
    return false;
  }
}

export async function marcarBienvenidaVista(complejoId) {
  if (!complejoId) return;
  try {
    await AsyncStorage.setItem(PREFIJO + complejoId, '1');
  } catch {
    // En el peor caso vuelve a aparecer la próxima vez.
  }
}
