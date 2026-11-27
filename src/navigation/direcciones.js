/**
 * La dirección de cada pantalla, y qué pantalla queda debajo cuando se
 * entra directo por ella.
 *
 * POR QUÉ ESTÁ APARTE. Antes vivía dentro de `AppNavigator`, que arrastra la
 * app entera y no se puede importar en una prueba. Aquí no hay React ni
 * React Native: las pruebas pasan cada dirección por las mismas funciones de
 * React Navigation que usa la app (`getStateFromPath` / `getPathFromState`)
 * y comprueban que ida y vuelta dé la misma pantalla.
 *
 * EL FALLO QUE CIERRA (2026-11-27). Unas cincuenta pantallas con sesión no
 * tenían dirección. En web React Navigation les inventaba una
 * (`/ClubMembers?clubId=…`) que después no reconocía: recargar, o abrir el
 * enlace en otra pestaña, devolvía al inicio. Y las que sí la tenían, abiertas
 * directo, no tenían pantalla anterior: «volver» no hacía nada.
 *
 * REGLAS para agregar una pantalla:
 *   - El camino lleva el id con que la pantalla se arma sola (`:clubId`…),
 *     nunca un objeto: un objeto termina en la URL como «[object Object]».
 *   - Lo que sólo sirve para no parpadear (la foto, el objeto ya cargado) se
 *     esconde con `ocultar`, y la pantalla tiene que poder vivir sin él.
 *   - Si la pantalla cuelga de otra, se dice en `DEBAJO`.
 */

/** Para `stringify`: el parámetro no se escribe en la URL. */
export const ocultar = () => undefined;

export const DIRECCIONES = {
  Main: {
    screens: {
      HomeTab: 'inicio',
      SearchTab: 'partidos',
      ClubsTab: 'clubes',
      ReservasTab: 'reservas',
      ChatTab: 'chat',
      ProfileTab: 'perfil',
    },
  },

  // ─── Chat ─────────────────────────────────────────────────────────────
  // Destino del CTA «IR AHORA» de los avisos de desafío. Sin esta entrada,
  // tocar el push con la app cerrada dejaba al usuario en la raíz en vez de
  // en la conversación.
  ChatThread: 'chat/:threadKey',
  ChatDetails: { path: 'chat/:threadKey/detalles', stringify: { fotoUrl: ocultar } },

  // ─── Perfil y cuenta ──────────────────────────────────────────────────
  UserProfile: 'jugador/:userId',
  EditProfile: 'perfil/editar',
  TrustScoreHistory: 'perfil/historial',
  Settings: 'perfil/ajustes',
  VerificarTelefono: 'perfil/ajustes/telefono',
  BlockedUsers: 'perfil/ajustes/bloqueados',
  MfaSetup: 'perfil/ajustes/dos-pasos',
  ReportarProblema: 'perfil/ajustes/reportar-problema',
  Moderacion: 'moderacion',
  Friends: 'amigos',
  Notifications: 'avisos',
  Saldo: 'saldo',

  // ─── Clubes ───────────────────────────────────────────────────────────
  // No chocan con `ClubsTab: 'clubes'` porque ese camino es exacto, y
  // `nuevo` / `explorar` ganan sobre `:clubId` por ser fijos.
  CreateClub: 'clubes/nuevo',
  ExploreClubs: 'clubes/explorar',
  ClubDetail: 'clubes/:clubId',
  EditClub: 'clubes/:clubId/editar',
  ClubMembers: 'clubes/:clubId/integrantes',
  ClubInvite: 'clubes/:clubId/invitar',
  ClubLineup: 'clubes/:clubId/alineacion',
  ClubGallery: 'clubes/:clubId/galeria',
  ClubHistory: 'clubes/:clubId/historial',
  ClubMatchCalendar: 'clubes/:clubId/calendario',
  ClubChallenges: 'clubes/:clubId/desafios',
  // `club` es el club ya cargado, para no parpadear; sin él lo pide.
  PermisosClub: { path: 'clubes/:clubId/permisos', stringify: { club: ocultar } },
  ClubChallenge: { path: 'clubes/:rivalClubId/desafiar', stringify: { rivalFotoUrl: ocultar } },
  ClubProposal: 'desafio/:challengeId/propuesta',
  ClubResult: 'desafio/:challengeId/resultado',

  // ─── Partidos ─────────────────────────────────────────────────────────
  // `p/<id>` es el formato del enlace público que compartimos.
  MatchDetail: 'p/:matchId',
  ManageMatch: 'p/:matchId/gestionar',
  MatchSpot: 'p/:matchId/mi-cupo',
  MatchRequestStatus: 'p/:matchId/mi-solicitud',
  EditMatch: 'p/:matchId/editar',
  ClubMatchRoster: 'p/:matchId/nomina',
  ClubMatchChange: 'p/:matchId/cambio',
  RateMatch: 'p/:matchId/calificar',
  CreateMatch: 'publicar',

  // ─── Reservar una cancha ──────────────────────────────────────────────
  ComplejoDetail: 'recintos/:complejoId',
  ElegirCancha: 'recintos/:complejoId/canchas',
  FechaHora: 'recintos/:complejoId/horario',
  Resumen: 'recintos/:complejoId/resumen',
  MisReservas: 'mis-reservas',
  // El grupo de una reserva dividida: recargar mandaba al inicio al capitán
  // que tenía 15 minutos para pagar.
  ArmarReserva: 'reserva/:reservaId',
  PagoReserva: { path: 'reserva/:reservaId/pago', stringify: { resumen: ocultar } },
  // Quiénes ya están se vuelve a pedir con el id de la reserva.
  InvitarJugadores: { path: 'reserva/:reservaId/invitar', stringify: { yaEstan: ocultar } },

  // ─── Mi recinto (el lado de quien lo administra) ──────────────────────
  MisRecintos: 'mis-recintos',
  CrearRecinto: 'mis-recintos/nuevo',
  // La solicitud a corregir se vuelve a pedir: en la URL sólo va que es eso.
  SolicitudRecinto: {
    path: 'mis-recintos/solicitud',
    stringify: { corregir: (v) => (v ? 'si' : undefined) },
  },
  ReservaRecinto: 'mis-recintos/reserva/:reservaId',
  PanelRecinto: 'mis-recintos/:complejoId',
  AgendaRecinto: 'mis-recintos/:complejoId/agenda',
  CalendarioCancha: 'mis-recintos/:complejoId/calendario',
  // Los bloques del día se vuelven a pedir con la cancha y la fecha.
  OcuparHorario: { path: 'mis-recintos/:complejoId/ocupar', stringify: { slots: ocultar } },
  Canchas: 'mis-recintos/:complejoId/canchas',
  Cancha: 'mis-recintos/:complejoId/cancha',
  Horarios: 'mis-recintos/:complejoId/horarios/:canchaId',
  Tarifas: 'mis-recintos/:complejoId/tarifas',
  Cobros: 'mis-recintos/:complejoId/cobros',
  FichaRecinto: 'mis-recintos/:complejoId/ficha',
  Administradores: 'mis-recintos/:complejoId/administradores',

  // ─── Públicas ─────────────────────────────────────────────────────────
  // Términos y políticas, en las mismas direcciones a las que ya apuntaban
  // los enlaces de la app (`futfinder.cl/terminos`, …).
  Terminos: 'terminos',
  Privacidad: 'privacidad',
  Cookies: 'cookies',
  // La exige Google Play: borrar la cuenta sin tener la app.
  EliminarCuenta: 'eliminar-cuenta',
};

/** Las pestañas de Main, para dejar una debajo. */
const pestana = (nombre) => () => ({ name: 'Main', state: { routes: [{ name: nombre }] } });
/** Una pantalla que se arma con un solo id que el hijo también tiene. */
const conId = (nombre, clave, desde = clave) => (p) =>
  p[desde] ? { name: nombre, params: { [clave]: String(p[desde]) } } : null;

/**
 * Qué queda debajo de cada pantalla al entrar directo, para que «volver»
 * lleve a donde llevaría si se hubiera llegado tocando. Cada regla recibe los
 * parámetros de la pantalla y devuelve la de abajo, o `null` si no le
 * alcanzan; se encadenan (Invitar → El grupo → Mis reservas → Reservas).
 * Lo que no esté aquí queda sobre el inicio.
 */
export const DEBAJO = {
  ChatThread: pestana('ChatTab'),
  ChatDetails: conId('ChatThread', 'threadKey'),

  EditProfile: pestana('ProfileTab'),
  TrustScoreHistory: pestana('ProfileTab'),
  Settings: pestana('ProfileTab'),
  VerificarTelefono: () => ({ name: 'Settings' }),
  BlockedUsers: () => ({ name: 'Settings' }),
  MfaSetup: () => ({ name: 'Settings' }),
  ReportarProblema: () => ({ name: 'Settings' }),
  Moderacion: () => ({ name: 'Settings' }),

  CreateClub: pestana('ClubsTab'),
  ExploreClubs: pestana('ClubsTab'),
  ClubDetail: pestana('ClubsTab'),
  EditClub: conId('ClubDetail', 'clubId'),
  ClubMembers: conId('ClubDetail', 'clubId'),
  ClubInvite: conId('ClubMembers', 'clubId'),
  ClubLineup: conId('ClubDetail', 'clubId'),
  ClubGallery: conId('ClubDetail', 'clubId'),
  ClubHistory: conId('ClubDetail', 'clubId'),
  ClubMatchCalendar: conId('ClubDetail', 'clubId'),
  ClubChallenges: conId('ClubDetail', 'clubId'),
  PermisosClub: conId('ClubDetail', 'clubId'),
  ClubChallenge: conId('ClubDetail', 'clubId', 'rivalClubId'),
  // La propuesta y el resultado se abren desde la conversación del desafío.
  ClubProposal: (p) => (p.challengeId ? { name: 'ChatThread', params: { threadKey: `challenge:${p.challengeId}` } } : null),
  ClubResult: (p) => (p.challengeId ? { name: 'ChatThread', params: { threadKey: `challenge:${p.challengeId}` } } : null),

  MatchDetail: pestana('SearchTab'),
  ManageMatch: conId('MatchDetail', 'matchId'),
  MatchSpot: conId('MatchDetail', 'matchId'),
  MatchRequestStatus: conId('MatchDetail', 'matchId'),
  EditMatch: conId('MatchDetail', 'matchId'),
  ClubMatchRoster: conId('MatchDetail', 'matchId'),
  ClubMatchChange: conId('MatchDetail', 'matchId'),
  RateMatch: conId('MatchDetail', 'matchId'),

  ComplejoDetail: pestana('ReservasTab'),
  ElegirCancha: conId('ComplejoDetail', 'complejoId'),
  FechaHora: conId('ComplejoDetail', 'complejoId'),
  Resumen: (p) => (p.complejoId
    ? { name: 'FechaHora', params: { complejoId: String(p.complejoId), ...(p.canchaId ? { canchaId: String(p.canchaId) } : {}) } }
    : null),
  MisReservas: pestana('ReservasTab'),
  ArmarReserva: () => ({ name: 'MisReservas' }),
  PagoReserva: () => ({ name: 'MisReservas' }),
  InvitarJugadores: conId('ArmarReserva', 'reservaId'),

  MisRecintos: pestana('ReservasTab'),
  CrearRecinto: () => ({ name: 'MisRecintos' }),
  SolicitudRecinto: pestana('ReservasTab'),
  ReservaRecinto: () => ({ name: 'MisRecintos' }),
  PanelRecinto: () => ({ name: 'MisRecintos' }),
  AgendaRecinto: conId('PanelRecinto', 'complejoId'),
  CalendarioCancha: conId('PanelRecinto', 'complejoId'),
  OcuparHorario: (p) => (p.complejoId
    ? { name: 'CalendarioCancha', params: { complejoId: String(p.complejoId), ...(p.canchaId ? { canchaId: String(p.canchaId) } : {}) } }
    : null),
  Canchas: conId('PanelRecinto', 'complejoId'),
  Cancha: conId('Canchas', 'complejoId'),
  Horarios: conId('Canchas', 'complejoId'),
  Tarifas: conId('PanelRecinto', 'complejoId'),
  Cobros: conId('PanelRecinto', 'complejoId'),
  FichaRecinto: conId('PanelRecinto', 'complejoId'),
  Administradores: conId('PanelRecinto', 'complejoId'),
};

/**
 * Las que se leen sin sesión: nunca llevan Main debajo, porque Main pide
 * sesión y mandaría a Login a quien sólo quería leer los términos.
 */
export const SIN_SESION = new Set(['Terminos', 'Privacidad', 'Cookies', 'EliminarCuenta', 'ReservasUiGallery']);

/**
 * Recibe el estado que arma React Navigation al abrir una dirección y, si
 * apunta a una pantalla suelta con sesión, le pone debajo la cadena de
 * `DEBAJO` y Main al fondo. Así «volver» siempre tiene a dónde ir.
 */
export function conPantallaDeAbajo(estado) {
  if (!estado || !Array.isArray(estado.routes) || estado.routes.length !== 1) return estado;
  const arriba = estado.routes[0];
  if (!arriba || arriba.name === 'Main' || SIN_SESION.has(arriba.name)) return estado;

  const debajo = [];
  let actual = arriba;
  // Tope por si alguien arma una regla circular.
  for (let i = 0; i < 6; i += 1) {
    const regla = DEBAJO[actual.name];
    const anterior = regla ? regla(actual.params || {}) : null;
    if (!anterior || anterior.name === 'Main') {
      debajo.unshift(anterior || { name: 'Main' });
      break;
    }
    debajo.unshift(anterior);
    actual = anterior;
  }
  if (debajo[0]?.name !== 'Main') debajo.unshift({ name: 'Main' });

  const routes = [...debajo, arriba];
  return { ...estado, index: routes.length - 1, routes };
}
