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
import { paleta as C, radios as R, fuentes as F } from '../theme/colors';
import { APP_VERSION } from '../utils/appVersion';

export default function SuccessScreen({ navigation }) {
  const goHome = () => navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
  const goProfile = () =>
    navigation.reset({
      index: 1,
      routes: [{ name: 'Main' }, { name: 'EditProfile' }],
    });

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
              <CheckCircle2 color={C.green} size={48} strokeWidth={2.2} />
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

          <Text style={styles.footer}>FUTFINDER{APP_VERSION ? ` v${APP_VERSION}` : ''} · © 2026</Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
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
    backgroundColor: C.surfaceAlt,
    borderRadius: R.hero,
    padding: 28,
    borderWidth: 1.5,
    borderColor: C.green,
    alignItems: 'center',
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: C.greenSoft,
    borderWidth: 1.5,
    borderColor: C.green,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  title: {
    color: C.textPrimary,
    fontSize: 26,
    fontFamily: F.extraBold,
    letterSpacing: -0.5,
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    color: C.textSecondary,
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
    borderRadius: R.cardSm,
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineLabel: {
    color: C.textPrimary,
    fontSize: 16,
    fontFamily: F.bold,
  },
  footer: {
    textAlign: 'center',
    color: C.textMuted,
    fontSize: 11,
    marginTop: 28,
    letterSpacing: 0.5,
  },
});
