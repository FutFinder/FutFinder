/**
 * Crear un recinto, y en qué estado está para salir a la app.
 *
 * DOS PUERTAS DISTINTAS Y SE CONFUNDEN FÁCIL. Para CREAR un recinto hace
 * falta una autorización que da FutFinder de a una (migración 82). Para
 * PUBLICARLO hace falta, además, que FutFinder lo revise. Son dos permisos
 * separados: tener el primero no acerca al segundo.
 *
 * La validación de acá es la MISMA que hace el servidor, y está duplicada a
 * propósito: sin ella la persona llena el formulario, toca guardar y recién
 * ahí se entera de que faltaba el punto en el mapa. El servidor sigue siendo
 * el que manda — esto solo evita el viaje.
 */

/** Chile continental, insular y austral. */
const LAT_MIN = -56;
const LAT_MAX = -17;
const LNG_MIN = -110;
const LNG_MAX = -66;

/**
 * Qué le falta al formulario, en el orden en que conviene decirlo.
 *
 * Devuelve la lista de problemas, vacía si está listo. Una lista y no un
 * booleano porque la pantalla tiene que poder señalar el campo.
 */
export function problemasDelRecinto({ nombre, comuna, latitud, longitud } = {}) {
  const problemas = [];
  if (!String(nombre || '').trim()) problemas.push({ campo: 'nombre', texto: 'Ponle un nombre al recinto.' });
  if (!String(comuna || '').trim()) {
    problemas.push({ campo: 'direccion', texto: 'Elige la dirección del buscador: de ahí sale la comuna.' });
  } else if (!coordenadasDeChile(latitud, longitud)) {
    // Si hay comuna pero no punto, la dirección se escribió a mano o se
    // editó después de elegirla, y las coordenadas dejaron de valer.
    problemas.push({
      campo: 'direccion',
      texto: 'Elige la dirección del buscador para fijar el punto en el mapa.',
    });
  }
  return problemas;
}

export function recintoListo(borrador) {
  return problemasDelRecinto(borrador).length === 0;
}

/** El mismo rango que comprueba el servidor antes de aceptar el recinto. */
export function coordenadasDeChile(lat, lng) {
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return a >= LAT_MIN && a <= LAT_MAX && b >= LNG_MIN && b <= LNG_MAX;
}

/**
 * En qué punto del camino a publicar está el recinto.
 *
 * Cinco estados y no un par de booleanos sueltos, porque la pantalla tiene
 * que decir una cosa distinta en cada uno y con banderas sueltas se terminan
 * mostrando dos mensajes contradictorios a la vez.
 */
export function estadoDePublicacion(recinto, canchas = []) {
  if (!recinto) return 'sin_canchas';
  if (recinto.publicado) return 'publicado';

  const listaParaAtender = (canchas || []).some((k) => k.activa && k.tiene_horario);
  if (!listaParaAtender) return canchas.length === 0 ? 'sin_canchas' : 'sin_horario';

  if (recinto.aprobado_futfinder) return 'listo_para_publicar';
  return recinto.revision_pedida_at ? 'en_revision' : 'listo_para_revision';
}

const TEXTOS = {
  sin_canchas: {
    titulo: 'Todavía no apareces en la app',
    cuerpo: 'Carga tu primera cancha con su horario de atención. Después FutFinder revisa el recinto '
      + 'y lo publicamos.',
  },
  sin_horario: {
    titulo: 'Todavía no apareces en la app',
    cuerpo: 'Necesitas al menos una cancha activa con horario de atención cargado.',
  },
  listo_para_revision: {
    titulo: 'Listo para que lo revisemos',
    cuerpo: 'Ya tienes una cancha activa con horario. Mándanos el recinto a revisión: miramos los '
      + 'datos y te avisamos. Publicar pasa por nosotros.',
  },
  en_revision: {
    titulo: 'Lo estamos revisando',
    cuerpo: 'Recibimos tu recinto y lo estamos mirando. Te avisamos apenas quede aprobado; mientras '
      + 'tanto puedes seguir cargando canchas, horarios y precios.',
  },
  listo_para_publicar: {
    titulo: 'Aprobado, y todavía sin publicar',
    cuerpo: 'FutFinder ya revisó tu recinto. Cuando publiques vas a aparecer en el buscador y '
      + 'cualquiera podrá reservar tus horas disponibles.',
  },
  publicado: {
    titulo: 'Estás recibiendo reservas',
    cuerpo: 'Apareces en el buscador y cualquiera puede reservar tus canchas disponibles.',
  },
};

export function textoDeEstado(estado) {
  return TEXTOS[estado] || TEXTOS.sin_canchas;
}
