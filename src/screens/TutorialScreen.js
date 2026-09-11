import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Animated, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check } from 'lucide-react-native';

import FutfinderMark from '../components/FutfinderMark';
import { Button } from '../components/reservas/ui';
import { reservas as C, reservasFonts as F } from '../theme/colors';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

/**
 * Carrusel de 5 pasos entre la Portada y Crear cuenta / Iniciar sesión
 * (handoff `FutFinder Inicio.dc.html`). El propio handoff deja anotado que
 * arrastrar los pasos queda para después («sigue con: que el tutorial se
 * pueda arrastrar»): por eso acá se navega solo con los botones y los
 * puntos, sin gesto de swipe, igual que el prototipo.
 */

function StepLabel({ children }) {
  return <Text style={styles.stepLabel}>{children}</Text>;
}

function Step1Partidos() {
  return (
    <View style={styles.previewCard}>
      <View style={styles.matchCard}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <View style={{ gap: 3 }}>
            <Text style={styles.matchTitle}>Fútbol 7 · Ñuñoa</Text>
            <Text style={styles.matchMeta}>Hoy 20:30 · Cancha La Reina</Text>
          </View>
          <Text style={styles.matchPrice}>$4.500</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 7, marginTop: 13 }}>
          <View style={styles.pillNeutral}><Text style={styles.pillNeutralText}>Nivel B</Text></View>
          <View style={styles.pillNeutral}><Text style={styles.pillNeutralText}>2,4 km</Text></View>
          <View style={styles.pillGreen}><Text style={styles.pillGreenText}>2 cupos</Text></View>
        </View>
        <View style={[styles.previewCta, { marginTop: 13 }]}><Text style={styles.previewCtaText}>Inscribirme</Text></View>
      </View>
    </View>
  );
}

function Step2Crear() {
  return (
    <View style={styles.previewCard}>
      <View style={styles.matchCard}>
        <StepLabel>Modalidad</StepLabel>
        <View style={{ flexDirection: 'row', gap: 7, marginTop: 12 }}>
          <View style={[styles.modeChip, styles.modeChipOff]}><Text style={styles.pillNeutralText}>Fútbol 5</Text></View>
          <View style={[styles.modeChip, styles.modeChipOn]}><Text style={styles.pillGreenText}>Fútbol 7</Text></View>
          <View style={[styles.modeChip, styles.modeChipOff]}><Text style={styles.pillNeutralText}>Fútbol 11</Text></View>
        </View>
        <View style={{ marginTop: 14, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <Text style={styles.progressLabel}>10 / 14 inscritos</Text>
            <Text style={styles.progressHint}>4 cupos</Text>
          </View>
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: '71%' }]} /></View>
        </View>
        <View style={[styles.previewCtaSoft, { marginTop: 13 }]}><Text style={styles.previewCtaSoftText}>Invitar jugadores cerca</Text></View>
      </View>
    </View>
  );
}

function AsistenciaRow({ letter, handle, estado, tono }) {
  const paleta = {
    ok: { bg: 'rgba(90,224,106,.09)', border: C.greenDeepBorder, avatarBg: C.shieldBg, avatarBorder: C.greenDeepBorder, text: C.green },
    pendiente: { bg: 'rgba(255,255,255,.03)', border: C.border, avatarBg: C.surfaceAlt, avatarBorder: C.border, text: C.textSecondary },
    no: { bg: 'rgba(237,107,118,.08)', border: 'rgba(237,107,118,.32)', avatarBg: '#241618', avatarBorder: 'rgba(237,107,118,.22)', text: C.red },
  }[tono];
  return (
    <View style={[styles.asistRow, { backgroundColor: paleta.bg, borderColor: paleta.border }]}>
      <View style={[styles.asistAvatar, { backgroundColor: paleta.avatarBg, borderColor: paleta.avatarBorder }]}>
        <Text style={[styles.asistAvatarText, { color: paleta.text }]}>{letter}</Text>
      </View>
      <Text style={styles.asistHandle}>{handle}</Text>
      <Text style={[styles.asistEstado, { color: paleta.text }]}>{estado}</Text>
    </View>
  );
}

function Step3Asistencia() {
  return (
    <View style={styles.previewCard}>
      <View style={[styles.matchCard, { gap: 9 }]}>
        <StepLabel>¿Quién llegó?</StepLabel>
        <AsistenciaRow letter="C" handle="@camilo_9" estado="Asistió" tono="ok" />
        <AsistenciaRow letter="R" handle="@rodrigo.f" estado="Confirmar" tono="pendiente" />
        <AsistenciaRow letter="J" handle="@johansedini0" estado="No llegó" tono="no" />
      </View>
    </View>
  );
}

function Step4Reputacion() {
  return (
    <View style={styles.previewCard}>
      <View style={styles.matchCard}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
          <View style={styles.trustAvatar}><Text style={styles.trustAvatarText}>V</Text></View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.trustName}>@vicente22</Text>
            <Text style={styles.matchMeta}>Lateral · Ñuñoa</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.trustScore}>92</Text>
            <Text style={styles.trustCaption}>TRUST</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 7, marginTop: 13 }}>
          <View style={styles.statTile}><Text style={styles.statNumber}>31</Text><Text style={styles.statCaption}>JUGADOS</Text></View>
          <View style={styles.statTile}><Text style={styles.statNumber}>4</Text><Text style={styles.statCaption}>MVPs</Text></View>
          <View style={styles.statTile}><Text style={[styles.statNumber, { color: C.green }]}>97%</Text><Text style={styles.statCaption}>ASISTE</Text></View>
        </View>
        <View style={[styles.progressTrack, { marginTop: 13 }]}><View style={[styles.progressFill, { width: '92%' }]} /></View>
      </View>
    </View>
  );
}

function Step5Club() {
  return (
    <View style={[styles.previewCard, { gap: 10 }]}>
      <View style={styles.matchCard}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={styles.clubIcon}><Check color={C.green} size={20} strokeWidth={2.2} /></View>
          <View style={{ gap: 2 }}>
            <Text style={styles.trustName}>Club Prueba</Text>
            <Text style={styles.matchMeta}>Santiago Centro · 12 miembros</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 12 }}>
          <View style={[styles.recordTile, { backgroundColor: 'rgba(90,224,106,.09)', borderColor: 'rgba(90,224,106,.28)' }]}>
            <Text style={[styles.recordNumber, { color: C.green }]}>8</Text><Text style={styles.recordCaption}>V</Text>
          </View>
          <View style={styles.recordTile}><Text style={styles.recordNumber}>3</Text><Text style={styles.recordCaption}>E</Text></View>
          <View style={[styles.recordTile, { backgroundColor: 'rgba(237,107,118,.08)', borderColor: 'rgba(237,107,118,.28)' }]}>
            <Text style={[styles.recordNumber, { color: C.red }]}>2</Text><Text style={styles.recordCaption}>D</Text>
          </View>
          <View style={styles.recordTile}><Text style={styles.recordNumber}>4.6</Text><Text style={styles.recordCaption}>RAT</Text></View>
        </View>
      </View>
      <View style={[styles.matchCard, { flexDirection: 'row', alignItems: 'center', gap: 11 }]}>
        <View style={styles.rivalIcon}><Check color="rgba(255,255,255,0.55)" size={16} strokeWidth={2.2} /></View>
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={styles.rivalName}>Deportivo Ñuñoa</Text>
          <Text style={styles.rivalMeta}>2,4 km · Nivel B</Text>
        </View>
        <View style={styles.pillGreen}><Text style={styles.pillGreenText}>Desafiar</Text></View>
      </View>
    </View>
  );
}

const STEPS = [
  { Preview: Step1Partidos, label: '01 · Partidos', title: 'Encuentra un partido cerca de ti', subtitle: 'Filtra por comuna, nivel y precio. Te inscribes y quedas confirmado al instante.' },
  { Preview: Step2Crear, label: '02 · Crear', title: 'O crea el tuyo y completa los cupos', subtitle: 'Publicas hora, cancha y modalidad. Avisamos a jugadores cerca hasta llenar el equipo.' },
  { Preview: Step3Asistencia, label: '03 · Asistencia', title: 'Confirma quién realmente llega', subtitle: 'Al terminar el partido cada jugador valida la asistencia. Quien no aparece queda registrado.' },
  { Preview: Step4Reputacion, label: '04 · Reputación', title: 'Tu Trust te abre mejores partidos', subtitle: 'Jugar y llegar sube tu reputación. Los organizadores la ven antes de aceptarte.' },
  { Preview: Step5Club, label: '05 · Club y personas', title: 'Arma tu club y desafía rivales', subtitle: 'Crea o únete a un club, agrega amigos y manda desafíos a otros equipos de tu comuna.' },
];

export default function TutorialScreen({ navigation }) {
  const [step, setStep] = useState(0);
  const translateX = useRef(new Animated.Value(0)).current;

  const goStep = (next) => {
    setStep(next);
    Animated.timing(translateX, {
      toValue: -next * SCREEN_WIDTH,
      duration: 320,
      useNativeDriver: true,
    }).start();
  };

  const last = step === STEPS.length - 1;

  const handleNext = () => {
    if (last) navigation.navigate('Register');
    else goStep(step + 1);
  };
  const handleBack = () => {
    if (last) navigation.navigate('Login');
    else if (step === 0) navigation.goBack();
    else goStep(step - 1);
  };
  const skip = () => navigation.navigate('Login');

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <FutfinderMark size={20} color={C.green} />
            <Text style={styles.brandText}>fut<Text style={{ color: C.green }}>finder</Text></Text>
          </View>
          <Pressable onPress={skip} hitSlop={8}>
            <Text style={styles.skipText}>Saltar</Text>
          </Pressable>
        </View>

        <View style={{ flex: 1, overflow: 'hidden' }}>
          <Animated.View style={[styles.track, { transform: [{ translateX }] }]}>
            {STEPS.map(({ Preview, label, title, subtitle }, i) => (
              <View key={i} style={[styles.slide, { width: SCREEN_WIDTH }]}>
                <Preview />
                <View style={styles.slideText}>
                  <StepLabel>{label}</StepLabel>
                  <Text style={styles.slideTitle}>{title}</Text>
                  <Text style={styles.slideSubtitle}>{subtitle}</Text>
                </View>
              </View>
            ))}
          </Animated.View>
        </View>

        <View style={styles.footer}>
          <View style={styles.dotsRow}>
            {STEPS.map((_, i) => (
              <Pressable key={i} onPress={() => goStep(i)} hitSlop={8}>
                <View
                  style={[
                    styles.dot,
                    i === step ? styles.dotActive : styles.dotInactive,
                  ]}
                />
              </Pressable>
            ))}
          </View>
          <Button label={last ? 'Comenzar ahora' : 'Siguiente'} onPress={handleNext} />
          <View style={{ height: 10 }} />
          <Button label={last ? 'Ya tengo cuenta' : 'Atrás'} variant="secondary" onPress={handleBack} />
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  header: {
    height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandText: { fontFamily: F.extraBold, fontSize: 17, color: C.textPrimary, letterSpacing: -0.4 },
  skipText: { fontFamily: F.semiBold, fontSize: 14, color: C.textSecondary },

  track: { flex: 1, flexDirection: 'row' },
  slide: { paddingHorizontal: 20, gap: 24 },

  previewCard: {
    height: 240, borderRadius: 24, backgroundColor: C.headerGlowFrom,
    alignItems: 'center', justifyContent: 'center', padding: 18,
    borderWidth: 1, borderColor: C.border,
  },
  matchCard: {
    width: '100%', backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    borderRadius: 18, padding: 14,
  },
  matchTitle: { fontFamily: F.bold, fontSize: 14.5, color: C.textPrimary, letterSpacing: -0.1 },
  matchMeta: { fontFamily: F.medium, fontSize: 12, color: C.textSecondary },
  matchPrice: { fontFamily: F.bold, fontSize: 13.5, color: C.green },

  pillNeutral: { backgroundColor: C.surfaceAlt, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 6 },
  pillNeutralText: { fontFamily: F.semiBold, fontSize: 11.5, color: C.textSecondary },
  pillGreen: {
    backgroundColor: 'rgba(90,224,106,.12)', borderWidth: 1, borderColor: C.greenDeepBorder,
    borderRadius: 9, paddingHorizontal: 10, paddingVertical: 5,
  },
  pillGreenText: { fontFamily: F.bold, fontSize: 11.5, color: C.green },

  previewCta: {
    height: 44, borderRadius: 14, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center',
  },
  previewCtaText: { fontFamily: F.bold, fontSize: 14.5, color: C.textOnGreen },
  previewCtaSoft: {
    height: 44, borderRadius: 14, backgroundColor: 'rgba(90,224,106,.12)', borderWidth: 1,
    borderColor: C.greenDeepBorder, alignItems: 'center', justifyContent: 'center',
  },
  previewCtaSoftText: { fontFamily: F.bold, fontSize: 14.5, color: C.green },

  modeChip: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 11 },
  modeChipOff: { backgroundColor: C.surfaceAlt },
  modeChipOn: { backgroundColor: 'rgba(90,224,106,.12)', borderWidth: 1, borderColor: C.greenDeepBorder },

  progressLabel: { fontFamily: F.bold, fontSize: 14, color: C.textPrimary },
  progressHint: { fontFamily: F.semiBold, fontSize: 12, color: C.textSecondary },
  progressTrack: { height: 7, borderRadius: 99, backgroundColor: C.surfaceAlt, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: C.green },

  asistRow: { flexDirection: 'row', alignItems: 'center', gap: 11, borderWidth: 1, borderRadius: 14, padding: 10 },
  asistAvatar: { width: 32, height: 32, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  asistAvatarText: { fontFamily: F.bold, fontSize: 13 },
  asistHandle: { flex: 1, fontFamily: F.bold, fontSize: 13.5, color: C.textPrimary },
  asistEstado: { fontFamily: F.bold, fontSize: 12 },

  trustAvatar: {
    width: 52, height: 52, borderRadius: 17, backgroundColor: C.shieldBg, borderWidth: 1,
    borderColor: C.greenDeepBorder, alignItems: 'center', justifyContent: 'center',
  },
  trustAvatarText: { fontFamily: F.extraBold, fontSize: 19, color: C.green },
  trustName: { fontFamily: F.extraBold, fontSize: 16, color: C.textPrimary, letterSpacing: -0.2 },
  trustScore: { fontFamily: F.extraBold, fontSize: 22, color: C.green, letterSpacing: -0.3 },
  trustCaption: { fontFamily: F.bold, fontSize: 9.5, letterSpacing: 1, color: C.textMuted, marginTop: 2 },

  statTile: {
    flex: 1, backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border,
    borderRadius: 13, paddingVertical: 9, alignItems: 'center',
  },
  statNumber: { fontFamily: F.extraBold, fontSize: 16, color: C.textPrimary },
  statCaption: { fontFamily: F.bold, fontSize: 9, letterSpacing: 0.8, color: C.textMuted, marginTop: 4 },

  clubIcon: {
    width: 44, height: 44, borderRadius: 15, backgroundColor: C.shieldBg,
    borderWidth: 1, borderColor: C.greenDeepBorder, alignItems: 'center', justifyContent: 'center',
  },
  recordTile: {
    flex: 1, backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border,
    borderRadius: 12, paddingVertical: 8, alignItems: 'center',
  },
  recordNumber: { fontFamily: F.extraBold, fontSize: 15, color: C.textPrimary },
  recordCaption: { fontFamily: F.bold, fontSize: 9, color: C.textMuted, marginTop: 3 },

  rivalIcon: {
    width: 34, height: 34, borderRadius: 12, backgroundColor: C.surfaceAlt,
    borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center',
  },
  rivalName: { fontFamily: F.bold, fontSize: 13.5, color: C.textPrimary },
  rivalMeta: { fontFamily: F.medium, fontSize: 11.5, color: C.textSecondary },

  slideText: { gap: 9 },
  stepLabel: { fontFamily: F.bold, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: C.green },
  slideTitle: { fontFamily: F.extraBold, fontSize: 25, lineHeight: 30, color: C.textPrimary, letterSpacing: -0.5 },
  slideSubtitle: { fontFamily: F.medium, fontSize: 14, lineHeight: 20, color: C.textSecondary },

  footer: { paddingHorizontal: 20, paddingBottom: 20, paddingTop: 4, gap: 14 },
  dotsRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7 },
  dot: { height: 6, borderRadius: 99 },
  dotActive: { width: 22, backgroundColor: C.green },
  dotInactive: { width: 6, backgroundColor: 'rgba(255,255,255,0.18)' },
});
