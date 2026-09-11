import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Eye, EyeOff, Check } from 'lucide-react-native';
import Svg, { Path } from 'react-native-svg';

import FutfinderMark from '../components/FutfinderMark';
import Banner from '../components/Banner';
import { Card, IconButton, Button } from '../components/reservas/ui';
import { reservas as C, reservasRadius as R, reservasFonts as F } from '../theme/colors';
import { registerWithEmail } from '../services/auth';
import { validarFechaNacimiento, usernameDesdeNombre } from '../utils/fechaNacimiento';
import { passwordStrength } from '../utils/passwordStrength';
import { saveRememberedAccount } from '../utils/rememberedAccount';
import { isSupabaseConfigured } from '../services/supabase';

const TERMS_URL = 'https://futfinder.cl/terminos';
const PRIVACY_URL = 'https://futfinder.cl/privacidad';

function GoogleIcon({ size = 19 }) {
  return (
    <Svg viewBox="0 0 24 24" width={size} height={size}>
      <Path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4z" />
      <Path fill="#34A853" d="M12 22c2.7 0 4.9-.9 6.6-2.4l-3.2-2.5c-.9.6-2 .9-3.4.9-2.6 0-4.8-1.7-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z" />
      <Path fill="#FBBC05" d="M6.4 13.9a6 6 0 0 1 0-3.8V7.5H3.1a10 10 0 0 0 0 9l3.3-2.6z" />
      <Path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3.1 7.5l3.3 2.6C7.2 7.7 9.4 6 12 6z" />
    </Svg>
  );
}

function AppleIcon({ size = 19 }) {
  return (
    <Svg viewBox="0 0 24 24" width={size} height={size} fill={C.textPrimary}>
      <Path d="M16.4 12.7c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.7-1.8-3.3-1.8-1.4-.1-2.6.8-3.3.8-.7 0-1.7-.8-2.8-.8-1.5 0-2.9.9-3.6 2.2-1.6 2.7-.4 6.7 1.1 8.9.7 1.1 1.6 2.3 2.8 2.2 1.1 0 1.5-.7 2.9-.7 1.3 0 1.7.7 2.8.7 1.2 0 2-1.1 2.7-2.2.5-.8.7-1.2 1.1-2.1-2.7-1-2.4-4.6-2.4-3.7zM14.3 5.9c.6-.7 1-1.7.9-2.7-.9.1-1.9.6-2.5 1.3-.5.6-1 1.6-.9 2.6 1 .1 2-.5 2.5-1.2z" />
    </Svg>
  );
}

function FieldLabel({ children, style }) {
  return <Text style={[styles.fieldLabel, style]}>{children}</Text>;
}

export default function RegisterScreen({ navigation }) {
  const [nombre, setNombre] = useState('');
  const [dd, setDd] = useState('');
  const [mm, setMm] = useState('');
  const [yyyy, setYyyy] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState(null);

  const mmRef = useRef(null);
  const yyyyRef = useRef(null);

  const showBanner = (type, title, message = '') => setBanner({ type, title, message });

  const openURL = (url) => { Linking.openURL(url).catch(() => {}); };

  const showComingSoon = (proveedor) => {
    showBanner('info', `Muy pronto`, `El registro con ${proveedor} todavía no está disponible.`);
  };

  const strength = passwordStrength(password);

  const handleSubmit = async () => {
    setBanner(null);

    const nombreTrim = nombre.trim();
    if (nombreTrim.length < 3) {
      showBanner('error', 'Falta tu nombre', 'Ingresa tu nombre y apellido.');
      return;
    }

    const fechaResult = validarFechaNacimiento(dd, mm, yyyy);
    if (!fechaResult.ok) {
      showBanner('error', 'Revisa tu fecha de nacimiento', fechaResult.reason);
      return;
    }

    const emailTrim = email.trim();
    if (!emailTrim.includes('@')) {
      showBanner('error', 'Correo inválido', 'Ingresa un correo válido.');
      return;
    }

    if (password.length < 8) {
      showBanner('error', 'Contraseña muy corta', 'Usa al menos 8 caracteres.');
      return;
    }

    if (!acceptTerms) {
      showBanner('error', 'Falta tu aceptación', 'Acepta los Términos y la Política de Privacidad para continuar.');
      return;
    }

    setLoading(true);
    // No existe profiles.nombre — el nombre completo solo se usa para
    // sugerir un @username inicial (editable después en Editar perfil),
    // igual que ya pasa cuando alguien no elige uno: se deriva del correo.
    const username = usernameDesdeNombre(nombreTrim, emailTrim);
    const result = await registerWithEmail({ email: emailTrim, password, username });
    setLoading(false);

    if (result.error) {
      showBanner('error', 'No pudimos crear tu cuenta', result.error.message || '');
      return;
    }

    await saveRememberedAccount({ email: emailTrim, username });

    // El registro manda un código de 6 dígitos al correo y nunca entrega
    // sesión de inmediato (ver `performSignUp` en services/authPolicy.js):
    // la contraseña recién se fija al verificar ese código
    // (`completeSignUpPassword`). La edad viaja como parámetro porque hasta
    // entonces no hay sesión con la que escribir en `profiles`.
    navigation.navigate('Verification', { email: emailTrim, edad: fechaResult.edad });
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

          <Text style={styles.title}>Crea tu cuenta</Text>
          <Text style={styles.subtitle}>En un minuto estás dentro. Después completas tu perfil de jugador.</Text>

          <View style={{ gap: 10, marginTop: 22 }}>
            <Pressable
              onPress={() => showComingSoon('Google')}
              accessibilityRole="button"
              style={({ pressed }) => [styles.socialBtn, styles.googleBtn, pressed && { opacity: 0.85 }]}
            >
              <GoogleIcon />
              <Text style={styles.googleText}>Continuar con Google</Text>
            </Pressable>
            <Pressable
              onPress={() => showComingSoon('Apple')}
              accessibilityRole="button"
              style={({ pressed }) => [styles.socialBtn, styles.appleBtn, pressed && { opacity: 0.85 }]}
            >
              <AppleIcon />
              <Text style={styles.appleText}>Continuar con Apple</Text>
            </Pressable>
          </View>

          <View style={styles.dividerRow}>
            <View style={styles.divider} />
            <Text style={styles.dividerText}>O CON TU CORREO</Text>
            <View style={styles.divider} />
          </View>

          <Card>
            <FieldLabel>Nombre y apellido</FieldLabel>
            <TextInput
              style={styles.input}
              placeholder="Vicente Sedini"
              placeholderTextColor={C.textMuted}
              value={nombre}
              onChangeText={setNombre}
              autoCapitalize="words"
            />

            <FieldLabel style={{ marginTop: 15 }}>Fecha de nacimiento</FieldLabel>
            <View style={styles.dobRow}>
              <TextInput
                style={[styles.input, styles.dobBox]}
                placeholder="DD"
                placeholderTextColor={C.textMuted}
                value={dd}
                onChangeText={(v) => {
                  const clean = v.replace(/\D/g, '').slice(0, 2);
                  setDd(clean);
                  if (clean.length === 2) mmRef.current?.focus();
                }}
                keyboardType="number-pad"
                maxLength={2}
                textAlign="center"
              />
              <TextInput
                ref={mmRef}
                style={[styles.input, styles.dobBox]}
                placeholder="MM"
                placeholderTextColor={C.textMuted}
                value={mm}
                onChangeText={(v) => {
                  const clean = v.replace(/\D/g, '').slice(0, 2);
                  setMm(clean);
                  if (clean.length === 2) yyyyRef.current?.focus();
                }}
                keyboardType="number-pad"
                maxLength={2}
                textAlign="center"
              />
              <TextInput
                ref={yyyyRef}
                style={[styles.input, styles.dobYear]}
                placeholder="AAAA"
                placeholderTextColor={C.textMuted}
                value={yyyy}
                onChangeText={(v) => setYyyy(v.replace(/\D/g, '').slice(0, 4))}
                keyboardType="number-pad"
                maxLength={4}
                textAlign="center"
              />
            </View>

            <FieldLabel style={{ marginTop: 15 }}>Correo</FieldLabel>
            <TextInput
              style={styles.input}
              placeholder="tu@correo.cl"
              placeholderTextColor={C.textMuted}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <FieldLabel style={{ marginTop: 15 }}>Contraseña</FieldLabel>
            <View style={styles.passwordRow}>
              <TextInput
                style={styles.passwordInput}
                placeholder="Mínimo 8 caracteres"
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
            <View style={styles.strengthRow}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={[styles.strengthBar, strength > i && styles.strengthBarOn]} />
              ))}
            </View>
            <Text style={styles.strengthHint}>Usa una mayúscula y un número para reforzarla.</Text>
          </Card>

          <Pressable
            onPress={() => setAcceptTerms((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: acceptTerms }}
            style={styles.termsRow}
          >
            <View style={[styles.checkbox, acceptTerms && styles.checkboxOn]}>
              {acceptTerms ? <Check color={C.textOnGreen} size={13} strokeWidth={3} /> : null}
            </View>
            <Text style={styles.termsText}>
              Acepto los{' '}
              <Text style={styles.termsLink} onPress={() => openURL(TERMS_URL)}>Términos</Text>
              {' '}y la{' '}
              <Text style={styles.termsLink} onPress={() => openURL(PRIVACY_URL)}>Política de Privacidad</Text>
              {' '}de FutFinder.
            </Text>
          </Pressable>

          <View style={{ marginTop: 22, gap: 10 }}>
            <Button
              label={loading ? 'Creando cuenta…' : 'Crear mi cuenta'}
              onPress={handleSubmit}
              loading={loading}
            />
            <View style={styles.footerRow}>
              <Text style={styles.footerText}>¿Ya tienes cuenta?</Text>
              <Text style={styles.footerLink} onPress={() => navigation.navigate('Login')}> Inicia sesión</Text>
            </View>
          </View>

          {!isSupabaseConfigured && (
            <Text style={styles.demoHint}>
              ⚠️ Faltan las variables de entorno de Supabase, así que no se
              puede crear tu cuenta. Revisa el archivo .env.
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

  title: { fontFamily: F.extraBold, fontSize: 27, color: C.textPrimary, letterSpacing: -0.6, marginTop: 18 },
  subtitle: { fontFamily: F.medium, fontSize: 13.5, lineHeight: 20, color: C.textSecondary, marginTop: 9 },

  socialBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    height: 54, borderRadius: R.ctaSecondary,
  },
  googleBtn: { backgroundColor: C.textPrimary },
  googleText: { fontFamily: F.extraBold, fontSize: 14.5, color: '#0A0C0A' },
  appleBtn: { backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border },
  appleText: { fontFamily: F.extraBold, fontSize: 14.5, color: C.textPrimary },

  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 22 },
  divider: { flex: 1, height: 1, backgroundColor: C.dividerInner },
  dividerText: { fontFamily: F.bold, fontSize: 10.5, letterSpacing: 1.4, color: C.textMuted },

  fieldLabel: { fontFamily: F.bold, color: C.textSecondary, fontSize: 12 },
  input: {
    height: 48, marginTop: 9, paddingHorizontal: 14, borderRadius: R.iconBtn,
    backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border,
    color: C.textPrimary, fontFamily: F.bold, fontSize: 14.5,
  },
  dobRow: { flexDirection: 'row', gap: 8, marginTop: 9 },
  dobBox: { width: 66, flexShrink: 0, marginTop: 0 },
  dobYear: { flex: 1, minWidth: 0, marginTop: 0 },

  passwordRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, marginTop: 9,
    paddingHorizontal: 14, borderRadius: R.iconBtn, backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border,
  },
  passwordInput: { flex: 1, minWidth: 0, height: '100%', color: C.textPrimary, fontFamily: F.bold, fontSize: 14.5 },
  strengthRow: { flexDirection: 'row', gap: 5, marginTop: 11 },
  strengthBar: { flex: 1, height: 4, borderRadius: 999, backgroundColor: '#20261F' },
  strengthBarOn: { backgroundColor: C.green },
  strengthHint: { fontFamily: F.medium, fontSize: 11, lineHeight: 15, color: C.textMuted, marginTop: 8 },

  termsRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 11,
    borderWidth: 1, borderStyle: 'dashed', borderColor: C.dashedBorder, borderRadius: R.row,
    paddingHorizontal: 14, paddingVertical: 13, marginTop: 14,
  },
  checkbox: {
    width: 20, height: 20, borderRadius: 6, flexShrink: 0, marginTop: 1,
    borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: C.green, borderColor: C.green },
  termsText: { flex: 1, fontFamily: F.medium, fontSize: 11.5, lineHeight: 17, color: C.textSecondary },
  termsLink: { color: C.green, fontFamily: F.semiBold },

  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  footerText: { fontFamily: F.semiBold, fontSize: 13, color: C.textSecondary },
  footerLink: { fontFamily: F.extraBold, fontSize: 13, color: C.textPrimary },

  demoHint: { fontFamily: F.medium, fontSize: 11, lineHeight: 16, color: C.textMuted, textAlign: 'center', marginTop: 18 },
});
