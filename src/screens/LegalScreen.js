import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, FileLock, Cookie, ChevronRight } from 'lucide-react-native';

import Logo from '../components/Logo';
import { paleta as C, radios as R, fuentes as F } from '../theme/colors';
import { APP_VERSION } from '../utils/appVersion';
import { ACTUALIZADO, CORREO_PRIVACIDAD, DOCUMENTOS_LEGALES } from '../data/legal';

/**
 * Política de privacidad (`Privacidad`) y de cookies (`Cookies`).
 *
 * Una sola pantalla para las dos rutas: la ruta elige el documento. Son
 * públicas a propósito —se leen ANTES de crear la cuenta, desde Bienvenida y
 * Registro— y tienen URL propia (`/privacidad`, `/cookies`), así que también
 * se abren escribiendo la dirección sin sesión, como cualquier sitio.
 */
const DOC_POR_RUTA = { Privacidad: 'privacidad', Cookies: 'cookies' };
const OTRA_RUTA = { Privacidad: 'Cookies', Cookies: 'Privacidad' };

function Parrafos({ textos }) {
  return (textos || []).map((t) => (
    <Text key={t} style={styles.parrafo}>{t}</Text>
  ));
}

export default function LegalScreen({ navigation, route }) {
  const doc = DOCUMENTOS_LEGALES[DOC_POR_RUTA[route.name] || 'privacidad'];
  const otra = OTRA_RUTA[route.name] || 'Cookies';
  const otroDoc = DOCUMENTOS_LEGALES[DOC_POR_RUTA[otra]];
  const Icono = route.name === 'Cookies' ? Cookie : FileLock;

  // Abierta directo por URL no hay a dónde volver: Splash decide si toca
  // Bienvenida o Inicio según la sesión.
  const volver = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Splash');
  };

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Pressable
              onPress={volver}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Volver"
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
              <Icono color={C.green} size={20} />
              <Text style={styles.title} accessibilityRole="header">{doc.titulo}</Text>
            </View>
            <Text style={styles.fecha}>Última actualización: {ACTUALIZADO}</Text>

            <View style={styles.resumenBox}>
              <Text style={styles.resumen}>{doc.resumen}</Text>
            </View>

            {doc.secciones.map((s) => (
              <View key={s.titulo} style={styles.seccion}>
                <Text style={styles.seccionTitulo}>{s.titulo}</Text>
                <Parrafos textos={s.parrafos} />
                {s.lista ? (
                  <View style={styles.lista}>
                    {s.lista.map((item) => (
                      <View key={item} style={styles.item}>
                        <View style={styles.punto} />
                        <Text style={styles.itemTexto}>{item}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                <Parrafos textos={s.parrafosFinales} />
              </View>
            ))}

            <Pressable
              onPress={() => Linking.openURL(`mailto:${CORREO_PRIVACIDAD}`).catch(() => {})}
              accessibilityRole="link"
            >
              <Text style={styles.correo}>{CORREO_PRIVACIDAD}</Text>
            </Pressable>
          </View>

          <Pressable
            onPress={() => navigation.navigate(otra)}
            accessibilityRole="link"
            style={({ pressed }) => [styles.otroDoc, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.otroDocTexto}>Ver {otroDoc.titulo.toLowerCase()}</Text>
            <ChevronRight color={C.textSecondary} size={18} />
          </Pressable>

          <Text style={styles.footer}>FutFinder{APP_VERSION ? ` v${APP_VERSION}` : ''} · © 2026</Text>
        </ScrollView>
      </SafeAreaView>
    </View>
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
  },
  title: {
    color: C.textPrimary,
    fontSize: 20,
    fontFamily: F.extraBold,
    letterSpacing: -0.3,
  },
  fecha: {
    color: C.textMuted,
    fontSize: 12,
    marginTop: 6,
    marginBottom: 16,
  },
  resumenBox: {
    backgroundColor: C.bg,
    borderRadius: R.row,
    padding: 16,
    borderWidth: 1,
    borderColor: C.borderSoft,
    marginBottom: 8,
  },
  resumen: {
    color: C.textPrimary,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: F.medium,
  },
  seccion: { marginTop: 18 },
  seccionTitulo: {
    color: C.textPrimary,
    fontSize: 15,
    fontFamily: F.bold,
    marginBottom: 8,
  },
  parrafo: {
    color: C.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 8,
  },
  lista: { gap: 6, marginBottom: 8 },
  item: { flexDirection: 'row', gap: 10 },
  punto: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: C.green,
    marginTop: 7,
  },
  itemTexto: {
    flex: 1,
    color: C.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  correo: {
    color: C.green,
    fontFamily: F.semiBold,
    fontSize: 13,
    marginTop: 10,
  },
  otroDoc: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.surface,
    borderRadius: R.row,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: C.borderSoft,
  },
  otroDocTexto: {
    color: C.textPrimary,
    fontFamily: F.semiBold,
    fontSize: 14,
  },
  footer: {
    textAlign: 'center',
    color: C.textMuted,
    fontSize: 11,
    marginTop: 24,
    letterSpacing: 0.5,
  },
});
