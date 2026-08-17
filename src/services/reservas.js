/**
 * Servicio del vertical Reservas (handoff `Reservas.dc.html`).
 *
 * Backend simulado a propósito: todavía no existe una pasarela de pago
 * conectada ni tablas de Supabase para complejos/canchas/reservas/balance
 * (decisión explícita al arrancar este vertical). Estas funciones devuelven
 * siempre los mismos datos de ejemplo del prototipo — no dependen de
 * `isSupabaseConfigured`, a diferencia del resto de los servicios — para que
 * las pantallas ya se puedan construir e iterar contra una forma de datos
 * estable. Cuando haya complejos/canchas reales, esta es la única capa que
 * hay que cambiar: las pantallas ya consumen `{ data, error }` como
 * cualquier otro servicio de la app.
 */

import { computeTotal } from './reservasRules';

const LOS_ROBLES_CANCHAS = [
  { id: 'cancha-1', nombre: 'Cancha 1', tipo: 'Fútbol 7', nota: 'Sintética · techada', base: 28500, jugadoresHabitual: 14 },
  { id: 'cancha-2', nombre: 'Cancha 2', tipo: 'Fútbol 7', nota: 'Sintética · iluminación LED', base: 26500, jugadoresHabitual: 14 },
  { id: 'cancha-3', nombre: 'Cancha 3', tipo: 'Fútbol 11', nota: 'Sintética · graderías', base: 43500, jugadoresHabitual: 22 },
].map((k) => ({ ...k, total: computeTotal(k.base) }));

const LOS_ROBLES_SERVICIOS = [
  'Estacionamiento',
  'Camarines',
  'Duchas',
  'Quincho',
  'Iluminación',
  'Arriendo de balón',
  'Kiosco',
];

const DEMO_COMPLEJOS = [
  {
    id: 'los-robles',
    slug: 'los-robles',
    nombre: 'Complejo Los Robles',
    sector: 'Ñuñoa',
    direccion: 'Av. Irarrázaval 3210, Ñuñoa',
    rating: 4.6,
    reseñas: 128,
    distanciaKm: 2.4,
    tipos: ['Fútbol 7', 'Fútbol 11'],
    desde: LOS_ROBLES_CANCHAS[1].total, // la cancha más barata del complejo
    proximaHoraLibre: '19:00',
    descripcion:
      'Tres canchas de pasto sintético con iluminación LED, camarines y quincho. ' +
      'Estacionamiento sin costo para jugadores.',
    servicios: LOS_ROBLES_SERVICIOS,
    canchas: LOS_ROBLES_CANCHAS,
  },
  {
    id: 'futcenter-maipu',
    slug: 'futcenter-maipu',
    nombre: 'FutCenter Maipú',
    sector: 'Maipú',
    direccion: 'Av. Pajaritos 2100, Maipú',
    rating: 4.8,
    reseñas: 94,
    distanciaKm: 6.1,
    tipos: ['Fútbol 7'],
    desde: 22000,
    proximaHoraLibre: '20:00',
    descripcion: 'Complejo techado, ideal para partidos nocturnos.',
    servicios: ['Estacionamiento', 'Camarines', 'Duchas'],
    canchas: [],
  },
  {
    id: 'estadio-norte',
    slug: 'estadio-norte',
    nombre: 'Estadio Norte',
    sector: 'Huechuraba',
    direccion: 'Av. Recoleta 8500, Huechuraba',
    rating: 4.3,
    reseñas: 61,
    distanciaKm: 9.8,
    tipos: ['Fútbol 11'],
    desde: 31000,
    proximaHoraLibre: '21:00',
    descripcion: 'Cancha grande de pasto sintético, con graderías.',
    servicios: ['Estacionamiento', 'Camarines'],
    canchas: [],
  },
];

const DEMO_HORAS_LIBRES_HOY = [
  { id: 'hoy-1', hora: '19:00', complejoId: 'los-robles', nombre: 'Complejo Los Robles', meta: 'Fútbol 7 · techada', precio: LOS_ROBLES_CANCHAS[1].total },
  { id: 'hoy-2', hora: '20:00', complejoId: 'futcenter-maipu', nombre: 'FutCenter Maipú', meta: 'Fútbol 7', precio: 22000 },
  { id: 'hoy-3', hora: '21:00', complejoId: 'estadio-norte', nombre: 'Estadio Norte', meta: 'Fútbol 11', precio: 31000 },
];

/** Complejos cerca de la ubicación del usuario, ordenados por distancia. */
export async function listComplejosCerca() {
  return { data: DEMO_COMPLEJOS, error: null };
}

/** Horas libres de hoy, mezclando varios complejos (bloque "Juega hoy"). */
export async function listHorasLibresHoy() {
  return { data: DEMO_HORAS_LIBRES_HOY, error: null };
}

/** Un complejo por id, con sus canchas y servicios completos. */
export async function getComplejoById(id) {
  const complejo = DEMO_COMPLEJOS.find((c) => c.id === id) || null;
  return { data: complejo, error: null };
}
