import React, { useEffect, useRef, useState } from 'react';
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
import { ArrowLeft, Eye, EyeOff, Check } from 'lucide-react-native';

import FutfinderMark from '../components/FutfinderMark';
import Banner from '../components/Banner';
import { Card, IconButton, Button } from '../components/reservas/ui';
import { reservas as C, reservasRadius as R, reservasFonts as F } from '../theme/colors';
import { loginWithEmail, requestPasswordResetForEmail, getCurrentProfile } from '../services/auth';
import { decideAuthDestination, isValidEmail, MENSAJES } from '../services/authPolicy';
import { getOnboardingState } from '../services/profile';
import { isSupabaseConfigured } from '../services/supabase';
import { useAuth } from '../contexts/AuthContext';
import { getRememberedAccount, saveRememberedAccount } from '../utils/rememberedAccount';

function inicialDe(texto) {
  const t = (texto || '').trim();
  return t ? t[0].toUpperCase() : '?';
}

/**
 * Iniciar sesión y registrarse son pantallas separadas (esta y `Register`).
 * Antes eran una sola: un login que fallaba caía a `signUp`, y como Supabase
 * autoconfirma cuando la confirmación de correo está desactivada, cualquier
 * correo inventado entraba a la app creando una cuenta real de paso. Ahora el
 * login solo inicia sesión, y solo se navega a una ruta privada si Supabase
 * devolvió una sesión usable.
 */
export default function LoginScreen({ navigation }) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [banner, setBanner] = useState(null);
  const [remembered, setRemembered] = useState(null);
  const { consumePendingDestination } = useAuth();
  const passwordRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const acc = await getRememberedAccount();
      if (!cancelled && acc) {
        setRemembered(acc);
        setIdentifier(acc.email);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const showBanner = (type, title, message = '') => setBanner({ type, title, message });

  const handleLogin = async () => {
    setBanner(null);

    const email = identifier.trim();
    if (!email.includes('@') || !password) {
      showBanner('error', 'Datos incompletos', 'Ingresa tu correo y tu contraseña.');
      return;
    }

    setLoading(true);
    const result = await loginWithEmail({ email, password });
    setLoading(false);

    if (result.error) {
      showBanner('error', 'No pudimos iniciar sesión', result.error.message || MENSAJES.inesperado);
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
      showBanner('error', 'No pudimos iniciar sesión', MENSAJES.credencialesInvalidas);
      return;
    }

    const profile = await getCurrentProfile();
    await saveRememberedAccount({ email, username: profile?.username || remembered?.username });

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

  const handleForgotPassword = async () => {
    const email = identifier.trim();
    if (!email) {
      showBanner('error', 'Falta tu correo', 'Escribe tu correo arriba para enviarte el enlace de recuperación.');
      return;
    }
    if (!isValidEmail(email)) {
      showBanner('error', 'Correo inválido', MENSAJES.correoInvalido);
      return;
    }
    setResetting(true);
    const { error } = await requestPasswordResetForEmail(email);
    setResetting(false);
    if (error) {
      showBanner('error', 'No se pudo enviar el correo', error.message || '');
      return;
    }
    showBanner('success', 'Revisa tu bandeja', `Te enviamos un enlace para recuperar tu contraseña a ${email}.`);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
            <View style={styles.brandRow}>
              <FutfinderMark size={22} color={C.green} />
              <Text style={styles.brandText}>fut<Text style={{ color: C.green }}>finder</Text></Text>
            </View>
            <View style={{ width: 40 }} />
          </View>

          {banner && <Banner {...banner} onClose={() => setBanner(null)} />}

          <Text style={styles.title}>Qué bueno verte{'\n'}de vuelta</Text>

          {remembered && (
            <Pressable
              onPress={() => {
                setIdentifier(remembered.email);
                // No guardamos la contraseña (ver rememberedAccount.js), así
                // que un toque no puede entrar solo: deja el correo listo y
                // el foco en la contraseña para que sea un solo campo más.
                passwordRef.current?.focus();
              }}
              style={styles.rememberedRow}
              accessibilityRole="button"
              accessibilityLabel={`Usar la cuenta guardada ${remembered.email}`}
            >
              <View style={styles.rememberedAvatar}>
                <Text style={styles.rememberedAvatarText}>{inicialDe(remembered.username || remembered.email)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rememberedName} numberOfLines={1}>
                  {remembered.username ? `@${remembered.username}` : remembered.email}
                </Text>
                <Text style={styles.rememberedEmail} numberOfLines={1}>{remembered.email}</Text>
              </View>
              <View style={styles.rememberedBadge}>
                <Text style={styles.rememberedBadgeText}>GUARDADA</Text>
              </View>
            </Pressable>
          )}

          <Card style={{ marginTop: remembered ? 11 : 20 }}>
            <Text style={styles.fieldLabel}>Correo electrónico</Text>
            <TextInput
              style={styles.input}
              placeholder="tu@correo.cl"
              placeholderTextColor={C.textMuted}
              value={identifier}
              onChangeText={setIdentifier}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <View style={styles.passwordLabelRow}>
              <Text style={styles.fieldLabel}>Contraseña</Text>
              <Text
                style={[styles.forgotLink, resetting && { opacity: 0.5 }]}
                onPress={resetting ? undefined : handleForgotPassword}
              >
                {resetting ? 'Enviando…' : '¿La olvidaste?'}
              </Text>
            </View>
            <View style={styles.passwordRow}>
              <TextInput
                ref={passwordRef}
                style={styles.passwordInput}
                placeholder="Tu contraseña"
                placeholderTextColor={C.textMuted}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
              />
              <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={8}>
                {showPassword ? (
                  <EyeOff color={C.textMuted} size={18} strokeWidth={1.8} />
                ) : (
                  <Eye color={C.textMuted} size={18} strokeWidth={1.8} />
                )}
              </Pressable>
            </View>

            {/* Esta app siempre mantiene la sesión abierta entre usos
                (`persistSession: true` en services/supabase.js) — no hay
                una vía para cerrarla "salvo esta vez", así que el control
                se muestra fijo en vez de fingir que se puede desactivar. */}
            <View style={styles.keepSessionRow}>
              <View style={[styles.checkbox, styles.checkboxOn]}>
                <Check color={C.textOnGreen} size={13} strokeWidth={3} />
              </View>
              <Text style={styles.keepSessionText}>Mantener mi sesión abierta</Text>
            </View>
          </Card>

          <View style={{ marginTop: 22, gap: 10 }}>
            <Button
              label={loading ? 'Ingresando…' : 'Iniciar sesión'}
              onPress={handleLogin}
              loading={loading}
            />
            <View style={styles.footerRow}>
              <Text style={styles.footerText}>¿Aún no tienes cuenta?</Text>
              <Text style={styles.footerLink} onPress={() => navigation.navigate('Register')}> Regístrate</Text>
            </View>
          </View>

          {!isSupabaseConfigured && (
            <Text style={styles.demoHint}>
              ⚠️ Faltan las variables de entorno de Supabase, así que no se
              puede iniciar sesión. Revisa el archivo .env.
            </Text>
          )}

          <View style={{ height: 24 }} />
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 24, flexGrow: 1 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  brandText: { fontFamily: F.extraBold, fontSize: 17, color: C.textPrimary, letterSpacing: -0.4 },

  title: { fontFamily: F.extraBold, fontSize: 27, lineHeight: 32, color: C.textPrimary, letterSpacing: -0.6, marginTop: 18 },

  rememberedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: R.row,
    paddingHorizontal: 14, paddingVertical: 13, marginTop: 20,
  },
  rememberedAvatar: {
    width: 42, height: 42, borderRadius: 14, flexShrink: 0,
    backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  rememberedAvatarText: { fontFamily: F.extraBold, fontSize: 15, color: C.textSecondary },
  rememberedName: { fontFamily: F.extraBold, fontSize: 14, color: C.textPrimary },
  rememberedEmail: { fontFamily: F.medium, fontSize: 11.5, color: C.textSecondary, marginTop: 3 },
  rememberedBadge: {
    height: 24, paddingHorizontal: 9, borderRadius: 999, flexShrink: 0,
    backgroundColor: C.shieldBg, borderWidth: 1, borderColor: C.greenDeepBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  rememberedBadgeText: { fontFamily: F.extraBold, fontSize: 9.5, letterSpacing: 0.6, color: C.green },

  fieldLabel: { fontFamily: F.bold, color: C.textSecondary, fontSize: 12 },
  input: {
    height: 48, marginTop: 9, paddingHorizontal: 14, borderRadius: R.iconBtn,
    backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border,
    color: C.textPrimary, fontFamily: F.bold, fontSize: 14.5,
  },
  passwordLabelRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 15 },
  forgotLink: { fontFamily: F.bold, fontSize: 11.5, color: C.green },
  passwordRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, marginTop: 9,
    paddingHorizontal: 14, borderRadius: R.iconBtn, backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border,
  },
  passwordInput: { flex: 1, minWidth: 0, height: '100%', color: C.textPrimary, fontFamily: F.bold, fontSize: 14.5 },

  keepSessionRow: { flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 16 },
  checkbox: {
    width: 20, height: 20, borderRadius: 6, flexShrink: 0,
    borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: C.green, borderColor: C.green },
  keepSessionText: { fontFamily: F.semiBold, fontSize: 12.5, color: C.textSecondary },

  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  footerText: { fontFamily: F.semiBold, fontSize: 13, color: C.textSecondary },
  footerLink: { fontFamily: F.extraBold, fontSize: 13, color: C.textPrimary },

  demoHint: { fontFamily: F.medium, fontSize: 11, lineHeight: 16, color: C.textMuted, textAlign: 'center', marginTop: 18 },
});
