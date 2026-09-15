/**
 * El Balance FutFinder visto por su dueño: cuánto hay y de dónde salió
 * cada peso.
 *
 * LAS PALABRAS SON DE ACÁ, NO DE LA BASE. `get_mi_balance` (migración 95)
 * devuelve datos —tipo, monto, nombre de la cancha, fecha— y la frase que
 * lee la persona se arma en este archivo, donde se prueba con `node --test`
 * y se corrige sin una migración.
 *
 * EL SIGNO YA VIENE EN EL MONTO. El libro guarda los cobros en negativo y
 * las cargas en positivo, con un CHECK que lo obliga (migración 56). Acá no
 * se vuelve a decidir el signo: se lee. Si esto lo recalculara, un día un
 * tipo de movimiento nuevo aparecería sumando cuando resta.
 */

/** Lo que dice cada movimiento, según de qué se trate. */
const TIPOS = {
  carga: { titulo: 'Cargaste saldo', tono: 'entra' },
  cobro_reserva: { titulo: 'Pagaste tu parte', tono: 'sale' },
  devolucion_cancelacion: { titulo: 'Te devolvimos', tono: 'entra' },
};

const METODOS = { tarjeta: 'con tarjeta', transferencia: 'por transferencia' };

/** Una fila de `get_mi_balance().movimientos` con nombres de pantalla. */
export function comoMovimiento(m) {
  if (!m) return null;
  const tipo = TIPOS[m.tipo] || { titulo: 'Movimiento', tono: m.monto < 0 ? 'sale' : 'entra' };
  return {
    id: m.id,
    tipo: m.tipo,
    monto: m.monto,
    entra: Number(m.monto) > 0,
    titulo: tipo.titulo,
    cuando: m.created_at,
    reservaId: m.reserva_id || null,
    cuandoTexto: fechaDeMovimiento(m.created_at),
    // El detalle es lo que convierte un «−$9.000» en algo reconocible.
    detalle: detalleDeMovimiento(m),
  };
}

/**
 * La línea de abajo: en qué cancha, o cómo se cargó.
 *
 * `null` cuando no hay nada que agregar — es preferible a inventar un
 * relleno como «Movimiento de balance», que ocupa lugar y no dice nada.
 */
export function detalleDeMovimiento(m) {
  if (!m) return null;
  if (m.tipo === 'carga') return METODOS[m.metodo_carga] || null;
  const partes = [m.cancha_nombre, m.complejo_nombre].filter(Boolean);
  // Un cobro cuya reserva ya no se puede leer no se queda mudo: al menos
  // dice que fue por una cancha.
  if (!partes.length) return m.reserva_id ? 'Reserva de cancha' : null;
  return partes.join(' · ');
}

/**
 * El total y su lista, listos para pintar.
 *
 * `saldo` null significa NO PUDE PREGUNTAR, y no cero: la pantalla tiene que
 * poder decir «no pudimos leer tu saldo» en vez de afirmar que no hay plata.
 * Es el mismo error que ya costó una vez —`Number(objeto)` daba NaN y se
 * mostraba $0 con la cuenta llena— y por eso acá es explícito.
 */
export function comoBalance(json) {
  if (!json || !json.ok) return null;
  const movimientos = (json.movimientos || []).map(comoMovimiento).filter(Boolean);
  const total = Number(json.total_movimientos);
  return {
    saldo: Number.isFinite(Number(json.saldo)) ? Number(json.saldo) : null,
    movimientos,
    totalMovimientos: Number.isFinite(total) ? total : movimientos.length,
    hayMas: Number.isFinite(total) && total > movimientos.length,
  };
}

/**
 * Si el saldo alcanza para un monto.
 *
 * Devuelve `null` cuando no se sabe el saldo, y eso NO es «no alcanza»:
 * quien llama debe tratar el null como «no bloquear». Con un `false` en su
 * lugar, un error de red apagaría el botón de pagar por una razón inventada
 * — que es exactamente lo que pasó antes de la corrección.
 */
export function alcanzaPara(saldo, monto) {
  // `Number(null)` y `Number('')` son 0, no NaN. Sin este corte, preguntar
  // «¿me alcanza para nada?» devolvía `true` y un monto que todavía no
  // llegó se leía como gratis. Es el mismo tropiezo que ya hubo con la
  // cuota, y por eso está escrito en las dos partes.
  const vacio = (x) => x === null || x === undefined || x === '';
  if (vacio(saldo) || vacio(monto)) return null;
  const s = Number(saldo);
  const m = Number(monto);
  if (!Number.isFinite(s) || !Number.isFinite(m)) return null;
  return s >= m;
}

/**
 * Cuándo ocurrió el movimiento, en hora de Chile.
 *
 * NO SE REUSA `fechaLarga`: esa solo entiende 'YYYY-MM-DD' y con una marca
 * de tiempo completa devuelve null — la línea desaparecía en silencio, que
 * es como se descubrió. Y no es solo un formato distinto: un movimiento es
 * un INSTANTE, no una fecha de calendario, y Chile está en UTC-3/-4, así
 * que interpretarlo en UTC muestra el día equivocado a cualquiera que cargue
 * saldo de noche.
 */
export function fechaDeMovimiento(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    // En Chile la hora se escribe de 0 a 23. Sin esto el locale devuelve
    // «11:12 p. m.», que en una app donde las canchas se arriendan por
    // bloques de hora se lee distinto de todo el resto de la interfaz.
    hour12: false,
  });
}

/** Por qué no se puede cargar saldo todavía. */
export const MOTIVO_SIN_CARGA =
  'Cargar saldo estará disponible cuando conectemos el medio de pago. '
  + 'Mientras tanto, tu saldo solo se mueve con las reservas que pagas.';
