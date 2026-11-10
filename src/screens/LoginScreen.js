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

import FutFinderMark from '../components/FutFinderMark';
import Banner from '../components/Banner';
import { Card, IconButton, Button } from '../components/reservas/ui';
import { paleta as C, radios as R, fuentes as F } from '../theme/colors';
import { loginWithEmail, requestPasswordResetForEmail, getCurrentProfile, signOut } from '../services/auth';
import { verificarCodigoDeEntrada } from '../services/mfa';
import { MFA_AYUDA, necesitaSegundoPaso, nivelDesdeSesion, normalizarCodigo, codigoCompleto } from '../services/mfaPolicy';
import { decideAuthDestination, isValidEmail, MENSAJES } from '../services/authPolicy';
import { getOnboardingState } from '../services/profile';
import { isSupabaseConfigured, supabase } from '../services/supabase';
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
  // Segundo paso: quien activó la verificación en dos pasos presenta el código
  // de su app de autenticación después de la contraseña.
  const [paso, setPaso] = useState('credenciales'); // 'credenciales' | 'codigo'
  const [codigo, setCodigo] = useState('');
  const [verificando, setVerificando] = useState(false);
  const { consumePendingDestination, mfaPendiente } = useAuth();
  const passwordRef = useRef(null);
  const codigoRef = useRef(null);

  // Una sesión que entró sólo con la contraseña y todavía debe el código (se
  // cerró la app a mitad de camino, o el guard nos mandó acá): se sigue desde
  // el código, no se vuelve a pedir la contraseña.
  useEffect(() => {
    if (mfaPendiente) setPaso('codigo');
  }, [mfaPendiente]);

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

    // Con la verificación en dos pasos activada, la contraseña sola no entra:
    // falta el código. (La sesión ya existe, pero `AuthContext` no la da por
    // autenticada hasta que suba a `aal2`.)
    if (necesitaSegundoPaso(nivelDesdeSesion(result.session))) {
      setCodigo('');
      setPaso('codigo');
      return;
    }

    await terminarEntrada({ session: result.session, email: result.email || email });
  };

  const terminarEntrada = async ({ session, email }) => {
    const done = await getOnboardingState();
    const destino = decideAuthDestination({ session, onboardingDone: done });

    if (destino === 'verify-email') {
      navigation.navigate('Verification', { email });
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

  const handleCodigo = async (valor = codigo) => {
    if (verificando) return;
    setBanner(null);
    if (!codigoCompleto(valor)) {
      showBanner('error', 'Código incompleto', 'Ingresa los 6 dígitos que muestra tu app de autenticación.');
      return;
    }
    setVerificando(true);
    const { error } = await verificarCodigoDeEntrada({ codigo: valor });
    if (error) {
      setVerificando(false);
      setCodigo('');
      showBanner('error', 'No pudimos verificar el código', error.message);
      codigoRef.current?.focus();
      return;
    }
    // La sesión ya subió a `aal2`; se sigue como después de una contraseña.
    const { data } = await supabase.auth.getSession();
    setVerificando(false);
    await terminarEntrada({
      session: data?.session,
      email: data?.session?.user?.email || identifier.trim(),
    });
  };

  const handleOtraCuenta = async () => {
    await signOut();
    setCodigo('');
    setPassword('');
    setBanner(null);
    setPaso('credenciales');
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
              <FutFinderMark size={22} color={C.green} />
              <Text style={styles.brandText}>Fut<Text style={{ color: C.green }}>Finder</Text></Text>
            </View>
            <View style={{ width: 40 }} />
          </View>

          {banner && <Banner {...banner} onClose={() => setBanner(null)} />}

          {paso === 'codigo' ? (
            <>
              <Text style={styles.title}>Verifica que{'\n'}eres tú</Text>
              <Text style={styles.codigoAyuda}>
                Abre tu app de autenticación e ingresa el código de 6 dígitos de FutFinder.
              </Text>
              <Card style={{ marginTop: 20 }}>
                <Text style={styles.fieldLabel}>Código de verificación</Text>
                <TextInput
                  ref={codigoRef}
                  style={[styles.input, styles.codigoInput]}
                  placeholder="000000"
                  placeholderTextColor={C.textMuted}
                  value={codigo}
                  onChangeText={(t) => {
                    const limpio = normalizarCodigo(t);
                    setCodigo(limpio);
                    if (limpio.length === 6) handleCodigo(limpio);
                  }}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  textContentType="oneTimeCode"
                  autoComplete="one-time-code"
                  maxLength={6}
                  autoFocus
                  accessibilityLabel="Código de 6 dígitos de tu app de autenticación"
                />
              </Card>
              <View style={{ marginTop: 22, gap: 10 }}>
                <Button
                  label={verificando ? 'Verificando…' : 'Verificar'}
                  onPress={() => handleCodigo()}
                  loading={verificando}
                />
                <View style={styles.footerRow}>
                  <Text style={styles.footerLink} onPress={handleOtraCuenta}>Usar otra cuenta</Text>
                </View>
                <Text style={styles.codigoAyudaChica}>
                  {MFA_AYUDA.alEntrar}
                </Text>
              </View>
            </>
          ) : (
          <>
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

          </>
          )}

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

  codigoAyuda: { fontFamily: F.medium, fontSize: 13.5, lineHeight: 20, color: C.textSecondary, marginTop: 12 },
  codigoAyudaChica: { fontFamily: F.medium, fontSize: 11.5, lineHeight: 17, color: C.textMuted, textAlign: 'center', marginTop: 6 },
  codigoInput: { fontSize: 24, letterSpacing: 8, textAlign: 'center', height: 56 },

  demoHint: { fontFamily: F.medium, fontSize: 11, lineHeight: 16, color: C.textMuted, textAlign: 'center', marginTop: 18 },
});
