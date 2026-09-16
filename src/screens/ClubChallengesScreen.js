import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  Modal,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft,
  Shield,
  Swords,
  Check,
  X,
  Clock,
  MessageCircle,
  SlidersHorizontal,
  ArrowUpDown,
} from 'lucide-react-native';

import Banner from '../components/Banner';
import PickerSheet from '../components/partidos/PickerSheet';
import { reservas as C, reservasRadius as R, reservasSizes as S, reservasFonts as F } from '../theme/colors';
import { temaDeClub } from '../theme/clubThemes';
import { REGIONES, getComunasOfRegion } from '../data/regiones-chile';
import { getMisClubesAdmin, getClubById } from '../services/clubs';
import { puedeResponderDesafio, puedeCancelarDesafio } from '../utils/permisosDesafio';
import {
  listChallengesForClub,
  respondChallenge,
  cancelChallenge,
} from '../services/clubChallenges';
import { esEstadoActivo, estadoLabel } from '../services/clubChallengeRules';
import { challengeThreadKey, challengeThreadTitle } from '../utils/challengeThread';
import {
  publishOpenChallenge,
  updateOpenChallenge,
  cancelOpenChallenge,
  listMyOpenChallenges,
  listOpenChallenges,
  respondToOpenChallenge,
  getMyResponseTo,
  withdrawResponse,
  reconsiderMyResponse,
  listResponsesForOpenChallenge,
  rejectResponse,
  reconsiderResponse,
  acceptResponse,
} from '../services/clubOpenChallenges';
import { formatDistanciaKm, modalidadInline } from '../utils/clubMeta';
import { resumenEstadisticas } from '../utils/historialClub';
import { haceCuanto } from '../utils/tiempoRelativo';
import {
  parseFechaHora,
  formatFecha,
  formatHora,
  borradorListo,
  ordenarPublicaciones,
  cierraEnLabel,
  esCerca,
  cierraPronto,
  contarFiltrosActivos,
} from '../utils/openChallengeBoard';

const BLANK_DRAFT = { modalidad: 'futbol7', fechaStr: '', horaStr: '', zona: '', mensaje: '' };
const CARRUSEL_GAP = 11;

function draftDesdeFecha(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? { fechaStr: formatFecha(d), horaStr: formatHora(d) } : { fechaStr: '', horaStr: '' };
}

const ESTADO_TONE = {
  pendiente: 'neutral',
  negociacion: 'green',
  esperando_aprobacion: 'green',
  publicado: 'green',
  en_juego: 'green',
  esperando_resultado: 'green',
  finalizado: 'neutral',
  resultado_en_disputa: 'red',
  bloqueado_sancion: 'red',
  rechazado: 'red',
  sin_acuerdo: 'neutral',
  cancelado: 'neutral',
  expirado: 'neutral',
  aceptado: 'green',
};

function fmtFecha(iso) {
  if (!iso) return 'A coordinar';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'A coordinar';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm} · ${hh}:${mi}`;
}

/**
 * Desafíos de un club: «Directos» (1 a 1, recibidos/enviados, de siempre —
 * detrás del pequeño ícono del header, no una pestaña) y el «tablero
 * abierto» (migración 112, pantalla principal): publicar que se busca
 * rival sin elegir a nadie todavía, otros clubes responden, y el que
 * publicó elige una respuesta y entra al mismo ciclo formal de «Directos»
 * — mismo hilo, misma propuesta oficial, mismo partido. No son dos
 * sistemas: el tablero es una puerta de entrada más al ciclo de siempre.
 *
 * A diferencia del mockup de referencia («FutFinder Desafíos»), NO hay
 * nivel del rival, valoración, ni etiquetas «Revancha»/«Invicto»: ninguno
 * de esos datos existe en la base (`clubMeta.js` ya lo documenta). Lo que
 * sí es real y se usa tal cual: modalidad, distancia por comuna, el
 * historial V/E/D del club (`club_estadisticas()`) y «Cerca»/urgencia de
 * cierre calculados de verdad (`openChallengeBoard.js`).
 */
export default function ClubChallengesScreen({ navigation, route }) {
  const { clubId } = route.params || {};
  const { width } = useWindowDimensions();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [banner, setBanner] = useState(null);
  const [working, setWorking] = useState(false);

  // ── Directos (sin cambios de lógica; ahora vive tras el ícono del header) ──
  const [recibidos, setRecibidos] = useState([]);
  const [enviados, setEnviados] = useState([]);
  const [clubesAdmin, setClubesAdmin] = useState(null);
  const [errorRol, setErrorRol] = useState(null);
  const [nombreDeMiClub, setNombreDeMiClub] = useState('Mi club');
  const [clubActual, setClubActual] = useState(null);

  // ── Tablero abierto ────────────────────────────────────────────
  const [misPublicaciones, setMisPublicaciones] = useState([]);
  const [browsing, setBrowsing] = useState([]);
  const [misRespuestas, setMisRespuestas] = useState(new Map());
  const [filtroModalidad, setFiltroModalidad] = useState(null);
  const [filtroRegion, setFiltroRegion] = useState(null);
  const [filtroComuna, setFiltroComuna] = useState(null);
  const [filtroFromHour, setFiltroFromHour] = useState(0);
  const [filtroToHour, setFiltroToHour] = useState(23);
  const [sort, setSort] = useState('cerca');
  const [subScreen, setSubScreen] = useState('lista'); // 'lista' | 'publicar' | 'editar' | 'respuestas' | 'directos'
  const [editId, setEditId] = useState(null);
  const [editingPub, setEditingPub] = useState(null);
  const [draft, setDraft] = useState(BLANK_DRAFT);
  const [respuestasDe, setRespuestasDe] = useState(null);
  const [respuestas, setRespuestas] = useState([]);
  const [detalle, setDetalle] = useState(null);
  const [mensajeRespuesta, setMensajeRespuesta] = useState('');
  const [filtroSheetOpen, setFiltroSheetOpen] = useState(false);
  const [picker, setPicker] = useState(null); // 'region' | 'comuna' (del filtro)
  const [mineIndex, setMineIndex] = useState(0);

  const soyAdminDeEsteClub = Array.isArray(clubesAdmin) && clubesAdmin.includes(clubId);

  const load = useCallback(async () => {
    const [{ data }, { data: clubesAdminData, error: eRol }, { data: miClub }] = await Promise.all([
      listChallengesForClub(clubId),
      getMisClubesAdmin(),
      getClubById(clubId),
    ]);
    setRecibidos(data.recibidos || []);
    setEnviados(data.enviados || []);
    setClubesAdmin(clubesAdminData ?? null);
    setErrorRol(clubesAdminData ? null : eRol?.message || 'No se pudo comprobar tu rol en el club.');
    if (miClub?.nombre) setNombreDeMiClub(miClub.nombre);
    setClubActual(miClub || null);

    const [{ data: mias }, { data: browse }] = await Promise.all([
      listMyOpenChallenges(clubId),
      listOpenChallenges({ myClub: miClub, excludeClubId: clubId }),
    ]);
    setMisPublicaciones(mias || []);
    setBrowsing(browse || []);

    if (browse?.length) {
      const pares = await Promise.all(browse.map((b) => getMyResponseTo(b.id, clubId)));
      const map = new Map();
      browse.forEach((b, i) => {
        if (pares[i]?.data) map.set(b.id, pares[i].data);
      });
      setMisRespuestas(map);
    } else {
      setMisRespuestas(new Map());
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

  const abrirChatLegado = (userId, titulo, challengeId) => {
    if (!userId) return;
    navigation.navigate('ChatThread', {
      threadKey: `dm:${userId}`,
      title: titulo || 'Coordinar partido',
      subtitle: 'Coordinar partido de clubes',
      challengeId,
    });
  };

  const abrirNegociacion = (challenge) => {
    const threadKey = challengeThreadKey(challenge?.id);
    if (!threadKey) return;
    const esRecibido = challenge.club_retado_id === clubId;
    const titulo = challengeThreadTitle({
      club_retador: esRecibido ? challenge.otroClub : { nombre: nombreDeMiClub },
      club_retado: esRecibido ? { nombre: nombreDeMiClub } : challenge.otroClub,
    });
    navigation.navigate('ChatThread', {
      threadKey,
      title: titulo,
      subtitle: estadoLabel(challenge.estado),
      challengeId: challenge.id,
    });
  };

  const handleRespond = async (challenge, accept) => {
    setWorking(true);
    const { error, threadKey } = await respondChallenge(challenge.id, accept);
    setWorking(false);
    if (error) {
      setBanner({ type: 'error', title: 'No se pudo responder', message: error.message });
      return;
    }
    await load();
    if (accept && threadKey) {
      setBanner({
        type: 'success',
        title: 'Desafío aceptado',
        message: 'Se abrió el chat de negociación con los administradores de ambos clubes.',
      });
      abrirNegociacion({ ...challenge, estado: 'negociacion' });
    }
  };

  const handleCancel = async (challenge) => {
    setWorking(true);
    const { error } = await cancelChallenge(challenge.id);
    setWorking(false);
    if (error) {
      setBanner({ type: 'error', title: 'No se pudo cancelar', message: error.message });
      return;
    }
    await load();
  };

  // ── Tablero abierto: acciones ─────────────────────────────────
  const abrirPublicar = () => {
    setDraft(BLANK_DRAFT);
    setEditId(null);
    setSubScreen('publicar');
  };

  const abrirEditar = (pub) => {
    setDraft({
      modalidad: pub.modalidad,
      ...draftDesdeFecha(pub.fecha_propuesta),
      zona: pub.zona || '',
      mensaje: pub.mensaje || '',
    });
    setEditId(pub.id);
    setEditingPub(pub);
    setSubScreen('editar');
  };

  const handleSubmitDraft = async () => {
    const fecha = parseFechaHora(draft.fechaStr, draft.horaStr);
    if (!fecha) {
      setBanner({ type: 'error', title: 'Fecha inválida', message: 'Usa el formato DD/MM/AAAA y HH:MM.' });
      return;
    }
    if (fecha.getTime() < Date.now()) {
      setBanner({ type: 'error', title: 'Fecha pasada', message: 'La fecha propuesta debe ser futura.' });
      return;
    }
    setWorking(true);
    const payload = { modalidad: draft.modalidad, fechaPropuesta: fecha, zona: draft.zona, mensaje: draft.mensaje };
    const { error } = editId ? await updateOpenChallenge(editId, payload) : await publishOpenChallenge({ clubId, ...payload });
    setWorking(false);
    if (error) {
      setBanner({ type: 'error', title: 'No se pudo guardar', message: error.message });
      return;
    }
    setSubScreen('lista');
    setBanner({
      type: 'success',
      title: editId ? 'Cambios guardados' : 'Publicado',
      message: editId ? '' : 'Ya está visible para otros clubes cercanos.',
    });
    await load();
  };

  const handleCancelPublicacion = async (pub) => {
    setWorking(true);
    const { error } = await cancelOpenChallenge(pub.id);
    setWorking(false);
    if (error) {
      setBanner({ type: 'error', title: 'No se pudo retirar', message: error.message });
      return;
    }
    setSubScreen('lista');
    await load();
  };

  const abrirRespuestas = async (pub) => {
    setRespuestasDe(pub.id);
    setSubScreen('respuestas');
    const { data } = await listResponsesForOpenChallenge(pub.id);
    setRespuestas(data || []);
  };

  const recargarRespuestas = async () => {
    if (!respuestasDe) return;
    const { data } = await listResponsesForOpenChallenge(respuestasDe);
    setRespuestas(data || []);
  };

  const handleAceptarRespuesta = async (resp) => {
    setWorking(true);
    const { data, error } = await acceptResponse(resp.id);
    setWorking(false);
    if (error) {
      setBanner({ type: 'error', title: 'No se pudo aceptar', message: error.message });
      return;
    }
    setSubScreen('lista');
    setBanner({
      type: 'success',
      title: 'Desafío aceptado',
      message: `Se abrió el chat de negociación con ${resp.club?.nombre || 'el club'}.`,
    });
    await load();
    if (data) {
      abrirNegociacion({
        id: data.id,
        estado: 'negociacion',
        club_retado_id: clubId,
        otroClub: resp.club,
      });
    }
  };

  const handleRechazarRespuesta = async (resp) => {
    setWorking(true);
    const { error } = await rejectResponse(resp.id);
    setWorking(false);
    if (error) {
      setBanner({ type: 'error', title: 'No se pudo rechazar', message: error.message });
      return;
    }
    await recargarRespuestas();
  };

  const handleReconsiderarRespuesta = async (resp) => {
    setWorking(true);
    const { error } = await reconsiderResponse(resp.id);
    setWorking(false);
    if (error) return;
    await recargarRespuestas();
  };

  const abrirDetalle = (pub) => {
    setDetalle(pub);
    setMensajeRespuesta('');
  };

  const cerrarDetalle = () => setDetalle(null);

  const handleEnviarRespuesta = async () => {
    if (!detalle) return;
    setWorking(true);
    const { error } = await respondToOpenChallenge(detalle.id, { clubId, mensaje: mensajeRespuesta });
    setWorking(false);
    if (error) {
      setBanner({ type: 'error', title: 'No se pudo responder', message: error.message });
      return;
    }
    const club = detalle.club;
    setDetalle(null);
    setBanner({ type: 'success', title: 'Respuesta enviada', message: `${club?.nombre || 'El club'} la verá y podrá elegirla.` });
    await load();
  };

  const handleRetirarMiRespuesta = async (resp) => {
    setWorking(true);
    const { error } = await withdrawResponse(resp.id);
    setWorking(false);
    if (error) return;
    await load();
  };

  const handleReconsiderarMiRespuesta = async (resp) => {
    setWorking(true);
    const { error } = await reconsiderMyResponse(resp.id);
    setWorking(false);
    if (error) return;
    await load();
  };

  const tema = temaDeClub(clubActual);
  const filtros = { modalidad: filtroModalidad, region: filtroRegion, comuna: filtroComuna, fromHour: filtroFromHour, toHour: filtroToHour };
  const listaOrdenada = ordenarPublicaciones(browsing, { ...filtros, sort });
  const filtrosActivos = contarFiltrosActivos(filtros);
  const pendientesDirectos = recibidos.filter((c) => c.estado === 'pendiente').length;
  const cardWidth = Math.max(0, width - S.screenPadding * 2);

  const limpiarFiltros = () => {
    setFiltroModalidad(null);
    setFiltroRegion(null);
    setFiltroComuna(null);
    setFiltroFromHour(0);
    setFiltroToHour(23);
  };

  if (loading) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}>
            <ArrowLeft color={C.textPrimary} size={18} strokeWidth={2.2} />
          </Pressable>
          <Text style={styles.headerTitle}>Desafíos abiertos</Text>
          <View style={{ width: S.iconBtn }} />
        </View>
        <View style={styles.loadingBox}>
          <ActivityIndicator color={tema.main} />
        </View>
      </SafeAreaView>
    );
  }

  if (subScreen === 'directos') {
    return (
      <DirectosScreen
        tema={tema}
        banner={banner}
        onCloseBanner={() => setBanner(null)}
        onBack={() => setSubScreen('lista')}
        recibidos={recibidos}
        enviados={enviados}
        clubesAdmin={clubesAdmin}
        errorRol={errorRol}
        working={working}
        onRespond={handleRespond}
        onCancel={handleCancel}
        abrirNegociacion={abrirNegociacion}
        abrirChatLegado={abrirChatLegado}
      />
    );
  }

  if (subScreen !== 'lista') {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <TableroSubScreen
          subScreen={subScreen}
          tema={tema}
          soyAdmin={soyAdminDeEsteClub}
          working={working}
          banner={banner}
          onCloseBanner={() => setBanner(null)}
          onBack={() => setSubScreen('lista')}
          draft={draft}
          setDraft={setDraft}
          onSubmitDraft={handleSubmitDraft}
          editId={editId}
          editingPub={editingPub}
          nombreDeMiClub={nombreDeMiClub}
          onCancelPublicacion={() => {
            const pub = misPublicaciones.find((p) => p.id === editId);
            if (pub) handleCancelPublicacion(pub);
          }}
          respuestas={respuestas}
          onAceptar={handleAceptarRespuesta}
          onRechazar={handleRechazarRespuesta}
          onReconsiderar={handleReconsiderarRespuesta}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <Header
        navigation={navigation}
        tema={tema}
        openCount={browsing.length}
        directosPendientes={pendientesDirectos}
        onAbrirDirectos={() => setSubScreen('directos')}
        onPublicar={abrirPublicar}
        soyAdmin={soyAdminDeEsteClub}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={tema.main} colors={[tema.main]} />}
      >
        {banner && <Banner {...banner} onClose={() => setBanner(null)} />}

        <MisDesafiosCarrusel
          tema={tema}
          soyAdmin={soyAdminDeEsteClub}
          misPublicaciones={misPublicaciones}
          cardWidth={cardWidth}
          mineIndex={mineIndex}
          setMineIndex={setMineIndex}
          onVerRespuestas={abrirRespuestas}
          onEditar={abrirEditar}
        />

        <View style={styles.controlsRow}>
          <Pressable
            onPress={() => setFiltroSheetOpen(true)}
            style={({ pressed }) => [styles.filterBtnBig, pressed && { opacity: 0.85 }]}
          >
            <SlidersHorizontal color={C.textPrimary} size={16} strokeWidth={2.1} />
            <Text style={styles.filterBtnBigText}>{filtrosActivos ? `Filtros · ${filtrosActivos}` : 'Filtros'}</Text>
          </Pressable>
          <Pressable
            onPress={() => setSort((s) => (s === 'cerca' ? 'pronto' : 'cerca'))}
            style={({ pressed }) => [styles.sortBtnBig, pressed && { opacity: 0.85 }]}
          >
            <ArrowUpDown color={C.textSecondary} size={14} strokeWidth={2.1} />
            <Text style={styles.sortBtnBigText}>{sort === 'cerca' ? 'Más cerca' : 'Fecha más próxima'}</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>{filtrosActivos ? 'Resultados' : 'Cerca de ti'} ({listaOrdenada.length})</Text>
        {listaOrdenada.length === 0 ? (
          <View style={styles.emptyBoxDashed}>
            <Text style={styles.emptyText}>Ningún desafío calza con tus filtros.{'\n'}Amplía la distancia o quita algún criterio.</Text>
          </View>
        ) : (
          listaOrdenada.map((pub) => (
            <CandidateCard key={pub.id} pub={pub} tema={tema} miRespuesta={misRespuestas.get(pub.id)} onOpen={() => abrirDetalle(pub)} />
          ))
        )}
      </ScrollView>

      <DetailSheet
        visible={!!detalle}
        pub={detalle}
        tema={tema}
        soyAdmin={soyAdminDeEsteClub}
        miRespuesta={detalle ? misRespuestas.get(detalle.id) : null}
        mensaje={mensajeRespuesta}
        setMensaje={setMensajeRespuesta}
        working={working}
        onClose={cerrarDetalle}
        onEnviar={handleEnviarRespuesta}
        onRetirar={handleRetirarMiRespuesta}
        onReconsiderar={handleReconsiderarMiRespuesta}
      />

      <FilterSheet
        visible={filtroSheetOpen}
        tema={tema}
        filtroModalidad={filtroModalidad}
        setFiltroModalidad={setFiltroModalidad}
        filtroRegion={filtroRegion}
        filtroComuna={filtroComuna}
        filtroFromHour={filtroFromHour}
        filtroToHour={filtroToHour}
        setFiltroFromHour={setFiltroFromHour}
        setFiltroToHour={setFiltroToHour}
        onAbrirPickerRegion={() => setPicker('region')}
        onAbrirPickerComuna={() => filtroRegion && setPicker('comuna')}
        count={listaOrdenada.length}
        onLimpiar={limpiarFiltros}
        onClose={() => setFiltroSheetOpen(false)}
      />

      <PickerSheet
        visible={picker === 'region'}
        onClose={() => setPicker(null)}
        title="Región"
        options={REGIONES.map((r) => r.nombre)}
        value={filtroRegion}
        searchPlaceholder="Buscar región…"
        allowClear
        clearLabel="Cualquier región"
        onSelect={(v) => {
          setFiltroRegion(v);
          setFiltroComuna(null);
        }}
      />
      <PickerSheet
        visible={picker === 'comuna'}
        onClose={() => setPicker(null)}
        title="Comuna"
        subtitle={filtroRegion ? `${getComunasOfRegion(filtroRegion).length} en ${filtroRegion}` : ''}
        options={filtroRegion ? getComunasOfRegion(filtroRegion) : []}
        value={filtroComuna}
        searchPlaceholder="Buscar comuna…"
        allowClear
        clearLabel="Cualquier comuna"
        onSelect={setFiltroComuna}
      />
    </SafeAreaView>
  );
}

function Header({ navigation, tema, openCount, directosPendientes, onAbrirDirectos, onPublicar, soyAdmin }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}>
        <ArrowLeft color={C.textPrimary} size={18} strokeWidth={2.2} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.headerTitle} numberOfLines={1}>Desafíos abiertos</Text>
        <Text style={styles.headerSubtitle} numberOfLines={1}>
          {openCount} {openCount === 1 ? 'club buscando' : 'clubes buscando'} rival
        </Text>
      </View>
      <Pressable onPress={onAbrirDirectos} hitSlop={8} style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}>
        <Swords color={C.textPrimary} size={17} strokeWidth={2.1} />
        {directosPendientes > 0 && (
          <View style={styles.iconBtnBadge}>
            <Text style={styles.iconBtnBadgeText}>{directosPendientes}</Text>
          </View>
        )}
      </Pressable>
      {soyAdmin && (
        <Pressable onPress={onPublicar} style={({ pressed }) => [styles.publishBtnSmall, { backgroundColor: tema.main }, pressed && { opacity: 0.85 }]}>
          <Text style={[styles.publishBtnSmallText, { color: tema.ink }]}>Publicar</Text>
        </Pressable>
      )}
    </View>
  );
}

/* ── Directos: pantalla propia, ya no una pestaña ───────────────── */

function DirectosScreen({ tema, banner, onCloseBanner, onBack, recibidos, enviados, clubesAdmin, errorRol, working, onRespond, onCancel, abrirNegociacion, abrirChatLegado }) {
  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={8} style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}>
          <ArrowLeft color={C.textPrimary} size={18} strokeWidth={2.2} />
        </Pressable>
        <Text style={styles.headerTitle}>Directos</Text>
        <View style={{ width: S.iconBtn }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {banner && <Banner {...banner} onClose={onCloseBanner} />}
        <DirectosLista
          tema={tema}
          recibidos={recibidos}
          enviados={enviados}
          clubesAdmin={clubesAdmin}
          errorRol={errorRol}
          working={working}
          onRespond={onRespond}
          onCancel={onCancel}
          abrirNegociacion={abrirNegociacion}
          abrirChatLegado={abrirChatLegado}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function DirectosLista({ tema, recibidos, enviados, clubesAdmin, errorRol, working, onRespond, onCancel, abrirNegociacion, abrirChatLegado }) {
  const sinNada = recibidos.length === 0 && enviados.length === 0;
  return (
    <>
      {!!errorRol && (
        <Banner type="error" title="No pudimos comprobar tu rol" message={`${errorRol} Desliza para reintentar: mientras tanto no se muestran aceptar ni rechazar.`} />
      )}
      {sinNada && (
        <View style={styles.emptyBox}>
          <Swords color={C.textMuted} size={32} strokeWidth={1.6} />
          <Text style={styles.emptyText}>Aún no hay desafíos directos. Reta a un club desde su perfil, o usa el tablero abierto.</Text>
        </View>
      )}
      {recibidos.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Recibidos</Text>
          {recibidos.map((c) => (
            <ChallengeRow key={c.id} challenge={c} tema={tema}>
              {puedeResponderDesafio({ clubesAdmin, clubRetadoId: c.club_retado_id, estado: c.estado }) ? (
                <View style={styles.actionsRow}>
                  <Pressable disabled={working} onPress={() => onRespond(c, true)} hitSlop={6} style={({ pressed }) => [styles.actBtn, { backgroundColor: tema.main }, pressed && { opacity: 0.7 }]}>
                    <Check color={tema.ink} size={16} strokeWidth={2.6} />
                  </Pressable>
                  <Pressable disabled={working} onPress={() => onRespond(c, false)} hitSlop={6} style={({ pressed }) => [styles.actBtn, styles.actReject, pressed && { opacity: 0.7 }]}>
                    <X color={C.loss} size={16} strokeWidth={2.6} />
                  </Pressable>
                </View>
              ) : esEstadoActivo(c.estado) ? (
                <Pressable onPress={() => abrirNegociacion(c)} hitSlop={6} style={({ pressed }) => [styles.chatBtn, pressed && { opacity: 0.7 }]}>
                  <Swords color={tema.main} size={16} />
                </Pressable>
              ) : c.estado === 'aceptado' ? (
                <Pressable onPress={() => abrirChatLegado(c.creado_por, c.otroClub?.nombre, c.id)} hitSlop={6} style={({ pressed }) => [styles.chatBtn, pressed && { opacity: 0.7 }]}>
                  <MessageCircle color={tema.main} size={16} />
                </Pressable>
              ) : (
                <EstadoBadge estado={c.estado} />
              )}
            </ChallengeRow>
          ))}
        </>
      )}
      {enviados.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Enviados</Text>
          {enviados.map((c) => (
            <ChallengeRow key={c.id} challenge={c} tema={tema}>
              {puedeCancelarDesafio({ clubesAdmin, clubRetadorId: c.club_retador_id, estado: c.estado }) ? (
                <Pressable disabled={working} onPress={() => onCancel(c)} hitSlop={6} style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.7 }]}>
                  <Text style={styles.cancelText}>Cancelar</Text>
                </Pressable>
              ) : esEstadoActivo(c.estado) ? (
                <Pressable onPress={() => abrirNegociacion(c)} hitSlop={6} style={({ pressed }) => [styles.chatBtn, pressed && { opacity: 0.7 }]}>
                  <Swords color={tema.main} size={16} />
                </Pressable>
              ) : c.estado === 'aceptado' ? (
                <Pressable onPress={() => abrirChatLegado(c.respondido_por, c.otroClub?.nombre, c.id)} hitSlop={6} style={({ pressed }) => [styles.chatBtn, pressed && { opacity: 0.7 }]}>
                  <MessageCircle color={tema.main} size={16} />
                </Pressable>
              ) : (
                <EstadoBadge estado={c.estado} />
              )}
            </ChallengeRow>
          ))}
        </>
      )}
    </>
  );
}

function EstadoBadge({ estado }) {
  const tone = ESTADO_TONE[estado] || 'neutral';
  const bg = tone === 'green' ? C.greenSoft : tone === 'red' ? 'rgba(232,115,123,0.14)' : C.chip;
  const color = tone === 'green' ? C.green : tone === 'red' ? C.loss : C.textSecondary;
  return (
    <View style={[styles.estadoBadge, { backgroundColor: bg }]}>
      <Text style={[styles.estadoBadgeText, { color }]}>{estadoLabel(estado)}</Text>
    </View>
  );
}

function ChallengeRow({ challenge, tema, children }) {
  const club = challenge.otroClub;
  return (
    <View style={styles.row}>
      {club?.foto_url ? (
        <Image source={{ uri: club.foto_url }} style={styles.logo} />
      ) : (
        <View style={[styles.logo, styles.logoFallback]}>
          <Shield color={C.textMuted} size={18} strokeWidth={1.7} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.clubName} numberOfLines={1}>{club?.nombre || 'Club'}</Text>
        <View style={styles.metaRow}>
          <Clock color={C.textMuted} size={12} strokeWidth={2} />
          <Text style={styles.metaText}>{fmtFecha(challenge.fecha_propuesta)}</Text>
          {challenge.zona ? <Text style={styles.metaText} numberOfLines={1}> · {challenge.zona}</Text> : null}
        </View>
        {challenge.mensaje ? <Text style={styles.mensaje} numberOfLines={2}>&quot;{challenge.mensaje}&quot;</Text> : null}
      </View>
      {children}
    </View>
  );
}

/* ── Tablero abierto: carrusel de «Tus desafíos activos» ─────────── */

function MisDesafiosCarrusel({ tema, soyAdmin, misPublicaciones, cardWidth, mineIndex, setMineIndex, onVerRespuestas, onEditar }) {
  if (!soyAdmin) return null;
  const activas = misPublicaciones.filter((p) => p.estado === 'abierto');
  if (activas.length === 0 || cardWidth <= 0) return null;

  const onScroll = (e) => {
    const x = e.nativeEvent.contentOffset.x;
    const i = Math.max(0, Math.min(activas.length - 1, Math.round(x / (cardWidth + CARRUSEL_GAP))));
    if (i !== mineIndex) setMineIndex(i);
  };

  return (
    <View style={styles.carruselBox}>
      <View style={styles.carruselHeadRow}>
        <View style={styles.carruselHeadLeft}>
          <View style={[styles.dotLive, { backgroundColor: tema.main }]} />
          <Text style={[styles.carruselHeadLabel, { color: tema.main }]}>TUS DESAFÍOS ACTIVOS · {activas.length}</Text>
        </View>
        {activas.length > 1 && (
          <View style={styles.dotsRow}>
            {activas.map((_, i) => (
              <View
                key={i}
                style={[styles.dot, { width: i === mineIndex ? 16 : 5, backgroundColor: i === mineIndex ? tema.main : C.chipStrong }]}
              />
            ))}
          </View>
        )}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={cardWidth + CARRUSEL_GAP}
        decelerationRate="fast"
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ gap: CARRUSEL_GAP }}
      >
        {activas.map((pub) => {
          const n = pub.respuestasCount || 0;
          const hayRespuestas = n > 0;
          return (
            <LinearGradient
              key={pub.id}
              colors={[tema.soft, C.surface]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.mineCard, { width: cardWidth, borderColor: tema.border }]}
            >
              <View style={styles.mineHeaderRow}>
                <View style={[styles.mineStateBadge, { backgroundColor: hayRespuestas ? tema.soft : C.chip }]}>
                  <Text style={[styles.mineStateBadgeText, { color: hayRespuestas ? tema.main : C.textMuted }]}>
                    {hayRespuestas ? 'Publicado' : 'Sin respuestas'}
                  </Text>
                </View>
                <Text style={styles.mineExpiry}>{cierraEnLabel(pub.created_at)}</Text>
              </View>
              <Text style={styles.mineTitle}>{modalidadInline(pub.modalidad)} · {fmtFecha(pub.fecha_propuesta)}</Text>
              <Text style={styles.mineSub} numberOfLines={1}>{pub.zona || 'Zona a coordinar por chat'}</Text>
              <View style={styles.mineActionsRow}>
                <Pressable
                  onPress={() => onVerRespuestas(pub)}
                  style={({ pressed }) => [
                    styles.mineCta,
                    { backgroundColor: hayRespuestas ? tema.main : C.chip },
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text style={[styles.mineCtaText, { color: hayRespuestas ? tema.ink : C.textPrimary }]}>
                    {hayRespuestas ? `Ver ${n} ${n === 1 ? 'respuesta' : 'respuestas'}` : 'Ver respuestas'}
                  </Text>
                </Pressable>
                <Pressable onPress={() => onEditar(pub)} style={({ pressed }) => [styles.mineEditBtn, pressed && { opacity: 0.7 }]}>
                  <Text style={styles.mineEditBtnText}>Editar</Text>
                </Pressable>
              </View>
            </LinearGradient>
          );
        })}
      </ScrollView>
    </View>
  );
}

/* ── Tablero abierto: tarjeta de candidato ──────────────────────── */

const RESPUESTA_MINI_LABEL = {
  pendiente: 'Respondida',
  retirada: null,
  rechazada: 'No elegida',
};

function CandidateCard({ pub, tema, miRespuesta, onOpen }) {
  const cerca = esCerca(pub.distanciaKm);
  const urgente = cierraPronto(pub.created_at);
  const chips = [modalidadInline(pub.modalidad), fmtFecha(pub.fecha_propuesta), pub.zona].filter(Boolean);
  const miniLabel = miRespuesta ? RESPUESTA_MINI_LABEL[miRespuesta.estado] : null;

  return (
    <Pressable onPress={onOpen} style={({ pressed }) => [styles.browseCard, pressed && { borderColor: tema.border }]}>
      <View style={styles.browseHeaderRow}>
        {pub.club?.foto_url ? (
          <Image source={{ uri: pub.club.foto_url }} style={styles.logo} />
        ) : (
          <View style={[styles.logo, styles.logoFallback]}>
            <Shield color={C.textMuted} size={18} strokeWidth={1.7} />
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.browseNameRow}>
            <Text style={styles.clubName} numberOfLines={1}>{pub.club?.nombre || 'Club'}</Text>
            {cerca && (
              <View style={[styles.tagChip, { backgroundColor: tema.soft }]}>
                <Text style={[styles.tagChipText, { color: tema.main }]}>Cerca</Text>
              </View>
            )}
          </View>
          <Text style={styles.metaText} numberOfLines={1}>
            {resumenEstadisticas(pub.estadisticas) || 'Sin partidos jugados'}
          </Text>
        </View>
        {pub.distanciaKm != null && (
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.browseDist, { color: tema.main }]}>{formatDistanciaKm(pub.distanciaKm)}</Text>
            <Text style={styles.browseDistSub}>de ti</Text>
          </View>
        )}
      </View>

      <View style={styles.chipsRow}>
        {chips.map((chip, i) => (
          <View key={i} style={styles.infoChip}>
            <Text style={styles.infoChipText} numberOfLines={1}>{chip}</Text>
          </View>
        ))}
        {miniLabel && (
          <View style={styles.infoChip}>
            <Text style={styles.infoChipText}>{miniLabel}</Text>
          </View>
        )}
      </View>

      <Text style={[styles.browseExpiry, urgente && { color: '#E09A5A' }]}>{cierraEnLabel(pub.created_at)}</Text>
    </Pressable>
  );
}

/* ── Tablero abierto: hoja de detalle + responder ───────────────── */

function DetailSheet({ visible, pub, tema, soyAdmin, miRespuesta, mensaje, setMensaje, working, onClose, onEnviar, onRetirar, onReconsiderar }) {
  const facts = pub
    ? [
        { k: 'Formato', v: modalidadInline(pub.modalidad) },
        { k: 'Cuándo', v: fmtFecha(pub.fecha_propuesta) },
        { k: 'Zona', v: pub.zona || 'A coordinar' },
        { k: 'Cierra', v: cierraEnLabel(pub.created_at) },
      ]
    : [];

  // El Modal se mantiene montado aunque `pub` ya se haya limpiado, para que
  // el fade de cierre alcance a jugar (si se desmonta junto con `pub` en el
  // mismo render, la hoja desaparece de golpe en vez de apagarse).
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.sheetHandle} />
          {pub && (
            <>
              <View style={styles.sheetHeaderRow}>
                {pub.club?.foto_url ? (
                  <Image source={{ uri: pub.club.foto_url }} style={styles.logoLg} />
                ) : (
                  <View style={[styles.logoLg, styles.logoFallback]}>
                    <Shield color={C.textMuted} size={20} strokeWidth={1.7} />
                  </View>
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.sheetTitle} numberOfLines={1}>{pub.club?.nombre || 'Club'}</Text>
                  <Text style={styles.sheetSubtitle} numberOfLines={1}>{resumenEstadisticas(pub.estadisticas) || 'Sin partidos jugados'}</Text>
                </View>
              </View>

              <View style={styles.factsGrid}>
                {facts.map((fa) => (
                  <View key={fa.k} style={styles.factCard}>
                    <Text style={styles.factLabel}>{fa.k}</Text>
                    <Text style={styles.factValue} numberOfLines={2}>{fa.v}</Text>
                  </View>
                ))}
              </View>

              {pub.mensaje ? <Text style={styles.sheetMensaje}>&quot;{pub.mensaje}&quot;</Text> : null}

              {soyAdmin && (
                miRespuesta ? (
                  miRespuesta.estado === 'pendiente' ? (
                    <View style={styles.sheetRespondedBox}>
                      <Text style={styles.sheetRespondedText}>Ya enviaste tu respuesta. {pub.club?.nombre || 'El club'} todavía no elige.</Text>
                      <Pressable
                        onPress={() => onRetirar(miRespuesta)}
                        disabled={working}
                        style={({ pressed }) => [styles.withdrawFullBtn, pressed && !working && { opacity: 0.7 }]}
                      >
                        <Text style={styles.withdrawFullBtnText}>Retirar respuesta</Text>
                      </Pressable>
                    </View>
                  ) : miRespuesta.estado === 'retirada' ? (
                    <Pressable
                      onPress={() => onReconsiderar(miRespuesta)}
                      disabled={working}
                      style={({ pressed }) => [styles.sheetPrimary, { backgroundColor: tema.main }, pressed && !working && { opacity: 0.85 }]}
                    >
                      <Text style={[styles.sheetPrimaryText, { color: tema.ink }]}>Volver a responder</Text>
                    </Pressable>
                  ) : (
                    <View style={styles.sheetRespondedBox}>
                      <Text style={styles.sheetRespondedTextMuted}>No fue elegida esta vez.</Text>
                    </View>
                  )
                ) : (
                  <>
                    <TextInput
                      value={mensaje}
                      onChangeText={setMensaje}
                      placeholder="Contales por qué les sirve (opcional)"
                      placeholderTextColor={C.textMuted}
                      multiline
                      maxLength={300}
                      style={styles.sheetTextarea}
                    />
                    <Pressable
                      onPress={onEnviar}
                      disabled={working}
                      style={({ pressed }) => [styles.sheetPrimary, { backgroundColor: tema.main }, pressed && !working && { opacity: 0.85 }, working && { opacity: 0.6 }]}
                    >
                      {working ? <ActivityIndicator color={tema.ink} /> : <Text style={[styles.sheetPrimaryText, { color: tema.ink }]}>Enviar respuesta</Text>}
                    </Pressable>
                  </>
                )
              )}
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ── Tablero abierto: hoja de filtros ────────────────────────────── */

const MODALIDAD_OPCIONES = [
  { value: null, label: 'Cualquiera' },
  { value: 'futbol7', label: 'Fútbol 7' },
  { value: 'futbol11', label: 'Fútbol 11' },
];

const hhmm = (h) => `${String(h).padStart(2, '0')}:00`;

/**
 * Región, comuna y horario filtran contra datos que el club y la
 * publicación YA tienen registrados (`clubs.region`/`clubs.comuna`,
 * `fecha_propuesta`) — no piden nada nuevo. El orden («Ordenar por») vive
 * afuera de esta hoja, como botón aparte junto a «Filtros»: no es un
 * filtro que reduzca la lista, así que no compite por espacio acá dentro.
 */
function FilterSheet({
  visible,
  tema,
  filtroModalidad,
  setFiltroModalidad,
  filtroRegion,
  filtroComuna,
  filtroFromHour,
  filtroToHour,
  setFiltroFromHour,
  setFiltroToHour,
  onAbrirPickerRegion,
  onAbrirPickerComuna,
  count,
  onLimpiar,
  onClose,
}) {
  const horarioAcotado = filtroFromHour > 0 || filtroToHour < 23;

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.sheetHandle} />
          <View style={styles.filterSheetHeadRow}>
            <View>
              <Text style={styles.sheetTitle}>Filtros</Text>
              <Text style={styles.sheetSubtitle}>{count} {count === 1 ? 'coincide' : 'coinciden'}</Text>
            </View>
            <Pressable onPress={onLimpiar} style={({ pressed }) => [styles.clearBtn, pressed && { opacity: 0.7 }]}>
              <Text style={styles.clearBtnText}>Limpiar</Text>
            </Pressable>
          </View>

          <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
            <Text style={styles.fieldLabel}>Formato</Text>
            <View style={styles.chipsRow}>
              {MODALIDAD_OPCIONES.map((o) => {
                const activo = filtroModalidad === o.value;
                return (
                  <Pressable
                    key={o.label}
                    onPress={() => setFiltroModalidad(o.value)}
                    style={[styles.optionChip, activo && { backgroundColor: tema.main, borderColor: tema.main }]}
                  >
                    <Text style={[styles.optionChipText, activo && { color: tema.ink }]}>{o.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.fieldLabel}>Región</Text>
            <Pressable onPress={onAbrirPickerRegion} style={({ pressed }) => [styles.pickerField, pressed && { opacity: 0.85 }]}>
              <Text style={[styles.pickerFieldText, !filtroRegion && { color: C.textMuted }]} numberOfLines={1}>
                {filtroRegion || 'Todas las regiones'}
              </Text>
            </Pressable>

            <Text style={styles.fieldLabel}>Comuna</Text>
            <Pressable
              onPress={onAbrirPickerComuna}
              disabled={!filtroRegion}
              style={({ pressed }) => [styles.pickerField, pressed && filtroRegion && { opacity: 0.85 }, !filtroRegion && { opacity: 0.5 }]}
            >
              <Text style={[styles.pickerFieldText, !filtroComuna && { color: C.textMuted }]} numberOfLines={1}>
                {filtroComuna || (filtroRegion ? 'Todas las comunas' : 'Elige primero la región')}
              </Text>
            </Pressable>

            <View style={styles.fieldLabelRow}>
              <Text style={styles.fieldLabel}>Horario posible</Text>
              {horarioAcotado && <Text style={[styles.fieldLabelValue, { color: tema.main }]}>{hhmm(filtroFromHour)} a {hhmm(filtroToHour)}</Text>}
            </View>
            <View style={styles.hourBoundsRow}>
              <HourBound label="Desde" value={filtroFromHour} min={0} max={filtroToHour} onChange={setFiltroFromHour} tema={tema} />
              <HourBound label="Hasta" value={filtroToHour} min={filtroFromHour} max={23} onChange={setFiltroToHour} tema={tema} />
            </View>
          </ScrollView>

          <Pressable onPress={onClose} style={({ pressed }) => [styles.sheetPrimary, { backgroundColor: tema.main, marginTop: 16 }, pressed && { opacity: 0.85 }]}>
            <Text style={[styles.sheetPrimaryText, { color: tema.ink }]}>{count ? `Ver ${count} ${count === 1 ? 'desafío' : 'desafíos'}` : 'Ajustar filtros'}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function HourBound({ label, value, min, max, onChange, tema }) {
  const atMin = value <= min;
  const atMax = value >= max;
  return (
    <View style={styles.hourBoundBox}>
      <Text style={styles.hourBoundLabel}>{label}</Text>
      <View style={styles.hourBoundRow2}>
        <Pressable
          disabled={atMin}
          onPress={() => onChange(value - 1)}
          style={({ pressed }) => [styles.hourBoundBtn, pressed && !atMin && { opacity: 0.7 }, atMin && { opacity: 0.35 }]}
        >
          <Text style={styles.hourBoundBtnText}>−</Text>
        </Pressable>
        <Text style={styles.hourBoundValue}>{hhmm(value)}</Text>
        <Pressable
          disabled={atMax}
          onPress={() => onChange(value + 1)}
          style={({ pressed }) => [styles.hourBoundBtn, pressed && !atMax && { opacity: 0.7, borderColor: tema.main }, atMax && { opacity: 0.35 }]}
        >
          <Text style={[styles.hourBoundBtnText, !atMax && { color: tema.main }]}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ── Tablero abierto: publicar/editar/respuestas ────────────────── */

function TableroSubScreen({
  subScreen,
  tema,
  soyAdmin,
  working,
  banner,
  onCloseBanner,
  onBack,
  draft,
  setDraft,
  onSubmitDraft,
  editId,
  editingPub,
  nombreDeMiClub,
  onCancelPublicacion,
  respuestas,
  onAceptar,
  onRechazar,
  onReconsiderar,
}) {
  const patch = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  const listo = borradorListo(draft);

  const subtitulo =
    subScreen === 'publicar'
      ? `${nombreDeMiClub} · admin`
      : subScreen === 'editar' && editingPub
      ? `Publicada hace ${haceCuanto(editingPub.created_at) || 'poco'}${
          editingPub.respuestasCount ? ` · ${editingPub.respuestasCount} ${editingPub.respuestasCount === 1 ? 'respuesta' : 'respuestas'}` : ''
        }`
      : subScreen === 'respuestas' && respuestas.length
      ? `${respuestas.length} ${respuestas.length === 1 ? 'respuesta' : 'respuestas'}`
      : '';

  const resumenTexto = listo
    ? `${modalidadInline(draft.modalidad)} · ${draft.fechaStr} ${draft.horaStr}${draft.zona ? ` · ${draft.zona}` : ''}`
    : 'Completa la fecha y hora para continuar.';

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.subHeaderRow}>
        <Pressable onPress={onBack} hitSlop={8} style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}>
          <ArrowLeft color={C.textPrimary} size={18} strokeWidth={2.2} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.subHeaderTitle} numberOfLines={1}>
            {subScreen === 'publicar' ? 'Publicar desafío' : subScreen === 'editar' ? 'Editar publicación' : 'Respuestas'}
          </Text>
          {!!subtitulo && (
            <Text style={styles.subHeaderSubtitle} numberOfLines={1}>
              {subtitulo}
            </Text>
          )}
        </View>
      </View>

      {banner && <Banner {...banner} onClose={onCloseBanner} />}

      {(subScreen === 'publicar' || subScreen === 'editar') && (
        <>
          <Text style={styles.fieldLabel}>Modalidad</Text>
          <View style={styles.chipsRow}>
            {['futbol7', 'futbol11'].map((m) => {
              const activo = draft.modalidad === m;
              return (
                <Pressable key={m} onPress={() => patch('modalidad', m)} style={[styles.optionChip, activo && { backgroundColor: tema.main, borderColor: tema.main }]}>
                  <Text style={[styles.optionChipText, activo && { color: tema.ink }]}>{modalidadInline(m)}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Fecha propuesta</Text>
              <TextInput style={styles.input} placeholder="DD/MM/AAAA" placeholderTextColor={C.textMuted} value={draft.fechaStr} onChangeText={(v) => patch('fechaStr', v)} keyboardType="numbers-and-punctuation" />
            </View>
            <View style={{ width: 110 }}>
              <Text style={styles.fieldLabel}>Hora</Text>
              <TextInput style={styles.input} placeholder="HH:MM" placeholderTextColor={C.textMuted} value={draft.horaStr} onChangeText={(v) => patch('horaStr', v)} keyboardType="numbers-and-punctuation" />
            </View>
          </View>
          <View style={styles.chipsRow}>
            {['20:00', '21:00', '22:00'].map((h) => (
              <Pressable key={h} onPress={() => patch('horaStr', h)} style={styles.hourChip}>
                <Text style={styles.hourChipText}>{h}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.fieldLabel}>Zona / cancha (opcional)</Text>
          <TextInput style={styles.input} placeholder="Ej: Cancha La Reina — o déjalo para acordar por chat" placeholderTextColor={C.textMuted} value={draft.zona} onChangeText={(v) => patch('zona', v)} maxLength={120} />

          <Text style={styles.fieldLabel}>Mensaje (opcional)</Text>
          <TextInput style={[styles.input, styles.inputMultiline]} placeholder="Un saludo o detalles del reto..." placeholderTextColor={C.textMuted} value={draft.mensaje} onChangeText={(v) => patch('mensaje', v)} multiline maxLength={300} />

          <Text style={styles.formSummary}>{resumenTexto}</Text>

          <Pressable
            onPress={onSubmitDraft}
            disabled={!listo || working}
            style={({ pressed }) => [styles.submitBtn, { backgroundColor: listo ? tema.main : C.chip }, pressed && listo && !working && { opacity: 0.85 }]}
          >
            {working ? (
              <ActivityIndicator color={listo ? tema.ink : C.textMuted} />
            ) : (
              <Text style={[styles.submitBtnText, { color: listo ? tema.ink : C.textMuted }]}>
                {listo ? (editId ? 'Guardar cambios' : 'Publicar desafío') : 'Falta la fecha y hora'}
              </Text>
            )}
          </Pressable>

          {editId && (
            <Pressable onPress={onCancelPublicacion} style={({ pressed }) => [styles.withdrawFullBtn, pressed && { opacity: 0.7 }]}>
              <Text style={styles.withdrawFullBtnText}>Retirar publicación</Text>
            </Pressable>
          )}
        </>
      )}

      {subScreen === 'respuestas' && (
        respuestas.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>Todavía nadie respondió.</Text>
          </View>
        ) : (
          respuestas.map((r) => (
            <View key={r.id} style={[styles.responseCard, r.estado === 'rechazada' && { opacity: 0.55 }]}>
              <View style={styles.browseHeaderRow}>
                {r.club?.foto_url ? (
                  <Image source={{ uri: r.club.foto_url }} style={styles.logo} />
                ) : (
                  <View style={[styles.logo, styles.logoFallback]}>
                    <Shield color={C.textMuted} size={18} strokeWidth={1.7} />
                  </View>
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.clubName} numberOfLines={1}>{r.club?.nombre || 'Club'}</Text>
                  <Text style={styles.metaText} numberOfLines={1}>{resumenEstadisticas(r.estadisticas) || 'Sin partidos jugados'}</Text>
                </View>
                {r.estado === 'rechazada' && <EstadoBadge estado="rechazado" />}
              </View>
              {r.mensaje ? <Text style={styles.responseMensaje}>&quot;{r.mensaje}&quot;</Text> : null}
              {soyAdmin && r.estado === 'pendiente' ? (
                <View style={styles.mineActionsRow}>
                  <Pressable onPress={() => onRechazar(r)} style={({ pressed }) => [styles.rejectBtn, pressed && { opacity: 0.7 }]}>
                    <Text style={styles.rejectBtnText}>Rechazar</Text>
                  </Pressable>
                  <Pressable onPress={() => onAceptar(r)} style={({ pressed }) => [styles.mineCta, { backgroundColor: tema.main, flex: 1 }, pressed && { opacity: 0.85 }]}>
                    <Text style={[styles.mineCtaText, { color: tema.ink }]}>Aceptar</Text>
                  </Pressable>
                </View>
              ) : soyAdmin && r.estado === 'rechazada' ? (
                <Pressable onPress={() => onReconsiderar(r)} style={({ pressed }) => [styles.mineEditBtn, styles.reconsiderBtn, pressed && { opacity: 0.7 }]}>
                  <Text style={styles.reconsiderBtnText}>Reconsiderar</Text>
                </Pressable>
              ) : null}
            </View>
          ))
        )
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: S.screenPadding,
    paddingTop: 4,
    paddingBottom: 12,
  },
  iconBtn: {
    width: S.iconBtn,
    height: S.iconBtn,
    borderRadius: R.iconBtn,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnPressed: { backgroundColor: C.chipStrong },
  iconBtnBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: C.loss,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnBadgeText: { color: '#2A0C0F', fontSize: 9.5, fontFamily: F.extraBold },
  headerTitle: { color: C.textPrimary, fontSize: 18, fontFamily: F.extraBold, letterSpacing: -0.3 },
  headerSubtitle: { color: C.textMuted, fontSize: 11.5, fontFamily: F.semiBold, marginTop: 2 },
  publishBtnSmall: { borderRadius: R.iconBtn, paddingHorizontal: 14, height: S.iconBtn, alignItems: 'center', justifyContent: 'center' },
  publishBtnSmallText: { fontSize: 12.5, fontFamily: F.extraBold },
  content: { padding: S.screenPadding, paddingBottom: 40 },

  emptyBox: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 40, paddingHorizontal: 20 },
  emptyBoxDashed: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 34,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: C.border,
    borderRadius: R.row,
  },
  emptyText: { color: C.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 19 },

  sectionTitle: { color: C.textSecondary, fontSize: 10.5, fontFamily: F.extraBold, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10, marginTop: 6 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.surface,
    borderRadius: R.row,
    borderWidth: 1,
    borderColor: C.borderSoft,
    padding: 14,
    marginBottom: 9,
  },
  logo: { width: 44, height: 44, borderRadius: 13 },
  logoLg: { width: 46, height: 46, borderRadius: 13 },
  logoFallback: { backgroundColor: C.chip, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.borderSoft },
  clubName: { color: C.textPrimary, fontSize: 15, fontFamily: F.extraBold },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  metaText: { color: C.textMuted, fontSize: 12, fontFamily: F.semiBold },
  mensaje: { color: C.textSecondary, fontSize: 12, fontStyle: 'italic', marginTop: 4 },

  actionsRow: { flexDirection: 'row', gap: 8 },
  actBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  actReject: { backgroundColor: 'rgba(232,115,123,0.14)', borderWidth: 1, borderColor: 'rgba(232,115,123,0.4)' },
  chatBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.chip, alignItems: 'center', justifyContent: 'center' },
  cancelBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: C.border },
  cancelText: { color: C.textSecondary, fontSize: 12, fontFamily: F.extraBold },
  estadoBadge: { borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4 },
  estadoBadgeText: { fontSize: 9.5, fontFamily: F.extraBold, letterSpacing: 0.4, textTransform: 'uppercase' },

  carruselBox: { marginBottom: 18 },
  carruselHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 },
  carruselHeadLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dotLive: { width: 7, height: 7, borderRadius: 4 },
  carruselHeadLabel: { fontSize: 10.5, fontFamily: F.extraBold, letterSpacing: 1.4, textTransform: 'uppercase' },
  dotsRow: { flexDirection: 'row', gap: 4 },
  dot: { height: 5, borderRadius: 99 },

  mineCard: { borderRadius: R.hero, borderWidth: 1, padding: 16, paddingHorizontal: 18 },
  mineHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  mineStateBadge: { borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4 },
  mineStateBadgeText: { fontSize: 9.5, fontFamily: F.extraBold, letterSpacing: 0.6, textTransform: 'uppercase' },
  mineExpiry: { color: C.textMuted, fontSize: 11.5, fontFamily: F.semiBold },
  mineTitle: { color: C.textPrimary, fontSize: 17, fontFamily: F.extraBold, letterSpacing: -0.3, marginTop: 10 },
  mineSub: { color: C.textMuted, fontSize: 12.5, fontFamily: F.semiBold, marginTop: 8 },
  mineActionsRow: { flexDirection: 'row', gap: 9, marginTop: 14 },
  mineCta: { flex: 1, borderRadius: R.iconBtn, alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  mineCtaText: { fontSize: 13.5, fontFamily: F.extraBold },
  mineEditBtn: { borderRadius: R.iconBtn, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  mineEditBtnText: { color: C.textPrimary, fontSize: 13.5, fontFamily: F.bold },
  reconsiderBtn: { flex: 1 },
  reconsiderBtnText: { color: C.textPrimary, fontSize: 13, fontFamily: F.bold },

  controlsRow: { flexDirection: 'row', gap: 9, marginBottom: 16 },
  filterBtnBig: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: R.iconBtn,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.chip,
    paddingVertical: 13,
  },
  filterBtnBigText: { color: C.textPrimary, fontSize: 13.5, fontFamily: F.extraBold },
  sortBtnBig: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: R.iconBtn,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  sortBtnBigText: { color: C.textSecondary, fontSize: 12, fontFamily: F.bold },

  browseCard: { backgroundColor: C.surface, borderRadius: R.row, borderWidth: 1, borderColor: C.borderSoft, padding: 15, marginBottom: 10 },
  browseHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  browseNameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  browseDist: { fontSize: 13, fontFamily: F.extraBold },
  browseDistSub: { color: C.textMuted, fontSize: 10.5, fontFamily: F.semiBold, marginTop: 3 },
  browseExpiry: { color: C.textMuted, fontSize: 11.5, fontFamily: F.semiBold, marginTop: 12 },
  tagChip: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  tagChipText: { fontSize: 9.5, fontFamily: F.extraBold, letterSpacing: 0.6, textTransform: 'uppercase' },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 12 },
  infoChip: { backgroundColor: C.chip, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6, maxWidth: 200 },
  infoChipText: { color: C.textSecondary, fontSize: 11, fontFamily: F.bold },

  subHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  subHeaderTitle: { color: C.textPrimary, fontSize: 18, fontFamily: F.extraBold, letterSpacing: -0.3 },
  subHeaderSubtitle: { color: C.textMuted, fontSize: 11.5, fontFamily: F.semiBold, marginTop: 2 },
  formSummary: { color: C.textMuted, fontSize: 12, fontFamily: F.semiBold, lineHeight: 17, marginTop: 14 },

  fieldLabel: { color: C.textSecondary, fontSize: 11, fontFamily: F.extraBold, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 9, marginTop: 6 },
  optionChip: { borderRadius: R.iconBtn, borderWidth: 1, borderColor: C.border, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 4 },
  optionChipText: { color: C.textSecondary, fontSize: 13, fontFamily: F.bold },
  row2: { flexDirection: 'row', gap: 12 },
  input: {
    backgroundColor: C.chip,
    borderRadius: R.iconBtn,
    borderWidth: 1,
    borderColor: C.border,
    color: C.textPrimary,
    fontSize: 15,
    fontFamily: F.semiBold,
    paddingHorizontal: 14,
    height: 50,
    marginBottom: 12,
  },
  inputMultiline: { height: 90, paddingTop: 14, textAlignVertical: 'top' },
  hourChip: { borderRadius: 999, borderWidth: 1, borderColor: C.border, paddingHorizontal: 13, paddingVertical: 8, marginTop: -4, marginBottom: 12 },
  hourChipText: { color: C.textSecondary, fontSize: 12, fontFamily: F.bold },
  submitBtn: { height: 52, borderRadius: R.iconBtn, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  submitBtnText: { fontSize: 15, fontFamily: F.extraBold },
  withdrawFullBtn: { height: 50, borderRadius: R.iconBtn, borderWidth: 1, borderColor: C.loss, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  withdrawFullBtnText: { color: C.loss, fontSize: 13.5, fontFamily: F.bold },

  responseCard: { backgroundColor: C.surface, borderRadius: R.row, borderWidth: 1, borderColor: C.borderSoft, padding: 15, marginBottom: 10 },
  responseMensaje: { backgroundColor: C.chip, borderRadius: 12, padding: 12, color: C.textSecondary, fontSize: 12.5, marginTop: 12 },
  rejectBtn: { borderRadius: R.iconBtn, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  rejectBtnText: { color: C.textSecondary, fontSize: 13, fontFamily: F.bold },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: R.hero,
    borderTopRightRadius: R.hero,
    borderTopWidth: 1,
    borderColor: C.border,
    paddingHorizontal: S.screenPadding,
    paddingTop: 14,
    paddingBottom: 30,
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 3, backgroundColor: C.chipStrong, alignSelf: 'center', marginBottom: 14 },
  sheetHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sheetTitle: { color: C.textPrimary, fontSize: 17, fontFamily: F.extraBold, letterSpacing: -0.3 },
  sheetSubtitle: { color: C.textSecondary, fontSize: 12.5, marginTop: 4 },
  factsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
  factCard: { width: '47%', backgroundColor: C.chip, borderWidth: 1, borderColor: C.borderSoft, borderRadius: R.iconBtn, padding: 12 },
  factLabel: { color: C.textMuted, fontSize: 9.5, fontFamily: F.extraBold, letterSpacing: 1, textTransform: 'uppercase' },
  factValue: { color: C.textPrimary, fontSize: 13.5, fontFamily: F.bold, marginTop: 5 },
  sheetMensaje: { color: C.textSecondary, fontSize: 12.5, fontStyle: 'italic', marginTop: 14 },
  sheetTextarea: {
    backgroundColor: C.chip,
    borderRadius: R.iconBtn,
    borderWidth: 1,
    borderColor: C.border,
    color: C.textPrimary,
    fontSize: 14,
    padding: 14,
    height: 90,
    textAlignVertical: 'top',
    marginTop: 16,
    marginBottom: 14,
  },
  sheetPrimary: { height: 52, borderRadius: R.iconBtn, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  sheetPrimaryText: { fontSize: 15, fontFamily: F.extraBold },
  sheetRespondedBox: { marginTop: 16 },
  sheetRespondedText: { color: C.textSecondary, fontSize: 12.5, fontFamily: F.semiBold, lineHeight: 18 },
  sheetRespondedTextMuted: { color: C.textMuted, fontSize: 12.5, fontFamily: F.semiBold },

  filterSheetHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  clearBtn: { borderRadius: R.iconBtn, borderWidth: 1, borderColor: C.border, paddingHorizontal: 13, paddingVertical: 9 },
  clearBtnText: { color: C.textSecondary, fontSize: 12, fontFamily: F.bold },

  pickerField: {
    backgroundColor: C.chip,
    borderRadius: R.iconBtn,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 15,
    paddingVertical: 14,
    marginBottom: 6,
  },
  pickerFieldText: { color: C.textPrimary, fontSize: 14, fontFamily: F.semiBold },
  fieldLabelRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  fieldLabelValue: { fontSize: 11.5, fontFamily: F.bold, marginBottom: 9, marginTop: 6 },
  hourBoundsRow: { flexDirection: 'row', gap: 9, marginTop: 2 },
  hourBoundBox: { flex: 1, backgroundColor: C.chip, borderWidth: 1, borderColor: C.border, borderRadius: R.iconBtn, padding: 10 },
  hourBoundLabel: { color: C.textMuted, fontSize: 9.5, fontFamily: F.extraBold, letterSpacing: 1, textTransform: 'uppercase', textAlign: 'center' },
  hourBoundRow2: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  hourBoundBtn: { flex: 0, width: 32, height: 32, borderRadius: 10, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  hourBoundBtnText: { color: C.textPrimary, fontSize: 18, fontFamily: F.bold, lineHeight: 20 },
  hourBoundValue: { flex: 1, textAlign: 'center', color: C.textPrimary, fontSize: 15, fontFamily: F.extraBold },
});
