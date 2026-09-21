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
  Search,
  Swords,
  UserPlus,
  Trophy,
  ChevronRight,
} from 'lucide-react-native';

import {
  paleta as C,
  radios as R,
  medidas as S,
  fuentes as F,
} from '../theme/colors';
import { temaDeClub } from '../theme/clubThemes';
import Banner from '../components/Banner';
import ClubHeaderBar from '../components/club/ClubHeaderBar';
import ClubHeroCard from '../components/club/ClubHeroCard';
import CreateChallengeButton from '../components/club/CreateChallengeButton';
import SectionHeader from '../components/ds/SectionHeader';
import RivalClubCard, { ANCHO_TARJETA_RIVAL } from '../components/club/RivalClubCard';
import MatchHistoryCard from '../components/club/MatchHistoryCard';
import ClubPhotoGallery from '../components/club/ClubPhotoGallery';
import PremiumUpsellCard from '../components/club/PremiumUpsellCard';
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
} from '../services/clubs';
import { getClubPhotos } from '../services/clubGallery';
import { getMisPermisosEnClub } from '../services/clubPermissions';
import {
  getClubMatchHistory,
  getClubEstadisticas,
  ESTADISTICAS_VACIAS,
} from '../services/clubMatches';
import { resumenEstadisticas } from '../utils/historialClub';
import {
  modalidadBadges,
  nivelBadge,
  nivelInline,
  ratingLabel as fmtRating,
  distanciaEntreClubesKm,
  metaRival,
} from '../utils/clubMeta';

/** Máximo de rivales sugeridos en el carrusel. */
const MAX_RIVALES = 10;
/** Partidos visibles en la muestra del historial. */
const MAX_HISTORIAL = 3;

/**
 * Detalle del club ("Mi club").
 *
 * TODO LO QUE MUESTRA ES REAL: club, miembros, fotos, rivales sugeridos (con
 * distancia calculada desde la comuna), el historial de encuentros disputados
 * y las estadísticas del club.
 *
 * YA NO CREA DESAFÍOS DESDE ACÁ — pedido explícito. «Crear desafío» y la
 * bandeja «Desafíos» se sacaron de esta pantalla: crear un partido de club
 * ahora se pide desde Inicio («Crear partido de club», que ofrece «Buscar
 * rival» o «Desafío abierto» y no pasa por acá), y la bandeja de recibidos/
 * enviados vive en Avisos. Lo que queda es SOLO para ver el club: su ficha,
 * sus rivales sugeridos, su historial y sus fotos. Desafiar a un rival
 * puntual (`club.id` visto desde OTRO club, o «Buscar rivales» para un
 * integrante sin nada especial que hacer) sigue existiendo, porque no es
 * «crear un desafío para mi club» sino mirar/retar a este club en particular.
 *
 * SIN FIXTURES. Hasta la Tarea 6.1 no había marcadores en la base de datos, y
 * esta pantalla dibujaba tres partidos de ejemplo con su récord 1-1-1 cuando
 * `__DEV__` estaba activo, más placeholders de galería. La 48 trajo el
 * resultado confirmado y la 49 el historial completo; en la Tarea 6.2 se
 * retiraron los tres fixtures y el interruptor que los encendía.
 *
 * DATOS AÚN NO EXISTENTES EN EL BACKEND, mostrados como N.A. sin inventarse:
 *  - nivel del club        → "NIVEL N.A."
 *  - valoración del club   → "N.A." con estrella
 *
 * COLOR: los acentos de identidad —banner, escudo, iconos de acción, enlaces
 * «Ver todos», «Añadir foto» y los botones atados al club— salen de
 * `temaDeClub(club)` y de ningún otro lado. Lo que NO cambia
 * de color: el fondo, los textos, la navegación, el dorado de Premium y el
 * récord V/E/D, que es semántico. Las tarjetas de rival usan el tema DEL
 * RIVAL, no el de esta pantalla.
 */
export default function ClubDetailScreen({ navigation, route }) {
  const { clubId, initialBanner } = route.params || {};

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
  const [banner, setBanner] = useState(initialBanner || null);
  const [working, setWorking] = useState(false);

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
  const tengoMaxClubs = myClubs.length >= 3;
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

    const amMemberNow = (ms || []).some((m) => m.user_id === myId);
    if (amMemberNow) {
      const { data: permisos } = await getMisPermisosEnClub(clubId);
      setMisPermisos(permisos?.permisos || null);
    } else {
      setMisPermisos(null);
    }

    // Historial y estadísticas: lo que hay en la base de datos y nada más. Un
    // club sin encuentros confirmados muestra el estado vacío, no un ejemplo.
    //
    // «NO SE PUDO LEER» NO ES «NO HAY PARTIDOS». Sin esto, un corte de red o un
    // permiso mal puesto se leían como «Aún no hay partidos en el historial»:
    // el mismo fallo que la nómina tuvo en la 45 y que dibujaba un «0 de 7»
    // falso. `cargarHistorial` distingue las dos cosas; la pantalla también.
    setHistorial(partidos || []);
    setHistorialError(errHistorial || null);
    setEstadisticas(stats || ESTADISTICAS_VACIAS);

    // Rivales sugeridos: los candidatos ya vienen sin este club ni ninguno
    // de los míos —la exclusión la hace la consulta, no un filtro de acá—,
    // ordenados por distancia real cuando se puede calcular; los que no
    // tienen comuna conocida van al final.
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

    const amMember = (ms || []).some((m) => m.user_id === myId);
    if (!amMember && myId) {
      const { data: mr } = await getMyRequestTo(clubId);
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
        message: `Mira el club ${club.nombre} en FutFinder${
          club.comuna ? ` · ${club.comuna}` : ''
        }`,
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
  const goToExplore = () => navigation.navigate('ExploreClubs');

  // Explorar para elegir rival es distinto de explorar el catálogo: acá los
  // clubes propios no deben aparecer siquiera en la lista. Sólo se declara
  // este club como retador si soy su administrador; si no, el servicio
  // igualmente excluye todos mis clubes.
  const goToElegirRival = () =>
    navigation.navigate('ExploreClubs', {
      modoRival: true,
      retadorClubId: puedePublicarDesafios ? clubId : null,
    });

  if (loading || !club) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
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
        <View style={styles.loadingBox}>
          <ActivityIndicator color={tema.main} />
        </View>
      </SafeAreaView>
    );
  }

  const esPremium = club.plan === 'premium';
  const historialVisible = historial.slice(0, MAX_HISTORIAL);
  // Las estadísticas NO se derivan de `historial`: ese viaja paginado y las
  // suma el servidor sobre todos los resultados confirmados del club. La frase
  // se arma en `utils/historialClub.js`, que es de donde también la toma la
  // pantalla del historial completo.
  const resumenHistorial = resumenEstadisticas(estadisticas);

  const miembrosLabel = [
    club.comuna || null,
    `${members.length} ${members.length === 1 ? 'miembro' : 'miembros'}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <ClubHeaderBar
        title={soyMiembro ? 'Mi club' : club.nombre}
        esPremium={esPremium}
        puedeEditar={puedeEditarClub}
        onBack={() => navigation.goBack()}
        onShare={handleShare}
        onEdit={() => navigation.navigate('EditClub', { club })}
        onPlan={soyMiembro ? () => navigation.navigate('ClubPlans', { clubId: club.id }) : undefined}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={tema.main}
            colors={[tema.main]}
          />
        }
      >
        {banner && (
          <View style={styles.bannerWrap}>
            <Banner {...banner} onClose={() => setBanner(null)} />
          </View>
        )}

        <ClubHeroCard
          club={club}
          badges={modalidadBadges(club.modalidad)}
          nivelLabel={nivelBadge(club.nivel)}
          miembrosLabel={miembrosLabel}
          record={estadisticas}
          ratingLabel={fmtRating(club.rating)}
          onPressMiembros={() => navigation.navigate('ClubMembers', { clubId: club.id })}
          tema={tema}
        />

        {/* Acción principal, según mi relación con el club.
            SOLICITAR UNIRME NO SE ESCONDE PORQUE TAMBIÉN PUEDA DESAFIAR.
            Antes, quien administraba otro club veía sólo «Desafiar a este
            club» al mirar uno del que no era miembro — nunca la opción de
            pedir entrar, aunque las dos cosas son independientes (se puede
            administrar un club y a la vez querer sumarse a otro como
            jugador). Ahora, mientras se pueda pedir entrar (no soy miembro,
            no llegué al tope de 3 clubes), esa es la acción principal, y
            «Desafiar» se ofrece además, como acción secundaria, si aplica. */}
        {!soyMiembro && !tengoMaxClubs ? (
          <>
            <CreateChallengeButton
              label={myRequest ? 'Cancelar solicitud' : 'Solicitar unirme'}
              icon={
                myRequest
                  ? null
                  : (ink) => <UserPlus color={ink} size={20} strokeWidth={2.4} />
              }
              disabled={working}
              onPress={myRequest ? handleCancelRequest : handleJoin}
              onSearch={goToExplore}
              tema={tema}
            />
            {puedoDesafiar && (
              <Pressable
                onPress={() => goToChallenge(club)}
                accessibilityRole="button"
                accessibilityLabel={`Desafiar a ${club.nombre}`}
                style={({ pressed }) => [
                  styles.desafiarSecundario,
                  { borderColor: tema.border },
                  pressed && { backgroundColor: tema.soft },
                ]}
              >
                <Swords color={tema.main} size={17} strokeWidth={2.2} />
                <Text style={[styles.desafiarSecundarioText, { color: tema.main }]}>
                  Desafiar a este club
                </Text>
              </Pressable>
            )}
          </>
        ) : puedoDesafiar ? (
          <CreateChallengeButton
            label="Desafiar a este club"
            accessibilityLabel={`Desafiar a ${club.nombre}`}
            onPress={() => goToChallenge(club)}
            onSearch={goToElegirRival}
            tema={tema}
          />
        ) : soyMiembro ? (
          <CreateChallengeButton
            label="Buscar rivales"
            icon={(ink) => <Search color={ink} size={20} strokeWidth={2.2} />}
            onPress={goToElegirRival}
            onSearch={goToElegirRival}
            tema={tema}
          />
        ) : null}

        {/* ── Buscar rivales (solo integrantes del club) ── */}
        {soyMiembro && (
          <>
            <SectionHeader
              title="Buscar rivales"
              actionLabel="Ver todos"
              onAction={goToElegirRival}
              tema={tema}
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
                contentContainerStyle={styles.rivalsRow}
              >
                {rivals.map((r) => (
                  <RivalClubCard
                    key={r.id}
                    club={r}
                    meta={metaRival({ distanciaKm: r.distanciaKm, modalidad: r.modalidad })}
                    ratingLabel={fmtRating(r.rating)}
                    nivelLabel={nivelInline(r.nivel)}
                    puedeDesafiar={puedoDesafiarRivales}
                    onPress={() => navigation.navigate('ClubDetail', { clubId: r.id })}
                    onChallenge={() => goToChallenge(r)}
                  />
                ))}
              </ScrollView>
            )}
          </>
        )}

        {/* ── Historial de partidos ── */}
        {/* «Ver todo» lleva al HISTORIAL completo, no a la bandeja de desafíos:
            hasta la 6.3 apuntaba ahí, que es la lista de retos pendientes y no
            los encuentros jugados. */}
        <SectionHeader
          title="Historial de partidos"
          actionLabel={historial.length > MAX_HISTORIAL ? 'Ver todo' : null}
          onAction={
            historial.length > MAX_HISTORIAL
              ? () => navigation.navigate('ClubHistory', { clubId: club.id, clubNombre: club.nombre })
              : null
          }
          tema={tema}
        />
        {historialError ? (
          // Un fallo de lectura NO se disfraza de historial vacío: decir «aún
          // no hay partidos» cuando el club sí los tiene es peor que decir que
          // no se pudo cargar.
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
            onAction={puedePublicarDesafios ? goToExplore : null}
            variant="solid"
            tema={tema}
          />
        ) : (
          <View style={styles.historyList}>
            {historialVisible.map((p) => (
              <MatchHistoryCard
                key={p.id}
                miNombre={p.miNombre}
                miLogoUrl={p.miLogoUrl}
                rivalNombre={p.rivalNombre}
                rivalLogoUrl={p.rivalLogoUrl}
                miMarcador={p.miMarcador}
                suMarcador={p.suMarcador}
                resultado={p.resultado}
                resultadoNombre={p.resultadoNombre}
                fechaLabel={p.fechaLabel}
                horaLabel={p.horaLabel}
                localLabel={p.localLabel}
                canchaNombre={p.canchaNombre}
                // Al partido sólo entran los integrantes de los dos clubes: a
                // quien mira desde fuera, la tarjeta no le ofrece un destino
                // que le va a contestar «este partido ya no está disponible».
                onPress={
                  p.soyIntegrante
                    ? () => navigation.navigate('MatchDetail', { matchId: p.id })
                    : null
                }
              />
            ))}
            {resumenHistorial && <Text style={styles.historyResumen}>{resumenHistorial}</Text>}
          </View>
        )}

        {/* ── Fotos del club ── */}
        <SectionHeader
          title="Fotos del club"
          actionLabel={photos.length > 0 ? 'Ver todas' : null}
          onAction={photos.length > 0 ? goToGallery : null}
          tema={tema}
        />
        <ClubPhotoGallery
          photos={photos}
          puedeAñadir={soyAdmin}
          onAdd={goToGallery}
          onOpenPhoto={goToGallery}
          tema={tema}
        />

        {/* ── Premium (solo integrantes del club) ── */}
        {soyMiembro && !esPremium && (
          <PremiumUpsellCard
            onPress={() => navigation.navigate('ClubPlans', { clubId: club.id })}
          />
        )}

        {/* ── Acciones de admin ── */}
        {soyAdmin && (
          <View style={styles.adminList}>
            <Pressable
              onPress={() => navigation.navigate('ClubMembers', { clubId: club.id })}
              accessibilityRole="button"
              accessibilityLabel="Gestionar miembros del club"
              style={({ pressed }) => [styles.adminRow, pressed && styles.rowPressed]}
            >
              <Text style={styles.adminRowText}>Gestionar miembros</Text>
              <ChevronRight color={C.textMuted} size={18} strokeWidth={2.2} />
            </Pressable>
            <View style={styles.adminDivider} />
            <Pressable
              onPress={() => navigation.navigate('PermisosClub', { clubId: club.id, club })}
              accessibilityRole="button"
              accessibilityLabel="Permisos de club"
              style={({ pressed }) => [styles.adminRow, pressed && styles.rowPressed]}
            >
              <Text style={styles.adminRowText}>Permisos de club</Text>
              <ChevronRight color={C.textMuted} size={18} strokeWidth={2.2} />
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scrollContent: { paddingBottom: 40 },

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

  bannerWrap: { paddingHorizontal: S.screenPadding, paddingBottom: 12 },

  // Acción secundaria «Desafiar a este club», bajo «Solicitar unirme»
  desafiarSecundario: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    marginHorizontal: S.screenPadding,
    marginTop: 10,
    borderRadius: R.cardSm,
    borderWidth: 1,
  },
  desafiarSecundarioText: { fontSize: 14, fontFamily: F.bold },

  rowPressed: { backgroundColor: C.surfaceHover },

  // Rivales
  rivalsRow: {
    gap: 10,
    paddingHorizontal: S.screenPadding,
    paddingBottom: 4,
  },

  // Historial
  historyList: { paddingHorizontal: S.screenPadding, gap: 8 },
  // PJ · goles a favor · goles en contra, bajo las tarjetas: son del club
  // completo, no de los tres partidos que se muestran.
  historyResumen: {
    color: C.textFaint,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 2,
  },

  // Acciones de admin
  adminList: {
    marginHorizontal: S.screenPadding,
    marginTop: 10,
    backgroundColor: C.surface,
    borderRadius: R.row,
    borderWidth: 1,
    borderColor: C.borderSoft,
    overflow: 'hidden',
  },
  adminRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  adminRowText: {
    color: C.textStrong,
    fontSize: 13.5,
    fontFamily: F.semiBold,
  },
  adminDivider: { height: 1, backgroundColor: C.divider },
});
