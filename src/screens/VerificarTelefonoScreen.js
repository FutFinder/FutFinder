import React, { useEffect, useState } from 'react';
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
  miTelefonoVerificado,
  normalizarCelularChileno,
  verificarCodigoTelefono,
} from '../services/trueScore';

/**
 * Verificar el teléfono (TrueScore, spec §1.5: una cuenta, un número).
 *
 * Queda LISTA pero no se exige: inscribirse o publicar sólo lo pide cuando se
 * active el flag `telefono_obligatorio`, y eso espera a que haya un proveedor
 * de SMS configurado en Supabase. Mientras tanto, pedir el código responde
 * con un mensaje claro en vez de un error crudo.
 */
export default function VerificarTelefonoScreen({ navigation }) {
  const [verificado, setVerificado] = useState(null);
  const [paso, setPaso] = useState('numero'); // 'numero' | 'codigo'
  const [numero, setNumero] = useState('');
  const [codigo, setCodigo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    miTelefonoVerificado().then(setVerificado);
  }, []);

  const telefono = normalizarCelularChileno(numero);

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
    setVerificado(true);
  };

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
        {verificado === null ? (
          <ActivityIndicator color={C.green} style={{ marginTop: 40 }} />
        ) : verificado ? (
          <View style={styles.card}>
            <CheckCircle2 color={C.green} size={30} />
            <Text style={styles.title}>Tu teléfono está verificado</Text>
            <Text style={styles.hint}>
              Cada cuenta de FutFinder tiene un número propio. Así el TrueScore de cada jugador es
              de una sola persona.
            </Text>
          </View>
        ) : (
          <View style={styles.card}>
            <Smartphone color={C.green} size={30} />
            <Text style={styles.title}>
              {paso === 'numero' ? 'Verifica tu celular' : 'Ingresa el código'}
            </Text>
            <Text style={styles.hint}>
              {paso === 'numero'
                ? 'Te enviamos un código por SMS. Un número sirve para una sola cuenta.'
                : `Enviamos un código de 6 dígitos al ${telefono}.`}
            </Text>

            {paso === 'numero' ? (
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
            ) : (
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
            )}

            {paso === 'numero' && numero.length > 0 && !telefono ? (
              <Text style={styles.error}>Escribe un celular chileno: 9 seguido de 8 dígitos.</Text>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              onPress={paso === 'numero' ? pedirCodigo : confirmar}
              disabled={enviando || (paso === 'numero' ? !telefono : codigo.length < 6)}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.button,
                (enviando || (paso === 'numero' ? !telefono : codigo.length < 6)) && { opacity: 0.5 },
                pressed && { opacity: 0.85 },
              ]}
            >
              {enviando ? (
                <ActivityIndicator color={C.greenInk} />
              ) : (
                <Text style={styles.buttonText}>
                  {paso === 'numero' ? 'Enviar código' : 'Verificar'}
                </Text>
              )}
            </Pressable>

            {paso === 'codigo' ? (
              <Pressable
                onPress={() => {
                  setPaso('numero');
                  setCodigo('');
                  setError(null);
                }}
                style={{ marginTop: 12, alignSelf: 'center' }}
              >
                <Text style={styles.link}>‹ Cambiar número</Text>
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
