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
import { ArrowLeft, ShieldCheck, AlertCircle, CheckCircle2 } from 'lucide-react-native';

import Logo from '../components/Logo';
import Button from '../components/Button';
import { paleta as C, radios as R, fuentes as F } from '../theme/colors';
import { APP_VERSION } from '../utils/appVersion';
import {
  verifyEmailOtp,
  resendOtp,
  completeSignUpPassword,
  hayRegistroPendiente,
  abandonSignUp,
  signOut,
} from '../services/auth';
import { isSessionUsable } from '../services/authPolicy';
import { updateMyProfile } from '../services/profile';
import { isSupabaseConfigured } from '../services/supabase';
import {
  ESPERA_REENVIO,
  MENSAJES_ALTA,
  formatoEspera,
  siguientePasoDelAlta,
  repartirCodigo,
} from '../utils/altaPorCorreo';

const CODE_LENGTH = 6;

export default function VerificationScreen({ navigation, route }) {
  const email = route?.params?.email || '';
  // La fecha de nacimiento que se pidió al crear la cuenta (pantalla
  // "Crear cuenta") no se pudo guardar todavía porque, hasta este punto,
  // no había sesión: `profiles.edad` recién se puede escribir con RLS una
  // vez que la verificación entrega una sesión real. Viaja como parámetro
  // desde RegisterScreen y se aplica acá, justo después de verificar.
  const edad = route?.params?.edad;
  // Desde «Crear cuenta» la cuenta todavía no tiene contraseña; desde «Iniciar
  // sesión» sí. Sólo en el primer caso tiene sentido pedir que cree una si la
  // que escribió ya no está en memoria.
  const esRegistro = Boolean(route?.params?.registro) || edad != null;

  const [digits, setDigits] = useState(Array(CODE_LENGTH).fill(''));
  const [channel, setChannel] = useState('Correo'); // Correo | SMS
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [seconds, setSeconds] = useState(ESPERA_REENVIO);
  const [loading, setLoading] = useState(false);
  const [reenviando, setReenviando] = useState(false);
  // Con el código aceptado ya hay sesión y ese código no sirve otra vez: lo
  // que quede por hacer (contraseña, edad) se reintenta sin volver a pedirlo.
  const [verificado, setVerificado] = useState(false);
  const progreso = useRef({ passwordFijada: false, edadGuardada: false });
  const inputs = useRef([]);

  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds(seconds - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  const handleChange = (val, idx) => {
    setError(null);
    const { casillas, foco } = repartirCodigo(digits, idx, val, CODE_LENGTH);
    setDigits(casillas);
    if (foco !== idx) inputs.current[foco]?.focus();
  };

  const handleKey = (e, idx) => {
    if (e.nativeEvent.key === 'Backspace' && !digits[idx] && idx > 0) {
      inputs.current[idx - 1]?.focus();
    }
  };

  // Hace, de a uno, lo que falta después de verificar. Cada fallo se muestra
  // y deja el botón en «Reintentar», que vuelve a entrar acá y retoma desde
  // el paso que falló (ver utils/altaPorCorreo.js).
  const terminarAlta = async () => {
    setError(null);
    setAviso(null);
    setLoading(true);
    for (;;) {
      const paso = siguientePasoDelAlta({
        esRegistro,
        edad,
        hayPasswordPendiente: hayRegistroPendiente(email),
        ...progreso.current,
      });

      if (paso === 'password') {
        const resultado = await completeSignUpPassword({ email });
        if (resultado.applied) {
          progreso.current.passwordFijada = true;
          continue;
        }
        // Rechazada por débil: ya no está en memoria y reintentar con la
        // misma no sirve. El paso siguiente será pedirle otra.
        if (resultado.rechazada) {
          progreso.current.passwordRechazada = true;
          continue;
        }
        setLoading(false);
        setError(MENSAJES_ALTA.passwordNoGuardada(resultado.error?.message));
        return;
      }

      if (paso === 'edad') {
        const resultado = await updateMyProfile({ edad });
        if (resultado?.error) {
          setLoading(false);
          setError(MENSAJES_ALTA.edadNoGuardada);
          return;
        }
        progreso.current.edadGuardada = true;
        continue;
      }

      setLoading(false);
      if (paso === 'crearPassword') {
        navigation.replace('RecuperarContrasena', {
          crearPassword: true,
          rechazada: Boolean(progreso.current.passwordRechazada),
        });
        return;
      }
      navigation.navigate('LocationPermission');
      return;
    }
  };

  const handleVerify = async () => {
    if (loading) return;
    if (verificado) {
      await terminarAlta();
      return;
    }

    const code = digits.join('');
    if (code.length < CODE_LENGTH) {
      setError('Ingresa los 6 dígitos');
      return;
    }

    // Modo demo: si Supabase no está configurado, aceptamos 472000. No hay
    // perfil donde guardar la edad.
    if (!isSupabaseConfigured) {
      if (code !== '472000') {
        setError('Código incorrecto. Intente de nuevo');
        return;
      }
      navigation.navigate('LocationPermission');
      return;
    }

    setAviso(null);
    setLoading(true);
    const { error: err, session } = await verifyEmailOtp({ email, token: code });

    if (err) {
      setLoading(false);
      setError(err.message || 'Código incorrecto. Intente de nuevo');
      return;
    }

    // Sin sesión no se avanza: el código lo valida Supabase, no esta pantalla.
    if (!isSessionUsable(session)) {
      setLoading(false);
      setError('Código incorrecto. Intente de nuevo');
      return;
    }

    // Recién ahora, con el correo demostrado, la cuenta recibe su contraseña
    // y su fecha de nacimiento.
    setVerificado(true);
    await terminarAlta();
  };

  const handleResend = async () => {
    if (reenviando) return;
    setError(null);
    setAviso(null);
    const limpiar = () => {
      setSeconds(ESPERA_REENVIO);
      setDigits(Array(CODE_LENGTH).fill(''));
      inputs.current[0]?.focus();
    };
    if (!isSupabaseConfigured || !email) {
      limpiar();
      return;
    }

    setReenviando(true);
    const { error: err, esperar } = await resendOtp({ email });
    setReenviando(false);

    // Auth no deja pedir otro tan seguido: el reloj se ajusta a lo que falta
    // de verdad y el código anterior sigue sirviendo, así que no se borra.
    if (esperar > 0) {
      setSeconds(esperar);
      setError(MENSAJES_ALTA.esperaParaReenviar(esperar));
      return;
    }
    if (err) {
      setError(err.message || MENSAJES_ALTA.reenvioFallido);
      return;
    }
    limpiar();
    setAviso(MENSAJES_ALTA.reenviado);
  };

  const salir = async () => {
    // Salir sin terminar descarta el registro a medias y borra la contraseña
    // que estaba esperando en memoria. Si el código ya se había aceptado hay
    // una sesión abierta: se cierra, para no dejar a nadie adentro a medias.
    abandonSignUp();
    if (verificado) await signOut();
    navigation.goBack();
  };

  const fmt = formatoEspera(seconds);

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
              onPress={salir}
              hitSlop={12}
              style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
            >
              <ArrowLeft color={C.textPrimary} size={22} />
            </Pressable>
            <View style={styles.logoCenter}>
              <Logo size={32} />
            </View>
            <View style={{ width: 40 }} />
          </View>

          <View style={styles.card}>
            <View style={styles.titleRow}>
              <ShieldCheck color={C.green} size={20} />
              <Text style={styles.title}>Verificación de cuenta</Text>
            </View>
            <Text style={styles.subtitle}>
              {email
                ? `Ingresa el código de 6 dígitos enviado a ${email}`
                : 'Ingresa el código de 6 dígitos enviado a tu correo o SMS'}
            </Text>

            <View style={styles.codeRow}>
              {digits.map((d, i) => (
                <TextInput
                  key={i}
                  ref={(r) => (inputs.current[i] = r)}
                  style={[
                    styles.codeBox,
                    d && styles.codeBoxFilled,
                    error && styles.codeBoxError,
                  ]}
                  value={d}
                  onChangeText={(v) => handleChange(v, i)}
                  onKeyPress={(e) => handleKey(e, i)}
                  keyboardType="number-pad"
                  // Largo completo, no 1: así cabe el código pegado o el que
                  // autocompleta el teclado, y `handleChange` lo reparte.
                  maxLength={CODE_LENGTH}
                  inputMode="numeric"
                  autoComplete={i === 0 ? 'one-time-code' : 'off'}
                  textContentType={i === 0 ? 'oneTimeCode' : 'none'}
                  editable={!verificado}
                  textAlign="center"
                  selectTextOnFocus
                />
              ))}
            </View>

            <View style={styles.channelRow}>
              <View style={styles.channelGroup}>
                {['Correo', 'SMS'].map((c) => {
                  const active = channel === c;
                  return (
                    <Pressable
                      key={c}
                      onPress={() => setChannel(c)}
                      style={[
                        styles.channelBtn,
                        active && styles.channelBtnActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.channelText,
                          active && styles.channelTextActive,
                        ]}
                      >
                        {c}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {!verificado && (
                <Pressable
                  disabled={seconds > 0 || reenviando}
                  onPress={handleResend}
                  hitSlop={8}
                  accessibilityRole="button"
                >
                  <Text
                    style={[
                      styles.resend,
                      seconds === 0 && !reenviando && { color: C.green },
                    ]}
                  >
                    {reenviando
                      ? 'Enviando…'
                      : seconds > 0
                        ? `Reenviar en ${fmt}`
                        : 'Reenviar código'}
                  </Text>
                </Pressable>
              )}
            </View>

            <View style={{ height: 18 }} />

            <Button
              label={
                verificado
                  ? loading ? 'Guardando…' : 'Reintentar'
                  : loading ? 'Verificando…' : 'Verificar código'
              }
              variant="primary"
              onPress={handleVerify}
              loading={loading}
            />

            {error && (
              <View style={styles.errorBox}>
                <AlertCircle color={C.red} size={16} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {aviso && !error && (
              <View style={[styles.errorBox, styles.avisoBox]}>
                <CheckCircle2 color={C.green} size={16} />
                <Text style={[styles.errorText, { color: C.green }]}>{aviso}</Text>
              </View>
            )}

            {!isSupabaseConfigured && (
              <Text style={styles.hint}>
                ⚠️ Faltan las variables de entorno de Supabase: no se puede
                verificar el código. Revisa el archivo .env.
              </Text>
            )}
          </View>

          <Text style={styles.footer}>FutFinder{APP_VERSION ? ` v${APP_VERSION}` : ''} · © 2026</Text>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
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
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoCenter: { flex: 1, alignItems: 'center' },
  card: {
    marginTop: 12,
    backgroundColor: C.surfaceAlt,
    borderRadius: R.hero,
    padding: 22,
    borderWidth: 1,
    borderColor: C.borderSoft,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  title: {
    color: C.textPrimary,
    fontSize: 20,
    fontFamily: F.extraBold,
    letterSpacing: -0.3,
  },
  subtitle: {
    color: C.textSecondary,
    fontSize: 13,
    marginBottom: 22,
  },
  // Las casillas se agrupan al centro: con `space-between`, en una pantalla
  // ancha (web, tablet) quedaban de a una en cada punta, con huecos enormes.
  codeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 18,
  },
  // `textAlign` va en el estilo y no sólo como prop: react-native-web ignora
  // la prop y el dígito quedaba pegado a la izquierda de su casilla.
  codeBox: {
    flex: 1,
    aspectRatio: 1,
    minWidth: 38,
    maxWidth: 56,
    padding: 0,
    textAlign: 'center',
    borderRadius: R.row,
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: C.bg,
    color: C.textPrimary,
    fontSize: 22,
    fontFamily: F.extraBold,
    ...Platform.select({ web: { outlineStyle: 'none' } }),
  },
  codeBoxFilled: { borderColor: C.green },
  codeBoxError: { borderColor: C.red },
  channelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  channelGroup: {
    flexDirection: 'row',
    backgroundColor: C.bg,
    borderRadius: R.pill,
    padding: 3,
    borderWidth: 1,
    borderColor: C.border,
  },
  channelBtn: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: R.pill },
  channelBtnActive: { backgroundColor: C.green },
  channelText: { color: C.textSecondary, fontSize: 13, fontFamily: F.semiBold },
  channelTextActive: { color: '#0E0E0D' },
  resend: { color: C.textSecondary, fontSize: 13, fontFamily: F.medium },
  errorBox: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.redSoft,
    borderRadius: R.row,
    padding: 12,
    borderWidth: 1,
    borderColor: C.red,
  },
  avisoBox: { backgroundColor: C.greenSoft, borderColor: C.greenBorder },
  errorText: { color: C.red, fontSize: 13, fontFamily: F.semiBold, flex: 1 },
  hint: {
    color: C.textMuted,
    fontSize: 11,
    marginTop: 14,
    textAlign: 'center',
  },
  footer: {
    textAlign: 'center',
    color: C.textMuted,
    fontSize: 11,
    marginTop: 24,
    letterSpacing: 0.5,
  },
});
