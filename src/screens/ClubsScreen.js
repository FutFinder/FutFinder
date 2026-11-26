import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Animated,
  StyleSheet,
  Easing,
  Modal,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { AlertTriangle, ArrowLeft, Clock, Search, ShieldPlus } from 'lucide-react-native';

import {
  paleta as C,
  fuentes as F,
  clubTonos,
  alfa,
} from '../theme/colors';
import { temaDeClub } from '../theme/clubThemes';
import {
  respondToRequest,
  cancelRequest,
  getClubById,
  MAX_CLUBES_POR_JUGADOR,
} from '../services/clubs';
import { getMatchById } from '../services/matches';
import { lugarLabel } from '../services/clubMatchRules';
import { haceCuanto } from '../utils/tiempoRelativo.js';
import { modalidadInline } from '../utils/clubModalidad';
import { destinoDeTarea, etiquetaBadge } from '../utils/clubsHomeTasks.js';
import { navigateToNotification } from '../utils/notificationTargets';
import { useClubsHome } from '../contexts/ClubsHomeContext';

import ClubsHeader from '../components/club/ClubsHeader';
import PendingTaskCard from '../components/club/PendingTaskCard';
import AllClearBanner from '../components/club/AllClearBanner';
import NextMatchCard from '../components/club/NextMatchCard';
import ActivityList from '../components/club/ActivityList';
import SkeletonHome from '../components/club/SkeletonHome';
import ClubLogo from '../components/club/ClubLogo';
import { FichaClub } from './ClubDetailScreen';
import Banner from '../components/Banner';

/**
 * Pestaña «Clubes»: la portada.
 *
 * ANTES ESTA PANTALLA NO TENÍA INTERFAZ. Consultaba la membresía y embebía
 * `ClubDetailScreen` o `ClubExplorer`, así que entrar a Clubes era entrar al
 * detalle de un club: para responder un desafío o revisar la nómina había que
 * bajar por toda la ficha. Ahora la pestaña abre un centro de control y el
 * detalle queda a un toque explícito, desde «Ver club» en el resumen.
 *
 * NO SE AGREGA FUNCIONALIDAD. Todo lo que se ve acá ya existía en otra
 * pantalla; lo que cambia es el orden en que aparece y cuánto hay que
 * desplazarse para llegar.
 *
 * LA JERARQUÍA ES EL REDISEÑO: pendientes → próximo partido → accesos →
 * resumen → actividad → rivales. Lo urgente arriba, lo consultable abajo.
 *
 * NADA SE CALCULA ACÁ. El badge, el reparto de tareas, la etiqueta del «ver
 * más» y los permisos vienen resueltos y probados de `clubsHomeTasks.js` a
 * través del contexto. Recalcular cualquiera de ellos en la vista es cómo la
 * barra inferior y esta sección terminan mostrando números distintos.
 */
export default function ClubsScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const {
    loading,
    cambiandoClub,
    cargado,
    error,
    membership,
    clubs,
    activeClubId,
    club,
    tasks,
    reparto,
    badgeCount,
    nextMatch,
    nextMatchCupos,
    nextMatchPlazo,
    activity,
    openChallengeReplies,
    invitations,
    sentRequests,
    retry,
    reload,
    setActiveClub,
  } = useClubsHome();

  const [banner, setBanner] = useState(null);
  const [avisosAbiertos, setAvisosAbiertos] = useState(false);
  const [misClubesAbierto, setMisClubesAbierto] = useState(false);
  const tema = useMemo(() => temaDeClub(club), [club]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  // Banner de éxito que llega de ClubMembersScreen al salir o eliminar un
  // club. Se consume una sola vez y se limpia para que no reaparezca en el
  // próximo foco.
  useEffect(() => {
    if (route?.params?.successTitle) {
      setBanner({
        type: 'success',
        title: route.params.successTitle,
        message: route.params.successMessage || '',
      });
      navigation.setParams({ successTitle: undefined, successMessage: undefined });
    }
  }, [route?.params?.successTitle]); // eslint-disable-line react-hooks/exhaustive-deps

  const irA = useCallback(
    (ruta, params) => navigation.navigate(ruta, params),
    [navigation]
  );

  /**
   * Aceptar o rechazar una invitación desde su tarjeta.
   *
   * Vive acá y no en la tarjeta porque después hay que RECARGAR: aceptar
   * cambia a qué clubes pertenece el usuario, y con ello el selector, el
   * club activo y el badge. La tarjeta sólo avisa qué se pulsó.
   *
   * El error se muestra tal cual lo devuelve el servidor. El caso que más
   * importa es el tope: `check_user_club_limit` (migración 24) rechaza la
   * cuarta membresía con «Ya perteneces al máximo de 3 clubes permitidos», y
   * ese es exactamente el motivo que hay que leer. Inventar un texto propio
   * acá lo escondería.
   */
  const [respondiendo, setRespondiendo] = useState(null);
  const onAccionTarea = useCallback(
    async (tarea, clave) => {
      if (tarea.type !== 'invitacion' || respondiendo) return;
      const aceptar = clave === 'aceptar';
      setRespondiendo(tarea.id);
      const { error: err } = await respondToRequest(tarea.requestId, aceptar);
      setRespondiendo(null);
      setBanner(
        err
          ? { type: 'error', title: 'No se pudo responder', message: err.message || '' }
          : {
              type: 'success',
              title: aceptar ? 'Ya eres parte del club' : 'Invitación rechazada',
              message: '',
            }
      );
      reload();
    },
    [respondiendo, reload]
  );

  /**
   * El destino lo resuelve `destinoDeTarea()`, con los identificadores que la
   * propia tarea trae.
   *
   * ANTES ERA UNA TABLA POR NOMBRE DE RUTA, y por eso dos tareas distintas
   * del mismo destino se abrían con los mismos datos: la solicitud de cambio
   * y la nómina viajaban con `nextMatch.id` aunque la solicitud fuera de otro
   * encuentro, y el desafío y la propuesta llegaban sin identificador a un
   * tablero que no las contiene. La regla se prueba en `clubsHomeTasks`.
   */
  const onTarea = useCallback(
    (tarea) => {
      const destino = destinoDeTarea(tarea, activeClubId);
      if (destino?.screen) irA(destino.screen, destino.params || {});
    },
    [activeClubId, irA]
  );

  /**
   * Tocar una fila de «Actividad reciente» abre SU asunto.
   *
   * Antes la pantalla ignoraba el aviso pulsado y abría la bandeja filtrada
   * por el club —lo mismo que «Ver toda»—, así que tocar una noticia
   * concreta obligaba a buscarla otra vez en una lista.
   *
   * El destino lo resuelve `navigateToNotification`, el mismo punto de
   * verdad que usan la bandeja de Avisos y el toque sobre un push: un
   * destino nuevo o corregido vale acá sin tocar esta pantalla. Cuando el
   * aviso no trae el dato necesario, o el recurso ya no existe, se cae a la
   * bandeja filtrada, que es lo que se hacía siempre.
   */
  const verActividad = useCallback(
    (aviso) => {
      const alListado = () =>
        irA('Notifications', { filter: 'clubes', clubId: activeClubId });
      if (!aviso) {
        alListado();
        return;
      }
      navigateToNotification(aviso, {
        navigate: irA,
        onMissing: alListado,
        onUnresolved: alListado,
        getMatchById,
        getClubById,
      });
    },
    [activeClubId, irA]
  );

  const cabecera = (
    <ClubsHeader
      // Mientras carga por primera vez todavía no se sabe si hay club: decir
      // «Aún sin club» a quien sí tiene uno era mentirle un segundo.
      subtitulo={
        loading && !cargado
          ? null
          : subtituloDe({ membership, clubs, club, sentRequests, invitations })
      }
      tema={tema}
      hayPendientes={badgeCount > 0}
      onBuscar={() => irA('ExploreClubs')}
      onAvisos={() => irA('Notifications')}
    />
  );

  if (loading) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        {cabecera}
        <SkeletonHome />
      </SafeAreaView>
    );
  }

  // El error ocupa la pantalla sólo si nunca llegó a haber datos. Si ya
  // había una portada, un corte de red al volver a la pestaña deja lo que
  // estaba y avisa con un banner: borrarla sería perder información buena
  // por un fallo pasajero.
  if (error && !cargado) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        {cabecera}
        <EstadoDeError onReintentar={retry} />
      </SafeAreaView>
    );
  }

  // CON CLUB, LA PORTADA ES LA FICHA DEL CLUB ACTIVO (rediseño 2026-11-26).
  // `FichaClub` es el mismo componente de `ClubDetailScreen`; la prop
  // `portada` cambia volver por «Mis clubes» y agrega la campana y el
  // próximo partido. Lo que antes encabezaba la portada vive tras la campana.
  if (membership === 'member' && activeClubId) {
    const irDesdeHoja = (ruta, params) => {
      setAvisosAbiertos(false);
      setMisClubesAbierto(false);
      irA(ruta, params);
    };
    return (
      <View style={styles.root}>
        <SafeAreaView edges={['top']} style={styles.root}>
          {error ? (
            <View style={styles.bannerHueco}>
              <Banner
                type="error"
                title="No pudimos actualizar"
                message="Estás viendo los últimos datos que alcanzamos a cargar."
                onClose={retry}
              />
            </View>
          ) : null}
          {banner ? (
            <View style={styles.bannerHueco}>
              <Banner {...banner} onClose={() => setBanner(null)} />
            </View>
          ) : null}
          <FichaClub
            key={activeClubId}
            clubId={activeClubId}
            navigation={navigation}
            portada={{
              totalClubes: (clubs || []).length,
              onMisClubes: () => setMisClubesAbierto(true),
              onAvisos: () => setAvisosAbiertos(true),
              avisosCount: badgeCount,
              respuestasPorDecidir: openChallengeReplies,
              paddingBottom: 110 + insets.bottom,
              proximoPartido: nextMatch ? (
                <NextMatchCard
                  partido={nextMatch}
                  tema={tema}
                  miClubId={activeClubId}
                  cupos={nextMatchCupos}
                  plazo={nextMatchPlazo}
                  fecha={fechaLegible(nextMatch.hora)}
                  lugar={lugarLabel(nextMatch, [activeClubId])}
                  onVerPartido={() => irA('MatchDetail', { matchId: nextMatch.id })}
                  onNomina={() => irA('ClubMatchRoster', { matchId: nextMatch.id })}
                  onVerCalendario={() =>
                    irA('ClubMatchCalendar', { clubId: activeClubId, clubNombre: club?.nombre })
                  }
                />
              ) : null,
            }}
          />
        </SafeAreaView>

        <Modal
          visible={avisosAbiertos}
          animationType="slide"
          onRequestClose={() => setAvisosAbiertos(false)}
        >
          <AvisosDelClub
            {...{
              club,
              activeClubId,
              cambiandoClub,
              tasks,
              reparto,
              badgeCount,
              nextMatch,
              nextMatchCupos,
              nextMatchPlazo,
              activity,
              tema,
              respondiendo,
              onAccionTarea,
            }}
            irA={irDesdeHoja}
            onTarea={(tarea) => {
              setAvisosAbiertos(false);
              onTarea(tarea);
            }}
            verActividad={(aviso) => {
              setAvisosAbiertos(false);
              verActividad(aviso);
            }}
            onCerrar={() => setAvisosAbiertos(false)}
          />
        </Modal>

        <Modal
          visible={misClubesAbierto}
          transparent
          animationType="fade"
          onRequestClose={() => setMisClubesAbierto(false)}
        >
          <MisClubesHoja
            clubs={clubs}
            activeClubId={activeClubId}
            onSelect={(id) => {
              setMisClubesAbierto(false);
              if (id !== activeClubId) setActiveClub(id);
            }}
            onCrear={() => irDesdeHoja('CreateClub')}
            onUnirse={() => irDesdeHoja('ExploreClubs')}
            onCerrar={() => setMisClubesAbierto(false)}
          />
        </Modal>
      </View>
    );
  }

  const contenido =
    membership === 'pending' ? (

      <SolicitudEnRevision
        solicitudes={sentRequests}
        invitaciones={invitations}
        onVerClub={(clubId) => irA('ClubDetail', { clubId })}
        onResponder={async (inv, aceptar) => {
          const { error: err } = await respondToRequest(inv.request_id, aceptar);
          setBanner(
            err
              ? { type: 'error', title: 'No se pudo responder', message: err.message || '' }
              : {
                  type: 'success',
                  title: aceptar ? 'Ya eres parte del club' : 'Invitación rechazada',
                  message: '',
                }
          );
          reload();
        }}
        onCancelar={async (solicitud) => {
          const { error: err } = await cancelRequest(solicitud.request_id);
          setBanner(
            err
              ? { type: 'error', title: 'No se pudo cancelar', message: err.message || '' }
              : { type: 'success', title: 'Solicitud cancelada', message: '' }
          );
          reload();
        }}
      />
    ) : (
      <SinClub
        invitaciones={invitations}
        onCrear={() => irA('CreateClub')}
        onExplorar={() => irA('ExploreClubs')}
        onResponder={async (inv, aceptar) => {
          const { error: err } = await respondToRequest(inv.request_id, aceptar);
          setBanner(
            err
              ? { type: 'error', title: 'No se pudo responder', message: err.message || '' }
              : {
                  type: 'success',
                  title: aceptar ? 'Ya eres parte del club' : 'Invitación rechazada',
                  message: '',
                }
          );
          reload();
        }}
      />
    );

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      {cabecera}
      {error ? (
        <View style={styles.bannerHueco}>
          <Banner
            type="error"
            title="No pudimos actualizar"
            message="Estás viendo los últimos datos que alcanzamos a cargar."
            onClose={retry}
          />
        </View>
      ) : null}
      {banner ? (
        <View style={styles.bannerHueco}>
          <Banner {...banner} onClose={() => setBanner(null)} />
        </View>
      ) : null}
      <EntradaSuave>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: 110 + insets.bottom }]}
          showsVerticalScrollIndicator={false}
        >
          {contenido}
        </ScrollView>
      </EntradaSuave>
    </SafeAreaView>
  );
}

/* ── Notificaciones del club (la campana de la portada) ─────────────── */

/**
 * Lo que antes encabezaba la portada —«Pendiente para ti», el próximo
 * partido y la actividad reciente— vive ahora detrás de la campana de la
 * ficha, como pide el rediseño: la portada es el club y lo pendiente se
 * consulta a un toque, con el mismo número en la campana y en la barra
 * inferior (los dos leen `badgeCount` del mismo contexto).
 *
 * Es un `Modal` dentro de la pestaña y no una pantalla de la pila porque el
 * estado sale de `ClubsHomeContext`, que envuelve sólo las pestañas.
 */
function AvisosDelClub({
  club,
  activeClubId,
  cambiandoClub,
  tasks,
  reparto,
  badgeCount,
  nextMatch,
  nextMatchCupos,
  nextMatchPlazo,
  activity,
  tema,
  onTarea,
  onAccionTarea,
  verActividad,
  respondiendo,
  irA,
  onCerrar,
}) {
  const sinTareas = (tasks || []).length === 0;

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.root}>
      <View style={styles.avisosCabecera}>
        <Pressable
          onPress={onCerrar}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Volver"
          style={({ pressed }) => [styles.avisosVolver, pressed && { opacity: 0.7 }]}
        >
          <ArrowLeft color={C.textPrimary} size={18} strokeWidth={2.2} />
        </Pressable>
        <View style={styles.textos}>
          <Text style={styles.avisosTitulo}>Notificaciones</Text>
          {club?.nombre ? (
            <Text style={styles.subtituloTarjeta} numberOfLines={1}>
              {club.nombre}
            </Text>
          ) : null}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.seccion}>
          <View style={styles.cabeceraSeccion}>
            <View style={styles.tituloConBadge}>
              <Text style={styles.tituloSeccion}>Pendiente para ti</Text>
              {/* El rótulo sale de `etiquetaBadge()`, el mismo que usa la
                  barra inferior: con doce pendientes los dos dicen «9+». */}
              {badgeCount > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeTexto}>{etiquetaBadge(badgeCount)}</Text>
                </View>
              ) : null}
            </View>
            {sinTareas ? null : (
              <Pressable
                onPress={() => irA('Notifications')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Ver todo lo pendiente"
              >
                <Text style={[styles.verTodo, { color: tema.main }]}>Ver todo</Text>
              </Pressable>
            )}
          </View>

          {/* Cambiando de club no es «todo al día»: las tareas del club nuevo
              todavía no llegan. */}
          {cambiandoClub ? (
            <Text style={styles.cargandoTareas}>Cargando lo de este club…</Text>
          ) : sinTareas ? (
            <AllClearBanner tema={tema} />
          ) : (
            <View style={styles.pila}>
              {reparto.visibles.map((tarea, i) => (
                <PendingTaskCard
                  key={tarea.id}
                  tarea={tarea}
                  tema={tema}
                  esPrimaria={i === 0}
                  onPress={() => onTarea(tarea)}
                  onAccion={(clave) => onAccionTarea(tarea, clave)}
                  ocupado={respondiendo === tarea.id}
                />
              ))}
              {reparto.etiquetaVerMas ? (
                <Pressable
                  onPress={() => irA('Notifications')}
                  accessibilityRole="button"
                  accessibilityLabel={reparto.etiquetaVerMas}
                  style={({ pressed }) => [styles.verMas, pressed && { opacity: 0.7 }]}
                >
                  <Text style={styles.verMasTexto}>{reparto.etiquetaVerMas}</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </View>

        {nextMatch ? (
          <View style={styles.seccion}>
            <Text style={[styles.tituloSeccion, styles.conMargenAbajo]}>Próximo partido</Text>
            <NextMatchCard
              partido={nextMatch}
              tema={tema}
              miClubId={activeClubId}
              cupos={nextMatchCupos}
              plazo={nextMatchPlazo}
              fecha={fechaLegible(nextMatch.hora)}
              lugar={lugarLabel(nextMatch, [activeClubId])}
              onVerPartido={() => irA('MatchDetail', { matchId: nextMatch.id })}
              onNomina={() => irA('ClubMatchRoster', { matchId: nextMatch.id })}
              onVerCalendario={() =>
                irA('ClubMatchCalendar', { clubId: activeClubId, clubNombre: club?.nombre })
              }
            />
          </View>
        ) : null}

        {(activity || []).length > 0 ? (
          <View style={styles.seccion}>
            <ActivityList
              items={activity}
              tema={tema}
              onVerToda={() => irA('Notifications', { filter: 'clubes', clubId: activeClubId })}
              onPressItem={verActividad}
            />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ── «Mis clubes»: cambiar de club activo ─────────────────────────────── */

/**
 * Hoja que reemplaza al selector de chips y al carrusel de resumen de la
 * portada anterior: lista mis clubes con mi rol y sus integrantes, marca el
 * activo y ofrece crear o unirse mientras quede lugar (tope de 3).
 */
function MisClubesHoja({ clubs, activeClubId, onSelect, onCrear, onUnirse, onCerrar }) {
  const lista = clubs || [];
  const libres = Math.max(0, MAX_CLUBES_POR_JUGADOR - lista.length);
  const rol = { admin: 'Administrador', capitan: 'Capitán', jugador: 'Jugador' };

  return (
    <Pressable style={styles.hojaFondo} onPress={onCerrar} accessibilityLabel="Cerrar">
      <Pressable style={styles.hoja} onPress={() => {}} accessible={false}>
        <View style={styles.hojaAgarre} />
        <View style={styles.cabeceraSeccion}>
          <Text style={styles.tituloSeccion}>Mis clubes</Text>
          <Text style={styles.subtituloTarjeta}>
            {lista.length} de {MAX_CLUBES_POR_JUGADOR} clubes
          </Text>
        </View>

        <View style={styles.pila}>
          {lista.map(({ club, miRol, totalMiembros }) => {
            const activo = club.id === activeClubId;
            const t = temaDeClub(club);
            return (
              <Pressable
                key={club.id}
                onPress={() => onSelect(club.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: activo }}
                accessibilityLabel={activo ? `${club.nombre}, club activo` : `Cambiar a ${club.nombre}`}
                style={({ pressed }) => [
                  styles.hojaFila,
                  activo && styles.hojaFilaActiva,
                  pressed && { opacity: 0.8 },
                ]}
              >
                <View style={[styles.hojaAro, { borderColor: t.main }]}>
                  <ClubLogo uri={club.foto_url} size={36} borderRadius={18} />
                </View>
                <View style={styles.textos}>
                  <Text style={styles.tituloTarjeta} numberOfLines={1}>
                    {club.nombre}
                  </Text>
                  <Text style={styles.subtituloTarjeta}>
                    {rol[miRol] || 'Integrante'} · {totalMiembros}{' '}
                    {totalMiembros === 1 ? 'integrante' : 'integrantes'}
                  </Text>
                </View>
                {activo ? (
                  <View style={styles.hojaActivo}>
                    <Text style={styles.hojaActivoTexto}>Activo</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>

        {libres > 0 ? (
          <>
            <Text style={styles.hojaLibres}>
              {libres === 1 ? 'Te queda 1 lugar para otro club' : `Te quedan ${libres} lugares para otros clubes`}
            </Text>
            <View style={styles.esperaAcciones}>
              <Pressable
                onPress={onCrear}
                accessibilityRole="button"
                accessibilityLabel="Crear club"
                style={({ pressed }) => [styles.botonSecundario, styles.crece, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.botonSecundarioTexto}>Crear club</Text>
              </Pressable>
              <Pressable
                onPress={onUnirse}
                accessibilityRole="button"
                accessibilityLabel="Unirse a un club"
                style={({ pressed }) => [styles.botonSecundario, styles.crece, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.botonSecundarioTexto}>Unirse a un club</Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </Pressable>
    </Pressable>
  );
}

/* ── Los otros estados ─────────────────────────────────────────────── */

function EstadoDeError({ onReintentar }) {
  return (
    <View style={styles.centrado}>
      <View style={styles.circuloError}>
        <AlertTriangle size={26} color={clubTonos.danger.fg} strokeWidth={2.2} />
      </View>
      <Text style={styles.tituloVacio}>No pudimos cargar tus clubes</Text>
      <Text style={styles.textoVacio}>
        Revisa tu conexión. Tus pendientes y partidos siguen guardados.
      </Text>
      <Pressable
        onPress={onReintentar}
        accessibilityRole="button"
        accessibilityLabel="Reintentar"
        style={({ pressed }) => [styles.botonPrimario, pressed && { opacity: 0.85 }]}
      >
        <Text style={styles.botonPrimarioTexto}>Reintentar</Text>
      </Pressable>
    </View>
  );
}

function SinClub({ invitaciones, onCrear, onExplorar, onResponder }) {
  return (
    <View style={styles.seccion}>
      <View style={styles.sinClubHero}>
        <View style={styles.sinClubEscudo}>
          <ShieldPlus color={C.textSoft} size={22} strokeWidth={2} />
        </View>
        <Text style={styles.tituloVacio}>Aún no estás en un club</Text>
        <Text style={styles.textoVacio}>
          Crea el tuyo o busca uno para sumarte. Puedes estar en hasta {MAX_CLUBES_POR_JUGADOR} clubes.
        </Text>
      </View>
      <Pressable
        onPress={onCrear}
        accessibilityRole="button"
        accessibilityLabel="Crear club"
        style={({ pressed }) => [styles.botonPrimario, pressed && { backgroundColor: C.greenActive }]}
      >
        <Text style={styles.botonPrimarioTexto}>Crear club</Text>
      </Pressable>
      <Pressable
        onPress={onExplorar}
        accessibilityRole="button"
        accessibilityLabel="Explorar clubes"
        style={({ pressed }) => [styles.botonSecundario, styles.conIcono, pressed && { opacity: 0.85 }]}
      >
        <Search color={C.textPrimary} size={16} strokeWidth={2.2} />
        <Text style={styles.botonSecundarioTexto}>Explorar clubes</Text>
      </Pressable>

      <Invitaciones lista={invitaciones} onResponder={onResponder} />
    </View>
  );
}

function SolicitudEnRevision({ solicitudes, invitaciones, onVerClub, onResponder, onCancelar }) {
  const solicitud = (solicitudes || [])[0];
  const t = temaDeClub(solicitud?.club);

  return (
    <View style={styles.seccion}>
      {solicitud ? (
        <View style={styles.tarjetaEspera}>
          <View style={styles.esperaCabecera}>
            <View style={[styles.aroLogo, { borderColor: t.main }]}>
              <ClubLogo uri={solicitud.club?.foto_url} size={36} borderRadius={18} />
            </View>
            <View style={styles.textos}>
              <Text style={styles.tituloTarjeta} numberOfLines={1}>
                {solicitud.club?.nombre || 'Un club'}
              </Text>
              <Text style={styles.subtituloTarjeta}>
                {haceCuanto(solicitud.created_at)
                  ? `Solicitud enviada hace ${haceCuanto(solicitud.created_at)}`
                  : 'Solicitud enviada'}
              </Text>
            </View>
          </View>

          <View style={styles.esperaAviso}>
            <Clock size={14} color={C.textSecondary} strokeWidth={2.2} />
            <Text style={styles.esperaAvisoTexto}>En revisión por los administradores</Text>
          </View>

          <Text style={styles.textoAyuda}>
            Mientras un administrador responde no puedes desafiar clubes ni entrar a una
            nómina. Puedes seguir jugando partidos abiertos.
          </Text>

          <View style={styles.esperaAcciones}>
            <Pressable
              onPress={() => onVerClub(solicitud.club_id)}
              accessibilityRole="button"
              accessibilityLabel="Ver el club"
              style={({ pressed }) => [styles.botonChico, styles.botonChicoVerde, styles.crece, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.botonChicoVerdeTexto}>Ver el club</Text>
            </Pressable>
            <Pressable
              onPress={() => onCancelar(solicitud)}
              accessibilityRole="button"
              accessibilityLabel="Cancelar solicitud"
              style={({ pressed }) => [styles.botonChico, styles.crece, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.botonChicoTexto}>Cancelar solicitud</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <Invitaciones lista={invitaciones} onResponder={onResponder} />
    </View>
  );
}

function Invitaciones({ lista, onResponder }) {
  const filas = lista || [];
  if (filas.length === 0) return null;

  return (
    <View style={[styles.pila, styles.invitacionesBloque]}>
      <View style={styles.tituloConBadge}>
        <Text style={styles.tituloSeccion}>Invitaciones recibidas</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeTexto}>{filas.length}</Text>
        </View>
      </View>
      {filas.map((inv) => {
        const club = inv.club || {};
        const t = temaDeClub(club);
        const meta = ['Te invitó a unirte', club.comuna, modalidadInline(club.modalidad)]
          .filter(Boolean)
          .join(' · ');
        return (
          <View key={inv.request_id} style={styles.invitacion}>
            <View style={styles.esperaCabecera}>
              <View style={[styles.aroLogo, { borderColor: t.main }]}>
                <ClubLogo uri={club.foto_url} size={36} borderRadius={18} />
              </View>
              <View style={styles.textos}>
                <Text style={styles.tituloTarjeta} numberOfLines={1}>
                  {club.nombre || 'Un club'}
                </Text>
                <Text style={styles.subtituloTarjeta} numberOfLines={1}>
                  {meta}
                </Text>
              </View>
            </View>
            <View style={styles.esperaAcciones}>
              <Pressable
                onPress={() => onResponder(inv, true)}
                accessibilityRole="button"
                accessibilityLabel={`Aceptar la invitación de ${club.nombre || 'el club'}`}
                style={({ pressed }) => [styles.botonChico, styles.botonChicoVerde, styles.crece, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.botonChicoVerdeTexto}>Aceptar</Text>
              </Pressable>
              <Pressable
                onPress={() => onResponder(inv, false)}
                accessibilityRole="button"
                accessibilityLabel={`Rechazar la invitación de ${club.nombre || 'el club'}`}
                style={({ pressed }) => [styles.botonChico, styles.crece, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.botonChicoTexto}>Rechazar</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Opacidad 0→1 y un desplazamiento de 12px, una sola vez al montar. */
function EntradaSuave({ children }) {
  const progreso = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progreso, {
      toValue: 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progreso]);

  return (
    <Animated.View
      style={{
        flex: 1,
        opacity: progreso,
        transform: [{ translateY: progreso.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}

/* ── Helpers de presentación ───────────────────────────────────────── */

/**
 * El subtítulo de la cabecera. Lo redacta la pantalla porque depende de dos
 * datos que solo ella tiene juntos: en qué situación está el usuario y
 * cuántos clubes hay.
 */
function subtituloDe({ membership, clubs, club, sentRequests, invitations }) {
  if (membership === 'pending') {
    // `'pending'` cubre dos situaciones distintas y no dan el mismo texto:
    // quien envió una solicitud espera respuesta, y a quien lo invitaron le
    // toca responder a él. Decirle «Solicitud en revisión» a alguien que
    // nunca postuló le atribuye algo que no hizo.
    if ((sentRequests || []).length > 0) return 'Solicitud en revisión';
    if ((invitations || []).length > 0) return 'Tienes una invitación';
    return 'Aún sin club';
  }
  if (membership !== 'member' || !club) return 'Aún sin club';
  return (clubs || []).length > 1 ? `Club activo · ${club.nombre}` : club.nombre;
}

function fechaLegible(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleString('es-CL', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { paddingTop: 4 },
  bannerHueco: { paddingHorizontal: 16, paddingBottom: 8 },
  seccion: { paddingHorizontal: 16, gap: 12, marginBottom: 23 },
  seccionSuelta: { gap: 12, marginBottom: 23 },
  conMargenLateral: { paddingHorizontal: 16 },
  pila: { gap: 9 },
  cabeceraSeccion: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tituloConBadge: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tituloSeccion: { fontSize: 15.5, fontFamily: F.extraBold, color: '#FFFFFF' },
  badge: {
    minWidth: 21,
    height: 21,
    borderRadius: 8,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    // El número de pendientes no es identidad del club: va en el verde de la app.
    backgroundColor: C.green,
  },
  badgeTexto: { fontSize: 12, fontFamily: F.extraBold, color: C.bg },
  verTodo: { fontSize: 12.5, fontFamily: F.bold },
  verMas: {
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: alfa(C.tinta, 0.16),
    alignItems: 'center',
  },
  verMasTexto: { fontSize: 12.5, fontFamily: F.bold, color: C.textDim },

  // Notificaciones del club (la campana)
  avisosCabecera: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 16,
  },
  avisosVolver: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  avisosTitulo: { fontSize: 20, fontFamily: F.extraBold, color: C.textPrimary },
  conMargenAbajo: { marginBottom: 0 },

  // Hoja «Mis clubes»
  hojaFondo: { flex: 1, justifyContent: 'flex-end', backgroundColor: C.scrim },
  hoja: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 34,
    gap: 14,
  },
  hojaAgarre: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.grip,
    marginBottom: 4,
  },
  hojaFila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surfaceAlt,
  },
  hojaFilaActiva: { borderColor: C.greenBorder },
  hojaAro: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hojaActivo: {
    paddingHorizontal: 9,
    height: 22,
    borderRadius: 999,
    justifyContent: 'center',
    backgroundColor: C.greenSoft,
  },
  hojaActivoTexto: { fontSize: 11.5, fontFamily: F.bold, color: C.green },
  hojaLibres: { fontSize: 12.5, color: C.textSecondary, textAlign: 'center' },

  centrado: { alignItems: 'center', gap: 10, paddingVertical: 34, paddingHorizontal: 8 },
  circuloError: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: clubTonos.danger.soft,
    marginBottom: 4,
  },
  cargandoTareas: {
    fontSize: 13,
    lineHeight: 19,
    color: C.textFaint,
    paddingVertical: 14,
  },
  tituloVacio: { fontSize: 20, fontFamily: F.extraBold, color: C.textPrimary, textAlign: 'center' },
  textoVacio: {
    fontSize: 13.5,
    lineHeight: 19,
    color: C.textSecondary,
    textAlign: 'center',
  },
  botonPrimario: {
    height: 50,
    paddingHorizontal: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.green,
  },
  botonPrimarioTexto: { fontSize: 15, fontFamily: F.extraBold, color: C.textOnGreen },
  botonSecundario: {
    height: 48,
    paddingHorizontal: 18,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  botonSecundarioTexto: { fontSize: 14, fontFamily: F.bold, color: C.textPrimary },
  crece: { flex: 1 },
  conIcono: { flexDirection: 'row', gap: 8 },
  sinClubHero: { alignItems: 'center', gap: 8, paddingTop: 18, paddingBottom: 6 },
  sinClubEscudo: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: C.dashedBorderStrong,
    backgroundColor: C.surface,
    marginBottom: 6,
  },
  invitacionesBloque: { marginTop: 14 },
  aroLogo: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  esperaAviso: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    height: 36,
    borderRadius: 10,
    backgroundColor: C.surfaceAlt,
  },
  esperaAvisoTexto: { fontSize: 12.5, color: C.textSecondary },
  textoAyuda: { fontSize: 12, lineHeight: 17, color: C.textSecondary },
  botonChico: {
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.surfaceAlt,
    borderWidth: 1,
    borderColor: C.border,
  },
  botonChicoVerde: { backgroundColor: C.green, borderColor: C.green },
  botonChicoTexto: { fontSize: 14, fontFamily: F.bold, color: C.textPrimary },
  botonChicoVerdeTexto: { fontSize: 14, fontFamily: F.extraBold, color: C.textOnGreen },

  tarjetaEspera: {
    gap: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  esperaCabecera: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  esperaAcciones: { flexDirection: 'row', gap: 9 },
  textos: { flex: 1, minWidth: 0, gap: 2 },
  tituloTarjeta: { fontSize: 15, fontFamily: F.extraBold, color: C.textPrimary },
  subtituloTarjeta: { fontSize: 12, color: C.textSecondary },

  invitacion: {
    gap: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
});
