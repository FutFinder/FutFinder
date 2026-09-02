import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Animated,
  StyleSheet,
  Easing,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { AlertTriangle, Check, X, Clock } from 'lucide-react-native';

import { clubsExplorer as CE, clubTonos, clubSuperficies } from '../theme/colors';
import { temaDeClub } from '../theme/clubThemes';
import { respondToRequest, cancelRequest } from '../services/clubs';
import { lugarLabel } from '../services/clubMatchRules';
import { ratingLabel as formatearRating, metaRival, nivelInline } from '../utils/clubMeta';
import { haceCuanto } from '../utils/tiempoRelativo.js';
import { etiquetaBadge } from '../utils/clubsHomeTasks.js';
import { useClubsHome } from '../contexts/ClubsHomeContext';

import ClubsHeader from '../components/club/ClubsHeader';
import ClubSwitcher from '../components/club/ClubSwitcher';
import PendingTaskCard from '../components/club/PendingTaskCard';
import AllClearBanner from '../components/club/AllClearBanner';
import NextMatchCard from '../components/club/NextMatchCard';
import QuickActionGrid from '../components/club/QuickActionGrid';
import ClubSummaryCard from '../components/club/ClubSummaryCard';
import ActivityList from '../components/club/ActivityList';
import SkeletonHome from '../components/club/SkeletonHome';
import RivalClubCard from '../components/club/RivalClubCard';
import Banner from '../components/Banner';

/**
 * Pestaña «Clubes»: la portada.
 *
 * ANTES ESTA PANTALLA NO TENÍA INTERFAZ. Consultaba la membresía y embebía
 * `ClubDetailScreen` o `ClubExplorer`, así que entrar a Clubes era entrar al
 * detalle de un club: para responder un desafío o revisar la nómina había que
 * bajar por toda la ficha. Ahora la pestaña abre un centro de control y el
 * detalle queda a un toque explícito, desde «Mi club» o «Ver club».
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
    cargado,
    error,
    membership,
    clubs,
    activeClubId,
    club,
    role,
    can,
    limits,
    tasks,
    reparto,
    badgeCount,
    nextMatch,
    nextMatchCupos,
    nextMatchPlazo,
    activity,
    suggestedRivals,
    invitations,
    sentRequests,
    retry,
    reload,
    setActiveClub,
  } = useClubsHome();

  const [banner, setBanner] = useState(null);
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

  const onAccionRapida = useCallback(
    (clave) => {
      const destinos = {
        club: ['ClubDetail', { clubId: activeClubId }],
        desafios: ['ClubChallenges', { clubId: activeClubId }],
        // `modoRival: true` es lo que hace que ExploreClubs deje de ser el
        // catálogo completo y liste sólo clubes desafiables; sin él,
        // `retadorClubId` se ignora y aparecen hasta los clubes propios.
        rivales: [
          'ExploreClubs',
          { modoRival: true, retadorClubId: can?.responderDesafios ? activeClubId : null },
        ],
        partido: nextMatch
          ? ['ClubMatchRoster', { matchId: nextMatch.id }]
          : ['ClubChallenges', { clubId: activeClubId }],
        integrantes: ['ClubMembers', { clubId: activeClubId }],
        ajustes: ['EditClub', { club }],
      };
      const destino = destinos[clave];
      if (destino) irA(destino[0], destino[1]);
    },
    [activeClubId, can, club, nextMatch, irA]
  );

  const onTarea = useCallback(
    (tarea) => {
      // `target` lo decide `clubsHomeTasks.js` y son nombres de ruta reales.
      const params = {
        ClubChallenges: { clubId: activeClubId },
        ClubMatchChange: nextMatch ? { matchId: nextMatch.id } : {},
        ClubMatchRoster: nextMatch ? { matchId: nextMatch.id } : {},
        ClubMembers: { clubId: activeClubId },
        ClubDetail: { clubId: activeClubId },
      };
      irA(tarea.target, params[tarea.target] || {});
    },
    [activeClubId, nextMatch, irA]
  );

  const cabecera = (
    <ClubsHeader
      subtitulo={subtituloDe({ membership, clubs, club, sentRequests, invitations })}
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

  const contenido =
    membership === 'member' ? (
      <Portada
        {...{
          clubs,
          activeClubId,
          club,
          role,
          can,
          limits,
          tasks,
          reparto,
          badgeCount,
          nextMatch,
          nextMatchCupos,
          nextMatchPlazo,
          activity,
          suggestedRivals,
          tema,
          setActiveClub,
          onAccionRapida,
          onTarea,
          irA,
        }}
      />
    ) : membership === 'pending' ? (
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

/* ── La portada de quien sí tiene club ─────────────────────────────── */

function Portada({
  clubs,
  activeClubId,
  club,
  role,
  can,
  limits,
  tasks,
  reparto,
  badgeCount,
  nextMatch,
  nextMatchCupos,
  nextMatchPlazo,
  activity,
  suggestedRivals,
  tema,
  setActiveClub,
  onAccionRapida,
  onTarea,
  irA,
}) {
  const sinTareas = (tasks || []).length === 0;
  // El selector sólo aparece con más de un club: la decisión es de acá, no
  // del componente, porque de ella depende la separación entre secciones.
  const hayVariosClubes = (clubs || []).length > 1;

  return (
    <>
      {hayVariosClubes ? (
        <View style={styles.seccionSuelta}>
          <ClubSwitcher
            clubs={clubs}
            activeClubId={activeClubId}
            tema={tema}
            onSelect={setActiveClub}
            onExplorar={() => irA('ExploreClubs')}
          />
        </View>
      ) : null}

      <View style={styles.seccion}>
        <View style={styles.cabeceraSeccion}>
          <View style={styles.tituloConBadge}>
            <Text style={styles.tituloSeccion}>Pendiente para ti</Text>
            {/* El badge se enciende con el número que muestra, no con la
                cantidad de tarjetas: con una única tarea vencida había
                tareas que enseñar pero el badge decía «0».

                Y el ROTULO sale de `etiquetaBadge()`, el mismo que usa la
                barra inferior: acá se pintaba el número entero mientras la
                barra cortaba en «9+», así que con doce pendientes los dos
                badges del mismo dato decían cosas distintas. */}
            {badgeCount > 0 ? (
              <View style={[styles.badge, { backgroundColor: tema.main }]}>
                <Text style={[styles.badgeTexto, { color: tema.ink }]}>
                  {etiquetaBadge(badgeCount)}
                </Text>
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

        {sinTareas ? (
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
              />
            ))}
            {reparto.etiquetaVerMas ? (
              <Pressable
                onPress={() => irA('Notifications')}
                accessibilityRole="button"
                accessibilityLabel={reparto.etiquetaVerMas}
                style={({ pressed }) => [styles.verMas, pressed && { opacity: 0.7 }]}
              >
                {/* El texto y su plural vienen resueltos de `repartirTareas()`. */}
                <Text style={styles.verMasTexto}>{reparto.etiquetaVerMas}</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </View>

      {nextMatch ? (
        <View style={styles.seccion}>
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
          />
        </View>
      ) : null}

      <View style={styles.seccion}>
        <QuickActionGrid
          tema={tema}
          can={can}
          badges={{ desafios: contarPorTipo(tasks, 'desafio') }}
          onPress={onAccionRapida}
        />
      </View>

      <View style={styles.seccion}>
        <ClubSummaryCard
          club={club}
          tema={tema}
          rol={role}
          stats={club?.estadisticas}
          ratingLabel={formatearRating(club?.rating)}
          totalMiembros={limits?.members?.used}
          maxMiembros={limits?.members?.max}
          onVerClub={() => irA('ClubDetail', { clubId: activeClubId })}
        />
      </View>

      {/* `ActivityList` devuelve null sin actividad, pero el margen del
          contenedor no: sin esta guardia quedaba un hueco de 23px. */}
      {(activity || []).length > 0 ? (
        <View style={styles.seccion}>
          <ActivityList
            items={activity}
            tema={tema}
            onVerToda={() => irA('Notifications')}
            onPressItem={() => irA('Notifications')}
          />
        </View>
      ) : null}

      {(suggestedRivals || []).length > 0 ? (
        <View style={styles.seccionSuelta}>
          <View style={[styles.cabeceraSeccion, styles.conMargenLateral]}>
            <Text style={styles.tituloSeccion}>Rivales sugeridos</Text>
            <Pressable
              onPress={() => irA('ExploreClubs', { modoRival: true, retadorClubId: activeClubId })}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Ver todos los rivales"
            >
              <Text style={[styles.verTodo, { color: tema.main }]}>Ver todos</Text>
            </Pressable>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.carrusel}
          >
            {suggestedRivals.slice(0, 10).map((rival) => (
              <View key={rival.id} style={styles.rival}>
                <RivalClubCard
                  club={rival}
                  meta={metaRival({ distanciaKm: rival.distanciaKm, modalidad: rival.modalidad })}
                  ratingLabel={formatearRating(rival.rating)}
                  nivelLabel={nivelInline(rival.nivel)}
                  onPress={() => irA('ClubDetail', { clubId: rival.id })}
                  onChallenge={() =>
                    // `ClubChallengeScreen` lee estos tres y elige el club
                    // retador por su cuenta. Sin el nombre y el escudo, el
                    // formulario abre con «Club rival» y el escudo genérico.
                    irA('ClubChallenge', {
                      rivalClubId: rival.id,
                      rivalNombre: rival.nombre,
                      rivalFotoUrl: rival.foto_url,
                    })
                  }
                  puedeDesafiar={!!can?.responderDesafios}
                />
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </>
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
      <View style={styles.centrado}>
        <Text style={styles.tituloVacio}>Aún no tienes club</Text>
        <Text style={styles.textoVacio}>
          Crea el tuyo y arma tu plantel, o busca uno al que unirte.
        </Text>
        <Pressable
          onPress={onCrear}
          accessibilityRole="button"
          accessibilityLabel="Crear club"
          style={({ pressed }) => [styles.botonPrimario, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.botonPrimarioTexto}>Crear club</Text>
        </Pressable>
        <Pressable
          onPress={onExplorar}
          accessibilityRole="button"
          accessibilityLabel="Explorar clubes"
          style={({ pressed }) => [styles.botonSecundario, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.botonSecundarioTexto}>Explorar clubes</Text>
        </Pressable>
      </View>

      <Invitaciones lista={invitaciones} onResponder={onResponder} />
    </View>
  );
}

function SolicitudEnRevision({ solicitudes, invitaciones, onVerClub, onResponder, onCancelar }) {
  const solicitud = (solicitudes || [])[0];

  return (
    <View style={styles.seccion}>
      {solicitud ? (
        <View style={styles.tarjetaEspera}>
          <View style={styles.esperaCabecera}>
            <View style={styles.circuloEspera}>
              <Clock size={17} color={clubTonos.warn.fg} strokeWidth={2.2} />
            </View>
            <View style={styles.textos}>
              <Text style={styles.tituloTarjeta}>Solicitud en revisión</Text>
              <Text style={styles.subtituloTarjeta}>
                {solicitud.club?.nombre || 'Un club'}
                {haceCuanto(solicitud.created_at) ? ` · hace ${haceCuanto(solicitud.created_at)}` : ''}
              </Text>
            </View>
          </View>

          <Text style={styles.textoVacio}>
            Mientras un administrador responde no puedes desafiar clubes ni entrar a una
            nómina. Puedes seguir jugando partidos abiertos.
          </Text>

          <View style={styles.esperaAcciones}>
            <Pressable
              onPress={() => onVerClub(solicitud.club_id)}
              accessibilityRole="button"
              accessibilityLabel="Ver el club"
              style={({ pressed }) => [styles.botonSecundario, styles.crece, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.botonSecundarioTexto}>Ver el club</Text>
            </Pressable>
            <Pressable
              onPress={() => onCancelar(solicitud)}
              accessibilityRole="button"
              accessibilityLabel="Cancelar solicitud"
              style={({ pressed }) => [styles.botonSecundario, pressed && { opacity: 0.85 }]}
            >
              <Text style={[styles.botonSecundarioTexto, { color: clubTonos.danger.fg }]}>
                Cancelar
              </Text>
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
    <View style={styles.pila}>
      <Text style={styles.tituloSeccion}>Invitaciones</Text>
      {filas.map((inv) => (
        <View key={inv.request_id} style={styles.invitacion}>
          <View style={styles.textos}>
            <Text style={styles.tituloTarjeta} numberOfLines={1}>
              {inv.club?.nombre || 'Un club'}
            </Text>
            <Text style={styles.subtituloTarjeta}>te invitó a unirte</Text>
          </View>
          <Pressable
            onPress={() => onResponder(inv, true)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Aceptar la invitación de ${inv.club?.nombre || 'el club'}`}
            style={({ pressed }) => [styles.iconoAceptar, pressed && { opacity: 0.75 }]}
          >
            <Check size={17} color="#0B1F0E" strokeWidth={2.6} />
          </Pressable>
          <Pressable
            onPress={() => onResponder(inv, false)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Rechazar la invitación de ${inv.club?.nombre || 'el club'}`}
            style={({ pressed }) => [styles.iconoRechazar, pressed && { opacity: 0.75 }]}
          >
            <X size={17} color="rgba(255,255,255,0.6)" strokeWidth={2.4} />
          </Pressable>
        </View>
      ))}
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

/**
 * Cuántas tareas accionables hay de un tipo, para el badge de un tile.
 *
 * Esto sí se puede contar acá: lee `type` y `status`, que son campos del
 * contrato, no el texto que se le muestra a alguien.
 */
function contarPorTipo(tasks, tipo) {
  return (tasks || []).filter((t) => t.type === tipo && t.status === 'abierta').length;
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
  root: { flex: 1, backgroundColor: CE.bg },
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
  tituloSeccion: { fontSize: 15.5, fontWeight: '800', color: '#FFFFFF' },
  badge: {
    minWidth: 21,
    height: 21,
    borderRadius: 8,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeTexto: { fontSize: 12, fontWeight: '800' },
  verTodo: { fontSize: 12.5, fontWeight: '700' },
  verMas: {
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255, 255, 255, 0.16)',
    alignItems: 'center',
  },
  verMasTexto: { fontSize: 12.5, fontWeight: '700', color: 'rgba(255, 255, 255, 0.6)' },
  carrusel: { paddingHorizontal: 16, gap: 10 },
  rival: { width: 172 },

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
  tituloVacio: { fontSize: 17, fontWeight: '800', color: '#FFFFFF', textAlign: 'center' },
  textoVacio: {
    fontSize: 13,
    lineHeight: 19,
    color: 'rgba(255, 255, 255, 0.45)',
    textAlign: 'center',
  },
  botonPrimario: {
    marginTop: 6,
    minWidth: 180,
    height: 48,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CE.green,
  },
  botonPrimarioTexto: { fontSize: 14, fontWeight: '700', color: '#04140A' },
  botonSecundario: {
    minWidth: 140,
    height: 46,
    paddingHorizontal: 18,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  botonSecundarioTexto: { fontSize: 13.5, fontWeight: '700', color: '#FFFFFF' },
  crece: { flex: 1 },

  tarjetaEspera: {
    gap: 12,
    padding: 15,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 197, 49, 0.3)',
    backgroundColor: clubTonos.warn.soft,
  },
  esperaCabecera: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  circuloEspera: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
  },
  esperaAcciones: { flexDirection: 'row', gap: 9 },
  textos: { flex: 1, minWidth: 0, gap: 2 },
  tituloTarjeta: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  subtituloTarjeta: { fontSize: 12, color: 'rgba(255, 255, 255, 0.5)' },

  invitacion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: clubSuperficies.borde,
    backgroundColor: clubSuperficies.card,
  },
  iconoAceptar: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CE.green,
  },
  iconoRechazar: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
});
