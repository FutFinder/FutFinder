import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Image, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeft, Shield, Swords, Check, X, Clock, MessageCircle } from 'lucide-react-native';

import Banner from '../components/Banner';
import { IconButton, Badge } from '../components/reservas/ui';
import { reservas as C, reservasRadius as R, reservasFonts as F } from '../theme/colors';
import { temaDeClub } from '../theme/clubThemes';
import { getMisClubesAdmin, getClubById } from '../services/clubs';
import { puedeResponderDesafio, puedeCancelarDesafio } from '../utils/permisosDesafio';
import {
  listChallengesForClub,
  respondChallenge,
  cancelChallenge,
} from '../services/clubChallenges';
import { esEstadoActivo, estadoLabel } from '../services/clubChallengeRules';
import { challengeThreadKey, challengeThreadTitle } from '../utils/challengeThread';

/**
 * El texto de cada estado sale de `clubChallengeRules` (espejo de
 * `desafio_reglas()`): acá solo se decide el tono del badge.
 */
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
 * Bandeja de desafíos de un club: recibidos (aceptar/rechazar) y enviados
 * (cancelar). Responder es solo para admins; ver es para cualquier miembro.
 * params: { clubId }
 *
 * Rediseño visual (handoff «Desafío entre clubes», comparte tokens con
 * Reservas) — toda la lógica de carga, permisos y acciones es la misma que
 * ya estaba: no se tocó ningún servicio ni regla.
 */
export default function ClubChallengesScreen({ navigation, route }) {
  const { clubId } = route.params || {};

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [recibidos, setRecibidos] = useState([]);
  const [enviados, setEnviados] = useState([]);
  // TODOS los clubes que administro, no sólo éste: la pregunta «¿puedo
  // responder este reto?» la contesta la misma regla que usa «Avisos».
  const [clubesAdmin, setClubesAdmin] = useState(null);
  const [errorRol, setErrorRol] = useState(null);
  const [banner, setBanner] = useState(null);
  const [working, setWorking] = useState(false);
  // Hace falta para armar el título «Retador vs Retado» del hilo grupal:
  // las filas de desafío solo traen el club RIVAL, no el propio.
  const [nombreDeMiClub, setNombreDeMiClub] = useState('Mi club');
  // El club propio completo (no solo el nombre): de acá sale el acento de
  // la pantalla. Mientras no cargue, `temaDeClub(null)` ya cae al verde por
  // defecto, así que no hay un instante sin color.
  const [clubActual, setClubActual] = useState(null);

  const load = useCallback(async () => {
    const [{ data }, { data: clubesAdmin, error: eRol }, { data: miClub }] = await Promise.all([
      listChallengesForClub(clubId),
      getMisClubesAdmin(),
      getClubById(clubId),
    ]);
    setRecibidos(data.recibidos || []);
    setEnviados(data.enviados || []);

    // `clubesAdmin` en null es «no se pudo averiguar», no «no eres admin».
    // Antes las dos cosas se coercían al mismo `false` y la pantalla escondía
    // aceptar y rechazar sin decir nada: una comprobación manual entera se
    // quedó sin saber si le faltaba permiso o si algo había fallado.
    setClubesAdmin(clubesAdmin ?? null);
    setErrorRol(clubesAdmin ? null : eRol?.message || 'No se pudo comprobar tu rol en el club.');

    if (miClub?.nombre) setNombreDeMiClub(miClub.nombre);
    setClubActual(miClub || null);
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

  /**
   * Conversación LEGADA de un desafío anterior a la migración 42: un DM
   * entre dos administradores. No se migra ninguna fila, así que estos
   * desafíos conservan su chat tal como estaba.
   */
  const abrirChatLegado = (userId, titulo, challengeId) => {
    if (!userId) return;
    navigation.navigate('ChatThread', {
      threadKey: `dm:${userId}`,
      title: titulo || 'Coordinar partido',
      subtitle: 'Coordinar partido de clubes',
      challengeId, // habilita el chat sin ser amigos + botón de crear partido
    });
  };

  /** Hilo grupal de negociación: todos los administradores de ambos clubes. */
  const abrirNegociacion = (challenge) => {
    const threadKey = challengeThreadKey(challenge?.id);
    if (!threadKey) return;
    const esRecibido = challenge.club_retado_id === clubId;
    // El título es siempre «Retador vs Retado», mire quien mire.
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
      // El mensaje de sistema, el evento y los avisos ya los dejó la RPC
      // dentro de la misma transacción: acá solo hay que llevar al usuario
      // a la conversación.
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

  // Escala del club propio: resuelta una sola vez y en línea donde haga
  // falta, porque `StyleSheet.create` no puede depender de un valor dinámico.
  const tema = temaDeClub(clubActual);

  if (loading) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <Header navigation={navigation} />
        <View style={styles.loadingBox}>
          <ActivityIndicator color={tema.main} />
        </View>
      </SafeAreaView>
    );
  }

  const sinNada = recibidos.length === 0 && enviados.length === 0;

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <Header navigation={navigation} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={tema.main} colors={[tema.main]} />
        }
      >
        {banner && <Banner {...banner} onClose={() => setBanner(null)} />}

        {/* Que no se pueda comprobar el rol NO se dibuja como «no eres
          admin»: sin esto, aceptar y rechazar desaparecían en silencio y
          desde la pantalla era imposible distinguir un fallo de carga de una
          falta de permisos. */}
        {!!errorRol && (
          <Banner
            type="error"
            title="No pudimos comprobar tu rol"
            message={`${errorRol} Desliza para reintentar: mientras tanto no se muestran aceptar ni rechazar.`}
          />
        )}

        {sinNada && (
          <View style={styles.emptyBox}>
            <Swords color={C.textMuted} size={36} strokeWidth={1.6} />
            <Text style={styles.emptyText}>
              Aún no hay desafíos. Reta a un club desde su perfil para empezar.
            </Text>
          </View>
        )}

        {recibidos.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Recibidos</Text>
            {recibidos.map((c) => (
              <ChallengeRow key={c.id} challenge={c}>
                {puedeResponderDesafio({ clubesAdmin, clubRetadoId: c.club_retado_id, estado: c.estado }) ? (
                  <View style={styles.actionsRow}>
                    <Pressable
                      disabled={working}
                      onPress={() => handleRespond(c, true)}
                      hitSlop={6}
                      style={({ pressed }) => [
                        styles.actBtn,
                        { backgroundColor: tema.main },
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <Check color={tema.ink} size={16} strokeWidth={2.6} />
                    </Pressable>
                    <Pressable
                      disabled={working}
                      onPress={() => handleRespond(c, false)}
                      hitSlop={6}
                      style={({ pressed }) => [styles.actBtn, styles.actReject, pressed && { opacity: 0.7 }]}
                    >
                      <X color={C.red} size={16} strokeWidth={2.6} />
                    </Pressable>
                  </View>
                ) : esEstadoActivo(c.estado) ? (
                  <Pressable
                    onPress={() => abrirNegociacion(c)}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel="Abrir el chat de negociación del desafío"
                    style={({ pressed }) => [styles.chatBtn, pressed && { opacity: 0.7 }]}
                  >
                    <Swords color={tema.main} size={16} />
                  </Pressable>
                ) : c.estado === 'aceptado' ? (
                  <Pressable
                    onPress={() => abrirChatLegado(c.creado_por, c.otroClub?.nombre, c.id)}
                    hitSlop={6}
                    style={({ pressed }) => [styles.chatBtn, pressed && { opacity: 0.7 }]}
                  >
                    <MessageCircle color={tema.main} size={16} />
                  </Pressable>
                ) : (
                  <Badge label={estadoLabel(c.estado)} tone={ESTADO_TONE[c.estado] || 'neutral'} />
                )}
              </ChallengeRow>
            ))}
          </>
        )}

        {enviados.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Enviados</Text>
            {enviados.map((c) => (
              <ChallengeRow key={c.id} challenge={c}>
                {puedeCancelarDesafio({ clubesAdmin, clubRetadorId: c.club_retador_id, estado: c.estado }) ? (
                  <Pressable
                    disabled={working}
                    onPress={() => handleCancel(c)}
                    hitSlop={6}
                    style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.7 }]}
                  >
                    <Text style={styles.cancelText}>Cancelar</Text>
                  </Pressable>
                ) : esEstadoActivo(c.estado) ? (
                  <Pressable
                    onPress={() => abrirNegociacion(c)}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel="Abrir el chat de negociación del desafío"
                    style={({ pressed }) => [styles.chatBtn, pressed && { opacity: 0.7 }]}
                  >
                    <Swords color={tema.main} size={16} />
                  </Pressable>
                ) : c.estado === 'aceptado' ? (
                  <Pressable
                    onPress={() => abrirChatLegado(c.respondido_por, c.otroClub?.nombre, c.id)}
                    hitSlop={6}
                    style={({ pressed }) => [styles.chatBtn, pressed && { opacity: 0.7 }]}
                  >
                    <MessageCircle color={tema.main} size={16} />
                  </Pressable>
                ) : (
                  <Badge label={estadoLabel(c.estado)} tone={ESTADO_TONE[c.estado] || 'neutral'} />
                )}
              </ChallengeRow>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Header({ navigation }) {
  return (
    <View style={styles.header}>
      <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
      <Text style={styles.headerTitle}>Desafíos</Text>
      <View style={{ width: 40 }} />
    </View>
  );
}

function ChallengeRow({ challenge, children }) {
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
        {challenge.mensaje ? (
          <Text style={styles.mensaje} numberOfLines={2}>“{challenge.mensaje}”</Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  headerTitle: { fontFamily: F.extraBold, fontSize: 18, color: C.textPrimary, letterSpacing: -0.3 },
  content: { padding: 20, paddingBottom: 40 },

  emptyBox: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 60, paddingHorizontal: 30 },
  emptyText: { fontFamily: F.medium, color: C.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },

  sectionTitle: {
    fontFamily: F.bold,
    color: C.textSecondary,
    fontSize: 10.5,
    letterSpacing: 1.5,
    marginBottom: 10,
    marginTop: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.surface,
    borderRadius: R.row,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    marginBottom: 9,
  },
  logo: { width: 44, height: 44, borderRadius: 22 },
  logoFallback: {
    backgroundColor: C.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  clubName: { fontFamily: F.extraBold, color: C.textPrimary, fontSize: 15 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  metaText: { fontFamily: F.medium, color: C.textMuted, fontSize: 12 },
  mensaje: { fontFamily: F.medium, color: C.textSecondary, fontSize: 12, fontStyle: 'italic', marginTop: 4 },

  actionsRow: { flexDirection: 'row', gap: 8 },
  actBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  actReject: { backgroundColor: 'rgba(237,107,118,0.14)', borderWidth: 1, borderColor: 'rgba(237,107,118,0.4)' },
  chatBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.shieldBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: C.border,
  },
  cancelText: { fontFamily: F.bold, color: C.textSecondary, fontSize: 12 },
});
