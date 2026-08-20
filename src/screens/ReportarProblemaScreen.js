import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Image, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Bug,
  Calendar,
  UserX,
  Lightbulb,
  Info,
  Plus,
  X as XIcon,
  Check,
  FileText,
} from 'lucide-react-native';

import { reservas as C, reservasRadius as R, reservasFonts as F } from '../theme/colors';
import { Card, IconButton, Button, StickyFooter, NoticeCard } from '../components/reservas/ui';
import Banner from '../components/Banner';
import { pickImage } from '../services/storage';
import { CATEGORIAS_TICKET, submitSupportTicket } from '../services/supportTickets';

const CATEGORY_ICONS = {
  fallo_tecnico: Bug,
  reserva_cancha: Calendar,
  comportamiento_jugador: UserX,
  sugerencia: Lightbulb,
};

const DESC_MAX = 600;

function CategoryCard({ label, sub, Icon, active, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      style={[styles.catCard, active && styles.catCardActive]}
    >
      <View style={[styles.catIcon, active && styles.catIconActive]}>
        <Icon color={active ? C.green : C.textSecondary} size={17} strokeWidth={1.9} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.catLabel}>{label}</Text>
        <Text style={styles.catSub}>{sub}</Text>
      </View>
      <View style={[styles.catDot, active && styles.catDotActive]}>
        {active ? <View style={styles.catDotInner} /> : null}
      </View>
    </Pressable>
  );
}

/** Pantalla "Reportar un problema" (Ajustes → Soporte). */
export default function ReportarProblemaScreen({ navigation }) {
  const [uiState, setUiState] = useState('form'); // 'form' | 'sending' | 'ok'
  const [step, setStep] = useState(null); // 'screenshot' | 'ticket' — solo en 'sending'
  const [category, setCategory] = useState(CATEGORIAS_TICKET[0].value);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [screenshot, setScreenshot] = useState(null); // asset de pickImage
  const [banner, setBanner] = useState(null);
  const [folio, setFolio] = useState(null);

  const showBanner = (type, titleMsg, message = '') => {
    setBanner({ type, title: titleMsg, message });
    if (type !== 'error') setTimeout(() => setBanner(null), 4000);
  };

  const handlePickScreenshot = async () => {
    const { ok, asset, reason } = await pickImage({ aspect: [4, 3], quality: 0.8, base64: false });
    if (!ok) {
      if (reason && reason !== 'Cancelado') {
        showBanner('error', 'No pude abrir tus fotos', reason);
      }
      return;
    }
    setScreenshot(asset);
  };

  const resetForm = () => {
    setCategory(CATEGORIAS_TICKET[0].value);
    setTitle('');
    setDescription('');
    setScreenshot(null);
    setBanner(null);
    setFolio(null);
    setStep(null);
    setUiState('form');
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      showBanner('error', 'Falta el asunto', 'Cuéntanos brevemente qué pasó.');
      return;
    }
    setUiState('sending');
    const { data, error } = await submitSupportTicket({
      category,
      title,
      description,
      screenshotAsset: screenshot,
      onStep: setStep,
    });
    if (error) {
      setUiState('form');
      showBanner('error', 'No pudimos enviar tu reporte', error.message || '');
      return;
    }
    setFolio(data.id);
    setUiState('ok');
  };

  if (uiState === 'sending') {
    const steps = [
      ...(screenshot ? [{ key: 'screenshot', label: 'Subiendo captura de pantalla' }] : []),
      { key: 'ticket', label: 'Guardando el reporte' },
    ];
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <View style={styles.centerScreen}>
          <ActivityIndicator color={C.green} size="large" />
          <Text style={styles.centerTitle}>Enviando tu reporte</Text>
          <Text style={styles.centerSub}>No cierres la app, puede tardar unos segundos.</Text>

          <Card style={styles.stepsCard}>
            {steps.map((s, i) => {
              const done = step === 'ticket' && s.key === 'screenshot';
              const active = step === s.key;
              return (
                <View key={s.key} style={[styles.stepRow, i < steps.length - 1 && styles.stepRowDivider]}>
                  <View style={[styles.stepDot, done && styles.stepDotDone]}>
                    {done ? <Check color={C.green} size={12} strokeWidth={2.8} /> : active ? (
                      <ActivityIndicator color={C.green} size="small" />
                    ) : null}
                  </View>
                  <Text style={styles.stepLabel}>{s.label}</Text>
                </View>
              );
            })}
          </Card>
        </View>
      </SafeAreaView>
    );
  }

  if (uiState === 'ok') {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <View style={styles.centerScreen}>
          <View style={styles.okIcon}>
            <Check color={C.green} size={32} strokeWidth={2.4} />
          </View>
          <Text style={styles.centerTitle}>¡Reporte recibido!</Text>
          <Text style={styles.centerSub}>
            Gracias por ayudarnos a mejorar FutFinder. Responderemos a tu correo si es necesario.
          </Text>
          {folio ? (
            <View style={styles.folioChip}>
              <FileText color={C.textSecondary} size={14} strokeWidth={1.9} />
              <Text style={styles.folioText}>Folio #{String(folio).slice(0, 8).toUpperCase()}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.footerBtns}>
          <Button label="Volver a ajustes" onPress={() => navigation.goBack()} />
          <Button label="Enviar otro reporte" variant="secondary" onPress={resetForm} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Reportar un problema</Text>
          <Text style={styles.headerSubtitle}>Respondemos a tu correo si hace falta</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {banner && <Banner {...banner} onClose={() => setBanner(null)} />}

        <Text style={styles.sectionLabel}>¿QUÉ PASÓ?</Text>
        <View style={{ gap: 9 }}>
          {CATEGORIAS_TICKET.map((c) => (
            <CategoryCard
              key={c.value}
              label={c.label}
              sub={c.sub}
              Icon={CATEGORY_ICONS[c.value]}
              active={category === c.value}
              onPress={() => setCategory(c.value)}
            />
          ))}
        </View>

        {category === 'comportamiento_jugador' ? (
          <View style={{ marginTop: 11 }}>
            <NoticeCard tone="info" icon={UserX}>
              Si es sobre un jugador puntual, puedes reportar su cuenta directamente desde su
              perfil ("Reportar esta cuenta") para que quede asociado a esa cuenta. Aquí puedes
              contarnos el contexto general — incluye su @usuario en la descripción si ayuda.
            </NoticeCard>
          </View>
        ) : null}

        <Text style={styles.sectionLabel}>DETALLE</Text>
        <Card>
          <Text style={styles.fieldLabel}>Asunto</Text>
          <TextInput
            style={styles.input}
            placeholder="Ej: Error al cargar el mapa"
            placeholderTextColor={C.textMuted}
            value={title}
            onChangeText={setTitle}
          />

          <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Descripción</Text>
          <TextInput
            style={styles.textarea}
            placeholder="Cuéntanos qué pasó, en qué pantalla y qué esperabas que ocurriera…"
            placeholderTextColor={C.textMuted}
            value={description}
            onChangeText={(v) => setDescription(v.slice(0, DESC_MAX))}
            multiline
            numberOfLines={4}
            maxLength={DESC_MAX}
            textAlignVertical="top"
          />
          <Text style={styles.charCount}>{description.length}/{DESC_MAX}</Text>

          <View style={styles.divider} />

          <View style={styles.rowBetween}>
            <Text style={styles.blockTitle}>Captura de pantalla</Text>
            <Text style={styles.optionalTag}>Opcional</Text>
          </View>

          {screenshot ? (
            <View style={styles.screenshotWrap}>
              <Image source={{ uri: screenshot.uri }} style={styles.screenshotImg} resizeMode="cover" />
              <Pressable
                onPress={() => setScreenshot(null)}
                style={styles.screenshotRemove}
                accessibilityRole="button"
                accessibilityLabel="Quitar captura de pantalla"
              >
                <XIcon color="#D2D8D3" size={12} strokeWidth={2.6} />
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={handlePickScreenshot}
              accessibilityRole="button"
              accessibilityLabel="Adjuntar captura de pantalla"
              style={({ pressed }) => [styles.attachTile, pressed && { opacity: 0.8 }]}
            >
              <Plus color={C.green} size={19} strokeWidth={2} />
              <Text style={styles.attachLabel}>Adjuntar</Text>
            </Pressable>
          )}
        </Card>

        <View style={{ marginTop: 14 }}>
          <NoticeCard tone="info" icon={Info}>
            Adjuntamos datos técnicos: tu cuenta, la versión de la app y el dispositivo viajan
            con el reporte para que no tengas que explicarlo.
          </NoticeCard>
        </View>
      </ScrollView>

      <StickyFooter>
        <View style={{ gap: 10 }}>
          <Button label="Enviar reporte" onPress={handleSubmit} />
          <Text style={styles.footerNote}>Tu reporte solo lo ve el equipo de soporte.</Text>
        </View>
      </StickyFooter>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  headerTitle: { fontFamily: F.extraBold, color: C.textPrimary, fontSize: 19, letterSpacing: -0.3 },
  headerSubtitle: { fontFamily: F.medium, color: C.textSecondary, fontSize: 12, marginTop: 2 },

  scroll: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 130, gap: 4 },
  sectionLabel: { fontFamily: F.bold, fontSize: 11, letterSpacing: 1.5, color: C.textSecondary, marginTop: 20, marginBottom: 11 },

  catCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13,
    borderRadius: R.card, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  catCardActive: { backgroundColor: C.selectedBg, borderColor: C.green },
  catIcon: {
    width: 34, height: 34, borderRadius: 11, flexShrink: 0,
    backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  catIconActive: { backgroundColor: C.shieldBg, borderColor: C.greenDeepBorder },
  catLabel: { fontFamily: F.extraBold, color: C.textPrimary, fontSize: 13.5 },
  catSub: { fontFamily: F.medium, color: C.textSecondary, fontSize: 11.5, lineHeight: 16, marginTop: 3 },
  catDot: {
    width: 18, height: 18, borderRadius: 999, flexShrink: 0,
    borderWidth: 2, borderColor: '#3A4139', alignItems: 'center', justifyContent: 'center',
  },
  catDotActive: { borderColor: C.green, backgroundColor: C.green },
  catDotInner: { width: 8, height: 8, borderRadius: 999, backgroundColor: C.selectedBg },

  fieldLabel: { fontFamily: F.bold, color: C.textSecondary, fontSize: 12 },
  input: {
    height: 48, marginTop: 9, paddingHorizontal: 14, borderRadius: R.iconBtn,
    backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border,
    color: C.textPrimary, fontFamily: F.semiBold, fontSize: 14,
  },
  textarea: {
    height: 116, marginTop: 9, padding: 13, borderRadius: R.row,
    backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border,
    color: C.textPrimary, fontFamily: F.medium, fontSize: 13.5, lineHeight: 20,
  },
  charCount: { fontFamily: F.semiBold, color: C.textMuted, fontSize: 11, textAlign: 'right', marginTop: 7 },

  divider: { height: 1, backgroundColor: C.dividerInner, marginVertical: 16 },
  rowBetween: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  blockTitle: { fontFamily: F.bold, color: C.textPrimary, fontSize: 13 },
  optionalTag: { fontFamily: F.semiBold, color: C.textMuted, fontSize: 11.5 },

  screenshotWrap: { width: 112, height: 84, borderRadius: 16, overflow: 'hidden', marginTop: 11, position: 'relative' },
  screenshotImg: { width: '100%', height: '100%' },
  screenshotRemove: {
    position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 999,
    backgroundColor: 'rgba(8,10,8,0.85)', borderWidth: 1, borderColor: '#3A4139',
    alignItems: 'center', justifyContent: 'center',
  },
  attachTile: {
    width: 112, height: 84, borderRadius: 16, marginTop: 11,
    borderWidth: 1, borderStyle: 'dashed', borderColor: '#3A4139',
    alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  attachLabel: { fontFamily: F.bold, color: C.green, fontSize: 11.5 },

  footerNote: { fontFamily: F.medium, color: C.textMuted, fontSize: 11, textAlign: 'center' },

  centerScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30, gap: 4 },
  centerTitle: { fontFamily: F.extraBold, color: C.textPrimary, fontSize: 22, letterSpacing: -0.3, textAlign: 'center', marginTop: 22 },
  centerSub: { fontFamily: F.medium, color: C.textSecondary, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 10, maxWidth: 280 },

  stepsCard: { width: '100%', paddingVertical: 4, marginTop: 22 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 12 },
  stepRowDivider: { borderBottomWidth: 1, borderBottomColor: C.dividerInner },
  stepDot: {
    width: 22, height: 22, borderRadius: 999, flexShrink: 0,
    borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center',
  },
  stepDotDone: { backgroundColor: C.shieldBg, borderColor: C.greenDeepBorder },
  stepLabel: { fontFamily: F.semiBold, color: C.textPrimary, fontSize: 12.5 },

  okIcon: {
    width: 78, height: 78, borderRadius: 999, backgroundColor: C.shieldBg, borderWidth: 1, borderColor: C.greenDeepBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  folioChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8, height: 36, paddingHorizontal: 14, marginTop: 18,
    borderRadius: 999, backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border,
  },
  folioText: { fontFamily: F.bold, color: C.textSecondary, fontSize: 12 },

  footerBtns: { gap: 10, paddingHorizontal: 20, paddingBottom: 20 },
});
