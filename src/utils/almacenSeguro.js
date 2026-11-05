/**
 * Dónde guarda supabase-js la sesión en el teléfono: el almacén seguro
 * (Keychain en iOS, Keystore en Android) y no `AsyncStorage`, que en nativo
 * es un archivo sin cifrar que cualquiera con acceso al respaldo o al
 * dispositivo desbloqueado puede leer, refresh token incluido.
 *
 * ── POR QUÉ EN TROZOS Y NO CIFRANDO ───────────────────────────────────────
 *
 * El almacén seguro acepta como mucho 2048 bytes por valor y la sesión de
 * Supabase suele pasarse (el JWT más el usuario con sus metadatos). Había dos
 * salidas: cifrar la sesión con una clave guardada en el almacén seguro y
 * dejar el texto cifrado en AsyncStorage, o partirla en trozos y guardarlos
 * todos en el almacén seguro. Se eligió la segunda: Hermes no trae AES, así
 * que cifrar exigía sumar una librería de criptografía y escribir a mano el
 * manejo de claves e IV. Partir en trozos no inventa criptografía: el cifrado
 * lo pone el sistema operativo, y la sesión nunca toca AsyncStorage.
 *
 * Cada valor se guarda como un índice `{ v, n, g }` bajo la clave, y los `n`
 * trozos bajo `<clave>.<g>.<i>`. `g` es una generación nueva en cada
 * escritura: se escriben los trozos nuevos, después el índice, y recién
 * entonces se borran los viejos, así que una escritura que se corta a la
 * mitad deja la sesión anterior entera, nunca una mezcla.
 *
 * ── LA MIGRACIÓN ──────────────────────────────────────────────────────────
 *
 * Quien ya tenía la app tiene la sesión en AsyncStorage. La primera lectura
 * que no encuentra nada en el almacén seguro mira ahí; si la encuentra, la
 * copia al almacén seguro, borra la vieja y la devuelve: la persona no se
 * entera. Si no se pudo copiar, NO se borra la vieja y se devuelve igual:
 * desloguear a alguien porque el llavero falló una vez sería peor.
 *
 * ── LOS FALLOS ────────────────────────────────────────────────────────────
 *
 * Nada de esto lanza. Un almacén que revienta, un trozo que falta o un
 * índice ilegible son «sin sesión» (`null`): supabase-js no encuentra sesión
 * y la app manda a Login. Nunca una pantalla en blanco ni un bucle. Lo roto
 * se limpia para que la próxima vez no se vuelva a tropezar con lo mismo.
 *
 * Sin React Native adentro (se le pasan los dos almacenes), para poder
 * probarlo con dobles en `node --test`.
 */

/** Bytes UTF-8 por trozo: debajo del tope de 2048 del almacén, con margen. */
export const TOPE_BYTES = 1800;

const VERSION = 1;

/** El almacén seguro sólo acepta claves con [A-Za-z0-9._-]. */
function claveSegura(clave) {
  return String(clave).replace(/[^\w.-]/g, '_');
}

function bytesDe(punto) {
  if (punto <= 0x7f) return 1;
  if (punto <= 0x7ff) return 2;
  if (punto <= 0xffff) return 3;
  return 4;
}

/**
 * Parte un texto en trozos de como mucho `TOPE_BYTES` bytes UTF-8, sin
 * cortar nunca un carácter (un emoji son dos unidades UTF-16: partirlo
 * dejaría un trozo con medio carácter, que el almacén guarda mal).
 */
export function partirEnTrozos(texto, tope = TOPE_BYTES) {
  const trozos = [];
  let actual = '';
  let bytes = 0;
  for (const caracter of String(texto)) {
    const b = bytesDe(caracter.codePointAt(0));
    if (bytes + b > tope && actual) {
      trozos.push(actual);
      actual = '';
      bytes = 0;
    }
    actual += caracter;
    bytes += b;
  }
  if (actual || trozos.length === 0) trozos.push(actual);
  return trozos;
}

let contador = 0;
function nuevaGeneracion() {
  contador = (contador + 1) % 1000;
  return `${Date.now().toString(36)}${contador.toString(36)}`;
}

function leerIndice(texto) {
  if (!texto) return null;
  try {
    const i = JSON.parse(texto);
    if (i && i.v === VERSION && Number.isInteger(i.n) && i.n > 0 && typeof i.g === 'string' && /^[\w-]+$/.test(i.g)) {
      return i;
    }
  } catch {
    // índice ilegible
  }
  return null;
}

/**
 * El adaptador con el contrato que espera supabase-js (`getItem`, `setItem`,
 * `removeItem`, todos async).
 *
 * @param {{ secureStore: object, asyncStorage: object, opciones?: object }} deps
 *   `secureStore` con `getItemAsync`/`setItemAsync`/`deleteItemAsync` (la API
 *   de expo-secure-store); `asyncStorage` con `getItem`/`removeItem`;
 *   `opciones` se pasa tal cual al almacén seguro (accesibilidad del llavero).
 */
export function crearAlmacenSeguro({ secureStore, asyncStorage, opciones = {} }) {
  const guardar = (k, v) => secureStore.setItemAsync(k, v, opciones);
  const leer = (k) => secureStore.getItemAsync(k, opciones);
  const borrar = (k) => secureStore.deleteItemAsync(k, opciones);

  async function borrarGeneracion(base, indice) {
    if (!indice) return;
    for (let i = 0; i < indice.n; i += 1) {
      try {
        await borrar(`${base}.${indice.g}.${i}`);
      } catch {
        // sigue con el resto
      }
    }
  }

  async function escribir(clave, valor) {
    const base = claveSegura(clave);
    let anterior = null;
    try {
      anterior = leerIndice(await leer(base));
    } catch {
      anterior = null;
    }
    const trozos = partirEnTrozos(valor);
    const g = nuevaGeneracion();
    for (let i = 0; i < trozos.length; i += 1) {
      await guardar(`${base}.${g}.${i}`, trozos[i]);
    }
    await guardar(base, JSON.stringify({ v: VERSION, n: trozos.length, g }));
    if (anterior && anterior.g !== g) await borrarGeneracion(base, anterior);
  }

  async function leerLegado(clave) {
    try {
      return await asyncStorage.getItem(clave);
    } catch {
      return null;
    }
  }

  // Al arrancar, supabase-js puede leer la sesión dos veces a la vez: una
  // sola migración por clave, o quedarían dos generaciones y una huérfana.
  const migrando = new Map();
  function migrar(clave) {
    if (!migrando.has(clave)) {
      migrando.set(clave, migrarUnaVez(clave).finally(() => migrando.delete(clave)));
    }
    return migrando.get(clave);
  }

  async function migrarUnaVez(clave) {
    const viejo = await leerLegado(clave);
    if (viejo === null || viejo === undefined) return null;
    try {
      await escribir(clave, viejo);
      try {
        await asyncStorage.removeItem(clave);
      } catch {
        // quedó una copia vieja; la próxima escritura o el cierre la borran
      }
    } catch (e) {
      console.warn('[FutFinder] almacén seguro: no se pudo migrar la sesión, se sigue con la anterior:', e?.message || e);
    }
    return viejo;
  }

  return {
    async getItem(clave) {
      const base = claveSegura(clave);
      let crudo;
      try {
        crudo = await leer(base);
      } catch (e) {
        // El llavero no responde (o la clave del Keystore se perdió): si
        // todavía hay una sesión sin migrar se usa; si no, «sin sesión».
        console.warn('[FutFinder] almacén seguro: no se pudo leer:', e?.message || e);
        return leerLegado(clave);
      }
      if (crudo === null || crudo === undefined) return migrar(clave);

      const indice = leerIndice(crudo);
      if (!indice) {
        try { await borrar(base); } catch { /* nada más que hacer */ }
        return null;
      }
      try {
        const partes = [];
        for (let i = 0; i < indice.n; i += 1) {
          const trozo = await leer(`${base}.${indice.g}.${i}`);
          if (trozo === null || trozo === undefined) throw new Error(`falta el trozo ${i}`);
          partes.push(trozo);
        }
        return partes.join('');
      } catch (e) {
        console.warn('[FutFinder] almacén seguro: sesión incompleta, se descarta:', e?.message || e);
        await borrarGeneracion(base, indice);
        try { await borrar(base); } catch { /* nada más que hacer */ }
        return null;
      }
    },

    async setItem(clave, valor) {
      try {
        await escribir(clave, valor);
        // Si quedaba una copia sin migrar, ya sobra.
        try { await asyncStorage.removeItem(clave); } catch { /* no importa */ }
      } catch (e) {
        // No se cae a AsyncStorage a propósito: eso volvería a dejar la
        // sesión sin cifrar. Lo peor que pasa es pedir Login de nuevo.
        console.warn('[FutFinder] almacén seguro: no se pudo guardar la sesión:', e?.message || e);
      }
    },

    async removeItem(clave) {
      const base = claveSegura(clave);
      try {
        const indice = leerIndice(await leer(base));
        await borrarGeneracion(base, indice);
        await borrar(base);
      } catch {
        // si el llavero no responde, no hay nada que borrar que se pueda leer
      }
      try { await asyncStorage.removeItem(clave); } catch { /* no importa */ }
    },
  };
}
