/**
 * La cola de avisos de la app.
 *
 * POR QUÉ EXISTE: `notify()` usaba `window.alert` en web, y en la app web
 * está SUPRIMIDO — devuelve en 3 milisegundos sin mostrar nada. Eran 17
 * mensajes, casi todos errores («No pudimos cargar más», «No pudimos cambiar
 * el silencio»), que la persona nunca veía: tocaba algo, fallaba, y no
 * aparecía nada. La única conclusión posible era que la app está rota.
 *
 * `Alert.alert` de React Native tampoco funciona en web, así que la única
 * salida que anda en los tres lados es un aviso propio de la app.
 *
 * ES UNA COLA Y NO UN SOLO AVISO. Dos errores seguidos —pasa cuando algo de
 * red falla— no pueden pisarse: el segundo tapaba al primero y el primero
 * nunca se leía. Se muestran uno tras otro.
 *
 * SIN REACT ACÁ. Esto es una lista y dos funciones, así que se prueba con
 * `node --test` sin montar nada. La pantalla solo se suscribe.
 */

let cola = [];
let suscriptores = [];
let siguienteId = 1;

function avisar() {
  suscriptores.forEach((f) => f(cola));
}

/** Encola un aviso y devuelve su id. */
export function empujarAviso(titulo, mensaje = '', tono = 'info') {
  const t = String(titulo || '').trim();
  // Un aviso sin título no dice nada: encolarlo sería pintar un rectángulo
  // vacío encima de la pantalla.
  if (!t) return null;
  const aviso = { id: siguienteId, titulo: t, mensaje: String(mensaje || ''), tono };
  siguienteId += 1;
  cola = [...cola, aviso];
  avisar();
  return aviso.id;
}

/** Saca uno de la cola: al tocarlo, o cuando se le acaba el tiempo. */
export function quitarAviso(id) {
  const antes = cola.length;
  cola = cola.filter((a) => a.id !== id);
  if (cola.length !== antes) avisar();
}

/** Lo que hay ahora. */
export function avisosActuales() {
  return cola;
}

/** Se suscribe a los cambios. Devuelve cómo desuscribirse. */
export function suscribirseAAvisos(fn) {
  suscriptores = [...suscriptores, fn];
  fn(cola);
  return () => { suscriptores = suscriptores.filter((f) => f !== fn); };
}

/** Para las pruebas y para cuando se cierra sesión. */
export function limpiarAvisos() {
  cola = [];
  avisar();
}

/**
 * Cuánto dura en pantalla.
 *
 * Un error necesita más tiempo que un «listo»: hay que leerlo y a veces
 * decidir qué hacer. Y ninguno se va tan rápido como para que alguien
 * mirando el teclado se lo pierda.
 */
export function duracionDeAviso(tono) {
  return tono === 'error' ? 6000 : 3500;
}
