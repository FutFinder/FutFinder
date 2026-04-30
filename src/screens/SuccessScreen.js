import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CheckCircle2 } from 'lucide-react-native';

import Logo from '../components/Logo';
import Button from '../components/Button';
import { colors, radius } from '../theme/colors';

export default function SuccessScreen({ navigation }) {
  const goHome = () => navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  const goProfile = () =>
    // Placeholder: cuando exista la pantalla Perfil, cambiamos esto.
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* Header con logo centrado */}
          <View style={styles.headerCentered}>
            <Logo size={32} />
          </View>

          {/* Card */}
          <View style={styles.card}>
            <View style={styles.iconCircle}>
              <CheckCircle2 color={colors.primary} size={48} strokeWidth={2.2} />
            </View>

            <Text style={styles.title}>¡Todo listo!</Text>
            <Text style={styles.subtitle}>
              Tu cuenta ha sido verificada y configurada correctamente.{'\n'}
              Ya puedes explorar partidos cerca de ti.
            </Text>

            <View style={styles.btnRow}>
              <View style={{ flex: 1 }}>
                <Button label="Ir al inicio" variant="primary" onPress={goHome} />
              </View>
              <View style={{ width: 12 }} />
              <Pressable
                onPress={goProfile}
                style={({ pressed }) => [
                  styles.outlineBtn,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={styles.outlineLabel}>Mi perfil</Text>
              </Pressable>
            </View>
          </View>

          <Text style={styles.footer}>FUTFINDER v1.2.0 · © 2026</Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scroll: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    flexGrow: 1,
    justifyContent: 'flex-start',
  },
  headerCentered: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  card: {
    marginTop: 24,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.xl,
    padding: 28,
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: 'center',
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.primarySoft,
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 26,
  },
  btnRow: {
    flexDirection: 'row',
    width: '100%',
  },
  outlineBtn: {
    flex: 1,
    height: 54,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineLabel: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  footer: {
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 28,
    letterSpacing: 0.5,
  },
});
