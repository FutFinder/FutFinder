import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  Linking,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SvgXml } from 'react-native-svg';
import { ArrowLeft, ShieldCheck, ShieldAlert } from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';

import Banner from '../components/Banner';
import { Card, IconButton, Button } from '../components/reservas/ui';
import { paleta as C, radios as R, fuentes as F } from '../theme/colors';
import useConfirmacion from '../components/useConfirmacion';
import {
  desactivar,
  iniciarActivacion,
  confirmarActivacion,
  miRequisitoMfa,
  misFactoresTotp,
} from '../services/mfa';
import { MFA_AYUDA, claveEnGrupos, codigoCompleto, normalizarCodigo, xmlDelQr } from '../services/mfaPolicy';

/**
 * Activar o desactivar la verificación en dos pasos (app de autenticación).
 *
 * Es opcional para todos y obligatoria para el personal (moderadores y
 * administradores de recinto) cuando se encienda la bandera del servidor
 * (migración 167): en ese caso no se ofrece desactivarla.
 *
 * Tres estados: `cargando`, `inactiva` (con el recorrido de activación) y
 * `activa`. Supabase no trae códigos de recuperación, así que antes de
 * confirmar se avisa qué pasa si se pierde el teléfono.
 */
export default function MfaSetupScreen({ navigation, route }) {
  const [estado, setEstado] = useState('cargando'); // cargando | inactiva | activa
  const [factor, setFactor] = useState(null);
  const [requisito, setRequisito] = useState({ es_staff: false, requerida: false, cumple: true });
  const [activacion, setActivacion] = useState(null); // { factorId, qr, secreto, uri }
  const [codigo, setCodigo] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [banner, setBanner] = useState(null);
  const codigoRef = useRef(null);
  const { confirmar, dialogo } = useConfirmacion();

  // Si llegó desde una pantalla que lo exige, al terminar vuelve a ella.
  const volverA = route?.params?.volverA || null;

  const cargar = useCallback(async () => {
    const [{ data: factores, error }, { data: req }] = await Promise.all([misFactoresTotp(), miRequisitoMfa()]);
    if (error) {
      setBanner({ type: 'error', title: 'No pudimos cargar tu verificación', message: error.message });
    }
    setRequisito(req);
    setFactor(factores[0] || null);
    setEstado(factores.length ? 'activa' : 'inactiva');
  }, []);

  useFocusEffect(
    useCallback(() => {
      cargar();
    }, [cargar])
  );

  useEffect(() => {
    if (activacion) codigoRef.current?.focus();
  }, [activacion]);

  const empezar = async () => {
    setBanner(null);
    setTrabajando(true);
    const { data, error } = await iniciarActivacion();
    setTrabajando(false);
    if (error) {
      setBanner({ type: 'error', title: 'No pudimos empezar', message: error.message });
      return;
    }
    setCodigo('');
    setActivacion(data);
  };

  const cancelar = async () => {
    // El factor a medias se limpia solo al volver a empezar (`iniciarActivacion`).
    setActivacion(null);
    setCodigo('');
    setBanner(null);
  };

  const confirmarCodigo = async (valor = codigo) => {
    if (trabajando || !activacion) return;
    setBanner(null);
    if (!codigoCompleto(valor)) {
      setBanner({ type: 'error', title: 'Código incompleto', message: 'Ingresa los 6 dígitos que muestra tu app de autenticación.' });
      return;
    }
    setTrabajando(true);
    const { error } = await confirmarActivacion({ factorId: activacion.factorId, codigo: valor });
    setTrabajando(false);
    if (error) {
      setCodigo('');
      setBanner({ type: 'error', title: 'No pudimos verificar el código', message: error.message });
      codigoRef.current?.focus();
      return;
    }
    setActivacion(null);
    setCodigo('');
    await cargar();
    setBanner({
      type: 'success',
      title: 'Verificación en dos pasos activada',
      message: 'Desde ahora, al iniciar sesión te pediremos el código de tu app de autenticación.',
    });
    if (volverA) navigation.navigate(volverA);
  };

  const quitar = () => {
    if (!factor) return;
    confirmar(
      '¿Desactivar la verificación en dos pasos?',
      'Tu cuenta volverá a protegerse sólo con la contraseña.',
      async () => {
        setTrabajando(true);
        const { error } = await desactivar(factor.id);
        setTrabajando(false);
        if (error) {
          setBanner({ type: 'error', title: 'No pudimos desactivarla', message: error.message });
          return;
        }
        setBanner({ type: 'success', title: 'Verificación en dos pasos desactivada' });
        await cargar();
      },
      { confirmar: 'Desactivar' }
    );
  };

  const xml = activacion?.qr ? xmlDelQr(activacion.qr) : null;
  const obligatoria = requisito.requerida;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
          <Text style={styles.headerTitle}>Verificación en dos pasos</Text>
          <View style={{ width: 40 }} />
        </View>

        {banner ? <Banner {...banner} onClose={() => setBanner(null)} /> : null}

        {estado === 'cargando' ? (
          <ActivityIndicator color={C.green} style={{ marginTop: 48 }} />
        ) : null}

        {estado === 'activa' ? (
          <>
            <Card style={{ marginTop: 18 }}>
              <View style={styles.estadoRow}>
                <ShieldCheck color={C.green} size={28} strokeWidth={2} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.estadoTitulo}>Está activada</Text>
                  <Text style={styles.texto}>
                    Al iniciar sesión te pedimos, además de la contraseña, el código de 6 dígitos de tu app de autenticación.
                  </Text>
                </View>
              </View>
            </Card>
            {obligatoria ? (
              <Text style={styles.nota}>
                Es obligatoria para tu cuenta porque administras un recinto o moderas, así que no se puede desactivar.
              </Text>
            ) : (
              <View style={{ marginTop: 18 }}>
                <Button label="Desactivar" variant="secondary" onPress={quitar} loading={trabajando} />
              </View>
            )}
          </>
        ) : null}

        {estado === 'inactiva' && !activacion ? (
          <>
            {obligatoria && !requisito.cumple ? (
              <Card style={{ marginTop: 18 }}>
                <View style={styles.estadoRow}>
                  <ShieldAlert color={C.amber} size={28} strokeWidth={2} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.estadoTitulo}>Tu cuenta la necesita</Text>
                    <Text style={styles.texto}>
                      Administras un recinto o moderas en FutFinder, así que para entrar a esas secciones tienes que activar la verificación en dos pasos.
                    </Text>
                  </View>
                </View>
              </Card>
            ) : null}
            <Card style={{ marginTop: 18 }}>
              <Text style={styles.estadoTitulo}>Protege tu cuenta con un segundo paso</Text>
              <Text style={styles.texto}>
                Además de tu contraseña, usarás un código de 6 dígitos que cambia cada 30 segundos y sólo muestra tu teléfono. Si alguien descubre tu contraseña, igual no podrá entrar.
              </Text>
              <Text style={[styles.texto, { marginTop: 10 }]}>
                Necesitas una app de autenticación, como Google Authenticator, Microsoft Authenticator o Authy.
              </Text>
            </Card>
            <View style={{ marginTop: 18 }}>
              <Button label="Activar" onPress={empezar} loading={trabajando} />
            </View>
          </>
        ) : null}

        {estado === 'inactiva' && activacion ? (
          <>
            <Card style={{ marginTop: 18 }}>
              <Text style={styles.paso}>Paso 1</Text>
              <Text style={styles.estadoTitulo}>Agrega FutFinder a tu app de autenticación</Text>
              {xml ? (
                <View style={styles.qrWrap} accessibilityLabel="Código QR para tu app de autenticación">
                  <SvgXml xml={xml} width={200} height={200} />
                </View>
              ) : null}
              {Platform.OS !== 'web' && activacion.uri ? (
                <Pressable
                  onPress={() => Linking.openURL(activacion.uri).catch(() => {})}
                  accessibilityRole="button"
                  style={styles.enlaceBtn}
                >
                  <Text style={styles.enlaceTxt}>Abrir en mi app de autenticación</Text>
                </Pressable>
              ) : null}
              <Text style={styles.texto}>
                {xml ? 'Escanea el código QR, o ' : ''}
                escribe esta clave a mano:
              </Text>
              <Text selectable style={styles.clave}>
                {claveEnGrupos(activacion.secreto)}
              </Text>
            </Card>

            <Card style={{ marginTop: 14 }}>
              <Text style={styles.paso}>Paso 2</Text>
              <Text style={styles.estadoTitulo}>Escribe el código que te muestra la app</Text>
              <TextInput
                ref={codigoRef}
                style={styles.codigoInput}
                placeholder="000000"
                placeholderTextColor={C.textMuted}
                value={codigo}
                onChangeText={(t) => {
                  const limpio = normalizarCodigo(t);
                  setCodigo(limpio);
                  if (limpio.length === 6) confirmarCodigo(limpio);
                }}
                keyboardType="number-pad"
                inputMode="numeric"
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                maxLength={6}
                accessibilityLabel="Código de 6 dígitos de tu app de autenticación"
              />
            </Card>

            <Text style={styles.nota}>
              {MFA_AYUDA.alActivar}
            </Text>

            <View style={{ marginTop: 18, gap: 10 }}>
              <Button label="Confirmar y activar" onPress={() => confirmarCodigo()} loading={trabajando} />
              <Button label="Cancelar" variant="secondary" onPress={cancelar} disabled={trabajando} />
            </View>
          </>
        ) : null}

        <View style={{ height: 32 }} />
      </ScrollView>
      {dialogo}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { paddingHorizontal: 20, paddingBottom: 24, flexGrow: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  headerTitle: { fontFamily: F.extraBold, fontSize: 17, color: C.textPrimary, letterSpacing: -0.3 },
  estadoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  estadoTitulo: { fontFamily: F.extraBold, fontSize: 15.5, color: C.textPrimary, marginBottom: 6 },
  texto: { fontFamily: F.medium, fontSize: 13.5, lineHeight: 20, color: C.textSecondary },
  nota: { fontFamily: F.medium, fontSize: 12, lineHeight: 18, color: C.textMuted, marginTop: 14 },
  paso: { fontFamily: F.extraBold, fontSize: 10.5, letterSpacing: 0.8, color: C.green, textTransform: 'uppercase', marginBottom: 6 },
  qrWrap: {
    alignSelf: 'center', marginVertical: 14, padding: 10, backgroundColor: '#FFFFFF', borderRadius: R.row,
  },
  enlaceBtn: { alignSelf: 'center', paddingVertical: 8, marginBottom: 6 },
  enlaceTxt: { fontFamily: F.extraBold, fontSize: 13, color: C.green },
  clave: {
    fontFamily: F.bold, fontSize: 15, letterSpacing: 1.2, color: C.textPrimary, marginTop: 8,
    padding: 12, borderRadius: R.iconBtn, backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border,
  },
  codigoInput: {
    height: 56, marginTop: 6, paddingHorizontal: 14, borderRadius: R.iconBtn, textAlign: 'center',
    backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border,
    color: C.textPrimary, fontFamily: F.bold, fontSize: 24, letterSpacing: 8,
  },
});
