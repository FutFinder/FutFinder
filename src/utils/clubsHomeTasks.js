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
 * resuelta o vencida sigue en pantalla un rato, pero no suma. El badge de la
 * sección y el de la barra inferior usan este mismo número.
 */

import { CLUB_LIMITS } from './clubPlanLimits.js';

/** Prioridad de la lista: es el orden del handoff, no alfabético. */
const ORDEN = ['desafio', 'propuesta', 'cambio', 'nomina', 'solicitud', 'sancion', 'partido'];

const TOPE_VISIBLE = 4;

/** Estados de la base que ya no admiten acción. */
const ESTADOS_MUERTOS = new Set(['expirado', 'cancelado', 'rechazado', 'aceptado']);

function estadoDeTarea(estado) {
  return ESTADOS_MUERTOS.has(estado) ? 'vencida' : 'abierta';
}

/** El CTA depende del rol: el jugador ve, el admin resuelve. */
function accion(esAdmin, etiquetaAdmin) {
  return esAdmin ? etiquetaAdmin : 'Ver';
}

/** El jugador necesita saber por qué no puede accionar. */
function coletilla(esAdmin, subtitulo) {
  return esAdmin ? subtitulo : `${subtitulo} · responde un admin`;
}

function diasHasta(iso, ahora) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.ceil((t - ahora.getTime()) / 86400000);
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
    tareas.push({
      id: `desafio:${d.id}`,
      type: 'desafio',
      tone: 'accent',
      title: 'Desafío recibido',
      subtitle: coletilla(esAdmin, d.otroClub?.nombre || 'Un club te desafió'),
      cta: accion(esAdmin, 'Responder'),
      target: 'ClubChallenges',
      status: estadoDeTarea(d.estado),
    });
  }

  for (const p of f.propuestas || []) {
    tareas.push({
      id: `propuesta:${p.id}`,
      type: 'propuesta',
      tone: 'info',
      title: 'Propuesta pendiente',
      subtitle: coletilla(esAdmin, 'Fecha, lugar y modalidad por confirmar'),
      cta: accion(esAdmin, 'Revisar'),
      target: 'ClubChallenges',
      status: estadoDeTarea(p.estado),
    });
  }

  for (const c of f.cambiosDePartido || []) {
    tareas.push({
      id: `cambio:${c.id}`,
      type: 'cambio',
      tone: 'warn',
      title: 'Cambio de partido',
      subtitle: coletilla(esAdmin, 'El rival propuso mover el encuentro'),
      cta: accion(esAdmin, 'Responder'),
      target: 'ClubMatchChange',
      status: estadoDeTarea(c.estado),
    });
  }

  if (f.nomina && f.nomina.confirmados < f.nomina.cupos) {
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
    const dias = diasHasta(f.proximoPartido.hora, ahora);
    tareas.push({
      id: `partido:${f.proximoPartido.id}`,
      type: 'partido',
      tone: 'accent',
      title: dias === null ? 'Próximo partido' : `Próximo partido en ${dias} días`,
      subtitle: 'Revisa la nómina y confirma tu asistencia',
      cta: 'Ir ahora',
      target: 'ClubMatchRoster',
      status: 'abierta',
    });
  }

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
