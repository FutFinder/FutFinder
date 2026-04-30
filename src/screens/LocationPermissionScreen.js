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
import { colors, radius } from '../theme/colors';

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
  const handleAllow = () => {
    // En la fase 2 aquí pediremos permiso real con expo-location.
    // Por ahora solo avanzamos en el flujo.
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
              <ArrowLeft color={colors.textPrimary} size={22} />
            </Pressable>
            <View style={styles.logoCenter}>
              <Logo size={32} />
            </View>
            <View style={{ width: 40 }} />
          </View>

          {/* Card destacada con marco verde */}
          <View style={styles.card}>
            <View style={styles.titleRow}>
              <Navigation color={colors.primary} size={20} />
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
                  <r.icon color={colors.primary} size={18} strokeWidth={2.2} />
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

          <Text style={styles.footer}>FUTFINDER v1.2.0 · © 2026</Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
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
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoCenter: { flex: 1, alignItems: 'center' },
  card: {
    marginTop: 12,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.xl,
    padding: 22,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  subtitle: {
    color: colors.textSecondary,
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
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reasonTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  reasonDesc: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  skipBtn: {
    height: 50,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  footer: {
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 24,
    letterSpacing: 0.5,
  },
});
