import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  getMyClubs,
  listMyInvitations,
  listMyRequests,
  listMembers,
  listPendingRequests,
  listRivalCandidates,
} from '../services/clubs';
import { getClubEstadisticas } from '../services/clubMatches';
import { listChallengesForClub } from '../services/clubChallenges';
import { getPropuestaVigente } from '../services/clubProposals';
import { getCambiosDelPartido } from '../services/clubMatchChanges';
import { getNominaPartido } from '../services/clubRoster';
import { getSancionVigente } from '../services/clubSanctions';
import { listNotifications } from '../services/notifications';
import { listPartidosDeClub } from '../services/matches';
import { proximoPartidoDeClub, resumenNomina } from '../services/clubMatchRules';
import {
  avisoDelClub,
  cambioParaTareas,
  derivarMembresia,
  desafiosRecibidosParaTareas,
  elegirClubActivo,
  partidoAdmiteCambio,
} from '../utils/clubsHomeSources.js';
import {
  normalizarTareas,
  contarConAccion,
  repartirTareas,
  cuposDelPlan,
  permisosDeClub,
  plazoDePartido,
  etiquetaPlazo,
} from '../utils/clubsHomeTasks.js';

/**
 * Fuente única de verdad de la portada de Clubes.
 *
 * POR QUÉ ES UN CONTEXTO Y NO UN HOOK SUELTO. Dos consumidores necesitan lo
 * mismo: la portada («Pendiente para ti») y la barra inferior (el badge de la
 * pestaña Clubes). Con un hook por consumidor serían dos cargas completas de
 * once consultas cada una, y —peor— dos `badgeCount` calculados en momentos
 * distintos que tarde o temprano dirían números distintos en la misma
 * pantalla. `useUnreadNotifications` ya se topó con esto cuando la campana
 * pasó al header de cada pestaña, y lo resolvió compartiendo un canal; acá se
 * comparte el estado entero.
 *
 * El proveedor se monta en `MainTabs`, que es el punto más bajo que cubre a
 * los dos consumidores y ya está detrás del guard de sesión: montarlo más
 * arriba dispararía las consultas sin usuario.
 *
 * LO QUE DECIDE ALGO NO ESTÁ ACÁ. Las reglas viven en `utils/clubsHomeSources.js`
 * (a qué club pertenece un aviso, qué club queda activo, si hay membresía) y
 * en `utils/clubsHomeTasks.js` (las tareas, el badge, los cupos, los
 * permisos), que sí se prueban. Este archivo ata servicios y ordena rondas.
 *
 * DECISIONES QUE HUBO QUE VERIFICAR CONTRA EL CÓDIGO Y LAS MIGRACIONES:
 *
 * 1. DE DÓNDE SALE «PRÓXIMO PARTIDO». De `listPartidosDeClub()`, que filtra
 *    por club en la base. `listOpenMatches()` no sirve: trae los N partidos
 *    abiertos más próximos de toda la app y deja fuera los que ya se
 *    llenaron, así que el partido de tu club desaparecía de la portada por
 *    dos motivos distintos y sin avisar. Ver el comentario de esa función.
 *
 * 2. CÓMO SE FILTRA «ACTIVIDAD» POR EL CLUB ACTIVO. Los avisos son del
 *    usuario, no del club: `notifications` no tiene `club_id`. Se filtran por
 *    las marcas que el servidor sí adjunta en `data`. Ver `avisoDelClub`.
 *
 * 3. ORDEN DE LAS CONSULTAS. Primera ronda, todo lo que no depende de nada.
 *    Segunda ronda, lo que necesita los resultados de la primera: la
 *    propuesta vigente de cada desafío esperando aprobación, y el cambio
 *    pendiente y la nómina del próximo partido.
 *
 * 4. QUÉ DESAFÍOS PIDEN PROPUESTA. Solo los que están en
 *    `'esperando_aprobacion'`: es el único estado con una propuesta oficial
 *    esperando decisión. Pedirla en `'negociacion'` sería un viaje perdido.
 *    Ojo: `getPropuestaVigente()` devuelve la última propuesta aunque esté
 *    rechazada o caducada, así que `normalizarTareas` la clasifica por su
 *    estado y no la da por abierta.
 *
 * 4bis. QUÉ LLEGA A LA LISTA DE TAREAS, Y NO SÓLO LO ACCIONABLE. Antes este
 *    archivo filtraba `estado === 'pendiente'` en los desafíos y pedía sólo
 *    el cambio de partido en `'pendiente'`. Con eso, el estado `'vencida'`
 *    que `clubsHomeTasks.js` sabe clasificar y `PendingTaskCard` sabe dibujar
 *    —opacidad .55, sin botón, chip «Expiró»— era INALCANZABLE desde el flujo
 *    real: la portada no explicaba nunca por qué algo dejó de estar. Ahora
 *    quién entra lo deciden `desafiosRecibidosParaTareas()` y
 *    `cambioParaTareas()`, que además acotan los desenlaces a siete días
 *    —`listChallengesForClub()` devuelve el historial completo y sin límite—
 *    y son puras, así que las reglas están probadas y acá sólo se llaman.
 *
 *    Por eso el cambio de partido se pide con `getCambiosDelPartido()` y no
 *    con `getCambioPendiente()`: la segunda filtra `estado = 'pendiente'` en
 *    la base y no puede devolver un cambio caducado ni aunque se quiera.
 *    Sigue viajando UNO como máximo; lo elige `cambioParaTareas()`.
 *
 * 5. UN SOLO RELOJ. `ahora` se toma una vez y se usa para elegir el próximo
 *    partido y para redactar su plazo. Con dos relojes y una ronda de red en
 *    medio, un partido a minutos de empezar podía quedar elegido como
 *    `nextMatch` y a la vez descartado como tarea por haber empezado.
 *
 * 6. ESTADÍSTICAS DEL CLUB. Viajan colgadas de `club.estadisticas`
 *    (`{ pj, v, e, d, gf, gc }`) en vez de inventar una clave que las tareas
 *    7-10 no pidieron.
 */

const CLUB_ACTIVO_KEY = 'futfinder:clubActivo';

/** Estados del desafío en los que existe una propuesta oficial por revisar. */
const ESTADO_ESPERANDO_PROPUESTA = 'esperando_aprobacion';

/**
 * `pendingRequests` son las solicitudes que OTROS enviaron a mi club y yo
 * administro; `sentRequests` son las que YO envié y espero respuesta. Se
 * parecen en el nombre y no tienen nada que ver: la portada usa la primera
 * para la lista de tareas y la segunda para el estado «solicitud en revisión».
 */

/** Cuántos avisos entran en «Actividad reciente». */
const TOPE_ACTIVIDAD = 3;

const ESTADO_INICIAL = {
  loading: true,
  refreshing: false,
  cargado: false,
  error: false,
  membership: 'none',
  clubs: [],
  activeClubId: null,
  club: null,
  role: null,
  can: permisosDeClub(null),
  limits: cuposDelPlan({}),
  tasks: [],
  reparto: repartirTareas([]),
  badgeCount: 0,
  nextMatch: null,
  nextMatchCupos: null,
  nextMatchPlazo: null,
  activity: [],
  suggestedRivals: [],
  invitations: [],
  pendingRequests: [],
  sentRequests: [],
};

/** Lee el club activo guardado. Un fallo de almacenamiento no tumba la portada. */
async function leerClubActivoGuardado() {
  try {
    return await AsyncStorage.getItem(CLUB_ACTIVO_KEY);
  } catch (e) {
    console.error('[FutFinder] ClubsHome leerClubActivoGuardado:', e);
    return null;
  }
}

async function guardarClubActivo(id) {
  try {
    await AsyncStorage.setItem(CLUB_ACTIVO_KEY, id);
  } catch (e) {
    console.error('[FutFinder] ClubsHome guardarClubActivo:', e);
  }
}

/** Envuelve una fuente secundaria: si falla, esa sección se ve vacía y ya. */
function segura(promesa, porDefecto, etiqueta) {
  return promesa.catch((e) => {
    console.error(`[FutFinder] ClubsHome ${etiqueta}:`, e);
    return porDefecto;
  });
}

const ClubsHomeContext = createContext(null);

export function ClubsHomeProvider({ children }) {
  const [state, setState] = useState(ESTADO_INICIAL);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  const setActiveClub = useCallback(async (id) => {
    await guardarClubActivo(id);
    setReloadToken((n) => n + 1);
  }, []);

  useEffect(() => {
    let vivo = true;
    // PRIMERA CARGA NO ES LO MISMO QUE REFRESCO. La portada se recarga en
    // cada foco de la pestaña; si eso encendiera `loading`, el contenido
    // entero se reemplazaría por el esqueleto cada vez que el usuario vuelve
    // del detalle de un club. `refreshing` deja el contenido en pantalla
    // mientras los datos se renuevan por debajo.
    setState((s) => ({
      ...s,
      loading: !s.cargado,
      refreshing: s.cargado,
      error: false,
    }));

    (async () => {
      try {
        // ── Membresía ────────────────────────────────────────────
        const { data: misClubes, error: errClubes } = await getMyClubs();
        if (!vivo) return;
        if (errClubes) {
          console.error('[FutFinder] ClubsHome getMyClubs:', errClubes);
          // Se conserva lo que ya había: un corte de red al volver a la
          // pestaña no puede borrar una portada que estaba completa.
          setState((s) => ({ ...s, loading: false, refreshing: false, error: true }));
          return;
        }

        // Las dos vías por las que alguien puede estar esperando respuesta.
        // Se piden siempre: son baratas y `listMyRequests` es lo que permite
        // reconocer a quien postuló a su primer club.
        const [invitations, solicitudesEnviadas, guardado] = await Promise.all([
          segura(listMyInvitations().then((r) => r.data || []), [], 'listMyInvitations'),
          segura(listMyRequests().then((r) => r.data || []), [], 'listMyRequests'),
          leerClubActivoGuardado(),
        ]);
        if (!vivo) return;

        const membership = derivarMembresia({
          clubes: misClubes,
          invitaciones: invitations,
          solicitudes: solicitudesEnviadas,
        });

        const activeId = elegirClubActivo(misClubes, guardado);
        if (activeId && activeId !== guardado) await guardarClubActivo(activeId);
        if (!vivo) return;

        if (!activeId) {
          setState({
            ...ESTADO_INICIAL,
            loading: false,
            cargado: true,
            membership,
            clubs: misClubes,
            invitations,
            sentRequests: solicitudesEnviadas,
          });
          return;
        }

        const membresiaActiva = misClubes.find((m) => m.club?.id === activeId);
        const role = membresiaActiva?.miRol || 'jugador';
        const can = permisosDeClub(role);

        // ── Primera ronda: nada depende de nada acá ──────────────
        const [
          desafiosRes,
          solicitudesData,
          sancionData,
          estadisticasData,
          miembrosData,
          rivalesData,
          notifsData,
          partidosData,
        ] = await Promise.all([
          segura(
            listChallengesForClub(activeId),
            { data: { recibidos: [], enviados: [] } },
            'listChallengesForClub'
          ),
          can.gestionarMiembros
            ? segura(listPendingRequests(activeId).then((r) => r.data || []), [], 'listPendingRequests')
            : Promise.resolve([]),
          segura(getSancionVigente([activeId]).then((r) => r.data || null), null, 'getSancionVigente'),
          segura(getClubEstadisticas(activeId).then((r) => r.data || null), null, 'getClubEstadisticas'),
          segura(listMembers(activeId).then((r) => r.data || []), [], 'listMembers'),
          segura(
            listRivalCandidates({ retadorClubId: activeId }).then((r) => r.data || []),
            [],
            'listRivalCandidates'
          ),
          segura(listNotifications({ limit: 50 }).then((r) => r.data || []), [], 'listNotifications'),
          segura(listPartidosDeClub(activeId).then((r) => r.data || []), [], 'listPartidosDeClub'),
        ]);
        if (!vivo) return;

        // Un solo reloj: elige el partido, redacta su plazo y mide la ventana
        // de los desenlaces. Con dos, un desafío cerrado justo en el borde
        // podría entrar en la lista y quedar fuera del conteo.
        const ahora = new Date();

        const recibidos = desafiosRes.data?.recibidos || [];
        const enviados = desafiosRes.data?.enviados || [];
        const desafiosParaTareas = desafiosRecibidosParaTareas(recibidos, { ahora });
        const desafiosEsperandoPropuesta = [...recibidos, ...enviados].filter(
          (d) => d.estado === ESTADO_ESPERANDO_PROPUESTA
        );

        const proximoPartido = proximoPartidoDeClub(partidosData, [activeId], { ahora });
        const admiteCambio = partidoAdmiteCambio(proximoPartido);
        const cuposPorClub = proximoPartido?.cupos_por_club;
        const conNomina = Number.isFinite(cuposPorClub) && cuposPorClub > 0;

        // ── Segunda ronda: depende de la primera ─────────────────
        const [propuestasRes, cambiosData, nominaData] = await Promise.all([
          Promise.all(
            desafiosEsperandoPropuesta.map((d) =>
              segura(getPropuestaVigente(d.id).then((r) => r.data), null, 'getPropuestaVigente')
            )
          ),
          admiteCambio
            ? segura(
                getCambiosDelPartido(proximoPartido.id).then((r) => r.data || []),
                [],
                'getCambiosDelPartido'
              )
            : Promise.resolve([]),
          conNomina
            ? segura(getNominaPartido(proximoPartido.id).then((r) => r.data || []), [], 'getNominaPartido')
            : Promise.resolve([]),
        ]);
        if (!vivo) return;

        const nomina = conNomina
          ? (() => {
              const resumen = resumenNomina(nominaData, activeId, cuposPorClub);
              return { matchId: proximoPartido.id, confirmados: resumen.inscritos, cupos: resumen.cupos };
            })()
          : null;

        const cambio = cambioParaTareas(cambiosData, { ahora });

        const tasks = normalizarTareas(
          {
            desafiosRecibidos: desafiosParaTareas,
            propuestas: propuestasRes.filter(Boolean),
            cambiosDePartido: cambio ? [cambio] : [],
            nomina,
            solicitudes: solicitudesData,
            sancion: sancionData,
            proximoPartido,
          },
          { rol: role, ahora }
        );

        setState({
          loading: false,
          refreshing: false,
          cargado: true,
          error: false,
          membership,
          clubs: misClubes,
          activeClubId: activeId,
          club: membresiaActiva?.club
            ? { ...membresiaActiva.club, estadisticas: estadisticasData }
            : null,
          role,
          can,
          limits: cuposDelPlan({
            plan: membresiaActiva?.club?.plan,
            miembrosActivos: miembrosData.length,
            admins: miembrosData.filter((m) => m.rol === 'admin').length,
          }),
          tasks,
          reparto: repartirTareas(tasks),
          badgeCount: contarConAccion(tasks),
          nextMatch: proximoPartido,
          // Los dos se calculan acá, con el MISMO `ahora` que las tareas, y
          // viajan resueltos. La pantalla no tiene que deducirlos del texto
          // que ya se redactó para otra cosa.
          nextMatchCupos: nomina,
          nextMatchPlazo: proximoPartido
            ? etiquetaPlazo(plazoDePartido(proximoPartido.hora, ahora))
            : null,
          activity: notifsData.filter((n) => avisoDelClub(n, activeId)).slice(0, TOPE_ACTIVIDAD),
          suggestedRivals: rivalesData,
          invitations,
          pendingRequests: solicitudesData,
          sentRequests: solicitudesEnviadas,
        });
      } catch (e) {
        if (!vivo) return;
        console.error('[FutFinder] ClubsHome:', e);
        setState((s) => ({ ...s, loading: false, refreshing: false, error: true }));
      }
    })();

    return () => {
      vivo = false;
    };
  }, [reloadToken]);

  return (
    <ClubsHomeContext.Provider value={{ ...state, reload, retry: reload, setActiveClub }}>
      {children}
    </ClubsHomeContext.Provider>
  );
}

/**
 * El estado de la portada de Clubes.
 *
 * Fuera del proveedor devuelve el estado inicial en vez de reventar: la barra
 * inferior se dibuja en sitios donde el proveedor podría no estar montado, y
 * un badge en cero es mejor que una pantalla en blanco.
 */
const SIN_PROVEEDOR = Object.freeze({
  ...ESTADO_INICIAL,
  loading: false,
  reload: () => {},
  retry: () => {},
  setActiveClub: async () => {},
});

export function useClubsHome() {
  return useContext(ClubsHomeContext) || SIN_PROVEEDOR;
}
