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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeft, Shield, Swords, Check, X, Clock, MessageCircle } from 'lucide-react-native';

import { colors, radius } from '../theme/colors';
import Banner from '../components/Banner';
import { getCurrentUser } from '../services/auth';
import { listMembers } from '../services/clubs';
import { sendMessage } from '../services/messages';
import {
  listChallengesForClub,
  respondChallenge,
  cancelChallenge,
} from '../services/clubChallenges';

const ESTADO_LABEL = {
  pendiente: { text: 'Pendiente', color: colors.textSecondary },
  aceptado: { text: 'Aceptado', color: colors.primary },
  rechazado: { text: 'Rechazado', color: colors.error },
  cancelado: { text: 'Cancelado', color: colors.textMuted },
  expirado: { text: 'Expirado', color: colors.textMuted },
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
 */
export default function ClubChallengesScreen({ navigation, route }) {
  const { clubId } = route.params || {};

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [recibidos, setRecibidos] = useState([]);
  const [enviados, setEnviados] = useState([]);
  const [soyAdmin, setSoyAdmin] = useState(false);
  const [banner, setBanner] = useState(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    const user = await getCurrentUser();
    const myId = user?.id || null;

    const [{ data }, { data: ms }] = await Promise.all([
      listChallengesForClub(clubId),
      listMembers(clubId),
    ]);
    setRecibidos(data.recibidos || []);
    setEnviados(data.enviados || []);
    setSoyAdmin((ms || []).some((m) => m.user_id === myId && m.rol === 'admin'));
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

  const abrirChatCon = (userId, titulo, challengeId) => {
    if (!userId) return;
    navigation.navigate('ChatThread', {
      threadKey: `dm:${userId}`,
      title: titulo || 'Coordinar partido',
      subtitle: 'Coordinar partido de clubes',
      challengeId, // habilita el chat sin ser amigos + botón de crear partido
    });
  };

  const handleRespond = async (challenge, accept) => {
    setWorking(true);
    const { error } = await respondChallenge(challenge.id, accept);
    setWorking(false);
    if (error) {
      setBanner({ type: 'error', title: 'No se pudo responder', message: error.message });
      return;
    }
    await load();
    if (accept && challenge.creado_por) {
      // Mensaje inicial automático: deja el DM creado y visible en la lista de
      // chats (un DM vacío no aparece) y le da contexto al otro admin.
      await sendMessage(
        `dm:${challenge.creado_por}`,
        '⚔️ ¡Desafío aceptado! Coordinemos aquí la cancha, la hora y los detalles del partido.'
      );
      setBanner({
        type: 'success',
        title: 'Desafío aceptado',
        message: 'Se abrió el chat con el otro admin para coordinar los detalles.',
      });
      // Abrir DM con el admin que creó el desafío (creado_por ya viene en la fila)
      abrirChatCon(challenge.creado_por, challenge.otroClub?.nombre, challenge.id);
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

  if (loading) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <Header navigation={navigation} />
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.primary} />
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
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {banner && <Banner {...banner} onClose={() => setBanner(null)} />}

        {sinNada && (
          <View style={styles.emptyBox}>
            <Swords color={colors.textMuted} size={36} />
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
                {soyAdmin && c.estado === 'pendiente' ? (
                  <View style={styles.actionsRow}>
                    <Pressable
                      disabled={working}
                      onPress={() => handleRespond(c, true)}
                      hitSlop={6}
                      style={({ pressed }) => [styles.actBtn, styles.actAccept, pressed && { opacity: 0.7 }]}
                    >
                      <Check color="#0E0E0D" size={16} strokeWidth={2.6} />
                    </Pressable>
                    <Pressable
                      disabled={working}
                      onPress={() => handleRespond(c, false)}
                      hitSlop={6}
                      style={({ pressed }) => [styles.actBtn, styles.actReject, pressed && { opacity: 0.7 }]}
                    >
                      <X color={colors.error} size={16} strokeWidth={2.6} />
                    </Pressable>
                  </View>
                ) : c.estado === 'aceptado' ? (
                  <Pressable
                    onPress={() => abrirChatCon(c.creado_por, c.otroClub?.nombre, c.id)}
                    hitSlop={6}
                    style={({ pressed }) => [styles.chatBtn, pressed && { opacity: 0.7 }]}
                  >
                    <MessageCircle color={colors.primary} size={16} />
                  </Pressable>
                ) : (
                  <EstadoPill estado={c.estado} />
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
                {soyAdmin && c.estado === 'pendiente' ? (
                  <Pressable
                    disabled={working}
                    onPress={() => handleCancel(c)}
                    hitSlop={6}
                    style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.7 }]}
                  >
                    <Text style={styles.cancelText}>Cancelar</Text>
                  </Pressable>
                ) : c.estado === 'aceptado' ? (
                  <Pressable
                    onPress={() => abrirChatCon(c.respondido_por, c.otroClub?.nombre, c.id)}
                    hitSlop={6}
                    style={({ pressed }) => [styles.chatBtn, pressed && { opacity: 0.7 }]}
                  >
                    <MessageCircle color={colors.primary} size={16} />
                  </Pressable>
                ) : (
                  <EstadoPill estado={c.estado} />
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
      <Pressable
        onPress={() => navigation.goBack()}
        hitSlop={12}
        style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
      >
        <ArrowLeft color={colors.textPrimary} size={22} />
      </Pressable>
      <Text style={styles.headerTitle}>Desafíos</Text>
      <View style={styles.iconBtn} />
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
          <Shield color={colors.textMuted} size={18} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.clubName} numberOfLines={1}>{club?.nombre || 'Club'}</Text>
        <View style={styles.metaRow}>
          <Clock color={colors.textMuted} size={12} />
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

function EstadoPill({ estado }) {
  const cfg = ESTADO_LABEL[estado] || ESTADO_LABEL.pendiente;
  return (
    <View style={[styles.estadoPill, { borderColor: cfg.color }]}>
      <Text style={[styles.estadoPillText, { color: cfg.color }]}>{cfg.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  content: { padding: 16, paddingBottom: 40 },

  emptyBox: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 60, paddingHorizontal: 30 },
  emptyText: { color: colors.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },

  sectionTitle: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
    marginTop: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 12,
    marginBottom: 8,
  },
  logo: { width: 44, height: 44, borderRadius: 22 },
  logoFallback: {
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  clubName: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  metaText: { color: colors.textMuted, fontSize: 12 },
  mensaje: { color: colors.textSecondary, fontSize: 12, fontStyle: 'italic', marginTop: 4 },

  actionsRow: { flexDirection: 'row', gap: 8 },
  actBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  actAccept: { backgroundColor: colors.primary },
  actReject: { backgroundColor: colors.errorSoft, borderWidth: 1, borderColor: colors.error },
  chatBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  estadoPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  estadoPillText: { fontSize: 11, fontWeight: '800' },
});
