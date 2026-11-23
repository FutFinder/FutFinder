/**
 * Cancelar un partido con motivo sin dejar el motivo huérfano.
 *
 * Vive acá, sin Supabase, para poder probarse: `matches.js` arrastra el
 * cliente. El servicio le pasa las tres operaciones reales.
 *
 * ── POR QUÉ EL MOTIVO SE ESCRIBE ANTES ────────────────────────────────────
 *
 * `cancel_match` (migración 134) lee `matches.motivo_cancelacion` para el
 * aviso a los jugadores: «fue cancelado. Motivo: …». Si se escribiera
 * después, el aviso saldría sin motivo. Así que el orden se queda; lo que
 * cambia es que ahora se deshace.
 *
 * ── EL FALLO ──────────────────────────────────────────────────────────────
 *
 * Si la RPC fallaba —no eres el organizador, es un encuentro entre clubes,
 * sin red— el motivo quedaba escrito en un partido que seguía vivo, y su
 * detalle mostraba «Motivo del organizador». Tampoco se miraba si la
 * escritura del motivo había fallado: se cancelaba sin él, en silencio.
 *
 * Ahora: se lee el motivo que había, se escribe el nuevo (y si no se puede,
 * no se cancela), se cancela, y si la cancelación falla se restaura el de
 * antes.
 */

const SIN_MOTIVO = 'No pudimos guardar el motivo de la cancelación. Intenta de nuevo.';

export async function cancelarConMotivo({ motivo, leerMotivo, escribirMotivo, cancelar }) {
  const texto = typeof motivo === 'string' ? motivo.trim() : motivo;
  if (!texto) return cancelar();

  const previo = await leerMotivo();
  if (previo?.error) return { ok: false, reason: SIN_MOTIVO };

  const escrito = await escribirMotivo(texto);
  if (escrito?.error) return { ok: false, reason: SIN_MOTIVO };

  let res;
  try {
    res = await cancelar();
  } catch (e) {
    res = { ok: false, reason: e?.message || 'No pudimos cancelar el partido.' };
  }
  if (res?.ok) return res;

  const deshecho = await escribirMotivo(previo?.data ?? null);
  if (deshecho?.error) {
    console.error('[FutFinder] cancelarConMotivo: no se pudo restaurar el motivo', deshecho.error);
  }
  return res;
}
