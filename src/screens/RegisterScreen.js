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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Eye, EyeOff, Check } from 'lucide-react-native';

import FutFinderMark from '../components/FutFinderMark';
import Banner from '../components/Banner';
import { Card, IconButton, Button } from '../components/reservas/ui';
import { paleta as C, radios as R, fuentes as F } from '../theme/colors';
import { registerWithEmail } from '../services/auth';
import { validarFechaNacimiento, usernameDesdeNombre } from '../utils/fechaNacimiento';
import {
  passwordStrength,
  validarPassword,
  PISTA_PASSWORD,
  PISTA_PASSWORD_CORTA,
} from '../utils/passwordStrength';
import { saveRememberedAccount } from '../utils/rememberedAccount';
import { isSupabaseConfigured } from '../services/supabase';


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

    // Antes de crear nada: si el servidor la va a rechazar, se rechaza acá.
    // Más adelante ya no hay vuelta atrás — la contraseña se fija DESPUÉS de
    // verificar el correo, y para entonces la cuenta ya existe.
    const reglas = validarPassword(password);
    if (!reglas.valid) {
      showBanner('error', 'Revisa tu contraseña', reglas.message);
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
    navigation.navigate('Verification', { email: emailTrim, edad: fechaResult.edad, registro: true });
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
            <View style={styles.brandRow}>
              <FutFinderMark size={22} color={C.green} />
              <Text style={styles.brandText}>Fut<Text style={{ color: C.green }}>Finder</Text></Text>
            </View>
            <View style={{ width: 40 }} />
          </View>

          {banner && <Banner {...banner} onClose={() => setBanner(null)} />}

          <Text style={styles.title}>Crea tu cuenta</Text>
          <Text style={styles.subtitle}>En un minuto estás dentro. Después completas tu perfil de jugador.</Text>

          {/* SIN «Continuar con Google / Apple»: eran botones de relleno que
              sólo decían «Muy pronto», y Apple rechaza funciones que no
              funcionan (guía 2.1). Si algún día se agrega un inicio con
              Google, Apple exige ofrecer también «Iniciar sesión con Apple»
              (guía 4.8). */}
          <View style={styles.espacio} />

          <Card>
            <FieldLabel>Nombre y apellido</FieldLabel>
            <TextInput
              style={styles.input}
              placeholder="Tu Nombre"
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
                placeholder={PISTA_PASSWORD_CORTA}
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
            <Text style={styles.strengthHint}>{PISTA_PASSWORD}</Text>
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
              <Text style={styles.termsLink} onPress={() => navigation.navigate('Terminos')}>Términos</Text>
              {' '}y la{' '}
              <Text style={styles.termsLink} onPress={() => navigation.navigate('Privacidad')}>Política de Privacidad</Text>
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

  espacio: { height: 22 },

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
