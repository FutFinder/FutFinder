import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Navigation,
  Search,
  CheckCircle2,
  ShieldCheck,
} from 'lucide-react-native';

import Logo from '../components/Logo';
import Button from '../components/Button';
import { reservas as C, reservasRadius as R, reservasFonts as F } from '../theme/colors';
import { getCurrentLocation } from '../services/location';
import { saveMyLocation } from '../services/profile';
import { APP_VERSION } from '../utils/appVersion';

const REASONS = [
  {
    icon: Search,
    title: 'Encontrar partidos cercanos',
    description:
      'Te mostramos canchas y partidos disponibles a tu alrededor en tiempo real.',
  },
  {
    icon: CheckCircle2,
    title: 'Confirmar asistencia real',
    description:
      'Verificaremos que llegaste al partido para mejorar tu reputación.',
  },
  {
    icon: ShieldCheck,
    title: 'Seguridad de la comunidad',
    description:
      'Protegemos a todos los jugadores validando ubicaciones reales.',
  },
];

export default function LocationPermissionScreen({ navigation }) {
  const handleAllow = async () => {
    // Pide GPS, lo lee y lo guarda en el perfil para no volver a pedirlo.
    // Si el usuario rechaza, igual avanzamos a Terms.
    try {
      const r = await getCurrentLocation();
      if (r?.ok) {
        await saveMyLocation({ latitud: r.latitude, longitud: r.longitude });
      }
    } catch (e) {
      // Silencioso
    }
    navigation.navigate('Terms');
  };

  const handleSkip = () => {
    navigation.navigate('Terms');
  };

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <Pressable
              onPress={() => navigation.goBack()}
              hitSlop={12}
              style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
            >
              <ArrowLeft color={C.textPrimary} size={22} />
            </Pressable>
            <View style={styles.logoCenter}>
              <Logo size={32} />
            </View>
            <View style={{ width: 40 }} />
          </View>

          {/* Card destacada con marco verde */}
          <View style={styles.card}>
            <View style={styles.titleRow}>
              <Navigation color={C.green} size={20} />
              <Text style={styles.title}>Permiso de ubicación</Text>
            </View>
            <Text style={styles.subtitle}>
              Para brindarte la mejor experiencia, necesitamos acceder a tu
              ubicación de forma permanente. Esto nos permite:
            </Text>

            <View style={{ height: 14 }} />

            {REASONS.map((r, idx) => (
              <View key={idx} style={styles.reasonRow}>
                <View style={styles.reasonIcon}>
                  <r.icon color={C.green} size={18} strokeWidth={2.2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.reasonTitle}>{r.title}</Text>
                  <Text style={styles.reasonDesc}>{r.description}</Text>
                </View>
              </View>
            ))}

            <View style={{ height: 18 }} />

            <Button
              label="Permitir ubicación"
              variant="primary"
              onPress={handleAllow}
            />
            <View style={{ height: 12 }} />
            <Pressable
              onPress={handleSkip}
              style={({ pressed }) => [
                styles.skipBtn,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={styles.skipText}>Ahora no, decidir después</Text>
            </Pressable>
          </View>

          <Text style={styles.footer}>FUTFINDER{APP_VERSION ? ` v${APP_VERSION}` : ''} · © 2026</Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { paddingHorizontal: 20, paddingBottom: 40, flexGrow: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoCenter: { flex: 1, alignItems: 'center' },
  card: {
    marginTop: 12,
    backgroundColor: C.surfaceAlt,
    borderRadius: R.hero,
    padding: 22,
    borderWidth: 1.5,
    borderColor: C.green,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  title: {
    color: C.textPrimary,
    fontSize: 20,
    fontFamily: F.extraBold,
    letterSpacing: -0.3,
  },
  subtitle: {
    color: C.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  reasonRow: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 10,
  },
  reasonIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.greenSoft,
    borderWidth: 1,
    borderColor: C.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reasonTitle: {
    color: C.textPrimary,
    fontSize: 14,
    fontFamily: F.bold,
    marginBottom: 2,
  },
  reasonDesc: {
    color: C.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  skipBtn: {
    height: 50,
    borderRadius: R.cardSm,
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipText: {
    color: C.textPrimary,
    fontSize: 14,
    fontFamily: F.semiBold,
  },
  footer: {
    textAlign: 'center',
    color: C.textMuted,
    fontSize: 11,
    marginTop: 24,
    letterSpacing: 0.5,
  },
});
