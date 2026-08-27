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
import { ArrowLeft, AlertCircle } from 'lucide-react-native';

import Logo from '../components/Logo';
import Button from '../components/Button';
import { colors, radius } from '../theme/colors';
import { loginWithEmail, registerWithEmail } from '../services/auth';
import {
  validateCredentials,
  decideAuthDestination,
  MENSAJES,
  MIN_PASSWORD_SIGNUP,
} from '../services/authPolicy';
import { getOnboardingState } from '../services/profile';
import { isSupabaseConfigured } from '../services/supabase';
import { useAuth } from '../contexts/AuthContext';
import { APP_VERSION } from '../utils/appVersion';

/**
 * Iniciar sesión y registrarse son dos acciones distintas en la misma
 * pantalla, elegidas con el enlace de abajo (`mode`). Antes eran una sola:
 * un login que fallaba caía a `signUp`, y como Supabase autoconfirma cuando
 * la confirmación de correo está desactivada, cualquier correo inventado
 * entraba a la app creando una cuenta real de paso. Ahora el login solo
 * inicia sesión, y solo se navega a una ruta privada si Supabase devolvió
 * una sesión usable.
 */
export default function LoginScreen({ navigation }) {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const { consumePendingDestination } = useAuth();

  const isSignUp = mode === 'signup';

  const toggleMode = () => {
    setMode(isSignUp ? 'login' : 'signup');
    setErrorMsg(null);
  };

  const handleSubmit = async () => {
    setErrorMsg(null);

    // Los campos vacíos o mal escritos no se envían al proveedor.
    const check = validateCredentials({ email, password, mode });
    if (!check.valid) {
      setErrorMsg(check.message);
      return;
    }

    setLoading(true);
    const result = isSignUp
      ? await registerWithEmail({ email, password })
      : await loginWithEmail({ email, password });
    setLoading(false);

    if (result.error) {
      setErrorMsg(result.error.message || MENSAJES.inesperado);
      return;
    }

    // Cuenta creada o sin confirmar todavía → código de verificación.
    if (result.needsVerification) {
      navigation.navigate('Verification', { email: result.email });
      return;
    }

    const done = await getOnboardingState();
    const destino = decideAuthDestination({ session: result.session, onboardingDone: done });

    if (destino === 'verify-email') {
      navigation.navigate('Verification', { email: result.email });
      return;
    }

    // Sin sesión usable no se entra, pase lo que pase.
    if (destino === 'login') {
      setErrorMsg(MENSAJES.credencialesInvalidas);
      return;
    }

    if (destino === 'onboarding') {
      navigation.navigate('LocationPermission');
      return;
    }

    // Si el guard nos mandó acá desde una ruta privada, volvemos a ella
    // en vez de caer siempre en el Home.
    const pending = consumePendingDestination();
    if (pending && pending.name && pending.name !== 'Main') {
      navigation.reset({
        index: 1,
        routes: [{ name: 'Main' }, { name: pending.name, params: pending.params }],
      });
    } else {
      navigation.reset({ index: 0, routes: [{ name: 'Main', params: pending?.params }] });
    }
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

          <View style={styles.card}>
            <Text style={styles.title}>
              {isSignUp ? 'Crear tu cuenta' : 'Iniciar sesión'}
            </Text>
            <Text style={styles.subtitle}>
              {isSignUp
                ? 'Te enviaremos un código a tu correo para confirmarlo'
                : 'Accede a partidos cerca de ti en minutos'}
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
              autoComplete={isSignUp ? 'new-password' : 'password'}
            />

            {isSignUp && (
              <Text style={styles.hintPassword}>
                Usa al menos {MIN_PASSWORD_SIGNUP} caracteres.
              </Text>
            )}

            {errorMsg && (
              <View style={styles.errorBox}>
                <AlertCircle color={colors.error} size={16} />
                <Text style={styles.errorText}>{errorMsg}</Text>
              </View>
            )}

            <View style={{ height: 18 }} />

            <Button
              label={loading ? 'Conectando…' : isSignUp ? 'Crear cuenta' : 'Iniciar sesión'}
              variant="primary"
              loading={loading}
              onPress={handleSubmit}
            />

            <View style={styles.linksRow}>
              {!isSignUp && (
                <Pressable hitSlop={8}>
                  <Text style={styles.linkSmall}>¿Olvidaste tu contraseña?</Text>
                </Pressable>
              )}
              <Pressable hitSlop={8} onPress={toggleMode}>
                <Text style={styles.linkSmallMuted}>
                  {isSignUp ? '¿Ya tienes cuenta? ' : '¿No tienes cuenta? '}
                  <Text style={styles.linkSmall}>
                    {isSignUp ? 'Inicia sesión' : 'Regístrate'}
                  </Text>
                </Text>
              </Pressable>
            </View>

            <View style={styles.dividerRow}>
              <View style={styles.divider} />
              <Text style={styles.dividerText}>o continúa con</Text>
              <View style={styles.divider} />
            </View>

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

            {!isSupabaseConfigured && (
              <Text style={styles.demoBanner}>
                ⚠️ Faltan las variables de entorno de Supabase, así que no se
                puede iniciar sesión. Revisa el archivo .env.
              </Text>
            )}
          </View>

          <Text style={styles.footer}>FUTFINDER{APP_VERSION ? ` v${APP_VERSION}` : ''} · © 2026</Text>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
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
  hintPassword: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 6,
  },
  errorBox: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.errorSoft,
    borderRadius: radius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.error,
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
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
  socialRow: { flexDirection: 'row' },
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
  demoBanner: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 18,
    lineHeight: 16,
  },
  footer: {
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 24,
    letterSpacing: 0.5,
  },
});
