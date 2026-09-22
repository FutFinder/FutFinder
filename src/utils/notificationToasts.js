/**
 * Cola de popups para notificaciones que llegan por Realtime mientras la
 * app está abierta — no confundir con `utils/avisos.js`, que es el mensaje
 * genérico de "tu acción falló/funcionó". Acá el disparador es un evento
 * externo (alguien más hizo algo), no algo que la persona acaba de tocar, y
 * cada item necesita su propio ícono/color por tipo y su propio destino de
 * navegación — por eso es una cola aparte y no una rama más de `avisos.js`.
 *
 * SE ENCOLA POR `id` DE LA NOTIFICACIÓN, NO POR CORRELATIVO. El canal
 * Realtime de `services/notifications.js` es compartido (un solo socket por
 * usuario para el badge, la bandeja y este popup): si dos suscriptores
 * distintos llegan a reencolar la misma fila, o si Realtime reentrega el
 * mismo INSERT, el segundo debe pisar al primero en vez de mostrar el mismo
 * aviso dos veces.
 *
 * SIN REACT ACÁ, mismo motivo que `avisos.js`: se prueba con `node --test`
 * sin montar nada. La pantalla solo se suscribe.
 */

let cola = [];
let suscriptores = [];

function avisar() {
  suscriptores.forEach((f) => f(cola));
}

/** Encola una notificación entrante. Si ya estaba encolada, la actualiza sin duplicarla. */
export function empujarToast(notificacion) {
  const id = notificacion?.id;
  if (!id) return null;
  const existe = cola.some((n) => n.id === id);
  cola = existe ? cola.map((n) => (n.id === id ? notificacion : n)) : [...cola, notificacion];
  avisar();
  return id;
}

/** Saca uno de la cola: al tocarlo, al cerrarlo, o cuando se le acaba el tiempo. */
export function quitarToast(id) {
  const antes = cola.length;
  cola = cola.filter((n) => n.id !== id);
  if (cola.length !== antes) avisar();
}

/** Lo que hay ahora. */
export function toastsActuales() {
  return cola;
}

/** Se suscribe a los cambios. Devuelve cómo desuscribirse. */
export function suscribirseAToasts(fn) {
  suscriptores = [...suscriptores, fn];
  fn(cola);
  return () => { suscriptores = suscriptores.filter((f) => f !== fn); };
}

/** Para las pruebas y para cuando se cierra sesión. */
export function limpiarToasts() {
  cola = [];
  avisar();
}

/** Cuánto dura en pantalla antes de irse solo. */
export const DURACION_TOAST_MS = 5000;
