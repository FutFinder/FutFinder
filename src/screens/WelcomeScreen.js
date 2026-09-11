import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  ActivityIndicator,
  Linking,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CalendarCheck, Swords, UserPlus, Star, ChevronDown } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';

import FutfinderMark from '../components/FutfinderMark';
import BannerBackdrop from '../components/ds/BannerBackdrop';
import { Card, SectionLabel, Button } from '../components/reservas/ui';
import { reservas as C, reservasFonts as F } from '../theme/colors';
import { getOnboardingState } from '../services/profile';

const TERMS_URL = 'https://futfinder.cl/terminos';
const PRIVACY_URL = 'https://futfinder.cl/privacidad';

// El héroe arranca ocupando toda la pantalla (logo, titular, hint de scroll)
// y se contrae a medida que se scrollea, revelando el resto — igual que el
// handoff `FutFinder Inicio.dc.html`. `SCROLL_RANGE` es la distancia de
// scroll en la que se completa la contracción (no depende del alto real del
// héroe: el handoff la fija en 296px y acá se respeta el mismo número).
//
// El alto expandido sale de `useWindowDimensions()`, no de un
// `Dimensions.get('window')` de módulo: ese se lee una sola vez al importar
// el archivo, y de él depende el relleno final que garantiza el recorrido
// completo. En web la ventana termina de acomodarse después de ese primer
// render (y el usuario además puede redimensionarla), así que con el valor
// congelado el recorrido queda corto, el héroe nunca termina de contraerse
// y el contenido se queda a media opacidad, sin forma de destaparlo.
const COLLAPSED_HERO_HEIGHT = 148;
const SCROLL_RANGE = 296;
// El espaciador que empuja el resto del contenido no puede medir
// EXPANDED_HERO_HEIGHT: el héroe (superpuesto, fuera del flujo del scroll)
// termina de contraerse a los SCROLL_RANGE px de scroll sin importar cuánto
// mida expandido, así que el espaciador solo necesita dejar exactamente ese
// hueco (el alto ya colapsado + lo que se alcanzó a scrollear) para que el
// contenido quede pegado al héroe apenas termina de contraerse, sin
// espacio muerto de por medio.
const HERO_SPACER_HEIGHT = COLLAPSED_HERO_HEIGHT + SCROLL_RANGE;

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

/** «Desliza» con una flecha que rebota suave — hint de que hay más abajo. */
function ScrollHint({ style }) {
  const bob = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [bob]);

  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, 5] });
  const opacity = bob.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });

  return (
    <Animated.View style={[styles.hintWrap, style]} pointerEvents="none">
      <Text style={styles.hintText}>DESLIZA</Text>
      <Animated.View style={{ transform: [{ translateY }], opacity }}>
        <ChevronDown color={C.green} size={22} strokeWidth={2.2} />
      </Animated.View>
    </Animated.View>
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
  const { height: windowHeight } = useWindowDimensions();
  const expandedHeroHeight = windowHeight;
  const scrollY = useRef(new Animated.Value(0)).current;
  // Cuánto mide en verdad el bloque que se revela al scrollear (avatares,
  // ticker, features, CTA). Sin este dato, el padding final es una
  // adivinanza: si el contenido resulta más corto que lo estimado, no queda
  // suficiente scroll disponible para que el héroe termine de contraerse
  // (se queda pegado a mitad de camino, tapando el contenido). Arranca en
  // 600 como estimación razonable para el primer render, antes de medir.
  const [restHeight, setRestHeight] = useState(600);

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
        <FutfinderMark size={44} color={C.green} />
        <View style={{ height: 20 }} />
        <ActivityIndicator color={C.green} />
      </View>
    );
  }

  const clampedInput = { inputRange: [0, SCROLL_RANGE], extrapolate: 'clamp' };
  const heroHeight = scrollY.interpolate({ ...clampedInput, outputRange: [expandedHeroHeight, COLLAPSED_HERO_HEIGHT] });
  const heroPadTop = scrollY.interpolate({ ...clampedInput, outputRange: [120, 4] });
  const heroPadBottom = scrollY.interpolate({ ...clampedInput, outputRange: [26, 14] });
  const logoScale = scrollY.interpolate({ ...clampedInput, outputRange: [1.5, 1] });
  const headlineTop = scrollY.interpolate({ ...clampedInput, outputRange: [46, 10] });
  const headlineSize = scrollY.interpolate({ ...clampedInput, outputRange: [54, 32] });
  // `lineHeight` no sigue a `fontSize` solo por cambiar el tamaño de fuente:
  // hay que animarlo aparte o el titular de dos líneas queda cortado una vez
  // que el héroe termina de contraerse (lineHeight fijo de sobra para 54px
  // no alcanza para nada a 32px si el contenedor también se achica).
  const headlineLineHeight = scrollY.interpolate({ ...clampedInput, outputRange: [57, 34] });
  const subtitleTop = scrollY.interpolate({ ...clampedInput, outputRange: [20, 0] });
  const subtitleSize = scrollY.interpolate({ ...clampedInput, outputRange: [16.5, 13] });
  // El subtítulo y el hint se apagan mucho antes de que el héroe termine de
  // contraerse (a los 2.2x y 3.2x de velocidad), igual que en el handoff:
  // no tiene sentido leer el subtítulo a mitad de la contracción.
  const subtitleOpacity = scrollY.interpolate({
    inputRange: [0, SCROLL_RANGE / 2.2], outputRange: [1, 0], extrapolate: 'clamp',
  });
  const subtitleMaxHeight = scrollY.interpolate({ ...clampedInput, outputRange: [130, 0] });
  const hintOpacity = scrollY.interpolate({
    inputRange: [0, SCROLL_RANGE / 3.2], outputRange: [1, 0], extrapolate: 'clamp',
  });
  // El resto del contenido (avatares, ticker, features, CTA) no aparece
  // desde el primer píxel de scroll: se mantiene invisible hasta el 45% del
  // recorrido y termina de aparecer al 85%, para no competir con el héroe
  // mientras se está contrayendo.
  const restRange = { inputRange: [SCROLL_RANGE * 0.45, SCROLL_RANGE * 0.85], extrapolate: 'clamp' };
  const restOpacity = scrollY.interpolate({ ...restRange, outputRange: [0, 1] });
  const restTranslateY = scrollY.interpolate({ ...restRange, outputRange: [16, 0] });

  // Relleno final para garantizar SCROLL_RANGE px de recorrido pase lo que
  // pase con el alto real del contenido revelado (distinto según fuente
  // cargada, ancho de pantalla, etc.): sin esto el espaciador fijo de arriba
  // (HERO_SPACER_HEIGHT) puede no alcanzar y el héroe se queda a mitad de
  // contraer, tapando el contenido en vez de dejarlo justo debajo.
  const bottomPad = Math.max(
    24,
    expandedHeroHeight + SCROLL_RANGE - HERO_SPACER_HEIGHT - restHeight
  );

  return (
    <View style={styles.root}>
      <Animated.ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: false } // anima height/padding/fontSize: no puede ir por el driver nativo
        )}
      >
        <View style={{ height: HERO_SPACER_HEIGHT }} />

        <Animated.View
          onLayout={(e) => setRestHeight(e.nativeEvent.layout.height)}
          style={{ opacity: restOpacity, transform: [{ translateY: restTranslateY }] }}
        >
          <View style={styles.restTop}>
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

          <Ticker />

          {/* ── Por qué FutFinder ── */}
          <View style={styles.body}>
            <SectionLabel>Por qué FutFinder</SectionLabel>
            <View style={{ gap: 9 }}>
              {FEATURES.map((f) => (
                <FeatureRow key={f.title} {...f} />
              ))}
            </View>

            <View style={{ marginTop: 10, gap: 9 }}>
              <Button label="Siguiente" onPress={() => navigation.navigate('Tutorial')} />
              <Text style={styles.legal}>
                Al continuar aceptas nuestros{' '}
                <Text style={styles.legalLink} onPress={() => openURL(TERMS_URL)}>Términos</Text>
                {' '}y{' '}
                <Text style={styles.legalLink} onPress={() => openURL(PRIVACY_URL)}>Política de Privacidad</Text>
              </Text>
            </View>
          </View>

        </Animated.View>
        <View style={{ height: bottomPad }} />
      </Animated.ScrollView>

      {/* ── Héroe: se superpone al scroll y se contrae con él ── */}
      {/* `pointerEvents="none"` (no "box-none"): el héroe está superpuesto y es
          HERMANO del ScrollView, no su ancestro, así que la rueda del mouse y el
          arrastre que caen sobre él no encadenan hacia abajo — mueren acá, y como
          el héroe tiene `overflow:hidden` tampoco lo scrollean a él. Resultado:
          no se puede deslizar desde ninguna parte que el héroe tape, que al
          entrar es la pantalla entera. Nada acá adentro es tocable, así que
          apagarle los eventos por completo deja pasar el gesto al scroll. */}
      <Animated.View style={[styles.hero, { height: heroHeight }]} pointerEvents="none">
        <BannerBackdrop variant="filled" />
        <LinearGradient
          colors={['rgba(7,10,7,0.15)', 'rgba(7,10,7,0.55)', C.bg]}
          locations={[0, 0.46, 0.92]}
          style={StyleSheet.absoluteFill}
        />
        <SafeAreaView edges={['top']} style={styles.heroContent} pointerEvents="none">
          <Animated.View style={{ paddingTop: heroPadTop, paddingBottom: heroPadBottom }}>
            <Animated.View style={[styles.brandRow, { transform: [{ scale: logoScale }] }]}>
              <FutfinderMark size={34} color={C.green} bgColor="#070A07" />
              <Text style={styles.brandText}>
                fut<Text style={{ color: C.green }}>finder</Text>
              </Text>
            </Animated.View>

            <Animated.Text style={[styles.headline, { marginTop: headlineTop, fontSize: headlineSize, lineHeight: headlineLineHeight }]}>
              Tu partido{'\n'}
              <Text style={{ color: C.green }}>resuelto hoy</Text>
            </Animated.Text>
            <Animated.Text
              style={[
                styles.heroSubtitle,
                { marginTop: subtitleTop, fontSize: subtitleSize, opacity: subtitleOpacity, maxHeight: subtitleMaxHeight },
              ]}
              numberOfLines={3}
            >
              Encuentra o completa tu partido en minutos. Cancha, rival y jugadores en un solo lugar.
            </Animated.Text>
          </Animated.View>

          <ScrollHint style={{ opacity: hintOpacity }} />
        </SafeAreaView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  splashCenter: { alignItems: 'center', justifyContent: 'center' },
  scroll: { flexGrow: 1 },

  hero: {
    position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden', backgroundColor: '#070A07',
  },
  heroContent: { flex: 1, paddingHorizontal: 22, justifyContent: 'space-between' },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  brandText: {
    fontFamily: F.extraBold, fontSize: 32, color: C.textPrimary, letterSpacing: -1.3,
  },
  headline: {
    fontFamily: F.extraBold, color: C.textPrimary, letterSpacing: -1,
  },
  heroSubtitle: {
    fontFamily: F.medium, lineHeight: 21, color: '#B4BAB5', maxWidth: 300, overflow: 'hidden',
  },
  hintWrap: { alignItems: 'center', gap: 9, paddingBottom: 26 },
  hintText: { fontFamily: F.bold, fontSize: 12.5, letterSpacing: 2, color: 'rgba(255,255,255,0.5)' },

  restTop: { paddingHorizontal: 22 },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
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
    backgroundColor: '#0C0F0C', overflow: 'hidden', justifyContent: 'center', marginTop: 16,
  },
  tickerTrack: { flexDirection: 'row' },
  tickerRow: { flexDirection: 'row' },
  tickerItem: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 13 },
  tickerDot: { width: 4, height: 4, borderRadius: 999, backgroundColor: C.greenDeepBorder },
  tickerText: { fontFamily: F.bold, fontSize: 11, color: C.textMuted },

  body: { paddingHorizontal: 20, paddingTop: 22 },
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
