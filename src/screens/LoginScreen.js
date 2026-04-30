import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';

import Logo from '../components/Logo';
import Button from '../components/Button';
import { colors, radius } from '../theme/colors';

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = () => {
    // Placeholder: cuando integremos Supabase, aquí va la llamada real
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      navigation.replace('Home');
    }, 600);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.root}
    >
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header con back + logo */}
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

          {/* Card de login */}
          <View style={styles.card}>
            <Text style={styles.title}>Iniciar sesión o registrarse</Text>
            <Text style={styles.subtitle}>
              Accede a partidos cerca de ti en minutos
            </Text>

            <Text style={styles.label}>Correo electrónico</Text>
            <TextInput
              style={styles.input}
              placeholder="tu@email.com"
              placeholderTextColor={colors.textMuted}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />

            <Text style={[styles.label, { marginTop: 16 }]}>Contraseña</Text>
            <TextInput
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor={colors.textMuted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password"
            />

            <View style={{ height: 20 }} />

            <Button
              label="Iniciar sesión"
              variant="primary"
              loading={loading}
              onPress={handleLogin}
            />

            <View style={styles.linksRow}>
              <Pressable hitSlop={8}>
                <Text style={styles.linkSmall}>¿Olvidaste tu contraseña?</Text>
              </Pressable>
              <Text style={styles.linkSmallMuted}>
                ¿No tienes cuenta?{' '}
                <Text style={styles.linkSmall}>Regístrate</Text>
              </Text>
            </View>

            {/* Divider */}
            <View style={styles.dividerRow}>
              <View style={styles.divider} />
              <Text style={styles.dividerText}>o continúa con</Text>
              <View style={styles.divider} />
            </View>

            {/* Social */}
            <View style={styles.socialRow}>
              <Pressable
                style={({ pressed }) => [styles.socialBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.socialLabel}>Google</Text>
              </Pressable>
              <View style={{ width: 12 }} />
              <Pressable
                style={({ pressed }) => [styles.socialBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.socialLabel}>Apple</Text>
              </Pressable>
            </View>
          </View>

          <Text style={styles.footer}>FUTFINDER v1.2.0 · © 2026</Text>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    flexGrow: 1,
  },
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
  logoCenter: {
    flex: 1,
    alignItems: 'center',
  },
  card: {
    marginTop: 12,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.xl,
    padding: 22,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 4,
    marginBottom: 22,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 13,
    marginBottom: 6,
    fontWeight: '500',
  },
  input: {
    height: 50,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    color: colors.textPrimary,
    fontSize: 15,
  },
  linksRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
    marginBottom: 8,
  },
  linkSmall: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  linkSmallMuted: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 18,
  },
  divider: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    color: colors.textSecondary,
    fontSize: 12,
    marginHorizontal: 12,
  },
  socialRow: {
    flexDirection: 'row',
  },
  socialBtn: {
    flex: 1,
    height: 50,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialLabel: {
    color: colors.textPrimary,
    fontWeight: '700',
    fontSize: 14,
  },
  footer: {
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 24,
    letterSpacing: 0.5,
  },
});
