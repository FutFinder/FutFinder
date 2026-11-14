import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react-native';

import FutFinderMark from '../components/FutFinderMark';
import Banner from '../components/Banner';
import { Card, IconButton, Button } from '../components/reservas/ui';
import { paleta as C, radios as R, fuentes as F } from '../theme/colors';
import {
  pedirCodigoDeRecuperacion,
  verificarCodigoDeRecuperacion,
  fijarPasswordRecuperada,
  signOut,
} from '../services/auth';
import { verificarCodigoDeEntrada } from '../services/mfa';
import { MFA_AYUDA, normalizarCodigo } from '../services/mfaPolicy';
import { MENSAJES_RECUPERACION } from '../services/recuperacionPolicy';
import { decideAuthDestination, isValidEmail, MENSAJES } from '../services/authPolicy';
import { PISTA_PASSWORD } from '../utils/passwordStrength';
import { getOnboardingState } from '../services/profile';
import { supabase } from '../services/supabase';
import { correoDeLaSesion } from '../services/settings';
import { consumirCorreoParaRecuperar } from '../utils/correoParaRecuperar';

const ESPERA_REENVIO = 60;

/**
 * «Olvidé mi contraseña», con código de 6 dígitos (ver
 * services/recuperacionPolicy.js para el porqué y las reglas).
 *
 * Pasos: correo → código del correo → (código de la app de autenticación,
 * si la cuenta lo tiene) → contraseña nueva. Se llega desde Iniciar sesión
 * y desde Ajustes (`desdeAjustes`), con el correo ya escrito si se conoce.
 *
 * El correo NO llega por parámetro de navegación: en web eso lo escribe en la
 * URL. Desde Iniciar sesión viene en memoria (`correoParaRecuperar`); desde
 * Ajustes se lee de la sesión.
 *
 * También termina un alta que se quedó sin contraseña (`crearPassword`): la
 * verificación del registro ya dejó una sesión abierta, pero la contraseña
 * que la persona había escrito se perdió (recargó la página) o el servidor
 * la rechazó. Entra directo al último paso; si esa sesión ya no está, parte
 * desde el correo como cualquier recuperación.
 */
export default function RecuperarContrasenaScreen({ navigation, route }) {
  const desdeAjustes = Boolean(route?.params?.desdeAjustes);
  const crearPassword = Boolean(route?.params?.crearPassword);
  const [paso, setPaso] = useState(crearPassword ? 'nueva' : 'correo'); // correo | codigo | mfa | nueva
  const [email, setEmail] = useState(() => consumirCorreoParaRecuperar());
  const [codigo, setCodigo] = useState('');
  const [password, setPassword] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [verPassword, setVerPassword] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [banner, setBanner] = useState(() =>
    crearPassword && route?.params?.rechazada
      ? { type: 'error', title: 'Elige otra contraseña', message: MENSAJES_RECUPERACION.passwordRechazada }
      : null
  );
  const [espera, setEspera] = useState(0);
  const codigoRef = useRef(null);

  useEffect(() => {
    if (!desdeAjustes) return undefined;
    let vigente = true;
    correoDeLaSesion().then((c) => {
      if (vigente && c) setEmail(c);
    });
    return () => {
      vigente = false;
    };
  }, [desdeAjustes]);

  useEffect(() => {
    if (!crearPassword) return undefined;
    let vigente = true;
    supabase.auth.getSession().then(({ data }) => {
      if (vigente && !data?.session) setPaso('correo');
    });
    return () => {
      vigente = false;
    };
  }, [crearPassword]);

  useEffect(() => {
    if (espera <= 0) return undefined;
    const t = setTimeout(() => setEspera((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [espera]);

  const mostrar = (type, title, message = '') => setBanner({ type, title, message });

  const enviarCodigo = async () => {
    setBanner(null);
    const correo = email.trim();
    if (!isValidEmail(correo)) {
      mostrar('error', 'Correo inválido', MENSAJES.correoInvalido);
      return;
    }
    setCargando(true);
    const { error } = await pedirCodigoDeRecuperacion(correo);
    setCargando(false);
    if (error) {
      mostrar('error', 'No pudimos enviar el código', error.message);
      return;
    }
    setCodigo('');
    setEspera(ESPERA_REENVIO);
    setPaso('codigo');
    mostrar('success', 'Revisa tu correo', MENSAJES_RECUPERACION.codigoEnviado(correo.toLowerCase()));
  };

  const confirmarCodigo = async (valor = codigo) => {
    if (cargando) return;
    setBanner(null);
    setCargando(true);
    const { error, necesitaMfa } = await verificarCodigoDeRecuperacion({ email, codigo: valor });
    setCargando(false);
    if (error) {
      setCodigo('');
      mostrar('error', 'Código incorrecto', error.message);
      codigoRef.current?.focus();
      return;
    }
    setCodigo('');
    setPaso(necesitaMfa ? 'mfa' : 'nueva');
  };

  const confirmarMfa = async (valor = codigo) => {
    if (cargando) return;
    setBanner(null);
    setCargando(true);
    const { error } = await verificarCodigoDeEntrada({ codigo: valor });
    setCargando(false);
    if (error) {
      setCodigo('');
      mostrar('error', 'No pudimos verificar el código', error.message);
      codigoRef.current?.focus();
      return;
    }
    setCodigo('');
    setPaso('nueva');
  };

  const guardarPassword = async () => {
    setBanner(null);
    setCargando(true);
    const { error } = await fijarPasswordRecuperada({ password, confirmacion });
    if (error) {
      setCargando(false);
      mostrar('error', 'No se pudo cambiar', error.message);
      return;
    }

    // Igual que al iniciar sesión: quien no terminó el onboarding vuelve a él.
    const { data } = await supabase.auth.getSession();
    const destino = decideAuthDestination({
      session: data?.session,
      onboardingDone: await getOnboardingState(),
    });
    setCargando(false);
    if (destino === 'onboarding') {
      navigation.reset({ index: 0, routes: [{ name: 'LocationPermission' }] });
      return;
    }
    navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
  };

  const volver = async () => {
    // Con el código ya verificado hay una sesión abierta. Si se llegó sin
    // sesión (desde Iniciar sesión) y se sale sin fijar la contraseña, se
    // cierra: salir de «recuperar» no debe dejar a nadie adentro a medias.
    if (!desdeAjustes && (paso === 'mfa' || paso === 'nueva')) await signOut();
    if (paso === 'codigo') {
      setBanner(null);
      setPaso('correo');
      return;
    }
    navigation.goBack();
  };

  const campoCodigo = (onCompleto, etiqueta) => (
    <TextInput
      ref={codigoRef}
      style={[styles.input, styles.codigoInput]}
      placeholder="000000"
      placeholderTextColor={C.textMuted}
      value={codigo}
      onChangeText={(t) => {
        const limpio = normalizarCodigo(t);
        setCodigo(limpio);
        if (limpio.length === 6) onCompleto(limpio);
      }}
      keyboardType="number-pad"
      inputMode="numeric"
      textContentType="oneTimeCode"
      autoComplete="one-time-code"
      maxLength={6}
      autoFocus
      accessibilityLabel={etiqueta}
    />
  );

  const ojo = (
    <Pressable
      onPress={() => setVerPassword((v) => !v)}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
    >
      {verPassword ? (
        <EyeOff color={C.textMuted} size={18} strokeWidth={1.8} />
      ) : (
        <Eye color={C.textMuted} size={18} strokeWidth={1.8} />
      )}
    </Pressable>
  );

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <IconButton icon={ArrowLeft} onPress={volver} accessibilityLabel="Volver" />
            <View style={styles.brandRow}>
              <FutFinderMark size={22} color={C.green} />
              <Text style={styles.brandText}>Fut<Text style={{ color: C.green }}>Finder</Text></Text>
            </View>
            <View style={{ width: 40 }} />
          </View>

          {banner && <Banner {...banner} onClose={() => setBanner(null)} />}

          {paso === 'correo' && (
            <>
              <Text style={styles.title}>Recupera tu{'\n'}contraseña</Text>
              <Text style={styles.ayuda}>
                Te enviaremos un código de 6 dígitos a tu correo para que elijas una contraseña nueva.
              </Text>
              <Card style={{ marginTop: 20 }}>
                <Text style={styles.fieldLabel}>Correo electrónico</Text>
                <TextInput
                  style={styles.input}
                  placeholder="tucorreo@ejemplo.cl"
                  placeholderTextColor={C.textMuted}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  textContentType="emailAddress"
                  autoCorrect={false}
                  autoFocus={!email}
                  editable={!desdeAjustes}
                  onSubmitEditing={enviarCodigo}
                />
              </Card>
              <View style={{ marginTop: 22 }}>
                <Button label={cargando ? 'Enviando…' : 'Enviar código'} onPress={enviarCodigo} loading={cargando} />
              </View>
            </>
          )}

          {paso === 'codigo' && (
            <>
              <Text style={styles.title}>Revisa tu{'\n'}correo</Text>
              <Text style={styles.ayuda}>
                Ingresa el código de 6 dígitos que enviamos a {email.trim().toLowerCase()}.
              </Text>
              <Card style={{ marginTop: 20 }}>
                <Text style={styles.fieldLabel}>Código del correo</Text>
                {campoCodigo(confirmarCodigo, 'Código de 6 dígitos del correo')}
              </Card>
              <View style={{ marginTop: 22, gap: 12 }}>
                <Button label={cargando ? 'Verificando…' : 'Continuar'} onPress={() => confirmarCodigo()} loading={cargando} />
                <Text
                  style={[styles.link, espera > 0 && styles.linkApagado]}
                  onPress={espera > 0 || cargando ? undefined : enviarCodigo}
                  accessibilityRole="button"
                >
                  {espera > 0 ? `Reenviar código en ${espera} s` : 'Reenviar código'}
                </Text>
              </View>
            </>
          )}

          {paso === 'mfa' && (
            <>
              <Text style={styles.title}>Verifica que{'\n'}eres tú</Text>
              <Text style={styles.ayuda}>
                Tu cuenta tiene verificación en dos pasos. Abre tu app de autenticación e ingresa el código de 6 dígitos de FutFinder.
              </Text>
              <Card style={{ marginTop: 20 }}>
                <Text style={styles.fieldLabel}>Código de verificación</Text>
                {campoCodigo(confirmarMfa, 'Código de 6 dígitos de tu app de autenticación')}
              </Card>
              <View style={{ marginTop: 22, gap: 10 }}>
                <Button label={cargando ? 'Verificando…' : 'Verificar'} onPress={() => confirmarMfa()} loading={cargando} />
                <Text style={styles.ayudaChica}>{MFA_AYUDA.alEntrar}</Text>
              </View>
            </>
          )}

          {paso === 'nueva' && (
            <>
              <Text style={styles.title}>
                {crearPassword ? 'Crea tu\ncontraseña' : 'Elige una\ncontraseña nueva'}
              </Text>
              <Text style={styles.ayuda}>
                {crearPassword
                  ? MENSAJES_RECUPERACION.crearPassword
                  : 'Al guardarla se cerrará tu sesión en los demás dispositivos.'}
              </Text>
              <Card style={{ marginTop: 20 }}>
                <Text style={styles.fieldLabel}>Contraseña nueva</Text>
                <View style={styles.passwordRow}>
                  <TextInput
                    style={styles.passwordInput}
                    placeholder="Contraseña nueva"
                    placeholderTextColor={C.textMuted}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!verPassword}
                    autoComplete="new-password"
                    textContentType="newPassword"
                    autoFocus
                  />
                  {ojo}
                </View>
                <Text style={styles.pista}>{PISTA_PASSWORD}</Text>
                <Text style={[styles.fieldLabel, { marginTop: 15 }]}>Repítela</Text>
                <View style={styles.passwordRow}>
                  <TextInput
                    style={styles.passwordInput}
                    placeholder="Repite la contraseña"
                    placeholderTextColor={C.textMuted}
                    value={confirmacion}
                    onChangeText={setConfirmacion}
                    secureTextEntry={!verPassword}
                    autoComplete="new-password"
                    textContentType="newPassword"
                    onSubmitEditing={guardarPassword}
                  />
                </View>
              </Card>
              <View style={{ marginTop: 22 }}>
                <Button label={cargando ? 'Guardando…' : 'Guardar contraseña'} onPress={guardarPassword} loading={cargando} />
              </View>
            </>
          )}
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
  ayuda: { fontFamily: F.medium, fontSize: 13.5, lineHeight: 20, color: C.textSecondary, marginTop: 12 },
  ayudaChica: { fontFamily: F.medium, fontSize: 11.5, lineHeight: 17, color: C.textMuted, textAlign: 'center', marginTop: 6 },
  fieldLabel: { fontFamily: F.bold, color: C.textSecondary, fontSize: 12 },
  input: {
    height: 48, marginTop: 9, paddingHorizontal: 14, borderRadius: R.iconBtn,
    backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border,
    color: C.textPrimary, fontFamily: F.bold, fontSize: 14.5,
  },
  codigoInput: { fontSize: 24, letterSpacing: 8, textAlign: 'center', height: 56 },
  passwordRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, marginTop: 9,
    paddingHorizontal: 14, borderRadius: R.iconBtn, backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border,
  },
  passwordInput: { flex: 1, minWidth: 0, height: '100%', color: C.textPrimary, fontFamily: F.bold, fontSize: 14.5 },
  pista: { fontFamily: F.medium, fontSize: 11.5, lineHeight: 16, color: C.textMuted, marginTop: 8 },
  link: { fontFamily: F.extraBold, fontSize: 13, color: C.green, textAlign: 'center' },
  linkApagado: { color: C.textMuted },
});
