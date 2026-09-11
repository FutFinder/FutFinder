import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Animated,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CalendarCheck, Swords, UserPlus, Star } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';

import FutfinderMark from '../components/FutfinderMark';
import BannerBackdrop from '../components/ds/BannerBackdrop';
import { Card, SectionLabel, Button, StickyFooter } from '../components/reservas/ui';
import { reservas as C, reservasFonts as F } from '../theme/colors';
import { getOnboardingState } from '../services/profile';

const TERMS_URL = 'https://futfinder.cl/terminos';
const PRIVACY_URL = 'https://futfinder.cl/privacidad';

// Nombres de recintos ilustrativos para el ticker de la portada — copia de
// marketing, igual que "9.400 jugadores ya organizan acá" más abajo: no
// hay una consulta en vivo detrás (services/reservas.js todavía sirve
// datos de ejemplo, ver docs/memoria/funcionalidades/reservas.md), así que
// mostrar nombres reales de un complejo puntual sería fabricar un dato,
// no ilustrarlo. Son comunas/nombres genéricos, no afirmaciones puntuales.
const TICKER_ITEMS = [
  'Cancha Los Álamos · Ñuñoa',
  'Complejo Norte · Quilicura',
  'Estadio Central · Santiago',
];

const FEATURES = [
  {
    icon: CalendarCheck,
    title: 'Reserva tu cancha',
    subtitle: 'Horarios reales, pago dividido y confirmación al instante',
  },
  {
    icon: Swords,
    title: 'Desafíos entre clubes',
    subtitle: 'Arma tu club y enfréntate a los mejores de tu zona',
  },
  {
    icon: UserPlus,
    title: '¿Te faltan jugadores?',
    subtitle: 'Completa el partido con jugadores que están cerca de ti',
  },
  {
    icon: Star,
    title: 'Reputación confiable',
    subtitle: 'Jugadores verificados y puntuados partido a partido',
  },
];

/** Franja de nombres desplazándose sin fin — puro adorno, oculto a lectores de pantalla. */
function Ticker() {
  const translateX = useRef(new Animated.Value(0)).current;
  const [rowWidth, setRowWidth] = useState(0);

  useEffect(() => {
    if (!rowWidth) return undefined;
    translateX.setValue(0);
    // `Animated.loop` no reinicia el valor entre vueltas por su cuenta —
    // sin el segundo `timing` (duración 0) la animación llegaría a
    // -rowWidth una vez y se quedaría ahí, intentando animar de -rowWidth
    // a -rowWidth en cada repetición siguiente.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(translateX, {
          toValue: -rowWidth,
          duration: rowWidth * 40, // ritmo parejo sin importar cuánto texto haya
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.timing(translateX, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [rowWidth, translateX]);

  const renderRow = (key) => (
    <View
      key={key}
      style={styles.tickerRow}
      onLayout={key === 'a' ? (e) => setRowWidth(e.nativeEvent.layout.width) : undefined}
    >
      {TICKER_ITEMS.map((t, i) => (
        <View key={i} style={styles.tickerItem}>
          <View style={styles.tickerDot} />
          <Text style={styles.tickerText}>{t}</Text>
        </View>
      ))}
    </View>
  );

  return (
    <View style={styles.tickerWrap} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.tickerTrack, { transform: [{ translateX }] }]}>
        {renderRow('a')}
        {renderRow('b')}
      </Animated.View>
    </View>
  );
}

function FeatureRow({ icon: Icon, title, subtitle }) {
  return (
    <Card style={styles.featureCard}>
      <View style={styles.featureIcon}>
        <Icon color={C.green} size={20} strokeWidth={1.8} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.featureTitle}>{title}</Text>
        <Text style={styles.featureSubtitle}>{subtitle}</Text>
      </View>
    </Card>
  );
}

export default function WelcomeScreen({ navigation }) {
  const [checking, setChecking] = useState(true);

  // Auth gate: si el usuario ya está logueado y completó el onboarding,
  // lo mandamos directo al Home. Si está logueado pero no terminó,
  // lo retomamos en LocationPermission.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const state = await getOnboardingState();
      if (cancelled) return;
      if (state === true) {
        navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
        return;
      }
      if (state === false) {
        navigation.reset({ index: 0, routes: [{ name: 'LocationPermission' }] });
        return;
      }
      // state === null → no hay sesión, mostramos Portada
      setChecking(false);
    })();
    return () => { cancelled = true; };
  }, [navigation]);

  const openURL = (url) => { Linking.openURL(url).catch(() => {}); };

  if (checking) {
    return (
      <View style={[styles.root, styles.splashCenter]}>
        <FutfinderMark size={40} color={C.green} glow />
        <View style={{ height: 20 }} />
        <ActivityIndicator color={C.green} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── Hero ── */}
        <View style={styles.hero}>
          <BannerBackdrop variant="filled" />
          <LinearGradient
            colors={['rgba(7,10,7,0.15)', 'rgba(7,10,7,0.55)', C.bg]}
            locations={[0, 0.46, 0.92]}
            style={StyleSheet.absoluteFill}
          />
          <SafeAreaView edges={['top']} style={styles.heroContent}>
            <View style={styles.brandRow}>
              <FutfinderMark size={30} color={C.green} glow />
              <Text style={styles.brandText}>
                fut<Text style={{ color: C.green }}>finder</Text>
              </Text>
            </View>

            <View style={styles.heroBottom}>
              <Text style={styles.headline}>
                Tu partido{'\n'}del sábado,{'\n'}
                <Text style={{ color: C.green }}>resuelto hoy</Text>
              </Text>
              <Text style={styles.heroSubtitle}>
                Encuentra o completa tu partido en minutos. Cancha, rival y jugadores en un solo lugar.
              </Text>

              <View style={styles.avatarRow}>
                <View style={styles.avatarStack}>
                  <View style={[styles.avatar, { marginLeft: 0 }]}><Text style={styles.avatarLetter}>V</Text></View>
                  <View style={styles.avatar}><Text style={styles.avatarLetter}>J</Text></View>
                  <View style={styles.avatar}><Text style={styles.avatarLetter}>M</Text></View>
                  <View style={[styles.avatar, styles.avatarPlus]}><Text style={styles.avatarPlusLabel}>+9k</Text></View>
                </View>
                <Text style={styles.avatarCaption}>9.400 jugadores ya organizan acá</Text>
              </View>
            </View>
          </SafeAreaView>
        </View>

        <Ticker />

        {/* ── Por qué FutFinder ── */}
        <View style={styles.body}>
          <SectionLabel>Por qué FutFinder</SectionLabel>
          <View style={{ gap: 9 }}>
            {FEATURES.map((f) => (
              <FeatureRow key={f.title} {...f} />
            ))}
          </View>
        </View>

        <View style={{ height: 190 }} />
      </ScrollView>

      <StickyFooter>
        {/* Fondo sólido + degradado de entrada, para que el CTA fijo no
            deje ver el contenido scrolleado detrás — `StickyFooter` (ui.js)
            no trae fondo propio porque el resto de las pantallas de
            Reservas lo usan sobre superficies ya opacas; acá sí hace falta. */}
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          <LinearGradient
            colors={['rgba(10,12,10,0)', C.bg]}
            locations={[0, 0.35]}
            style={{ flex: 1 }}
          />
        </View>
        <Button label="Siguiente" onPress={() => navigation.navigate('Tutorial')} />
        <Text style={styles.legal}>
          Al continuar aceptas nuestros{' '}
          <Text style={styles.legalLink} onPress={() => openURL(TERMS_URL)}>Términos</Text>
          {' '}y{' '}
          <Text style={styles.legalLink} onPress={() => openURL(PRIVACY_URL)}>Política de Privacidad</Text>
        </Text>
      </StickyFooter>
    </View>
  );
}

const HERO_HEIGHT = 460;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  splashCenter: { alignItems: 'center', justifyContent: 'center' },
  scroll: { flexGrow: 1 },

  hero: { height: HERO_HEIGHT, overflow: 'hidden', backgroundColor: '#070A07' },
  heroContent: { flex: 1, paddingHorizontal: 22, justifyContent: 'space-between' },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 30 },
  brandText: {
    fontFamily: F.extraBold, fontSize: 26, color: C.textPrimary, letterSpacing: -0.8,
  },
  heroBottom: { paddingBottom: 4 },
  headline: {
    fontFamily: F.extraBold, fontSize: 38, lineHeight: 40, color: C.textPrimary, letterSpacing: -1,
  },
  heroSubtitle: {
    fontFamily: F.medium, fontSize: 14, lineHeight: 21, color: '#B4BAB5', marginTop: 14, maxWidth: 300,
  },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 20 },
  avatarStack: { flexDirection: 'row' },
  avatar: {
    width: 32, height: 32, borderRadius: 999, backgroundColor: C.surfaceAlt,
    borderWidth: 2, borderColor: '#0A0C0A', alignItems: 'center', justifyContent: 'center', marginLeft: -10,
  },
  avatarLetter: { fontFamily: F.extraBold, fontSize: 11, color: C.textSecondary },
  avatarPlus: { backgroundColor: C.shieldBg },
  avatarPlusLabel: { fontFamily: F.extraBold, fontSize: 10, color: C.green },
  avatarCaption: { flex: 1, fontFamily: F.semiBold, fontSize: 12, lineHeight: 17, color: C.textSecondary },

  tickerWrap: {
    height: 38, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#1A1E1B',
    backgroundColor: '#0C0F0C', overflow: 'hidden', justifyContent: 'center',
  },
  tickerTrack: { flexDirection: 'row' },
  tickerRow: { flexDirection: 'row' },
  tickerItem: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 13 },
  tickerDot: { width: 4, height: 4, borderRadius: 999, backgroundColor: C.greenDeepBorder },
  tickerText: { fontFamily: F.bold, fontSize: 11, color: C.textMuted },

  body: { paddingHorizontal: 20, paddingTop: 24 },
  featureCard: {
    flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 14, paddingHorizontal: 15,
  },
  featureIcon: {
    width: 40, height: 40, borderRadius: 14, flexShrink: 0,
    backgroundColor: C.shieldBg, borderWidth: 1, borderColor: C.greenDeepBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  featureTitle: { fontFamily: F.extraBold, fontSize: 14, color: C.textPrimary, letterSpacing: -0.1 },
  featureSubtitle: { fontFamily: F.medium, fontSize: 11.5, lineHeight: 16, color: C.textSecondary, marginTop: 4 },

  legal: {
    fontFamily: F.medium, fontSize: 11, lineHeight: 17, color: C.textMuted, textAlign: 'center', marginTop: 10,
  },
  legalLink: { color: C.green, fontFamily: F.semiBold },
});
