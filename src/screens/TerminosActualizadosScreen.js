import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FileText } from 'lucide-react-native';

import Logo from '../components/Logo';
import Button from '../components/Button';
import { paleta as C, radios as R, fuentes as F } from '../theme/colors';
import { ACTUALIZADO, CAMBIOS_DE_ESTA_VERSION } from '../data/legal';
import { registrarAceptacionLegal } from '../services/aceptacionLegal';
import { signOut } from '../services/auth';

/**
 * Se muestra en lugar de la app a quien no aceptó la versión vigente de los
 * términos y la política (ver `navigation/withTerminosVigentes.js`).
 *
 * No hay cómo saltársela: o se acepta, o se cierra la sesión. Los textos se
 * abren encima (`Terminos`, `Privacidad`) y al volver se sigue acá.
 */
export default function TerminosActualizadosScreen({ navigation, onAceptado }) {
  const [guardando, setGuardando] = useState(false);
  const [saliendo, setSaliendo] = useState(false);
  const [error, setError] = useState(null);

  const aceptar = async () => {
    if (guardando) return;
    setGuardando(true);
    setError(null);
    const { error: err } = await registrarAceptacionLegal();
    setGuardando(false);
    if (err) {
      setError(err.message);
      return;
    }
    onAceptado?.();
  };

  const salir = async () => {
    if (saliendo) return;
    setSaliendo(true);
    await signOut();
    const nav = navigation?.getParent?.() || navigation;
    nav?.reset?.({ index: 0, routes: [{ name: 'Welcome' }] });
  };

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.logo}>
            <Logo size={32} />
          </View>

          <View style={styles.card}>
            <View style={styles.titleRow}>
              <FileText color={C.green} size={20} />
              <Text style={styles.title} accessibilityRole="header">Actualizamos los términos</Text>
            </View>

            <Text style={styles.texto}>
              El {ACTUALIZADO} cambiaron los Términos y condiciones y la Política de privacidad. Para seguir usando FutFinder, revísalos y acéptalos.
            </Text>

            <View style={styles.cambios}>
              <Text style={styles.cambiosTitulo}>Lo principal</Text>
              {CAMBIOS_DE_ESTA_VERSION.cambios.map((c) => (
                <View key={c} style={styles.cambioFila}>
                  <View style={styles.punto} />
                  <Text style={styles.cambioTexto}>{c}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.texto}>
              Léelos completos:{' '}
              <Text style={styles.link} accessibilityRole="link" onPress={() => navigation?.navigate('Terminos')}>Términos y condiciones</Text>
              {' '}y{' '}
              <Text style={styles.link} accessibilityRole="link" onPress={() => navigation?.navigate('Privacidad')}>Política de privacidad</Text>.
            </Text>

            <View style={{ height: 20 }} />
            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Button
              label="Aceptar y continuar"
              variant="primary"
              onPress={aceptar}
              loading={guardando}
              disabled={guardando || saliendo}
            />
            <Pressable
              onPress={salir}
              disabled={guardando || saliendo}
              accessibilityRole="button"
              hitSlop={8}
              style={({ pressed }) => [styles.salir, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.salirTexto}>{saliendo ? 'Cerrando sesión…' : 'Ahora no, cerrar sesión'}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { paddingHorizontal: 20, paddingBottom: 40, flexGrow: 1, justifyContent: 'center' },
  logo: { alignItems: 'center', paddingVertical: 12 },
  card: {
    marginTop: 8,
    backgroundColor: C.surfaceAlt,
    borderRadius: R.hero,
    padding: 22,
    borderWidth: 1,
    borderColor: C.borderSoft,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  title: { color: C.textPrimary, fontSize: 20, fontFamily: F.extraBold, letterSpacing: -0.3 },
  texto: { color: C.textSecondary, fontSize: 14, lineHeight: 20 },
  cambios: {
    backgroundColor: C.bg,
    borderRadius: R.row,
    padding: 14,
    borderWidth: 1,
    borderColor: C.borderSoft,
    marginVertical: 16,
    gap: 8,
  },
  cambiosTitulo: { color: C.textPrimary, fontSize: 13, fontFamily: F.bold },
  cambioFila: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  punto: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.green, marginTop: 7 },
  cambioTexto: { flex: 1, color: C.textSecondary, fontSize: 13, lineHeight: 19 },
  link: { color: C.green, fontFamily: F.semiBold },
  error: { color: C.red, fontFamily: F.medium, fontSize: 13, lineHeight: 18, marginBottom: 12 },
  salir: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  salirTexto: { color: C.textMuted, fontFamily: F.semiBold, fontSize: 13 },
});
