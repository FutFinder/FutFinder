/**
 * Derivación de la portada de Clubes: convierte lo que devuelven siete
 * servicios en la lista de tareas que ve el usuario, y calcula los números
 * que la acompañan.
 *
 * POR QUÉ ESTÁ SEPARADO DEL HOOK. Acá no hay red ni React: entra un objeto de
 * fuentes y sale una lista. Eso permite probar las reglas que de verdad se
 * rompen —el badge, el «ver más», los cupos y los permisos— sin levantar
 * Supabase ni montar una pantalla.
 *
 * LA REGLA QUE MÁS SE EQUIVOCA: el badge cuenta tareas CON ACCIÓN. Una tarea
 * vencida sigue en pantalla un rato para explicar qué pasó, pero no suma; una
 * tarea resuelta ni siquiera se dibuja, porque salió bien y no hay nada que
 * hacer con ella. El badge de la sección y el de la barra inferior usan este
 * mismo número.
 */

import { ESTADOS_CERRADOS } from '../services/clubChallengeRules.js';
import { CLUB_LIMITS } from './clubPlanLimits.js';

/** Prioridad de la lista: es el orden del handoff, no alfabético. */
const ORDEN = ['desafio', 'propuesta', 'cambio', 'nomina', 'solicitud', 'sancion', 'partido'];

const TOPE_VISIBLE = 4;

/**
 * ESTADOS TERMINALES, UNO POR TABLA.
 *
 * Antes había un solo conjunto para las tres, y las tres usan vocabularios
 * distintos: una propuesta se `caducada` en femenino, un cambio se `caducado`
 * en masculino y un desafío se queda `sin_acuerdo`. Ninguno de esos tres
 * entraba, así que esas tareas quedaban abiertas para siempre y el badge las
 * contaba — justo lo que este archivo dice defender.
 *
 * Los valores salen del `check (estado in (...))` de cada migración:
 *   club_challenges           → 41_desafios_estados_y_chat.sql:38-55
 *   club_challenge_proposals  → 43_desafios_plazos_y_propuesta.sql:157
 *   club_match_changes        → 46_cambios_de_partido.sql:102
 *
 * SALIÓ BIEN NO ES LO MISMO QUE VENCIÓ. Un cambio `aceptado` se aplicó, una
 * propuesta `aprobada` publicó su partido y un desafío `finalizado` se jugó.
 * Pintarlos «vencida» diría que algo falló. Esas tareas se retiran de la
 * lista: ya no hay nada que mirar ahí.
 */
const RESUELTOS = {
  desafio: new Set([
    'finalizado',
    // Legado anterior a la migración 41: alguien ya aceptó el desafío, así
    // que la tarea «Desafío recibido / Responder» no tiene qué responder.
    'aceptado',
  ]),
  propuesta: new Set(['aprobada']),
  cambio: new Set(['aceptado']),
};

/**
 * Lo terminal que NO salió bien.
 *
 * Para el desafío se deriva de `ESTADOS_CERRADOS`, la lista que ya mantiene
 * la máquina de estados en `clubChallengeRules.js`: si una migración cierra
 * un estado nuevo, esto lo hereda en vez de quedarse atrás en silencio.
 *
 * `bloqueado_sancion` y `resultado_en_disputa` no están acá a propósito: no
 * son terminales —retirar la sanción devuelve el desafío al estado en que
 * estaba— y darlos por vencidos escondería un desafío que sigue vivo.
 */
const VENCIDOS = {
  desafio: new Set(ESTADOS_CERRADOS.filter((e) => !RESUELTOS.desafio.has(e))),
  propuesta: new Set(['rechazada', 'caducada']),
  cambio: new Set(['rechazado', 'caducado']),
};

/**
 * CÓMO SE LEE UNA TARJETA VENCIDA.
 *
 * Apagarla al 55 % y cambiarle el botón por un chip «Expiró» no arregla que
 * el texto siga siendo el de una tarea pendiente. Un desafío cerrado sin
 * acuerdo se titulaba «Desafío recibido» —lo que invita a responder algo que
 * ya no existe— y una propuesta caducada se titulaba, literalmente,
 * «Propuesta pendiente» junto al chip que dice que expiró.
 *
 * El título nombra el ESTADO, no el tipo de tarea, y cada cierre tiene el
 * suyo: si los cuatro dijeran «Desafío cerrado», la tarjeta explicaría menos
 * que el chip. El subtítulo cuenta qué pasó, sin verbos de acción.
 *
 * El respaldo por dominio existe porque `VENCIDOS.desafio` se DERIVA de
 * `ESTADOS_CERRADOS`: una migración puede añadir un cierre nuevo sin que
 * nadie escriba su texto, y ese día la tarjeta tiene que decir algo cierto.
 */
const VENCIDO = {
  desafio: {
    sin_acuerdo: { title: 'Desafío sin acuerdo', subtitle: 'La negociación se cerró sin acuerdo' },
    expirado: { title: 'Desafío expirado', subtitle: 'Nadie respondió dentro del plazo' },
    rechazado: { title: 'Desafío rechazado', subtitle: 'El desafío no se aceptó' },
    cancelado: { title: 'Desafío cancelado', subtitle: 'El encuentro se canceló' },
  },
  propuesta: {
    rechazada: {
      title: 'Propuesta rechazada',
      subtitle: 'El rival no aceptó la propuesta oficial',
    },
    // No nace del cableado —ver `propuestasParaTareas()`—, pero el estado
    // existe en la migración 43 y la tarjeta tiene que saber decirlo.
    caducada: { title: 'Propuesta caducada', subtitle: 'Se aprobó otra propuesta del desafío' },
  },
  cambio: {
    caducado: { title: 'Cambio sin respuesta', subtitle: 'El plazo se cumplió sin que nadie contestara' },
    rechazado: { title: 'Cambio rechazado', subtitle: 'El cambio no se aceptó' },
  },
};

const VENCIDO_RESPALDO = {
  desafio: { title: 'Desafío cerrado', subtitle: 'El desafío ya no sigue en curso' },
  propuesta: { title: 'Propuesta cerrada', subtitle: 'La propuesta ya no está vigente' },
  cambio: { title: 'Cambio cerrado', subtitle: 'La solicitud ya no está vigente' },
};

/** El título y la línea de una tarea vencida, o `null` si no lo está. */
function textoVencido(dominio, estado, status) {
  if (status !== 'vencida') return null;
  return VENCIDO[dominio]?.[estado] || VENCIDO_RESPALDO[dominio];
}

/**
 * En qué situación está una tarea: `'abierta'`, `'vencida'` o `'resuelta'`.
 *
 * `dominio` es cuál de las tres tablas manda. Sin él no se puede responder:
 * `'aceptado'` cierra bien un cambio de partido y `'rechazado'` cierra mal un
 * desafío, pero ninguno de los dos significa nada en la otra tabla.
 *
 * Un estado desconocido cuenta como `'abierta'`: preferimos mostrar de más a
 * esconder algo que el usuario todavía puede accionar.
 */
export function estadoDeTarea(dominio, estado) {
  if (RESUELTOS[dominio]?.has(estado)) return 'resuelta';
  if (VENCIDOS[dominio]?.has(estado)) return 'vencida';
  return 'abierta';
}

/** Lo resuelto no se dibuja: salió bien y no hay nada que hacer con ello. */
function agregarSiQuedaAlgo(tareas, tarea) {
  if (tarea.status !== 'resuelta') tareas.push(tarea);
}

/**
 * ¿Hay cupos que confirmar, y los números para decirlo?
 *
 * La tarea de nómina promete «9 de 11 cupos confirmados», así que sin dos
 * cuentas de verdad no se dibuja: `null < 11` es `true` en JavaScript y sin
 * esta guardia la tarjeta salía con la palabra «null» adentro.
 *
 * `cupos` en 0 o nulo tampoco es «un partido sin cupos»: la migración 43
 * (`check (cupos_por_club between 4 and 15)`, línea 177) no admite esos
 * valores, y `resumenNomina()` devuelve 0 justamente cuando `cupos_por_club`
 * no era un número. Es un dato que llegó a medias, y ante eso callamos en vez
 * de inventar una cifra.
 */
function esCuenta(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

function nominaAccionable(nomina) {
  if (!nomina) return false;
  if (!esCuenta(nomina.cupos) || nomina.cupos <= 0) return false;
  if (!esCuenta(nomina.confirmados)) return false;
  return nomina.confirmados < nomina.cupos;
}

/** El CTA depende del rol: el jugador ve, el admin resuelve. */
function accion(esAdmin, etiquetaAdmin) {
  return esAdmin ? etiquetaAdmin : 'Ver';
}

/**
 * El jugador necesita saber por qué no puede accionar.
 *
 * Salvo cuando ya no hay nada que accionar: en una tarea vencida el botón no
 * falta por su rol —tampoco lo tiene el admin—, y mandarlo a buscar a alguien
 * que tampoco puede hacer nada es justo la promesa vacía que estas tarjetas
 * existen para no hacer.
 */
function coletilla(esAdmin, subtitulo, status = 'abierta') {
  if (esAdmin || status !== 'abierta') return subtitulo;
  return `${subtitulo} · responde un admin`;
}

/**
 * Días de calendario entre dos instantes, en hora local.
 *
 * No son bloques de 24 horas: un partido de esta noche es «hoy» aunque
 * falten once horas, y uno de mañana temprano es «mañana» aunque falten
 * nueve. Es lo que dice la gente, y contar por bloques daba «en 1 días»
 * para un partido de esta tarde.
 *
 * `Math.round` y no una división directa porque un día con cambio de hora
 * dura 23 o 25 horas.
 */
function diasDeCalendario(fecha, ahora) {
  const a = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  const b = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/**
 * Cuánto falta para el próximo partido: `'sin_fecha'`, `'pasado'` o los días
 * que quedan.
 *
 * `'pasado'` se mide con el instante exacto, no con el día: un partido de
 * hoy a las 08:00 visto a las 09:00 ya empezó, aunque sea el mismo día.
 */
export function plazoDePartido(iso, ahora = new Date()) {
  const t = new Date(iso);
  if (!Number.isFinite(t.getTime())) return { tipo: 'sin_fecha' };
  if (t.getTime() <= ahora.getTime()) return { tipo: 'pasado' };
  return { tipo: 'futuro', dias: diasDeCalendario(t, ahora) };
}

/**
 * El plazo en palabras: `'hoy'`, `'mañana'` o `'en N días'`. `null` si el
 * partido ya pasó o no tiene fecha usable.
 *
 * Es la única cuenta de días que se redacta, y de ella salen las dos cosas
 * que la ven: el título de la tarea y la pastilla de la tarjeta destacada.
 * Separarlas era cómo terminaban diciendo plazos distintos del mismo partido.
 */
function plazoEnPalabras(plazo) {
  if (!plazo || plazo.tipo !== 'futuro') return null;
  if (plazo.dias <= 0) return 'hoy';
  if (plazo.dias === 1) return 'mañana';
  return `en ${plazo.dias} días`;
}

/** El título del próximo partido, ya resuelto el singular y el plural. */
function tituloPartido(plazo) {
  const palabras = plazoEnPalabras(plazo);
  return palabras ? `Próximo partido ${palabras}` : 'Próximo partido';
}

/**
 * El mismo plazo en corto y en mayúsculas, para la pastilla de
 * `NextMatchCard`: `'HOY'`, `'MAÑANA'`, `'EN 4 DÍAS'`.
 *
 * Se exporta en vez de dejar que la pantalla recorte el título con una
 * expresión regular. Un recorte se rompe en silencio en cuanto el título
 * cambia; esto rompe una prueba.
 */
export function etiquetaPlazo(plazo) {
  const palabras = plazoEnPalabras(plazo);
  return palabras ? palabras.toUpperCase() : null;
}

/**
 * Normaliza las siete fuentes a una lista de tareas ordenada por prioridad.
 *
 * `rol` decide dos cosas: la etiqueta del botón y si la tarea se muestra —las
 * solicitudes de ingreso solo existen para un admin, porque un jugador no
 * tiene nada que hacer con ellas.
 */
export function normalizarTareas(fuentes, { rol, ahora = new Date() } = {}) {
  const f = fuentes || {};
  const esAdmin = rol === 'admin';
  const tareas = [];

  for (const d of f.desafiosRecibidos || []) {
    const status = estadoDeTarea('desafio', d.estado);
    const cerrado = textoVencido('desafio', d.estado, status);
    agregarSiQuedaAlgo(tareas, {
      id: `desafio:${d.id}`,
      type: 'desafio',
      tone: 'accent',
      title: cerrado ? cerrado.title : 'Desafío recibido',
      // Con el título contando el estado, lo útil acá es con quién era. Dos
      // desafíos cerrados el mismo día serían la misma tarjeta sin esto.
      subtitle: cerrado
        ? d.otroClub?.nombre || cerrado.subtitle
        : coletilla(esAdmin, d.otroClub?.nombre || 'Un club te desafió', status),
      cta: cerrado ? null : accion(esAdmin, 'Responder'),
      target: 'ClubChallenges',
      status,
    });
  }

  for (const p of f.propuestas || []) {
    const status = estadoDeTarea('propuesta', p.estado);
    const cerrada = textoVencido('propuesta', p.estado, status);
    agregarSiQuedaAlgo(tareas, {
      id: `propuesta:${p.id}`,
      type: 'propuesta',
      tone: 'info',
      title: cerrada ? cerrada.title : 'Propuesta pendiente',
      subtitle: cerrada
        ? cerrada.subtitle
        : coletilla(esAdmin, 'Fecha, lugar y modalidad por confirmar', status),
      cta: cerrada ? null : accion(esAdmin, 'Revisar'),
      target: 'ClubChallenges',
      status,
    });
  }

  for (const c of f.cambiosDePartido || []) {
    const status = estadoDeTarea('cambio', c.estado);
    const cerrado = textoVencido('cambio', c.estado, status);
    agregarSiQuedaAlgo(tareas, {
      id: `cambio:${c.id}`,
      type: 'cambio',
      tone: 'warn',
      title: cerrado ? cerrado.title : 'Cambio de partido',
      subtitle: cerrado
        ? cerrado.subtitle
        : coletilla(esAdmin, 'El rival propuso mover el encuentro', status),
      cta: cerrado ? null : accion(esAdmin, 'Responder'),
      target: 'ClubMatchChange',
      status,
    });
  }

  if (nominaAccionable(f.nomina)) {
    tareas.push({
      id: `nomina:${f.nomina.matchId}`,
      type: 'nomina',
      tone: 'info',
      title: 'Jugadores por confirmar',
      // Esta la ven igual los dos: cualquiera confirma su propia asistencia.
      subtitle: `${f.nomina.confirmados} de ${f.nomina.cupos} cupos confirmados`,
      cta: 'Ver nómina',
      target: 'ClubMatchRoster',
      status: 'abierta',
    });
  }

  if (esAdmin) {
    for (const s of f.solicitudes || []) {
      tareas.push({
        id: `solicitud:${s.request_id}`,
        type: 'solicitud',
        tone: 'warn',
        title: 'Solicitud de ingreso',
        subtitle: `${s.username || 'Un jugador'} quiere entrar al club`,
        cta: 'Revisar',
        target: 'ClubMembers',
        status: 'abierta',
      });
    }
  }

  if (f.sancion) {
    tareas.push({
      id: `sancion:${f.sancion.id}`,
      type: 'sancion',
      tone: 'danger',
      title: 'Sanción en revisión',
      subtitle: coletilla(esAdmin, 'Afecta a los próximos desafíos del club'),
      cta: accion(esAdmin, 'Revisar'),
      target: 'ClubDetail',
      status: 'abierta',
    });
  }

  if (f.proximoPartido) {
    const plazo = plazoDePartido(f.proximoPartido.hora, ahora);
    // Un partido que ya empezó no es una tarea pendiente: anunciarlo como
    // «el próximo» manda al usuario a algo que no va a alcanzar.
    if (plazo.tipo !== 'pasado') {
      tareas.push({
        id: `partido:${f.proximoPartido.id}`,
        type: 'partido',
        tone: 'accent',
        title: tituloPartido(plazo),
        subtitle: 'Revisa la nómina y confirma tu asistencia',
        cta: 'Ir ahora',
        target: 'ClubMatchRoster',
        status: 'abierta',
      });
    }
  }

  // EL ORDEN, Y SU DESEMPATE. Entre tipos manda `ORDEN`. Dentro de un tipo
  // manda el orden en que vino la fuente —que es el que ya trae el servidor—
  // porque `Array.prototype.sort` es estable desde ES2019 y no reordena lo
  // que empata. Hay pruebas que lo fijan: si alguien cambia el comparador por
  // uno que desempate solo, se entera.
  //
  // El estado NO entra en el orden. Hundir lo vencido al fondo parece
  // amable, pero con el tope de cuatro visibles escondería tareas
  // accionables detrás de avisos muertos.
  return tareas.sort((a, b) => ORDEN.indexOf(a.type) - ORDEN.indexOf(b.type));
}

/**
 * Cuántas tareas puede accionar el usuario ahora mismo.
 * Es EL número del badge de la sección y el de la barra inferior: si se
 * calcularan por separado, tarde o temprano dirían cosas distintas.
 */
export function contarConAccion(tareas) {
  return (tareas || []).filter((t) => t.status === 'abierta').length;
}

/**
 * El badge, ya rotulado. Un solo sitio decide también el TEXTO.
 *
 * `contarConAccion()` garantizaba que la barra inferior y «Pendiente para ti»
 * contaran lo mismo, pero cada una escribía el rótulo por su cuenta:
 * `MainTabs` cortaba en `'9+'` y la portada pintaba el número entero. Con
 * doce pendientes la barra decía «9+» y la portada «12» — el mismo dato,
 * contado una vez, con dos rótulos que se contradicen a diez píxeles de
 * distancia.
 *
 * El tope es del rótulo, no del conteo: el número exacto sigue viajando en
 * `badgeCount` y es el que oye un lector de pantalla.
 */
export function etiquetaBadge(n) {
  const total = Number(n) || 0;
  return total > 9 ? '9+' : String(total);
}

/**
 * Reparte la lista entre lo que se ve y lo que queda tras el botón.
 *
 * El contador del botón cuenta TAREAS CON ACCIÓN ocultas, no tarjetas
 * ocultas: prometer «3 pendientes más» y mostrar tres avisos vencidos es
 * exactamente el error que el handoff pide no repetir.
 */
export function repartirTareas(tareas, { tope = TOPE_VISIBLE } = {}) {
  const lista = tareas || [];
  const visibles = lista.slice(0, tope);
  const ocultas = lista.slice(tope);
  const ocultasConAccion = contarConAccion(ocultas);

  let etiquetaVerMas = null;
  if (ocultas.length > 0) {
    etiquetaVerMas =
      ocultasConAccion > 0
        ? `Ver ${ocultasConAccion} ${ocultasConAccion === 1 ? 'pendiente' : 'pendientes'} más`
        : `Ver ${ocultas.length} ${ocultas.length === 1 ? 'aviso' : 'avisos'} más`;
  }

  return { visibles, ocultas, ocultasConAccion, etiquetaVerMas };
}

/**
 * Cupos del plan. `miembrosActivos` son integrantes de verdad: una solicitud
 * pendiente no ocupa cupo, o un club con espacio diría que está lleno.
 */
export function cuposDelPlan({ plan, miembrosActivos = 0, admins = 0 } = {}) {
  const limites = CLUB_LIMITS[plan] || CLUB_LIMITS.estandar;
  return {
    members: { used: miembrosActivos, max: limites.miembros },
    admins: { used: admins, max: limites.admins },
  };
}

/**
 * Qué puede hacer el usuario en este club. Un solo lugar decide.
 *
 * No hay rol de capitán: la migración 11 solo admite 'admin' y 'jugador'.
 * Cualquier otra cosa se trata como jugador — errar hacia «no puede» es el
 * lado seguro.
 */
export function permisosDeClub(rol) {
  const admin = rol === 'admin';
  return Object.freeze({
    responderDesafios: admin,
    gestionarMiembros: admin,
    editarClub: admin,
    eliminarClub: admin,
    cederAdmin: admin,
    invitar: admin,
  });
}
