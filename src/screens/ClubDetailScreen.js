import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Share,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft,
  UserPlus,
  Swords,
  Zap,
  Rows3,
  Users,
  ShieldCheck,
  ChevronRight,
  Trophy,
  Search,
} from 'lucide-react-native';

import { paleta as C, radios as R, medidas as S, fuentes as F } from '../theme/colors';
import { temaDeClub } from '../theme/clubThemes';
import Banner from '../components/Banner';
import ClubHeader from '../components/club/ClubHeader';
import ReportPlayerSheet from '../components/player/ReportPlayerSheet';
import { reportarContenido } from '../services/reports';
import RivalClubCard, { ANCHO_TARJETA_RIVAL } from '../components/club/RivalClubCard';
import ClubPhotoGallery from '../components/club/ClubPhotoGallery';
import EmptyStateCard from '../components/ds/EmptyStateCard';
import { getCurrentUser } from '../services/auth';
import {
  getClubById,
  listMembers,
  getMyClubs,
  getMyRequestTo,
  requestToJoin,
  cancelRequest,
  listRivalCandidates,
  listPendingRequests,
  MAX_CLUBES_POR_JUGADOR,
} from '../services/clubs';
import { getClubUnreadCount } from '../services/messages';
import { getClubPhotos } from '../services/clubGallery';
import { getMisPermisosEnClub } from '../services/clubPermissions';
import {
  getClubMatchHistory,
  getClubEstadisticas,
  ESTADISTICAS_VACIAS,
} from '../services/clubMatches';
import { RESULTADO, resumenEstadisticas } from '../utils/historialClub';
import { distanciaEntreClubesKm } from '../utils/clubMeta';
import { CLUB_LIMITS } from '../utils/clubLimits';

/** Máximo de rivales en el carrusel. */
const MAX_RIVALES = 10;
/** Partidos visibles en la muestra del historial. */
const MAX_HISTORIAL = 3;

/**
 * Ficha del club.
 *
 * REDISEÑO DE CLUBES (2026-11-26). Se reordenó la pantalla según el diseño de
 * Claude Design sin quitar ni agregar funciones: cabecera con la foto del
 * club (`ClubHeader`), descripción, la acción principal para quien no es del
 * club, próximo partido (en la portada), rivales cercanos, accesos del club
 * (desafíos abiertos y alineación), historial, fotos y administración.
 *
 * LA MISMA FICHA ES LA PORTADA DE LA PESTAÑA CLUBES. `ClubsScreen` monta
 * `FichaClub` con la prop `portada`, que cambia volver por «Mis clubes» y
 * agrega el calendario, la campana de avisos y el próximo partido. Así la
 * portada y la ficha no pueden divergir: son el mismo componente.
 *
 * TODO LO QUE MUESTRA ES REAL: club, integrantes, fotos, rivales (con la
 * distancia calculada desde la comuna), historial y estadísticas. El nivel
 * (migración 199) reemplaza al rating, que no existe en la base.
 *
 * COLOR: el tema del club es sólo un acento —aro del logo, filete del
 * banner, enlaces—. Las acciones principales son el verde de la app y el
 * resultado de los partidos conserva sus colores en los cuatro temas.
 */
export default function ClubDetailScreen({ navigation, route }) {
  const { clubId, initialBanner } = route.params || {};
  return <FichaClub key={clubId} clubId={clubId} navigation={navigation} initialBanner={initialBanner} />;
}

/**
 * @param {object} [portada]  Sólo desde la pestaña Clubes:
 *   { totalClubes, onMisClubes, onAvisos, avisosCount, proximoPartido (nodo),
 *     respuestasPorDecidir, paddingBottom }
 */
export function FichaClub({ clubId, navigation, initialBanner, portada }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [club, setClub] = useState(null);
  const [members, setMembers] = useState([]);
  const [me, setMe] = useState(null);
  const [myClubs, setMyClubs] = useState([]);
  const [myRequest, setMyRequest] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [rivals, setRivals] = useState([]);
  const [historial, setHistorial] = useState([]);
  const [historialError, setHistorialError] = useState(null);
  const [estadisticas, setEstadisticas] = useState(ESTADISTICAS_VACIAS);
  const [misPermisos, setMisPermisos] = useState(null);
  const [chatSinLeer, setChatSinLeer] = useState(false);
  const [solicitudesPendientes, setSolicitudesPendientes] = useState(0);
  const [banner, setBanner] = useState(initialBanner || null);
  const [working, setWorking] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  // Un club que todavía no cargó —o uno anterior a la migración 53— resuelve
  // a verde, así la pantalla nunca se queda sin color.
  const tema = temaDeClub(club);

  const soyMiembro = members.some((m) => m.user_id === me);
  const soyAdmin = members.some((m) => m.user_id === me && m.rol === 'admin');
  // Editar el club es delegable (migración 119): un capitán o jugador con
  // el permiso concedido también ve el lápiz del encabezado.
  const puedeEditarClub = soyAdmin || !!misPermisos?.editClub;
  // Publicar/crear desafíos también es delegable (permiso `pubChallenge`).
  const puedePublicarDesafios = soyAdmin || !!misPermisos?.pubChallenge;
  const tengoMaxClubs = myClubs.length >= MAX_CLUBES_POR_JUGADOR;
  // Puedo desafiar a este club si soy admin de OTRO club distinto.
  const puedoDesafiar =
    !soyMiembro && (myClubs || []).some((c) => c.miRol === 'admin' && c.club?.id !== clubId);
  // Soy admin de algún club → puedo desafiar a los rivales del carrusel.
  const puedoDesafiarRivales = (myClubs || []).some((c) => c.miRol === 'admin');

  // Token de la carga vigente: si el usuario navega adentro/afuera rápido,
  // `useFocusEffect` dispara varios `load()` seguidos, y sin esto la
  // respuesta de uno viejo podía llegar DESPUÉS que la de uno nuevo y pisar
  // el estado con datos que ya no corresponden.
  const loadTokenRef = useRef(0);

  const load = useCallback(async () => {
    const token = ++loadTokenRef.current;
    const user = await getCurrentUser();
    const myId = user?.id || null;
    if (token !== loadTokenRef.current) return;
    setMe(myId);

    const [
      { data: c },
      { data: ms },
      { data: mine },
      { data: ph },
      { data: candidatos },
      { data: partidos, error: errHistorial },
      { data: stats },
    ] = await Promise.all([
      getClubById(clubId),
      listMembers(clubId),
      getMyClubs(),
      getClubPhotos(clubId),
      listRivalCandidates({ retadorClubId: clubId }),
      getClubMatchHistory(clubId),
      getClubEstadisticas(clubId),
    ]);
    if (token !== loadTokenRef.current) return;

    setClub(c);
    setMembers(ms || []);
    setMyClubs(mine || []);
    setPhotos(ph || []);

    const yo = (ms || []).find((m) => m.user_id === myId);
    if (yo) {
      // El punto rojo del chat sale del mismo contador de no leídos que usa
      // la bandeja de Chat (`get_chat_unread_counts`): no hay un dato nuevo.
      const [{ data: permisos }, { data: sinLeer }, pendientes] = await Promise.all([
        getMisPermisosEnClub(clubId),
        getClubUnreadCount(clubId),
        yo.rol === 'admin' ? listPendingRequests(clubId) : Promise.resolve({ data: [] }),
      ]);
      if (token !== loadTokenRef.current) return;
      setMisPermisos(permisos?.permisos || null);
      setChatSinLeer((sinLeer || 0) > 0);
      setSolicitudesPendientes((pendientes?.data || []).length);
    } else {
      setMisPermisos(null);
      setChatSinLeer(false);
      setSolicitudesPendientes(0);
    }

    // «NO SE PUDO LEER» NO ES «NO HAY PARTIDOS»: `cargarHistorial` distingue
    // las dos cosas y la pantalla también.
    setHistorial(partidos || []);
    setHistorialError(errHistorial || null);
    setEstadisticas(stats || ESTADISTICAS_VACIAS);

    // Rivales: los candidatos ya vienen sin este club ni ninguno de los míos
    // —la exclusión la hace la consulta—, ordenados por distancia real cuando
    // se puede calcular; los que no tienen comuna conocida van al final.
    const conDistancia = (candidatos || []).map((r) => ({
      ...r,
      distanciaKm: c ? distanciaEntreClubesKm(c, r) : null,
    }));
    conDistancia.sort((a, b) => {
      if (a.distanciaKm === null) return 1;
      if (b.distanciaKm === null) return -1;
      return a.distanciaKm - b.distanciaKm;
    });
    setRivals(conDistancia.slice(0, MAX_RIVALES));

    if (!yo && myId) {
      const { data: mr } = await getMyRequestTo(clubId);
      if (token !== loadTokenRef.current) return;
      setMyRequest(mr);
    } else {
      setMyRequest(null);
    }
    setLoading(false);
  }, [clubId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleJoin = async () => {
    setWorking(true);
    const { error } = await requestToJoin(clubId);
    setWorking(false);
    if (error) {
      setBanner({ type: 'error', title: 'No se pudo enviar', message: error.message });
      return;
    }
    setBanner({
      type: 'success',
      title: 'Solicitud enviada',
      message: 'Un administrador del club la revisará pronto.',
    });
    await load();
  };

  const handleCancelRequest = async () => {
    if (!myRequest) return;
    setWorking(true);
    const { error } = await cancelRequest(myRequest.id);
    setWorking(false);
    if (error) {
      setBanner({ type: 'error', title: 'Error', message: error.message });
      return;
    }
    setMyRequest(null);
  };

  const handleShare = async () => {
    if (!club) return;
    try {
      await Share.share({
        message: `Mira el club ${club.nombre} en FutFinder${club.comuna ? ` · ${club.comuna}` : ''}`,
      });
    } catch {
      setBanner({
        type: 'error',
        title: 'No se pudo compartir',
        message: 'Inténtalo de nuevo en unos segundos.',
      });
    }
  };

  const goToChallenge = (rival) => {
    navigation.navigate('ClubChallenge', {
      rivalClubId: rival.id,
      rivalNombre: rival.nombre,
      rivalFotoUrl: rival.foto_url || null,
    });
  };

  const goToGallery = () => navigation.navigate('ClubGallery', { clubId });

  // Explorar para elegir rival es distinto de explorar el catálogo: acá los
  // clubes propios no deben aparecer siquiera en la lista. Sólo se declara
  // este club como retador si puedo publicar desafíos en él; si no, el
  // servicio igualmente excluye todos mis clubes.
  const goToElegirRival = () =>
    navigation.navigate('ExploreClubs', {
      modoRival: true,
      retadorClubId: puedePublicarDesafios ? clubId : null,
    });

  const abrirChat = () =>
    navigation.navigate('ChatThread', {
      threadKey: `club:${clubId}`,
      title: club?.nombre,
      subtitle: 'Chat del club',
      fotoUrl: club?.foto_url || null,
    });

  const Contenedor = portada ? View : SafeAreaView;
  const contenedorProps = portada ? { style: styles.root } : { edges: ['top'], style: styles.root };

  if (loading || !club) {
    return (
      <Contenedor {...contenedorProps}>
        {portada ? null : (
          <View style={styles.loadingBar}>
            <Pressable
              onPress={() => navigation.goBack()}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Volver"
              style={({ pressed }) => [styles.loadingBackBtn, pressed && { opacity: 0.6 }]}
            >
              <ArrowLeft color={C.textPrimary} size={18} strokeWidth={2.2} />
            </Pressable>
          </View>
        )}
        <View style={styles.loadingBox}>
          <ActivityIndicator color={C.green} />
        </View>
      </Contenedor>
    );
  }

  const historialVisible = historial.slice(0, MAX_HISTORIAL);
  const admins = members.filter((m) => m.rol === 'admin').length;

  return (
    <Contenedor {...contenedorProps}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: portada?.paddingBottom ?? 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.green} colors={[C.green]} />
        }
      >
        <ClubHeader
          club={club}
          tema={tema}
          totalMiembros={members.length}
          record={estadisticas}
          onBack={portada ? undefined : () => navigation.goBack()}
          misClubes={portada?.totalClubes}
          onMisClubes={portada?.onMisClubes}
          onShare={handleShare}
          // SÓLO el id: React Navigation serializa los params en la URL y un
          // objeto termina como `?club=[object Object]`.
          onEdit={puedeEditarClub ? () => navigation.navigate('EditClub', { clubId: club.id }) : undefined}
          onCalendario={
            soyMiembro
              ? () => navigation.navigate('ClubMatchCalendar', { clubId: club.id, clubNombre: club.nombre })
              : undefined
          }
          onAvisos={portada?.onAvisos}
          avisosCount={portada?.avisosCount || 0}
          onChat={soyMiembro ? abrirChat : undefined}
          chatSinLeer={chatSinLeer}
          // Reportar el club (migración 186): sólo quien tiene cuenta y no es del club.
          onReport={me && !soyMiembro ? () => setReportOpen(true) : undefined}
          onMiembros={() => navigation.navigate('ClubMembers', { clubId: club.id })}
        />

        <View style={styles.cuerpo}>
          {banner ? <Banner {...banner} onClose={() => setBanner(null)} /> : null}

          {club.descripcion ? <Text style={styles.descripcion}>{club.descripcion}</Text> : null}

          {/* ── Acción principal de quien no es del club ──
              Solicitar unirme no se esconde porque también pueda desafiar: se
              puede administrar un club y querer sumarse a otro como jugador. */}
          {!soyMiembro && (!tengoMaxClubs || puedoDesafiar) ? (
            <View style={styles.bloqueAcciones}>
              {!tengoMaxClubs ? (
                <BotonPrincipal
                  label={myRequest ? 'Cancelar solicitud' : 'Solicitar unirme'}
                  Icono={myRequest ? null : UserPlus}
                  onPress={myRequest ? handleCancelRequest : handleJoin}
                  disabled={working}
                  secundario={!!myRequest}
                />
              ) : null}
              {puedoDesafiar ? (
                <BotonPrincipal
                  label="Desafiar a este club"
                  Icono={Swords}
                  onPress={() => goToChallenge(club)}
                  secundario={!tengoMaxClubs}
                />
              ) : null}
              {!tengoMaxClubs ? (
                <Text style={styles.ayuda}>
                  {myRequest
                    ? 'Tu solicitud está en revisión.'
                    : `Un administrador revisa tu solicitud. Puedes estar en hasta ${MAX_CLUBES_POR_JUGADOR} clubes.`}
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* ── Próximo partido (sólo portada; lo arma ClubsScreen) ── */}
          {portada?.proximoPartido ? <View style={styles.seccion}>{portada.proximoPartido}</View> : null}

          {/* ── Rivales cercanos (sólo integrantes) ── */}
          {soyMiembro ? (
            <View style={styles.seccion}>
              <CabeceraSeccion
                titulo="Rivales cercanos"
                enlace="Buscar rivales"
                onEnlace={goToElegirRival}
                color={tema.main}
              />
              {rivals.length === 0 ? (
                <EmptyStateCard
                  icon={<Search color={C.textSecondary} size={18} strokeWidth={2} />}
                  title="Sin rivales cerca"
                  subtitle="Amplía la búsqueda para encontrar más clubes"
                  actionLabel="Buscar clubes"
                  onAction={goToElegirRival}
                  tema={tema}
                />
              ) : (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  snapToAlignment="start"
                  decelerationRate="fast"
                  snapToInterval={ANCHO_TARJETA_RIVAL + 10}
                  contentContainerStyle={styles.carrusel}
                  style={styles.carruselFuera}
                >
                  {rivals.map((r) => (
                    <RivalClubCard
                      key={r.id}
                      club={r}
                      distanciaKm={r.distanciaKm}
                      puedeDesafiar={puedoDesafiarRivales}
                      onPress={() => navigation.navigate('ClubDetail', { clubId: r.id })}
                      onChallenge={() => goToChallenge(r)}
                    />
                  ))}
                </ScrollView>
              )}
            </View>
          ) : null}

          {/* ── Accesos del club (sólo integrantes) ── */}
          {soyMiembro ? (
            <View style={[styles.seccion, styles.lista]}>
              <FilaAcceso
                Icono={Zap}
                titulo="Desafíos abiertos"
                subtitulo="Publica uno o busca rival"
                cuenta={portada?.respuestasPorDecidir || 0}
                onPress={() => navigation.navigate('ClubChallenges', { clubId: club.id })}
              />
              <View style={styles.divisor} />
              <FilaAcceso
                Icono={Rows3}
                titulo="Alineación"
                subtitulo="La formación del club"
                onPress={() => navigation.navigate('ClubLineup', { clubId: club.id })}
              />
            </View>
          ) : null}

          {/* ── Historial ── */}
          <View style={styles.seccion}>
            <CabeceraSeccion
              titulo="Historial"
              enlace={historial.length > MAX_HISTORIAL ? 'Ver todo' : null}
              onEnlace={() =>
                navigation.navigate('ClubHistory', { clubId: club.id, clubNombre: club.nombre })
              }
              color={tema.main}
            />
            {historialError ? (
              // Un fallo de lectura NO se disfraza de historial vacío.
              <EmptyStateCard
                icon={<Trophy color={C.textSecondary} size={18} strokeWidth={2} />}
                title="No se pudo cargar el historial"
                subtitle="Revisa tu conexión y vuelve a intentarlo"
                actionLabel="Reintentar"
                onAction={load}
                tema={tema}
              />
            ) : historialVisible.length === 0 ? (
              <EmptyStateCard
                icon={<Trophy color={C.textSecondary} size={18} strokeWidth={2} />}
                title="Aún no hay partidos en el historial"
                subtitle="Los partidos aparecerán acá cuando tengan un resultado confirmado"
                actionLabel={puedePublicarDesafios ? 'Buscar un rival' : null}
                onAction={puedePublicarDesafios ? goToElegirRival : null}
                variant="solid"
                tema={tema}
              />
            ) : (
              <>
                <View style={styles.historialFila}>
                  {historialVisible.map((p) => (
                    <PartidoMini
                      key={p.id}
                      partido={p}
                      // Al partido sólo entran los integrantes de los dos clubes.
                      onPress={
                        p.soyIntegrante ? () => navigation.navigate('MatchDetail', { matchId: p.id }) : null
                      }
                    />
                  ))}
                </View>
                {estadisticas.pj > 0 ? (
                  // Las tres cifras son del club completo, no de los tres
                  // partidos de arriba. La frase para el lector de pantalla
                  // sale del mismo `resumenEstadisticas` que el historial.
                  <View style={styles.stats} accessible accessibilityLabel={resumenEstadisticas(estadisticas)}>
                    <Estadistica valor={estadisticas.pj} etiqueta="Jugados" />
                    <View style={styles.statsDivisor} />
                    <Estadistica valor={estadisticas.gf} etiqueta="Goles a favor" />
                    <View style={styles.statsDivisor} />
                    <Estadistica valor={estadisticas.gc} etiqueta="Goles en contra" />
                  </View>
                ) : null}
              </>
            )}
          </View>

          {/* ── Fotos ── */}
          <View style={styles.seccion}>
            <CabeceraSeccion
              titulo="Fotos"
              enlace={photos.length > 0 ? 'Ver todas' : null}
              onEnlace={goToGallery}
              color={tema.main}
            />
          </View>
        </View>
        <ClubPhotoGallery
          photos={photos}
          puedeAñadir={soyAdmin}
          onAdd={goToGallery}
          onOpenPhoto={goToGallery}
          tema={tema}
        />

        {/* ── Administración ── */}
        {soyAdmin ? (
          <View style={[styles.cuerpo, styles.seccion]}>
            <View style={styles.adminCabecera}>
              <Text style={styles.tituloSeccion}>Administración</Text>
              <View style={styles.soloAdmins}>
                <Text style={styles.soloAdminsTexto}>Solo administradores</Text>
              </View>
            </View>
            <View style={styles.lista}>
              <FilaAcceso
                Icono={Users}
                titulo="Gestionar miembros"
                subtitulo={`${members.length} de ${CLUB_LIMITS.miembros} integrantes · ${admins} de ${CLUB_LIMITS.admins} administradores`}
                cuenta={solicitudesPendientes}
                onPress={() => navigation.navigate('ClubMembers', { clubId: club.id })}
              />
              <View style={styles.divisor} />
              <FilaAcceso
                Icono={ShieldCheck}
                titulo="Permisos de club"
                subtitulo="Por rol y excepciones por integrante"
                onPress={() => navigation.navigate('PermisosClub', { clubId: club.id, club })}
              />
            </View>
          </View>
        ) : null}
      </ScrollView>

      <ReportPlayerSheet
        visible={reportOpen}
        titulo="Reportar club"
        etiqueta="Club"
        queSeReporta={club.nombre}
        onClose={() => setReportOpen(false)}
        onSubmit={async ({ motivo, descripcion }) => {
          const { error } = await reportarContenido({ tipo: 'club', id: club.id, motivo, descripcion });
          if (error) {
            setBanner({ type: 'error', title: 'No se pudo enviar el reporte', message: error.message });
            return { error };
          }
          setReportOpen(false);
          setBanner({
            type: 'success',
            title: 'Reporte enviado',
            message: 'Lo revisaremos. No le avisamos al club quién lo envió.',
          });
          return {};
        }}
      />
    </Contenedor>
  );
}

/* ── Piezas de la ficha ─────────────────────────────────────────────── */

function CabeceraSeccion({ titulo, enlace, onEnlace, color }) {
  return (
    <View style={styles.cabeceraSeccion}>
      <Text style={styles.tituloSeccion}>{titulo}</Text>
      {enlace ? (
        <Pressable
          onPress={onEnlace}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${enlace}: ${titulo}`}
          style={styles.enlace}
        >
          <Text style={[styles.enlaceTexto, { color }]}>{enlace}</Text>
          <ChevronRight color={color} size={16} strokeWidth={2.4} />
        </Pressable>
      ) : null}
    </View>
  );
}

function BotonPrincipal({ label, Icono, onPress, disabled, secundario }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.boton,
        secundario ? styles.botonSecundario : styles.botonPrimario,
        pressed && (secundario ? { backgroundColor: C.greenSoftStrong } : { backgroundColor: C.greenActive }),
        disabled && { opacity: 0.6 },
      ]}
    >
      {Icono ? <Icono color={secundario ? C.green : C.textOnGreen} size={18} strokeWidth={2.4} /> : null}
      <Text style={[styles.botonTexto, { color: secundario ? C.green : C.textOnGreen }]}>{label}</Text>
    </Pressable>
  );
}

function FilaAcceso({ Icono, titulo, subtitulo, cuenta = 0, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={cuenta > 0 ? `${titulo}, ${cuenta} pendientes` : titulo}
      style={({ pressed }) => [styles.fila, pressed && { backgroundColor: C.surfaceHover }]}
    >
      <View style={styles.filaIcono}>
        <Icono color={C.textSoft} size={18} strokeWidth={2.2} />
      </View>
      <View style={styles.filaTextos}>
        <Text style={styles.filaTitulo}>{titulo}</Text>
        {subtitulo ? <Text style={styles.filaSubtitulo}>{subtitulo}</Text> : null}
      </View>
      {cuenta > 0 ? (
        <View style={styles.cuenta}>
          <Text style={styles.cuentaTexto}>{cuenta > 9 ? '9+' : cuenta}</Text>
        </View>
      ) : null}
      <ChevronRight color={C.textMuted} size={18} strokeWidth={2.2} />
    </Pressable>
  );
}

const LETRA = {
  [RESULTADO.VICTORIA]: { letra: 'V', color: C.win, fondo: C.winSoft },
  [RESULTADO.EMPATE]: { letra: 'E', color: C.draw, fondo: C.drawSoft },
  [RESULTADO.DERROTA]: { letra: 'D', color: C.loss, fondo: C.lossSoft },
};

/** Tarjeta corta del historial: resultado, marcador desde mi club, rival y día. */
function PartidoMini({ partido: p, onPress }) {
  const r = LETRA[p.resultado];
  const conMarcador = p.miMarcador !== null && p.miMarcador !== undefined;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${p.resultadoNombre || ''} ${conMarcador ? `${p.miMarcador} a ${p.suMarcador}` : ''} contra ${p.rivalNombre}, ${p.fechaLabel || ''}`}
      style={({ pressed }) => [styles.mini, pressed && { backgroundColor: C.surfaceHover }]}
    >
      {r ? (
        <View style={[styles.miniLetra, { backgroundColor: r.fondo }]}>
          <Text style={[styles.miniLetraTexto, { color: r.color }]}>{r.letra}</Text>
        </View>
      ) : null}
      <Text style={styles.miniMarcador}>{conMarcador ? `${p.miMarcador} – ${p.suMarcador}` : 'vs'}</Text>
      <Text style={styles.miniRival} numberOfLines={1}>
        {p.rivalNombre}
      </Text>
      {p.fechaLabel ? <Text style={styles.miniFecha}>{p.fechaLabel}</Text> : null}
    </Pressable>
  );
}

function Estadistica({ valor, etiqueta }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValor}>{valor}</Text>
      <Text style={styles.statEtiqueta}>{etiqueta}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  // Carga
  loadingBar: { paddingHorizontal: S.screenPadding, paddingTop: 4, paddingBottom: 12 },
  loadingBackBtn: {
    width: S.iconBtn,
    height: S.iconBtn,
    borderRadius: R.iconBtn,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  cuerpo: { paddingHorizontal: 16 },
  seccion: { marginTop: 26 },
  descripcion: { color: C.textStrong, fontSize: 14, lineHeight: 21, marginTop: 20 },

  bloqueAcciones: { marginTop: 20, gap: 10 },
  boton: {
    height: 50,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  botonPrimario: { backgroundColor: C.green },
  botonSecundario: { borderWidth: 1, borderColor: C.greenBorderStrong, backgroundColor: C.greenSoft },
  botonTexto: { fontSize: 15, fontFamily: F.extraBold },
  ayuda: { color: C.textSecondary, fontSize: 12.5, textAlign: 'center' },

  cabeceraSeccion: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  tituloSeccion: { color: C.textPrimary, fontSize: 17, fontFamily: F.extraBold },
  enlace: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  enlaceTexto: { fontSize: 13.5, fontFamily: F.bold },

  carruselFuera: { marginHorizontal: -16 },
  carrusel: { gap: 10, paddingHorizontal: 16 },

  lista: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
  },
  divisor: { height: 1, backgroundColor: C.divider, marginLeft: 62 },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  filaIcono: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.surfaceAlt,
    borderWidth: 1,
    borderColor: C.border,
  },
  filaTextos: { flex: 1, minWidth: 0 },
  filaTitulo: { color: C.textPrimary, fontSize: 15, fontFamily: F.bold },
  filaSubtitulo: { color: C.textSecondary, fontSize: 12.5, marginTop: 2 },
  cuenta: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.textPrimary,
  },
  cuentaTexto: { color: C.bg, fontSize: 11.5, fontFamily: F.extraBold },

  historialFila: { flexDirection: 'row', gap: 8 },
  mini: {
    flex: 1,
    minWidth: 0,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  miniLetra: {
    alignSelf: 'flex-start',
    minWidth: 22,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  miniLetraTexto: { fontSize: 11.5, fontFamily: F.extraBold },
  miniMarcador: { color: C.textPrimary, fontSize: 20, fontFamily: F.extraBold },
  miniRival: { color: C.textStrong, fontSize: 12.5, fontFamily: F.semiBold, marginTop: 6 },
  miniFecha: { color: C.textFaint, fontSize: 11.5, marginTop: 2 },
  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  stat: { flex: 1, alignItems: 'center' },
  statValor: { color: C.textPrimary, fontSize: 18, fontFamily: F.extraBold },
  statEtiqueta: { color: C.textSecondary, fontSize: 11.5, marginTop: 2 },
  statsDivisor: { width: 1, alignSelf: 'stretch', backgroundColor: C.divider },

  adminCabecera: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  soloAdmins: {
    paddingHorizontal: 10,
    height: 24,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    justifyContent: 'center',
  },
  soloAdminsTexto: { color: C.textSecondary, fontSize: 11.5, fontFamily: F.semiBold },
});
