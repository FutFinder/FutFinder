import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, CheckCircle2, Smartphone } from 'lucide-react-native';

import { paleta as C, radios as R, fuentes as F } from '../theme/colors';
import {
  enviarCodigoTelefono,
  miTelefono,
  normalizarCelularChileno,
  registrarTelefono,
  verificarCodigoTelefono,
} from '../services/trueScore';

/**
 * Teléfono de la cuenta (TrueScore, spec §1.5: una cuenta, un número).
 *
 * Dos modos según el servidor (`mi_telefono`, migración 138):
 *   · Sin `telefono_verificacion_sms`: basta con REGISTRAR el celular. Es
 *     único entre cuentas, pero no se envía SMS.
 *   · Con `telefono_verificacion_sms`: se verifica con un código por SMS.
 *
 * Con `telefono_obligatorio` activo, inscribirse o publicar lo exige.
 */
export default function VerificarTelefonoScreen({ navigation }) {
  const [estado, setEstado] = useState(null);
  const [editando, setEditando] = useState(false);
  const [paso, setPaso] = useState('numero'); // 'numero' | 'codigo' (sólo con SMS)
  const [numero, setNumero] = useState('');
  const [codigo, setCodigo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);

  const cargar = useCallback(async () => {
    setEstado((await miTelefono()) || { registrado: false, verificacion_sms: false });
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const telefono = normalizarCelularChileno(numero);
  const conSms = !!estado?.verificacion_sms;

  const guardar = async () => {
    if (!telefono || enviando) return;
    setEnviando(true);
    setError(null);
    const res = await registrarTelefono(telefono);
    setEnviando(false);
    if (!res?.ok) {
      setError(res?.reason || 'No pudimos guardar tu teléfono.');
      return;
    }
    setEditando(false);
    setNumero('');
    setAviso('Listo: tu teléfono quedó registrado.');
    await cargar();
  };

  const pedirCodigo = async () => {
    if (!telefono || enviando) return;
    setEnviando(true);
    setError(null);
    const res = await enviarCodigoTelefono(telefono);
    setEnviando(false);
    if (!res.ok) {
      setError(res.reason);
      return;
    }
    setPaso('codigo');
  };

  const confirmar = async () => {
    if (codigo.trim().length < 6 || enviando) return;
    setEnviando(true);
    setError(null);
    const res = await verificarCodigoTelefono(telefono, codigo);
    setEnviando(false);
    if (!res.ok) {
      setError(res.reason);
      return;
    }
    await cargar();
  };

  const listo = estado && (conSms ? estado.verificado : estado.registrado) && !editando;
  const puedeEnviar = conSms && paso === 'codigo' ? codigo.length >= 6 : !!telefono;
  const accion = conSms ? (paso === 'numero' ? pedirCodigo : confirmar) : guardar;
  const textoAccion = conSms ? (paso === 'numero' ? 'Enviar código' : 'Verificar') : 'Guardar';

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Volver"
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
        >
          <ArrowLeft color={C.textPrimary} size={20} />
        </Pressable>
        <Text style={styles.headerTitle}>Teléfono</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.body}>
        {estado === null ? (
          <ActivityIndicator color={C.green} style={{ marginTop: 40 }} />
        ) : listo ? (
          <View style={styles.card}>
            <CheckCircle2 color={C.green} size={30} />
            <Text style={styles.title}>
              {conSms ? 'Tu teléfono está verificado' : 'Tu teléfono está registrado'}
            </Text>
            {estado.mascara ? <Text style={styles.numero}>{estado.mascara}</Text> : null}
            <Text style={styles.hint}>
              Cada cuenta de FutFinder tiene un número propio. Así el TrueScore de cada jugador es
              de una sola persona.
            </Text>
            {aviso ? <Text style={styles.ok}>{aviso}</Text> : null}
            <Pressable
              onPress={() => {
                setEditando(true);
                setAviso(null);
                setPaso('numero');
              }}
              style={{ marginTop: 8, alignSelf: 'flex-start' }}
              accessibilityRole="button"
            >
              <Text style={styles.link}>Cambiar número</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.card}>
            <Smartphone color={C.green} size={30} />
            <Text style={styles.title}>
              {conSms
                ? paso === 'numero'
                  ? 'Verifica tu celular'
                  : 'Ingresa el código'
                : 'Registra tu celular'}
            </Text>
            <Text style={styles.hint}>
              {conSms
                ? paso === 'numero'
                  ? 'Te enviamos un código por SMS. Un número sirve para una sola cuenta.'
                  : `Enviamos un código de 6 dígitos al ${telefono}.`
                : estado.obligatorio
                ? 'Lo pedimos para inscribirte en partidos y publicarlos. Un número sirve para una sola cuenta.'
                : 'Un número sirve para una sola cuenta.'}
            </Text>

            {conSms && paso === 'codigo' ? (
              <TextInput
                value={codigo}
                onChangeText={(t) => {
                  setCodigo(t.replace(/\D/g, '').slice(0, 6));
                  setError(null);
                }}
                placeholder="123456"
                placeholderTextColor={C.textPlaceholder}
                keyboardType="number-pad"
                autoComplete="sms-otp"
                textContentType="oneTimeCode"
                style={styles.input}
                accessibilityLabel="Código de verificación"
              />
            ) : (
              <TextInput
                value={numero}
                onChangeText={(t) => {
                  setNumero(t);
                  setError(null);
                }}
                placeholder="+56 9 1234 5678"
                placeholderTextColor={C.textPlaceholder}
                keyboardType="phone-pad"
                autoComplete="tel"
                textContentType="telephoneNumber"
                style={styles.input}
                accessibilityLabel="Número de celular"
              />
            )}

            {!(conSms && paso === 'codigo') && numero.length > 0 && !telefono ? (
              <Text style={styles.error}>Escribe un celular chileno: 9 seguido de 8 dígitos.</Text>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              onPress={accion}
              disabled={enviando || !puedeEnviar}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.button,
                (enviando || !puedeEnviar) && { opacity: 0.5 },
                pressed && { opacity: 0.85 },
              ]}
            >
              {enviando ? (
                <ActivityIndicator color={C.greenInk} />
              ) : (
                <Text style={styles.buttonText}>{textoAccion}</Text>
              )}
            </Pressable>

            {editando || (conSms && paso === 'codigo') ? (
              <Pressable
                onPress={() => {
                  if (conSms && paso === 'codigo') {
                    setPaso('numero');
                    setCodigo('');
                  } else {
                    setEditando(false);
                    setNumero('');
                  }
                  setError(null);
                }}
                style={{ marginTop: 12, alignSelf: 'center' }}
              >
                <Text style={styles.link}>{conSms && paso === 'codigo' ? '‹ Cambiar número' : 'Cancelar'}</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: C.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { color: C.textPrimary, fontSize: 18, fontFamily: F.extraBold, letterSpacing: -0.3 },
  body: { paddingHorizontal: 16 },
  card: {
    backgroundColor: C.surfaceAlt,
    borderRadius: R.cardSm,
    borderWidth: 1,
    borderColor: C.borderSoft,
    padding: 22,
    gap: 8,
  },
  title: { color: C.textPrimary, fontSize: 17, fontFamily: F.bold, marginTop: 4 },
  numero: { color: C.textPrimary, fontSize: 16, fontFamily: F.semiBold },
  hint: { color: C.textSecondary, fontSize: 13, lineHeight: 19 },
  input: {
    marginTop: 10,
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    paddingHorizontal: 14,
    color: C.textPrimary,
    fontSize: 16,
    fontFamily: F.semiBold,
  },
  error: { color: C.red, fontSize: 12.5, lineHeight: 17 },
  ok: { color: C.green, fontSize: 12.5, lineHeight: 17 },
  button: {
    marginTop: 10,
    height: 50,
    borderRadius: 14,
    backgroundColor: C.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: C.greenInk, fontSize: 15, fontFamily: F.bold },
  link: { color: C.textSecondary, fontSize: 13, fontFamily: F.semiBold },
});
