import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, Shield, Swords, Check } from 'lucide-react-native';

import { colors, radius } from '../theme/colors';
import Banner from '../components/Banner';
import Button from '../components/Button';
import { getMyClubs } from '../services/clubs';
import { createChallenge } from '../services/clubChallenges';

function formatDate(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}
function formatTime(d) {
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mi}`;
}
// Parsea "DD/MM/YYYY" + "HH:MM" → Date (o null si inválido)
function parseDateTime(dateStr, timeStr) {
  const dParts = (dateStr || '').split('/');
  const tParts = (timeStr || '').split(':');
  if (dParts.length !== 3 || tParts.length !== 2) return null;
  const [dd, mm, yyyy] = dParts.map((s) => parseInt(s.trim(), 10));
  const [hh, mi] = tParts.map((s) => parseInt(s.trim(), 10));
  if ([dd, mm, yyyy, hh, mi].some(Number.isNaN)) return null;
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || hh > 23 || mi > 59) return null;
  const d = new Date(yyyy, mm - 1, dd, hh, mi, 0, 0);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * Enviar un desafío a otro club. Se llega desde el ClubDetail del rival.
 * params: { rivalClubId, rivalNombre, rivalFotoUrl }
 *
 * Desafío AS uno de mis clubes donde soy admin (si tengo varios, elijo).
 */
export default function ClubChallengeScreen({ navigation, route }) {
  const { rivalClubId, rivalNombre, rivalFotoUrl } = route.params || {};

  const defaultDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // mañana
  defaultDate.setHours(20, 0, 0, 0);

  const [loading, setLoading] = useState(true);
  const [misClubs, setMisClubs] = useState([]); // clubs donde soy admin (≠ rival)
  const [retadorId, setRetadorId] = useState(null);
  const [fechaStr, setFechaStr] = useState(formatDate(defaultDate));
  const [horaStr, setHoraStr] = useState(formatTime(defaultDate));
  const [zona, setZona] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [banner, setBanner] = useState(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await getMyClubs();
      const admin = (data || [])
        .filter((m) => m.miRol === 'admin' && m.club?.id !== rivalClubId)
        .map((m) => m.club);
      setMisClubs(admin);
      setRetadorId(admin[0]?.id || null);
      setLoading(false);
    })();
  }, [rivalClubId]);

  const handleSend = async () => {
    if (!retadorId) {
      setBanner({ type: 'error', title: 'Sin club', message: 'No tienes un club para desafiar.' });
      return;
    }
    const fecha = parseDateTime(fechaStr, horaStr);
    if (!fecha) {
      setBanner({ type: 'error', title: 'Fecha inválida', message: 'Usa el formato DD/MM/AAAA y HH:MM.' });
      return;
    }
    if (fecha.getTime() < Date.now()) {
      setBanner({ type: 'error', title: 'Fecha pasada', message: 'La fecha propuesta debe ser futura.' });
      return;
    }

    setSending(true);
    const { error } = await createChallenge({
      retadorClubId: retadorId,
      retadoClubId: rivalClubId,
      fechaPropuesta: fecha,
      zona,
      mensaje,
    });
    setSending(false);
    if (error) {
      setBanner({ type: 'error', title: 'No se pudo enviar', message: error.message });
      return;
    }
    // Feedback en la propia pantalla y volvemos atrás (sin navegación cruzada).
    setSent(true);
    setBanner({
      type: 'success',
      title: 'Desafío enviado',
      message: `Se avisó a ${rivalNombre || 'el club rival'}. Te notificaremos cuando respondan.`,
    });
    setTimeout(() => {
      if (navigation.canGoBack()) navigation.goBack();
    }, 1200);
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Desafiar club</Text>
          <Text style={styles.headerSubtitle}>Reta a otro equipo a un partido</Text>
        </View>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}
        >
          <X color={colors.textPrimary} size={20} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : misClubs.length === 0 ? (
        <View style={styles.content}>
          <Banner
            type="info"
            title="Necesitas ser admin de un club"
            message="Solo un administrador de un club puede enviar desafíos a otros equipos."
          />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {banner && <Banner {...banner} onClose={() => setBanner(null)} />}

            {/* Rival */}
            <View style={styles.rivalCard}>
              <Swords color={colors.primary} size={18} />
              <Text style={styles.rivalLabel}>Desafías a</Text>
              <View style={styles.rivalChip}>
                {rivalFotoUrl ? (
                  <Image source={{ uri: rivalFotoUrl }} style={styles.rivalLogo} />
                ) : (
                  <View style={[styles.rivalLogo, styles.rivalLogoFallback]}>
                    <Shield color={colors.textMuted} size={14} />
                  </View>
                )}
                <Text style={styles.rivalName} numberOfLines={1}>
                  {rivalNombre || 'Club rival'}
                </Text>
              </View>
            </View>

            {/* Retador (si tengo más de un club admin) */}
            {misClubs.length > 1 && (
              <>
                <Text style={styles.label}>Desafías con tu club</Text>
                <View style={styles.optionsBox}>
                  {misClubs.map((c) => (
                    <Pressable
                      key={c.id}
                      onPress={() => setRetadorId(c.id)}
                      style={({ pressed }) => [
                        styles.option,
                        c.id === retadorId && styles.optionActive,
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <Text style={[styles.optionText, c.id === retadorId && styles.optionTextActive]}>
                        {c.nombre}
                      </Text>
                      {c.id === retadorId && <Check color={colors.primary} size={16} />}
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            {/* Fecha y hora */}
            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Fecha propuesta</Text>
                <TextInput
                  style={styles.input}
                  placeholder="DD/MM/AAAA"
                  placeholderTextColor={colors.textMuted}
                  value={fechaStr}
                  onChangeText={setFechaStr}
                  keyboardType="numbers-and-punctuation"
                />
              </View>
              <View style={{ width: 110 }}>
                <Text style={styles.label}>Hora</Text>
                <TextInput
                  style={styles.input}
                  placeholder="HH:MM"
                  placeholderTextColor={colors.textMuted}
                  value={horaStr}
                  onChangeText={setHoraStr}
                  keyboardType="numbers-and-punctuation"
                />
              </View>
            </View>
            <View style={styles.chipsRow}>
              <QuickChip label="20:00" onPress={() => setHoraStr('20:00')} />
              <QuickChip label="21:00" onPress={() => setHoraStr('21:00')} />
              <QuickChip label="22:00" onPress={() => setHoraStr('22:00')} />
            </View>

            {/* Zona (opcional) */}
            <Text style={styles.label}>Zona / cancha (opcional)</Text>
            <TextInput
              style={styles.input}
              placeholder="Ej: Cancha La Reina — o déjalo para acordar por chat"
              placeholderTextColor={colors.textMuted}
              value={zona}
              onChangeText={setZona}
              maxLength={120}
            />

            {/* Mensaje (opcional) */}
            <Text style={styles.label}>Mensaje (opcional)</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              placeholder="Un saludo o detalles del reto..."
              placeholderTextColor={colors.textMuted}
              value={mensaje}
              onChangeText={setMensaje}
              multiline
              maxLength={300}
            />

            <Button
              label={sent ? 'Desafío enviado' : 'Enviar desafío'}
              icon={<Swords color="#0E0E0D" size={18} strokeWidth={2.4} />}
              onPress={handleSend}
              loading={sending}
              disabled={sent}
              style={styles.submitBtn}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

function QuickChip({ label, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.quickChip, pressed && { opacity: 0.7 }]}
    >
      <Text style={styles.quickChipText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerCenter: { flex: 1 },
  headerTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '800', letterSpacing: -0.4 },
  headerSubtitle: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { padding: 16, paddingBottom: 40 },

  rivalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.lg,
    padding: 12,
    marginBottom: 18,
  },
  rivalLabel: { color: colors.textSecondary, fontSize: 13 },
  rivalChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    justifyContent: 'flex-end',
  },
  rivalLogo: { width: 28, height: 28, borderRadius: 14 },
  rivalLogoFallback: {
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rivalName: { color: colors.textPrimary, fontSize: 15, fontWeight: '700', flexShrink: 1 },

  label: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 4,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    color: colors.textPrimary,
    fontSize: 15,
    paddingHorizontal: 14,
    height: 52,
    marginBottom: 16,
  },
  inputMultiline: { height: 90, paddingTop: 14, textAlignVertical: 'top' },
  row2: { flexDirection: 'row', gap: 12 },
  chipsRow: { flexDirection: 'row', gap: 8, marginTop: -8, marginBottom: 16 },
  quickChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  quickChipText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },

  optionsBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    marginBottom: 16,
    overflow: 'hidden',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  optionActive: { backgroundColor: colors.primarySoft },
  optionText: { color: colors.textPrimary, fontSize: 14 },
  optionTextActive: { color: colors.primary, fontWeight: '700' },

  submitBtn: { marginTop: 8 },
});
